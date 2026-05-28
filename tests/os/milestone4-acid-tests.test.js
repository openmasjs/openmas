import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { OPENMAS_OS_KINDS } from '../../src/contracts/openmas-os-runtime-contract.js';
import {
  OPENMAS_OS_SYSTEM_CALL_KINDS,
} from '../../src/contracts/openmas-os-system-call-contract.js';
import { createLocalRuntimeAdapter } from '../../src/os/adapters/local-runtime-adapter.js';
import { createLocalSystemCallInbox } from '../../src/os/system-calls/local-system-call-inbox.js';
import { createKernelSystemCallProcessor } from '../../src/os/system-calls/system-call-processor.js';

const CREATED_AT = '2026-05-22T09:00:00-05:00';
const PROCESSED_AT = '2026-05-22T09:05:00-05:00';
const RUN_AT = '2026-05-22T18:00:00-05:00';
const EXPIRED_REQUESTED_AT = '2026-05-22T08:00:00-05:00';
const EXPIRED_AT = '2026-05-22T08:05:00-05:00';

async function createTemporaryProjectRoot() {
  return mkdtemp(path.join(os.tmpdir(), 'openmas-m4-acid-'));
}

function createDelegationPolicy() {
  return {
    kind: 'openmas_delegation_policy',
    version: 1,
    defaultEffect: 'deny',
    rules: [
      {
        ruleId: 'allow-m4-alfred-to-bruce',
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
    jobId: 'job_parent_alfred_m4',
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
      text: 'Coordinate Milestone 4 acid work.',
    },
    conversationId: 'milestone-4-acid',
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
    processId: 'process_parent_alfred_m4',
    jobId: 'job_parent_alfred_m4',
    status: 'running',
    operationalIdentityId: 'alfred',
    activeCognitiveIdentityId: 'system-steward',
    currentThreadId: 'thread_parent_alfred_m4',
    parentProcessId: null,
    childProcessIds: [],
    conversationId: 'milestone-4-acid',
    memoryContextRefs: [],
    artifactRefs: [],
    secretReferenceIds: [],
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
    threadId: 'thread_parent_alfred_m4',
    processId: 'process_parent_alfred_m4',
    jobId: 'job_parent_alfred_m4',
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

function createBaseSystemCall(overrides = {}) {
  return {
    kind: OPENMAS_OS_SYSTEM_CALL_KINDS.systemCall,
    schemaVersion: 1,
    systemCallId: 'syscall_m4_inspect_001',
    operation: 'inspect_status',
    status: 'pending',
    requestedAt: PROCESSED_AT,
    requestedBy: {
      type: 'operational_identity',
      id: 'alfred',
    },
    correlation: {
      invocationId: 'invocation_m4_acid',
      actionRequestId: null,
      toolRunId: null,
      workflowRunId: null,
      conversationId: 'milestone-4-acid',
      jobId: 'job_parent_alfred_m4',
      processId: 'process_parent_alfred_m4',
      threadId: 'thread_parent_alfred_m4',
    },
    idempotencyKey: null,
    expiresAt: '2026-05-22T09:35:00-05:00',
    payload: {
      scope: 'service',
    },
    ...overrides,
  };
}

function createScheduleDelegationSystemCall(overrides = {}) {
  const systemCallId = overrides.systemCallId ?? 'syscall_m4_schedule_001';

  return createBaseSystemCall({
    systemCallId,
    operation: 'schedule_delegation',
    idempotencyKey: `m4:${systemCallId}`,
    payload: {
      requesterOperationalIdentityId: 'alfred',
      targetOperationalIdentityId: 'bruce',
      reason: 'Milestone 4 acid stress scheduled delegation.',
      parentContext: {
        jobId: 'job_parent_alfred_m4',
        processId: 'process_parent_alfred_m4',
        threadId: 'thread_parent_alfred_m4',
      },
      runAt: RUN_AT,
      missedRunPolicy: 'delay',
      child: {
        command: 'ask',
        mode: 'probabilistic',
        input: 'Bruce, inspect Milestone 4 kernel boundary evidence.',
        conversationId: 'milestone-4-acid',
        priority: 50,
        contextRefs: [],
        artifactRefs: [],
        expectedOutput: null,
      },
    },
    ...overrides,
  });
}

async function createFixture() {
  const projectRootPath = await createTemporaryProjectRoot();
  const adapter = createLocalRuntimeAdapter({ projectRootPath });
  const inbox = createLocalSystemCallInbox({ projectRootPath });

  await adapter.persistJob(createParentJob());
  await adapter.persistProcess(createParentProcess());
  await adapter.persistThread(createParentThread());

  const processor = createKernelSystemCallProcessor({
    projectRootPath,
    adapter,
    inbox,
    delegationPolicy: createDelegationPolicy(),
    now: () => PROCESSED_AT,
    serviceId: 'openmas_os_service_m4_acid',
    tickId: 'os_service_tick_m4_acid',
    maxSystemCallsPerRun: 100,
  });

  return {
    projectRootPath,
    adapter,
    inbox,
    processor,
  };
}

test('M4 acid: mixed syscall storm drains safely without duplicate kernel effects', async () => {
  const {
    projectRootPath,
    adapter,
    inbox,
    processor,
  } = await createFixture();

  await inbox.submitSystemCall(createScheduleDelegationSystemCall({
    systemCallId: 'syscall_m4_01_schedule_valid',
    idempotencyKey: 'm4:schedule:valid',
  }));
  await inbox.submitSystemCall(createScheduleDelegationSystemCall({
    systemCallId: 'syscall_m4_02_schedule_duplicate_first',
    idempotencyKey: 'm4:schedule:duplicate',
  }));
  await inbox.submitSystemCall(createScheduleDelegationSystemCall({
    systemCallId: 'syscall_m4_03_schedule_duplicate_second',
    idempotencyKey: 'm4:schedule:duplicate',
  }));
  await inbox.submitSystemCall(createScheduleDelegationSystemCall({
    systemCallId: 'syscall_m4_04_schedule_denied',
    idempotencyKey: 'm4:schedule:denied',
    payload: {
      ...createScheduleDelegationSystemCall().payload,
      targetOperationalIdentityId: 'maria',
    },
  }));
  await inbox.submitSystemCall(createScheduleDelegationSystemCall({
    systemCallId: 'syscall_m4_05_schedule_expired',
    idempotencyKey: 'm4:schedule:expired',
    requestedAt: EXPIRED_REQUESTED_AT,
    expiresAt: EXPIRED_AT,
  }));
  await inbox.submitSystemCall(createBaseSystemCall({
    systemCallId: 'syscall_m4_06_inspect',
    idempotencyKey: 'm4:inspect:service',
  }));
  await inbox.submitSystemCall(createBaseSystemCall({
    systemCallId: 'syscall_m4_07_processing_recovery',
    idempotencyKey: 'm4:processing:recovery',
  }));
  await inbox.moveSystemCall({
    systemCallId: 'syscall_m4_07_processing_recovery',
    fromState: 'pending',
    toState: 'processing',
  });

  const pendingRootPath = path.join(projectRootPath, 'instance', 'os', 'system-calls', 'pending');
  const processingRootPath = path.join(projectRootPath, 'instance', 'os', 'system-calls', 'processing');

  await mkdir(pendingRootPath, { recursive: true });
  await mkdir(processingRootPath, { recursive: true });
  await writeFile(
    path.join(pendingRootPath, 'syscall_m4_08_malformed_pending.json'),
    '{ malformed pending m4 acid syscall ',
    'utf8',
  );
  await writeFile(
    path.join(processingRootPath, 'syscall_m4_09_malformed_processing.json'),
    '{ malformed processing m4 acid syscall ',
    'utf8',
  );

  const processorResult = await processor.processPendingSystemCalls({
    maxSystemCallsPerRun: 100,
  });
  const duplicateSecond = await inbox.loadSystemCallResult('syscall_m4_03_schedule_duplicate_second');
  const deniedResult = await inbox.loadSystemCallResult('syscall_m4_04_schedule_denied');
  const expiredResult = await inbox.loadSystemCallResult('syscall_m4_05_schedule_expired');
  const malformedPendingResult = await inbox.loadSystemCallResult('syscall_m4_08_malformed_pending');
  const malformedProcessingResult = await inbox.loadSystemCallResult('syscall_m4_09_malformed_processing');
  const completedRecoverySnapshot = await inbox.loadSystemCall(
    'syscall_m4_07_processing_recovery',
    'completed',
  );
  const jobs = await adapter.listJobs();
  const timers = await adapter.listTimers();
  const bruceJobs = jobs.filter((job) => job.assignedOperationalIdentityId === 'bruce');

  assert.equal(processorResult.processedCount, 9);
  assert.equal(processorResult.completedCount, 5);
  assert.equal(processorResult.deniedCount, 1);
  assert.equal(processorResult.expiredCount, 1);
  assert.equal(processorResult.failedCount, 2);
  assert.equal(processorResult.recoveredProcessingCount, 2);

  assert.equal(duplicateSecond.status, 'completed');
  assert.equal(duplicateSecond.details.duplicateOfSystemCallId, 'syscall_m4_02_schedule_duplicate_first');
  assert.deepEqual(duplicateSecond.effects.createdJobIds, []);
  assert.deepEqual(duplicateSecond.effects.createdTimerIds, []);
  assert.equal(deniedResult.status, 'denied');
  assert.deepEqual(deniedResult.effects.createdJobIds, []);
  assert.deepEqual(deniedResult.effects.createdTimerIds, []);
  assert.equal(expiredResult.status, 'expired');
  assert.deepEqual(expiredResult.effects.createdJobIds, []);
  assert.deepEqual(expiredResult.effects.createdTimerIds, []);
  assert.equal(malformedPendingResult.status, 'failed');
  assert.equal(malformedProcessingResult.status, 'failed');
  assert.equal(completedRecoverySnapshot.status, 'completed');
  assert.equal(bruceJobs.length, 2);
  assert.equal(timers.length, 2);
  assert.deepEqual(await inbox.listPendingSystemCallIds(), []);
  assert.deepEqual(await inbox.listSystemCallIds('processing'), []);
});

test('M4 acid: syscall processor backpressure drains a large queue across deterministic batches', async () => {
  const {
    inbox,
    processor,
  } = await createFixture();

  for (let index = 0; index < 60; index += 1) {
    const suffix = String(index).padStart(2, '0');

    await inbox.submitSystemCall(createBaseSystemCall({
      systemCallId: `syscall_m4_backpressure_${suffix}`,
      idempotencyKey: `m4:backpressure:${suffix}`,
      requestedAt: `2026-05-22T09:${String(index % 60).padStart(2, '0')}:00-05:00`,
      expiresAt: '2026-05-22T10:30:00-05:00',
    }));
  }

  const firstBatch = await processor.processPendingSystemCalls({
    maxSystemCallsPerRun: 25,
  });
  const secondBatch = await processor.processPendingSystemCalls({
    maxSystemCallsPerRun: 25,
  });
  const thirdBatch = await processor.processPendingSystemCalls({
    maxSystemCallsPerRun: 25,
  });

  assert.equal(firstBatch.processedCount, 25);
  assert.equal(secondBatch.processedCount, 25);
  assert.equal(thirdBatch.processedCount, 10);
  assert.equal(firstBatch.completedCount, 25);
  assert.equal(secondBatch.completedCount, 25);
  assert.equal(thirdBatch.completedCount, 10);
  assert.deepEqual(await inbox.listPendingSystemCallIds(), []);
  assert.deepEqual(await inbox.listSystemCallIds('processing'), []);
});
