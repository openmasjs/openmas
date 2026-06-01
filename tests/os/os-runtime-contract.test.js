import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFakeGeminiSecretProbe, buildFakeOpenRouterSecretProbe } from '../helpers/fake-secret-probes.js';
import {
  OPENMAS_OS_JOB_STATUSES,
  OPENMAS_OS_KINDS,
  OPENMAS_OS_PROCESS_STATUSES,
  OPENMAS_OS_SIGNAL_TYPES,
  OPENMAS_OS_THREAD_STATUSES,
  assertOpenMasOsEvent,
  assertOpenMasOsJob,
  assertOpenMasOsProcess,
  assertOpenMasOsSignal,
  assertOpenMasOsThread,
  assertSafeOsSerializableValue,
} from '../../src/contracts/openmas-os-runtime-contract.js';

const NOW = '2026-05-14T10:00:00-05:00';

function createJob(overrides = {}) {
  return {
    kind: OPENMAS_OS_KINDS.job,
    schemaVersion: 1,
    jobId: 'job_alfred_health_report',
    projectId: 'project_marketing',
    status: 'ready',
    createdBy: {
      type: 'human',
      id: 'admin',
    },
    assignedOperationalIdentityId: 'alfred',
    program: {
      type: 'agent_invocation',
      command: 'ask',
      mode: 'probabilistic',
    },
    inputRef: {
      type: 'inline_text',
      text: 'Generate the weekly health report.',
    },
    conversationId: 'alfred-admin',
    trigger: {
      type: 'immediate',
    },
    priority: 50,
    policies: {
      requiresApproval: false,
      maxAttempts: 3,
      noOverlap: true,
      missedRunPolicy: 'skip',
    },
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function createProcess(overrides = {}) {
  return {
    kind: OPENMAS_OS_KINDS.process,
    schemaVersion: 1,
    processId: 'process_alfred_health_report_001',
    jobId: 'job_alfred_health_report',
    status: 'running',
    operationalIdentityId: 'alfred',
    activeCognitiveIdentityId: 'system-steward',
    currentThreadId: 'thread_alfred_health_report_001',
    parentProcessId: null,
    childProcessIds: [],
    conversationId: 'alfred-admin',
    memoryContextRefs: [
      {
        type: 'context_pack',
        refId: 'context_alfred_health_report_001',
      },
    ],
    artifactRefs: [
      {
        artifactId: 'artifact_alfred_health_report_001',
        path: 'instance/memory/artifacts/reports/health-report.json',
      },
    ],
    credentialReferenceIds: [
      'providers.openrouter.shared.default.api_key',
    ],
    pendingApprovalRefs: [],
    warnings: [],
    createdAt: NOW,
    startedAt: NOW,
    updatedAt: NOW,
    completedAt: null,
    ...overrides,
  };
}

function createThread(overrides = {}) {
  return {
    kind: OPENMAS_OS_KINDS.thread,
    schemaVersion: 1,
    threadId: 'thread_alfred_health_report_001',
    processId: 'process_alfred_health_report_001',
    jobId: 'job_alfred_health_report',
    status: 'running',
    threadType: 'agent_invocation',
    priority: 50,
    attempt: 1,
    waitReason: null,
    dueAt: null,
    createdAt: NOW,
    startedAt: NOW,
    updatedAt: NOW,
    completedAt: null,
    ...overrides,
  };
}

function createEvent(overrides = {}) {
  return {
    kind: OPENMAS_OS_KINDS.event,
    schemaVersion: 1,
    eventId: 'event_thread_completed_001',
    eventType: 'thread.completed',
    source: {
      type: 'system',
      id: 'openmas-os',
    },
    targetRef: {
      type: 'thread',
      id: 'thread_alfred_health_report_001',
    },
    jobId: 'job_alfred_health_report',
    processId: 'process_alfred_health_report_001',
    threadId: 'thread_alfred_health_report_001',
    occurredAt: NOW,
    payload: {
      resultStatus: 'completed',
      artifactRefs: [
        {
          artifactId: 'artifact_alfred_health_report_001',
        },
      ],
    },
    ...overrides,
  };
}

function createSignal(overrides = {}) {
  return {
    kind: OPENMAS_OS_KINDS.signal,
    schemaVersion: 1,
    signalId: 'signal_cancel_process_001',
    signalType: 'cancel',
    targetType: 'process',
    targetId: 'process_alfred_health_report_001',
    createdBy: {
      type: 'human',
      id: 'admin',
    },
    createdAt: NOW,
    reason: 'Client crisis. Pause scheduled posting.',
    payload: {},
    ...overrides,
  };
}

test('assertOpenMasOsJob accepts the canonical agent invocation job shape', () => {
  const job = assertOpenMasOsJob(createJob({
    jobId: ' job_alfred_health_report ',
  }));

  assert.equal(job.kind, OPENMAS_OS_KINDS.job);
  assert.equal(job.jobId, 'job_alfred_health_report');
  assert.equal(job.program.type, 'agent_invocation');
  assert.equal(job.program.mode, 'probabilistic');
  assert.equal(Object.hasOwn(job.program, 'agentId'), false);
  assert.equal(job.policies.maxAttempts, 3);
  assert.equal(job.policies.missedRunPolicy, 'skip');
});

test('assertOpenMasOsJob validates scheduled, recurring, and event-driven triggers', () => {
  const scheduledJob = assertOpenMasOsJob(createJob({
    trigger: {
      type: 'scheduled_once',
      runAt: '2026-05-18T08:00:00-05:00',
    },
  }));

  const recurringJob = assertOpenMasOsJob(createJob({
    trigger: {
      type: 'recurring',
      intervalMs: 300000,
    },
  }));

  const eventDrivenJob = assertOpenMasOsJob(createJob({
    trigger: {
      type: 'event_driven',
      eventType: 'comment.complaint_detected',
    },
  }));

  assert.equal(scheduledJob.trigger.runAt, '2026-05-18T08:00:00-05:00');
  assert.equal(recurringJob.trigger.intervalMs, 300000);
  assert.equal(eventDrivenJob.trigger.eventType, 'comment.complaint_detected');
});

test('assertOpenMasOsJob rejects invalid states, unsafe ids, and raw secret-like values', () => {
  assert.throws(
    () => assertOpenMasOsJob(createJob({ status: 'queued_somewhere_else' })),
    /status is invalid/u,
  );

  assert.throws(
    () => assertOpenMasOsJob(createJob({ jobId: '../unsafe' })),
    /unsafe characters/u,
  );

  assert.throws(
    () => assertOpenMasOsJob(createJob({
      program: {
        type: 'agent_invocation',
        agentId: 'system-steward',
        command: 'ask',
        mode: 'probabilistic',
      },
    })),
    /must not include agentId/u,
  );

  assert.throws(
    () => assertOpenMasOsJob(createJob({
      inputRef: {
        type: 'inline_text',
        text: `Use API key ${buildFakeOpenRouterSecretProbe('secretvalue')} here.`,
      },
    })),
    /secret-like value/u,
  );

  assert.throws(
    () => assertOpenMasOsJob(createJob({
      policies: {
        apiKey: buildFakeOpenRouterSecretProbe('secretvalue'),
      },
    })),
    /raw secret-like field/u,
  );
});

test('assertOpenMasOsProcess accepts safe runtime metadata and credential reference ids', () => {
  const processState = assertOpenMasOsProcess(createProcess());

  assert.equal(processState.kind, OPENMAS_OS_KINDS.process);
  assert.equal(processState.status, 'running');
  assert.deepEqual(processState.credentialReferenceIds, [
    'providers.openrouter.shared.default.api_key',
  ]);
  assert.equal(processState.secretValue, undefined);
});

test('assertOpenMasOsJob, Process, and Thread preserve safe failure summaries', () => {
  const failureSummary = {
    kind: 'openmas_os_failure_summary',
    version: 1,
    reasonCode: 'invocation_failed',
    reason: 'OpenMAS OS Job invocation failed.',
    message: 'Provider rejected [redacted-secret].',
    source: 'openmas-os-run-job-now',
    failedAt: NOW,
  };
  const job = assertOpenMasOsJob(createJob({
    status: 'failed',
    failedAt: NOW,
    failureSummary,
  }));
  const processState = assertOpenMasOsProcess(createProcess({
    status: 'failed',
    currentThreadId: null,
    completedAt: NOW,
    failedAt: NOW,
    failureSummary,
  }));
  const thread = assertOpenMasOsThread(createThread({
    status: 'failed',
    completedAt: NOW,
    failedAt: NOW,
    failureSummary,
  }));

  assert.equal(job.failedAt, NOW);
  assert.deepEqual(job.failureSummary, failureSummary);
  assert.equal(processState.failedAt, NOW);
  assert.deepEqual(processState.failureSummary, failureSummary);
  assert.equal(thread.failedAt, NOW);
  assert.deepEqual(thread.failureSummary, failureSummary);

  assert.throws(
    () => assertOpenMasOsJob(createJob({
      status: 'failed',
      failedAt: NOW,
      failureSummary: {
        ...failureSummary,
        message: `Provider rejected ${buildFakeOpenRouterSecretProbe('secretvalue123456789')}.`,
      },
    })),
    /secret-like value/u,
  );
});

test('assertOpenMasOsProcess rejects terminal processes with an active currentThreadId and raw secrets', () => {
  assert.throws(
    () => assertOpenMasOsProcess(createProcess({
      status: 'completed',
      completedAt: NOW,
    })),
    /terminal status/u,
  );

  assert.throws(
    () => assertOpenMasOsProcess(createProcess({
      currentThreadId: null,
      artifactRefs: [
        {
          artifactId: 'artifact_001',
          accessToken: 'Bearer verysecretaccesstoken',
        },
      ],
    })),
    /raw secret-like field/u,
  );
});

test('assertOpenMasOsThread accepts running and blocked thread states', () => {
  const runningThread = assertOpenMasOsThread(createThread());
  const blockedThread = assertOpenMasOsThread(createThread({
    status: 'blocked',
    waitReason: 'approval_required',
    startedAt: null,
  }));

  assert.equal(runningThread.threadType, 'agent_invocation');
  assert.equal(blockedThread.waitReason, 'approval_required');
});

test('assertOpenMasOsThread rejects blocked threads without waitReason and invalid thread types', () => {
  assert.throws(
    () => assertOpenMasOsThread(createThread({
      status: 'blocked',
      waitReason: null,
    })),
    /must include waitReason/u,
  );

  assert.throws(
    () => assertOpenMasOsThread(createThread({
      threadType: 'raw_node_thread',
    })),
    /threadType is invalid/u,
  );
});

test('assertOpenMasOsEvent accepts safe event facts and rejects unsafe payloads', () => {
  const event = assertOpenMasOsEvent(createEvent());

  assert.equal(event.eventType, 'thread.completed');
  assert.equal(event.payload.resultStatus, 'completed');

  assert.throws(
    () => assertOpenMasOsEvent(createEvent({
      payload: {
        credential: {
          apiKey: buildFakeOpenRouterSecretProbe('secretvalue'),
        },
      },
    })),
    /raw secret-like field/u,
  );
});

test('assertOpenMasOsSignal accepts runtime signals and rejects invalid targets or unsafe payloads', () => {
  const signal = assertOpenMasOsSignal(createSignal());

  assert.equal(signal.signalType, 'cancel');
  assert.equal(signal.targetType, 'process');

  assert.throws(
    () => assertOpenMasOsSignal(createSignal({
      targetType: 'database',
    })),
    /targetType is invalid/u,
  );

  assert.throws(
    () => assertOpenMasOsSignal(createSignal({
      payload: {
        refreshToken: 'Bearer verysecretrefreshtoken',
      },
    })),
    /raw secret-like field/u,
  );
});

test('assertSafeOsSerializableValue allows credential reference metadata but rejects raw secret fields and values', () => {
  const safeValue = assertSafeOsSerializableValue({
    credentialReferenceIds: [
      'providers.gemini.shared.default.api_key',
    ],
    status: 'resolved',
  });

  assert.deepEqual(safeValue.credentialReferenceIds, [
    'providers.gemini.shared.default.api_key',
  ]);

  assert.throws(
    () => assertSafeOsSerializableValue({
      secretValue: buildFakeOpenRouterSecretProbe('secretvalue'),
    }),
    /raw secret-like field/u,
  );

  assert.throws(
    () => assertSafeOsSerializableValue(buildFakeGeminiSecretProbe('SyFakeSecretValue1234567890')),
    /secret-like value/u,
  );
});

test('OpenMAS OS contract constants expose the Milestone 1 vocabulary', () => {
  assert.equal(OPENMAS_OS_JOB_STATUSES.has('scheduled'), true);
  assert.equal(OPENMAS_OS_PROCESS_STATUSES.has('blocked'), true);
  assert.equal(OPENMAS_OS_THREAD_STATUSES.has('yielded'), true);
  assert.equal(OPENMAS_OS_SIGNAL_TYPES.has('approval_granted'), true);
  assert.equal(OPENMAS_OS_SIGNAL_TYPES.has('unknown_signal'), false);
});
