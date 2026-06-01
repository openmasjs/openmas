import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { OPENMAS_OS_KINDS } from '../../src/contracts/openmas-os-runtime-contract.js';
import { OPENMAS_OS_SYSTEM_CALL_KINDS } from '../../src/contracts/openmas-os-system-call-contract.js';
import { createLocalRuntimeAdapter } from '../../src/os/adapters/local-runtime-adapter.js';
import {
  createLocalAsyncDispatchExecutor,
  runOpenMasOsServiceTick,
} from '../../src/os/service/local-os-service.js';
import { releaseDueOneShotJobs } from '../../src/os/scheduler/one-shot-scheduled-jobs.js';
import { executeMasOsScheduleDelegation } from '../../src/os/actions/mas-os-schedule-delegation-runtime.js';
import { createLocalSystemCallInbox } from '../../src/os/system-calls/local-system-call-inbox.js';
import { buildFakeOpenRouterSecretProbe } from '../helpers/fake-secret-probes.js';

const CREATED_AT = '2026-05-15T09:00:00-05:00';
const SCHEDULED_AT = '2026-05-15T09:05:00-05:00';
const RUN_AT = '2026-05-15T18:00:00-05:00';
const FUTURE_RUN_AT = '2026-05-16T18:00:00-05:00';

function createDelegationPolicy() {
  return {
    kind: 'openmas_delegation_policy',
    version: 1,
    defaultEffect: 'deny',
    rules: [
      {
        ruleId: 'allow-alfred-to-bruce-scheduled-delegation',
        effect: 'allow',
        fromOperationalIdentityId: 'alfred',
        toOperationalIdentityId: 'bruce',
        actionTypes: ['delegate', 'schedule_delegation'],
        commands: ['ask'],
        modes: ['probabilistic'],
      },
    ],
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
      text: 'Schedule work with Bruce.',
    },
    conversationId: 'os-m2-local-service-smoke',
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
    conversationId: 'os-m2-local-service-smoke',
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

function createScheduleDelegationInput(overrides = {}) {
  return {
    targetOperationalIdentityId: 'bruce',
    task: 'Inspect the MAS and report findings.',
    runAt: RUN_AT,
    missedRunPolicy: 'delay',
    command: 'ask',
    mode: 'probabilistic',
    conversationId: 'os-m2-local-service-smoke',
    parentContext: {
      jobId: 'job_parent_alfred',
      processId: 'process_parent_alfred',
      threadId: 'thread_parent_alfred',
    },
    contextRefs: [],
    ...overrides,
  };
}

function createSystemCall(overrides = {}) {
  return {
    kind: OPENMAS_OS_SYSTEM_CALL_KINDS.systemCall,
    schemaVersion: 1,
    systemCallId: 'syscall_delegate_service_tick_001',
    operation: 'delegate',
    status: 'pending',
    requestedAt: SCHEDULED_AT,
    requestedBy: {
      type: 'operational_identity',
      operationalIdentityId: 'alfred',
    },
    correlation: {
      invocationId: 'invocation_syscall_service_tick_001',
      processId: 'process_parent_alfred',
      threadId: 'thread_parent_alfred',
      conversationId: 'os-m2-local-service-smoke',
    },
    idempotencyKey: 'delegate:service-tick:alfred:bruce:001',
    expiresAt: '2026-05-16T00:00:00-05:00',
    payload: {
      requesterOperationalIdentityId: 'alfred',
      targetOperationalIdentityId: 'bruce',
      reason: 'Bruce should inspect the MAS.',
      child: {
        input: 'Inspect the MAS and report findings.',
        command: 'ask',
        mode: 'probabilistic',
        conversationId: 'os-m2-local-service-smoke',
      },
    },
    ...overrides,
  };
}

function createScheduleDelegationSystemCall(overrides = {}) {
  return createSystemCall({
    systemCallId: 'syscall_schedule_delegation_service_tick_001',
    operation: 'schedule_delegation',
    idempotencyKey: 'schedule-delegation:service-tick:alfred:bruce:001',
    payload: {
      requesterOperationalIdentityId: 'alfred',
      targetOperationalIdentityId: 'bruce',
      runAt: RUN_AT,
      missedRunPolicy: 'delay',
      child: {
        input: 'Inspect the MAS and report findings.',
        command: 'ask',
        mode: 'probabilistic',
        conversationId: 'os-m2-local-service-smoke',
      },
    },
    ...overrides,
  });
}

function createReadyJob(overrides = {}) {
  return {
    kind: OPENMAS_OS_KINDS.job,
    schemaVersion: 1,
    jobId: 'job_ready_alfred',
    projectId: 'project_openmas',
    status: 'ready',
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
      text: 'Run ready local service work.',
    },
    conversationId: 'os-m2-local-service-ready-work',
    trigger: {
      type: 'manual',
    },
    priority: 90,
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

async function createTemporaryProjectRoot(prefix = 'openmas-local-os-service-') {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

async function createEmptyProjectFixture() {
  const projectRootPath = await createTemporaryProjectRoot();
  const adapter = createLocalRuntimeAdapter({ projectRootPath });

  return {
    projectRootPath,
    adapter,
  };
}

async function createScheduledDelegationFixture(inputOverrides = {}) {
  const projectRootPath = await createTemporaryProjectRoot('openmas-local-os-service-delegation-');
  const adapter = createLocalRuntimeAdapter({ projectRootPath });
  const inbox = createLocalSystemCallInbox({ projectRootPath });
  const policyRootPath = path.join(projectRootPath, 'instance', 'registries');
  const systemCallId = inputOverrides.systemCallId ?? 'syscall_schedule_delegation_for_service_tick_001';

  await mkdir(policyRootPath, { recursive: true });
  await writeFile(
    path.join(policyRootPath, 'delegation-policy.json'),
    JSON.stringify(createDelegationPolicy(), null, 2),
    'utf8',
  );

  await adapter.persistJob(createParentJob());
  await adapter.persistProcess(createParentProcess());
  await adapter.persistThread(createParentThread());

  const scheduled = await executeMasOsScheduleDelegation({
    input: createScheduleDelegationInput({
      ...inputOverrides,
      systemCallId,
    }),
    projectRootPath,
    operationalIdentityId: 'alfred',
    invocationId: 'invocation_schedule_delegation_for_service_tick_001',
    now: () => SCHEDULED_AT,
  });

  assert.equal(scheduled.status, 'succeeded');
  assert.equal(scheduled.data.scheduled, false);

  const materializationTick = await runOpenMasOsServiceTick({
    adapter,
    projectRootPath,
    now: () => SCHEDULED_AT,
  });
  const systemCallResult = await inbox.loadSystemCallResult(systemCallId);

  assert.equal(materializationTick.systemCalls.completedCount, 1);
  assert.equal(systemCallResult.status, 'completed');

  return {
    projectRootPath,
    adapter,
    inbox,
    scheduled,
    systemCallResult,
    childJobId: systemCallResult.details.childJobId,
    timerId: systemCallResult.details.timerId,
  };
}

async function createSystemCallDelegationFixture() {
  const projectRootPath = await createTemporaryProjectRoot('openmas-local-os-service-syscall-');
  const adapter = createLocalRuntimeAdapter({ projectRootPath });
  const inbox = createLocalSystemCallInbox({ projectRootPath });
  const policyRootPath = path.join(projectRootPath, 'instance', 'registries');

  await mkdir(policyRootPath, { recursive: true });
  await writeFile(
    path.join(policyRootPath, 'delegation-policy.json'),
    JSON.stringify(createDelegationPolicy(), null, 2),
    'utf8',
  );

  await adapter.persistJob(createParentJob());
  await adapter.persistProcess(createParentProcess());
  await adapter.persistThread(createParentThread());

  return {
    projectRootPath,
    adapter,
    inbox,
  };
}

test('runOpenMasOsServiceTick records a safe idle audit when no OS work is due', async () => {
  const {
    projectRootPath,
    adapter,
  } = await createEmptyProjectFixture();
  const result = await runOpenMasOsServiceTick({
    adapter,
    projectRootPath,
    now: () => RUN_AT,
  });

  assert.equal(result.status, 'idle');
  assert.equal(result.systemCalls.processedCount, 0);
  assert.equal(result.release.releasedCount, 0);
  assert.equal(result.readyWork.candidateCount, 0);
  assert.deepEqual(result.dispatches, []);

  const events = await adapter.readEvents({ date: '2026-05-15' });

  assert.deepEqual(
    events.map((event) => event.eventType),
    [
      'os.service.tick.started',
      'os.service.tick.completed',
    ],
  );
});

test('runOpenMasOsServiceTick recovers stale CLI-managed running invocation snapshots', async () => {
  const {
    projectRootPath,
    adapter,
  } = await createEmptyProjectFixture();

  await adapter.persistJob(createParentJob({
    jobId: 'job_cli_stale_alfred',
    projectId: 'project_openmas_cli',
    createdBy: {
      type: 'human',
      id: 'cli',
    },
    trigger: {
      type: 'immediate',
    },
  }));
  await adapter.persistProcess(createParentProcess({
    processId: 'process_cli_stale_alfred',
    jobId: 'job_cli_stale_alfred',
    currentThreadId: 'thread_cli_stale_alfred',
  }));
  await adapter.persistThread(createParentThread({
    threadId: 'thread_cli_stale_alfred',
    processId: 'process_cli_stale_alfred',
    jobId: 'job_cli_stale_alfred',
  }));

  const result = await runOpenMasOsServiceTick({
    adapter,
    projectRootPath,
    now: () => RUN_AT,
    staleRunningInvocationAfterMs: 1000,
  });
  const recoveredJob = await adapter.loadJob('job_cli_stale_alfred');
  const recoveredProcess = await adapter.loadProcess('process_cli_stale_alfred');
  const recoveredThread = await adapter.loadThread('thread_cli_stale_alfred');
  const eventTypes = (await adapter.readEvents({ date: '2026-05-15' }))
    .map((event) => event.eventType);

  assert.equal(result.status, 'completed');
  assert.equal(result.recovery.scannedProcessCount, 1);
  assert.equal(result.recovery.candidateCount, 1);
  assert.equal(result.recovery.recoveredCount, 1);
  assert.equal(result.recovery.failedCount, 0);
  assert.equal(result.dispatches.length, 0);
  assert.equal(recoveredJob.status, 'failed');
  assert.equal(recoveredProcess.status, 'failed');
  assert.equal(recoveredThread.status, 'failed');
  assert.equal(recoveredProcess.currentThreadId, null);
  assert.equal(recoveredJob.failedAt, RUN_AT);
  assert.equal(recoveredProcess.failedAt, RUN_AT);
  assert.equal(recoveredThread.failedAt, RUN_AT);
  assert.equal(recoveredJob.failureSummary.reasonCode, 'stale_running_cli_invocation_recovered');
  assert.equal(recoveredProcess.failureSummary.reasonCode, 'stale_running_cli_invocation_recovered');
  assert.equal(recoveredThread.failureSummary.reasonCode, 'stale_running_cli_invocation_recovered');
  assert.ok(eventTypes.includes('thread.failed'));
  assert.ok(eventTypes.includes('process.failed'));
  assert.ok(eventTypes.includes('job.failed'));
  assert.ok(eventTypes.includes('os.service.stale_running_invocation.recovered'));
});

test('runOpenMasOsServiceTick leaves fresh CLI-managed running invocation snapshots alone', async () => {
  const {
    projectRootPath,
    adapter,
  } = await createEmptyProjectFixture();

  await adapter.persistJob(createParentJob({
    jobId: 'job_cli_fresh_alfred',
    projectId: 'project_openmas_cli',
    createdBy: {
      type: 'human',
      id: 'cli',
    },
    trigger: {
      type: 'immediate',
    },
    updatedAt: RUN_AT,
  }));
  await adapter.persistProcess(createParentProcess({
    processId: 'process_cli_fresh_alfred',
    jobId: 'job_cli_fresh_alfred',
    currentThreadId: 'thread_cli_fresh_alfred',
    updatedAt: RUN_AT,
  }));
  await adapter.persistThread(createParentThread({
    threadId: 'thread_cli_fresh_alfred',
    processId: 'process_cli_fresh_alfred',
    jobId: 'job_cli_fresh_alfred',
    updatedAt: RUN_AT,
  }));

  const result = await runOpenMasOsServiceTick({
    adapter,
    projectRootPath,
    now: () => RUN_AT,
    staleRunningInvocationAfterMs: 1000,
  });

  assert.equal(result.status, 'idle');
  assert.equal(result.recovery.scannedProcessCount, 1);
  assert.equal(result.recovery.candidateCount, 0);
  assert.equal(result.recovery.recoveredCount, 0);
  assert.equal((await adapter.loadJob('job_cli_fresh_alfred')).status, 'active');
  assert.equal((await adapter.loadProcess('process_cli_fresh_alfred')).status, 'running');
  assert.equal((await adapter.loadThread('thread_cli_fresh_alfred')).status, 'running');
});

test('runOpenMasOsServiceTick recovers interrupted terminal foreground publication without rerunning the Agent', async () => {
  const {
    projectRootPath,
    adapter,
  } = await createEmptyProjectFixture();

  await adapter.persistJob(createReadyJob({
    jobId: 'job_cli_terminal_foreground_publication',
    projectId: 'project_openmas_cli',
    status: 'active',
    createdBy: {
      type: 'human',
      id: 'cli',
    },
    trigger: {
      type: 'immediate',
    },
    updatedAt: RUN_AT,
  }));
  await adapter.persistProcess(createParentProcess({
    processId: 'process_cli_terminal_foreground_publication',
    jobId: 'job_cli_terminal_foreground_publication',
    status: 'completed',
    currentThreadId: null,
    completedAt: RUN_AT,
    updatedAt: RUN_AT,
  }));
  await adapter.persistThread(createParentThread({
    threadId: 'thread_cli_terminal_foreground_publication',
    processId: 'process_cli_terminal_foreground_publication',
    jobId: 'job_cli_terminal_foreground_publication',
    status: 'completed',
    completedAt: RUN_AT,
    updatedAt: RUN_AT,
  }));

  const recoveryTick = await runOpenMasOsServiceTick({
    adapter,
    projectRootPath,
    now: () => FUTURE_RUN_AT,
    invocationRunner: async () => {
      throw new Error('Foreground completion recovery must not rerun terminal work.');
    },
  });
  const recoveredJob = await adapter.loadJob('job_cli_terminal_foreground_publication');
  const results = await adapter.findResultRecordsByProcess('process_cli_terminal_foreground_publication');

  assert.equal(recoveryTick.status, 'completed');
  assert.equal(recoveryTick.dispatches.length, 0);
  assert.equal(recoveryTick.foregroundResultRecovery.recoveredCount, 1);
  assert.equal(recoveredJob.status, 'completed');
  assert.equal(results.length, 1);
  assert.equal(results[0].resultKind, 'foreground_completion_result');
  assert.equal(results[0].status, 'completed');
  assert.equal(results[0].metadata.recovery.status, 'recovered_terminal_foreground_result');
});

test('runOpenMasOsServiceTick does not manufacture Result Records for terminal legacy history', async () => {
  const {
    projectRootPath,
    adapter,
  } = await createEmptyProjectFixture();

  await adapter.persistJob(createReadyJob({
    jobId: 'job_cli_legacy_terminal_without_result_contract',
    status: 'failed',
    createdBy: {
      type: 'human',
      id: 'cli',
    },
    trigger: {
      type: 'immediate',
    },
    updatedAt: RUN_AT,
  }));
  await adapter.persistProcess(createParentProcess({
    processId: 'process_cli_legacy_terminal_without_result_contract',
    jobId: 'job_cli_legacy_terminal_without_result_contract',
    status: 'failed',
    currentThreadId: null,
    failedAt: RUN_AT,
    completedAt: RUN_AT,
    updatedAt: RUN_AT,
  }));
  await adapter.persistThread(createParentThread({
    threadId: 'thread_cli_legacy_terminal_without_result_contract',
    processId: 'process_cli_legacy_terminal_without_result_contract',
    jobId: 'job_cli_legacy_terminal_without_result_contract',
    status: 'failed',
    failedAt: RUN_AT,
    completedAt: RUN_AT,
    updatedAt: RUN_AT,
  }));

  const result = await runOpenMasOsServiceTick({
    adapter,
    projectRootPath,
    now: () => FUTURE_RUN_AT,
  });
  const resultRecords = await adapter.findResultRecordsByProcess(
    'process_cli_legacy_terminal_without_result_contract',
  );

  assert.equal(result.status, 'idle');
  assert.equal(result.foregroundResultRecovery.failedCount, 0);
  assert.equal(result.foregroundResultRecovery.recoveredCount, 0);
  assert.equal(result.foregroundResultRecovery.legacySkippedCount, 1);
  assert.equal(result.parentResumeResultRecovery.scannedProcessCount, 0);
  assert.deepEqual(resultRecords, []);
});

test('runOpenMasOsServiceTick omits terminal evidence scans on an untriggered steady-state tick', async () => {
  const {
    projectRootPath,
    adapter,
  } = await createEmptyProjectFixture();

  await adapter.persistJob(createReadyJob({
    jobId: 'job_cli_historical_tick_not_scanned',
    status: 'failed',
    trigger: {
      type: 'immediate',
    },
    updatedAt: RUN_AT,
  }));
  await adapter.persistProcess(createParentProcess({
    processId: 'process_cli_historical_tick_not_scanned',
    jobId: 'job_cli_historical_tick_not_scanned',
    status: 'failed',
    currentThreadId: null,
    failedAt: RUN_AT,
    completedAt: RUN_AT,
    updatedAt: RUN_AT,
  }));

  const result = await runOpenMasOsServiceTick({
    adapter,
    projectRootPath,
    now: () => FUTURE_RUN_AT,
    recoverTerminalResultPublications: false,
  });

  assert.equal(result.status, 'idle');
  assert.equal(result.foregroundResultRecovery.scannedProcessCount, 0);
  assert.equal(result.scheduledChildRecovery.scannedTimerCount, 0);
  assert.equal(result.delegatedChildRecovery.scannedProcessCount, 0);
  assert.equal(result.parentResumeResultRecovery.scannedProcessCount, 0);
  assert.equal(
    result.foregroundResultRecovery.skippedReason,
    'steady_state_no_reconciliation_trigger',
  );
});

test('runOpenMasOsServiceTick does not recover blocked parent delegation waits as stale running invocations', async () => {
  const {
    projectRootPath,
    adapter,
  } = await createEmptyProjectFixture();

  await adapter.persistJob(createParentJob({
    jobId: 'job_cli_blocked_parent_alfred',
    projectId: 'project_openmas_cli',
    createdBy: {
      type: 'human',
      id: 'cli',
    },
    trigger: {
      type: 'immediate',
    },
  }));
  await adapter.persistProcess(createParentProcess({
    processId: 'process_cli_blocked_parent_alfred',
    jobId: 'job_cli_blocked_parent_alfred',
    status: 'blocked',
    currentThreadId: 'thread_cli_blocked_parent_alfred',
  }));
  await adapter.persistThread(createParentThread({
    threadId: 'thread_cli_blocked_parent_alfred',
    processId: 'process_cli_blocked_parent_alfred',
    jobId: 'job_cli_blocked_parent_alfred',
    status: 'blocked',
    waitReason: 'waiting_for_child_process',
  }));

  const result = await runOpenMasOsServiceTick({
    adapter,
    projectRootPath,
    now: () => RUN_AT,
    staleRunningInvocationAfterMs: 1000,
  });

  assert.equal(result.status, 'idle');
  assert.equal(result.recovery.scannedProcessCount, 0);
  assert.equal(result.recovery.recoveredCount, 0);
  assert.equal((await adapter.loadJob('job_cli_blocked_parent_alfred')).status, 'active');
  assert.equal((await adapter.loadProcess('process_cli_blocked_parent_alfred')).status, 'blocked');
  assert.equal((await adapter.loadThread('thread_cli_blocked_parent_alfred')).status, 'blocked');
});

test('runOpenMasOsServiceTick terminalizes historical foreground resource waits without a supported wake path', async () => {
  const {
    projectRootPath,
    adapter,
  } = await createEmptyProjectFixture();

  await adapter.persistJob(createParentJob({
    jobId: 'job_cli_unsupported_resource_wait',
    projectId: 'project_openmas_cli',
    createdBy: {
      type: 'human',
      id: 'cli',
    },
    trigger: {
      type: 'immediate',
    },
  }));
  await adapter.persistProcess(createParentProcess({
    processId: 'process_cli_unsupported_resource_wait',
    jobId: 'job_cli_unsupported_resource_wait',
    status: 'blocked',
    currentThreadId: 'thread_cli_unsupported_resource_wait',
  }));
  await adapter.persistThread(createParentThread({
    threadId: 'thread_cli_unsupported_resource_wait',
    processId: 'process_cli_unsupported_resource_wait',
    jobId: 'job_cli_unsupported_resource_wait',
    status: 'blocked',
    waitReason: 'waiting_for_resource',
  }));

  const result = await runOpenMasOsServiceTick({
    adapter,
    projectRootPath,
    now: () => RUN_AT,
  });
  const failedJob = await adapter.loadJob('job_cli_unsupported_resource_wait');
  const failedProcess = await adapter.loadProcess('process_cli_unsupported_resource_wait');
  const failedThread = await adapter.loadThread('thread_cli_unsupported_resource_wait');

  assert.equal(result.status, 'completed');
  assert.equal(result.unsupportedResourceWaitReconciliation.terminalizedCount, 1);
  assert.equal(failedJob.status, 'failed');
  assert.equal(failedProcess.status, 'failed');
  assert.equal(failedProcess.currentThreadId, null);
  assert.equal(failedThread.status, 'failed');
  assert.equal(failedThread.waitReason, null);
  assert.equal(failedThread.failureSummary.reasonCode, 'unsupported_foreground_resource_wait');
});

test('runOpenMasOsServiceTick recovers an abandoned delegated child and resumes its blocked parent from failed evidence', async () => {
  const {
    projectRootPath,
    adapter,
  } = await createEmptyProjectFixture();

  await adapter.persistJob(createParentJob());
  await adapter.persistProcess(createParentProcess({
    status: 'blocked',
  }));
  await adapter.persistThread(createParentThread({
    status: 'blocked',
    waitReason: 'waiting_for_child_process',
  }));
  await adapter.persistJob(createReadyJob({
    jobId: 'job_bruce_abandoned_delegated_child',
    status: 'active',
    createdBy: {
      type: 'process',
      id: 'process_parent_alfred',
    },
    assignedOperationalIdentityId: 'bruce',
    trigger: {
      type: 'manual',
    },
    updatedAt: RUN_AT,
  }));
  await adapter.persistProcess(createParentProcess({
    processId: 'process_bruce_abandoned_delegated_child',
    jobId: 'job_bruce_abandoned_delegated_child',
    operationalIdentityId: 'bruce',
    activeCognitiveIdentityId: null,
    currentThreadId: 'thread_bruce_abandoned_delegated_child',
    parentProcessId: 'process_parent_alfred',
    updatedAt: RUN_AT,
  }));
  await adapter.persistThread(createParentThread({
    threadId: 'thread_bruce_abandoned_delegated_child',
    processId: 'process_bruce_abandoned_delegated_child',
    jobId: 'job_bruce_abandoned_delegated_child',
    updatedAt: RUN_AT,
  }));

  const childRecoveryTick = await runOpenMasOsServiceTick({
    adapter,
    projectRootPath,
    now: () => FUTURE_RUN_AT,
    staleRunningInvocationAfterMs: 1,
  });
  const failedChild = await adapter.loadProcess('process_bruce_abandoned_delegated_child');
  const recoveredChildResults = await adapter.findResultRecordsByProcess('process_bruce_abandoned_delegated_child');

  assert.equal(childRecoveryTick.status, 'completed');
  assert.equal(childRecoveryTick.recovery.recoveredCount, 1);
  assert.equal(childRecoveryTick.recovery.recovered[0].reasonCode, 'stale_running_child_invocation_recovered');
  assert.equal(childRecoveryTick.delegatedChildRecovery.recoveredCount, 1);
  assert.equal(failedChild.status, 'failed');
  assert.equal(failedChild.failureSummary.reasonCode, 'stale_running_child_invocation_recovered');
  assert.equal(recoveredChildResults.length, 1);
  assert.equal(recoveredChildResults[0].resultKind, 'delegated_child_result');
  assert.equal(recoveredChildResults[0].status, 'failed');
  assert.equal(recoveredChildResults[0].failure.reasonCode, 'stale_running_child_invocation_recovered');
  assert.equal(recoveredChildResults[0].metadata.recovery.status, 'recovered_terminal_child_result');
  assert.equal((await adapter.loadProcess('process_parent_alfred')).status, 'blocked');

  const parentResumeTick = await runOpenMasOsServiceTick({
    adapter,
    projectRootPath,
    now: () => FUTURE_RUN_AT,
    invocationRunner: async () => {
      return {
        invocationId: 'invocation_alfred_resumed_after_abandoned_child',
        status: 'completed',
        message: 'Alfred safely resumed from the recovered failed child evidence.',
        warnings: [],
        errors: [],
        persistence: null,
      };
    },
  });
  const childResults = await adapter.findResultRecordsByProcess('process_bruce_abandoned_delegated_child');

  assert.equal(parentResumeTick.status, 'completed');
  assert.equal(parentResumeTick.parentWaitRecovery.recoveredCount, 1);
  assert.equal(parentResumeTick.delegatedChildRecovery.recoveredCount, 0);
  assert.equal(parentResumeTick.dispatches[0].dispatchType, 'parent_resume');
  assert.equal(childResults.length, 1);
  assert.equal(childResults[0].resultKind, 'delegated_child_result');
  assert.equal(childResults[0].status, 'failed');
  assert.equal(childResults[0].failure.reasonCode, 'stale_running_child_invocation_recovered');
  assert.equal((await adapter.loadProcess('process_parent_alfred')).status, 'completed');
});

test('runOpenMasOsServiceTick processes an immediate delegation System Call before dispatching ready work', async () => {
  const {
    projectRootPath,
    adapter,
    inbox,
  } = await createSystemCallDelegationFixture();
  let invocationRequest = null;

  await inbox.submitSystemCall(createSystemCall());

  const result = await runOpenMasOsServiceTick({
    adapter,
    projectRootPath,
    serviceId: 'openmas_os_service_syscall_tick_test',
    now: () => RUN_AT,
    invocationRunner: async (request) => {
      invocationRequest = request;

      return {
        invocationId: 'invocation_bruce_syscall_delegate_completed_001',
        status: 'completed',
        message: 'Bruce completed the delegated inspection.',
        warnings: [],
        errors: [],
        persistence: null,
      };
    },
  });
  const systemCallResult = await inbox.loadSystemCallResult('syscall_delegate_service_tick_001');
  const childJob = await adapter.loadJob('job_syscall_delegate_service_tick_001');
  const parentProcess = await adapter.loadProcess('process_parent_alfred');

  assert.equal(result.status, 'completed');
  assert.equal(result.systemCalls.processedCount, 1);
  assert.equal(result.systemCalls.completedCount, 1);
  assert.equal(result.systemCalls.results[0].systemCallId, 'syscall_delegate_service_tick_001');
  assert.deepEqual(result.systemCalls.results[0].createdJobIds, ['job_syscall_delegate_service_tick_001']);
  assert.equal(result.release.releasedCount, 0);
  assert.equal(result.readyWork.candidateCount, 1);
  assert.equal(result.readyWork.dispatchedCount, 1);
  assert.equal(result.dispatches.length, 1);
  assert.equal(result.dispatches[0].dispatchType, 'delegation');
  assert.equal(result.dispatches[0].jobId, 'job_syscall_delegate_service_tick_001');
  assert.equal(result.dispatches[0].jobStatus, 'completed');
  assert.equal(result.dispatches[0].parentNotification.notified, true);
  assert.equal(result.dispatches[0].parentNotification.status, 'ready');
  assert.equal(systemCallResult.processedBy.serviceId, 'openmas_os_service_syscall_tick_test');
  assert.equal(systemCallResult.processedBy.tickId, result.tickId);
  assert.equal(childJob.status, 'completed');
  assert.equal(parentProcess.status, 'ready');
  assert.equal(invocationRequest.operationalIdentityId, 'bruce');
  assert.equal(invocationRequest.osRuntimeContext.parentProcessId, 'process_parent_alfred');
});

test('runOpenMasOsServiceTick dispatches ready parent resume Threads after delegated child completion', async () => {
  const {
    projectRootPath,
    adapter,
    inbox,
  } = await createSystemCallDelegationFixture();
  const invocationRequests = [];

  await inbox.submitSystemCall(createSystemCall());

  const childTick = await runOpenMasOsServiceTick({
    adapter,
    projectRootPath,
    serviceId: 'openmas_os_service_parent_resume_child_tick_test',
    now: () => RUN_AT,
    invocationRunner: async (request) => {
      invocationRequests.push(request);

      return {
        invocationId: 'invocation_bruce_syscall_delegate_completed_for_parent_resume_001',
        status: 'completed',
        message: 'Bruce completed the delegated inspection for parent resume.',
        warnings: [],
        errors: [],
        persistence: null,
      };
    },
  });
  const readyParentProcess = await adapter.loadProcess('process_parent_alfred');
  const readyParentThread = await adapter.loadThread(readyParentProcess.currentThreadId);

  assert.equal(childTick.status, 'completed');
  assert.equal(childTick.dispatches[0].dispatchType, 'delegation');
  assert.equal(readyParentProcess.status, 'ready');
  assert.equal(readyParentThread.status, 'ready');
  assert.equal(readyParentThread.threadType, 'child_process_wait');

  const parentResumeTick = await runOpenMasOsServiceTick({
    adapter,
    projectRootPath,
    serviceId: 'openmas_os_service_parent_resume_tick_test',
    now: () => RUN_AT,
    invocationRunner: async (request) => {
      invocationRequests.push(request);

      return {
        invocationId: 'invocation_alfred_parent_resume_completed_001',
        status: 'completed',
        message: 'Alfred resumed after Bruce and produced the final answer.',
        warnings: [],
        errors: [],
        persistence: null,
      };
    },
  });
  const parentJob = await adapter.loadJob('job_parent_alfred');
  const parentProcess = await adapter.loadProcess('process_parent_alfred');
  const parentThread = await adapter.loadThread(readyParentThread.threadId);

  assert.equal(parentResumeTick.status, 'completed');
  assert.equal(parentResumeTick.systemCalls.processedCount, 0);
  assert.equal(parentResumeTick.readyWork.candidateCount, 1);
  assert.equal(parentResumeTick.readyWork.dispatchedCount, 1);
  assert.equal(parentResumeTick.dispatches.length, 1);
  assert.equal(parentResumeTick.dispatches[0].dispatchType, 'parent_resume');
  assert.equal(parentResumeTick.dispatches[0].dispatchSource, 'ready_parent_resume_thread');
  assert.equal(parentResumeTick.dispatches[0].jobId, 'job_parent_alfred');
  assert.equal(parentResumeTick.dispatches[0].jobStatus, 'completed');
  assert.equal(parentResumeTick.dispatches[0].processStatus, 'completed');
  assert.equal(parentResumeTick.dispatches[0].threadStatus, 'completed');
  assert.equal(parentResumeTick.dispatches[0].parentResume.status, 'final_answer_completed');
  assert.equal(parentJob.status, 'completed');
  assert.equal(parentProcess.status, 'completed');
  assert.equal(parentProcess.currentThreadId, null);
  assert.equal(parentThread.status, 'completed');
  assert.equal(invocationRequests[0].operationalIdentityId, 'bruce');
  assert.equal(invocationRequests[1].operationalIdentityId, 'alfred');
  assert.equal(invocationRequests[1].osRuntimeContext.source, 'openmas-os-parent-resume');
  assert.match(invocationRequests[1].inputText, /OpenMAS OS parent resume notice/u);
  assert.match(invocationRequests[1].inputText, /job_syscall_delegate_service_tick_001/u);
});

test('runOpenMasOsServiceTick fails an abandoned parent resume and materializes its terminal Result evidence', async () => {
  const {
    projectRootPath,
    adapter,
    inbox,
  } = await createSystemCallDelegationFixture();

  await inbox.submitSystemCall(createSystemCall({
    systemCallId: 'syscall_delegate_parent_resume_abandoned_001',
    idempotencyKey: 'delegate:parent-resume-abandoned:alfred:bruce:001',
  }));

  await runOpenMasOsServiceTick({
    adapter,
    projectRootPath,
    now: () => RUN_AT,
    invocationRunner: async () => {
      return {
        invocationId: 'invocation_bruce_before_parent_resume_abandoned',
        status: 'completed',
        message: 'Bruce completed before the parent owner disappeared.',
        warnings: [],
        errors: [],
        persistence: null,
      };
    },
  });

  const readyParentProcess = await adapter.loadProcess('process_parent_alfred');
  const readyParentThread = await adapter.loadThread(readyParentProcess.currentThreadId);

  await adapter.persistThread({
    ...readyParentThread,
    status: 'running',
    startedAt: RUN_AT,
    updatedAt: RUN_AT,
  });
  await adapter.persistProcess({
    ...readyParentProcess,
    status: 'running',
    updatedAt: RUN_AT,
  });

  const recoveryTick = await runOpenMasOsServiceTick({
    adapter,
    projectRootPath,
    now: () => FUTURE_RUN_AT,
    staleRunningInvocationAfterMs: 1,
  });
  const failedParentProcess = await adapter.loadProcess('process_parent_alfred');
  const parentResults = await adapter.listResultRecords({
    resultKind: 'parent_resume_result',
    processId: 'process_parent_alfred',
  });

  assert.equal(recoveryTick.status, 'completed');
  assert.equal(recoveryTick.recovery.recoveredCount, 1);
  assert.equal(recoveryTick.recovery.recovered[0].reasonCode, 'stale_running_parent_resume_recovered');
  assert.equal(recoveryTick.parentResumeResultRecovery.recoveredCount, 1);
  assert.equal(failedParentProcess.status, 'failed');
  assert.equal(failedParentProcess.failureSummary.reasonCode, 'stale_running_parent_resume_recovered');
  assert.equal(parentResults.length, 1);
  assert.equal(parentResults[0].status, 'failed');
  assert.equal(parentResults[0].failure.reasonCode, 'stale_running_parent_resume_recovered');
  assert.equal(parentResults[0].metadata.recovery.status, 'recovered_terminal_parent_resume_result');
  assert.equal(parentResults[0].childResultRefs.length, 1);
});

test('runOpenMasOsServiceTick recovers a parent stuck waiting for a System Call after its child already finished', async () => {
  const {
    projectRootPath,
    adapter,
  } = await createEmptyProjectFixture();
  const invocationRequests = [];

  await adapter.persistJob(createParentJob());
  await adapter.persistProcess(createParentProcess({
    status: 'blocked',
  }));
  await adapter.persistThread(createParentThread({
    status: 'blocked',
    waitReason: 'waiting_for_system_call',
  }));
  await adapter.persistJob(createReadyJob({
    jobId: 'job_bruce_lost_parent_wait_child',
    status: 'completed',
    createdBy: {
      type: 'process',
      id: 'process_parent_alfred',
    },
    assignedOperationalIdentityId: 'bruce',
    conversationId: 'os-m2-local-service-smoke',
    updatedAt: RUN_AT,
  }));
  await adapter.persistProcess(createParentProcess({
    processId: 'process_bruce_lost_parent_wait_child',
    jobId: 'job_bruce_lost_parent_wait_child',
    status: 'completed',
    operationalIdentityId: 'bruce',
    activeCognitiveIdentityId: null,
    currentThreadId: null,
    parentProcessId: 'process_parent_alfred',
    completedAt: RUN_AT,
    updatedAt: RUN_AT,
  }));

  const result = await runOpenMasOsServiceTick({
    adapter,
    projectRootPath,
    serviceId: 'openmas_os_service_parent_wait_recovery_test',
    now: () => RUN_AT,
    invocationRunner: async (request) => {
      invocationRequests.push(request);

      return {
        invocationId: 'invocation_alfred_parent_wait_recovery_completed_001',
        status: 'completed',
        message: 'Alfred resumed after recovered child completion.',
        warnings: [],
        errors: [],
        persistence: null,
      };
    },
  });
  const parentJob = await adapter.loadJob('job_parent_alfred');
  const parentProcess = await adapter.loadProcess('process_parent_alfred');
  const oldParentThread = await adapter.loadThread('thread_parent_alfred');
  const eventTypes = (await adapter.readEvents({ date: '2026-05-15' }))
    .map((event) => event.eventType);

  assert.equal(result.status, 'completed');
  assert.equal(result.parentWaitRecovery.scannedProcessCount, 1);
  assert.equal(result.parentWaitRecovery.candidateCount, 1);
  assert.equal(result.parentWaitRecovery.recoveredCount, 1);
  assert.equal(result.readyWork.candidateCount, 1);
  assert.equal(result.dispatches.length, 1);
  assert.equal(result.dispatches[0].dispatchType, 'parent_resume');
  assert.equal(result.dispatches[0].jobStatus, 'completed');
  assert.equal(parentJob.status, 'completed');
  assert.equal(parentProcess.status, 'completed');
  assert.equal(parentProcess.currentThreadId, null);
  assert.equal(oldParentThread.status, 'completed');
  assert.equal(invocationRequests[0].operationalIdentityId, 'alfred');
  assert.equal(invocationRequests[0].osRuntimeContext.source, 'openmas-os-parent-resume');
  assert.ok(eventTypes.includes('os.service.parent_wait.recovered'));
  assert.equal(eventTypes.includes('signal.ignored'), false);
});

test('runOpenMasOsServiceTick processes a due scheduled delegation System Call before timer release', async () => {
  const {
    projectRootPath,
    adapter,
    inbox,
  } = await createSystemCallDelegationFixture();
  let invocationRequest = null;

  await inbox.submitSystemCall(createScheduleDelegationSystemCall());

  const result = await runOpenMasOsServiceTick({
    adapter,
    projectRootPath,
    now: () => RUN_AT,
    invocationRunner: async (request) => {
      invocationRequest = request;

      return {
        invocationId: 'invocation_bruce_syscall_scheduled_completed_001',
        status: 'completed',
        message: 'Bruce completed the scheduled syscall inspection.',
        warnings: [],
        errors: [],
        persistence: null,
      };
    },
  });
  const systemCallResult = await inbox.loadSystemCallResult('syscall_schedule_delegation_service_tick_001');

  assert.equal(result.status, 'completed');
  assert.equal(result.systemCalls.processedCount, 1);
  assert.equal(result.systemCalls.completedCount, 1);
  assert.deepEqual(systemCallResult.effects.createdJobIds, ['job_syscall_schedule_delegation_service_tick_001']);
  assert.deepEqual(systemCallResult.effects.createdTimerIds, ['timer_job_syscall_schedule_delegation_service_tick_001']);
  assert.equal(result.release.releasedCount, 1);
  assert.equal(result.readyWork.candidateCount, 1);
  assert.equal(result.dispatches.length, 1);
  assert.equal(result.dispatches[0].dispatchType, 'scheduled_delegation');
  assert.equal(result.dispatches[0].jobId, 'job_syscall_schedule_delegation_service_tick_001');
  assert.equal(result.dispatches[0].timerId, 'timer_job_syscall_schedule_delegation_service_tick_001');
  assert.equal(result.dispatches[0].jobStatus, 'completed');
  assert.equal(invocationRequest.operationalIdentityId, 'bruce');
});

test('runOpenMasOsServiceTick keeps dispatching work when the System Call Processor fails', async () => {
  const {
    projectRootPath,
    adapter,
  } = await createEmptyProjectFixture();
  const rawSecret = buildFakeOpenRouterSecretProbe('systemCallProcessorSecret123456789');

  await adapter.persistJob(createReadyJob());

  const result = await runOpenMasOsServiceTick({
    adapter,
    projectRootPath,
    now: () => RUN_AT,
    systemCallProcessor: {
      processPendingSystemCalls: async () => {
        throw new Error(`Processor exploded with ${rawSecret}`);
      },
    },
    invocationRunner: async () => {
      return {
        invocationId: 'invocation_ready_after_syscall_failure_001',
        status: 'completed',
        message: 'Ready work still completed.',
        warnings: [],
        errors: [],
        persistence: null,
      };
    },
  });
  const serializedResult = JSON.stringify(result);

  assert.equal(result.status, 'completed_with_failures');
  assert.equal(result.systemCalls.status, 'failed');
  assert.equal(result.systemCalls.failedCount, 1);
  assert.match(result.systemCalls.errorMessage, /\[redacted-secret\]/u);
  assert.equal(result.dispatches.length, 1);
  assert.equal(result.dispatches[0].jobStatus, 'completed');
  assert.equal((await adapter.loadJob('job_ready_alfred')).status, 'completed');
  assert.doesNotMatch(serializedResult, new RegExp(rawSecret, 'u'));
});

test('runOpenMasOsServiceTick leaves future scheduled delegation pending', async () => {
  const {
    adapter,
    childJobId,
    timerId,
    projectRootPath,
  } = await createScheduledDelegationFixture({
    runAt: FUTURE_RUN_AT,
  });
  const result = await runOpenMasOsServiceTick({
    adapter,
    projectRootPath,
    now: () => RUN_AT,
  });

  assert.equal(result.status, 'idle');
  assert.equal(result.release.releasedCount, 0);
  assert.equal(result.release.pendingCount, 1);
  assert.equal(result.readyWork.candidateCount, 0);
  assert.equal((await adapter.loadJob(childJobId)).status, 'scheduled');
  assert.equal((await adapter.loadTimer(timerId)).status, 'scheduled');
});

test('runOpenMasOsServiceTick releases and runs due scheduled delegation through child execution', async () => {
  const {
    adapter,
    childJobId,
    timerId,
    projectRootPath,
  } = await createScheduledDelegationFixture();
  let invocationRequest = null;
  const result = await runOpenMasOsServiceTick({
    adapter,
    projectRootPath,
    now: () => RUN_AT,
    invocationRunner: async (request) => {
      invocationRequest = request;

      return {
        invocationId: 'invocation_bruce_service_tick_completed_001',
        status: 'completed',
        message: 'Bruce completed the scheduled inspection.',
        warnings: [],
        errors: [],
        persistence: null,
      };
    },
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.release.releasedCount, 1);
  assert.equal(result.readyWork.candidateCount, 1);
  assert.equal(result.readyWork.dispatchedCount, 1);
  assert.equal(result.dispatches.length, 1);
  assert.equal(result.dispatches[0].dispatchType, 'scheduled_delegation');
  assert.equal(result.dispatches[0].dispatchSource, 'released_timer');
  assert.equal(result.dispatches[0].jobId, childJobId);
  assert.equal(result.dispatches[0].jobStatus, 'completed');
  assert.equal(result.dispatches[0].processStatus, 'completed');
  assert.equal(result.dispatches[0].threadStatus, 'completed');
  assert.equal(result.dispatches[0].timerId, timerId);
  assert.equal(result.dispatches[0].timerStatus, 'fired');
  assert.equal(result.dispatches[0].parentNotification, null);
  assert.equal(result.dispatches[0].parentCompletion.mode, 'scheduled_delegation_async');
  assert.equal(result.dispatches[0].parentCompletion.status, 'not_expected');
  assert.equal(result.dispatches[0].childResultKind, 'scheduled_child_result');
  assert.ok(result.dispatches[0].childResultRef);
  assert.equal(invocationRequest.operationalIdentityId, 'bruce');
  assert.equal(invocationRequest.command, 'ask');
  assert.equal(invocationRequest.inputText, 'Inspect the MAS and report findings.');
  assert.equal(invocationRequest.osRuntimeContext.parentProcessId, 'process_parent_alfred');
  assert.equal((await adapter.loadJob(childJobId)).status, 'completed');
  const firedTimer = await adapter.loadTimer(timerId);
  const releaseResult = await adapter.loadResultRecord(firedTimer.payload.releaseResultRef);
  const childResult = await adapter.loadResultRecord(firedTimer.payload.childResultRef);
  const childJobResults = await adapter.findResultRecordsByJob(childJobId);

  assert.equal(firedTimer.status, 'fired');
  assert.equal(firedTimer.payload.sourceSystemCallId, 'syscall_schedule_delegation_for_service_tick_001');
  assert.equal(firedTimer.payload.deliveryMode, 'persist_only');
  assert.equal(releaseResult.resultKind, 'scheduled_release_result');
  assert.equal(releaseResult.status, 'released');
  assert.equal(releaseResult.lineage.timerId, timerId);
  assert.equal(releaseResult.lineage.systemCallId, 'syscall_schedule_delegation_for_service_tick_001');
  assert.equal(releaseResult.metadata.delivery.childCompletionProven, false);
  assert.equal(childResult.resultKind, 'scheduled_child_result');
  assert.equal(childResult.status, 'completed');
  assert.equal(childResult.lineage.jobId, childJobId);
  assert.equal(childResult.lineage.processId, result.dispatches[0].processId);
  assert.equal(childResult.lineage.timerId, timerId);
  assert.equal(childResult.lineage.systemCallId, 'syscall_schedule_delegation_for_service_tick_001');
  assert.equal(childResult.metadata.schedule.releaseResultRef, releaseResult.resultId);
  assert.equal(childResult.metadata.delivery.mode, 'persist_only');
  assert.equal(childResult.metadata.delivery.parentNotificationAttempted, false);
  assert.ok(childJobResults.some((record) => record.resultKind === 'scheduled_submission_result'));
  assert.ok(childJobResults.some((record) => record.resultKind === 'scheduled_release_result'));
  assert.ok(childJobResults.some((record) => record.resultKind === 'scheduled_child_result'));

  const eventTypes = (await adapter.readEvents({ date: '2026-05-15' }))
    .map((event) => event.eventType);

  assert.ok(eventTypes.includes('os.service.tick.started'));
  assert.ok(eventTypes.includes('timer.fired'));
  assert.ok(eventTypes.includes('job.due'));
  assert.ok(eventTypes.includes('job.completed'));
  assert.equal(eventTypes.includes('signal.ignored'), false);
  assert.ok(eventTypes.includes('os.service.tick.completed'));
});

test('runOpenMasOsServiceTick persists due scheduled delegation failures without raw secret-like values in service output', async () => {
  const {
    adapter,
    childJobId,
    timerId,
    projectRootPath,
  } = await createScheduledDelegationFixture();
  const rawSecret = buildFakeOpenRouterSecretProbe('serviceTickSecret123456789');
  const result = await runOpenMasOsServiceTick({
    adapter,
    projectRootPath,
    now: () => RUN_AT,
    invocationRunner: async () => {
      throw new Error(`Provider rejected ${rawSecret}`);
    },
  });

  assert.equal(result.status, 'completed_with_failures');
  assert.equal(result.dispatches.length, 1);
  assert.equal(result.dispatches[0].dispatchType, 'scheduled_delegation');
  assert.equal(result.dispatches[0].jobStatus, 'failed');
  assert.equal(result.dispatches[0].processStatus, 'failed');
  assert.equal(result.dispatches[0].threadStatus, 'failed');
  const failedJob = await adapter.loadJob(childJobId);
  const failedProcess = await adapter.loadProcess(result.dispatches[0].processId);
  const failedThread = await adapter.loadThread(result.dispatches[0].threadId);
  const firedTimer = await adapter.loadTimer(timerId);
  const childResult = await adapter.loadResultRecord(firedTimer.payload.childResultRef);

  assert.equal(failedJob.status, 'failed');
  assert.equal(failedJob.failedAt, RUN_AT);
  assert.equal(failedProcess.failedAt, RUN_AT);
  assert.equal(failedThread.failedAt, RUN_AT);
  assert.equal(failedJob.failureSummary.reasonCode, 'invocation_failed');
  assert.equal(failedProcess.failureSummary.reasonCode, 'invocation_failed');
  assert.equal(failedThread.failureSummary.reasonCode, 'invocation_failed');
  assert.equal(result.dispatches[0].childResultKind, 'scheduled_child_result');
  assert.equal(childResult.resultKind, 'scheduled_child_result');
  assert.equal(childResult.status, 'failed');
  assert.equal(childResult.failure.reasonCode, 'invocation_failed');
  assert.equal(childResult.lineage.timerId, timerId);
  assert.equal(childResult.metadata.delivery.mode, 'persist_only');
  assert.equal(childResult.metadata.delivery.parentNotificationAttempted, false);

  const serializedServiceResult = JSON.stringify(result);
  const serializedEvents = JSON.stringify(await adapter.readEvents({ date: '2026-05-15' }));

  assert.doesNotMatch(serializedServiceResult, new RegExp(rawSecret, 'u'));
  assert.doesNotMatch(serializedEvents, new RegExp(rawSecret, 'u'));
  assert.match(serializedEvents, /"failureSummary"/u);
});

test('runOpenMasOsServiceTick settles scheduled persist-only child evidence through the asynchronous executor', async () => {
  const {
    adapter,
    childJobId,
    timerId,
    projectRootPath,
  } = await createScheduledDelegationFixture();
  const executor = createLocalAsyncDispatchExecutor({
    maxConcurrentExecutions: 1,
  });
  let releaseInvocation;
  let markInvocationStarted;
  const invocationStarted = new Promise((resolve) => {
    markInvocationStarted = resolve;
  });
  const invocationRelease = new Promise((resolve) => {
    releaseInvocation = resolve;
  });

  const admissionTick = await runOpenMasOsServiceTick({
    adapter,
    projectRootPath,
    now: () => RUN_AT,
    asyncDispatchExecutor: executor,
    invocationRunner: async () => {
      markInvocationStarted();
      await invocationRelease;

      return {
        invocationId: 'invocation_bruce_async_scheduled_completed_001',
        status: 'completed',
        message: 'Bruce completed asynchronous scheduled work.',
        warnings: [],
        errors: [],
        persistence: null,
      };
    },
  });

  assert.equal(admissionTick.dispatches.length, 1);
  assert.equal(admissionTick.dispatches[0].dispatchType, 'scheduled_delegation');
  assert.equal(admissionTick.dispatches[0].status, 'queued');
  assert.equal(admissionTick.dispatches[0].childResultRef, null);

  await invocationStarted;

  const timerDuringExecution = await adapter.loadTimer(timerId);
  const releaseResult = await adapter.loadResultRecord(timerDuringExecution.payload.releaseResultRef);

  assert.equal(timerDuringExecution.status, 'fired');
  assert.equal(timerDuringExecution.payload.childResultRef, undefined);
  assert.equal(releaseResult.status, 'released');
  assert.equal(releaseResult.metadata.delivery.childCompletionProven, false);

  releaseInvocation();
  await executor.waitForIdle();

  const settlementTick = await runOpenMasOsServiceTick({
    adapter,
    projectRootPath,
    now: () => FUTURE_RUN_AT,
    asyncDispatchExecutor: executor,
  });
  const finalTimer = await adapter.loadTimer(timerId);
  const childResult = await adapter.loadResultRecord(finalTimer.payload.childResultRef);
  const parentResumeResults = await adapter.listResultRecords({
    resultKind: 'parent_resume_result',
  });

  assert.equal(settlementTick.settledDispatches.length, 1);
  assert.equal(settlementTick.settledDispatches[0].dispatchType, 'scheduled_delegation');
  assert.equal(settlementTick.settledDispatches[0].childResultKind, 'scheduled_child_result');
  assert.equal(settlementTick.settledDispatches[0].childResultRef, childResult.resultId);
  assert.equal((await adapter.loadJob(childJobId)).status, 'completed');
  assert.equal(childResult.status, 'completed');
  assert.equal(childResult.lineage.timerId, timerId);
  assert.equal(childResult.metadata.delivery.mode, 'persist_only');
  assert.equal(parentResumeResults.length, 0);
  assert.equal((await adapter.loadProcess('process_parent_alfred')).status, 'running');
});

test('runOpenMasOsServiceTick recovers a terminal scheduled child whose Result publication was interrupted', async () => {
  const {
    adapter,
    childJobId,
    timerId,
    projectRootPath,
  } = await createScheduledDelegationFixture();

  await releaseDueOneShotJobs({
    adapter,
    now: () => RUN_AT,
  });
  const readyChildJob = await adapter.loadJob(childJobId);

  await adapter.persistJob({
    ...readyChildJob,
    status: 'active',
    updatedAt: RUN_AT,
  });
  await adapter.persistProcess(createParentProcess({
    processId: 'process_bruce_scheduled_interrupted_publication',
    jobId: childJobId,
    status: 'completed',
    operationalIdentityId: 'bruce',
    activeCognitiveIdentityId: null,
    currentThreadId: null,
    parentProcessId: 'process_parent_alfred',
    completedAt: RUN_AT,
    updatedAt: RUN_AT,
  }));
  await adapter.persistThread(createParentThread({
    threadId: 'thread_bruce_scheduled_interrupted_publication',
    processId: 'process_bruce_scheduled_interrupted_publication',
    jobId: childJobId,
    status: 'completed',
    threadType: 'agent_invocation',
    waitReason: null,
    completedAt: RUN_AT,
    updatedAt: RUN_AT,
  }));

  const recoveryTick = await runOpenMasOsServiceTick({
    adapter,
    projectRootPath,
    now: () => FUTURE_RUN_AT,
    invocationRunner: async () => {
      throw new Error('Terminal scheduled child recovery must not execute the Agent again.');
    },
  });
  const repairedTimer = await adapter.loadTimer(timerId);
  const recoveredResult = await adapter.loadResultRecord(repairedTimer.payload.childResultRef);
  const recoveredJob = await adapter.loadJob(childJobId);

  assert.equal(recoveryTick.status, 'completed');
  assert.equal(recoveryTick.dispatches.length, 0);
  assert.equal(recoveryTick.scheduledChildRecovery.candidateCount, 1);
  assert.equal(recoveryTick.scheduledChildRecovery.recoveredCount, 1);
  assert.equal(recoveredJob.status, 'completed');
  assert.equal(recoveredResult.resultKind, 'scheduled_child_result');
  assert.equal(recoveredResult.status, 'completed');
  assert.equal(recoveredResult.lineage.jobId, childJobId);
  assert.equal(recoveredResult.lineage.timerId, timerId);
  assert.equal(recoveredResult.metadata.schedule.recoveryStatus, 'recovered_terminal_child_result');
  assert.equal(recoveredResult.metadata.delivery.mode, 'persist_only');

  const idempotencyTick = await runOpenMasOsServiceTick({
    adapter,
    projectRootPath,
    now: () => FUTURE_RUN_AT,
  });
  const childResults = await adapter.listResultRecords({
    resultKind: 'scheduled_child_result',
  });

  assert.equal(idempotencyTick.status, 'idle');
  assert.equal(idempotencyTick.scheduledChildRecovery.recoveredCount, 0);
  assert.equal(childResults.length, 1);
});

test('runOpenMasOsServiceTick defers scheduled Result reconstruction while the current executor still owns the child Job', async () => {
  const {
    adapter,
    childJobId,
    timerId,
    projectRootPath,
  } = await createScheduledDelegationFixture();
  const executor = createLocalAsyncDispatchExecutor({
    maxConcurrentExecutions: 1,
  });

  await releaseDueOneShotJobs({
    adapter,
    now: () => RUN_AT,
  });
  const readyChildJob = await adapter.loadJob(childJobId);

  await adapter.persistJob({
    ...readyChildJob,
    status: 'completed',
    updatedAt: RUN_AT,
  });
  await adapter.persistProcess(createParentProcess({
    processId: 'process_bruce_scheduled_owned_publication',
    jobId: childJobId,
    status: 'completed',
    operationalIdentityId: 'bruce',
    activeCognitiveIdentityId: null,
    currentThreadId: null,
    parentProcessId: 'process_parent_alfred',
    completedAt: RUN_AT,
    updatedAt: RUN_AT,
  }));
  await adapter.persistThread(createParentThread({
    threadId: 'thread_bruce_scheduled_owned_publication',
    processId: 'process_bruce_scheduled_owned_publication',
    jobId: childJobId,
    status: 'completed',
    threadType: 'agent_invocation',
    waitReason: null,
    completedAt: RUN_AT,
    updatedAt: RUN_AT,
  }));

  let releaseOwner;
  const ownerRelease = new Promise((resolve) => {
    releaseOwner = resolve;
  });

  executor.submit({
    candidate: {
      source: 'released_timer',
      job: await adapter.loadJob(childJobId),
      timer: await adapter.loadTimer(timerId),
    },
    execute: async () => {
      await ownerRelease;
      return {
        status: 'completed',
      };
    },
  });

  const ownerTick = await runOpenMasOsServiceTick({
    adapter,
    projectRootPath,
    now: () => FUTURE_RUN_AT,
    asyncDispatchExecutor: executor,
  });

  assert.equal(ownerTick.scheduledChildRecovery.activeExecutionSkippedCount, 1);
  assert.equal(ownerTick.scheduledChildRecovery.recoveredCount, 0);
  assert.equal((await adapter.loadTimer(timerId)).payload.childResultRef, undefined);

  releaseOwner();
  await executor.waitForIdle();

  const successorTick = await runOpenMasOsServiceTick({
    adapter,
    projectRootPath,
    now: () => FUTURE_RUN_AT,
    asyncDispatchExecutor: executor,
  });
  const repairedTimer = await adapter.loadTimer(timerId);

  assert.equal(successorTick.scheduledChildRecovery.recoveredCount, 1);
  assert.ok(repairedTimer.payload.childResultRef);
});

test('runOpenMasOsServiceTick fails an abandoned scheduled child and materializes its durable scheduled Result', async () => {
  const {
    adapter,
    childJobId,
    timerId,
    projectRootPath,
  } = await createScheduledDelegationFixture();

  await releaseDueOneShotJobs({
    adapter,
    now: () => RUN_AT,
  });
  const readyChildJob = await adapter.loadJob(childJobId);

  await adapter.persistJob({
    ...readyChildJob,
    status: 'active',
    updatedAt: RUN_AT,
  });
  await adapter.persistProcess(createParentProcess({
    processId: 'process_bruce_scheduled_abandoned',
    jobId: childJobId,
    operationalIdentityId: 'bruce',
    activeCognitiveIdentityId: null,
    currentThreadId: 'thread_bruce_scheduled_abandoned',
    parentProcessId: 'process_parent_alfred',
    updatedAt: RUN_AT,
  }));
  await adapter.persistThread(createParentThread({
    threadId: 'thread_bruce_scheduled_abandoned',
    processId: 'process_bruce_scheduled_abandoned',
    jobId: childJobId,
    status: 'completed',
    completedAt: RUN_AT,
    updatedAt: RUN_AT,
  }));

  const recoveryTick = await runOpenMasOsServiceTick({
    adapter,
    projectRootPath,
    now: () => FUTURE_RUN_AT,
    staleRunningInvocationAfterMs: 1,
  });
  const failedJob = await adapter.loadJob(childJobId);
  const failedProcess = await adapter.loadProcess('process_bruce_scheduled_abandoned');
  const failedThread = await adapter.loadThread('thread_bruce_scheduled_abandoned');
  const repairedTimer = await adapter.loadTimer(timerId);
  const recoveredResult = await adapter.loadResultRecord(repairedTimer.payload.childResultRef);

  assert.equal(recoveryTick.status, 'completed');
  assert.equal(recoveryTick.recovery.recoveredCount, 1);
  assert.equal(recoveryTick.recovery.recovered[0].reasonCode, 'stale_running_child_invocation_recovered');
  assert.equal(recoveryTick.scheduledChildRecovery.recoveredCount, 1);
  assert.equal(failedJob.status, 'failed');
  assert.equal(failedProcess.status, 'failed');
  assert.equal(failedThread.status, 'failed');
  assert.equal(failedProcess.failureSummary.reasonCode, 'stale_running_child_invocation_recovered');
  assert.equal(recoveredResult.status, 'failed');
  assert.equal(recoveredResult.failure.reasonCode, 'stale_running_child_invocation_recovered');
  assert.equal(recoveredResult.metadata.schedule.recoveryStatus, 'recovered_terminal_child_result');
});

test('runOpenMasOsServiceTick dispatches supported ready Job snapshots even when no timer is released in the same tick', async () => {
  const {
    projectRootPath,
    adapter,
  } = await createEmptyProjectFixture();
  let invocationRequest = null;

  await adapter.persistJob(createReadyJob());

  const result = await runOpenMasOsServiceTick({
    adapter,
    projectRootPath,
    now: () => RUN_AT,
    invocationRunner: async (request) => {
      invocationRequest = request;

      return {
        invocationId: 'invocation_ready_job_service_tick_completed_001',
        status: 'completed',
        message: 'Ready work completed.',
        warnings: [],
        errors: [],
        persistence: null,
      };
    },
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.release.releasedCount, 0);
  assert.equal(result.readyWork.candidateCount, 1);
  assert.equal(result.dispatches.length, 1);
  assert.equal(result.dispatches[0].dispatchType, 'ready_job');
  assert.equal(result.dispatches[0].dispatchSource, 'ready_snapshot');
  assert.equal(result.dispatches[0].timerId, null);
  assert.equal(result.dispatches[0].jobStatus, 'completed');
  assert.equal(invocationRequest.operationalIdentityId, 'alfred');
  assert.equal(invocationRequest.inputText, 'Run ready local service work.');
  assert.equal((await adapter.loadJob('job_ready_alfred')).status, 'completed');
});

test('runOpenMasOsServiceTick queues asynchronous execution without waiting for provider completion or stale-recovering its active Job', async () => {
  const {
    projectRootPath,
    adapter,
  } = await createEmptyProjectFixture();
  const executor = createLocalAsyncDispatchExecutor({
    maxConcurrentExecutions: 1,
  });
  let releaseInvocation;
  let markInvocationStarted;
  const invocationStarted = new Promise((resolve) => {
    markInvocationStarted = resolve;
  });
  const invocationRelease = new Promise((resolve) => {
    releaseInvocation = resolve;
  });

  await adapter.persistJob(createReadyJob({
    jobId: 'job_cli_async_foreground',
    projectId: 'project_openmas_cli',
    createdBy: {
      type: 'human',
      id: 'cli',
    },
    trigger: {
      type: 'immediate',
    },
  }));

  const admissionTick = await runOpenMasOsServiceTick({
    adapter,
    projectRootPath,
    now: () => RUN_AT,
    asyncDispatchExecutor: executor,
    invocationRunner: async () => {
      markInvocationStarted();
      await invocationRelease;

      return {
        invocationId: 'invocation_async_foreground_completed_001',
        status: 'completed',
        message: 'Asynchronous foreground work completed.',
        warnings: [],
        errors: [],
        persistence: null,
      };
    },
  });

  assert.equal(admissionTick.status, 'completed');
  assert.equal(admissionTick.dispatches.length, 1);
  assert.equal(admissionTick.dispatches[0].status, 'queued');
  assert.equal(admissionTick.dispatches[0].executionMode, 'asynchronous');
  assert.equal(admissionTick.asyncExecution.activeCount, 1);

  await invocationStarted;

  const runningProcess = (await adapter.listProcesses({ status: 'running' }))[0];

  assert.equal((await adapter.loadJob('job_cli_async_foreground')).status, 'active');
  assert.ok(runningProcess);

  const staleObservationTick = await runOpenMasOsServiceTick({
    adapter,
    projectRootPath,
    now: () => FUTURE_RUN_AT,
    staleRunningInvocationAfterMs: 1,
    asyncDispatchExecutor: executor,
  });

  assert.equal(staleObservationTick.recovery.scannedProcessCount, 1);
  assert.equal(staleObservationTick.recovery.activeExecutionSkippedCount, 1);
  assert.equal(staleObservationTick.recovery.recoveredCount, 0);
  assert.equal((await adapter.loadProcess(runningProcess.processId)).status, 'running');

  releaseInvocation();
  await executor.waitForIdle();

  const settlementTick = await runOpenMasOsServiceTick({
    adapter,
    projectRootPath,
    now: () => FUTURE_RUN_AT,
    asyncDispatchExecutor: executor,
  });

  assert.equal(settlementTick.settledDispatches.length, 1);
  assert.equal(settlementTick.settledDispatches[0].status, 'completed');
  assert.equal(settlementTick.settledDispatches[0].executionMode, 'asynchronous');
  assert.equal((await adapter.loadJob('job_cli_async_foreground')).status, 'completed');
});

test('runOpenMasOsServiceTick keeps additional ready Jobs deferred when asynchronous execution capacity is occupied', async () => {
  const {
    projectRootPath,
    adapter,
  } = await createEmptyProjectFixture();
  const executor = createLocalAsyncDispatchExecutor({
    maxConcurrentExecutions: 1,
  });
  let releaseInvocation;
  let markInvocationStarted;
  const invocationStarted = new Promise((resolve) => {
    markInvocationStarted = resolve;
  });
  const invocationRelease = new Promise((resolve) => {
    releaseInvocation = resolve;
  });

  await adapter.persistJob(createReadyJob({
    jobId: 'job_async_capacity_first',
    priority: 100,
  }));
  await adapter.persistJob(createReadyJob({
    jobId: 'job_async_capacity_second',
    priority: 90,
  }));

  const firstTick = await runOpenMasOsServiceTick({
    adapter,
    projectRootPath,
    now: () => RUN_AT,
    asyncDispatchExecutor: executor,
    invocationRunner: async () => {
      markInvocationStarted();
      await invocationRelease;

      return {
        invocationId: 'invocation_async_capacity_completed_001',
        status: 'completed',
        message: 'Capacity probe completed.',
        warnings: [],
        errors: [],
        persistence: null,
      };
    },
  });

  await invocationStarted;

  assert.equal(firstTick.readyWork.candidateCount, 2);
  assert.equal(firstTick.readyWork.dispatchedCount, 1);
  assert.equal(firstTick.readyWork.deferredCount, 1);
  assert.equal(firstTick.deferredDispatches.length, 1);
  assert.equal(firstTick.deferredDispatches[0].reasonCode, 'async_executor_at_capacity');
  assert.equal((await adapter.loadJob('job_async_capacity_second')).status, 'ready');

  releaseInvocation();
  await executor.waitForIdle();
});

test('runOpenMasOsServiceTick reports asynchronous worker failures on a later tick without leaking provider secrets', async () => {
  const {
    projectRootPath,
    adapter,
  } = await createEmptyProjectFixture();
  const executor = createLocalAsyncDispatchExecutor({
    maxConcurrentExecutions: 1,
  });
  const rawSecret = buildFakeOpenRouterSecretProbe('asyncWorkerSecret123456789');

  await adapter.persistJob(createReadyJob({
    jobId: 'job_async_failure_redaction',
  }));

  const admissionTick = await runOpenMasOsServiceTick({
    adapter,
    projectRootPath,
    now: () => RUN_AT,
    asyncDispatchExecutor: executor,
    invocationRunner: async () => {
      throw new Error(`Provider rejected ${rawSecret}`);
    },
  });

  assert.equal(admissionTick.dispatches[0].status, 'queued');

  await executor.waitForIdle();

  const settlementTick = await runOpenMasOsServiceTick({
    adapter,
    projectRootPath,
    now: () => RUN_AT,
    asyncDispatchExecutor: executor,
  });
  const failedJob = await adapter.loadJob('job_async_failure_redaction');
  const serializedResult = JSON.stringify(settlementTick);
  const serializedJob = JSON.stringify(failedJob);

  assert.equal(settlementTick.status, 'completed_with_failures');
  assert.equal(settlementTick.settledDispatches.length, 1);
  assert.equal(settlementTick.settledDispatches[0].status, 'failed');
  assert.equal(failedJob.status, 'failed');
  assert.equal(failedJob.failureSummary.reasonCode, 'invocation_failed');
  assert.match(serializedJob, /\[redacted-secret\]/u);
  assert.doesNotMatch(serializedJob, new RegExp(rawSecret, 'u'));
  assert.doesNotMatch(serializedResult, new RegExp(rawSecret, 'u'));
});

test('runOpenMasOsServiceTick settles delegated child execution and parent resume outside kernel ticks', async () => {
  const {
    projectRootPath,
    adapter,
    inbox,
  } = await createSystemCallDelegationFixture();
  const executor = createLocalAsyncDispatchExecutor({
    maxConcurrentExecutions: 1,
  });
  const invocationRequests = [];
  let releaseChild;
  let releaseParent;
  let markChildStarted;
  let markParentStarted;
  const childStarted = new Promise((resolve) => {
    markChildStarted = resolve;
  });
  const parentStarted = new Promise((resolve) => {
    markParentStarted = resolve;
  });
  const childRelease = new Promise((resolve) => {
    releaseChild = resolve;
  });
  const parentRelease = new Promise((resolve) => {
    releaseParent = resolve;
  });
  const invocationRunner = async (request) => {
    invocationRequests.push(request);

    if (request.operationalIdentityId === 'bruce') {
      markChildStarted();
      await childRelease;

      return {
        invocationId: 'invocation_async_child_completed_001',
        status: 'completed',
        message: 'Bruce completed asynchronous child work.',
        warnings: [],
        errors: [],
        persistence: null,
      };
    }

    markParentStarted();
    await parentRelease;

    return {
      invocationId: 'invocation_async_parent_resume_completed_001',
      status: 'completed',
      message: 'Alfred resumed after asynchronous child work.',
      warnings: [],
      errors: [],
      persistence: null,
    };
  };

  await inbox.submitSystemCall(createSystemCall({
    systemCallId: 'syscall_delegate_async_tick_001',
    idempotencyKey: 'delegate:async-tick:alfred:bruce:001',
  }));

  const childAdmissionTick = await runOpenMasOsServiceTick({
    adapter,
    projectRootPath,
    now: () => RUN_AT,
    asyncDispatchExecutor: executor,
    invocationRunner,
  });

  assert.equal(childAdmissionTick.systemCalls.completedCount, 1);
  assert.equal(childAdmissionTick.dispatches[0].dispatchType, 'delegation');
  assert.equal(childAdmissionTick.dispatches[0].status, 'queued');

  await childStarted;
  assert.equal((await adapter.loadProcess('process_parent_alfred')).status, 'blocked');

  releaseChild();
  await executor.waitForIdle();

  const parentAdmissionTick = await runOpenMasOsServiceTick({
    adapter,
    projectRootPath,
    now: () => RUN_AT,
    asyncDispatchExecutor: executor,
    invocationRunner,
  });

  assert.equal(parentAdmissionTick.settledDispatches.length, 1);
  assert.equal(parentAdmissionTick.settledDispatches[0].dispatchType, 'delegation');
  assert.equal(parentAdmissionTick.dispatches[0].dispatchType, 'parent_resume');
  assert.equal(parentAdmissionTick.dispatches[0].status, 'queued');

  await parentStarted;
  releaseParent();
  await executor.waitForIdle();

  const settlementTick = await runOpenMasOsServiceTick({
    adapter,
    projectRootPath,
    now: () => RUN_AT,
    asyncDispatchExecutor: executor,
  });
  const parentProcess = await adapter.loadProcess('process_parent_alfred');
  const parentResults = await adapter.listResultRecords({
    resultKind: 'parent_resume_result',
    processId: 'process_parent_alfred',
  });

  assert.equal(settlementTick.settledDispatches.length, 1);
  assert.equal(settlementTick.settledDispatches[0].dispatchType, 'parent_resume');
  assert.equal(parentProcess.status, 'completed');
  assert.equal(invocationRequests.length, 2);
  assert.equal(invocationRequests[0].operationalIdentityId, 'bruce');
  assert.equal(invocationRequests[1].operationalIdentityId, 'alfred');
  assert.equal(parentResults.length, 1);
  assert.equal(parentResults[0].status, 'completed');
  assert.equal(parentResults[0].childResultRefs.length, 1);
});

test('shutdown admission stop leaves a newly-ready parent resume durable for a later kernel owner', async () => {
  const {
    projectRootPath,
    adapter,
    inbox,
  } = await createSystemCallDelegationFixture();
  const drainingExecutor = createLocalAsyncDispatchExecutor({
    maxConcurrentExecutions: 1,
  });
  const successorExecutor = createLocalAsyncDispatchExecutor({
    maxConcurrentExecutions: 1,
  });
  const invocationRequests = [];
  let releaseChild;
  let markChildStarted;
  const childStarted = new Promise((resolve) => {
    markChildStarted = resolve;
  });
  const childRelease = new Promise((resolve) => {
    releaseChild = resolve;
  });
  const invocationRunner = async (request) => {
    invocationRequests.push(request);

    if (request.operationalIdentityId === 'bruce') {
      markChildStarted();
      await childRelease;

      return {
        invocationId: 'invocation_shutdown_child_completed_001',
        status: 'completed',
        message: 'Bruce completed while the original owner was quiescing.',
        warnings: [],
        errors: [],
        persistence: null,
      };
    }

    return {
      invocationId: 'invocation_successor_parent_resume_completed_001',
      status: 'completed',
      message: 'Alfred resumed under the successor kernel owner.',
      warnings: [],
      errors: [],
      persistence: null,
    };
  };

  await inbox.submitSystemCall(createSystemCall({
    systemCallId: 'syscall_delegate_shutdown_boundary_001',
    idempotencyKey: 'delegate:shutdown-boundary:alfred:bruce:001',
  }));

  const childAdmissionTick = await runOpenMasOsServiceTick({
    adapter,
    projectRootPath,
    now: () => RUN_AT,
    asyncDispatchExecutor: drainingExecutor,
    invocationRunner,
  });

  assert.equal(childAdmissionTick.dispatches[0].dispatchType, 'delegation');
  await childStarted;
  drainingExecutor.stopAccepting();
  releaseChild();
  await drainingExecutor.waitForIdle();

  const parentResultsBeforeSuccessor = await adapter.listResultRecords({
    resultKind: 'parent_resume_result',
    processId: 'process_parent_alfred',
  });

  assert.equal(parentResultsBeforeSuccessor.length, 0);
  assert.equal(invocationRequests.length, 1);

  const successorAdmissionTick = await runOpenMasOsServiceTick({
    adapter,
    projectRootPath,
    now: () => RUN_AT,
    asyncDispatchExecutor: successorExecutor,
    invocationRunner,
  });

  assert.equal(successorAdmissionTick.dispatches[0].dispatchType, 'parent_resume');
  assert.equal(successorAdmissionTick.dispatches[0].status, 'queued');
  await successorExecutor.waitForIdle();

  await runOpenMasOsServiceTick({
    adapter,
    projectRootPath,
    now: () => RUN_AT,
    asyncDispatchExecutor: successorExecutor,
  });
  const parentResults = await adapter.listResultRecords({
    resultKind: 'parent_resume_result',
    processId: 'process_parent_alfred',
  });

  assert.equal(invocationRequests.length, 2);
  assert.equal(invocationRequests[1].operationalIdentityId, 'alfred');
  assert.equal(parentResults.length, 1);
  assert.equal(parentResults[0].status, 'completed');
});
