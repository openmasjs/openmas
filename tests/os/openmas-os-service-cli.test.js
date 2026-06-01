import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { OPENMAS_OS_KINDS } from '../../src/contracts/openmas-os-runtime-contract.js';
import {
  OPENMAS_OS_SYSTEM_CALL_KINDS,
} from '../../src/contracts/openmas-os-system-call-contract.js';
import {
  OPENMAS_OS_RESULT_RECORD_KINDS,
} from '../../src/contracts/openmas-os-result-record-contract.js';
import {
  parseOpenMasOsServiceCliArgs,
  runOpenMasOsServiceCommand,
} from '../../src/os/service/openmas-os-service-cli.js';
import { createLocalRuntimeAdapter } from '../../src/os/adapters/local-runtime-adapter.js';
import { createLocalSystemCallInbox } from '../../src/os/system-calls/local-system-call-inbox.js';
import { scheduleOneShotJob } from '../../src/os/scheduler/one-shot-scheduled-jobs.js';
import { buildFakeOpenRouterSecretProbe } from '../helpers/fake-secret-probes.js';
import {
  claimKernelLock,
  readKernelLock,
} from '../../src/os/service/kernel-lock.js';
import {
  buildServiceState,
  readServiceHeartbeat,
  readServiceState,
  writeServiceHealthSnapshot,
} from '../../src/os/service/service-health.js';

const NOW = '2026-05-17T12:00:00-05:00';
const STATUS_LATER = '2026-05-17T12:00:05-05:00';
const RECOVERY_NOW = '2026-05-17T12:02:00-05:00';

async function createTemporaryProjectRoot() {
  return mkdtemp(path.join(os.tmpdir(), 'openmas-os-service-cli-'));
}

function createCaptureStream() {
  const chunks = [];

  return {
    chunks,
    write(chunk) {
      chunks.push(chunk);
    },
    text() {
      return chunks.join('');
    },
  };
}

function createBrokenPipeStream({ failAfterWrites = 1 } = {}) {
  const stream = new EventEmitter();
  const chunks = [];
  let writeCount = 0;

  stream.chunks = chunks;
  stream.write = (chunk) => {
    chunks.push(chunk);
    writeCount += 1;

    if (writeCount >= failAfterWrites) {
      queueMicrotask(() => {
        const error = new Error('write EPIPE');
        error.code = 'EPIPE';
        stream.emit('error', error);
      });
    }

    return false;
  };
  stream.text = () => chunks.join('');

  return stream;
}

function createTickResult(overrides = {}) {
  return {
    kind: 'openmas_os_service_tick_result',
    version: 1,
    tickId: 'os_service_tick_cli_test_001',
    status: 'idle',
    startedAt: NOW,
    finishedAt: NOW,
    release: {
      now: NOW,
      resultCount: 0,
      releasedCount: 0,
      pendingCount: 0,
    },
    readyWork: {
      candidateCount: 0,
      dispatchedCount: 0,
      deferredCount: 0,
    },
    dispatches: [],
    ...overrides,
  };
}

function createStatusResultRecord(overrides = {}) {
  return {
    kind: OPENMAS_OS_RESULT_RECORD_KINDS.resultRecord,
    schemaVersion: 1,
    resultId: 'result_status_recent_bruce_001',
    resultKind: 'delegated_child_result',
    producer: {
      type: 'process',
      id: 'process_status_recent_bruce_001',
      operationalIdentityId: 'bruce',
    },
    lineage: {
      jobId: 'job_status_recent_bruce_001',
      processId: 'process_status_recent_bruce_001',
      threadId: 'thread_status_recent_bruce_001',
      parentProcessId: 'process_status_recent_alfred_001',
      systemCallId: 'syscall_status_recent_delegate_001',
    },
    status: 'completed',
    phase: 'terminal',
    completion: {
      startedAt: NOW,
      completedAt: STATUS_LATER,
      durationMs: 5000,
      exitClass: 'success',
    },
    summary: 'Bruce completed the recent status inspection.',
    artifactRefs: [],
    toolRunRefs: [],
    workflowRunRefs: [],
    childResultRefs: [],
    warnings: [],
    failure: null,
    verification: {
      status: 'passed',
      grounded: true,
    },
    visibility: {
      safeForHumanSummary: true,
      safeForAgentContext: true,
    },
    metadata: {},
    createdAt: STATUS_LATER,
    ...overrides,
  };
}

function createBlockedWaitJob(overrides = {}) {
  return {
    kind: OPENMAS_OS_KINDS.job,
    schemaVersion: 1,
    jobId: 'job_status_blocked_wait_001',
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
      text: 'Inspect the MAS.',
    },
    conversationId: 'alfred-admin',
    trigger: {
      type: 'immediate',
    },
    priority: 40,
    policies: {
      requiresApproval: false,
      maxAttempts: 1,
      noOverlap: false,
    },
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function createBlockedWaitProcess(overrides = {}) {
  return {
    kind: OPENMAS_OS_KINDS.process,
    schemaVersion: 1,
    processId: 'process_status_blocked_wait_001',
    jobId: 'job_status_blocked_wait_001',
    status: 'blocked',
    operationalIdentityId: 'alfred',
    activeCognitiveIdentityId: 'system-steward',
    currentThreadId: 'thread_status_blocked_wait_001',
    parentProcessId: null,
    childProcessIds: [],
    conversationId: 'alfred-admin',
    memoryContextRefs: [],
    artifactRefs: [],
    credentialReferenceIds: [],
    pendingApprovalRefs: [],
    warnings: [],
    createdAt: NOW,
    startedAt: NOW,
    updatedAt: NOW,
    completedAt: null,
    ...overrides,
  };
}

function createBlockedWaitThread(overrides = {}) {
  return {
    kind: OPENMAS_OS_KINDS.thread,
    schemaVersion: 1,
    threadId: 'thread_status_blocked_wait_001',
    processId: 'process_status_blocked_wait_001',
    jobId: 'job_status_blocked_wait_001',
    status: 'blocked',
    threadType: 'agent_invocation',
    priority: 40,
    attempt: 1,
    waitReason: 'waiting_for_resource',
    dueAt: null,
    createdAt: NOW,
    startedAt: NOW,
    updatedAt: NOW,
    completedAt: null,
    ...overrides,
  };
}

function createScheduledOnceJob(overrides = {}) {
  return {
    kind: OPENMAS_OS_KINDS.job,
    schemaVersion: 1,
    jobId: 'job_recovery_scheduled_once',
    projectId: 'project_openmas',
    status: 'admitted',
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
      text: 'Run the recovered scheduled job.',
    },
    conversationId: 'os-m3-service-recovery',
    trigger: {
      type: 'scheduled_once',
      runAt: RECOVERY_NOW,
    },
    priority: 70,
    policies: {
      requiresApproval: false,
      maxAttempts: 1,
      noOverlap: false,
    },
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function createSystemCall(overrides = {}) {
  return {
    kind: OPENMAS_OS_SYSTEM_CALL_KINDS.systemCall,
    schemaVersion: 1,
    systemCallId: 'syscall_status_pending_001',
    operation: 'delegate',
    status: 'pending',
    requestedAt: NOW,
    requestedBy: {
      type: 'operational_identity',
      operationalIdentityId: 'alfred',
    },
    correlation: {
      invocationId: 'invocation_status_syscall_001',
      conversationId: 'status-syscall-smoke',
    },
    idempotencyKey: 'delegate:status:alfred:bruce:001',
    expiresAt: RECOVERY_NOW,
    payload: {
      requesterOperationalIdentityId: 'alfred',
      targetOperationalIdentityId: 'bruce',
      reason: 'Status command should not expose this payload.',
      child: {
        input: 'Private pending payload that should not appear in status output.',
        command: 'ask',
        mode: 'probabilistic',
        conversationId: 'status-syscall-smoke',
      },
    },
    ...overrides,
  };
}

function createSystemCallResult(overrides = {}) {
  return {
    kind: OPENMAS_OS_SYSTEM_CALL_KINDS.result,
    schemaVersion: 1,
    systemCallId: 'syscall_status_completed_001',
    operation: 'delegate',
    status: 'completed',
    processedAt: STATUS_LATER,
    processedBy: {
      serviceId: 'openmas_os_service_status_syscall_test',
      tickId: 'os_service_tick_status_syscall_001',
    },
    decision: {
      allowed: true,
      reason: 'Allowed by status test policy.',
    },
    effects: {
      createdJobIds: ['job_status_syscall_child_001'],
      createdTimerIds: [],
      createdSignalIds: [],
      createdProcessIds: [],
      createdThreadIds: [],
      eventIds: [],
    },
    summary: 'OpenMAS OS delegated Alfred to Bruce for the status test.',
    correlation: {
      invocationId: 'invocation_status_syscall_001',
    },
    evidenceRefs: [],
    warnings: [],
    details: {
      idempotencyKey: 'delegate:status:alfred:bruce:completed',
    },
    ...overrides,
  };
}

test('parseOpenMasOsServiceCliArgs supports watch mode options and refuses unsupported combinations', () => {
  assert.deepEqual(parseOpenMasOsServiceCliArgs([
    '--watch',
    '--project-root',
    'C:\\tmp\\openmas-watch',
    '--interval',
    '250',
    '--max-dispatched-jobs=3',
    '--service-id',
    'openmas_os_service_cli_test',
    '--json',
  ]), {
    mode: 'watch',
    projectRootPath: 'C:\\tmp\\openmas-watch',
    json: true,
    quiet: false,
    tickIntervalMs: 250,
    maxDispatchedJobs: 3,
    staleAfterMs: 30000,
    serviceId: 'openmas_os_service_cli_test',
    systemCallPath: null,
    waitForResult: false,
    waitTimeoutMs: 5000,
    waitIntervalMs: 100,
  });
  assert.deepEqual(parseOpenMasOsServiceCliArgs([
    '--status',
    '--project-root=C:\\tmp\\openmas-status',
    '--json',
  ]), {
    mode: 'status',
    projectRootPath: 'C:\\tmp\\openmas-status',
    json: true,
    quiet: false,
    tickIntervalMs: 5000,
    maxDispatchedJobs: 25,
    staleAfterMs: 30000,
    serviceId: null,
    systemCallPath: null,
    waitForResult: false,
    waitTimeoutMs: 5000,
    waitIntervalMs: 100,
  });
  assert.deepEqual(parseOpenMasOsServiceCliArgs([
    '--submit-system-call',
    'C:\\tmp\\syscall.json',
    '--project-root',
    'C:\\tmp\\openmas-admin',
    '--wait',
    '--wait-timeout-ms',
    '25',
    '--wait-interval-ms=5',
    '--json',
  ]), {
    mode: 'submit_system_call',
    projectRootPath: 'C:\\tmp\\openmas-admin',
    json: true,
    quiet: false,
    tickIntervalMs: 5000,
    maxDispatchedJobs: 25,
    staleAfterMs: 30000,
    serviceId: null,
    systemCallPath: 'C:\\tmp\\syscall.json',
    waitForResult: true,
    waitTimeoutMs: 25,
    waitIntervalMs: 5,
  });
  assert.deepEqual(parseOpenMasOsServiceCliArgs([
    '--help',
    '--json',
  ]), {
    mode: 'help',
    projectRootPath: process.cwd(),
    json: true,
    quiet: false,
    tickIntervalMs: 5000,
    maxDispatchedJobs: 25,
    staleAfterMs: 30000,
    serviceId: null,
    systemCallPath: null,
    waitForResult: false,
    waitTimeoutMs: 5000,
    waitIntervalMs: 100,
  });

  assert.throws(
    () => parseOpenMasOsServiceCliArgs(['--tick', '--watch']),
    /one of --tick, --watch, --status, --submit-system-call, or --help/u,
  );
  assert.throws(
    () => parseOpenMasOsServiceCliArgs(['--tick', '--interval', '100']),
    /--interval is only supported with --watch/u,
  );
  assert.throws(
    () => parseOpenMasOsServiceCliArgs(['--status', '--max-dispatched-jobs', '2']),
    /--max-dispatched-jobs/u,
  );
  assert.throws(
    () => parseOpenMasOsServiceCliArgs(['--watch', '--interval', '0']),
    /--interval/u,
  );
  assert.throws(
    () => parseOpenMasOsServiceCliArgs([]),
    /requires --tick, --watch, --status, --submit-system-call, or --help/u,
  );
  assert.throws(
    () => parseOpenMasOsServiceCliArgs(['--status', '--wait']),
    /--wait is only supported with --submit-system-call/u,
  );
  assert.throws(
    () => parseOpenMasOsServiceCliArgs(['--status', '--quiet']),
    /--quiet is only supported with --watch/u,
  );
  assert.throws(
    () => parseOpenMasOsServiceCliArgs(['--tick', '--wait-timeout-ms', '25']),
    /--wait-timeout-ms is only supported with --submit-system-call/u,
  );
  assert.throws(
    () => parseOpenMasOsServiceCliArgs(['--submit-system-call=']),
    /requires a non-empty file path/u,
  );
});

test('runOpenMasOsServiceCommand prints help without touching kernel state', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const stdout = createCaptureStream();

  const commandResult = await runOpenMasOsServiceCommand({
    argv: [
      '--help',
      '--project-root',
      projectRootPath,
    ],
    cwd: process.cwd(),
    stdout,
    now: () => NOW,
  });
  const output = stdout.text();

  assert.equal(commandResult.mode, 'help');
  assert.equal(commandResult.exitCode, 0);
  assert.equal(commandResult.result.kind, 'openmas_os_service_help_result');
  assert.match(output, /OpenMAS OS Service/u);
  assert.match(output, /--watch/u);
  assert.match(output, /--status/u);
  assert.equal(await readKernelLock({ projectRootPath }), null);
});

test('runOpenMasOsServiceCommand submits a System Call without materializing kernel work directly', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const adapter = createLocalRuntimeAdapter({ projectRootPath });
  const inbox = createLocalSystemCallInbox({ projectRootPath });
  const stdout = createCaptureStream();
  const systemCallPath = path.join(projectRootPath, 'admin-submit-system-call.json');

  await writeFile(
    systemCallPath,
    JSON.stringify(createSystemCall({
      systemCallId: 'syscall_admin_submit_001',
      idempotencyKey: 'delegate:admin-submit:001',
    }), null, 2),
    'utf8',
  );

  const commandResult = await runOpenMasOsServiceCommand({
    argv: [
      '--submit-system-call',
      systemCallPath,
      '--project-root',
      projectRootPath,
      '--json',
    ],
    cwd: process.cwd(),
    stdout,
    now: () => NOW,
  });
  const output = JSON.parse(stdout.text());
  const serializedOutput = JSON.stringify(output);

  assert.equal(commandResult.mode, 'submit_system_call');
  assert.equal(commandResult.exitCode, 0);
  assert.deepEqual(commandResult.result, output);
  assert.equal(output.kind, 'openmas_os_service_system_call_submission_result');
  assert.equal(output.mode, 'submit_system_call');
  assert.equal(output.systemCall.systemCallId, 'syscall_admin_submit_001');
  assert.equal(output.systemCall.operation, 'delegate');
  assert.equal(output.submission.status, 'submitted');
  assert.equal(output.submission.state, 'pending');
  assert.equal(output.wait.status, 'not_requested');
  assert.equal(output.result, null);
  assert.equal(output.nextRecommendedAction, 'System Call is pending. Start or tick the OpenMAS OS service to process it.');
  assert.deepEqual(await inbox.listPendingSystemCallIds(), ['syscall_admin_submit_001']);
  assert.equal((await adapter.listJobs()).length, 0);
  assert.equal((await adapter.listTimers()).length, 0);
  assert.doesNotMatch(serializedOutput, /Private pending payload/u);
});

test('runOpenMasOsServiceCommand waits briefly for a submitted System Call result and reports pending', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const inbox = createLocalSystemCallInbox({ projectRootPath });
  const stdout = createCaptureStream();
  const systemCallPath = path.join(projectRootPath, 'admin-wait-pending-system-call.json');

  await writeFile(
    systemCallPath,
    JSON.stringify(createSystemCall({
      systemCallId: 'syscall_admin_wait_pending_001',
      idempotencyKey: 'delegate:admin-wait-pending:001',
    }), null, 2),
    'utf8',
  );

  const commandResult = await runOpenMasOsServiceCommand({
    argv: [
      '--submit-system-call',
      systemCallPath,
      '--project-root',
      projectRootPath,
      '--wait',
      '--wait-timeout-ms',
      '1',
      '--wait-interval-ms',
      '1',
      '--json',
    ],
    cwd: process.cwd(),
    stdout,
    now: () => NOW,
  });
  const output = JSON.parse(stdout.text());

  assert.equal(commandResult.mode, 'submit_system_call');
  assert.equal(output.systemCall.systemCallId, 'syscall_admin_wait_pending_001');
  assert.equal(output.wait.requested, true);
  assert.equal(output.wait.status, 'timed_out');
  assert.equal(output.result, null);
  assert.equal(output.nextRecommendedAction, 'System Call is still pending. Keep the OpenMAS OS service running or tick it again.');
  assert.deepEqual(await inbox.listPendingSystemCallIds(), ['syscall_admin_wait_pending_001']);
});

test('runOpenMasOsServiceCommand reports a submitted System Call result when it appears during wait', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const inbox = createLocalSystemCallInbox({ projectRootPath });
  const stdout = createCaptureStream();
  const systemCallPath = path.join(projectRootPath, 'admin-wait-result-system-call.json');

  await writeFile(
    systemCallPath,
    JSON.stringify(createSystemCall({
      systemCallId: 'syscall_admin_wait_result_001',
      idempotencyKey: 'delegate:admin-wait-result:001',
    }), null, 2),
    'utf8',
  );

  const commandResultTask = runOpenMasOsServiceCommand({
    argv: [
      '--submit-system-call',
      systemCallPath,
      '--project-root',
      projectRootPath,
      '--wait',
      '--wait-timeout-ms',
      '2000',
      '--wait-interval-ms',
      '5',
      '--json',
    ],
    cwd: process.cwd(),
    stdout,
    now: () => NOW,
  });

  let pendingObserved = false;

  for (let attempt = 0; attempt < 2000 && !pendingObserved; attempt += 1) {
    const pendingIds = await inbox.listPendingSystemCallIds();

    if (pendingIds.includes('syscall_admin_wait_result_001')) {
      pendingObserved = true;
      continue;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 1);
    });
  }

  assert.equal(pendingObserved, true);

  await inbox.persistSystemCallResult(createSystemCallResult({
    systemCallId: 'syscall_admin_wait_result_001',
    processedAt: STATUS_LATER,
    summary: 'OpenMAS OS completed the admin-submitted system call.',
  }));

  const commandResult = await commandResultTask;

  const output = JSON.parse(stdout.text());

  assert.equal(commandResult.mode, 'submit_system_call');
  assert.equal(output.systemCall.systemCallId, 'syscall_admin_wait_result_001');
  assert.equal(output.wait.status, 'result_available');
  assert.equal(output.result.status, 'completed');
  assert.equal(output.result.summary, 'OpenMAS OS completed the admin-submitted system call.');
  assert.equal(output.nextRecommendedAction, 'System Call syscall_admin_wait_result_001 has result status completed.');
});

test('runOpenMasOsServiceCommand keeps --tick available and prints JSON tick output', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const adapter = createLocalRuntimeAdapter({ projectRootPath });
  const stdout = createCaptureStream();
  const tickCalls = [];

  const commandResult = await runOpenMasOsServiceCommand({
    argv: [
      '--tick',
      '--project-root',
      projectRootPath,
      '--max-dispatched-jobs',
      '4',
      '--json',
    ],
    cwd: process.cwd(),
    stdout,
    now: () => NOW,
    serviceTickRunner: async (options) => {
      tickCalls.push(options);
      return createTickResult({
        tickId: 'os_service_tick_cli_json_001',
      });
    },
  });

  const output = JSON.parse(stdout.text());

  assert.equal(commandResult.mode, 'tick');
  assert.equal(commandResult.exitCode, 0);
  assert.equal(output.tickId, 'os_service_tick_cli_json_001');
  assert.equal(tickCalls.length, 1);
  assert.equal(tickCalls[0].projectRootPath, projectRootPath);
  assert.equal(tickCalls[0].maxDispatchedJobs, 4);
  assert.equal(commandResult.lockClaim.status, 'claimed');
  assert.equal(commandResult.lockRelease.status, 'released');
  assert.equal(await readKernelLock({ projectRootPath }), null);

  const heartbeat = await readServiceHeartbeat({ projectRootPath });
  const state = await readServiceState({ projectRootPath });

  assert.equal(heartbeat.serviceId, commandResult.serviceId);
  assert.equal(heartbeat.status, 'stopped');
  assert.equal(heartbeat.lastTickStatus, 'idle');
  assert.equal(heartbeat.tickCount, 1);
  assert.equal(state.serviceId, commandResult.serviceId);
  assert.equal(state.status, 'stopped');
  assert.equal(state.stopReason, 'one_shot_tick_completed');
  assert.equal(state.lock.claimStatus, 'released');
  assert.equal(state.lastTick.tickId, 'os_service_tick_cli_json_001');
  assert.equal(state.config.maxDispatchedJobsPerTick, 4);
  assert.deepEqual(
    (await adapter.readEvents({ date: '2026-05-17' })).map((event) => event.eventType),
    [
      'os.service.lock.claimed',
      'os.service.lock.released',
    ],
  );
});

test('runOpenMasOsServiceCommand prints System Call outcome counts in human tick output', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const stdout = createCaptureStream();

  await runOpenMasOsServiceCommand({
    argv: [
      '--tick',
      '--project-root',
      projectRootPath,
    ],
    cwd: process.cwd(),
    stdout,
    now: () => NOW,
    serviceTickRunner: async () => createTickResult({
      tickId: 'os_service_tick_cli_human_syscalls_001',
      status: 'completed',
      systemCalls: {
        processedAt: NOW,
        processedCount: 2,
        completedCount: 1,
        deniedCount: 1,
        failedCount: 0,
        expiredCount: 0,
        cancelledCount: 0,
        results: [
          {
            systemCallId: 'syscall_human_completed_001',
            operation: 'delegate',
            status: 'completed',
            finalState: 'completed',
            createdJobIds: ['job_human_completed_001'],
            createdTimerIds: [],
            createdSignalIds: [],
            summary: 'Completed human tick syscall.',
          },
          {
            systemCallId: 'syscall_human_denied_001',
            operation: 'schedule_delegation',
            status: 'denied',
            finalState: 'denied',
            createdJobIds: [],
            createdTimerIds: [],
            createdSignalIds: [],
            summary: 'Denied human tick syscall.',
          },
        ],
      },
    }),
  });
  const output = stdout.text();

  assert.match(output, /System Calls: 2/u);
  assert.match(output, /System Call Results: completed=1 denied=1 failed=0 expired=0 cancelled=0/u);
  assert.match(output, /syscall delegate: syscall_human_completed_001 -> completed \(completed\)/u);
  assert.match(output, /syscall schedule_delegation: syscall_human_denied_001 -> denied \(denied\)/u);
});

test('runOpenMasOsServiceCommand status reflects the latest manual --tick snapshot', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const tickStdout = createCaptureStream();

  const tickCommandResult = await runOpenMasOsServiceCommand({
    argv: [
      '--tick',
      '--project-root',
      projectRootPath,
      '--json',
    ],
    cwd: process.cwd(),
    stdout: tickStdout,
    now: () => NOW,
    serviceTickRunner: async () => createTickResult({
      tickId: 'os_service_tick_status_snapshot_001',
      status: 'completed',
      systemCalls: {
        processedCount: 2,
        completedCount: 1,
        deniedCount: 1,
        failedCount: 0,
        expiredCount: 0,
        cancelledCount: 0,
      },
      readyWork: {
        candidateCount: 1,
        dispatchedCount: 1,
        deferredCount: 0,
      },
      dispatches: [
        {
          dispatchType: 'ready_job',
          jobId: 'job_status_snapshot_001',
          status: 'completed',
        },
      ],
    }),
  });
  const statusStdout = createCaptureStream();

  const statusCommandResult = await runOpenMasOsServiceCommand({
    argv: [
      '--status',
      '--project-root',
      projectRootPath,
      '--json',
    ],
    cwd: process.cwd(),
    stdout: statusStdout,
    now: () => STATUS_LATER,
  });
  const statusOutput = JSON.parse(statusStdout.text());

  assert.equal(tickCommandResult.lockRelease.status, 'released');
  assert.equal(statusCommandResult.result.summary.serviceId, tickCommandResult.serviceId);
  assert.equal(statusCommandResult.result.summary.status, 'stopped');
  assert.equal(statusCommandResult.result.summary.lock.status, 'missing');
  assert.equal(statusCommandResult.result.summary.lastTickStatus, 'completed');
  assert.equal(statusCommandResult.result.summary.tickCount, 1);
  assert.equal(statusCommandResult.result.summary.systemCallProcessedCount, 2);
  assert.equal(statusCommandResult.result.state.lastTick.dispatchedCount, 1);
  assert.equal(statusCommandResult.result.state.stopReason, 'one_shot_tick_completed');
  assert.equal(statusCommandResult.result.health.nextRecommendedAction, 'Service is stopped.');
  assert.equal(statusOutput.summary.serviceId, tickCommandResult.serviceId);
  assert.equal(statusOutput.summary.lastTickStatus, 'completed');
  assert.equal(statusOutput.health.systemCallProcessedCount, 2);
});

test('runOpenMasOsServiceCommand records failed manual --tick snapshots and releases the lock', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const adapter = createLocalRuntimeAdapter({ projectRootPath });
  const stdout = createCaptureStream();
  const tickError = new Error(`Provider failed with ${buildFakeOpenRouterSecretProbe('secretvalue123456789')} during manual tick.`);

  tickError.name = 'ManualTickFailure';

  await assert.rejects(
    () => runOpenMasOsServiceCommand({
      argv: [
        '--tick',
        '--project-root',
        projectRootPath,
      ],
      cwd: process.cwd(),
      stdout,
      now: () => STATUS_LATER,
      serviceTickRunner: async () => {
        throw tickError;
      },
    }),
    /Provider failed/u,
  );

  const heartbeat = await readServiceHeartbeat({ projectRootPath });
  const state = await readServiceState({ projectRootPath });
  const statusStdout = createCaptureStream();
  const statusCommandResult = await runOpenMasOsServiceCommand({
    argv: [
      '--status',
      '--project-root',
      projectRootPath,
      '--json',
    ],
    cwd: process.cwd(),
    stdout: statusStdout,
    now: () => STATUS_LATER,
  });
  const eventTypes = (await adapter.readEvents({ date: '2026-05-17' }))
    .map((event) => event.eventType);
  const serializedState = JSON.stringify(state);

  assert.equal(await readKernelLock({ projectRootPath }), null);
  assert.equal(heartbeat.status, 'stopped');
  assert.equal(heartbeat.lastTickStatus, 'failed');
  assert.equal(heartbeat.tickCount, 1);
  assert.equal(heartbeat.failedTickCount, 1);
  assert.equal(state.status, 'stopped');
  assert.equal(state.stopReason, 'one_shot_tick_failed');
  assert.equal(state.stats.tickCount, 1);
  assert.equal(state.stats.failedTickCount, 1);
  assert.equal(state.lastTick.status, 'failed');
  assert.equal(state.lastError.name, 'ManualTickFailure');
  assert.equal(state.lastError.message, 'Provider failed with [redacted-secret] during manual tick.');
  assert.equal(state.lock.claimStatus, 'released');
  assert.doesNotMatch(serializedState, /sk-or-v1/u);
  assert.deepEqual(eventTypes, [
    'os.service.lock.claimed',
    'os.service.lock.released',
  ]);
  assert.equal(statusCommandResult.result.summary.status, 'stopped');
  assert.equal(statusCommandResult.result.summary.lastTickStatus, 'failed');
  assert.equal(statusCommandResult.result.summary.failedTickCount, 1);
  assert.equal(statusCommandResult.result.health.nextRecommendedAction, 'Service is stopped.');
});

test('runOpenMasOsServiceCommand refuses manual --tick while a fresh service lock exists', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const existingClaim = await claimKernelLock({
    projectRootPath,
    serviceId: 'openmas_os_service_existing_tick_owner',
    staleAfterMs: 60000,
    now: () => NOW,
  });
  const tickCalls = [];

  await assert.rejects(
    () => runOpenMasOsServiceCommand({
      argv: [
        '--tick',
        '--project-root',
        projectRootPath,
      ],
      cwd: process.cwd(),
      stdout: createCaptureStream(),
      now: () => STATUS_LATER,
      serviceTickRunner: async (options) => {
        tickCalls.push(options);
        return createTickResult();
      },
    }),
    /another service owns a fresh kernel lock/u,
  );

  assert.equal(tickCalls.length, 0);
  assert.deepEqual(await readKernelLock({ projectRootPath }), existingClaim.lock);
});

test('runOpenMasOsServiceCommand recovers stale lock for manual --tick and releases it afterward', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const adapter = createLocalRuntimeAdapter({ projectRootPath });
  const previousClaim = await claimKernelLock({
    projectRootPath,
    serviceId: 'openmas_os_service_stale_tick_owner',
    staleAfterMs: 1000,
    now: () => NOW,
  });
  const stdout = createCaptureStream();

  const commandResult = await runOpenMasOsServiceCommand({
    argv: [
      '--tick',
      '--project-root',
      projectRootPath,
    ],
    cwd: process.cwd(),
    stdout,
    now: () => RECOVERY_NOW,
    serviceTickRunner: async () => createTickResult({
      tickId: 'os_service_tick_recovered_manual_001',
      status: 'idle',
    }),
  });
  const events = await adapter.readEvents({ date: '2026-05-17' });
  const eventTypes = events.map((event) => event.eventType);

  assert.equal(commandResult.mode, 'tick');
  assert.equal(commandResult.lockClaim.status, 'recovered');
  assert.equal(commandResult.lockClaim.previousLock.lockId, previousClaim.lock.lockId);
  assert.equal(commandResult.lockRelease.status, 'released');
  assert.equal(commandResult.result.tickId, 'os_service_tick_recovered_manual_001');
  assert.equal(await readKernelLock({ projectRootPath }), null);
  assert.ok(eventTypes.includes('os.service.lock.recovered'));
  assert.ok(eventTypes.includes('os.service.lock.released'));
});

test('runOpenMasOsServiceCommand refuses manual --tick stale-lock recovery when owner heartbeat is fresh', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const adapter = createLocalRuntimeAdapter({ projectRootPath });
  const previousClaim = await claimKernelLock({
    projectRootPath,
    serviceId: 'openmas_os_service_tick_heartbeat_owner',
    staleAfterMs: 1000,
    now: () => NOW,
  });
  const tickCalls = [];

  await writeServiceHealthSnapshot({
    projectRootPath,
    state: buildServiceState({
      serviceId: 'openmas_os_service_tick_heartbeat_owner',
      status: 'running',
      projectRootPath,
      startedAt: NOW,
      updatedAt: RECOVERY_NOW,
      config: {
        tickIntervalMs: 5000,
        heartbeatIntervalMs: 5000,
        maxDispatchedJobsPerTick: 25,
        staleAfterMs: 30000,
      },
      lock: {
        lockId: previousClaim.lock.lockId,
        serviceId: previousClaim.lock.serviceId,
        status: previousClaim.lock.status,
        claimStatus: previousClaim.status,
        refreshedAt: previousClaim.lock.refreshedAt,
      },
    }),
    lastHeartbeatAt: RECOVERY_NOW,
  });

  await assert.rejects(
    () => runOpenMasOsServiceCommand({
      argv: [
        '--tick',
        '--project-root',
        projectRootPath,
      ],
      cwd: process.cwd(),
      stdout: createCaptureStream(),
      now: () => RECOVERY_NOW,
      serviceTickRunner: async (options) => {
        tickCalls.push(options);
        return createTickResult();
      },
    }),
    /existing service heartbeat is still fresh/u,
  );

  const eventTypes = (await adapter.readEvents({ date: '2026-05-17' }))
    .map((event) => event.eventType);

  assert.equal(tickCalls.length, 0);
  assert.deepEqual(await readKernelLock({ projectRootPath }), previousClaim.lock);
  assert.ok(!eventTypes.includes('os.service.lock.recovered'));
});

test('runOpenMasOsServiceCommand reports stopped status when service files are absent', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const stdout = createCaptureStream();

  const commandResult = await runOpenMasOsServiceCommand({
    argv: [
      '--status',
      '--project-root',
      projectRootPath,
      '--json',
    ],
    cwd: process.cwd(),
    stdout,
    now: () => NOW,
  });
  const output = JSON.parse(stdout.text());

  assert.equal(commandResult.mode, 'status');
  assert.equal(commandResult.exitCode, 0);
  assert.deepEqual(commandResult.result, output);
  assert.equal(output.kind, 'openmas_os_service_status_result');
  assert.equal(output.summary.status, 'stopped');
  assert.equal(output.summary.serviceId, null);
  assert.equal(output.summary.lock.status, 'missing');
  assert.equal(output.summary.heartbeatPresent, false);
  assert.equal(output.summary.statePresent, false);
  assert.equal(output.systemCalls.stateCounts.pending, 0);
  assert.equal(output.systemCalls.resultCount, 0);
  assert.equal(output.summary.nextRecommendedAction, 'Start the service with --watch.');
});

test('runOpenMasOsServiceCommand reports System Call backlog and recent results without processing pending calls', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const inbox = createLocalSystemCallInbox({ projectRootPath });
  const stdout = createCaptureStream();

  await inbox.submitSystemCall(createSystemCall({
    systemCallId: 'syscall_status_pending_001',
    idempotencyKey: 'delegate:status:pending:001',
    expiresAt: '2026-05-17T12:03:00-05:00',
  }));
  await inbox.submitSystemCall(createSystemCall({
    systemCallId: 'syscall_status_expired_pending_001',
    idempotencyKey: 'delegate:status:expired-pending:001',
    expiresAt: STATUS_LATER,
  }));
  await inbox.submitSystemCall(createSystemCall({
    systemCallId: 'syscall_status_processing_001',
    idempotencyKey: 'delegate:status:processing:001',
  }));
  await inbox.moveSystemCall({
    systemCallId: 'syscall_status_processing_001',
    fromState: 'pending',
    toState: 'processing',
  });

  await inbox.submitSystemCall(createSystemCall({
    systemCallId: 'syscall_status_completed_001',
    idempotencyKey: 'delegate:status:completed:001',
  }));
  await inbox.persistSystemCallResult(createSystemCallResult({
    systemCallId: 'syscall_status_completed_001',
    processedAt: STATUS_LATER,
  }));
  await inbox.moveSystemCall({
    systemCallId: 'syscall_status_completed_001',
    fromState: 'pending',
    toState: 'completed',
  });

  await inbox.submitSystemCall(createSystemCall({
    systemCallId: 'syscall_status_denied_001',
    idempotencyKey: 'delegate:status:denied:001',
  }));
  await inbox.persistSystemCallResult(createSystemCallResult({
    systemCallId: 'syscall_status_denied_001',
    status: 'denied',
    processedAt: '2026-05-17T12:00:03-05:00',
    decision: {
      allowed: false,
      reason: 'Denied by status test policy.',
    },
    effects: {
      createdJobIds: [],
      createdTimerIds: [],
      createdSignalIds: [],
      createdProcessIds: [],
      createdThreadIds: [],
      eventIds: [],
    },
    summary: 'OpenMAS OS denied the status test delegation.',
  }));
  await inbox.moveSystemCall({
    systemCallId: 'syscall_status_denied_001',
    fromState: 'pending',
    toState: 'denied',
  });

  await inbox.submitSystemCall(createSystemCall({
    systemCallId: 'syscall_status_failed_001',
    idempotencyKey: 'delegate:status:failed:001',
  }));
  await inbox.persistSystemCallResult(createSystemCallResult({
    systemCallId: 'syscall_status_failed_001',
    status: 'failed',
    processedAt: '2026-05-17T12:00:04-05:00',
    decision: {
      allowed: false,
      reason: 'Processor failed during status test.',
    },
    effects: {
      createdJobIds: [],
      createdTimerIds: [],
      createdSignalIds: [],
      createdProcessIds: [],
      createdThreadIds: [],
      eventIds: [],
    },
    summary: 'OpenMAS OS failed the status test system call.',
  }));
  await inbox.moveSystemCall({
    systemCallId: 'syscall_status_failed_001',
    fromState: 'pending',
    toState: 'failed',
  });

  const commandResult = await runOpenMasOsServiceCommand({
    argv: [
      '--status',
      '--project-root',
      projectRootPath,
      '--json',
    ],
    cwd: process.cwd(),
    stdout,
    now: () => RECOVERY_NOW,
  });
  const output = JSON.parse(stdout.text());
  const serializedOutput = JSON.stringify(output);

  assert.equal(commandResult.result.summary.status, 'stopped');
  assert.equal(output.systemCalls.kind, 'openmas_os_system_call_status_summary');
  assert.equal(output.systemCalls.status, 'readable');
  assert.equal(output.systemCalls.stateCounts.pending, 2);
  assert.equal(output.systemCalls.stateCounts.processing, 1);
  assert.equal(output.systemCalls.stateCounts.completed, 1);
  assert.equal(output.systemCalls.stateCounts.denied, 1);
  assert.equal(output.systemCalls.stateCounts.failed, 1);
  assert.equal(output.systemCalls.resultCount, 3);
  assert.equal(output.systemCalls.pending.expiredCount, 1);
  assert.equal(output.systemCalls.pending.staleCount, 2);
  assert.equal(output.systemCalls.current.status, 'attention_required');
  assert.equal(output.systemCalls.current.attentionRequired, true);
  assert.equal(output.systemCalls.current.pendingCount, 2);
  assert.equal(output.systemCalls.current.processingCount, 1);
  assert.equal(output.systemCalls.current.expiredPendingCount, 1);
  assert.equal(output.systemCalls.history.failedCount, 1);
  assert.equal(output.systemCalls.history.lastFailure.systemCallId, 'syscall_status_failed_001');
  assert.equal(output.systemCalls.recentResults[0].systemCallId, 'syscall_status_completed_001');
  assert.equal(output.systemCalls.lastSystemCallError.systemCallId, 'syscall_status_failed_001');
  assert.equal(output.systemCalls.lastSystemCallFailure.systemCallId, 'syscall_status_failed_001');
  assert.ok(output.systemCalls.recentResults.some((result) => {
    return result.systemCallId === 'syscall_status_failed_001'
      && result.summary === 'OpenMAS OS failed the status test system call.';
  }));
  assert.equal((await inbox.listPendingSystemCallIds()).length, 2);
  assert.doesNotMatch(serializedOutput, /Private pending payload/u);
});

test('runOpenMasOsServiceCommand reports degraded System Call status when a local syscall file is malformed', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const stdout = createCaptureStream();
  const pendingRootPath = path.join(projectRootPath, 'instance', 'os', 'system-calls', 'pending');

  await mkdir(pendingRootPath, { recursive: true });
  await writeFile(
    path.join(pendingRootPath, 'syscall_status_broken_001.json'),
    '{',
    'utf8',
  );

  const commandResult = await runOpenMasOsServiceCommand({
    argv: [
      '--status',
      '--project-root',
      projectRootPath,
      '--json',
    ],
    cwd: process.cwd(),
    stdout,
    now: () => NOW,
  });
  const output = JSON.parse(stdout.text());

  assert.equal(commandResult.mode, 'status');
  assert.equal(output.systemCalls.status, 'degraded');
  assert.equal(output.systemCalls.current.status, 'degraded');
  assert.equal(output.systemCalls.readErrors.length, 1);
  assert.match(output.systemCalls.readErrors[0].scope, /system-calls\/pending/u);
  assert.match(output.systemCalls.readErrors[0].message, /could not be parsed as JSON/u);
  assert.equal(
    output.summary.nextRecommendedAction,
    'Inspect current pending or processing System Call storage; it could not be fully read.',
  );
});

test('runOpenMasOsServiceCommand does not degrade live queue health for malformed terminal syscall history', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const stdout = createCaptureStream();
  const failedRootPath = path.join(projectRootPath, 'instance', 'os', 'system-calls', 'failed');

  await mkdir(failedRootPath, { recursive: true });
  await writeFile(
    path.join(failedRootPath, 'syscall_status_terminal_broken_001.json'),
    '{',
    'utf8',
  );

  const commandResult = await runOpenMasOsServiceCommand({
    argv: [
      '--status',
      '--project-root',
      projectRootPath,
      '--json',
    ],
    cwd: process.cwd(),
    stdout,
    now: () => NOW,
  });
  const output = JSON.parse(stdout.text());

  assert.equal(commandResult.mode, 'status');
  assert.equal(output.systemCalls.status, 'degraded');
  assert.equal(output.systemCalls.current.status, 'clear');
  assert.equal(output.systemCalls.current.attentionRequired, false);
  assert.equal(output.systemCalls.current.readErrorCount, 0);
  assert.equal(output.systemCalls.history.status, 'degraded');
  assert.equal(output.systemCalls.history.malformedCount, 1);
  assert.equal(output.systemCalls.readErrors.length, 1);
  assert.match(output.systemCalls.readErrors[0].scope, /system-calls\/failed/u);
  assert.match(output.systemCalls.readErrors[0].message, /could not be parsed as JSON/u);
});

test('runOpenMasOsServiceCommand surfaces terminal syscall storage warnings in human status', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const stdout = createCaptureStream();
  const failedRootPath = path.join(projectRootPath, 'instance', 'os', 'system-calls', 'failed');

  await mkdir(failedRootPath, { recursive: true });
  await writeFile(
    path.join(failedRootPath, 'syscall_status_terminal_broken_human_001.json'),
    '{',
    'utf8',
  );

  const commandResult = await runOpenMasOsServiceCommand({
    argv: [
      '--status',
      '--project-root',
      projectRootPath,
    ],
    cwd: process.cwd(),
    stdout,
    now: () => NOW,
  });
  const output = stdout.text();

  assert.equal(commandResult.mode, 'status');
  assert.equal(commandResult.result.systemCalls.current.status, 'clear');
  assert.match(output, /System Call Queue Health: clear \(No pending or processing System Calls\.\)/u);
  assert.match(
    output,
    /Historical System Call Evidence: degraded \(1 malformed\/unreadable record\(s\)\); current queue health is reported separately\./u,
  );
});

test('runOpenMasOsServiceCommand labels old System Call failures as historical in human status', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const inbox = createLocalSystemCallInbox({ projectRootPath });
  const stdout = createCaptureStream();

  await inbox.submitSystemCall(createSystemCall({
    systemCallId: 'syscall_status_historical_failed_001',
    idempotencyKey: 'delegate:status:historical-failed:001',
  }));
  await inbox.persistSystemCallResult(createSystemCallResult({
    systemCallId: 'syscall_status_historical_failed_001',
    status: 'failed',
    decision: {
      allowed: false,
      reason: 'Historical failure from an older tick.',
    },
    effects: {
      createdJobIds: [],
      createdTimerIds: [],
      createdSignalIds: [],
      createdProcessIds: [],
      createdThreadIds: [],
      eventIds: [],
    },
    summary: 'OpenMAS OS failed an older system call.',
  }));
  await inbox.moveSystemCall({
    systemCallId: 'syscall_status_historical_failed_001',
    fromState: 'pending',
    toState: 'failed',
  });

  const commandResult = await runOpenMasOsServiceCommand({
    argv: [
      '--status',
      '--project-root',
      projectRootPath,
    ],
    cwd: process.cwd(),
    stdout,
    now: () => STATUS_LATER,
  });
  const output = stdout.text();

  assert.equal(commandResult.result.systemCalls.current.status, 'clear');
  assert.equal(commandResult.result.systemCalls.current.attentionRequired, false);
  assert.equal(
    commandResult.result.systemCalls.history.lastFailure.systemCallId,
    'syscall_status_historical_failed_001',
  );
  assert.match(output, /System Call Queue Health: clear \(No pending or processing System Calls\.\)/u);
  assert.match(output, /Last Historical System Call Failure: syscall_status_historical_failed_001/u);
  assert.doesNotMatch(output, /Last System Call Error/u);
});

test('runOpenMasOsServiceCommand exposes recent normalized Result Records in status inspection', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const adapter = createLocalRuntimeAdapter({ projectRootPath });
  const stdout = createCaptureStream();

  await adapter.persistResultRecord(createStatusResultRecord());

  const commandResult = await runOpenMasOsServiceCommand({
    argv: [
      '--status',
      '--project-root',
      projectRootPath,
    ],
    cwd: process.cwd(),
    stdout,
    now: () => STATUS_LATER,
  });

  assert.equal(commandResult.result.resultRecords.status, 'readable');
  assert.equal(commandResult.result.resultRecords.recent.length, 1);
  assert.equal(commandResult.result.resultRecords.recent[0].resultKind, 'delegated_child_result');
  assert.equal(commandResult.result.resultRecords.recent[0].status, 'completed');
  assert.match(stdout.text(), /Recent Result Records: 1/u);
  assert.match(
    stdout.text(),
    /- Result: delegated_child_result result_status_recent_bruce_001 -> completed/u,
  );
});

test('runOpenMasOsServiceCommand reports unsupported blocked resource waits as attention-required scheduler state', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const adapter = createLocalRuntimeAdapter({ projectRootPath });
  const stdout = createCaptureStream();

  await adapter.persistJob(createBlockedWaitJob());
  await adapter.persistProcess(createBlockedWaitProcess());
  await adapter.persistThread(createBlockedWaitThread());

  const commandResult = await runOpenMasOsServiceCommand({
    argv: [
      '--status',
      '--project-root',
      projectRootPath,
      '--json',
    ],
    cwd: process.cwd(),
    stdout,
    now: () => STATUS_LATER,
  });
  const output = JSON.parse(stdout.text());

  assert.equal(commandResult.mode, 'status');
  assert.equal(output.blockedWaits.kind, 'openmas_os_blocked_wait_status_summary');
  assert.equal(output.blockedWaits.status, 'attention_required');
  assert.equal(output.blockedWaits.attentionRequired, true);
  assert.equal(output.blockedWaits.count, 1);
  assert.equal(output.blockedWaits.attentionCount, 1);
  assert.equal(output.blockedWaits.reasonCounts.waiting_for_resource, 1);
  assert.equal(output.blockedWaits.oldest[0].attentionReason, 'unsupported_foreground_resource_wait');
  assert.equal(
    output.summary.nextRecommendedAction,
    'Inspect blocked scheduler waits; one or more waits require attention.',
  );
});

test('runOpenMasOsServiceCommand reports syscall-trapped callers with terminal delegation results as attention-required', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const adapter = createLocalRuntimeAdapter({ projectRootPath });
  const inbox = createLocalSystemCallInbox({ projectRootPath });
  const stdout = createCaptureStream();
  const correlation = {
    invocationId: 'invocation_status_trapped_syscall_001',
    processId: 'process_status_blocked_wait_001',
    threadId: 'thread_status_blocked_wait_001',
    conversationId: 'alfred-admin',
  };

  await adapter.persistJob(createBlockedWaitJob());
  await adapter.persistProcess(createBlockedWaitProcess());
  await adapter.persistThread(createBlockedWaitThread({
    waitReason: 'waiting_for_system_call',
  }));
  await inbox.submitSystemCall(createSystemCall({
    systemCallId: 'syscall_status_trapped_expired_001',
    idempotencyKey: 'delegate:status:trapped-expired:001',
    correlation,
  }));
  await inbox.persistSystemCallResult(createSystemCallResult({
    systemCallId: 'syscall_status_trapped_expired_001',
    status: 'expired',
    decision: {
      allowed: false,
      reason: 'System Call expired before processing.',
    },
    effects: {
      createdJobIds: [],
      createdTimerIds: [],
      createdSignalIds: [],
      createdProcessIds: [],
      createdThreadIds: [],
      eventIds: [],
    },
    summary: 'OpenMAS OS expired the trapped status test delegation.',
    correlation,
  }));
  await inbox.moveSystemCall({
    systemCallId: 'syscall_status_trapped_expired_001',
    fromState: 'pending',
    toState: 'expired',
  });

  const commandResult = await runOpenMasOsServiceCommand({
    argv: [
      '--status',
      '--project-root',
      projectRootPath,
      '--json',
    ],
    cwd: process.cwd(),
    stdout,
    now: () => STATUS_LATER,
  });
  const output = JSON.parse(stdout.text());

  assert.equal(commandResult.mode, 'status');
  assert.equal(output.blockedWaits.status, 'attention_required');
  assert.equal(output.blockedWaits.attentionCount, 1);
  assert.equal(
    output.blockedWaits.oldest[0].attentionReason,
    'terminal_delegation_system_call_caller_stranded',
  );
  assert.equal(output.blockedWaits.oldest[0].terminalSystemCallId, 'syscall_status_trapped_expired_001');
  assert.equal(output.blockedWaits.oldest[0].terminalSystemCallStatus, 'expired');
});

test('runOpenMasOsServiceCommand shows valid child waits in human status without a false alarm', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const adapter = createLocalRuntimeAdapter({ projectRootPath });
  const stdout = createCaptureStream();

  await adapter.persistJob(createBlockedWaitJob());
  await adapter.persistProcess(createBlockedWaitProcess());
  await adapter.persistThread(createBlockedWaitThread({
    waitReason: 'waiting_for_child_process',
  }));

  const commandResult = await runOpenMasOsServiceCommand({
    argv: [
      '--status',
      '--project-root',
      projectRootPath,
    ],
    cwd: process.cwd(),
    stdout,
    now: () => STATUS_LATER,
  });
  const output = stdout.text();

  assert.equal(commandResult.result.blockedWaits.status, 'active');
  assert.equal(commandResult.result.blockedWaits.attentionRequired, false);
  assert.match(output, /Blocked Waits: 1/u);
  assert.match(output, /Blocked Wait Health: active/u);
  assert.match(output, /Blocked Wait Reasons: waiting_for_child_process=1/u);
  assert.doesNotMatch(output, /Blocked Wait Attention/u);
});

test('runOpenMasOsServiceCommand reports running service status from heartbeat and lock evidence', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const stdout = createCaptureStream();
  const lockClaim = await claimKernelLock({
    projectRootPath,
    serviceId: 'openmas_os_service_status_running',
    staleAfterMs: 30000,
    now: () => NOW,
    pid: 12345,
    hostname: 'status-host',
  });

  await writeServiceHealthSnapshot({
    projectRootPath,
    state: buildServiceState({
      serviceId: 'openmas_os_service_status_running',
      status: 'running',
      projectRootPath,
      pid: 12345,
      hostname: 'status-host',
      startedAt: NOW,
      updatedAt: NOW,
      config: {
        tickIntervalMs: 5000,
        heartbeatIntervalMs: 5000,
        maxDispatchedJobsPerTick: 25,
        staleAfterMs: 30000,
      },
      stats: {
        tickCount: 12,
        idleTickCount: 3,
        completedTickCount: 9,
        completedWithFailuresTickCount: 0,
        failedTickCount: 0,
        skippedTickCount: 1,
      },
      lastTick: {
        tickId: 'os_service_tick_status_012',
        status: 'completed',
        startedAt: NOW,
        finishedAt: NOW,
        releasedCount: 1,
        pendingCount: 0,
        readyCandidateCount: 1,
        dispatchedCount: 1,
        deferredCount: 0,
        asyncActiveExecutionCount: 2,
        asyncMaxConcurrentExecutions: 25,
        failedDispatchCount: 0,
      },
      lock: {
        lockId: lockClaim.lock.lockId,
        serviceId: lockClaim.lock.serviceId,
        status: lockClaim.lock.status,
        claimStatus: lockClaim.status,
        refreshedAt: lockClaim.lock.refreshedAt,
      },
    }),
    lastHeartbeatAt: NOW,
  });

  const commandResult = await runOpenMasOsServiceCommand({
    argv: [
      '--status',
      '--project-root',
      projectRootPath,
    ],
    cwd: process.cwd(),
    stdout,
    now: () => STATUS_LATER,
  });
  const output = stdout.text();

  assert.equal(commandResult.mode, 'status');
  assert.equal(commandResult.result.summary.status, 'running');
  assert.equal(commandResult.result.summary.serviceId, 'openmas_os_service_status_running');
  assert.equal(commandResult.result.summary.pid, 12345);
  assert.equal(commandResult.result.summary.lock.status, 'fresh');
  assert.equal(commandResult.result.summary.heartbeatAgeMs, 5000);
  assert.equal(commandResult.result.summary.uptimeMs, 5000);
  assert.equal(commandResult.result.summary.tickCount, 12);
  assert.equal(commandResult.result.summary.failedTickCount, 0);
  assert.equal(commandResult.result.summary.skippedTickCount, 1);
  assert.equal(commandResult.result.summary.activeAsyncExecutionCount, 2);
  assert.equal(commandResult.result.summary.asyncMaxConcurrentExecutions, 25);
  assert.equal(
    commandResult.result.summary.nextRecommendedAction,
    'Service is healthy; 2 asynchronous execution(s) active.',
  );
  assert.match(output, /OpenMAS OS Service Status/u);
  assert.match(output, /Status: running/u);
  assert.match(output, /Kernel Lock: fresh/u);
  assert.match(output, /Heartbeat Age: 5s/u);
  assert.match(output, /Last Tick: completed/u);
  assert.match(output, /Skipped Ticks: 1/u);
  assert.match(output, /Async Executions Active: 2\/25/u);
  assert.match(output, /Next Action: Service is healthy; 2 asynchronous execution\(s\) active\./u);
  assert.deepEqual(await readKernelLock({ projectRootPath }), lockClaim.lock);
});

test('runOpenMasOsServiceCommand does not present a stale lock as recoverable while heartbeat is fresh', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const stdout = createCaptureStream();
  const lockClaim = await claimKernelLock({
    projectRootPath,
    serviceId: 'openmas_os_service_status_long_tick',
    staleAfterMs: 1000,
    now: () => NOW,
  });

  await writeServiceHealthSnapshot({
    projectRootPath,
    state: buildServiceState({
      serviceId: 'openmas_os_service_status_long_tick',
      status: 'ticking',
      projectRootPath,
      startedAt: NOW,
      updatedAt: RECOVERY_NOW,
      config: {
        tickIntervalMs: 1000,
        heartbeatIntervalMs: 1000,
        maxDispatchedJobsPerTick: 25,
        staleAfterMs: 30000,
      },
      stats: {
        tickCount: 42,
        idleTickCount: 20,
        completedTickCount: 21,
        completedWithFailuresTickCount: 0,
        failedTickCount: 0,
        skippedTickCount: 18,
      },
      lastTick: {
        tickId: 'os_service_tick_before_long_tick_001',
        status: 'idle',
        startedAt: NOW,
        finishedAt: NOW,
        releasedCount: 0,
        pendingCount: 0,
        readyCandidateCount: 0,
        dispatchedCount: 0,
        deferredCount: 0,
        failedDispatchCount: 0,
      },
      activeTick: {
        tickIndex: 43,
        startedAt: NOW,
      },
      lock: {
        lockId: lockClaim.lock.lockId,
        serviceId: lockClaim.lock.serviceId,
        status: lockClaim.lock.status,
        claimStatus: lockClaim.status,
        refreshedAt: lockClaim.lock.refreshedAt,
      },
    }),
    lastHeartbeatAt: RECOVERY_NOW,
  });

  const commandResult = await runOpenMasOsServiceCommand({
    argv: [
      '--status',
      '--project-root',
      projectRootPath,
    ],
    cwd: process.cwd(),
    stdout,
    now: () => RECOVERY_NOW,
  });
  const output = stdout.text();

  assert.equal(commandResult.result.summary.status, 'ticking');
  assert.equal(commandResult.result.summary.lock.status, 'stale');
  assert.equal(commandResult.result.summary.lock.stale, true);
  assert.equal(
    commandResult.result.summary.lock.operatorStatus,
    'refresh_overdue_active_tick_heartbeat_fresh',
  );
  assert.equal(commandResult.result.summary.lock.recoverySafe, false);
  assert.equal(commandResult.result.summary.heartbeatStale, false);
  assert.deepEqual(commandResult.result.summary.activeTick, {
    tickIndex: 43,
    startedAt: NOW,
  });
  assert.equal(commandResult.result.summary.activeTickAgeMs, 120000);
  assert.equal(
    commandResult.result.summary.nextRecommendedAction,
    'Service is ticking with a fresh heartbeat; wait for the active tick to finish before recovery.',
  );
  assert.match(output, /Status: ticking/u);
  assert.match(output, /Kernel Lock: refresh overdue \(active tick heartbeat fresh\)/u);
  assert.match(output, /Kernel Lock Recovery Safe: false/u);
  assert.match(output, /Heartbeat Stale: false/u);
  assert.match(output, /Active Tick: #43 since 2026-05-17T12:00:00-05:00 \(age 2m\)/u);
  assert.match(output, /Next Action: Service is ticking with a fresh heartbeat; wait for the active tick to finish before recovery\./u);
  assert.deepEqual(await readKernelLock({ projectRootPath }), lockClaim.lock);
});

test('runOpenMasOsServiceCommand reports stale lock status clearly without recovering it', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const stdout = createCaptureStream();
  const lockClaim = await claimKernelLock({
    projectRootPath,
    serviceId: 'openmas_os_service_status_stale',
    staleAfterMs: 1000,
    now: () => NOW,
  });

  await writeServiceHealthSnapshot({
    projectRootPath,
    state: buildServiceState({
      serviceId: 'openmas_os_service_status_stale',
      status: 'running',
      projectRootPath,
      startedAt: NOW,
      updatedAt: NOW,
      config: {
        tickIntervalMs: 5000,
        heartbeatIntervalMs: 5000,
        maxDispatchedJobsPerTick: 25,
        staleAfterMs: 1000,
      },
      lock: {
        lockId: lockClaim.lock.lockId,
        serviceId: lockClaim.lock.serviceId,
        status: lockClaim.lock.status,
        claimStatus: lockClaim.status,
        refreshedAt: lockClaim.lock.refreshedAt,
      },
    }),
    lastHeartbeatAt: NOW,
  });

  const commandResult = await runOpenMasOsServiceCommand({
    argv: [
      '--status',
      '--project-root',
      projectRootPath,
    ],
    cwd: process.cwd(),
    stdout,
    now: () => RECOVERY_NOW,
  });
  const output = stdout.text();

  assert.equal(commandResult.result.summary.lock.status, 'stale');
  assert.equal(commandResult.result.summary.lock.stale, true);
  assert.equal(commandResult.result.summary.lock.ageMs, 120000);
  assert.equal(commandResult.result.summary.heartbeatStale, true);
  assert.equal(
    commandResult.result.summary.nextRecommendedAction,
    'Existing lock is stale; recovery can start safely.',
  );
  assert.match(output, /Kernel Lock: stale/u);
  assert.match(output, /Lock Age: 2m/u);
  assert.match(output, /Heartbeat Stale: true/u);
  assert.match(output, /Next Action: Existing lock is stale; recovery can start safely\./u);
  assert.deepEqual(await readKernelLock({ projectRootPath }), lockClaim.lock);
});

test('runOpenMasOsServiceCommand freezes uptime for stopped service status', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const stdout = createCaptureStream();

  await writeServiceHealthSnapshot({
    projectRootPath,
    state: buildServiceState({
      serviceId: 'openmas_os_service_status_stopped',
      status: 'stopped',
      projectRootPath,
      startedAt: NOW,
      updatedAt: STATUS_LATER,
      stoppedAt: STATUS_LATER,
      config: {
        tickIntervalMs: 5000,
        heartbeatIntervalMs: 5000,
        maxDispatchedJobsPerTick: 25,
        staleAfterMs: 30000,
      },
      stats: {
        tickCount: 2,
        idleTickCount: 1,
        completedTickCount: 1,
        completedWithFailuresTickCount: 0,
        failedTickCount: 0,
        skippedTickCount: 0,
      },
    }),
    lastHeartbeatAt: STATUS_LATER,
  });

  const commandResult = await runOpenMasOsServiceCommand({
    argv: [
      '--status',
      '--project-root',
      projectRootPath,
    ],
    cwd: process.cwd(),
    stdout,
    now: () => RECOVERY_NOW,
  });

  assert.equal(commandResult.result.summary.status, 'stopped');
  assert.equal(commandResult.result.summary.startedAt, NOW);
  assert.equal(commandResult.result.summary.stoppedAt, STATUS_LATER);
  assert.equal(commandResult.result.summary.uptimeMs, 5000);
  assert.match(stdout.text(), /Uptime: 5s/u);
});

test('runOpenMasOsServiceCommand starts watch mode, claims the singleton lock, and runs the runtime loop', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const adapter = createLocalRuntimeAdapter({ projectRootPath });
  const stdout = createCaptureStream();
  const tickCalls = [];

  const commandResult = await runOpenMasOsServiceCommand({
    argv: [
      '--watch',
      '--project-root',
      projectRootPath,
      '--interval',
      '25',
      '--max-dispatched-jobs',
      '2',
      '--service-id',
      'openmas_os_service_watch_cli_test',
    ],
    cwd: process.cwd(),
    stdout,
    now: () => NOW,
    runtimeLoopOptions: {
      maxTicks: 1,
      sleep: async () => {},
      tickRunner: async (options) => {
        tickCalls.push(options);
        return createTickResult({
          tickId: 'os_service_tick_watch_cli_001',
          status: 'completed',
        });
      },
    },
  });
  const output = stdout.text();

  assert.equal(commandResult.mode, 'watch');
  assert.equal(commandResult.exitCode, 0);
  assert.equal(commandResult.serviceId, 'openmas_os_service_watch_cli_test');
  assert.equal(commandResult.lockClaim.status, 'claimed');
  assert.equal(commandResult.result.status, 'stopped');
  assert.equal(commandResult.result.stats.tickCount, 1);
  assert.equal(tickCalls.length, 1);
  assert.equal(tickCalls[0].projectRootPath, projectRootPath);
  assert.equal(tickCalls[0].maxDispatchedJobs, 2);
  assert.equal(typeof tickCalls[0].asyncDispatchExecutor.submit, 'function');
  assert.equal(tickCalls[0].asyncDispatchExecutor.snapshot().maxConcurrentExecutions, 2);
  assert.equal(tickCalls[0].recoverTerminalResultPublications, false);
  assert.match(output, /OpenMAS OS Service Watch/u);
  assert.match(output, /Service ID: openmas_os_service_watch_cli_test/u);
  assert.match(output, /Interval: 25 ms/u);
  assert.match(output, /Async Executor Capacity: 2/u);
  assert.match(output, /Tick: os_service_tick_watch_cli_001 status=completed/u);
  assert.match(output, /OpenMAS OS Service Watch Stopped/u);
  assert.equal(await readKernelLock({ projectRootPath }), null);

  const heartbeat = await readServiceHeartbeat({ projectRootPath });
  const state = await readServiceState({ projectRootPath });

  assert.equal(heartbeat.serviceId, 'openmas_os_service_watch_cli_test');
  assert.equal(heartbeat.status, 'stopped');
  assert.equal(heartbeat.lastTickStatus, 'completed');
  assert.equal(heartbeat.tickCount, 1);
  assert.equal(heartbeat.failedTickCount, 0);
  assert.equal(heartbeat.skippedTickCount, 0);
  assert.equal(state.status, 'stopped');
  assert.equal(state.lock.claimStatus, 'released');
  assert.equal(state.lastTick.tickId, 'os_service_tick_watch_cli_001');

  const eventTypes = (await adapter.readEvents({ date: '2026-05-17' }))
    .map((event) => event.eventType);

  assert.deepEqual(eventTypes, [
    'os.service.lock.claimed',
    'os.service.lock.refreshed',
    'os.service.lock.released',
  ]);
});

test('runOpenMasOsServiceCommand suppresses per-tick watch output in quiet mode', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const stdout = createCaptureStream();
  let tickCount = 0;

  const commandResult = await runOpenMasOsServiceCommand({
    argv: [
      '--watch',
      '--project-root',
      projectRootPath,
      '--quiet',
      '--service-id',
      'openmas_os_service_quiet_watch_cli_test',
    ],
    cwd: process.cwd(),
    stdout,
    now: () => NOW,
    runtimeLoopOptions: {
      maxTicks: 2,
      sleep: async () => {},
      tickRunner: async () => {
        tickCount += 1;

        return createTickResult({
          tickId: `os_service_tick_quiet_watch_00${tickCount}`,
          status: 'idle',
        });
      },
    },
  });
  const output = stdout.text();
  const heartbeat = await readServiceHeartbeat({ projectRootPath });
  const state = await readServiceState({ projectRootPath });

  assert.equal(commandResult.mode, 'watch');
  assert.equal(commandResult.result.stats.tickCount, 2);
  assert.match(output, /OpenMAS OS Service Watch/u);
  assert.match(output, /Tick Output: quiet/u);
  assert.doesNotMatch(output, /Tick: os_service_tick_quiet_watch_001/u);
  assert.doesNotMatch(output, /Tick: os_service_tick_quiet_watch_002/u);
  assert.match(output, /OpenMAS OS Service Watch Stopped/u);
  assert.match(output, /Ticks: 2/u);
  assert.equal(heartbeat.lastTickStatus, 'idle');
  assert.equal(heartbeat.tickCount, 2);
  assert.equal(state.status, 'stopped');
  assert.equal(state.lastTick.tickId, 'os_service_tick_quiet_watch_002');
  assert.equal(await readKernelLock({ projectRootPath }), null);
});

test('runOpenMasOsServiceCommand clears signal-aware sleep polling intervals after bounded watch execution', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const timeoutResourceCountBefore = process.getActiveResourcesInfo()
    .filter((resourceType) => resourceType === 'Timeout').length;

  const commandResult = await runOpenMasOsServiceCommand({
    argv: [
      '--watch',
      '--quiet',
      '--interval',
      '5',
      '--project-root',
      projectRootPath,
      '--service-id',
      'openmas_os_service_bounded_sleep_cleanup_test',
    ],
    cwd: process.cwd(),
    stdout: createCaptureStream(),
    runtimeLoopOptions: {
      maxTicks: 3,
      tickRunner: async () => createTickResult(),
    },
  });

  await new Promise((resolve) => {
    setImmediate(resolve);
  });

  const timeoutResourceCountAfter = process.getActiveResourcesInfo()
    .filter((resourceType) => resourceType === 'Timeout').length;

  assert.equal(commandResult.result.stopReason, 'max_ticks_reached');
  assert.equal(timeoutResourceCountAfter, timeoutResourceCountBefore);
});

test('runOpenMasOsServiceCommand records failed terminal state when watch orchestration aborts', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const stdout = createCaptureStream();

  await assert.rejects(
    () => runOpenMasOsServiceCommand({
      argv: [
        '--watch',
        '--project-root',
        projectRootPath,
        '--service-id',
        'openmas_os_service_watch_failure_terminal_state_test',
      ],
      cwd: process.cwd(),
      stdout,
      now: () => NOW,
      runtimeLoopRunner: async () => {
        throw new Error('Injected watch orchestration failure.');
      },
    }),
    /Injected watch orchestration failure/u,
  );

  const heartbeat = await readServiceHeartbeat({ projectRootPath });
  const state = await readServiceState({ projectRootPath });

  assert.equal(await readKernelLock({ projectRootPath }), null);
  assert.equal(state.status, 'failed');
  assert.equal(state.stopReason, 'service_failed');
  assert.equal(state.lock.claimStatus, 'released');
  assert.match(state.lastError.message, /Injected watch orchestration failure/u);
  assert.equal(heartbeat.status, 'failed');
});

test('runOpenMasOsServiceCommand continues ticking when live health publication is transiently deferred', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const stdout = createCaptureStream();
  const adapter = createLocalRuntimeAdapter({ projectRootPath });
  let healthWriteCount = 0;

  const commandResult = await runOpenMasOsServiceCommand({
    argv: [
      '--watch',
      '--project-root',
      projectRootPath,
      '--service-id',
      'openmas_os_service_transient_health_publication_test',
    ],
    cwd: process.cwd(),
    stdout,
    now: () => NOW,
    serviceHealthSnapshotWriter: async (input) => {
      healthWriteCount += 1;

      if (healthWriteCount === 2) {
        const error = new Error('Injected transient health publication contention.');
        error.code = 'EPERM';
        throw error;
      }

      return writeServiceHealthSnapshot(input);
    },
    runtimeLoopOptions: {
      maxTicks: 1,
      sleep: async () => {},
      tickRunner: async () => createTickResult({
        tickId: 'os_service_tick_transient_health_publication_001',
        status: 'idle',
      }),
    },
  });
  const state = await readServiceState({ projectRootPath });
  const eventTypes = (await adapter.readEvents({ date: '2026-05-17' }))
    .map((event) => event.eventType);

  assert.equal(commandResult.result.status, 'stopped');
  assert.equal(commandResult.result.stats.tickCount, 1);
  assert.equal(state.status, 'stopped');
  assert.equal(await readKernelLock({ projectRootPath }), null);
  assert.ok(eventTypes.includes('os.service.health.publication.deferred'));
  assert.ok(eventTypes.includes('os.service.health.publication.recovered'));
  assert.match(stdout.text(), /Health Publication: deferred after transient EPERM; retrying/u);
  assert.match(stdout.text(), /Health Publication: recovered/u);
});

test('runOpenMasOsServiceCommand persists redacted watch tick failure evidence before recovery', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const adapter = createLocalRuntimeAdapter({ projectRootPath });
  let tickCount = 0;

  const commandResult = await runOpenMasOsServiceCommand({
    argv: [
      '--watch',
      '--project-root',
      projectRootPath,
      '--service-id',
      'openmas_os_service_tick_failure_evidence_test',
    ],
    cwd: process.cwd(),
    stdout: createCaptureStream(),
    now: () => NOW,
    runtimeLoopOptions: {
      maxTicks: 2,
      sleep: async () => {},
      tickRunner: async () => {
        tickCount += 1;

        if (tickCount === 1) {
          throw new Error(`Injected failure with ${buildFakeOpenRouterSecretProbe('secretvalue123456789')}.`);
        }

        return createTickResult({
          tickId: 'os_service_tick_after_failure_evidence_001',
          status: 'idle',
        });
      },
    },
  });
  const events = await adapter.readEvents({ date: '2026-05-17' });
  const failureEvent = events.find((event) => event.eventType === 'os.service.tick.failed');

  assert.equal(commandResult.result.stats.failedTickCount, 1);
  assert.ok(failureEvent);
  assert.equal(failureEvent.payload.serviceId, 'openmas_os_service_tick_failure_evidence_test');
  assert.equal(failureEvent.payload.failedTickCount, 1);
  assert.match(failureEvent.payload.error.message, /\[redacted-secret\]/u);
  assert.doesNotMatch(JSON.stringify(failureEvent), /secretvalue/u);
});

test('runOpenMasOsServiceCommand releases the claimed lock when watch startup setup fails', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const stdout = createCaptureStream();

  await assert.rejects(
    () => runOpenMasOsServiceCommand({
      argv: [
        '--watch',
        '--project-root',
        projectRootPath,
        '--service-id',
        'openmas_os_service_watch_startup_setup_failure_test',
      ],
      cwd: process.cwd(),
      stdout,
      now: () => NOW,
      signalTarget: {},
    }),
    /signalTarget must support/u,
  );

  assert.equal(await readKernelLock({ projectRootPath }), null);
});

test('runOpenMasOsServiceCommand stops watch mode cleanly when stdout closes', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const stdout = createBrokenPipeStream();

  const commandResult = await runOpenMasOsServiceCommand({
    argv: [
      '--watch',
      '--project-root',
      projectRootPath,
      '--service-id',
      'openmas_os_service_stdout_closed_test',
    ],
    cwd: process.cwd(),
    stdout,
    now: () => NOW,
    runtimeLoopOptions: {
      sleep: async () => {
        throw new Error('Closed stdout should stop the watch loop before sleeping.');
      },
      tickRunner: async () => {
        throw new Error('Closed stdout should stop the watch loop before ticking.');
      },
    },
  });

  const heartbeat = await readServiceHeartbeat({ projectRootPath });
  const state = await readServiceState({ projectRootPath });

  assert.equal(commandResult.mode, 'watch');
  assert.equal(commandResult.result.status, 'stopped');
  assert.equal(commandResult.result.stopReason, 'stdout_closed');
  assert.equal(commandResult.result.stats.tickCount, 0);
  assert.equal(await readKernelLock({ projectRootPath }), null);
  assert.equal(heartbeat.status, 'stopped');
  assert.equal(state.status, 'stopped');
  assert.equal(state.stopReason, 'stdout_closed');
});

test('runOpenMasOsServiceCommand persists skipped tick events and heartbeat backpressure stats', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const adapter = createLocalRuntimeAdapter({ projectRootPath });
  const stdout = createCaptureStream();
  const skippedTicks = [];
  let tickCount = 0;
  let activeTickCount = 0;
  let maxActiveTickCount = 0;

  const commandResult = await runOpenMasOsServiceCommand({
    argv: [
      '--watch',
      '--project-root',
      projectRootPath,
      '--interval',
      '5',
      '--service-id',
      'openmas_os_service_backpressure_cli_test',
    ],
    cwd: process.cwd(),
    stdout,
    now: () => NOW,
    runtimeLoopOptions: {
      maxTicks: 2,
      sleep: async () => {},
      tickRunner: async () => {
        tickCount += 1;
        const currentTick = tickCount;
        activeTickCount += 1;
        maxActiveTickCount = Math.max(maxActiveTickCount, activeTickCount);

        try {
          if (currentTick === 1) {
            await new Promise((resolve) => {
              setTimeout(resolve, 25);
            });
          }

          return createTickResult({
            tickId: `os_service_tick_backpressure_cli_00${currentTick}`,
            status: currentTick === 1 ? 'completed' : 'idle',
          });
        } finally {
          activeTickCount -= 1;
        }
      },
      onTickSkipped: async (skippedTick, snapshot) => {
        skippedTicks.push({
          skippedTick,
          skippedTickCount: snapshot.stats.skippedTickCount,
        });
      },
    },
  });

  const heartbeat = await readServiceHeartbeat({ projectRootPath });
  const state = await readServiceState({ projectRootPath });
  const events = await adapter.readEvents({ date: '2026-05-17' });
  const skippedEvents = events.filter((event) => event.eventType === 'os.service.tick.skipped');

  assert.equal(maxActiveTickCount, 1);
  assert.equal(commandResult.result.status, 'stopped');
  assert.equal(commandResult.result.stats.tickCount, 2);
  assert.ok(commandResult.result.stats.skippedTickCount >= 1);
  assert.equal(heartbeat.skippedTickCount, commandResult.result.stats.skippedTickCount);
  assert.equal(state.stats.skippedTickCount, commandResult.result.stats.skippedTickCount);
  assert.equal(skippedTicks.length, commandResult.result.stats.skippedTickCount);
  assert.equal(skippedEvents.length, commandResult.result.stats.skippedTickCount);
  assert.equal(skippedEvents[0].payload.serviceId, 'openmas_os_service_backpressure_cli_test');
  assert.equal(skippedEvents[0].payload.activeTickIndex, 1);
  assert.equal(skippedEvents[0].payload.reason, 'active_tick_in_progress');
  assert.match(stdout.text(), /Skipped Ticks: [1-9]/u);
});

test('runOpenMasOsServiceCommand refuses watch mode when another fresh kernel lock exists', async () => {
  const projectRootPath = await createTemporaryProjectRoot();

  await claimKernelLock({
    projectRootPath,
    serviceId: 'openmas_os_service_existing',
    staleAfterMs: 60000,
    now: () => NOW,
  });

  await assert.rejects(
    () => runOpenMasOsServiceCommand({
      argv: [
        '--watch',
        '--project-root',
        projectRootPath,
        '--service-id',
        'openmas_os_service_competing',
      ],
      cwd: process.cwd(),
      stdout: createCaptureStream(),
      now: () => NOW,
      runtimeLoopOptions: {
        maxTicks: 1,
        tickRunner: async () => createTickResult(),
      },
    }),
    /another service owns a fresh kernel lock/u,
  );
});

test('runOpenMasOsServiceCommand recovers a stale lock before ticking and preserves scheduled work', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const adapter = createLocalRuntimeAdapter({ projectRootPath });
  const stdout = createCaptureStream();
  const previousClaim = await claimKernelLock({
    projectRootPath,
    serviceId: 'openmas_os_service_previous',
    staleAfterMs: 1000,
    now: () => NOW,
  });

  await writeServiceHealthSnapshot({
    projectRootPath,
    state: buildServiceState({
      serviceId: 'openmas_os_service_previous',
      status: 'running',
      projectRootPath,
      startedAt: NOW,
      updatedAt: NOW,
      config: {
        tickIntervalMs: 5,
        heartbeatIntervalMs: 5,
        maxDispatchedJobsPerTick: 1,
        staleAfterMs: 1000,
      },
      lock: {
        lockId: previousClaim.lock.lockId,
        serviceId: previousClaim.lock.serviceId,
        status: previousClaim.lock.status,
        claimStatus: previousClaim.status,
        refreshedAt: previousClaim.lock.refreshedAt,
      },
    }),
    lastHeartbeatAt: NOW,
  });
  await adapter.persistJob(createScheduledOnceJob());
  const scheduled = await scheduleOneShotJob({
    adapter,
    jobId: 'job_recovery_scheduled_once',
    now: () => NOW,
  });
  const invocations = [];

  const commandResult = await runOpenMasOsServiceCommand({
    argv: [
      '--watch',
      '--project-root',
      projectRootPath,
      '--interval',
      '5',
      '--max-dispatched-jobs',
      '1',
      '--service-id',
      'openmas_os_service_recovered',
    ],
    cwd: process.cwd(),
    stdout,
    now: () => RECOVERY_NOW,
    runtimeLoopOptions: {
      maxTicks: 1,
      sleep: async () => {},
      invocationRunner: async (options) => {
        invocations.push(options);

        return {
          invocationId: 'invocation_recovered_scheduled_once_001',
          status: 'completed',
          output: {
            outputText: 'Recovered scheduled job completed.',
          },
          warnings: [],
          errors: [],
          persistence: null,
        };
      },
    },
  });

  const events = await adapter.readEvents({ date: '2026-05-17' });
  const eventTypes = events.map((event) => event.eventType);
  const recoveryEvent = events.find((event) => event.eventType === 'os.service.recovery.completed');
  const recoveredJob = await adapter.loadJob(scheduled.job.jobId);
  const recoveredTimer = await adapter.loadTimer(scheduled.timer.timerId);

  assert.equal(commandResult.lockClaim.status, 'recovered');
  assert.equal(commandResult.lockClaim.previousLock.lockId, previousClaim.lock.lockId);
  assert.equal(commandResult.result.stats.tickCount, 1);
  assert.equal(commandResult.result.stats.completedTickCount, 1);
  assert.equal(commandResult.result.lastTick.dispatchedCount, 1);
  assert.equal(commandResult.result.lastTick.releasedCount, 1);
  assert.equal(invocations.length, 1);
  assert.equal(invocations[0].osRuntimeContext.jobId, scheduled.job.jobId);
  assert.equal(recoveredJob.status, 'completed');
  assert.equal(recoveredTimer.status, 'fired');
  assert.equal(await readKernelLock({ projectRootPath }), null);
  assert.ok(eventTypes.includes('os.service.lock.recovered'));
  assert.ok(eventTypes.includes('os.service.recovery.completed'));
  assert.ok(eventTypes.includes('timer.fired'));
  assert.ok(
    eventTypes.indexOf('os.service.lock.recovered')
      < eventTypes.indexOf('os.service.tick.started'),
  );
  assert.equal(recoveryEvent.payload.previousServiceId, 'openmas_os_service_previous');
  assert.equal(recoveryEvent.payload.previousLockId, previousClaim.lock.lockId);
  assert.equal(recoveryEvent.payload.heartbeatPresent, true);
  assert.equal(recoveryEvent.payload.heartbeatStale, true);
  assert.equal(recoveryEvent.payload.previousStateStatus, 'running');
  assert.match(stdout.text(), /Kernel Lock: recovered/u);
});

test('runOpenMasOsServiceCommand refuses stale lock recovery when the owner heartbeat is fresh', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const adapter = createLocalRuntimeAdapter({ projectRootPath });
  const previousClaim = await claimKernelLock({
    projectRootPath,
    serviceId: 'openmas_os_service_alive',
    staleAfterMs: 1000,
    now: () => NOW,
  });

  await writeServiceHealthSnapshot({
    projectRootPath,
    state: buildServiceState({
      serviceId: 'openmas_os_service_alive',
      status: 'running',
      projectRootPath,
      startedAt: NOW,
      updatedAt: RECOVERY_NOW,
      config: {
        tickIntervalMs: 5,
        heartbeatIntervalMs: 5,
        maxDispatchedJobsPerTick: 1,
        staleAfterMs: 30000,
      },
      lock: {
        lockId: previousClaim.lock.lockId,
        serviceId: previousClaim.lock.serviceId,
        status: previousClaim.lock.status,
        claimStatus: previousClaim.status,
        refreshedAt: previousClaim.lock.refreshedAt,
      },
    }),
    lastHeartbeatAt: RECOVERY_NOW,
  });

  await assert.rejects(
    () => runOpenMasOsServiceCommand({
      argv: [
        '--watch',
        '--project-root',
        projectRootPath,
        '--service-id',
        'openmas_os_service_recovery_candidate',
      ],
      cwd: process.cwd(),
      stdout: createCaptureStream(),
      now: () => RECOVERY_NOW,
      runtimeLoopOptions: {
        maxTicks: 1,
        tickRunner: async () => createTickResult(),
      },
    }),
    /existing service heartbeat is still fresh/u,
  );

  const events = await adapter.readEvents({ date: '2026-05-17' });

  assert.deepEqual(await readKernelLock({ projectRootPath }), previousClaim.lock);
  assert.ok(!events.some((event) => event.eventType === 'os.service.lock.recovered'));
  assert.ok(!events.some((event) => event.eventType === 'os.service.recovery.completed'));
});

test('runOpenMasOsServiceCommand gracefully stops watch mode when SIGTERM arrives while idle', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const adapter = createLocalRuntimeAdapter({ projectRootPath });
  const stdout = createCaptureStream();
  const signalTarget = new EventEmitter();

  const commandResult = await runOpenMasOsServiceCommand({
    argv: [
      '--watch',
      '--project-root',
      projectRootPath,
      '--service-id',
      'openmas_os_service_sigterm_idle_test',
    ],
    cwd: process.cwd(),
    stdout,
    signalTarget,
    now: () => NOW,
    runtimeLoopOptions: {
      sleep: async () => {
        throw new Error('Signal-aware shutdown should stop before the next sleep.');
      },
      tickRunner: async () => createTickResult({
        tickId: 'os_service_tick_sigterm_idle_001',
        status: 'idle',
      }),
      onLifecycleEvent: async (event) => {
        if (event.status === 'idle') {
          signalTarget.emit('SIGTERM');
        }
      },
    },
  });

  const heartbeat = await readServiceHeartbeat({ projectRootPath });
  const state = await readServiceState({ projectRootPath });
  const eventTypes = (await adapter.readEvents({ date: '2026-05-17' }))
    .map((event) => event.eventType);

  assert.equal(commandResult.result.status, 'stopped');
  assert.equal(commandResult.result.stopReason, 'signal_sigterm');
  assert.equal(commandResult.result.stats.tickCount, 1);
  assert.equal(await readKernelLock({ projectRootPath }), null);
  assert.equal(heartbeat.status, 'stopped');
  assert.equal(heartbeat.lastTickStatus, 'idle');
  assert.equal(state.status, 'stopped');
  assert.equal(state.stopRequested, true);
  assert.equal(state.stopReason, 'signal_sigterm');
  assert.equal(state.lock.claimStatus, 'released');
  assert.match(stdout.text(), /received SIGTERM/u);
  assert.deepEqual(eventTypes, [
    'os.service.lock.claimed',
    'os.service.lock.refreshed',
    'os.service.shutdown.requested',
    'os.service.lock.released',
  ]);
});

test('runOpenMasOsServiceCommand drains the active tick before SIGINT shutdown completes', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const signalTarget = new EventEmitter();
  const tickTimeline = [];

  const commandResult = await runOpenMasOsServiceCommand({
    argv: [
      '--watch',
      '--project-root',
      projectRootPath,
      '--service-id',
      'openmas_os_service_sigint_active_tick_test',
    ],
    cwd: process.cwd(),
    stdout: createCaptureStream(),
    signalTarget,
    now: () => NOW,
    runtimeLoopOptions: {
      sleep: async () => {
        throw new Error('Shutdown during tick should stop before sleeping.');
      },
      tickRunner: async () => {
        tickTimeline.push('tick_started');
        signalTarget.emit('SIGINT');
        tickTimeline.push('signal_emitted');
        await Promise.resolve();
        tickTimeline.push('tick_finished');

        return createTickResult({
          tickId: 'os_service_tick_sigint_active_001',
          status: 'completed',
        });
      },
    },
  });
  const state = await readServiceState({ projectRootPath });

  assert.deepEqual(tickTimeline, [
    'tick_started',
    'signal_emitted',
    'tick_finished',
  ]);
  assert.equal(commandResult.result.status, 'stopped');
  assert.equal(commandResult.result.stopReason, 'signal_sigint');
  assert.equal(commandResult.result.stats.tickCount, 1);
  assert.equal(commandResult.result.lastTick.tickId, 'os_service_tick_sigint_active_001');
  assert.equal(state.status, 'stopped');
  assert.equal(state.lastTick.status, 'completed');
  assert.equal(state.stopReason, 'signal_sigint');
  assert.equal(await readKernelLock({ projectRootPath }), null);

  const nextCommandResult = await runOpenMasOsServiceCommand({
    argv: [
      '--watch',
      '--project-root',
      projectRootPath,
      '--service-id',
      'openmas_os_service_after_sigint_test',
    ],
    cwd: process.cwd(),
    stdout: createCaptureStream(),
    signalTarget: new EventEmitter(),
    now: () => NOW,
    runtimeLoopOptions: {
      maxTicks: 1,
      sleep: async () => {},
      tickRunner: async () => createTickResult({
        tickId: 'os_service_tick_after_sigint_001',
        status: 'idle',
      }),
    },
  });

  assert.equal(nextCommandResult.lockClaim.status, 'claimed');
  assert.equal(nextCommandResult.result.status, 'stopped');
});

test('runOpenMasOsServiceCommand drains asynchronous workers before releasing the watch kernel lock', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const timeline = [];
  let lockPresentDuringDrain = false;
  const asyncDispatchExecutor = {
    submit() {
      throw new Error('This lifecycle test does not submit execution work.');
    },
    takeSettledResults() {
      return [];
    },
    isJobActive() {
      return false;
    },
    snapshot() {
      return {
        kind: 'openmas_os_async_dispatch_executor_snapshot',
        version: 1,
        accepting: timeline.length === 0,
        maxConcurrentExecutions: 1,
        activeCount: 0,
        activeJobIds: [],
        settledCount: 0,
      };
    },
    stopAccepting() {
      timeline.push('stop_accepting');
    },
    async waitForIdle() {
      timeline.push('drain_started');
      lockPresentDuringDrain = await readKernelLock({ projectRootPath }) !== null;
      timeline.push('drain_completed');
    },
  };

  const commandResult = await runOpenMasOsServiceCommand({
    argv: [
      '--watch',
      '--project-root',
      projectRootPath,
      '--service-id',
      'openmas_os_service_async_drain_test',
    ],
    cwd: process.cwd(),
    stdout: createCaptureStream(),
    now: () => NOW,
    runtimeLoopOptions: {
      asyncDispatchExecutor,
      maxTicks: 1,
      sleep: async () => {},
      tickRunner: async () => createTickResult({
        tickId: 'os_service_tick_async_drain_001',
        status: 'idle',
      }),
    },
  });

  assert.deepEqual(timeline, [
    'stop_accepting',
    'drain_started',
    'drain_completed',
  ]);
  assert.equal(lockPresentDuringDrain, true);
  assert.equal(commandResult.result.status, 'stopped');
  assert.equal(await readKernelLock({ projectRootPath }), null);
});

test('runOpenMasOsServiceCommand renews its lock and reports stopping while asynchronous workers drain', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  let activeCount = 1;
  let completeDrain;
  let markDrainStarted;
  let nowCount = 0;
  const observations = [];
  const drainStarted = new Promise((resolve) => {
    markDrainStarted = resolve;
  });
  const now = () => new Date(Date.parse(NOW) + (nowCount++ * 1000)).toISOString();
  const asyncDispatchExecutor = {
    submit() {
      throw new Error('This lifecycle test does not submit execution work.');
    },
    takeSettledResults() {
      return [];
    },
    isJobActive() {
      return false;
    },
    snapshot() {
      return {
        kind: 'openmas_os_async_dispatch_executor_snapshot',
        version: 1,
        accepting: false,
        maxConcurrentExecutions: 2,
        activeCount,
        activeJobIds: activeCount > 0 ? ['job_shutdown_drain_active'] : [],
        settledCount: 0,
      };
    },
    stopAccepting() {},
    async waitForIdle() {
      if (activeCount === 0) {
        return this.snapshot();
      }

      markDrainStarted();
      await new Promise((resolve) => {
        completeDrain = () => {
          activeCount = 0;
          resolve();
        };
      });

      return this.snapshot();
    },
  };

  const commandTask = runOpenMasOsServiceCommand({
    argv: [
      '--watch',
      '--project-root',
      projectRootPath,
      '--interval',
      '10',
      '--service-id',
      'openmas_os_service_quiescing_drain_test',
    ],
    cwd: process.cwd(),
    stdout: createCaptureStream(),
    now,
    runtimeLoopOptions: {
      asyncDispatchExecutor,
      maxTicks: 1,
      sleep: async () => {},
      tickRunner: async () => createTickResult({
        tickId: 'os_service_tick_quiescing_drain_001',
        status: 'idle',
      }),
    },
  });
  await drainStarted;
  await new Promise((resolve) => {
    setTimeout(resolve, 35);
  });
  observations.push({
    state: await readServiceState({ projectRootPath }),
    lock: await readKernelLock({ projectRootPath }),
  });
  completeDrain();
  const commandResult = await commandTask;
  const state = await readServiceState({ projectRootPath });
  const events = await createLocalRuntimeAdapter({ projectRootPath }).readEvents({
    date: '2026-05-17',
  });
  const eventTypes = events.map((event) => event.eventType);

  assert.ok(observations.every((observation) => observation.state.status === 'stopping'));
  assert.ok(observations.every((observation) => observation.state.lastTick.asyncActiveExecutionCount === 1));
  assert.ok(observations.every((observation) => observation.lock !== null));
  assert.ok(eventTypes.filter((eventType) => eventType === 'os.service.lock.refreshed').length >= 3);
  assert.equal(eventTypes.at(-1), 'os.service.lock.released');
  assert.equal(commandResult.result.status, 'stopped');
  assert.equal(commandResult.result.lastTick.asyncActiveExecutionCount, 0);
  assert.equal(state.status, 'stopped');
  assert.equal(state.lastTick.asyncActiveExecutionCount, 0);
  assert.ok(Date.parse(state.stoppedAt) > Date.parse(observations.at(-1).state.updatedAt));
  assert.equal(await readKernelLock({ projectRootPath }), null);
});
