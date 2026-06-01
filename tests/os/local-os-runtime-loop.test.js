import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFakeOpenRouterSecretProbe } from '../helpers/fake-secret-probes.js';
import {
  createLocalOpenMasOsRuntimeLoop,
  createOpenMasOsRuntimeLoopController,
  normalizeOpenMasOsRuntimeLoopConfig,
  runOpenMasOsRuntimeLoop,
} from '../../src/os/service/local-os-runtime-loop.js';

const NOW = '2026-05-17T10:00:00-05:00';

function createTickResult(overrides = {}) {
  return {
    kind: 'openmas_os_service_tick_result',
    version: 1,
    tickId: 'os_service_tick_test_001',
    status: 'idle',
    startedAt: NOW,
    finishedAt: NOW,
    systemCalls: {
      status: 'completed',
      processedAt: NOW,
      processedCount: 0,
      completedCount: 0,
      deniedCount: 0,
      failedCount: 0,
      expiredCount: 0,
      cancelledCount: 0,
      results: [],
    },
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

test('normalizeOpenMasOsRuntimeLoopConfig exposes safe Milestone 3 defaults and rejects invalid timing values', () => {
  assert.deepEqual(normalizeOpenMasOsRuntimeLoopConfig(), {
    tickIntervalMs: 5000,
    heartbeatIntervalMs: 5000,
    maxDispatchedJobsPerTick: 25,
    maxSystemCallsPerTick: 25,
    staleAfterMs: 30000,
    maxTicks: null,
    continueOnTickError: true,
  });
  assert.deepEqual(normalizeOpenMasOsRuntimeLoopConfig({
    tickIntervalMs: 250,
    heartbeatIntervalMs: 1000,
    maxDispatchedJobsPerTick: 3,
    maxSystemCallsPerTick: 4,
    staleAfterMs: 5000,
    maxTicks: 2,
    continueOnTickError: false,
  }), {
    tickIntervalMs: 250,
    heartbeatIntervalMs: 1000,
    maxDispatchedJobsPerTick: 3,
    maxSystemCallsPerTick: 4,
    staleAfterMs: 5000,
    maxTicks: 2,
    continueOnTickError: false,
  });

  assert.throws(
    () => normalizeOpenMasOsRuntimeLoopConfig({ tickIntervalMs: 0 }),
    /tickIntervalMs/u,
  );
  assert.throws(
    () => normalizeOpenMasOsRuntimeLoopConfig({ maxTicks: 0 }),
    /maxTicks/u,
  );
  assert.throws(
    () => normalizeOpenMasOsRuntimeLoopConfig({ maxSystemCallsPerTick: 0 }),
    /maxSystemCallsPerTick/u,
  );
  assert.throws(
    () => normalizeOpenMasOsRuntimeLoopConfig({ continueOnTickError: 'yes' }),
    /continueOnTickError/u,
  );
});

test('runOpenMasOsRuntimeLoop executes multiple deterministic ticks and sleeps only between ticks', async () => {
  const tickCalls = [];
  const sleepCalls = [];
  const lifecycleStatuses = [];
  const asyncDispatchExecutor = {
    id: 'async_dispatch_executor_test',
  };
  const tickResults = [
    createTickResult({
      tickId: 'os_service_tick_loop_001',
      status: 'idle',
    }),
    createTickResult({
      tickId: 'os_service_tick_loop_002',
      status: 'completed',
      release: {
        now: NOW,
        resultCount: 1,
        releasedCount: 1,
        pendingCount: 0,
      },
      readyWork: {
        candidateCount: 1,
        dispatchedCount: 1,
        deferredCount: 0,
      },
      dispatches: [
        {
          status: 'completed',
        },
      ],
    }),
  ];

  const result = await runOpenMasOsRuntimeLoop({
    serviceId: 'openmas_os_service_loop_test',
    projectRootPath: 'C:\\tmp\\openmas-loop-test',
    tickIntervalMs: 1234,
    maxDispatchedJobsPerTick: 7,
    asyncDispatchExecutor,
    maxTicks: 2,
    now: () => NOW,
    sleep: async (delayMs, snapshot) => {
      sleepCalls.push({
        delayMs,
        tickCount: snapshot.stats.tickCount,
      });
    },
    tickRunner: async (options) => {
      tickCalls.push(options);
      return tickResults[tickCalls.length - 1];
    },
    onLifecycleEvent: async (event) => {
      lifecycleStatuses.push(event.status);
    },
  });

  assert.equal(result.kind, 'openmas_os_runtime_loop_result');
  assert.equal(result.status, 'stopped');
  assert.equal(result.stopReason, 'max_ticks_reached');
  assert.equal(result.stats.tickCount, 2);
  assert.equal(result.stats.idleTickCount, 1);
  assert.equal(result.stats.completedTickCount, 1);
  assert.equal(result.stats.failedTickCount, 0);
  assert.equal(result.lastTick.tickId, 'os_service_tick_loop_002');
  assert.equal(result.lastTick.releasedCount, 1);
  assert.deepEqual(sleepCalls, [
    {
      delayMs: 1234,
      tickCount: 1,
    },
  ]);
  assert.equal(tickCalls.length, 2);
  assert.equal(tickCalls[0].projectRootPath, 'C:\\tmp\\openmas-loop-test');
  assert.equal(tickCalls[0].maxDispatchedJobs, 7);
  assert.equal(tickCalls[0].asyncDispatchExecutor, asyncDispatchExecutor);
  assert.equal(tickCalls[0].recoverTerminalResultPublications, true);
  assert.equal(tickCalls[1].recoverTerminalResultPublications, false);
  assert.equal(tickCalls[0].reconcileSchedulerQueues, true);
  assert.equal(tickCalls[1].reconcileSchedulerQueues, false);
  assert.deepEqual(lifecycleStatuses, [
    'starting',
    'running',
    'ticking',
    'idle',
    'ticking',
    'idle',
    'stopping',
    'stopped',
  ]);
});

test('runOpenMasOsRuntimeLoop forwards service identity and aggregates System Call tick stats', async () => {
  const tickCalls = [];
  const result = await runOpenMasOsRuntimeLoop({
    serviceId: 'openmas_os_service_syscall_stats_test',
    projectRootPath: 'C:\\tmp\\openmas-loop-syscall-test',
    maxSystemCallsPerTick: 3,
    maxTicks: 2,
    now: () => NOW,
    sleep: async () => {},
    tickRunner: async (options) => {
      tickCalls.push(options);

      return createTickResult({
        tickId: `os_service_tick_syscall_stats_00${tickCalls.length}`,
        status: tickCalls.length === 1 ? 'completed' : 'completed_with_failures',
        systemCalls: {
          status: 'completed',
          processedAt: NOW,
          processedCount: tickCalls.length === 1 ? 2 : 1,
          completedCount: tickCalls.length === 1 ? 1 : 0,
          deniedCount: tickCalls.length === 1 ? 1 : 0,
          failedCount: tickCalls.length === 1 ? 0 : 1,
          expiredCount: 0,
          cancelledCount: 0,
          results: [],
        },
      });
    },
  });

  assert.equal(tickCalls.length, 2);
  assert.equal(tickCalls[0].serviceId, 'openmas_os_service_syscall_stats_test');
  assert.equal(tickCalls[0].maxSystemCallsPerTick, 3);
  assert.equal(result.stats.systemCallProcessedCount, 3);
  assert.equal(result.stats.systemCallCompletedCount, 1);
  assert.equal(result.stats.systemCallDeniedCount, 1);
  assert.equal(result.stats.systemCallFailedCount, 1);
  assert.equal(result.lastTick.systemCallProcessedCount, 1);
  assert.equal(result.lastTick.systemCallFailedCount, 1);
});

test('runOpenMasOsRuntimeLoop can skip startup terminal Result reconciliation after a clean ownership transfer', async () => {
  const tickCalls = [];

  await runOpenMasOsRuntimeLoop({
    serviceId: 'openmas_os_service_clean_restart_test',
    maxTicks: 1,
    recoverTerminalResultPublicationsOnStart: false,
    now: () => NOW,
    sleep: async () => {},
    tickRunner: async (options) => {
      tickCalls.push(options);
      return createTickResult();
    },
  });

  assert.equal(tickCalls.length, 1);
  assert.equal(tickCalls[0].recoverTerminalResultPublications, false);
  assert.equal(tickCalls[0].reconcileSchedulerQueues, true);
});

test('runOpenMasOsRuntimeLoop lets an active tick finish after shutdown is requested', async () => {
  const controller = createOpenMasOsRuntimeLoopController();
  let tickCount = 0;
  let sleepCalled = false;

  const result = await runOpenMasOsRuntimeLoop({
    serviceId: 'openmas_os_service_shutdown_test',
    controller,
    now: () => NOW,
    sleep: async () => {
      sleepCalled = true;
    },
    tickRunner: async () => {
      tickCount += 1;
      controller.requestStop('ctrl_c');

      return createTickResult({
        tickId: 'os_service_tick_shutdown_001',
        status: 'completed',
      });
    },
  });

  assert.equal(result.status, 'stopped');
  assert.equal(result.stopReason, 'ctrl_c');
  assert.equal(result.stats.tickCount, 1);
  assert.equal(result.stats.completedTickCount, 1);
  assert.equal(result.lastTick.tickId, 'os_service_tick_shutdown_001');
  assert.equal(tickCount, 1);
  assert.equal(sleepCalled, false);
  assert.deepEqual(
    result.lifecycleEvents.map((event) => event.status),
    [
      'starting',
      'running',
      'ticking',
      'idle',
      'stopping',
      'stopped',
    ],
  );
});

test('runOpenMasOsRuntimeLoop records skipped ticks instead of overlapping slow ticks', async () => {
  const skippedTicks = [];
  let tickCount = 0;
  let activeTickCount = 0;
  let maxActiveTickCount = 0;

  const result = await runOpenMasOsRuntimeLoop({
    serviceId: 'openmas_os_service_backpressure_test',
    tickIntervalMs: 5,
    maxTicks: 2,
    now: () => NOW,
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
          tickId: `os_service_tick_backpressure_00${currentTick}`,
          status: currentTick === 1 ? 'completed' : 'idle',
        });
      } finally {
        activeTickCount -= 1;
      }
    },
    onTickSkipped: async (skippedTick, snapshot) => {
      skippedTicks.push({
        skippedTick,
        status: snapshot.status,
        activeTick: snapshot.activeTick,
        tickCount: snapshot.stats.tickCount,
        skippedTickCount: snapshot.stats.skippedTickCount,
      });
    },
  });

  assert.equal(maxActiveTickCount, 1);
  assert.equal(tickCount, 2);
  assert.equal(result.status, 'stopped');
  assert.equal(result.stopReason, 'max_ticks_reached');
  assert.equal(result.stats.tickCount, 2);
  assert.equal(result.stats.completedTickCount, 1);
  assert.equal(result.stats.idleTickCount, 1);
  assert.ok(result.stats.skippedTickCount >= 1);
  assert.equal(result.lastTick.tickId, 'os_service_tick_backpressure_002');
  assert.ok(skippedTicks.length >= 1);
  assert.equal(skippedTicks[0].skippedTick.kind, 'openmas_os_runtime_loop_skipped_tick_event');
  assert.equal(skippedTicks[0].skippedTick.activeTickIndex, 1);
  assert.equal(skippedTicks[0].skippedTick.activeTickStartedAt, NOW);
  assert.equal(skippedTicks[0].status, 'ticking');
  assert.deepEqual(skippedTicks[0].activeTick, {
    tickIndex: 1,
    startedAt: NOW,
  });
  assert.equal(skippedTicks[0].tickCount, 0);
  assert.equal(
    result.stats.skippedTickCount,
    skippedTicks.at(-1).skippedTick.skippedTickCount,
  );
});

test('runOpenMasOsRuntimeLoop records sanitized tick failures and can continue ticking', async () => {
  const rawSecret = buildFakeOpenRouterSecretProbe('runtimeLoopSecret123456789');
  let tickCount = 0;
  const tickCalls = [];

  const result = await runOpenMasOsRuntimeLoop({
    serviceId: 'openmas_os_service_failure_test',
    maxTicks: 2,
    now: () => NOW,
    sleep: async () => {},
    tickRunner: async (options) => {
      tickCalls.push(options);
      tickCount += 1;

      if (tickCount === 1) {
        throw new Error(`Provider rejected ${rawSecret}`);
      }

      return createTickResult({
        tickId: 'os_service_tick_after_failure_002',
        status: 'completed',
      });
    },
  });
  const serializedResult = JSON.stringify(result);

  assert.equal(result.status, 'stopped_with_failures');
  assert.equal(result.stopReason, 'max_ticks_reached');
  assert.equal(result.stats.tickCount, 2);
  assert.equal(result.stats.failedTickCount, 1);
  assert.equal(result.stats.completedTickCount, 1);
  assert.equal(result.lastError, null);
  assert.doesNotMatch(serializedResult, new RegExp(rawSecret, 'u'));
  assert.match(serializedResult, /\[redacted-secret\]/u);
  assert.ok(result.lifecycleEvents.some((event) => event.status === 'failed'));
  assert.equal(tickCalls[0].reconcileSchedulerQueues, true);
  assert.equal(tickCalls[1].reconcileSchedulerQueues, true);
});

test('runOpenMasOsRuntimeLoop can fail fast on tick orchestration errors', async () => {
  const result = await runOpenMasOsRuntimeLoop({
    serviceId: 'openmas_os_service_fail_fast_test',
    continueOnTickError: false,
    now: () => NOW,
    tickRunner: async () => {
      throw new Error('Injected tick failure.');
    },
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.stopReason, 'tick_failed');
  assert.equal(result.stats.tickCount, 1);
  assert.equal(result.stats.failedTickCount, 1);
  assert.deepEqual(result.lastError, {
    name: 'Error',
    message: 'Injected tick failure.',
  });
  assert.equal(result.lifecycleEvents.at(-1).status, 'failed');
});

test('LocalOpenMasOsRuntimeLoop exposes a small controller-backed service wrapper', async () => {
  const loop = createLocalOpenMasOsRuntimeLoop({
    serviceId: 'openmas_os_service_class_wrapper_test',
    now: () => NOW,
    tickRunner: async () => createTickResult({
      tickId: 'os_service_tick_class_wrapper_001',
      status: 'idle',
    }),
  });

  const result = await loop.run({
    onTickResult: async () => {
      loop.requestStop('wrapper_stop');
    },
  });

  assert.equal(result.status, 'stopped');
  assert.equal(result.stopReason, 'wrapper_stop');
  assert.equal(result.stats.tickCount, 1);
  assert.equal(result.lastTick.tickId, 'os_service_tick_class_wrapper_001');
});
