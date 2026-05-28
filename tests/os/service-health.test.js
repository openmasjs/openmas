import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {
  access,
  mkdtemp,
  readFile,
} from 'node:fs/promises';
import {
  buildServiceHealthSummary,
  buildServiceHeartbeat,
  buildServiceState,
  readServiceHeartbeat,
  readServiceState,
  resolveServiceHealthPaths,
  writeServiceHealthSnapshot,
  writeServiceHeartbeat,
  writeServiceState,
} from '../../src/os/service/service-health.js';

const NOW = '2026-05-17T13:00:00-05:00';
const LATER = '2026-05-17T13:00:10-05:00';

async function createTemporaryProjectRoot() {
  return mkdtemp(path.join(os.tmpdir(), 'openmas-service-health-'));
}

async function assertFileExists(filePath) {
  await access(filePath);
}

function createState(overrides = {}) {
  return buildServiceState({
    serviceId: 'openmas_os_service_health_test',
    status: 'running',
    projectRootPath: 'C:\\tmp\\openmas-service-health',
    startedAt: NOW,
    updatedAt: NOW,
    config: {
      tickIntervalMs: 1000,
      heartbeatIntervalMs: 1000,
      maxDispatchedJobsPerTick: 5,
      staleAfterMs: 30000,
    },
    stats: {
      tickCount: 3,
      idleTickCount: 1,
      completedTickCount: 1,
      completedWithFailuresTickCount: 0,
      failedTickCount: 1,
      skippedTickCount: 2,
    },
    lastTick: {
      tickId: 'os_service_tick_health_003',
      status: 'completed',
      startedAt: NOW,
      finishedAt: NOW,
      releasedCount: 1,
      pendingCount: 0,
      readyCandidateCount: 1,
      dispatchedCount: 1,
      deferredCount: 0,
      failedDispatchCount: 0,
    },
    lock: {
      lockId: 'kernel_lock_health_test',
      serviceId: 'openmas_os_service_health_test',
      status: 'active',
      claimStatus: 'claimed',
      refreshedAt: NOW,
    },
    ...overrides,
  });
}

test('writeServiceHealthSnapshot persists readable heartbeat and service state files', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const paths = resolveServiceHealthPaths({ projectRootPath });
  const state = createState({
    projectRootPath,
  });

  const snapshot = await writeServiceHealthSnapshot({
    projectRootPath,
    state,
    lastHeartbeatAt: LATER,
  });

  await assertFileExists(paths.statePath);
  await assertFileExists(paths.heartbeatPath);
  assert.deepEqual(await readServiceState({ projectRootPath }), snapshot.state);
  assert.deepEqual(await readServiceHeartbeat({ projectRootPath }), snapshot.heartbeat);
  assert.equal(snapshot.state.osRootPath, path.join(projectRootPath, 'instance', 'os'));
  assert.equal(snapshot.heartbeat.status, 'running');
  assert.equal(snapshot.heartbeat.lastHeartbeatAt, LATER);
  assert.equal(snapshot.heartbeat.lastTickStatus, 'completed');
  assert.equal(snapshot.heartbeat.tickCount, 3);
  assert.equal(snapshot.heartbeat.failedTickCount, 1);
  assert.equal(snapshot.heartbeat.skippedTickCount, 2);
});

test('buildServiceHealthSummary reports fresh and stale heartbeat health', () => {
  const state = createState();
  const heartbeat = buildServiceHeartbeat({
    state,
    lastHeartbeatAt: NOW,
  });

  const freshSummary = buildServiceHealthSummary({
    heartbeat,
    state,
    now: () => LATER,
  });
  const staleSummary = buildServiceHealthSummary({
    heartbeat: {
      ...heartbeat,
      staleAfterMs: 1000,
    },
    state,
    now: () => LATER,
  });

  assert.equal(freshSummary.status, 'running');
  assert.equal(freshSummary.heartbeatAgeMs, 10000);
  assert.equal(freshSummary.heartbeatStale, false);
  assert.equal(freshSummary.lastTickStatus, 'completed');
  assert.equal(freshSummary.failedTickCount, 1);
  assert.equal(freshSummary.activeAsyncExecutionCount, 0);
  assert.equal(freshSummary.nextRecommendedAction, 'Service heartbeat is fresh.');
  assert.equal(staleSummary.heartbeatStale, true);
  assert.equal(staleSummary.nextRecommendedAction, 'Service heartbeat is stale or missing.');
});

test('buildServiceHealthSummary carries active tick operator context', () => {
  const state = createState({
    status: 'ticking',
    activeTick: {
      tickIndex: 4,
      startedAt: NOW,
    },
  });
  const heartbeat = buildServiceHeartbeat({
    state,
    lastHeartbeatAt: LATER,
  });
  const summary = buildServiceHealthSummary({
    heartbeat,
    state,
    now: () => LATER,
  });

  assert.deepEqual(heartbeat.activeTick, {
    tickIndex: 4,
    startedAt: NOW,
  });
  assert.deepEqual(summary.activeTick, {
    tickIndex: 4,
    startedAt: NOW,
  });
  assert.equal(summary.activeTickAgeMs, 10000);
});

test('buildServiceHealthSummary carries active asynchronous execution counts only while service is running', () => {
  const baseState = createState();
  const runningState = createState({
    lastTick: {
      ...baseState.lastTick,
      asyncActiveExecutionCount: 2,
      asyncMaxConcurrentExecutions: 5,
    },
  });
  const stoppedState = createState({
    status: 'stopped',
    updatedAt: LATER,
    stoppedAt: LATER,
    stopRequested: true,
    stopReason: 'signal_sigint',
    lastTick: {
      ...baseState.lastTick,
      asyncActiveExecutionCount: 2,
      asyncMaxConcurrentExecutions: 5,
    },
  });

  const runningSummary = buildServiceHealthSummary({
    heartbeat: buildServiceHeartbeat({
      state: runningState,
      lastHeartbeatAt: LATER,
    }),
    state: runningState,
    now: () => LATER,
  });
  const stoppedSummary = buildServiceHealthSummary({
    heartbeat: buildServiceHeartbeat({
      state: stoppedState,
      lastHeartbeatAt: LATER,
    }),
    state: stoppedState,
    now: () => LATER,
  });

  assert.equal(runningSummary.activeAsyncExecutionCount, 2);
  assert.equal(runningSummary.asyncMaxConcurrentExecutions, 5);
  assert.equal(stoppedSummary.activeAsyncExecutionCount, 0);
  assert.equal(stoppedSummary.asyncMaxConcurrentExecutions, 0);
});

test('buildServiceHealthSummary reports stopped service snapshots without implying a running heartbeat', () => {
  const stoppedState = createState({
    status: 'stopped',
    updatedAt: LATER,
    stoppedAt: LATER,
    stopRequested: true,
    stopReason: 'one_shot_tick_completed',
    lock: {
      lockId: 'kernel_lock_health_test',
      serviceId: 'openmas_os_service_health_test',
      status: 'active',
      claimStatus: 'released',
      refreshedAt: NOW,
    },
  });
  const stoppedHeartbeat = buildServiceHeartbeat({
    state: stoppedState,
    lastHeartbeatAt: LATER,
  });
  const stoppedSummary = buildServiceHealthSummary({
    heartbeat: stoppedHeartbeat,
    state: stoppedState,
    now: () => LATER,
  });
  const missingSummary = buildServiceHealthSummary({
    now: () => LATER,
  });

  assert.equal(stoppedSummary.status, 'stopped');
  assert.equal(stoppedSummary.heartbeatStale, false);
  assert.equal(stoppedSummary.nextRecommendedAction, 'Service is stopped.');
  assert.equal(missingSummary.status, 'stopped');
  assert.equal(missingSummary.heartbeatStale, true);
  assert.equal(missingSummary.nextRecommendedAction, 'Service heartbeat is stale or missing.');
});

test('readServiceHeartbeat and readServiceState return null when service health files do not exist', async () => {
  const projectRootPath = await createTemporaryProjectRoot();

  assert.equal(await readServiceHeartbeat({ projectRootPath }), null);
  assert.equal(await readServiceState({ projectRootPath }), null);
});

test('service health files reject raw secret-like state', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const state = createState({
    projectRootPath,
  });

  await assert.rejects(
    () => writeServiceState({
      projectRootPath,
      state: {
        ...state,
        lastError: {
          name: 'ProviderError',
          message: 'Provider rejected sk-or-v1-secretvalue123456789',
        },
      },
    }),
    /secret-like value/u,
  );

  await assert.rejects(
    () => writeServiceHeartbeat({
      projectRootPath,
      heartbeat: {
        ...buildServiceHeartbeat({ state }),
        apiKey: 'sk-or-v1-secretvalue123456789',
      },
    }),
    /raw secret-like field/u,
  );

  await writeServiceHealthSnapshot({
    projectRootPath,
    state,
  });
  const serializedHealth = [
    await readFile(resolveServiceHealthPaths({ projectRootPath }).statePath, 'utf8'),
    await readFile(resolveServiceHealthPaths({ projectRootPath }).heartbeatPath, 'utf8'),
  ].join('\n');

  assert.doesNotMatch(serializedHealth, /sk-or-v1/u);
  assert.doesNotMatch(serializedHealth, /AIza/u);
});
