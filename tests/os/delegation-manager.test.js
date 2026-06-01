import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { createLocalRuntimeAdapter } from '../../src/os/adapters/local-runtime-adapter.js';
import {
  delegateToOperationalIdentity,
  notifyDelegatedChildCompletion,
  resumeParentAfterDelegatedChild,
  runDelegatedJobAndResumeParentNow,
  runDelegatedJobNow,
} from '../../src/os/delegation/delegation-manager.js';
import { OPENMAS_OS_KINDS } from '../../src/contracts/openmas-os-runtime-contract.js';
import { buildFakeOpenRouterSecretProbe } from '../helpers/fake-secret-probes.js';

const CREATED_AT = '2026-05-14T10:00:00-05:00';
const DELEGATED_AT = '2026-05-14T10:01:00-05:00';
const CHILD_STARTED_AT = '2026-05-14T10:02:00-05:00';
const CHILD_FINISHED_AT = '2026-05-14T10:03:00-05:00';
const CHILD_SIGNALED_AT = '2026-05-14T10:04:00-05:00';

const ALLOW_ALFRED_TO_MARIA = Object.freeze([
  {
    ruleId: 'allow_alfred_to_maria_ask',
    fromOperationalIdentityId: 'alfred',
    toOperationalIdentityId: 'maria',
    programType: 'agent_invocation',
    command: 'ask',
  },
]);

async function createTemporaryProjectRoot() {
  return mkdtemp(path.join(os.tmpdir(), 'openmas-delegation-manager-'));
}

async function persistConversationSession(
  projectRootPath,
  {
    conversationId = 'alfred_admin',
    operationalIdentityIds = ['alfred'],
    allowedOperationalIdentityIds = ['alfred'],
  } = {},
) {
  const conversationDirectoryPath = path.join(
    projectRootPath,
    'instance',
    'memory',
    'state',
    'conversations',
    conversationId,
  );
  await mkdir(conversationDirectoryPath, { recursive: true });
  await writeFile(
    path.join(conversationDirectoryPath, 'session.json'),
    `${JSON.stringify({
      kind: 'conversation_session',
      version: 1,
      conversationId,
      title: null,
      status: 'active',
      owner: {
        scope: 'operational_identity',
        operationalIdentityId: 'alfred',
      },
      participants: {
        humanParticipantIds: ['admin'],
        operationalIdentityIds,
      },
      privacy: {
        visibility: 'private_to_participants',
        allowedOperationalIdentityIds,
      },
      contextPolicy: {
        maxRecentTurns: 20,
        allowRawHistoryInPrompt: false,
      },
      summary: {
        status: 'none',
        text: null,
        updatedAt: null,
      },
      turnCount: 0,
      lastTurnId: null,
      createdBy: 'admin',
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
      closedAt: null,
      warnings: [],
    }, null, 2)}\n`,
    'utf8',
  );
  await writeFile(
    path.join(conversationDirectoryPath, 'turns.json'),
    '[]\n',
    'utf8',
  );
}

function createClock(values) {
  const timestamps = [...values];

  return () => {
    if (timestamps.length === 0) {
      return values[values.length - 1];
    }

    return timestamps.shift();
  };
}

function createParentJob(overrides = {}) {
  return {
    kind: OPENMAS_OS_KINDS.job,
    schemaVersion: 1,
    jobId: 'job_parent_alfred',
    projectId: 'project_marketing',
    status: 'active',
    createdBy: {
      type: 'human',
      id: 'admin',
    },
    assignedOperationalIdentityId: 'alfred',
    program: {
      type: 'agent_invocation',
      command: 'ask',
      mode: 'deterministic',
    },
    inputRef: {
      type: 'inline_text',
      text: 'Coordinate with Maria.',
    },
    conversationId: 'alfred_admin',
    trigger: {
      type: 'manual',
    },
    priority: 40,
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

function createParentProcess(overrides = {}) {
  return {
    kind: OPENMAS_OS_KINDS.process,
    schemaVersion: 1,
    processId: 'process_parent_alfred',
    jobId: 'job_parent_alfred',
    status: 'running',
    operationalIdentityId: 'alfred',
    activeCognitiveIdentityId: 'system-steward',
    currentThreadId: 'thread_parent_alfred',
    parentProcessId: null,
    childProcessIds: [],
    conversationId: 'alfred_admin',
    memoryContextRefs: [],
    artifactRefs: [],
    credentialReferenceIds: [],
    pendingApprovalRefs: [],
    warnings: [],
    createdAt: CREATED_AT,
    startedAt: CREATED_AT,
    updatedAt: CREATED_AT,
    completedAt: null,
    ...overrides,
  };
}

function createParentThread(overrides = {}) {
  return {
    kind: OPENMAS_OS_KINDS.thread,
    schemaVersion: 1,
    threadId: 'thread_parent_alfred',
    processId: 'process_parent_alfred',
    jobId: 'job_parent_alfred',
    status: 'running',
    threadType: 'agent_invocation',
    priority: 40,
    attempt: 1,
    waitReason: null,
    dueAt: null,
    createdAt: CREATED_AT,
    startedAt: CREATED_AT,
    updatedAt: CREATED_AT,
    completedAt: null,
    ...overrides,
  };
}

function createDelegation(overrides = {}) {
  return {
    delegationId: 'delegation_alfred_to_maria_hello',
    childJobId: 'job_maria_child_hello',
    assignedOperationalIdentityId: 'maria',
    program: {
      type: 'agent_invocation',
      command: 'ask',
      mode: 'deterministic',
    },
    inputRef: {
      type: 'inline_text',
      text: 'Please say hello to Alfred.',
    },
    contextRefs: [
      {
        type: 'conversation',
        id: 'alfred_admin',
      },
    ],
    ...overrides,
  };
}

async function persistParentRuntime(adapter, overrides = {}) {
  await adapter.persistJob(createParentJob(overrides.job));
  await adapter.persistProcess(createParentProcess(overrides.process));
  await adapter.persistThread(createParentThread(overrides.thread));
}

test('delegateToOperationalIdentity authorizes an explicit delegation, creates a child Job, and blocks the parent Thread', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const adapter = createLocalRuntimeAdapter({ projectRootPath });

  await persistParentRuntime(adapter);

  const result = await delegateToOperationalIdentity({
    adapter,
    parentProcessId: 'process_parent_alfred',
    parentThreadId: 'thread_parent_alfred',
    delegation: createDelegation(),
    allowedDelegations: ALLOW_ALFRED_TO_MARIA,
    now: () => DELEGATED_AT,
  });

  assert.equal(result.delegated, true);
  assert.equal(result.status, 'child_job_ready');
  assert.equal(result.authorization.rule.ruleId, 'allow_alfred_to_maria_ask');
  assert.equal(result.childJob.status, 'ready');
  assert.equal(result.childJob.assignedOperationalIdentityId, 'maria');
  assert.equal(result.childJob.createdBy.type, 'process');
  assert.equal(result.childJob.createdBy.id, 'process_parent_alfred');

  const parentProcess = await adapter.loadProcess('process_parent_alfred');
  const parentThread = await adapter.loadThread('thread_parent_alfred');

  assert.equal(parentProcess.status, 'blocked');
  assert.equal(parentProcess.currentThreadId, 'thread_parent_alfred');
  assert.equal(parentThread.status, 'blocked');
  assert.equal(parentThread.waitReason, 'waiting_for_child_process');
  assert.deepEqual(parentProcess.childProcessIds, []);

  const events = await adapter.readEvents({ date: '2026-05-14' });

  assert.deepEqual(
    events.map((event) => event.eventType),
    [
      'delegation.requested',
      'job.created',
      'thread.blocked',
      'process.blocked',
    ],
  );
  assert.equal(events[0].payload.contextRefCount, 1);
  assert.equal(events[0].payload.childJobId, 'job_maria_child_hello');
});

test('delegateToOperationalIdentity drops an unreadable inherited conversation before creating the child Job', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const adapter = createLocalRuntimeAdapter({ projectRootPath });

  await persistConversationSession(projectRootPath, {
    conversationId: 'alfred_admin',
    operationalIdentityIds: ['alfred'],
    allowedOperationalIdentityIds: ['alfred'],
  });
  await persistParentRuntime(adapter);

  const result = await delegateToOperationalIdentity({
    adapter,
    projectRootPath,
    parentProcessId: 'process_parent_alfred',
    parentThreadId: 'thread_parent_alfred',
    delegation: createDelegation(),
    allowedDelegations: ALLOW_ALFRED_TO_MARIA,
    now: () => DELEGATED_AT,
  });

  assert.equal(result.delegated, true);
  assert.equal(result.childJob.conversationId, null);
  assert.equal(result.conversationHandoff.status, 'dropped_unreadable');
  assert.equal(result.conversationHandoff.requestedConversationId, 'alfred_admin');
  assert.equal(result.conversationHandoff.childConversationId, null);
  assert.match(result.conversationHandoff.reason, /maria is not allowed to read conversation alfred_admin/u);

  const events = await adapter.readEvents({ date: '2026-05-14' });
  assert.equal(events[0].payload.conversationHandoff.status, 'dropped_unreadable');
  assert.equal(events[1].payload.conversationId, null);
});

test('delegateToOperationalIdentity retains an explicitly readable child conversation', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const adapter = createLocalRuntimeAdapter({ projectRootPath });

  await persistConversationSession(projectRootPath, {
    conversationId: 'shared_admin',
    operationalIdentityIds: ['alfred', 'maria'],
    allowedOperationalIdentityIds: ['alfred', 'maria'],
  });
  await persistParentRuntime(adapter);

  const result = await delegateToOperationalIdentity({
    adapter,
    projectRootPath,
    parentProcessId: 'process_parent_alfred',
    parentThreadId: 'thread_parent_alfred',
    delegation: createDelegation({
      conversationId: 'shared_admin',
    }),
    allowedDelegations: ALLOW_ALFRED_TO_MARIA,
    now: () => DELEGATED_AT,
  });

  assert.equal(result.delegated, true);
  assert.equal(result.childJob.conversationId, 'shared_admin');
  assert.equal(result.conversationHandoff.status, 'retained_readable');
  assert.equal(result.conversationHandoff.source, 'delegation_request');
  assert.equal(result.conversationHandoff.childConversationId, 'shared_admin');
});

test('delegateToOperationalIdentity fails closed when no explicit delegation rule allows the child Job', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const adapter = createLocalRuntimeAdapter({ projectRootPath });

  await persistParentRuntime(adapter);

  const result = await delegateToOperationalIdentity({
    adapter,
    parentProcessId: 'process_parent_alfred',
    parentThreadId: 'thread_parent_alfred',
    delegation: createDelegation(),
    allowedDelegations: [],
    now: () => DELEGATED_AT,
  });

  assert.equal(result.delegated, false);
  assert.equal(result.status, 'denied');
  assert.equal(result.reason, 'no_delegation_rules');
  await assert.rejects(
    () => adapter.loadJob('job_maria_child_hello'),
    /was not found/u,
  );
  assert.equal((await adapter.loadProcess('process_parent_alfred')).status, 'running');
  assert.equal((await adapter.loadThread('thread_parent_alfred')).status, 'running');

  const events = await adapter.readEvents({ date: '2026-05-14' });

  assert.deepEqual(events.map((event) => event.eventType), ['delegation.denied']);
  assert.equal(events[0].payload.toOperationalIdentityId, 'maria');
});

test('runDelegatedJobNow links the child Process back to the parent and wakes a continuation Thread', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const adapter = createLocalRuntimeAdapter({ projectRootPath });

  await persistParentRuntime(adapter);
  await delegateToOperationalIdentity({
    adapter,
    parentProcessId: 'process_parent_alfred',
    parentThreadId: 'thread_parent_alfred',
    delegation: createDelegation(),
    allowedDelegations: ALLOW_ALFRED_TO_MARIA,
    now: () => DELEGATED_AT,
  });

  const result = await runDelegatedJobNow({
    adapter,
    projectRootPath,
    childJobId: 'job_maria_child_hello',
    parentProcessId: 'process_parent_alfred',
    parentThreadId: 'thread_parent_alfred',
    now: createClock([CHILD_STARTED_AT, CHILD_FINISHED_AT, CHILD_SIGNALED_AT]),
    invocationRunner: async (options) => {
      assert.equal(options.operationalIdentityId, 'maria');
      assert.equal(Object.hasOwn(options, 'agentId'), false);
      assert.equal(options.command, 'ask');
      assert.equal(options.inputText, 'Please say hello to Alfred.');

      return {
        invocationId: 'invocation_maria_child_hello',
        status: 'completed',
        message: 'Maria finished the delegated hello.',
        warnings: [],
        errors: [],
        persistence: null,
      };
    },
  });

  assert.equal(result.childJob.status, 'completed');
  assert.equal(result.childProcess.status, 'completed');
  assert.equal(result.childProcess.parentProcessId, 'process_parent_alfred');
  assert.equal(result.childResultRecord.resultKind, 'delegated_child_result');
  assert.equal(result.childResultRecord.status, 'completed');
  assert.equal(result.childResultRecord.lineage.jobId, 'job_maria_child_hello');
  assert.equal(result.childResultRecord.lineage.processId, result.childProcess.processId);
  assert.equal(result.childResultRecord.lineage.parentProcessId, 'process_parent_alfred');
  assert.equal(result.childResultRecord.summary, 'Maria finished the delegated hello.');
  assert.equal(result.childResultSummary.childStatus, 'completed');
  assert.equal(result.childResultSummary.childResultId, result.childResultRecord.resultId);
  assert.equal(result.childResultSummary.message, 'Maria finished the delegated hello.');
  assert.equal(result.notification.notified, true);
  assert.equal(result.notification.signalResult.signal.signalType, 'child_completed');
  assert.equal(
    result.notification.signalResult.signal.payload.childResultRef,
    result.childResultRecord.resultId,
  );
  assert.equal(
    result.notification.signalResult.signal.payload.childResultSummary.message,
    'Maria finished the delegated hello.',
  );
  assert.deepEqual(await adapter.loadResultRecord(result.childResultRecord.resultId), result.childResultRecord);

  const parentProcess = await adapter.loadProcess('process_parent_alfred');
  const parentWaitThread = await adapter.loadThread('thread_parent_alfred');
  const continuationThread = await adapter.loadThread(parentProcess.currentThreadId);

  assert.equal(parentProcess.status, 'ready');
  assert.deepEqual(parentProcess.childProcessIds, [result.childProcess.processId]);
  assert.equal(parentWaitThread.status, 'completed');
  assert.equal(parentWaitThread.waitReason, null);
  assert.equal(continuationThread.status, 'ready');
  assert.equal(continuationThread.threadType, 'child_process_wait');
  assert.equal(continuationThread.attempt, 2);

  const events = await adapter.readEvents({ date: '2026-05-14' });

  assert.deepEqual(
    events.slice(-5).map((event) => event.eventType),
    [
      'signal.received',
      'thread.completed',
      'thread.created',
      'process.ready',
      'signal.applied',
    ],
  );
});

test('runDelegatedJobAndResumeParentNow resumes Alfred with bounded child evidence and finalizes the parent Job', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const adapter = createLocalRuntimeAdapter({ projectRootPath });

  await persistParentRuntime(adapter);
  await delegateToOperationalIdentity({
    adapter,
    parentProcessId: 'process_parent_alfred',
    parentThreadId: 'thread_parent_alfred',
    delegation: createDelegation(),
    allowedDelegations: ALLOW_ALFRED_TO_MARIA,
    now: () => DELEGATED_AT,
  });

  const result = await runDelegatedJobAndResumeParentNow({
    adapter,
    projectRootPath,
    childJobId: 'job_maria_child_hello',
    parentProcessId: 'process_parent_alfred',
    parentThreadId: 'thread_parent_alfred',
    now: createClock([
      CHILD_STARTED_AT,
      CHILD_FINISHED_AT,
      CHILD_SIGNALED_AT,
      '2026-05-14T10:05:00-05:00',
      '2026-05-14T10:06:00-05:00',
    ]),
    childInvocationRunner: async () => {
      return {
        invocationId: 'invocation_maria_child_hello',
        status: 'completed',
        message: 'Maria finished the delegated hello.',
        warnings: [],
        errors: [],
        persistence: {
          invocationSessionRecordPath: 'instance/memory/state/agent-invocation-maria.json',
          invocationReportPath: 'instance/memory/artifacts/probabilistic-brain-invocation-maria.md',
        },
      };
    },
    parentInvocationRunner: async (options) => {
      assert.equal(options.operationalIdentityId, 'alfred');
      assert.equal(Object.hasOwn(options, 'agentId'), false);
      assert.equal(options.command, 'ask');
      assert.equal(options.requestedBy, 'openmas-os');
      assert.equal(options.conversationRef, 'alfred_admin');
      assert.equal(options.osRuntimeContext.source, 'openmas-os-parent-resume');
      assert.match(options.inputText, /OpenMAS OS parent resume notice/u);
      assert.match(options.inputText, /Child Result ID: result_delegated_child_process_/u);
      assert.match(options.inputText, /Child Status: completed/u);
      assert.match(options.inputText, /Maria finished the delegated hello/u);
      assert.match(options.inputText, /agent-invocation-maria\.json/u);

      return {
        invocationId: 'invocation_alfred_parent_resume',
        status: 'completed',
        message: 'Alfred reported Maria finished the delegated hello with evidence.',
        warnings: [],
        errors: [],
        persistence: {
          invocationSessionRecordPath: 'instance/memory/state/agent-invocation-alfred-resume.json',
          invocationReportPath: 'instance/memory/artifacts/probabilistic-brain-invocation-alfred-resume.md',
        },
      };
    },
  });

  assert.equal(result.status, 'final_answer_completed');
  assert.equal(result.parentResumeResult.kind, 'openmas_os_parent_resume_result');
  assert.equal(result.parentResumeResult.resultRecordId, result.parentResumeResultRecord.resultId);
  assert.equal(result.parentResumeResult.childResultRef, result.childExecution.childResultRecord.resultId);
  assert.equal(result.parentResumeResult.child.message, 'Maria finished the delegated hello.');
  assert.equal(result.parentResumeResult.finalAnswer.message, 'Alfred reported Maria finished the delegated hello with evidence.');
  assert.equal(result.parentResumeResult.evidenceRefs.length, 4);
  assert.equal(result.parentResumeResultRecord.resultKind, 'parent_resume_result');
  assert.equal(result.parentResumeResultRecord.status, 'completed');
  assert.deepEqual(result.parentResumeResultRecord.childResultRefs, [
    result.childExecution.childResultRecord.resultId,
  ]);
  assert.equal(result.parentResumeResultRecord.lineage.processId, 'process_parent_alfred');
  assert.equal(result.parentResumeResultRecord.lineage.invocationId, 'invocation_alfred_parent_resume');
  assert.deepEqual(
    await adapter.loadResultRecord(result.parentResumeResultRecord.resultId),
    result.parentResumeResultRecord,
  );

  const parentProcess = await adapter.loadProcess('process_parent_alfred');
  const parentJob = await adapter.loadJob('job_parent_alfred');
  const completedWaitThread = await adapter.loadThread('thread_parent_alfred');
  const parentContinuationThread = result.parentResume.parentThread;

  assert.equal(parentJob.status, 'completed');
  assert.equal(parentProcess.status, 'completed');
  assert.equal(parentProcess.currentThreadId, null);
  assert.equal(completedWaitThread.status, 'completed');
  assert.equal(parentContinuationThread.status, 'completed');
  assert.equal(parentContinuationThread.threadType, 'child_process_wait');
  assert.ok(parentProcess.artifactRefs.some((artifactRef) => {
    return artifactRef.path.endsWith('agent-invocation-alfred-resume.json');
  }));

  const events = await adapter.readEvents({ date: '2026-05-14' });

  assert.deepEqual(
    events.slice(-5).map((event) => event.eventType),
    [
      'delegation.parent_resume.started',
      'thread.completed',
      'process.completed',
      'job.completed',
      'delegation.parent_resume.completed',
    ],
  );
});

test('runDelegatedJobAndResumeParentNow propagates child warnings through child and parent Result Records', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const adapter = createLocalRuntimeAdapter({ projectRootPath });
  const childWarning = 'Tool memory writeback candidates were disabled by tool policy.';

  await persistParentRuntime(adapter);
  await delegateToOperationalIdentity({
    adapter,
    parentProcessId: 'process_parent_alfred',
    parentThreadId: 'thread_parent_alfred',
    delegation: createDelegation(),
    allowedDelegations: ALLOW_ALFRED_TO_MARIA,
    now: () => DELEGATED_AT,
  });

  const result = await runDelegatedJobAndResumeParentNow({
    adapter,
    projectRootPath,
    childJobId: 'job_maria_child_hello',
    parentProcessId: 'process_parent_alfred',
    parentThreadId: 'thread_parent_alfred',
    now: createClock([
      CHILD_STARTED_AT,
      CHILD_FINISHED_AT,
      CHILD_SIGNALED_AT,
      '2026-05-14T10:05:00-05:00',
      '2026-05-14T10:06:00-05:00',
    ]),
    childInvocationRunner: async () => {
      return {
        invocationId: 'invocation_maria_child_warning',
        status: 'completed',
        message: 'Maria finished the delegated hello with one runtime warning.',
        warnings: [childWarning],
        errors: [],
        persistence: {
          invocationSessionRecordPath: 'instance/memory/state/agent-invocation-maria-warning.json',
          invocationReportPath: 'instance/memory/artifacts/probabilistic-brain-invocation-maria-warning.md',
        },
        verificationGate: {
          status: 'failed',
          verificationOutcome: 'not_verified',
          executionObserved: false,
          reason: 'Runtime evidence did not support the delegated child claim.',
        },
      };
    },
    parentInvocationRunner: async (options) => {
      assert.match(options.inputText, /Child Result ID: result_delegated_child_process_/u);
      assert.match(options.inputText, /Child Result Status: completed_with_warnings/u);
      assert.match(options.inputText, /Tool memory writeback candidates were disabled by tool policy/u);

      return {
        invocationId: 'invocation_alfred_parent_resume_warning',
        status: 'completed',
        message: 'Alfred reported Maria finished with one runtime warning.',
        warnings: [],
        errors: [],
        persistence: null,
      };
    },
  });

  assert.equal(result.status, 'final_answer_completed');
  assert.equal(result.childExecution.childResultRecord.status, 'completed_with_warnings');
  assert.equal(result.childExecution.childResultRecord.warnings[0].message, childWarning);
  assert.equal(result.childExecution.childResultRecord.warnings[0].affectsResultTrust, true);
  assert.equal(result.childExecution.childResultRecord.verification.status, 'failed');
  assert.equal(result.parentResumeResultRecord.status, 'completed_with_warnings');
  assert.deepEqual(result.parentResumeResultRecord.childResultRefs, [
    result.childExecution.childResultRecord.resultId,
  ]);
  assert.equal(result.parentResumeResultRecord.warnings[0].message, childWarning);
  assert.equal(result.parentResumeResultRecord.warnings[0].affectsResultTrust, true);
  assert.equal(result.parentResumeResultRecord.warnings[0].details.reasonCode, 'child_result_warning');
  assert.equal(result.parentResumeResult.child.warningCount, 1);
});

test('runDelegatedJobAndResumeParentNow retries parent resume without conversation writeback when the parent conversation is missing', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const adapter = createLocalRuntimeAdapter({ projectRootPath });
  const parentInvocationCalls = [];

  await persistParentRuntime(adapter);
  await delegateToOperationalIdentity({
    adapter,
    parentProcessId: 'process_parent_alfred',
    parentThreadId: 'thread_parent_alfred',
    delegation: createDelegation(),
    allowedDelegations: ALLOW_ALFRED_TO_MARIA,
    now: () => DELEGATED_AT,
  });

  const result = await runDelegatedJobAndResumeParentNow({
    adapter,
    projectRootPath,
    childJobId: 'job_maria_child_hello',
    parentProcessId: 'process_parent_alfred',
    parentThreadId: 'thread_parent_alfred',
    now: createClock([
      CHILD_STARTED_AT,
      CHILD_FINISHED_AT,
      CHILD_SIGNALED_AT,
      '2026-05-14T10:05:00-05:00',
      '2026-05-14T10:06:00-05:00',
    ]),
    childInvocationRunner: async () => {
      return {
        invocationId: 'invocation_maria_child_hello',
        status: 'completed',
        message: 'Maria finished the delegated hello.',
        warnings: [],
        errors: [],
        persistence: null,
      };
    },
    parentInvocationRunner: async (options) => {
      parentInvocationCalls.push(options);

      if (parentInvocationCalls.length === 1) {
        assert.equal(options.conversationRef, 'alfred_admin');
        throw new Error('Conversation not found: alfred_admin. Create it first with --create-conversation alfred_admin.');
      }

      assert.equal(options.conversationRef, undefined);
      assert.match(options.inputText, /Parent Resume Runtime Notice/u);
      assert.match(options.inputText, /Requested parent conversation "alfred_admin" was unavailable/u);
      assert.equal(
        options.osRuntimeContext.parentResumeConversationFallback.reasonCode,
        'parent_conversation_missing',
      );
      assert.equal(
        options.osRuntimeContext.parentResumeConversationFallback.missingConversationId,
        'alfred_admin',
      );

      return {
        invocationId: 'invocation_alfred_parent_resume_without_conversation',
        status: 'completed',
        message: 'Alfred reported Maria finished without conversation writeback.',
        warnings: [],
        errors: [],
        persistence: null,
      };
    },
  });

  assert.equal(parentInvocationCalls.length, 2);
  assert.equal(result.status, 'final_answer_completed');
  assert.equal(result.parentResumeResult.finalAnswer.message, 'Alfred reported Maria finished without conversation writeback.');
  assert.match(
    result.parentResume.invocationResult.warnings[0],
    /parent resume conversation alfred_admin was unavailable/u,
  );

  const parentProcess = await adapter.loadProcess('process_parent_alfred');
  const parentJob = await adapter.loadJob('job_parent_alfred');
  const parentContinuationThread = result.parentResume.parentThread;

  assert.equal(parentJob.status, 'completed');
  assert.equal(parentProcess.status, 'completed');
  assert.equal(parentContinuationThread.status, 'completed');
  assert.match(
    parentProcess.warnings[0],
    /parent resume conversation alfred_admin was unavailable/u,
  );
});

test('runDelegatedJobAndResumeParentNow retries parent resume when the invocation result reports a missing conversation', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const adapter = createLocalRuntimeAdapter({ projectRootPath });
  const parentInvocationCalls = [];

  await persistParentRuntime(adapter);
  await delegateToOperationalIdentity({
    adapter,
    parentProcessId: 'process_parent_alfred',
    parentThreadId: 'thread_parent_alfred',
    delegation: createDelegation(),
    allowedDelegations: ALLOW_ALFRED_TO_MARIA,
    now: () => DELEGATED_AT,
  });

  const result = await runDelegatedJobAndResumeParentNow({
    adapter,
    projectRootPath,
    childJobId: 'job_maria_child_hello',
    parentProcessId: 'process_parent_alfred',
    parentThreadId: 'thread_parent_alfred',
    now: createClock([
      CHILD_STARTED_AT,
      CHILD_FINISHED_AT,
      CHILD_SIGNALED_AT,
      '2026-05-14T10:05:00-05:00',
      '2026-05-14T10:06:00-05:00',
    ]),
    childInvocationRunner: async () => {
      return {
        invocationId: 'invocation_maria_child_hello',
        status: 'completed',
        message: 'Maria finished the delegated hello.',
        warnings: [],
        errors: [],
        persistence: null,
      };
    },
    parentInvocationRunner: async (options) => {
      parentInvocationCalls.push(options);

      if (parentInvocationCalls.length === 1) {
        assert.equal(options.conversationRef, 'alfred_admin');

        return {
          invocationId: 'invocation_alfred_parent_resume_missing_conversation',
          status: 'failed',
          message: 'Conversation not found: alfred_admin. Create it first with --create-conversation alfred_admin.',
          warnings: [],
          errors: ['Conversation not found: alfred_admin. Create it first with --create-conversation alfred_admin.'],
          persistence: null,
        };
      }

      assert.equal(options.conversationRef, undefined);
      assert.match(options.inputText, /Parent Resume Runtime Notice/u);

      return {
        invocationId: 'invocation_alfred_parent_resume_after_failed_result',
        status: 'completed',
        message: 'Alfred completed parent resume after missing conversation fallback.',
        warnings: [],
        errors: [],
        persistence: null,
      };
    },
  });

  assert.equal(parentInvocationCalls.length, 2);
  assert.equal(result.status, 'final_answer_completed');
  assert.equal(result.parentResume.parentJob.status, 'completed');
  assert.equal(result.parentResume.parentProcess.status, 'completed');
  assert.match(
    result.parentResume.invocationResult.warnings[0],
    /parent resume conversation alfred_admin was unavailable/u,
  );
});

test('runDelegatedJobAndResumeParentNow lets Alfred report a failed child without fabricating success', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const adapter = createLocalRuntimeAdapter({ projectRootPath });

  await persistParentRuntime(adapter);
  await delegateToOperationalIdentity({
    adapter,
    parentProcessId: 'process_parent_alfred',
    parentThreadId: 'thread_parent_alfred',
    delegation: createDelegation({
      childJobId: 'job_maria_child_failure',
    }),
    allowedDelegations: ALLOW_ALFRED_TO_MARIA,
    now: () => DELEGATED_AT,
  });

  const result = await runDelegatedJobAndResumeParentNow({
    adapter,
    projectRootPath,
    childJobId: 'job_maria_child_failure',
    parentProcessId: 'process_parent_alfred',
    parentThreadId: 'thread_parent_alfred',
    now: createClock([
      CHILD_STARTED_AT,
      CHILD_FINISHED_AT,
      CHILD_SIGNALED_AT,
      '2026-05-14T10:05:00-05:00',
      '2026-05-14T10:06:00-05:00',
    ]),
    childInvocationRunner: async () => {
      return {
        invocationId: 'invocation_maria_child_failure',
        status: 'failed',
        message: 'Maria could not complete the delegated task.',
        warnings: [],
        errors: ['missing_resource'],
        persistence: null,
      };
    },
    parentInvocationRunner: async (options) => {
      assert.match(options.inputText, /Child Status: failed/u);
      assert.match(options.inputText, /Maria could not complete/u);
      assert.match(options.inputText, /missing_resource/u);

      return {
        invocationId: 'invocation_alfred_parent_resume_failure',
        status: 'completed',
        message: 'Alfred reported that Maria failed with missing_resource evidence.',
        warnings: [],
        errors: [],
        persistence: null,
      };
    },
  });

  assert.equal(result.childExecution.notification.signalResult.signal.signalType, 'child_failed');
  assert.equal(
    result.childExecution.notification.signalResult.signal.payload.childResultRef,
    result.childExecution.childResultRecord.resultId,
  );
  assert.equal(result.childExecution.childResultRecord.status, 'failed');
  assert.equal(result.childExecution.childResultRecord.failure.reasonCode, 'invocation_failed');
  assert.equal(result.parentResumeResult.child.childStatus, 'failed');
  assert.equal(result.parentResumeResultRecord.status, 'completed_with_warnings');
  assert.deepEqual(result.parentResumeResultRecord.childResultRefs, [
    result.childExecution.childResultRecord.resultId,
  ]);
  assert.equal(result.parentResumeResultRecord.warnings[0].details.reasonCode, 'child_result_failed');
  assert.equal(result.parentResumeResult.finalAnswer.message, 'Alfred reported that Maria failed with missing_resource evidence.');
  assert.equal((await adapter.loadProcess('process_parent_alfred')).status, 'completed');
});

test('runDelegatedJobNow wakes the parent with child_failed when the child Process fails', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const adapter = createLocalRuntimeAdapter({ projectRootPath });

  await persistParentRuntime(adapter);
  await delegateToOperationalIdentity({
    adapter,
    parentProcessId: 'process_parent_alfred',
    parentThreadId: 'thread_parent_alfred',
    delegation: createDelegation({
      childJobId: 'job_maria_child_failure',
    }),
    allowedDelegations: ALLOW_ALFRED_TO_MARIA,
    now: () => DELEGATED_AT,
  });

  const result = await runDelegatedJobNow({
    adapter,
    projectRootPath,
    childJobId: 'job_maria_child_failure',
    parentProcessId: 'process_parent_alfred',
    parentThreadId: 'thread_parent_alfred',
    now: createClock([CHILD_STARTED_AT, CHILD_FINISHED_AT, CHILD_SIGNALED_AT]),
    invocationRunner: async () => {
      return {
        invocationId: 'invocation_maria_child_failure',
        status: 'failed',
        message: 'Maria could not complete the delegated task.',
        warnings: [],
        errors: ['missing_resource'],
        persistence: null,
      };
    },
  });

  assert.equal(result.childProcess.status, 'failed');
  assert.equal(result.notification.notified, true);
  assert.equal(result.notification.signalResult.signal.signalType, 'child_failed');
  assert.equal((await adapter.loadProcess('process_parent_alfred')).status, 'ready');
});

test('delegateToOperationalIdentity rejects unsafe raw secret-like delegation payloads before creating child state', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const adapter = createLocalRuntimeAdapter({ projectRootPath });

  await persistParentRuntime(adapter);

  await assert.rejects(
    () => delegateToOperationalIdentity({
      adapter,
      parentProcessId: 'process_parent_alfred',
      parentThreadId: 'thread_parent_alfred',
      delegation: createDelegation({
        inputRef: {
          type: 'inline_text',
          text: `Use ${buildFakeOpenRouterSecretProbe('secretvalue1234567890')} for this request.`,
        },
      }),
      allowedDelegations: ALLOW_ALFRED_TO_MARIA,
      now: () => DELEGATED_AT,
    }),
    /secret-like value/u,
  );

  await assert.rejects(
    () => adapter.loadJob('job_maria_child_hello'),
    /was not found/u,
  );
  assert.equal((await adapter.loadProcess('process_parent_alfred')).status, 'running');
  assert.deepEqual(await adapter.readEvents({ date: '2026-05-14' }), []);
});

test('stress: a blocked parent cannot accept another child delegation until it resumes', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const adapter = createLocalRuntimeAdapter({ projectRootPath });

  await persistParentRuntime(adapter);
  await delegateToOperationalIdentity({
    adapter,
    parentProcessId: 'process_parent_alfred',
    parentThreadId: 'thread_parent_alfred',
    delegation: createDelegation(),
    allowedDelegations: ALLOW_ALFRED_TO_MARIA,
    now: () => DELEGATED_AT,
  });

  await assert.rejects(
    () => delegateToOperationalIdentity({
      adapter,
      parentProcessId: 'process_parent_alfred',
      parentThreadId: 'thread_parent_alfred',
      delegation: createDelegation({
        delegationId: 'delegation_alfred_to_maria_second',
        childJobId: 'job_maria_child_second',
      }),
      allowedDelegations: ALLOW_ALFRED_TO_MARIA,
      now: () => '2026-05-14T10:01:30-05:00',
    }),
    /must be running before delegation/u,
  );

  assert.equal((await adapter.loadProcess('process_parent_alfred')).status, 'blocked');
  await assert.rejects(
    () => adapter.loadJob('job_maria_child_second'),
    /was not found/u,
  );
});

test('stress: concurrent delegation requests against one parent serialize and create only one child Job', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const adapter = createLocalRuntimeAdapter({ projectRootPath });

  await persistParentRuntime(adapter);

  const results = await Promise.allSettled([
    delegateToOperationalIdentity({
      adapter,
      parentProcessId: 'process_parent_alfred',
      parentThreadId: 'thread_parent_alfred',
      delegation: createDelegation({
        delegationId: 'delegation_alfred_to_maria_concurrent_a',
        childJobId: 'job_maria_child_concurrent_a',
      }),
      allowedDelegations: ALLOW_ALFRED_TO_MARIA,
      now: () => DELEGATED_AT,
    }),
    delegateToOperationalIdentity({
      adapter,
      parentProcessId: 'process_parent_alfred',
      parentThreadId: 'thread_parent_alfred',
      delegation: createDelegation({
        delegationId: 'delegation_alfred_to_maria_concurrent_b',
        childJobId: 'job_maria_child_concurrent_b',
      }),
      allowedDelegations: ALLOW_ALFRED_TO_MARIA,
      now: () => '2026-05-14T10:01:30-05:00',
    }),
  ]);

  const successfulDelegations = results
    .filter((result) => result.status === 'fulfilled')
    .map((result) => result.value)
    .filter((result) => result.delegated);
  const rejectedDelegations = results.filter((result) => result.status === 'rejected');
  const childJobs = (await adapter.listJobs())
    .filter((job) => job.assignedOperationalIdentityId === 'maria');

  assert.equal(successfulDelegations.length, 1);
  assert.equal(rejectedDelegations.length, 1);
  assert.match(rejectedDelegations[0].reason.message, /must be running before delegation/u);
  assert.equal(childJobs.length, 1);
  assert.equal((await adapter.loadProcess('process_parent_alfred')).status, 'blocked');
});

test('stress: a delegated child Job cannot be executed twice after it reaches a terminal state', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const adapter = createLocalRuntimeAdapter({ projectRootPath });

  await persistParentRuntime(adapter);
  await delegateToOperationalIdentity({
    adapter,
    parentProcessId: 'process_parent_alfred',
    parentThreadId: 'thread_parent_alfred',
    delegation: createDelegation(),
    allowedDelegations: ALLOW_ALFRED_TO_MARIA,
    now: () => DELEGATED_AT,
  });

  await runDelegatedJobNow({
    adapter,
    projectRootPath,
    childJobId: 'job_maria_child_hello',
    parentProcessId: 'process_parent_alfred',
    parentThreadId: 'thread_parent_alfred',
    now: createClock([CHILD_STARTED_AT, CHILD_FINISHED_AT, CHILD_SIGNALED_AT]),
    invocationRunner: async () => {
      return {
        invocationId: 'invocation_maria_child_once',
        status: 'completed',
        message: 'Maria completed once.',
        warnings: [],
        errors: [],
        persistence: null,
      };
    },
  });

  await assert.rejects(
    () => runDelegatedJobNow({
      adapter,
      projectRootPath,
      childJobId: 'job_maria_child_hello',
      parentProcessId: 'process_parent_alfred',
      parentThreadId: 'thread_parent_alfred',
      now: createClock([
        '2026-05-14T10:05:00-05:00',
        '2026-05-14T10:06:00-05:00',
        '2026-05-14T10:07:00-05:00',
      ]),
      invocationRunner: async () => {
        throw new Error('must_not_execute_twice');
      },
    }),
    /must be ready before runJobNow/u,
  );
});

test('stress: duplicate child completion notification is ignored after the parent is already ready', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const adapter = createLocalRuntimeAdapter({ projectRootPath });

  await persistParentRuntime(adapter);
  await delegateToOperationalIdentity({
    adapter,
    parentProcessId: 'process_parent_alfred',
    parentThreadId: 'thread_parent_alfred',
    delegation: createDelegation(),
    allowedDelegations: ALLOW_ALFRED_TO_MARIA,
    now: () => DELEGATED_AT,
  });

  const childExecution = await runDelegatedJobNow({
    adapter,
    projectRootPath,
    childJobId: 'job_maria_child_hello',
    parentProcessId: 'process_parent_alfred',
    parentThreadId: 'thread_parent_alfred',
    now: createClock([CHILD_STARTED_AT, CHILD_FINISHED_AT, CHILD_SIGNALED_AT]),
    invocationRunner: async () => {
      return {
        invocationId: 'invocation_maria_child_signal_once',
        status: 'completed',
        message: 'Maria completed once.',
        warnings: [],
        errors: [],
        persistence: null,
      };
    },
  });

  const firstReadyParent = await adapter.loadProcess('process_parent_alfred');
  const duplicateNotification = await notifyDelegatedChildCompletion({
    adapter,
    projectRootPath,
    childProcessId: childExecution.childProcess.processId,
    parentThreadId: 'thread_parent_alfred',
    now: () => '2026-05-14T10:05:00-05:00',
  });
  const secondReadyParent = await adapter.loadProcess('process_parent_alfred');

  assert.equal(duplicateNotification.notified, false);
  assert.equal(duplicateNotification.status, 'ignored');
  assert.equal(duplicateNotification.signalResult.reason, 'process_not_waiting_for_child');
  assert.equal(secondReadyParent.currentThreadId, firstReadyParent.currentThreadId);
  assert.deepEqual(secondReadyParent.childProcessIds, [childExecution.childProcess.processId]);
});

test('stress: parent resume rejects a stale original wait Thread after the OS creates a continuation Thread', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const adapter = createLocalRuntimeAdapter({ projectRootPath });

  await persistParentRuntime(adapter);
  await delegateToOperationalIdentity({
    adapter,
    parentProcessId: 'process_parent_alfred',
    parentThreadId: 'thread_parent_alfred',
    delegation: createDelegation(),
    allowedDelegations: ALLOW_ALFRED_TO_MARIA,
    now: () => DELEGATED_AT,
  });

  const childExecution = await runDelegatedJobNow({
    adapter,
    projectRootPath,
    childJobId: 'job_maria_child_hello',
    parentProcessId: 'process_parent_alfred',
    parentThreadId: 'thread_parent_alfred',
    now: createClock([CHILD_STARTED_AT, CHILD_FINISHED_AT, CHILD_SIGNALED_AT]),
    invocationRunner: async () => {
      return {
        invocationId: 'invocation_maria_child_for_stale_thread',
        status: 'completed',
        message: 'Maria completed for stale thread test.',
        warnings: [],
        errors: [],
        persistence: null,
      };
    },
  });

  await assert.rejects(
    () => resumeParentAfterDelegatedChild({
      adapter,
      projectRootPath,
      parentProcessId: 'process_parent_alfred',
      continuationThreadId: 'thread_parent_alfred',
      childExecution,
      childResultSummary: childExecution.childResultSummary,
      now: createClock([
        '2026-05-14T10:05:00-05:00',
        '2026-05-14T10:06:00-05:00',
      ]),
      invocationRunner: async () => {
        throw new Error('must_not_resume_from_stale_thread');
      },
    }),
    /must be a ready child_process_wait Thread before resume/u,
  );

  assert.equal((await adapter.loadProcess('process_parent_alfred')).status, 'ready');
});

test('stress: concurrent parent resume attempts serialize and execute the parent invocation once', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const adapter = createLocalRuntimeAdapter({ projectRootPath });

  await persistParentRuntime(adapter);
  await delegateToOperationalIdentity({
    adapter,
    parentProcessId: 'process_parent_alfred',
    parentThreadId: 'thread_parent_alfred',
    delegation: createDelegation(),
    allowedDelegations: ALLOW_ALFRED_TO_MARIA,
    now: () => DELEGATED_AT,
  });

  const childExecution = await runDelegatedJobNow({
    adapter,
    projectRootPath,
    childJobId: 'job_maria_child_hello',
    parentProcessId: 'process_parent_alfred',
    parentThreadId: 'thread_parent_alfred',
    now: createClock([CHILD_STARTED_AT, CHILD_FINISHED_AT, CHILD_SIGNALED_AT]),
    invocationRunner: async () => {
      return {
        invocationId: 'invocation_maria_child_for_parent_resume_race',
        status: 'completed',
        message: 'Maria completed for parent resume race test.',
        warnings: [],
        errors: [],
        persistence: null,
      };
    },
  });

  const continuationThreadId = childExecution.notification.signalResult.continuationThread.threadId;
  let parentInvocationCalls = 0;
  const attempts = await Promise.allSettled(Array.from({ length: 8 }, (_, index) => {
    return resumeParentAfterDelegatedChild({
      adapter,
      projectRootPath,
      parentProcessId: 'process_parent_alfred',
      continuationThreadId,
      childExecution,
      childResultSummary: childExecution.childResultSummary,
      now: createClock([
        `2026-05-14T10:05:0${index}-05:00`,
        `2026-05-14T10:06:0${index}-05:00`,
      ]),
      invocationRunner: async () => {
        parentInvocationCalls += 1;
        await new Promise((resolve) => {
          setTimeout(resolve, 10);
        });

        return {
          invocationId: `invocation_alfred_parent_resume_race_${index}`,
          status: 'completed',
          message: `Alfred completed parent resume race attempt ${index}.`,
          warnings: [],
          errors: [],
          persistence: null,
        };
      },
    });
  }));
  const fulfilled = attempts.filter((attempt) => attempt.status === 'fulfilled');
  const rejected = attempts.filter((attempt) => attempt.status === 'rejected');
  const parentResumeRecords = (await adapter.listResultRecords({})).filter((resultRecord) => {
    return resultRecord.resultKind === 'parent_resume_result';
  });

  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 7);
  assert.equal(parentInvocationCalls, 1);
  assert.equal(parentResumeRecords.length, 1);
  assert.deepEqual(parentResumeRecords[0].childResultRefs, [
    childExecution.childResultRecord.resultId,
  ]);
  assert.ok(rejected.every((attempt) => {
    return /must be ready before resume/u.test(attempt.reason.message);
  }));
});

test('stress: many independent child delegations resume their own parents without state cross-talk', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const adapter = createLocalRuntimeAdapter({ projectRootPath });
  const parentCount = 25;

  for (let index = 0; index < parentCount; index += 1) {
    const suffix = String(index).padStart(2, '0');
    const jobId = `job_parent_alfred_${suffix}`;
    const processId = `process_parent_alfred_${suffix}`;
    const threadId = `thread_parent_alfred_${suffix}`;
    const childJobId = `job_maria_child_${suffix}`;

    await persistParentRuntime(adapter, {
      job: {
        jobId,
        conversationId: null,
      },
      process: {
        processId,
        jobId,
        currentThreadId: threadId,
        conversationId: null,
      },
      thread: {
        threadId,
        processId,
        jobId,
      },
    });
    await delegateToOperationalIdentity({
      adapter,
      projectRootPath,
      parentProcessId: processId,
      parentThreadId: threadId,
      delegation: createDelegation({
        delegationId: `delegation_alfred_to_maria_${suffix}`,
        childJobId,
        inputRef: {
          type: 'inline_text',
          text: `Please complete delegated batch item ${suffix}.`,
        },
      }),
      allowedDelegations: ALLOW_ALFRED_TO_MARIA,
      now: () => DELEGATED_AT,
    });

    const result = await runDelegatedJobAndResumeParentNow({
      adapter,
      projectRootPath,
      childJobId,
      parentProcessId: processId,
      parentThreadId: threadId,
      now: createClock([
        CHILD_STARTED_AT,
        CHILD_FINISHED_AT,
        CHILD_SIGNALED_AT,
        '2026-05-14T10:05:00-05:00',
        '2026-05-14T10:06:00-05:00',
      ]),
      childInvocationRunner: async (options) => {
        assert.equal(options.operationalIdentityId, 'maria');
        assert.equal(options.inputText, `Please complete delegated batch item ${suffix}.`);

        return {
          invocationId: `invocation_maria_child_${suffix}`,
          status: 'completed',
          message: `Maria completed batch item ${suffix}.`,
          warnings: [],
          errors: [],
          persistence: null,
        };
      },
      parentInvocationRunner: async (options) => {
        assert.equal(options.operationalIdentityId, 'alfred');
        assert.ok(options.inputText.includes(`Maria completed batch item ${suffix}.`));

        return {
          invocationId: `invocation_alfred_parent_resume_${suffix}`,
          status: 'completed',
          message: `Alfred closed batch item ${suffix}.`,
          warnings: [],
          errors: [],
          persistence: null,
        };
      },
    });

    assert.equal(result.status, 'final_answer_completed');
    assert.equal(result.parentResumeResult.child.childJobId, childJobId);
    assert.equal(result.parentResumeResult.finalAnswer.invocationId, `invocation_alfred_parent_resume_${suffix}`);
  }

  const jobs = await adapter.listJobs();
  const processes = await adapter.listProcesses();
  const threads = await adapter.listThreads();

  assert.equal(jobs.length, parentCount * 2);
  assert.equal(jobs.filter((job) => job.status === 'completed').length, parentCount * 2);
  assert.equal(processes.filter((processState) => processState.status === 'completed').length, parentCount * 2);
  assert.equal(threads.filter((thread) => thread.status === 'completed').length, parentCount * 3);

  for (let index = 0; index < parentCount; index += 1) {
    const suffix = String(index).padStart(2, '0');
    const parentProcess = await adapter.loadProcess(`process_parent_alfred_${suffix}`);

    assert.equal(parentProcess.childProcessIds.length, 1);
    assert.match(parentProcess.childProcessIds[0], /^process_/u);
  }
});
