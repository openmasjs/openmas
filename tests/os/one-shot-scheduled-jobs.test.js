import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile } from 'node:fs/promises';
import { createLocalRuntimeAdapter } from '../../src/os/adapters/local-runtime-adapter.js';
import {
  cancelScheduledJob,
  createLocalOneShotScheduler,
  releaseDueOneShotJobs,
  resolveOneShotTimerId,
  runDueOneShotJobsNow,
  scheduleOneShotJob,
} from '../../src/os/scheduler/one-shot-scheduled-jobs.js';
import { OPENMAS_OS_KINDS } from '../../src/contracts/openmas-os-runtime-contract.js';

const CREATED_AT = '2026-05-14T10:00:00-05:00';
const RUN_AT = '2026-05-14T10:05:00-05:00';
const EARLY_AT = '2026-05-14T10:04:00-05:00';
const DUE_AT = '2026-05-14T10:05:00-05:00';
const STARTED_AT = '2026-05-14T10:05:01-05:00';
const FINISHED_AT = '2026-05-14T10:05:02-05:00';
const CANCELLED_AT = '2026-05-14T10:02:00-05:00';

async function createTemporaryProjectRoot() {
  return mkdtemp(path.join(os.tmpdir(), 'openmas-one-shot-scheduled-'));
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

function createScheduledJob(overrides = {}) {
  return {
    kind: OPENMAS_OS_KINDS.job,
    schemaVersion: 1,
    jobId: 'job_alfred_scheduled_report',
    projectId: 'project_marketing',
    status: 'draft',
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
      text: 'Prepare the scheduled report.',
    },
    conversationId: 'alfred-admin',
    trigger: {
      type: 'scheduled_once',
      runAt: RUN_AT,
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

async function persistScheduledJob(adapter, overrides = {}) {
  return adapter.persistJob(createScheduledJob(overrides));
}

async function markTimerAsScheduledDelegation(adapter, overrides = {}) {
  const timer = await adapter.loadTimer('timer_job_alfred_scheduled_report');

  return adapter.persistTimer({
    ...timer,
    payload: {
      ...timer.payload,
      actionType: 'schedule_delegation',
      parentProcessId: 'process_parent_alfred',
      parentThreadId: 'thread_parent_alfred',
      sourceSystemCallId: 'syscall_schedule_alfred_report_001',
      missedRunPolicy: 'delay',
      deliveryMode: 'persist_only',
      ...overrides,
    },
  });
}

test('scheduleOneShotJob persists scheduled Job and timer metadata without copying Job input', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const adapter = createLocalRuntimeAdapter({ projectRootPath });

  await persistScheduledJob(adapter);

  const result = await scheduleOneShotJob({
    adapter,
    jobId: 'job_alfred_scheduled_report',
    now: () => CREATED_AT,
  });

  assert.equal(result.job.status, 'scheduled');
  assert.equal(result.timer.status, 'scheduled');
  assert.equal(result.timer.timerId, 'timer_job_alfred_scheduled_report');
  assert.equal(result.timer.runAt, RUN_AT);
  assert.deepEqual(result.timer.payload, {
    triggerType: 'scheduled_once',
    source: 'job.trigger.runAt',
  });

  const persistedJob = await adapter.loadJob(result.job.jobId);
  const persistedTimer = await adapter.loadTimer(result.timer.timerId);

  assert.equal(persistedJob.status, 'scheduled');
  assert.deepEqual(persistedTimer, result.timer);

  const serializedTimer = await readFile(adapter.resolveTimerSnapshotPath(result.timer.timerId), 'utf8');

  assert.doesNotMatch(serializedTimer, /Prepare the scheduled report/u);
  assert.doesNotMatch(serializedTimer, /inputRef/u);

  const events = await adapter.readEvents({ date: '2026-05-14' });

  assert.deepEqual(
    events.map((event) => event.eventType),
    [
      'job.scheduled',
      'timer.scheduled',
    ],
  );
});

test('releaseDueOneShotJobs keeps future timers pending and releases due timers into ready Jobs', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const adapter = createLocalRuntimeAdapter({ projectRootPath });

  await persistScheduledJob(adapter);
  await scheduleOneShotJob({
    adapter,
    jobId: 'job_alfred_scheduled_report',
    now: () => CREATED_AT,
  });

  const earlyRelease = await releaseDueOneShotJobs({
    adapter,
    now: () => EARLY_AT,
  });

  assert.equal(earlyRelease.released.length, 0);
  assert.equal(earlyRelease.pending.length, 1);
  assert.equal((await adapter.loadJob('job_alfred_scheduled_report')).status, 'scheduled');
  assert.equal((await adapter.loadTimer('timer_job_alfred_scheduled_report')).status, 'scheduled');

  const dueRelease = await releaseDueOneShotJobs({
    adapter,
    now: () => DUE_AT,
  });

  assert.equal(dueRelease.released.length, 1);
  assert.equal(dueRelease.released[0].job.status, 'ready');
  assert.equal(dueRelease.released[0].timer.status, 'fired');
  assert.equal((await adapter.loadJob('job_alfred_scheduled_report')).status, 'ready');
  assert.equal((await adapter.loadTimer('timer_job_alfred_scheduled_report')).status, 'fired');

  const events = await adapter.readEvents({ date: '2026-05-14' });

  assert.deepEqual(
    events.map((event) => event.eventType),
    [
      'job.scheduled',
      'timer.scheduled',
      'timer.fired',
      'job.due',
    ],
  );
});

test('releaseDueOneShotJobs persists scheduled delegation release evidence without claiming child completion', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const adapter = createLocalRuntimeAdapter({ projectRootPath });

  await persistScheduledJob(adapter);
  await scheduleOneShotJob({
    adapter,
    jobId: 'job_alfred_scheduled_report',
    now: () => CREATED_AT,
  });
  await markTimerAsScheduledDelegation(adapter);

  const dueRelease = await releaseDueOneShotJobs({
    adapter,
    now: () => DUE_AT,
  });
  const firedTimer = await adapter.loadTimer('timer_job_alfred_scheduled_report');
  const releaseResult = await adapter.loadResultRecord(
    'result_scheduled_release_timer_job_alfred_scheduled_report',
  );

  assert.equal(dueRelease.released.length, 1);
  assert.equal(dueRelease.released[0].releaseResultRecord.resultId, releaseResult.resultId);
  assert.equal(firedTimer.status, 'fired');
  assert.equal(firedTimer.payload.releaseResultRef, releaseResult.resultId);
  assert.equal(releaseResult.resultKind, 'scheduled_release_result');
  assert.equal(releaseResult.status, 'released');
  assert.equal(releaseResult.phase, 'release');
  assert.equal(releaseResult.lineage.jobId, 'job_alfred_scheduled_report');
  assert.equal(releaseResult.lineage.timerId, 'timer_job_alfred_scheduled_report');
  assert.equal(releaseResult.lineage.systemCallId, 'syscall_schedule_alfred_report_001');
  assert.equal(releaseResult.metadata.schedule.missedRunOutcome, 'released_on_time');
  assert.equal(releaseResult.metadata.delivery.mode, 'persist_only');
  assert.equal(releaseResult.metadata.delivery.childCompletionProven, false);
  assert.doesNotMatch(releaseResult.summary, /completed child|child completed/iu);
});

test('releaseDueOneShotJobs repairs a fired scheduled delegation Timer missing its release Result link', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const adapter = createLocalRuntimeAdapter({ projectRootPath });

  await persistScheduledJob(adapter);
  await scheduleOneShotJob({
    adapter,
    jobId: 'job_alfred_scheduled_report',
    now: () => CREATED_AT,
  });
  const timer = await markTimerAsScheduledDelegation(adapter);
  const scheduledJob = await adapter.loadJob('job_alfred_scheduled_report');

  await adapter.persistTimer({
    ...timer,
    status: 'fired',
    updatedAt: DUE_AT,
  });
  await adapter.persistJob({
    ...scheduledJob,
    status: 'ready',
    updatedAt: DUE_AT,
  });

  const recoveryScan = await releaseDueOneShotJobs({
    adapter,
    now: () => FINISHED_AT,
  });
  const repairedTimer = await adapter.loadTimer('timer_job_alfred_scheduled_report');
  const releaseResult = await adapter.loadResultRecord(
    'result_scheduled_release_timer_job_alfred_scheduled_report',
  );

  assert.equal(recoveryScan.released.length, 0);
  assert.equal(recoveryScan.recoveredReleaseResults.length, 1);
  assert.equal(repairedTimer.payload.releaseResultRef, releaseResult.resultId);
  assert.equal(releaseResult.metadata.schedule.recoveryStatus, 'recovered_unlinked_release_result');
  assert.equal(releaseResult.metadata.schedule.jobStatusAtMaterialization, 'ready');
});

test('runDueOneShotJobsNow releases due Jobs and executes them through the existing invocation path', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const adapter = createLocalRuntimeAdapter({ projectRootPath });
  let invocationRequest = null;

  await persistScheduledJob(adapter);
  await scheduleOneShotJob({
    adapter,
    jobId: 'job_alfred_scheduled_report',
    now: () => CREATED_AT,
  });

  const result = await runDueOneShotJobsNow({
    adapter,
    projectRootPath,
    now: createClock([DUE_AT, STARTED_AT, FINISHED_AT]),
    invocationRunner: async (request) => {
      invocationRequest = request;

      return {
        invocationId: 'invocation_scheduled_001',
        status: 'completed',
        message: 'Scheduled report completed.',
        warnings: [],
        errors: [],
        persistence: null,
      };
    },
  });

  assert.equal(result.releaseResult.released.length, 1);
  assert.equal(result.executions.length, 1);
  assert.equal(result.executions[0].job.status, 'completed');
  assert.equal(result.executions[0].process.status, 'completed');
  assert.equal(result.executions[0].thread.status, 'completed');

  assert.equal(invocationRequest.projectRootPath, projectRootPath);
  assert.equal(invocationRequest.operationalIdentityId, 'alfred');
  assert.equal(Object.hasOwn(invocationRequest, 'agentId'), false);
  assert.equal(invocationRequest.command, 'ask');
  assert.equal(invocationRequest.inputText, 'Prepare the scheduled report.');
  assert.equal(invocationRequest.conversationRef, 'alfred-admin');

  const processes = await adapter.listProcesses();
  const threads = await adapter.listThreads();

  assert.equal(processes.length, 1);
  assert.equal(threads.length, 1);
  assert.equal(processes[0].completedAt, FINISHED_AT);
  assert.equal(threads[0].completedAt, FINISHED_AT);

  const eventTypes = (await adapter.readEvents({ date: '2026-05-14' }))
    .map((event) => event.eventType);

  assert.ok(eventTypes.includes('job.due'));
  assert.ok(eventTypes.includes('process.created'));
  assert.ok(eventTypes.includes('thread.completed'));
  assert.ok(eventTypes.includes('job.completed'));
});

test('cancelScheduledJob cancels the Job and timer before the one-shot timer fires', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const adapter = createLocalRuntimeAdapter({ projectRootPath });

  await persistScheduledJob(adapter);
  await scheduleOneShotJob({
    adapter,
    jobId: 'job_alfred_scheduled_report',
    now: () => CREATED_AT,
  });

  const result = await cancelScheduledJob({
    adapter,
    jobId: 'job_alfred_scheduled_report',
    now: () => CANCELLED_AT,
  });

  assert.equal(result.job.status, 'cancelled');
  assert.equal(result.timer.status, 'cancelled');

  const dueRelease = await releaseDueOneShotJobs({
    adapter,
    now: () => DUE_AT,
  });

  assert.equal(dueRelease.released.length, 0);
  assert.deepEqual(dueRelease.results, []);

  const events = await adapter.readEvents({ date: '2026-05-14' });

  assert.deepEqual(
    events.map((event) => event.eventType),
    [
      'job.scheduled',
      'timer.scheduled',
      'timer.cancelled',
      'job.cancelled',
    ],
  );
});

test('LocalOneShotScheduler arms local setTimeout handles and clears them on cancellation', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const adapter = createLocalRuntimeAdapter({ projectRootPath });
  const timeoutCalls = [];
  const clearedHandles = [];

  await persistScheduledJob(adapter);

  const scheduler = createLocalOneShotScheduler({
    adapter,
    now: () => CREATED_AT,
    setTimeoutFn: (callback, delayMs) => {
      const handle = {
        handleId: `handle_${timeoutCalls.length + 1}`,
        callback,
      };

      timeoutCalls.push({
        delayMs,
        handle,
      });

      return handle;
    },
    clearTimeoutFn: (handle) => {
      clearedHandles.push(handle.handleId);
    },
  });

  const scheduled = await scheduler.scheduleJob('job_alfred_scheduled_report');

  assert.equal(scheduled.armedTimer.timerId, resolveOneShotTimerId('job_alfred_scheduled_report'));
  assert.equal(scheduled.armedTimer.delayMs, 300000);
  assert.equal(timeoutCalls.length, 1);

  await scheduler.cancelJob('job_alfred_scheduled_report');

  assert.deepEqual(clearedHandles, ['handle_1']);
  assert.equal((await adapter.loadJob('job_alfred_scheduled_report')).status, 'cancelled');
  assert.equal((await adapter.loadTimer('timer_job_alfred_scheduled_report')).status, 'cancelled');
});

test('LocalOneShotScheduler restores pending timers from JSON without needing in-memory handles', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const adapter = createLocalRuntimeAdapter({ projectRootPath });
  const timeoutCalls = [];

  await persistScheduledJob(adapter);
  await scheduleOneShotJob({
    adapter,
    jobId: 'job_alfred_scheduled_report',
    now: () => CREATED_AT,
  });

  const scheduler = createLocalOneShotScheduler({
    adapter,
    now: () => CREATED_AT,
    setTimeoutFn: (callback, delayMs) => {
      const handle = {
        handleId: `handle_${timeoutCalls.length + 1}`,
        callback,
      };

      timeoutCalls.push({
        delayMs,
        handle,
      });

      return handle;
    },
  });

  const restoreResult = await scheduler.restoreTimers();

  assert.equal(restoreResult.restored, 1);
  assert.equal(restoreResult.armedTimers.length, 1);
  assert.equal(restoreResult.armedTimers[0].delayMs, 300000);
  assert.equal(timeoutCalls.length, 1);
  assert.equal((await adapter.loadJob('job_alfred_scheduled_report')).status, 'scheduled');
});

test('LocalOneShotScheduler handles past-due timers safely during startup restoration', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const adapter = createLocalRuntimeAdapter({ projectRootPath });
  const timeoutCalls = [];

  await persistScheduledJob(adapter);
  await scheduleOneShotJob({
    adapter,
    jobId: 'job_alfred_scheduled_report',
    now: () => CREATED_AT,
  });

  const scheduler = createLocalOneShotScheduler({
    adapter,
    now: () => DUE_AT,
    setTimeoutFn: (callback, delayMs) => {
      timeoutCalls.push({
        callback,
        delayMs,
      });

      return {
        handleId: 'unexpected_handle',
      };
    },
  });

  const restoreResult = await scheduler.restoreTimers();

  assert.equal(restoreResult.restored, 1);
  assert.equal(restoreResult.armedTimers.length, 0);
  assert.equal(restoreResult.dueTimers.length, 1);
  assert.equal(restoreResult.releaseResult.released.length, 1);
  assert.equal(timeoutCalls.length, 0);
  assert.equal((await adapter.loadJob('job_alfred_scheduled_report')).status, 'ready');
  assert.equal((await adapter.loadTimer('timer_job_alfred_scheduled_report')).status, 'fired');
});
