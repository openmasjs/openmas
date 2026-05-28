import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile } from 'node:fs/promises';
import { createLocalRuntimeAdapter } from '../../src/os/adapters/local-runtime-adapter.js';
import {
  createLocalRecurringScheduler,
  releaseDueRecurringJobs,
  resolveRecurringTimerId,
  runDueRecurringJobsNow,
  scheduleRecurringJob,
} from '../../src/os/scheduler/recurring-jobs.js';
import {
  applySignal,
  createOpenMasOsSignal,
} from '../../src/os/signals/signal-manager.js';
import { OPENMAS_OS_KINDS } from '../../src/contracts/openmas-os-runtime-contract.js';

const CREATED_AT = '2026-05-14T10:00:00-05:00';
const FIRST_RUN_AT = '2026-05-14T15:05:00.000Z';
const SECOND_RUN_AT = '2026-05-14T15:10:00.000Z';
const FIRST_STARTED_AT = '2026-05-14T10:05:01-05:00';
const FIRST_FINISHED_AT = '2026-05-14T10:05:02-05:00';
const SECOND_STARTED_AT = '2026-05-14T10:10:01-05:00';
const SECOND_FINISHED_AT = '2026-05-14T10:10:02-05:00';
const SIGNALED_AT = '2026-05-14T10:02:00-05:00';

async function createTemporaryProjectRoot() {
  return mkdtemp(path.join(os.tmpdir(), 'openmas-recurring-jobs-'));
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

function createRecurringJob(overrides = {}) {
  return {
    kind: OPENMAS_OS_KINDS.job,
    schemaVersion: 1,
    jobId: 'job_alfred_recurring_health',
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
      text: 'Check recurring health.',
    },
    conversationId: 'alfred-admin',
    trigger: {
      type: 'recurring',
      intervalMs: 300000,
    },
    priority: 50,
    policies: {
      requiresApproval: false,
      maxAttempts: 1,
      noOverlap: true,
      missedRunPolicy: 'skip',
    },
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ...overrides,
  };
}

function createProcess(overrides = {}) {
  return {
    kind: OPENMAS_OS_KINDS.process,
    schemaVersion: 1,
    processId: 'process_active_overlap',
    jobId: 'job_alfred_recurring_health',
    status: 'running',
    operationalIdentityId: 'alfred',
    activeCognitiveIdentityId: 'system-steward',
    currentThreadId: 'thread_active_overlap',
    parentProcessId: null,
    childProcessIds: [],
    conversationId: null,
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

async function persistRecurringJob(adapter, overrides = {}) {
  return adapter.persistJob(createRecurringJob(overrides));
}

function createSignal(overrides = {}) {
  return createOpenMasOsSignal({
    signalId: 'signal_recurring_test_001',
    signalType: 'pause',
    targetType: 'job',
    targetId: 'job_alfred_recurring_health',
    createdBy: {
      type: 'human',
      id: 'admin',
    },
    createdAt: SIGNALED_AT,
    reason: 'operator_request',
    payload: {},
    ...overrides,
  });
}

test('scheduleRecurringJob persists recurring timer metadata without copying Job input', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const adapter = createLocalRuntimeAdapter({ projectRootPath });

  await persistRecurringJob(adapter);

  const result = await scheduleRecurringJob({
    adapter,
    jobId: 'job_alfred_recurring_health',
    now: () => CREATED_AT,
  });

  assert.equal(result.job.status, 'scheduled');
  assert.equal(result.timer.status, 'scheduled');
  assert.equal(result.timer.timerId, resolveRecurringTimerId('job_alfred_recurring_health'));
  assert.equal(result.timer.runAt, FIRST_RUN_AT);
  assert.deepEqual(result.timer.payload, {
    triggerType: 'recurring',
    source: 'job.trigger.intervalMs',
    intervalMs: 300000,
    nextRunAt: FIRST_RUN_AT,
    lastRunAt: null,
    lastCompletedAt: null,
    runCount: 0,
    skippedRunCount: 0,
    consecutiveFailures: 0,
    maxConsecutiveFailures: 3,
    noOverlap: true,
    missedRunPolicy: 'skip',
    createdAt: CREATED_AT,
  });

  const serializedTimer = await readFile(adapter.resolveTimerSnapshotPath(result.timer.timerId), 'utf8');

  assert.doesNotMatch(serializedTimer, /Check recurring health/u);
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

test('runDueRecurringJobsNow creates one Process per due recurring run and reschedules the Job', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const adapter = createLocalRuntimeAdapter({ projectRootPath });
  const invocationRequests = [];

  await persistRecurringJob(adapter);
  await scheduleRecurringJob({
    adapter,
    jobId: 'job_alfred_recurring_health',
    now: () => CREATED_AT,
  });

  const firstRun = await runDueRecurringJobsNow({
    adapter,
    projectRootPath,
    now: createClock([FIRST_RUN_AT, FIRST_STARTED_AT, FIRST_FINISHED_AT]),
    invocationRunner: async (request) => {
      invocationRequests.push(request);

      return {
        invocationId: `invocation_recurring_${invocationRequests.length}`,
        status: 'completed',
        message: 'Recurring run completed.',
        primaryCognitiveIdentityId: 'system-steward',
        warnings: [],
        errors: [],
        persistence: null,
      };
    },
  });

  assert.equal(firstRun.releaseResult.released.length, 1);
  assert.equal(firstRun.executions.length, 1);
  assert.equal(firstRun.executions[0].job.status, 'scheduled');
  assert.equal(firstRun.executions[0].process.status, 'completed');
  assert.equal(firstRun.executions[0].process.activeCognitiveIdentityId, 'system-steward');
  assert.equal(firstRun.executions[0].thread.status, 'completed');
  assert.equal(firstRun.executions[0].timer.runAt, SECOND_RUN_AT);
  assert.equal(firstRun.executions[0].timer.payload.runCount, 1);
  assert.equal(firstRun.executions[0].timer.payload.consecutiveFailures, 0);

  assert.equal(invocationRequests[0].projectRootPath, projectRootPath);
  assert.equal(invocationRequests[0].operationalIdentityId, 'alfred');
  assert.equal(Object.hasOwn(invocationRequests[0], 'agentId'), false);
  assert.equal(invocationRequests[0].inputText, 'Check recurring health.');
  assert.equal(invocationRequests[0].conversationRef, 'alfred-admin');

  const secondRun = await runDueRecurringJobsNow({
    adapter,
    projectRootPath,
    now: createClock([SECOND_RUN_AT, SECOND_STARTED_AT, SECOND_FINISHED_AT]),
    invocationRunner: async (request) => {
      invocationRequests.push(request);

      return {
        invocationId: `invocation_recurring_${invocationRequests.length}`,
        status: 'completed',
        message: 'Recurring run completed.',
        warnings: [],
        errors: [],
        persistence: null,
      };
    },
  });

  assert.equal(secondRun.executions.length, 1);
  assert.equal((await adapter.listProcesses({ jobId: 'job_alfred_recurring_health' })).length, 2);
  assert.equal((await adapter.listThreads({ jobId: 'job_alfred_recurring_health' })).length, 2);
  assert.equal((await adapter.loadJob('job_alfred_recurring_health')).status, 'scheduled');
  assert.equal((await adapter.loadTimer('timer_job_alfred_recurring_health')).payload.runCount, 2);
});

test('releaseDueRecurringJobs skips a due run when noOverlap detects an active Process', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const adapter = createLocalRuntimeAdapter({ projectRootPath });

  await persistRecurringJob(adapter);
  await scheduleRecurringJob({
    adapter,
    jobId: 'job_alfred_recurring_health',
    now: () => CREATED_AT,
  });
  await adapter.persistProcess(createProcess());

  const result = await releaseDueRecurringJobs({
    adapter,
    now: () => FIRST_RUN_AT,
  });

  assert.equal(result.released.length, 0);
  assert.equal(result.skipped.length, 1);
  assert.equal(result.skipped[0].reason, 'active_process_overlap');

  const timer = await adapter.loadTimer('timer_job_alfred_recurring_health');

  assert.equal(timer.runAt, SECOND_RUN_AT);
  assert.equal(timer.payload.skippedRunCount, 1);
  assert.equal((await adapter.listProcesses({ jobId: 'job_alfred_recurring_health' })).length, 1);

  const events = await adapter.readEvents({ date: '2026-05-14' });

  assert.deepEqual(
    events.slice(-2).map((event) => event.eventType),
    [
      'job.run_skipped',
      'timer.rescheduled',
    ],
  );
});

test('recurring failure tracking pauses the Job after maxConsecutiveFailures', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const adapter = createLocalRuntimeAdapter({ projectRootPath });

  await persistRecurringJob(adapter);
  await scheduleRecurringJob({
    adapter,
    jobId: 'job_alfred_recurring_health',
    now: () => CREATED_AT,
    maxConsecutiveFailures: 2,
  });

  const firstFailure = await runDueRecurringJobsNow({
    adapter,
    projectRootPath,
    now: createClock([FIRST_RUN_AT, FIRST_STARTED_AT, FIRST_FINISHED_AT]),
    invocationRunner: async () => {
      return {
        invocationId: 'invocation_failure_1',
        status: 'failed',
        message: 'Provider failed.',
        warnings: [],
        errors: ['Provider failed.'],
        persistence: null,
      };
    },
  });

  assert.equal(firstFailure.executions[0].job.status, 'scheduled');
  assert.equal(firstFailure.executions[0].timer.payload.consecutiveFailures, 1);
  assert.equal(firstFailure.executions[0].timer.status, 'scheduled');

  const secondFailure = await runDueRecurringJobsNow({
    adapter,
    projectRootPath,
    now: createClock([SECOND_RUN_AT, SECOND_STARTED_AT, SECOND_FINISHED_AT]),
    invocationRunner: async () => {
      return {
        invocationId: 'invocation_failure_2',
        status: 'failed',
        message: 'Provider failed again.',
        warnings: [],
        errors: ['Provider failed again.'],
        persistence: null,
      };
    },
  });

  assert.equal(secondFailure.executions[0].job.status, 'paused');
  assert.equal(secondFailure.executions[0].timer.status, 'cancelled');
  assert.equal(secondFailure.executions[0].timer.payload.consecutiveFailures, 2);
  assert.equal(secondFailure.executions[0].pausedForFailures, true);
  assert.equal((await adapter.loadJob('job_alfred_recurring_health')).status, 'paused');
});

test('recurring Jobs can be paused and resumed through Signals without losing timer metadata', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const adapter = createLocalRuntimeAdapter({ projectRootPath });

  await persistRecurringJob(adapter);
  await scheduleRecurringJob({
    adapter,
    jobId: 'job_alfred_recurring_health',
    now: () => CREATED_AT,
  });

  const pauseResult = await applySignal({
    adapter,
    signal: createSignal(),
    now: () => SIGNALED_AT,
  });

  assert.equal(pauseResult.applied, true);
  assert.equal(pauseResult.job.status, 'paused');
  assert.equal((await adapter.loadTimer('timer_job_alfred_recurring_health')).status, 'scheduled');

  const pausedRelease = await releaseDueRecurringJobs({
    adapter,
    now: () => FIRST_RUN_AT,
  });

  assert.equal(pausedRelease.released.length, 0);
  assert.equal(pausedRelease.paused.length, 1);

  const resumeResult = await applySignal({
    adapter,
    signal: createSignal({
      signalId: 'signal_resume_recurring',
      signalType: 'resume',
    }),
    now: () => FIRST_RUN_AT,
  });

  assert.equal(resumeResult.applied, true);
  assert.equal(resumeResult.job.status, 'scheduled');
  assert.equal((await adapter.loadJob('job_alfred_recurring_health')).status, 'scheduled');
});

test('LocalRecurringScheduler restores recurring timers from JSON and arms due timers immediately', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const adapter = createLocalRuntimeAdapter({ projectRootPath });
  const timeoutCalls = [];

  await persistRecurringJob(adapter);
  await scheduleRecurringJob({
    adapter,
    jobId: 'job_alfred_recurring_health',
    now: () => CREATED_AT,
  });

  const futureScheduler = createLocalRecurringScheduler({
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

  const futureRestore = await futureScheduler.restoreTimers();

  assert.equal(futureRestore.restored, 1);
  assert.equal(futureRestore.armedTimers.length, 1);
  assert.equal(futureRestore.armedTimers[0].delayMs, 300000);

  const dueScheduler = createLocalRecurringScheduler({
    adapter,
    now: () => FIRST_RUN_AT,
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

  const dueRestore = await dueScheduler.restoreTimers();

  assert.equal(dueRestore.restored, 1);
  assert.equal(dueRestore.armedTimers.length, 1);
  assert.equal(dueRestore.armedTimers[0].delayMs, 0);
});
