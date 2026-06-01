import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  createJob,
  admitJob,
  runJobNow,
} from '../../src/os/manual-job-execution.js';
import { createLocalRuntimeAdapter } from '../../src/os/adapters/local-runtime-adapter.js';
import { OPENMAS_OS_KINDS } from '../../src/contracts/os/openmas-os-runtime-contract.js';
import { createAlfredProbabilisticProjectFixture } from '../helpers/create-alfred-probabilistic-fixture.js';
import { buildFakeOpenRouterSecretProbe } from '../helpers/fake-secret-probes.js';

const CREATED_AT = '2026-05-14T10:00:00-05:00';
const ADMITTED_AT = '2026-05-14T10:01:00-05:00';
const STARTED_AT = '2026-05-14T10:02:00-05:00';
const FINISHED_AT = '2026-05-14T10:03:00-05:00';

function createClock(values) {
  const timestamps = [...values];

  return () => {
    if (timestamps.length === 0) {
      return values[values.length - 1];
    }

    return timestamps.shift();
  };
}

function createManualAgentJob(overrides = {}) {
  return {
    kind: OPENMAS_OS_KINDS.job,
    schemaVersion: 1,
    jobId: 'job_alfred_hello',
    projectId: 'project_marketing',
    status: 'draft',
    createdBy: {
      type: 'human',
      id: 'admin',
    },
    assignedOperationalIdentityId: 'alfred',
    program: {
      type: 'agent_invocation',
      command: 'hello',
      mode: 'deterministic',
    },
    inputRef: {
      type: 'none',
    },
    conversationId: null,
    trigger: {
      type: 'immediate',
    },
    priority: 50,
    policies: {
      requiresApproval: false,
      maxAttempts: 1,
      noOverlap: false,
    },
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ...overrides,
  };
}

test('createJob and admitJob persist manual OS Job lifecycle state and events', async () => {
  const projectRootPath = await createAlfredProbabilisticProjectFixture();
  const adapter = createLocalRuntimeAdapter({ projectRootPath });
  const createdJob = await createJob({
    adapter,
    job: createManualAgentJob(),
    now: () => CREATED_AT,
  });
  const admittedJob = await admitJob({
    adapter,
    jobId: createdJob.jobId,
    now: () => ADMITTED_AT,
  });

  assert.equal(createdJob.status, 'draft');
  assert.equal(admittedJob.status, 'ready');
  assert.equal(admittedJob.updatedAt, ADMITTED_AT);
  assert.deepEqual(await adapter.loadJob(admittedJob.jobId), admittedJob);

  const events = await adapter.readEvents({ date: '2026-05-14' });

  assert.deepEqual(
    events.map((event) => event.eventType),
    [
      'job.created',
      'job.admitted',
    ],
  );
});

test('runJobNow creates a Process and Thread, invokes Alfred deterministically, and persists completion', async () => {
  const projectRootPath = await createAlfredProbabilisticProjectFixture();
  const adapter = createLocalRuntimeAdapter({ projectRootPath });

  await createJob({
    adapter,
    job: createManualAgentJob(),
    now: () => CREATED_AT,
  });
  await admitJob({
    adapter,
    jobId: 'job_alfred_hello',
    now: () => ADMITTED_AT,
  });

  const result = await runJobNow({
    adapter,
    projectRootPath,
    jobId: 'job_alfred_hello',
    now: createClock([STARTED_AT, FINISHED_AT]),
  });

  assert.equal(result.invocationResult.status, 'completed');
  assert.equal(result.invocationResult.operationalIdentityId, 'alfred');
  assert.equal(result.invocationResult.request.command, 'hello');
  assert.match(result.invocationResult.message, /framework is alive/i);

  assert.equal(result.job.status, 'completed');
  assert.equal(result.process.status, 'completed');
  assert.equal(result.process.currentThreadId, null);
  assert.equal(result.thread.status, 'completed');
  assert.equal(result.thread.completedAt, FINISHED_AT);
  assert.ok(result.process.artifactRefs.some((artifactRef) => artifactRef.artifactKind === 'invocation_session'));
  assert.ok(result.process.artifactRefs.some((artifactRef) => artifactRef.artifactKind === 'invocation_report'));
  assert.equal(result.foregroundAdmissionResult.resultKind, 'foreground_admission_result');
  assert.equal(result.foregroundAdmissionResult.status, 'accepted');
  assert.equal(result.foregroundAdmissionResult.phase, 'admission');
  assert.equal(result.foregroundAdmissionResult.lineage.jobId, result.job.jobId);
  assert.equal(result.foregroundCompletionResult.resultKind, 'foreground_completion_result');
  assert.equal(result.foregroundCompletionResult.status, 'completed');
  assert.equal(result.foregroundCompletionResult.phase, 'terminal');
  assert.equal(result.foregroundCompletionResult.completion.startedAt, STARTED_AT);
  assert.equal(result.foregroundCompletionResult.completion.completedAt, FINISHED_AT);
  assert.equal(result.foregroundCompletionResult.completion.durationMs, 60000);
  assert.equal(result.foregroundCompletionResult.lineage.invocationId, result.invocationResult.invocationId);
  assert.ok(result.foregroundCompletionResult.artifactRefs.some((artifactRef) => {
    return artifactRef.artifactKind === 'invocation_report';
  }));

  assert.deepEqual(await adapter.loadJob(result.job.jobId), result.job);
  assert.deepEqual(await adapter.loadProcess(result.process.processId), result.process);
  assert.deepEqual(await adapter.loadThread(result.thread.threadId), result.thread);
  assert.deepEqual(await adapter.loadResultRecord(result.foregroundAdmissionResult.resultId), result.foregroundAdmissionResult);
  assert.deepEqual(await adapter.loadResultRecord(result.foregroundCompletionResult.resultId), result.foregroundCompletionResult);

  const resultRecords = await adapter.listResultRecords({
    processId: result.process.processId,
  });

  assert.deepEqual(
    resultRecords.map((resultRecord) => resultRecord.resultKind),
    [
      'foreground_admission_result',
      'foreground_completion_result',
    ],
  );

  const events = await adapter.readEvents({ date: '2026-05-14' });

  assert.deepEqual(
    events.map((event) => event.eventType),
    [
      'job.created',
      'job.admitted',
      'job.activated',
      'process.created',
      'thread.created',
      'thread.started',
      'thread.completed',
      'process.completed',
      'job.completed',
    ],
  );
});

test('runJobNow records the resolved active cognitive identity for routed Operational Identity Jobs', async () => {
  const projectRootPath = await createAlfredProbabilisticProjectFixture();
  const adapter = createLocalRuntimeAdapter({ projectRootPath });

  await createJob({
    adapter,
    job: createManualAgentJob({
      jobId: 'job_alfred_routed_hello',
      program: {
        type: 'agent_invocation',
        command: 'hello',
        mode: 'deterministic',
      },
    }),
    now: () => CREATED_AT,
  });
  await admitJob({
    adapter,
    jobId: 'job_alfred_routed_hello',
    now: () => ADMITTED_AT,
  });

  const result = await runJobNow({
    adapter,
    projectRootPath,
    jobId: 'job_alfred_routed_hello',
    now: createClock([STARTED_AT, FINISHED_AT]),
  });

  assert.equal(result.invocationResult.status, 'completed');
  assert.equal(result.invocationResult.primaryCognitiveIdentityId, 'system-steward');
  assert.equal(result.process.activeCognitiveIdentityId, 'system-steward');
  assert.equal(result.foregroundAdmissionResult.producer.activeCognitiveIdentityId, null);
  assert.equal(result.foregroundCompletionResult.producer.activeCognitiveIdentityId, 'system-steward');
  assert.equal((await adapter.loadProcess(result.process.processId)).activeCognitiveIdentityId, 'system-steward');
});

test('runJobNow passes the current OS runtime context into the invocation runner', async () => {
  const projectRootPath = await createAlfredProbabilisticProjectFixture();
  const adapter = createLocalRuntimeAdapter({ projectRootPath });
  let capturedInvocationOptions = null;

  await createJob({
    adapter,
    job: createManualAgentJob({
      jobId: 'job_os_context_bridge',
      status: 'ready',
    }),
    now: () => CREATED_AT,
  });

  const result = await runJobNow({
    adapter,
    projectRootPath,
    jobId: 'job_os_context_bridge',
    now: createClock([STARTED_AT, FINISHED_AT]),
    invocationRunner: async (invocationOptions) => {
      capturedInvocationOptions = invocationOptions;

      return {
        invocationId: 'invocation_os_context_bridge',
        status: 'completed',
        message: 'ok',
        warnings: [],
        errors: [],
        persistence: null,
      };
    },
  });

  assert.equal(capturedInvocationOptions.osRuntimeContext.jobId, 'job_os_context_bridge');
  assert.equal(Object.hasOwn(capturedInvocationOptions, 'agentId'), false);
  assert.equal(capturedInvocationOptions.osRuntimeContext.processId, result.process.processId);
  assert.equal(capturedInvocationOptions.osRuntimeContext.threadId, result.thread.threadId);
  assert.equal(capturedInvocationOptions.osRuntimeContext.parentProcessId, null);
  assert.equal(capturedInvocationOptions.osRuntimeContext.source, 'openmas-os-run-job-now');
});

test('runJobNow materializes foreground warnings, tool refs, and verification gate details', async () => {
  const projectRootPath = await createAlfredProbabilisticProjectFixture();
  const adapter = createLocalRuntimeAdapter({ projectRootPath });

  await createJob({
    adapter,
    job: createManualAgentJob({
      jobId: 'job_foreground_result_with_tool',
      status: 'ready',
      program: {
        type: 'agent_invocation',
        command: 'ask',
        mode: 'probabilistic',
      },
    }),
    now: () => CREATED_AT,
  });

  const result = await runJobNow({
    adapter,
    projectRootPath,
    jobId: 'job_foreground_result_with_tool',
    now: createClock([STARTED_AT, FINISHED_AT]),
    invocationRunner: async () => {
      return {
        invocationId: 'invocation_foreground_result_tool',
        status: 'completed',
        message: 'Tool-backed foreground invocation completed with bounded evidence.',
        warnings: [
          'Tool observation preview was bounded.',
        ],
        errors: [],
        persistence: null,
        output: {
          brainToolExecution: {
            executionPerformed: true,
            requestedToolId: 'mas.system.inspect',
            toolRunId: 'tool-run-foreground-001',
            toolResultStatus: 'succeeded',
            observation: {
              status: 'succeeded',
              toolRunId: 'tool-run-foreground-001',
              summary: 'Inspection completed.',
            },
          },
          actionResultAssessment: {
            status: 'success',
            requestFulfillment: 'fulfilled',
            executionObserved: true,
          },
        },
        verificationGate: {
          kind: 'verification_gate',
          version: 1,
          status: 'degraded',
          verificationOutcome: 'partially_verified',
          requestedAction: {
            actionType: 'tool',
            targetId: 'mas.system.inspect',
          },
          executionObserved: true,
          evidenceRequirements: [],
          claimSupportSummary: {
            supportedClaimCount: 1,
            unsupportedClaimCount: 0,
            unknownClaimCount: 0,
          },
          reason: 'Inline verification evidence was bounded.',
          recommendedNextActions: [],
          warnings: [],
          metadata: {},
        },
      };
    },
  });

  const resultRecords = await adapter.listResultRecords({
    processId: result.process.processId,
  });
  const completionResult = resultRecords.find((resultRecord) => {
    return resultRecord.resultKind === 'foreground_completion_result';
  });

  assert.equal(completionResult.status, 'completed_with_warnings');
  assert.deepEqual(completionResult.toolRunRefs, ['tool-run-foreground-001']);
  assert.equal(completionResult.warnings.length, 1);
  assert.equal(completionResult.warnings[0].message, 'Tool observation preview was bounded.');
  assert.equal(completionResult.warnings[0].affectsResultTrust, false);
  assert.equal(completionResult.verification.status, 'warning');
  assert.equal(completionResult.verification.grounded, true);
  assert.equal(completionResult.metadata.actionResultAssessment.status, 'success');
});

test('runJobNow marks foreground warnings as trust-affecting when verification fails', async () => {
  const projectRootPath = await createAlfredProbabilisticProjectFixture();
  const adapter = createLocalRuntimeAdapter({ projectRootPath });

  await createJob({
    adapter,
    job: createManualAgentJob({
      jobId: 'job_foreground_result_with_unsupported_claim',
      status: 'ready',
    }),
    now: () => CREATED_AT,
  });

  const result = await runJobNow({
    adapter,
    projectRootPath,
    jobId: 'job_foreground_result_with_unsupported_claim',
    now: createClock([STARTED_AT, FINISHED_AT]),
    invocationRunner: async () => {
      return {
        invocationId: 'invocation_foreground_result_with_unsupported_claim',
        status: 'completed',
        message: 'Foreground answer requires review.',
        warnings: [
          'Unsupported completed-action claim requires review.',
        ],
        errors: [],
        persistence: null,
        output: {
          actionResultAssessment: {
            answerGroundedInEvidence: false,
          },
        },
        verificationGate: {
          status: 'failed',
          verificationOutcome: 'not_verified',
          executionObserved: false,
          reason: 'Runtime evidence did not support the completed-action claim.',
        },
      };
    },
  });

  assert.equal(result.foregroundCompletionResult.status, 'completed_with_warnings');
  assert.equal(result.foregroundCompletionResult.verification.status, 'failed');
  assert.equal(result.foregroundCompletionResult.warnings[0].affectsResultTrust, true);
});

test('runJobNow allows only one concurrent caller to claim the same ready Job', async () => {
  const projectRootPath = await createAlfredProbabilisticProjectFixture();
  const adapter = createLocalRuntimeAdapter({ projectRootPath });
  const jobId = 'job_same_foreground_double_claim';

  await createJob({
    adapter,
    job: createManualAgentJob({
      jobId,
      status: 'ready',
    }),
    now: () => CREATED_AT,
  });

  const outcomes = await Promise.allSettled([
    runJobNow({
      adapter,
      projectRootPath,
      jobId,
      now: createClock([
        '2026-05-14T10:02:00-05:00',
        '2026-05-14T10:03:00-05:00',
      ]),
    }),
    runJobNow({
      adapter,
      projectRootPath,
      jobId,
      now: createClock([
        '2026-05-14T10:02:01-05:00',
        '2026-05-14T10:03:01-05:00',
      ]),
    }),
  ]);

  const fulfilled = outcomes.filter((outcome) => outcome.status === 'fulfilled');
  const rejected = outcomes.filter((outcome) => outcome.status === 'rejected');
  const processes = await adapter.listProcesses({ jobId });
  const resultRecords = await adapter.findResultRecordsByJob(jobId);
  const eventTypes = (await adapter.readEvents({ date: '2026-05-14' }))
    .filter((event) => event.jobId === jobId)
    .map((event) => event.eventType);

  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.match(rejected[0].reason.message, /already being claimed|must be ready/u);
  assert.equal((await adapter.loadJob(jobId)).status, 'completed');
  assert.equal(processes.length, 1);
  assert.deepEqual(
    resultRecords.map((resultRecord) => resultRecord.resultKind),
    [
      'foreground_admission_result',
      'foreground_completion_result',
    ],
  );
  assert.deepEqual(
    eventTypes.filter((eventType) => eventType === 'job.completed'),
    ['job.completed'],
  );
});

test('runJobNow keeps the parent Process and Thread blocked after mas.os.delegate submits a System Call', async () => {
  const projectRootPath = await createAlfredProbabilisticProjectFixture();
  const adapter = createLocalRuntimeAdapter({ projectRootPath });

  await createJob({
    adapter,
    job: createManualAgentJob({
      jobId: 'job_delegates_to_bruce',
      status: 'ready',
      program: {
        type: 'agent_invocation',
        command: 'ask',
        mode: 'probabilistic',
      },
      inputRef: {
        type: 'inline_text',
        text: 'Ask Bruce to inspect the MAS.',
      },
    }),
    now: () => CREATED_AT,
  });

  const result = await runJobNow({
    adapter,
    projectRootPath,
    jobId: 'job_delegates_to_bruce',
    now: createClock([STARTED_AT, FINISHED_AT]),
    invocationRunner: async () => {
      return {
        invocationId: 'invocation_delegated_to_bruce',
        status: 'completed',
        message: 'Delegation requested.',
        warnings: [],
        errors: [],
        persistence: null,
        output: {
          brainToolExecution: {
            executionPerformed: true,
            requestedToolId: 'mas.os.delegate',
            toolResultStatus: 'succeeded',
            observation: {
              dataPreview: {
                delegated: false,
                systemCall: {
                  operation: 'delegate',
                  status: 'pending',
                  systemCallId: 'syscall_delegate_manual_job_001',
                },
              },
            },
          },
        },
      };
    },
  });

  assert.equal(result.job.status, 'active');
  assert.equal(result.process.status, 'blocked');
  assert.equal(result.process.currentThreadId, result.thread.threadId);
  assert.equal(result.thread.status, 'blocked');
  assert.equal(result.thread.waitReason, 'waiting_for_system_call');
  assert.equal(result.thread.completedAt, null);
  assert.equal(result.process.completedAt, null);
  assert.equal(result.foregroundAdmissionResult.resultKind, 'foreground_admission_result');
  assert.equal(result.foregroundCompletionResult, null);

  const resultRecords = await adapter.listResultRecords({
    processId: result.process.processId,
  });

  assert.deepEqual(
    resultRecords.map((resultRecord) => resultRecord.resultKind),
    ['foreground_admission_result'],
  );

  const events = await adapter.readEvents({ date: '2026-05-14' });

  assert.equal(events.some((event) => event.eventType === 'thread.completed'), false);
  assert.equal(events.some((event) => event.eventType === 'process.completed'), false);
  assert.equal(events.some((event) => event.eventType === 'job.completed'), false);
});

test('runJobNow preserves newer kernel delegation state when System Call processing advances the parent first', async () => {
  const projectRootPath = await createAlfredProbabilisticProjectFixture();
  const adapter = createLocalRuntimeAdapter({ projectRootPath });
  const rawSecret = buildFakeOpenRouterSecretProbe('obsoleteContinuationSecret123456789');

  await createJob({
    adapter,
    job: createManualAgentJob({
      jobId: 'job_delegate_race_parent',
      status: 'ready',
      program: {
        type: 'agent_invocation',
        command: 'ask',
        mode: 'probabilistic',
      },
      inputRef: {
        type: 'inline_text',
        text: 'Ask Bruce to inspect the MAS.',
      },
    }),
    now: () => CREATED_AT,
  });

  const result = await runJobNow({
    adapter,
    projectRootPath,
    jobId: 'job_delegate_race_parent',
    now: createClock([STARTED_AT, FINISHED_AT]),
    invocationRunner: async (request) => {
      const parentProcess = await adapter.loadProcess(request.osRuntimeContext.processId);
      const parentThread = await adapter.loadThread(request.osRuntimeContext.threadId);

      await adapter.persistThread({
        ...parentThread,
        status: 'blocked',
        waitReason: 'waiting_for_child_process',
        updatedAt: '2026-05-14T10:02:30-05:00',
      });
      await adapter.persistProcess({
        ...parentProcess,
        status: 'blocked',
        childProcessIds: ['process_bruce_delegate_race_child'],
        updatedAt: '2026-05-14T10:02:30-05:00',
      });

      return {
        invocationId: 'invocation_delegate_race_parent',
        status: 'failed',
        message: `Obsolete delegation follow-up failed after provider timeout ${rawSecret}.`,
        warnings: [],
        errors: [`Provider timeout ${rawSecret}.`],
        persistence: null,
        output: {
          brainToolExecution: {
            executionPerformed: true,
            requestedToolId: 'mas.os.delegate',
            toolResultStatus: 'succeeded',
            observation: {
              dataPreview: {
                delegated: false,
                systemCall: {
                  operation: 'delegate',
                  status: 'pending',
                  systemCallId: 'syscall_delegate_race_parent_001',
                },
              },
            },
          },
        },
      };
    },
  });
  const persistedProcess = await adapter.loadProcess(result.process.processId);
  const persistedThread = await adapter.loadThread(result.thread.threadId);
  const events = await adapter.readEvents({ date: '2026-05-14' });
  const eventTypes = events.map((event) => event.eventType);
  const skippedFinalizationEvent = events.find((event) => {
    return event.eventType === 'job.finalization_skipped';
  });

  assert.equal(result.job.status, 'active');
  assert.equal(result.process.status, 'blocked');
  assert.equal(result.thread.status, 'blocked');
  assert.equal(result.thread.waitReason, 'waiting_for_child_process');
  assert.deepEqual(result.process.childProcessIds, ['process_bruce_delegate_race_child']);
  assert.equal(persistedProcess.status, 'blocked');
  assert.equal(persistedThread.waitReason, 'waiting_for_child_process');
  assert.equal(result.foregroundAdmissionResult.resultKind, 'foreground_admission_result');
  assert.equal(result.foregroundCompletionResult, null);
  assert.ok(eventTypes.includes('job.finalization_skipped'));
  assert.equal(skippedFinalizationEvent.payload.authoritativeStateChanged, false);
  assert.equal(skippedFinalizationEvent.payload.failureSummary.reasonCode, 'invocation_failed');
  assert.match(skippedFinalizationEvent.payload.failureSummary.message, /Obsolete delegation follow-up failed/u);
  assert.doesNotMatch(JSON.stringify(skippedFinalizationEvent), new RegExp(rawSecret, 'u'));
});

test('runJobNow persists failed Job, Process, and Thread state when invocation fails', async () => {
  const projectRootPath = await createAlfredProbabilisticProjectFixture();
  const adapter = createLocalRuntimeAdapter({ projectRootPath });

  await createJob({
    adapter,
    job: createManualAgentJob({
      jobId: 'job_alfred_missing_command',
      program: {
        type: 'agent_invocation',
        command: 'missing-command',
        mode: 'deterministic',
      },
    }),
    now: () => CREATED_AT,
  });
  await admitJob({
    adapter,
    jobId: 'job_alfred_missing_command',
    now: () => ADMITTED_AT,
  });

  const result = await runJobNow({
    adapter,
    projectRootPath,
    jobId: 'job_alfred_missing_command',
    now: createClock([STARTED_AT, FINISHED_AT]),
  });

  assert.equal(result.invocationResult.status, 'failed');
  assert.equal(result.job.status, 'failed');
  assert.equal(result.process.status, 'failed');
  assert.equal(result.thread.status, 'failed');
  assert.equal(result.process.currentThreadId, null);
  assert.equal(result.job.failedAt, FINISHED_AT);
  assert.equal(result.process.failedAt, FINISHED_AT);
  assert.equal(result.thread.failedAt, FINISHED_AT);
  assert.equal(result.job.failureSummary.reasonCode, 'invocation_failed');
  assert.equal(result.process.failureSummary.reasonCode, 'invocation_failed');
  assert.equal(result.thread.failureSummary.reasonCode, 'invocation_failed');
  assert.equal(result.foregroundCompletionResult.status, 'failed');
  assert.equal(result.foregroundCompletionResult.failure.reasonCode, 'invocation_failed');
  assert.equal(result.foregroundCompletionResult.failure.class, 'brain_failure');
  assert.equal(result.foregroundCompletionResult.completion.exitClass, 'failure');

  const events = await adapter.readEvents({ date: '2026-05-14' });
  const failureEvents = events.slice(-3);

  assert.deepEqual(
    failureEvents.map((event) => event.eventType),
    [
      'thread.failed',
      'process.failed',
      'job.failed',
    ],
  );
  assert.deepEqual(
    failureEvents.map((event) => event.payload.failedAt),
    [
      FINISHED_AT,
      FINISHED_AT,
      FINISHED_AT,
    ],
  );
  assert.equal(failureEvents.every((event) => event.payload.failureSummary.reasonCode === 'invocation_failed'), true);
});

test('runJobNow closes OS state as failed when the invocation runner throws', async () => {
  const projectRootPath = await createAlfredProbabilisticProjectFixture();
  const adapter = createLocalRuntimeAdapter({ projectRootPath });

  await createJob({
    adapter,
    job: createManualAgentJob({
      jobId: 'job_invocation_runner_throw',
    }),
    now: () => CREATED_AT,
  });
  await admitJob({
    adapter,
    jobId: 'job_invocation_runner_throw',
    now: () => ADMITTED_AT,
  });

  const rawSecret = buildFakeOpenRouterSecretProbe('runnerSecret123456789');
  const result = await runJobNow({
    adapter,
    projectRootPath,
    jobId: 'job_invocation_runner_throw',
    now: createClock([STARTED_AT, FINISHED_AT]),
    invocationRunner: async () => {
      throw new Error(`Injected runner failure ${rawSecret}.`);
    },
  });

  assert.equal(result.invocationResult.status, 'failed');
  assert.match(result.invocationResult.message, /Injected runner failure/u);
  assert.doesNotMatch(result.invocationResult.message, new RegExp(rawSecret, 'u'));
  assert.equal(result.job.status, 'failed');
  assert.equal(result.process.status, 'failed');
  assert.equal(result.thread.status, 'failed');
  assert.equal(result.job.failedAt, FINISHED_AT);
  assert.equal(result.process.failedAt, FINISHED_AT);
  assert.equal(result.thread.failedAt, FINISHED_AT);
  assert.match(result.job.failureSummary.message, /Injected runner failure/u);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(rawSecret, 'u'));
});

test('runJobNow refuses unsupported foreground resource sleeps as retryable terminal failures', async () => {
  const projectRootPath = await createAlfredProbabilisticProjectFixture();
  const adapter = createLocalRuntimeAdapter({ projectRootPath });

  await createJob({
    adapter,
    job: createManualAgentJob({
      jobId: 'job_foreground_resource_wait_not_supported',
      status: 'ready',
    }),
    now: () => CREATED_AT,
  });

  const result = await runJobNow({
    adapter,
    projectRootPath,
    jobId: 'job_foreground_resource_wait_not_supported',
    now: createClock([STARTED_AT, FINISHED_AT]),
    invocationRunner: async () => {
      return {
        invocationId: 'invocation_foreground_resource_wait_not_supported',
        status: 'blocked',
        message: 'Provider capacity is temporarily unavailable.',
        warnings: [],
        errors: [],
        persistence: null,
      };
    },
  });

  assert.equal(result.job.status, 'failed');
  assert.equal(result.process.status, 'failed');
  assert.equal(result.process.currentThreadId, null);
  assert.equal(result.thread.status, 'failed');
  assert.equal(result.thread.waitReason, null);
  assert.equal(result.job.failureSummary.reasonCode, 'unsupported_foreground_resource_wait');
  assert.equal(result.foregroundCompletionResult.status, 'failed');
  assert.equal(result.foregroundCompletionResult.failure.reasonCode, 'unsupported_foreground_resource_wait');
  assert.equal(result.foregroundCompletionResult.failure.recoverable, true);
  assert.equal(result.foregroundCompletionResult.failure.retryable, true);
});

test('runJobNow preserves OS state without raw Credential Vault secrets', async () => {
  const projectRootPath = await createAlfredProbabilisticProjectFixture();
  const adapter = createLocalRuntimeAdapter({ projectRootPath });

  await createJob({
    adapter,
    job: createManualAgentJob({
      jobId: 'job_secret_safe_state',
    }),
    now: () => CREATED_AT,
  });
  await admitJob({
    adapter,
    jobId: 'job_secret_safe_state',
    now: () => ADMITTED_AT,
  });

  const result = await runJobNow({
    adapter,
    projectRootPath,
    jobId: 'job_secret_safe_state',
    now: createClock([STARTED_AT, FINISHED_AT]),
  });

  const serializedOsState = [
    await readFile(adapter.resolveJobSnapshotPath(result.job.jobId), 'utf8'),
    await readFile(adapter.resolveProcessSnapshotPath(result.process.processId), 'utf8'),
    await readFile(adapter.resolveThreadSnapshotPath(result.thread.threadId), 'utf8'),
    JSON.stringify(await adapter.readEvents({ date: '2026-05-14' })),
  ].join('\n');

  assert.doesNotMatch(serializedOsState, /openrouter-secret/u);
  assert.doesNotMatch(serializedOsState, /gemini-secret/u);
  assert.doesNotMatch(serializedOsState, /secretValue/u);
});

test('runJobNow requires a ready Job and supports only agent_invocation programs in Slice 1.3', async () => {
  const projectRootPath = await createAlfredProbabilisticProjectFixture();
  const adapter = createLocalRuntimeAdapter({ projectRootPath });

  await createJob({
    adapter,
    job: createManualAgentJob({
      jobId: 'job_not_admitted',
    }),
    now: () => CREATED_AT,
  });

  await assert.rejects(
    () => runJobNow({
      adapter,
      projectRootPath,
      jobId: 'job_not_admitted',
    }),
    /must be ready/u,
  );

  await createJob({
    adapter,
    job: createManualAgentJob({
      jobId: 'job_workflow_not_supported_yet',
      status: 'ready',
      program: {
        type: 'workflow',
        programId: 'mas-health-review',
      },
    }),
    now: () => CREATED_AT,
  });

  await assert.rejects(
    () => runJobNow({
      adapter,
      projectRootPath,
      jobId: 'job_workflow_not_supported_yet',
    }),
    /only supports agent_invocation/u,
  );
});
