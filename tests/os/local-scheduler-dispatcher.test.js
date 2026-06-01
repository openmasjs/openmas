import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { createLocalRuntimeAdapter } from '../../src/os/adapters/local-runtime-adapter.js';
import {
  createLocalDispatcher,
  runSchedulerTick,
  selectNextReadyThread,
  synchronizeReadyThreadQueue,
} from '../../src/os/scheduler/local-scheduler-dispatcher.js';
import { OPENMAS_OS_KINDS } from '../../src/contracts/os/openmas-os-runtime-contract.js';
import { buildFakeOpenRouterSecretProbe } from '../helpers/fake-secret-probes.js';

const CREATED_AT = '2026-05-14T09:00:00-05:00';
const STARTED_AT = '2026-05-14T10:00:00-05:00';
const FINISHED_AT = '2026-05-14T10:01:00-05:00';
const SECOND_STARTED_AT = '2026-05-14T10:02:00-05:00';
const SECOND_FINISHED_AT = '2026-05-14T10:03:00-05:00';

async function createTemporaryProjectRoot() {
  return mkdtemp(path.join(os.tmpdir(), 'openmas-local-scheduler-'));
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

function createDeferred() {
  let resolve;
  let reject;

  const promise = new Promise((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return {
    promise,
    resolve,
    reject,
  };
}

function createProcessForThread(thread, overrides = {}) {
  return {
    kind: OPENMAS_OS_KINDS.process,
    schemaVersion: 1,
    processId: thread.processId,
    jobId: thread.jobId,
    status: 'ready',
    operationalIdentityId: 'alfred',
    activeCognitiveIdentityId: 'system-steward',
    currentThreadId: thread.threadId,
    parentProcessId: null,
    childProcessIds: [],
    conversationId: null,
    memoryContextRefs: [],
    artifactRefs: [],
    credentialReferenceIds: [],
    pendingApprovalRefs: [],
    warnings: [],
    createdAt: thread.createdAt,
    startedAt: null,
    updatedAt: thread.updatedAt,
    completedAt: null,
    ...overrides,
  };
}

function createThread(overrides = {}) {
  const threadId = overrides.threadId ?? 'thread_alpha';

  return {
    kind: OPENMAS_OS_KINDS.thread,
    schemaVersion: 1,
    threadId,
    processId: overrides.processId ?? `process_${threadId}`,
    jobId: overrides.jobId ?? `job_${threadId}`,
    status: 'ready',
    threadType: 'agent_invocation',
    priority: 50,
    attempt: 1,
    waitReason: null,
    dueAt: null,
    createdAt: CREATED_AT,
    startedAt: null,
    updatedAt: CREATED_AT,
    completedAt: null,
    ...overrides,
  };
}

async function persistReadyThread(adapter, overrides = {}) {
  const thread = createThread(overrides);

  await adapter.persistProcess(createProcessForThread(thread));
  return adapter.persistThread(thread);
}

test('Local scheduler selects ready Threads in deterministic priority order', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const adapter = createLocalRuntimeAdapter({ projectRootPath });

  await persistReadyThread(adapter, {
    threadId: 'thread_low_priority',
    priority: 10,
    dueAt: '2026-05-14T08:00:00-05:00',
    createdAt: '2026-05-14T08:00:00-05:00',
    updatedAt: '2026-05-14T08:00:00-05:00',
  });
  await persistReadyThread(adapter, {
    threadId: 'thread_high_late_due',
    priority: 90,
    dueAt: '2026-05-14T12:00:00-05:00',
    createdAt: '2026-05-14T08:00:00-05:00',
    updatedAt: '2026-05-14T08:00:00-05:00',
  });
  await persistReadyThread(adapter, {
    threadId: 'thread_high_early_due',
    priority: 90,
    dueAt: '2026-05-14T11:00:00-05:00',
    createdAt: '2026-05-14T08:30:00-05:00',
    updatedAt: '2026-05-14T08:30:00-05:00',
  });

  const queue = await synchronizeReadyThreadQueue({ adapter });

  assert.deepEqual(
    queue.toArray().map((threadRef) => threadRef.threadId),
    [
      'thread_high_early_due',
      'thread_high_late_due',
      'thread_low_priority',
    ],
  );

  const selectedThread = await selectNextReadyThread({ adapter });

  assert.equal(selectedThread.threadId, 'thread_high_early_due');
});

test('LocalDispatcher marks a Thread running before execution and completed after execution', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const adapter = createLocalRuntimeAdapter({ projectRootPath });
  const thread = await persistReadyThread(adapter, {
    threadId: 'thread_complete_me',
  });
  const dispatcher = createLocalDispatcher({
    adapter,
    now: createClock([STARTED_AT, FINISHED_AT]),
  });

  const result = await dispatcher.dispatch(thread, async ({ thread: runningThread }) => {
    assert.equal(runningThread.status, 'running');

    const persistedRunningThread = await adapter.loadThread(runningThread.threadId);

    assert.equal(persistedRunningThread.status, 'running');

    return {
      status: 'completed',
      payload: {
        resultId: 'result_001',
      },
    };
  });

  assert.equal(result.dispatched, true);
  assert.equal(result.status, 'completed');
  assert.equal(result.thread.startedAt, STARTED_AT);
  assert.equal(result.thread.completedAt, FINISHED_AT);
  assert.deepEqual(await adapter.loadThread(thread.threadId), result.thread);

  const events = await adapter.readEvents({ date: '2026-05-14' });

  assert.deepEqual(
    events.map((event) => event.eventType),
    [
      'thread.started',
      'thread.completed',
    ],
  );
});

test('LocalDispatcher can block a Thread with an explicit wait reason', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const adapter = createLocalRuntimeAdapter({ projectRootPath });
  const thread = await persistReadyThread(adapter, {
    threadId: 'thread_needs_approval',
  });
  const dispatcher = createLocalDispatcher({
    adapter,
    now: createClock([STARTED_AT, FINISHED_AT]),
  });

  const result = await dispatcher.dispatch(thread, async () => {
    return {
      status: 'blocked',
      waitReason: 'approval_required',
      payload: {
        approvalRef: 'approval_001',
      },
    };
  });

  assert.equal(result.status, 'blocked');
  assert.equal(result.thread.waitReason, 'approval_required');
  assert.equal(result.thread.completedAt, null);

  const events = await adapter.readEvents({ date: '2026-05-14' });

  assert.deepEqual(
    events.map((event) => event.eventType),
    [
      'thread.started',
      'thread.blocked',
    ],
  );
});

test('LocalDispatcher persists safe failure evidence when execution throws', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const adapter = createLocalRuntimeAdapter({ projectRootPath });
  const thread = await persistReadyThread(adapter, {
    threadId: 'thread_secret_failure',
  });
  const dispatcher = createLocalDispatcher({
    adapter,
    now: createClock([STARTED_AT, FINISHED_AT]),
  });

  const result = await dispatcher.dispatch(thread, async () => {
    throw new Error(`Provider rejected key ${buildFakeOpenRouterSecretProbe('secretvalue123456789')}.`);
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.thread.waitReason, null);
  assert.equal(result.thread.completedAt, FINISHED_AT);
  assert.equal(result.thread.failedAt, FINISHED_AT);
  assert.equal(result.thread.failureSummary.reasonCode, 'dispatch_failed');
  assert.match(result.thread.failureSummary.message, /\[redacted-secret\]/u);

  const serializedEvents = JSON.stringify(await adapter.readEvents({ date: '2026-05-14' }));

  assert.doesNotMatch(serializedEvents, new RegExp(buildFakeOpenRouterSecretProbe('secretvalue'), 'u'));
  assert.match(serializedEvents, /\[redacted-secret\]/u);
  assert.match(serializedEvents, /"failedAt":"2026-05-14T10:01:00-05:00"/u);
  assert.match(serializedEvents, /"reasonCode":"dispatch_failed"/u);
});

test('LocalDispatcher does not exceed configured local execution capacity', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const adapter = createLocalRuntimeAdapter({ projectRootPath });
  const firstThread = await persistReadyThread(adapter, {
    threadId: 'thread_capacity_first',
  });
  const secondThread = await persistReadyThread(adapter, {
    threadId: 'thread_capacity_second',
  });
  const dispatcher = createLocalDispatcher({
    adapter,
    capacity: 1,
    now: createClock([STARTED_AT, FINISHED_AT]),
  });
  const deferred = createDeferred();
  let secondThreadRan = false;

  const firstDispatch = dispatcher.dispatch(firstThread, async () => {
    await deferred.promise;

    return {
      status: 'completed',
    };
  });

  assert.equal(dispatcher.activeCount, 1);

  const secondDispatch = await dispatcher.dispatch(secondThread, async () => {
    secondThreadRan = true;

    return {
      status: 'completed',
    };
  });

  assert.equal(secondDispatch.dispatched, false);
  assert.equal(secondDispatch.status, 'capacity_exhausted');
  assert.equal(secondThreadRan, false);

  deferred.resolve();

  const firstResult = await firstDispatch;

  assert.equal(firstResult.status, 'completed');
  assert.equal(dispatcher.activeCount, 0);
});

test('runSchedulerTick dispatches one ready Thread per tick and stays idle without busy looping', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const adapter = createLocalRuntimeAdapter({ projectRootPath });
  const executedThreadIds = [];

  await persistReadyThread(adapter, {
    threadId: 'thread_tick_low_priority',
    priority: 20,
  });
  await persistReadyThread(adapter, {
    threadId: 'thread_tick_high_priority',
    priority: 80,
  });

  const firstTick = await runSchedulerTick({
    adapter,
    now: createClock([STARTED_AT, FINISHED_AT]),
    executor: async ({ thread }) => {
      executedThreadIds.push(thread.threadId);

      return {
        status: 'completed',
      };
    },
  });

  assert.equal(firstTick.dispatched, true);
  assert.equal(firstTick.status, 'completed');
  assert.equal(firstTick.selectedThreadRef.threadId, 'thread_tick_high_priority');
  assert.equal(firstTick.queueSize, 1);
  assert.deepEqual(executedThreadIds, ['thread_tick_high_priority']);

  const secondTick = await runSchedulerTick({
    adapter,
    now: createClock([SECOND_STARTED_AT, SECOND_FINISHED_AT]),
    executor: async ({ thread }) => {
      executedThreadIds.push(thread.threadId);

      return {
        status: 'completed',
      };
    },
  });

  assert.equal(secondTick.dispatched, true);
  assert.equal(secondTick.status, 'completed');
  assert.equal(secondTick.selectedThreadRef.threadId, 'thread_tick_low_priority');
  assert.deepEqual(executedThreadIds, [
    'thread_tick_high_priority',
    'thread_tick_low_priority',
  ]);

  const idleTick = await runSchedulerTick({
    adapter,
    executor: async ({ thread }) => {
      executedThreadIds.push(thread.threadId);

      return {
        status: 'completed',
      };
    },
  });

  assert.equal(idleTick.dispatched, false);
  assert.equal(idleTick.status, 'idle');
  assert.equal(idleTick.reason, 'no_ready_threads');
  assert.deepEqual(executedThreadIds, [
    'thread_tick_high_priority',
    'thread_tick_low_priority',
  ]);
});
