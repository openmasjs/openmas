import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {
  access,
  mkdir,
  mkdtemp,
  unlink,
  writeFile,
} from 'node:fs/promises';
import {
  OPENMAS_OS_SYSTEM_CALL_KINDS,
} from '../../src/contracts/os/openmas-os-system-call-contract.js';
import { OPENMAS_OS_KINDS } from '../../src/contracts/os/openmas-os-runtime-contract.js';
import { createLocalRuntimeAdapter } from '../../src/os/adapters/local-runtime-adapter.js';
import { createLocalSystemCallInbox } from '../../src/os/system-calls/local-system-call-inbox.js';
import {
  createKernelSystemCallProcessor,
  reconcileTerminalDelegationSystemCallCallers,
} from '../../src/os/system-calls/system-call-processor.js';

const CREATED_AT = '2026-05-19T09:00:00-05:00';
const PROCESSED_AT = '2026-05-19T09:05:00-05:00';
const RUN_AT = '2026-05-19T18:00:00-05:00';

async function createTemporaryProjectRoot() {
  return mkdtemp(path.join(os.tmpdir(), 'openmas-system-call-processor-'));
}

async function assertFileExists(filePath) {
  await access(filePath);
}

async function assertFileMissing(filePath) {
  await assert.rejects(
    () => access(filePath),
    { code: 'ENOENT' },
  );
}

function createDelegationPolicy(overrides = {}) {
  return {
    kind: 'openmas_delegation_policy',
    version: 1,
    defaultEffect: 'deny',
    rules: [
      {
        ruleId: 'allow-alfred-to-bruce-probabilistic-ask',
        effect: 'allow',
        fromOperationalIdentityId: 'alfred',
        toOperationalIdentityId: 'bruce',
        actionTypes: ['delegate', 'schedule_delegation'],
        commands: ['ask'],
        modes: ['probabilistic'],
      },
    ],
    ...overrides,
  };
}

function createParentJob(overrides = {}) {
  return {
    kind: OPENMAS_OS_KINDS.job,
    schemaVersion: 1,
    jobId: 'job_parent_alfred',
    projectId: 'project_openmas',
    status: 'active',
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
      text: 'Coordinate with Bruce.',
    },
    conversationId: 'alfred-admin',
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
    conversationId: 'alfred-admin',
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

function createSystemCall(overrides = {}) {
  return {
    kind: OPENMAS_OS_SYSTEM_CALL_KINDS.systemCall,
    schemaVersion: 1,
    systemCallId: 'syscall_delegate_001',
    operation: 'delegate',
    status: 'pending',
    requestedAt: CREATED_AT,
    requestedBy: {
      type: 'operational_identity',
      operationalIdentityId: 'alfred',
    },
    correlation: {
      invocationId: 'agent-invocation-001',
      processId: 'process_parent_alfred',
      threadId: 'thread_parent_alfred',
      conversationId: 'alfred-admin',
    },
    idempotencyKey: 'delegate:alfred:bruce:001',
    expiresAt: '2026-05-19T09:30:00-05:00',
    payload: {
      requesterOperationalIdentityId: 'alfred',
      targetOperationalIdentityId: 'bruce',
      reason: 'Bruce is the evaluation specialist.',
      child: {
        input: 'Inspect the MAS and report findings.',
        command: 'ask',
        mode: 'probabilistic',
        conversationId: null,
      },
    },
    ...overrides,
  };
}

function createScheduleDelegationSystemCall(overrides = {}) {
  return createSystemCall({
    systemCallId: 'syscall_schedule_delegation_001',
    operation: 'schedule_delegation',
    idempotencyKey: 'schedule_delegation:alfred:bruce:001',
    payload: {
      requesterOperationalIdentityId: 'alfred',
      targetOperationalIdentityId: 'bruce',
      runAt: RUN_AT,
      missedRunPolicy: 'delay',
      child: {
        input: 'Inspect the MAS and report findings.',
        command: 'ask',
        mode: 'probabilistic',
      },
    },
    ...overrides,
  });
}

async function createProcessorFixture({
  persistParent = true,
  delegationPolicy = createDelegationPolicy(),
  delegationTargetReadinessEvaluator = undefined,
} = {}) {
  const projectRootPath = await createTemporaryProjectRoot();
  const adapter = createLocalRuntimeAdapter({ projectRootPath });
  const inbox = createLocalSystemCallInbox({ projectRootPath });

  if (persistParent) {
    await adapter.persistJob(createParentJob());
    await adapter.persistProcess(createParentProcess());
    await adapter.persistThread(createParentThread());
  }

  const processor = createKernelSystemCallProcessor({
    projectRootPath,
    adapter,
    inbox,
    delegationPolicy,
    delegationTargetReadinessEvaluator,
    now: () => PROCESSED_AT,
    serviceId: 'openmas_os_service_test',
    tickId: 'os_service_tick_test',
  });

  return {
    projectRootPath,
    adapter,
    inbox,
    processor,
  };
}

test('KernelSystemCallProcessor processes allowed delegate calls and materializes one child Job', async () => {
  const {
    projectRootPath,
    adapter,
    inbox,
    processor,
  } = await createProcessorFixture();

  await inbox.submitSystemCall(createSystemCall());

  const processorResult = await processor.processPendingSystemCalls();
  const result = await inbox.loadSystemCallResult('syscall_delegate_001');
  const childJob = await adapter.loadJob('job_syscall_delegate_001');
  const parentProcess = await adapter.loadProcess('process_parent_alfred');
  const parentThread = await adapter.loadThread('thread_parent_alfred');
  const submissionResult = await adapter.loadResultRecord('result_delegation_submission_syscall_delegate_001');

  assert.equal(processorResult.processedCount, 1);
  assert.equal(processorResult.completedCount, 1);
  assert.equal(result.status, 'completed');
  assert.equal(result.decision.allowed, true);
  assert.deepEqual(result.effects.createdJobIds, ['job_syscall_delegate_001']);
  assert.equal(result.details.authorizationRuleId, 'allow-alfred-to-bruce-probabilistic-ask');
  assert.equal(childJob.status, 'ready');
  assert.equal(childJob.assignedOperationalIdentityId, 'bruce');
  assert.equal(childJob.inputRef.text, 'Inspect the MAS and report findings.');
  assert.equal(parentProcess.status, 'blocked');
  assert.equal(parentThread.status, 'blocked');
  assert.equal(parentThread.waitReason, 'waiting_for_child_process');
  assert.equal(submissionResult.resultKind, 'delegation_submission_result');
  assert.equal(submissionResult.status, 'accepted');
  assert.equal(submissionResult.phase, 'submission');
  assert.equal(submissionResult.producer.type, 'system_call');
  assert.equal(submissionResult.producer.id, 'syscall_delegate_001');
  assert.equal(submissionResult.lineage.systemCallId, 'syscall_delegate_001');
  assert.equal(submissionResult.lineage.jobId, 'job_syscall_delegate_001');
  assert.equal(submissionResult.lineage.parentProcessId, 'process_parent_alfred');
  assert.equal(submissionResult.lineage.parentThreadId, 'thread_parent_alfred');
  assert.deepEqual(submissionResult.childResultRefs, []);
  assert.equal(submissionResult.metadata.delegation.childJobId, 'job_syscall_delegate_001');
  assert.equal(submissionResult.metadata.parent.waitMode, 'wait_for_child_process');
  assert.equal(submissionResult.metadata.delivery.childCompletionProven, false);
  await assertFileMissing(path.join(projectRootPath, 'instance', 'os', 'system-calls', 'pending', 'syscall_delegate_001.json'));
  await assertFileExists(path.join(projectRootPath, 'instance', 'os', 'system-calls', 'completed', 'syscall_delegate_001.json'));
});

test('KernelSystemCallProcessor completes delegate calls from a parent blocked on the syscall trap', async () => {
  const {
    adapter,
    inbox,
    processor,
  } = await createProcessorFixture();
  const parentProcess = await adapter.loadProcess('process_parent_alfred');
  const parentThread = await adapter.loadThread('thread_parent_alfred');

  await adapter.persistThread({
    ...parentThread,
    status: 'blocked',
    waitReason: 'waiting_for_system_call',
    updatedAt: CREATED_AT,
  });
  await adapter.persistProcess({
    ...parentProcess,
    status: 'blocked',
    updatedAt: CREATED_AT,
  });
  await inbox.submitSystemCall(createSystemCall({
    systemCallId: 'syscall_delegate_waiting_parent_001',
    idempotencyKey: 'delegate:alfred:bruce:waiting-parent:001',
  }));

  const processorResult = await processor.processPendingSystemCalls();
  const result = await inbox.loadSystemCallResult('syscall_delegate_waiting_parent_001');
  const childJob = await adapter.loadJob('job_syscall_delegate_waiting_parent_001');
  const blockedParentThread = await adapter.loadThread('thread_parent_alfred');

  assert.equal(processorResult.completedCount, 1);
  assert.equal(result.status, 'completed');
  assert.equal(childJob.status, 'ready');
  assert.equal(blockedParentThread.status, 'blocked');
  assert.equal(blockedParentThread.waitReason, 'waiting_for_child_process');
});

test('KernelSystemCallProcessor terminalizes a syscall-trapped parent when delegation is denied', async () => {
  const {
    adapter,
    inbox,
    processor,
  } = await createProcessorFixture();
  const parentProcess = await adapter.loadProcess('process_parent_alfred');
  const parentThread = await adapter.loadThread('thread_parent_alfred');

  await adapter.persistThread({
    ...parentThread,
    status: 'blocked',
    waitReason: 'waiting_for_system_call',
    updatedAt: CREATED_AT,
  });
  await adapter.persistProcess({
    ...parentProcess,
    status: 'blocked',
    updatedAt: CREATED_AT,
  });
  await inbox.submitSystemCall(createSystemCall({
    systemCallId: 'syscall_delegate_waiting_parent_denied_001',
    idempotencyKey: 'delegate:alfred:maria:waiting-parent-denied:001',
    payload: {
      requesterOperationalIdentityId: 'alfred',
      targetOperationalIdentityId: 'maria',
      child: {
        input: 'Inspect the MAS and report findings.',
        command: 'ask',
        mode: 'probabilistic',
      },
    },
  }));

  const processorResult = await processor.processPendingSystemCalls();
  const failedJob = await adapter.loadJob('job_parent_alfred');
  const failedProcess = await adapter.loadProcess('process_parent_alfred');
  const failedThread = await adapter.loadThread('thread_parent_alfred');
  const result = await inbox.loadSystemCallResult('syscall_delegate_waiting_parent_denied_001');

  assert.equal(processorResult.deniedCount, 1);
  assert.equal(processorResult.results[0].callerSettlement.status, 'terminalized');
  assert.equal(result.status, 'denied');
  assert.equal(failedJob.status, 'failed');
  assert.equal(failedProcess.status, 'failed');
  assert.equal(failedProcess.currentThreadId, null);
  assert.equal(failedThread.status, 'failed');
  assert.equal(failedThread.waitReason, null);
  assert.equal(failedThread.failureSummary.reasonCode, 'terminal_delegation_system_call_failed');
});

test('KernelSystemCallProcessor terminalizes a syscall-trapped parent when delegation expires', async () => {
  const {
    adapter,
    inbox,
    processor,
  } = await createProcessorFixture();
  const parentProcess = await adapter.loadProcess('process_parent_alfred');
  const parentThread = await adapter.loadThread('thread_parent_alfred');

  await adapter.persistThread({
    ...parentThread,
    status: 'blocked',
    waitReason: 'waiting_for_system_call',
    updatedAt: CREATED_AT,
  });
  await adapter.persistProcess({
    ...parentProcess,
    status: 'blocked',
    updatedAt: CREATED_AT,
  });
  await inbox.submitSystemCall(createSystemCall({
    systemCallId: 'syscall_delegate_waiting_parent_expired_001',
    idempotencyKey: 'delegate:alfred:bruce:waiting-parent-expired:001',
    expiresAt: '2026-05-19T09:01:00-05:00',
  }));

  const processorResult = await processor.processPendingSystemCalls();
  const failedProcess = await adapter.loadProcess('process_parent_alfred');
  const failedThread = await adapter.loadThread('thread_parent_alfred');

  assert.equal(processorResult.expiredCount, 1);
  assert.equal(processorResult.results[0].callerSettlement.status, 'terminalized');
  assert.equal(failedProcess.status, 'failed');
  assert.equal(failedThread.status, 'failed');
  assert.equal(failedThread.failureSummary.reasonCode, 'terminal_delegation_system_call_failed');
});

test('reconcileTerminalDelegationSystemCallCallers repairs a historical syscall-trapped parent without deleting evidence', async () => {
  const {
    adapter,
    inbox,
  } = await createProcessorFixture();
  const parentProcess = await adapter.loadProcess('process_parent_alfred');
  const parentThread = await adapter.loadThread('thread_parent_alfred');
  const systemCall = createSystemCall({
    systemCallId: 'syscall_delegate_historical_expired_001',
    idempotencyKey: 'delegate:alfred:bruce:historical-expired:001',
    expiresAt: '2026-05-19T09:01:00-05:00',
  });

  await adapter.persistThread({
    ...parentThread,
    status: 'blocked',
    waitReason: 'waiting_for_system_call',
    updatedAt: CREATED_AT,
  });
  await adapter.persistProcess({
    ...parentProcess,
    status: 'blocked',
    updatedAt: CREATED_AT,
  });
  await inbox.submitSystemCall(systemCall);
  await inbox.persistSystemCallResult({
    kind: OPENMAS_OS_SYSTEM_CALL_KINDS.result,
    schemaVersion: 1,
    systemCallId: systemCall.systemCallId,
    operation: 'delegate',
    status: 'expired',
    processedAt: PROCESSED_AT,
    processedBy: {
      serviceId: 'openmas_os_service_historical',
      tickId: 'os_service_tick_historical',
    },
    decision: {
      allowed: false,
      reason: 'System call expired before processing.',
    },
    effects: {
      createdJobIds: [],
      createdTimerIds: [],
      createdSignalIds: [],
      createdProcessIds: [],
      createdThreadIds: [],
      eventIds: [],
    },
    summary: 'OpenMAS OS expired the historical delegation system call.',
    correlation: systemCall.correlation,
    evidenceRefs: [],
    warnings: [],
    details: {},
  });
  await inbox.moveSystemCall({
    systemCallId: systemCall.systemCallId,
    fromState: 'pending',
    toState: 'expired',
  });

  const reconciliation = await reconcileTerminalDelegationSystemCallCallers({
    adapter,
    inbox,
    observedAt: PROCESSED_AT,
  });

  assert.equal(reconciliation.terminalizedCount, 1);
  assert.equal((await adapter.loadJob('job_parent_alfred')).status, 'failed');
  assert.equal((await adapter.loadProcess('process_parent_alfred')).status, 'failed');
  assert.equal((await adapter.loadThread('thread_parent_alfred')).status, 'failed');
  assert.equal(
    (await inbox.loadSystemCallResult(systemCall.systemCallId)).status,
    'expired',
  );
  assert.equal(
    (await inbox.loadSystemCall(systemCall.systemCallId, 'expired')).status,
    'expired',
  );
});

test('reconcileTerminalDelegationSystemCallCallers degrades safely when historical result evidence is malformed', async () => {
  const {
    projectRootPath,
    adapter,
    inbox,
  } = await createProcessorFixture();
  const resultsRootPath = path.join(
    projectRootPath,
    'instance',
    'os',
    'system-calls',
    'results',
  );

  await mkdir(resultsRootPath, { recursive: true });
  await writeFile(
    path.join(resultsRootPath, 'syscall_delegate_broken_historical_001.result.json'),
    '{',
    'utf8',
  );

  const reconciliation = await reconcileTerminalDelegationSystemCallCallers({
    adapter,
    inbox,
    observedAt: PROCESSED_AT,
  });

  assert.equal(reconciliation.status, 'completed_with_failures');
  assert.equal(reconciliation.failedCount, 1);
  assert.equal(reconciliation.failures[0].systemCallId, null);
  assert.match(reconciliation.failures[0].errorMessage, /could not be parsed as JSON/u);
});

test('KernelSystemCallProcessor processes allowed scheduled delegation calls and materializes child Job plus Timer', async () => {
  const {
    adapter,
    inbox,
    processor,
  } = await createProcessorFixture();

  await inbox.submitSystemCall(createScheduleDelegationSystemCall());

  const processorResult = await processor.processPendingSystemCalls();
  const result = await inbox.loadSystemCallResult('syscall_schedule_delegation_001');
  const childJob = await adapter.loadJob('job_syscall_schedule_delegation_001');
  const timer = await adapter.loadTimer('timer_job_syscall_schedule_delegation_001');
  const schedulingResult = await adapter.loadResultRecord(
    'result_scheduled_submission_syscall_schedule_delegation_001',
  );
  const parentProcess = await adapter.loadProcess('process_parent_alfred');
  const parentThread = await adapter.loadThread('thread_parent_alfred');

  assert.equal(processorResult.completedCount, 1);
  assert.equal(result.status, 'completed');
  assert.deepEqual(result.effects.createdJobIds, ['job_syscall_schedule_delegation_001']);
  assert.deepEqual(result.effects.createdTimerIds, ['timer_job_syscall_schedule_delegation_001']);
  assert.equal(childJob.status, 'scheduled');
  assert.equal(childJob.trigger.type, 'scheduled_once');
  assert.equal(childJob.trigger.runAt, RUN_AT);
  assert.equal(timer.status, 'scheduled');
  assert.equal(timer.runAt, RUN_AT);
  assert.equal(timer.payload.missedRunPolicy, 'delay');
  assert.equal(timer.payload.deliveryMode, 'persist_only');
  assert.equal(timer.payload.sourceSystemCallId, 'syscall_schedule_delegation_001');
  assert.equal(parentProcess.status, 'running');
  assert.equal(parentThread.status, 'running');
  assert.equal(schedulingResult.resultKind, 'scheduled_submission_result');
  assert.equal(schedulingResult.status, 'scheduled');
  assert.equal(schedulingResult.phase, 'scheduled');
  assert.equal(schedulingResult.lineage.jobId, 'job_syscall_schedule_delegation_001');
  assert.equal(schedulingResult.lineage.timerId, 'timer_job_syscall_schedule_delegation_001');
  assert.equal(schedulingResult.metadata.actionType, 'schedule_delegation');
  assert.equal(schedulingResult.metadata.schedule.childJobStatus, 'scheduled');
  assert.equal(schedulingResult.metadata.schedule.timerStatus, 'scheduled');
  assert.equal(schedulingResult.metadata.schedule.runAt, RUN_AT);
  assert.equal(schedulingResult.metadata.schedule.missedRunPolicy, 'delay');
  assert.equal(schedulingResult.metadata.delivery.mode, 'persist_only');
  assert.equal(schedulingResult.metadata.delivery.childCompletionProven, false);
  assert.doesNotMatch(schedulingResult.summary, /completed/iu);
});

test('KernelSystemCallProcessor honors scheduled delegation syscall authority captured before parent completion', async () => {
  const {
    adapter,
    inbox,
    processor,
  } = await createProcessorFixture();
  const parentProcess = await adapter.loadProcess('process_parent_alfred');
  const parentThread = await adapter.loadThread('thread_parent_alfred');
  const parentCompletedAt = '2026-05-19T09:02:00-05:00';

  await adapter.persistJob(createParentJob({
    status: 'completed',
    updatedAt: parentCompletedAt,
  }));
  await adapter.persistProcess({
    ...parentProcess,
    status: 'completed',
    currentThreadId: null,
    updatedAt: parentCompletedAt,
    completedAt: parentCompletedAt,
  });
  await adapter.persistThread({
    ...parentThread,
    status: 'completed',
    updatedAt: parentCompletedAt,
    completedAt: parentCompletedAt,
  });
  await inbox.submitSystemCall(createScheduleDelegationSystemCall({
    systemCallId: 'syscall_schedule_terminal_parent_001',
    requestedAt: CREATED_AT,
    idempotencyKey: 'schedule_delegation:alfred:bruce:terminal-parent:001',
    correlation: {
      invocationId: 'agent-invocation-terminal-parent-001',
      jobId: 'job_parent_alfred',
      processId: 'process_parent_alfred',
      threadId: 'thread_parent_alfred',
      conversationId: 'alfred-admin',
    },
    payload: {
      requesterOperationalIdentityId: 'alfred',
      targetOperationalIdentityId: 'bruce',
      runAt: RUN_AT,
      missedRunPolicy: 'delay',
      parentContext: {
        jobId: 'job_parent_alfred',
        processId: 'process_parent_alfred',
        threadId: 'thread_parent_alfred',
      },
      child: {
        input: 'Inspect the MAS and report findings.',
        command: 'ask',
        mode: 'probabilistic',
      },
    },
  }));

  const processorResult = await processor.processPendingSystemCalls();
  const result = await inbox.loadSystemCallResult('syscall_schedule_terminal_parent_001');
  const childJob = await adapter.loadJob('job_syscall_schedule_terminal_parent_001');
  const timer = await adapter.loadTimer('timer_job_syscall_schedule_terminal_parent_001');
  const schedulingResult = await adapter.loadResultRecord(
    'result_scheduled_submission_syscall_schedule_terminal_parent_001',
  );

  assert.equal(processorResult.completedCount, 1);
  assert.equal(result.status, 'completed');
  assert.equal(result.details.parentProcessStatus, 'completed');
  assert.equal(result.details.parentThreadStatus, 'completed');
  assert.equal(result.details.parentAuthorityMode, 'terminal_parent_snapshot');
  assert.equal(result.details.parentAuthorityRequestedAt, CREATED_AT);
  assert.equal(childJob.status, 'scheduled');
  assert.equal(timer.status, 'scheduled');
  assert.deepEqual(result.effects.createdJobIds, ['job_syscall_schedule_terminal_parent_001']);
  assert.deepEqual(result.effects.createdTimerIds, ['timer_job_syscall_schedule_terminal_parent_001']);
  assert.equal(schedulingResult.status, 'scheduled');
  assert.equal(schedulingResult.metadata.parent.authorityMode, 'terminal_parent_snapshot');
  assert.equal(schedulingResult.metadata.parent.authorityRequestedAt, CREATED_AT);
});

test('KernelSystemCallProcessor rejects scheduled delegation syscall authority forged after parent completion', async () => {
  const {
    adapter,
    inbox,
    processor,
  } = await createProcessorFixture();
  const parentProcess = await adapter.loadProcess('process_parent_alfred');
  const parentThread = await adapter.loadThread('thread_parent_alfred');
  const parentCompletedAt = '2026-05-19T09:02:00-05:00';

  await adapter.persistJob(createParentJob({
    status: 'completed',
    updatedAt: parentCompletedAt,
  }));
  await adapter.persistProcess({
    ...parentProcess,
    status: 'completed',
    currentThreadId: null,
    updatedAt: parentCompletedAt,
    completedAt: parentCompletedAt,
  });
  await adapter.persistThread({
    ...parentThread,
    status: 'completed',
    updatedAt: parentCompletedAt,
    completedAt: parentCompletedAt,
  });
  await inbox.submitSystemCall(createScheduleDelegationSystemCall({
    systemCallId: 'syscall_schedule_forged_after_parent_terminal_001',
    requestedAt: '2026-05-19T09:04:00-05:00',
    idempotencyKey: 'schedule_delegation:alfred:bruce:forged-after-terminal:001',
    correlation: {
      invocationId: 'agent-invocation-forged-after-terminal-001',
      jobId: 'job_parent_alfred',
      processId: 'process_parent_alfred',
      threadId: 'thread_parent_alfred',
      conversationId: 'alfred-admin',
    },
    payload: {
      requesterOperationalIdentityId: 'alfred',
      targetOperationalIdentityId: 'bruce',
      runAt: RUN_AT,
      missedRunPolicy: 'delay',
      parentContext: {
        jobId: 'job_parent_alfred',
        processId: 'process_parent_alfred',
        threadId: 'thread_parent_alfred',
      },
      child: {
        input: 'Inspect the MAS and report findings.',
        command: 'ask',
        mode: 'probabilistic',
      },
    },
  }));

  const processorResult = await processor.processPendingSystemCalls();
  const result = await inbox.loadSystemCallResult('syscall_schedule_forged_after_parent_terminal_001');
  const schedulingResult = await adapter.loadResultRecord(
    'result_scheduled_submission_syscall_schedule_forged_after_parent_terminal_001',
  );

  assert.equal(processorResult.failedCount, 1);
  assert.equal(result.status, 'failed');
  assert.equal(result.decision.allowed, false);
  assert.match(result.decision.reason, /after the Process terminal timestamp/u);
  assert.deepEqual(result.effects.createdJobIds, []);
  assert.deepEqual(result.effects.createdTimerIds, []);
  assert.equal(schedulingResult.resultKind, 'scheduled_submission_result');
  assert.equal(schedulingResult.status, 'failed');
  assert.equal(schedulingResult.phase, 'submission');
  assert.equal(schedulingResult.metadata.delivery.mode, 'none');
  assert.equal(schedulingResult.failure.reasonCode, 'system_call_failed');
  await assert.rejects(
    () => adapter.loadJob('job_syscall_schedule_forged_after_parent_terminal_001'),
    /was not found/u,
  );
  assert.equal((await adapter.listTimers()).length, 0);
});

test('KernelSystemCallProcessor denies stale scheduled delegation runAt before creating Job or Timer', async () => {
  const {
    adapter,
    inbox,
    processor,
  } = await createProcessorFixture();

  await inbox.submitSystemCall(createScheduleDelegationSystemCall({
    systemCallId: 'syscall_schedule_stale_run_at_001',
    idempotencyKey: 'schedule_delegation:alfred:bruce:stale-run-at:001',
    expiresAt: '2026-05-19T10:00:00-05:00',
    payload: {
      requesterOperationalIdentityId: 'alfred',
      targetOperationalIdentityId: 'bruce',
      runAt: CREATED_AT,
      missedRunPolicy: 'delay',
      child: {
        input: 'Inspect the MAS and report findings.',
        command: 'ask',
        mode: 'probabilistic',
      },
    },
  }));

  const processorResult = await processor.processPendingSystemCalls();
  const result = await inbox.loadSystemCallResult('syscall_schedule_stale_run_at_001');
  const schedulingResult = await adapter.loadResultRecord(
    'result_scheduled_submission_syscall_schedule_stale_run_at_001',
  );

  assert.equal(processorResult.deniedCount, 1);
  assert.equal(result.status, 'denied');
  assert.equal(result.decision.allowed, false);
  assert.equal(result.details.reasonCode, 'scheduled_time_not_future');
  assert.deepEqual(result.effects.createdJobIds, []);
  assert.deepEqual(result.effects.createdTimerIds, []);
  assert.equal(schedulingResult.resultKind, 'scheduled_submission_result');
  assert.equal(schedulingResult.status, 'denied');
  assert.equal(schedulingResult.phase, 'submission');
  assert.equal(schedulingResult.lineage.jobId, null);
  assert.equal(schedulingResult.lineage.timerId, null);
  assert.equal(schedulingResult.metadata.policy.reasonCode, 'scheduled_time_not_future');
  assert.equal(schedulingResult.metadata.schedule.runAt, CREATED_AT);
  assert.equal(schedulingResult.metadata.schedule.missedRunPolicy, 'delay');
  assert.equal(schedulingResult.metadata.delivery.mode, 'none');
  await assert.rejects(
    () => adapter.loadJob('job_syscall_schedule_stale_run_at_001'),
    /was not found/u,
  );
  assert.equal((await adapter.listTimers()).length, 0);
});

test('KernelSystemCallProcessor records policy-denied scheduled delegation with zero effects', async () => {
  const {
    adapter,
    inbox,
    processor,
  } = await createProcessorFixture();

  await inbox.submitSystemCall(createScheduleDelegationSystemCall({
    systemCallId: 'syscall_schedule_policy_denied_001',
    idempotencyKey: 'schedule_delegation:alfred:maria:001',
    payload: {
      requesterOperationalIdentityId: 'alfred',
      targetOperationalIdentityId: 'maria',
      runAt: RUN_AT,
      missedRunPolicy: 'delay',
      child: {
        input: 'Inspect the MAS and report findings.',
        command: 'ask',
        mode: 'probabilistic',
      },
    },
  }));

  const processorResult = await processor.processPendingSystemCalls();
  const result = await inbox.loadSystemCallResult('syscall_schedule_policy_denied_001');
  const schedulingResult = await adapter.loadResultRecord(
    'result_scheduled_submission_syscall_schedule_policy_denied_001',
  );

  assert.equal(processorResult.deniedCount, 1);
  assert.equal(result.status, 'denied');
  assert.equal(result.decision.allowed, false);
  assert.deepEqual(result.effects.createdJobIds, []);
  assert.deepEqual(result.effects.createdTimerIds, []);
  assert.equal(schedulingResult.resultKind, 'scheduled_submission_result');
  assert.equal(schedulingResult.status, 'denied');
  assert.equal(schedulingResult.metadata.policy.allowed, false);
  assert.equal(schedulingResult.metadata.schedule.runAt, RUN_AT);
  assert.equal(schedulingResult.metadata.schedule.childJobId, null);
  assert.equal(schedulingResult.metadata.schedule.timerId, null);
  assert.equal(schedulingResult.metadata.delivery.mode, 'none');
  await assert.rejects(
    () => adapter.loadJob('job_syscall_schedule_policy_denied_001'),
    /was not found/u,
  );
  assert.equal((await adapter.listTimers()).length, 0);
});

test('KernelSystemCallProcessor denies unauthorized delegation with zero effects', async () => {
  const {
    adapter,
    inbox,
    processor,
  } = await createProcessorFixture();

  await inbox.submitSystemCall(createSystemCall({
    systemCallId: 'syscall_delegate_denied_001',
    idempotencyKey: 'delegate:alfred:maria:001',
    payload: {
      requesterOperationalIdentityId: 'alfred',
      targetOperationalIdentityId: 'maria',
      child: {
        input: 'Inspect the MAS and report findings.',
        command: 'ask',
        mode: 'probabilistic',
      },
    },
  }));

  const processorResult = await processor.processPendingSystemCalls();
  const result = await inbox.loadSystemCallResult('syscall_delegate_denied_001');
  const submissionResult = await adapter.loadResultRecord('result_delegation_submission_syscall_delegate_denied_001');

  assert.equal(processorResult.deniedCount, 1);
  assert.equal(result.status, 'denied');
  assert.equal(result.decision.allowed, false);
  assert.deepEqual(result.effects.createdJobIds, []);
  assert.match(result.decision.reason, /No delegation policy rule allows/u);
  assert.equal(submissionResult.resultKind, 'delegation_submission_result');
  assert.equal(submissionResult.status, 'denied');
  assert.equal(submissionResult.phase, 'submission');
  assert.equal(submissionResult.lineage.systemCallId, 'syscall_delegate_denied_001');
  assert.equal(submissionResult.lineage.jobId, null);
  assert.equal(submissionResult.metadata.policy.allowed, false);
  assert.equal(submissionResult.metadata.policy.reasonCode, 'no_matching_delegation_policy_rule');
  assert.equal(submissionResult.metadata.delegation.childJobId, null);
  assert.equal(submissionResult.metadata.delivery.mode, 'none');
  assert.equal(submissionResult.metadata.delivery.childCompletionProven, false);
  await assert.rejects(
    () => adapter.loadJob('job_syscall_delegate_denied_001'),
    /was not found/u,
  );
  assert.equal((await adapter.loadProcess('process_parent_alfred')).status, 'running');
});

test('KernelSystemCallProcessor materializes idempotent delegate replay as a submission Result Record reference', async () => {
  const {
    adapter,
    inbox,
    processor,
  } = await createProcessorFixture();

  await inbox.submitSystemCall(createSystemCall({
    systemCallId: 'syscall_delegate_idempotent_first_001',
    idempotencyKey: 'delegate:alfred:bruce:idempotent:001',
  }));
  await processor.processPendingSystemCalls();

  await inbox.submitSystemCall(createSystemCall({
    systemCallId: 'syscall_delegate_idempotent_second_001',
    idempotencyKey: 'delegate:alfred:bruce:idempotent:001',
  }));

  const processorResult = await processor.processPendingSystemCalls();
  const duplicateResult = await inbox.loadSystemCallResult('syscall_delegate_idempotent_second_001');
  const firstSubmissionResult = await adapter.loadResultRecord(
    'result_delegation_submission_syscall_delegate_idempotent_first_001',
  );
  const duplicateSubmissionResult = await adapter.loadResultRecord(
    'result_delegation_submission_syscall_delegate_idempotent_second_001',
  );
  const bruceJobs = (await adapter.listJobs())
    .filter((job) => job.assignedOperationalIdentityId === 'bruce');

  assert.equal(processorResult.completedCount, 1);
  assert.equal(duplicateResult.status, 'completed');
  assert.equal(duplicateResult.details.duplicateOfSystemCallId, 'syscall_delegate_idempotent_first_001');
  assert.deepEqual(duplicateResult.effects.createdJobIds, []);
  assert.equal(bruceJobs.length, 1);
  assert.equal(firstSubmissionResult.status, 'accepted');
  assert.equal(duplicateSubmissionResult.status, 'accepted');
  assert.equal(
    duplicateSubmissionResult.metadata.systemCall.originalSubmissionResultId,
    firstSubmissionResult.resultId,
  );
  assert.equal(
    duplicateSubmissionResult.metadata.systemCall.duplicateOfSystemCallId,
    'syscall_delegate_idempotent_first_001',
  );
  assert.equal(
    duplicateSubmissionResult.metadata.delegation.childJobId,
    'job_syscall_delegate_idempotent_first_001',
  );
  assert.deepEqual(duplicateSubmissionResult.childResultRefs, []);
});

test('KernelSystemCallProcessor denies authorized delegation when the target Operational Identity is not ready', async () => {
  const {
    adapter,
    inbox,
    processor,
  } = await createProcessorFixture({
    delegationPolicy: createDelegationPolicy({
      rules: [
        {
          ...createDelegationPolicy().rules[0],
          ruleId: 'allow-alfred-to-maria-probabilistic-ask',
          toOperationalIdentityId: 'maria',
        },
      ],
    }),
    delegationTargetReadinessEvaluator: async () => {
      return {
        ready: false,
        status: 'blocked',
        reasonCode: 'target_execution_mode_not_supported',
        reason: 'Execution Profile maria-default does not support probabilistic invocation.',
        targetOperationalIdentityId: 'maria',
        command: 'ask',
        mode: 'probabilistic',
        warnings: [],
      };
    },
  });

  await inbox.submitSystemCall(createSystemCall({
    systemCallId: 'syscall_delegate_target_not_ready_001',
    idempotencyKey: 'delegate:alfred:maria:not-ready:001',
    payload: {
      requesterOperationalIdentityId: 'alfred',
      targetOperationalIdentityId: 'maria',
      child: {
        input: 'Inspect the MAS and report findings.',
        command: 'ask',
        mode: 'probabilistic',
      },
    },
  }));

  const processorResult = await processor.processPendingSystemCalls();
  const result = await inbox.loadSystemCallResult('syscall_delegate_target_not_ready_001');

  assert.equal(processorResult.deniedCount, 1);
  assert.equal(result.status, 'denied');
  assert.equal(result.decision.allowed, false);
  assert.equal(result.details.reasonCode, 'target_execution_mode_not_supported');
  assert.equal(result.details.targetReadiness.targetOperationalIdentityId, 'maria');
  assert.deepEqual(result.effects.createdJobIds, []);
  await assert.rejects(
    () => adapter.loadJob('job_syscall_delegate_target_not_ready_001'),
    /was not found/u,
  );
  assert.equal((await adapter.loadProcess('process_parent_alfred')).status, 'running');
});

test('KernelSystemCallProcessor denies authorized scheduled delegation when the target Operational Identity is not ready', async () => {
  const {
    adapter,
    inbox,
    processor,
  } = await createProcessorFixture({
    delegationTargetReadinessEvaluator: async () => {
      return {
        ready: false,
        status: 'blocked',
        reasonCode: 'target_cognitive_identity_missing_required_components',
        reason: 'Delegation target bruce resolved to a cognitive identity with missing required components.',
        targetOperationalIdentityId: 'bruce',
        command: 'ask',
        mode: 'probabilistic',
        warnings: [],
      };
    },
  });

  await inbox.submitSystemCall(createScheduleDelegationSystemCall({
    systemCallId: 'syscall_schedule_target_not_ready_001',
    idempotencyKey: 'schedule_delegation:alfred:bruce:not-ready:001',
  }));

  const processorResult = await processor.processPendingSystemCalls();
  const result = await inbox.loadSystemCallResult('syscall_schedule_target_not_ready_001');
  const schedulingResult = await adapter.loadResultRecord(
    'result_scheduled_submission_syscall_schedule_target_not_ready_001',
  );

  assert.equal(processorResult.deniedCount, 1);
  assert.equal(result.status, 'denied');
  assert.equal(result.decision.allowed, false);
  assert.equal(result.details.reasonCode, 'target_cognitive_identity_missing_required_components');
  assert.deepEqual(result.effects.createdJobIds, []);
  assert.deepEqual(result.effects.createdTimerIds, []);
  assert.equal(schedulingResult.resultKind, 'scheduled_submission_result');
  assert.equal(schedulingResult.status, 'denied');
  assert.equal(schedulingResult.metadata.policy.reasonCode, 'target_cognitive_identity_missing_required_components');
  assert.equal(schedulingResult.metadata.schedule.childJobId, null);
  assert.equal(schedulingResult.metadata.schedule.timerId, null);
  assert.equal(schedulingResult.metadata.delivery.mode, 'none');
  await assert.rejects(
    () => adapter.loadJob('job_syscall_schedule_target_not_ready_001'),
    /was not found/u,
  );
  assert.equal((await adapter.listTimers()).length, 0);
});

test('KernelSystemCallProcessor expires stale calls before policy or kernel effects', async () => {
  const {
    adapter,
    inbox,
    processor,
  } = await createProcessorFixture();

  await inbox.submitSystemCall(createScheduleDelegationSystemCall({
    systemCallId: 'syscall_expired_001',
    idempotencyKey: 'schedule_delegation:expired:001',
    expiresAt: '2026-05-19T09:01:00-05:00',
  }));

  const processorResult = await processor.processPendingSystemCalls();
  const result = await inbox.loadSystemCallResult('syscall_expired_001');

  assert.equal(processorResult.expiredCount, 1);
  assert.equal(result.status, 'expired');
  assert.equal(result.decision.allowed, false);
  assert.deepEqual(result.effects.createdJobIds, []);
  assert.deepEqual(result.effects.createdTimerIds, []);
  await assert.rejects(
    () => adapter.loadJob('job_syscall_expired_001'),
    /was not found/u,
  );
});

test('KernelSystemCallProcessor isolates malformed pending calls and continues processing valid calls', async () => {
  const {
    projectRootPath,
    inbox,
    processor,
  } = await createProcessorFixture();

  await mkdir(path.join(projectRootPath, 'instance', 'os', 'system-calls', 'pending'), { recursive: true });
  await writeFile(
    path.join(projectRootPath, 'instance', 'os', 'system-calls', 'pending', 'syscall_broken_001.json'),
    '{',
    'utf8',
  );
  await inbox.submitSystemCall(createSystemCall({
    systemCallId: 'syscall_inspect_001',
    operation: 'inspect_status',
    idempotencyKey: null,
    payload: {
      scope: 'service',
    },
  }));

  const processorResult = await processor.processPendingSystemCalls();
  const brokenResult = await inbox.loadSystemCallResult('syscall_broken_001');
  const inspectResult = await inbox.loadSystemCallResult('syscall_inspect_001');

  assert.equal(processorResult.processedCount, 2);
  assert.equal(processorResult.failedCount, 1);
  assert.equal(processorResult.completedCount, 1);
  assert.equal(brokenResult.operation, 'invalid_request');
  assert.equal(brokenResult.status, 'failed');
  assert.match(brokenResult.decision.reason, /could not be parsed as JSON/u);
  assert.equal(inspectResult.status, 'completed');
  assert.equal(inspectResult.details.scope, 'service');
});

test('KernelSystemCallProcessor fails malformed processing calls without blocking pending work', async () => {
  const {
    projectRootPath,
    inbox,
    processor,
  } = await createProcessorFixture();

  await mkdir(path.join(projectRootPath, 'instance', 'os', 'system-calls', 'processing'), { recursive: true });
  await writeFile(
    path.join(projectRootPath, 'instance', 'os', 'system-calls', 'processing', 'syscall_processing_broken_001.json'),
    '{',
    'utf8',
  );
  await inbox.submitSystemCall(createSystemCall({
    systemCallId: 'syscall_processing_recovery_inspect_001',
    operation: 'inspect_status',
    idempotencyKey: null,
    payload: {
      scope: 'service',
    },
  }));

  const processorResult = await processor.processPendingSystemCalls();
  const brokenResult = await inbox.loadSystemCallResult('syscall_processing_broken_001');
  const inspectResult = await inbox.loadSystemCallResult('syscall_processing_recovery_inspect_001');

  assert.equal(processorResult.processedCount, 2);
  assert.equal(processorResult.failedCount, 1);
  assert.equal(processorResult.completedCount, 1);
  assert.equal(processorResult.recoveredProcessingCount, 1);
  assert.equal(brokenResult.operation, 'invalid_request');
  assert.equal(brokenResult.status, 'failed');
  assert.match(brokenResult.decision.reason, /could not be parsed as JSON/u);
  assert.equal(inspectResult.status, 'completed');
  await assertFileMissing(path.join(projectRootPath, 'instance', 'os', 'system-calls', 'processing', 'syscall_processing_broken_001.json'));
  await assertFileExists(path.join(projectRootPath, 'instance', 'os', 'system-calls', 'failed', 'syscall_processing_broken_001.json'));
});

test('KernelSystemCallProcessor replays duplicate idempotency keys without duplicating kernel effects', async () => {
  const {
    adapter,
    inbox,
    processor,
  } = await createProcessorFixture();

  await inbox.submitSystemCall(createScheduleDelegationSystemCall({
    systemCallId: 'syscall_schedule_first_001',
    idempotencyKey: 'schedule_delegation:duplicate:001',
  }));
  await processor.processPendingSystemCalls();

  await inbox.submitSystemCall(createScheduleDelegationSystemCall({
    systemCallId: 'syscall_schedule_duplicate_001',
    idempotencyKey: 'schedule_delegation:duplicate:001',
  }));
  const secondProcessorResult = await processor.processPendingSystemCalls();
  const duplicateResult = await inbox.loadSystemCallResult('syscall_schedule_duplicate_001');
  const firstSchedulingResult = await adapter.loadResultRecord(
    'result_scheduled_submission_syscall_schedule_first_001',
  );
  const duplicateSchedulingResult = await adapter.loadResultRecord(
    'result_scheduled_submission_syscall_schedule_duplicate_001',
  );
  const bruceJobs = (await adapter.listJobs())
    .filter((job) => job.assignedOperationalIdentityId === 'bruce');
  const timers = await adapter.listTimers();

  assert.equal(secondProcessorResult.completedCount, 1);
  assert.equal(duplicateResult.status, 'completed');
  assert.equal(duplicateResult.details.duplicateOfSystemCallId, 'syscall_schedule_first_001');
  assert.deepEqual(duplicateResult.effects.createdJobIds, []);
  assert.deepEqual(duplicateResult.effects.createdTimerIds, []);
  assert.equal(bruceJobs.length, 1);
  assert.equal(timers.length, 1);
  assert.equal(firstSchedulingResult.status, 'scheduled');
  assert.equal(duplicateSchedulingResult.status, 'scheduled');
  assert.equal(
    duplicateSchedulingResult.metadata.systemCall.originalSubmissionResultId,
    'result_scheduled_submission_syscall_schedule_first_001',
  );
  assert.equal(duplicateSchedulingResult.lineage.jobId, 'job_syscall_schedule_first_001');
  assert.equal(duplicateSchedulingResult.lineage.timerId, 'timer_job_syscall_schedule_first_001');
  assert.equal(duplicateSchedulingResult.metadata.schedule.runAt, RUN_AT);
  assert.equal(duplicateSchedulingResult.metadata.delivery.mode, 'persist_only');
  assert.equal(duplicateSchedulingResult.metadata.delivery.childCompletionProven, false);
});

test('KernelSystemCallProcessor recovers a processing call without effects by completing it once', async () => {
  const {
    projectRootPath,
    adapter,
    inbox,
    processor,
  } = await createProcessorFixture();

  await inbox.submitSystemCall(createSystemCall({
    systemCallId: 'syscall_processing_delegate_001',
    idempotencyKey: 'delegate:alfred:bruce:processing:001',
  }));
  await inbox.moveSystemCall({
    systemCallId: 'syscall_processing_delegate_001',
    fromState: 'pending',
    toState: 'processing',
  });

  const processorResult = await processor.processPendingSystemCalls();
  const result = await inbox.loadSystemCallResult('syscall_processing_delegate_001');
  const childJob = await adapter.loadJob('job_syscall_processing_delegate_001');

  assert.equal(processorResult.processedCount, 1);
  assert.equal(processorResult.completedCount, 1);
  assert.equal(processorResult.recoveredProcessingCount, 1);
  assert.equal(result.status, 'completed');
  assert.equal(childJob.assignedOperationalIdentityId, 'bruce');
  await assertFileMissing(path.join(projectRootPath, 'instance', 'os', 'system-calls', 'processing', 'syscall_processing_delegate_001.json'));
  await assertFileExists(path.join(projectRootPath, 'instance', 'os', 'system-calls', 'completed', 'syscall_processing_delegate_001.json'));
});

test('KernelSystemCallProcessor recovers a processing call that already has a result record', async () => {
  const {
    projectRootPath,
    inbox,
    processor,
  } = await createProcessorFixture();

  await inbox.submitSystemCall(createSystemCall({
    systemCallId: 'syscall_processing_result_exists_001',
    operation: 'inspect_status',
    idempotencyKey: null,
    payload: {
      scope: 'service',
    },
  }));
  await processor.processPendingSystemCalls();
  await inbox.moveSystemCall({
    systemCallId: 'syscall_processing_result_exists_001',
    fromState: 'completed',
    toState: 'processing',
  });

  const processorResult = await processor.processPendingSystemCalls();
  const result = await inbox.loadSystemCallResult('syscall_processing_result_exists_001');

  assert.equal(processorResult.processedCount, 1);
  assert.equal(processorResult.completedCount, 1);
  assert.equal(processorResult.recoveredProcessingCount, 1);
  assert.equal(result.status, 'completed');
  assert.equal(result.summary, 'OpenMAS OS inspected service status.');
  await assertFileMissing(path.join(projectRootPath, 'instance', 'os', 'system-calls', 'processing', 'syscall_processing_result_exists_001.json'));
  await assertFileExists(path.join(projectRootPath, 'instance', 'os', 'system-calls', 'completed', 'syscall_processing_result_exists_001.json'));
});

test('KernelSystemCallProcessor recovers materialized scheduled delegation effects without duplicating Job or Timer', async () => {
  const {
    adapter,
    inbox,
    processor,
  } = await createProcessorFixture();

  await inbox.submitSystemCall(createScheduleDelegationSystemCall({
    systemCallId: 'syscall_processing_schedule_recovery_001',
    idempotencyKey: 'schedule_delegation:processing-recovery:001',
  }));
  await processor.processPendingSystemCalls();
  await unlink(inbox.resolveSystemCallResultPath('syscall_processing_schedule_recovery_001'));
  await inbox.moveSystemCall({
    systemCallId: 'syscall_processing_schedule_recovery_001',
    fromState: 'completed',
    toState: 'processing',
  });

  const eventsBeforeRecovery = await adapter.readEvents({ date: '2026-05-19' });
  const processorResult = await processor.processPendingSystemCalls();
  const result = await inbox.loadSystemCallResult('syscall_processing_schedule_recovery_001');
  const bruceJobs = (await adapter.listJobs())
    .filter((job) => job.assignedOperationalIdentityId === 'bruce');
  const timers = await adapter.listTimers();
  const eventsAfterRecovery = await adapter.readEvents({ date: '2026-05-19' });

  assert.equal(processorResult.processedCount, 1);
  assert.equal(processorResult.completedCount, 1);
  assert.equal(processorResult.recoveredProcessingCount, 1);
  assert.equal(result.status, 'completed');
  assert.equal(result.details.recoveryStatus, 'recovered_existing_materialized_effects');
  assert.deepEqual(result.effects.createdJobIds, ['job_syscall_processing_schedule_recovery_001']);
  assert.deepEqual(result.effects.createdTimerIds, ['timer_job_syscall_processing_schedule_recovery_001']);
  assert.equal(bruceJobs.length, 1);
  assert.equal(timers.length, 1);
  assert.equal(
    eventsAfterRecovery.filter((event) => event.eventType === 'delegation.scheduled').length,
    eventsBeforeRecovery.filter((event) => event.eventType === 'delegation.scheduled').length,
  );
});

test('KernelSystemCallProcessor fails reserved operations honestly until processor handlers exist', async () => {
  const {
    adapter,
    inbox,
    processor,
  } = await createProcessorFixture();

  await inbox.submitSystemCall(createSystemCall({
    systemCallId: 'syscall_submit_job_001',
    operation: 'submit_job',
    idempotencyKey: 'submit_job:alfred:001',
    payload: {
      assignedOperationalIdentityId: 'alfred',
      program: {
        type: 'agent_invocation',
        command: 'ask',
        mode: 'probabilistic',
      },
      inputRef: {
        type: 'inline_text',
        text: 'Generate a short status report.',
      },
    },
  }));

  const processorResult = await processor.processPendingSystemCalls();
  const result = await inbox.loadSystemCallResult('syscall_submit_job_001');

  assert.equal(processorResult.failedCount, 1);
  assert.equal(result.status, 'failed');
  assert.equal(result.decision.allowed, false);
  assert.match(result.summary, /not implemented yet/u);
  assert.deepEqual(result.effects.createdJobIds, []);
  assert.equal((await adapter.listJobs()).length, 1);
});
