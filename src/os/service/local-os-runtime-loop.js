import { randomUUID } from 'node:crypto';
import { assertSafeOsSerializableValue } from '../../contracts/os/openmas-os-runtime-contract.js';
import {
  DEFAULT_MAX_SYSTEM_CALLS_PER_TICK,
  runOpenMasOsServiceTick,
} from './local-os-service.js';

const RUNTIME_LOOP_RESULT_KIND = 'openmas_os_runtime_loop_result';
const RUNTIME_LOOP_RESULT_VERSION = 1;
const RUNTIME_LOOP_LIFECYCLE_EVENT_KIND = 'openmas_os_runtime_loop_lifecycle_event';
const RUNTIME_LOOP_LIFECYCLE_EVENT_VERSION = 1;
const RUNTIME_LOOP_SKIPPED_TICK_EVENT_KIND = 'openmas_os_runtime_loop_skipped_tick_event';
const RUNTIME_LOOP_SKIPPED_TICK_EVENT_VERSION = 1;

const DEFAULT_TICK_INTERVAL_MS = 5000;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 5000;
const DEFAULT_STALE_AFTER_MS = 30000;
const DEFAULT_MAX_DISPATCHED_JOBS_PER_TICK = 25;

const OPENMAS_OS_RUNTIME_LOOP_STATUSES = Object.freeze([
  'starting',
  'running',
  'idle',
  'ticking',
  'stopping',
  'stopped',
  'failed',
  'recovering',
]);

const SECRET_VALUE_REDACTION_PATTERNS = Object.freeze([
  /sk-(?:or-)?[a-zA-Z0-9_-]{8,}/gu,
  /AIza[a-zA-Z0-9_-]{10,}/gu,
  /xox[baprs]-[a-zA-Z0-9-]{8,}/gu,
  /Bearer\s+[a-zA-Z0-9._~+/-]{12,}/giu,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/gu,
]);

function defaultNow() {
  return new Date().toISOString();
}

function defaultSleep(delayMs) {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeNow(now) {
  if (now === undefined || now === null) {
    return defaultNow;
  }

  if (typeof now !== 'function') {
    throw new Error('OpenMAS OS runtime loop now must be a function when provided.');
  }

  return now;
}

function normalizeSleep(sleep) {
  if (sleep === undefined || sleep === null) {
    return defaultSleep;
  }

  if (typeof sleep !== 'function') {
    throw new Error('OpenMAS OS runtime loop sleep must be a function when provided.');
  }

  return sleep;
}

function normalizeCallback(callback, description) {
  if (callback === undefined || callback === null) {
    return null;
  }

  if (typeof callback !== 'function') {
    throw new Error(`${description} must be a function when provided.`);
  }

  return callback;
}

function normalizePositiveInteger(value, description) {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${description} must be an integer greater than or equal to 1.`);
  }

  return value;
}

function normalizeNullablePositiveInteger(value, description) {
  if (value === undefined || value === null) {
    return null;
  }

  return normalizePositiveInteger(value, description);
}

function createRuntimeLoopServiceId() {
  return `openmas_os_service_${randomUUID()}`;
}

function normalizeServiceId(serviceId) {
  if (serviceId === undefined || serviceId === null || serviceId === '') {
    return createRuntimeLoopServiceId();
  }

  if (!isNonEmptyString(serviceId)) {
    throw new Error('OpenMAS OS runtime loop serviceId must be a non-empty string when provided.');
  }

  return serviceId.trim();
}

function normalizeStopReason(reason) {
  if (!isNonEmptyString(reason)) {
    return 'requested';
  }

  return reason.trim().slice(0, 200);
}

function redactSecretLikeValues(value) {
  const stringValue = String(value ?? '');
  let redactedValue = stringValue;

  for (const pattern of SECRET_VALUE_REDACTION_PATTERNS) {
    redactedValue = redactedValue.replace(pattern, '[redacted-secret]');
  }

  return redactedValue.slice(0, 1000);
}

function createSafeErrorMessage(error, fallbackMessage = 'OpenMAS OS runtime loop failed.') {
  if (error instanceof Error && isNonEmptyString(error.message)) {
    return redactSecretLikeValues(error.message);
  }

  if (isNonEmptyString(error)) {
    return redactSecretLikeValues(error);
  }

  return fallbackMessage;
}

function createSafeErrorName(error) {
  if (error instanceof Error && isNonEmptyString(error.name)) {
    return redactSecretLikeValues(error.name);
  }

  return 'Error';
}

function normalizeTickStatus(status) {
  if (status === 'completed') {
    return 'completedTickCount';
  }

  if (status === 'completed_with_failures') {
    return 'completedWithFailuresTickCount';
  }

  if (status === 'idle') {
    return 'idleTickCount';
  }

  return 'failedTickCount';
}

function summarizeTickResult(tickResult) {
  return {
    tickId: tickResult.tickId ?? null,
    status: tickResult.status ?? 'unknown',
    startedAt: tickResult.startedAt ?? null,
    finishedAt: tickResult.finishedAt ?? null,
    systemCallProcessedCount: tickResult.systemCalls?.processedCount ?? 0,
    systemCallCompletedCount: tickResult.systemCalls?.completedCount ?? 0,
    systemCallDeniedCount: tickResult.systemCalls?.deniedCount ?? 0,
    systemCallFailedCount: tickResult.systemCalls?.failedCount ?? 0,
    systemCallExpiredCount: tickResult.systemCalls?.expiredCount ?? 0,
    systemCallCancelledCount: tickResult.systemCalls?.cancelledCount ?? 0,
    releasedCount: tickResult.release?.releasedCount ?? 0,
    pendingCount: tickResult.release?.pendingCount ?? 0,
    readyCandidateCount: tickResult.readyWork?.candidateCount ?? 0,
    dispatchedCount: tickResult.readyWork?.dispatchedCount ?? tickResult.dispatches?.length ?? 0,
    deferredCount: tickResult.readyWork?.deferredCount ?? 0,
    settledDispatchCount: tickResult.settledDispatches?.length ?? 0,
    asyncActiveExecutionCount: tickResult.asyncExecution?.activeCount ?? 0,
    asyncMaxConcurrentExecutions: tickResult.asyncExecution?.maxConcurrentExecutions ?? 0,
    failedDispatchCount: Array.isArray(tickResult.dispatches)
      ? [...tickResult.dispatches, ...(tickResult.settledDispatches ?? [])]
        .filter((dispatch) => dispatch.status === 'failed').length
      : 0,
  };
}

function createInitialStats() {
  return {
    tickCount: 0,
    idleTickCount: 0,
    completedTickCount: 0,
    completedWithFailuresTickCount: 0,
    failedTickCount: 0,
    skippedTickCount: 0,
    systemCallProcessedCount: 0,
    systemCallCompletedCount: 0,
    systemCallDeniedCount: 0,
    systemCallFailedCount: 0,
    systemCallExpiredCount: 0,
    systemCallCancelledCount: 0,
  };
}

function addSystemCallStatsFromTick(stats, tickResult) {
  const systemCalls = tickResult.systemCalls ?? {};

  stats.systemCallProcessedCount += systemCalls.processedCount ?? 0;
  stats.systemCallCompletedCount += systemCalls.completedCount ?? 0;
  stats.systemCallDeniedCount += systemCalls.deniedCount ?? 0;
  stats.systemCallFailedCount += systemCalls.failedCount ?? 0;
  stats.systemCallExpiredCount += systemCalls.expiredCount ?? 0;
  stats.systemCallCancelledCount += systemCalls.cancelledCount ?? 0;
}

function createSafeLoopConfig({
  tickIntervalMs = DEFAULT_TICK_INTERVAL_MS,
  heartbeatIntervalMs = DEFAULT_HEARTBEAT_INTERVAL_MS,
  maxDispatchedJobsPerTick = DEFAULT_MAX_DISPATCHED_JOBS_PER_TICK,
  maxSystemCallsPerTick = DEFAULT_MAX_SYSTEM_CALLS_PER_TICK,
  staleAfterMs = DEFAULT_STALE_AFTER_MS,
  maxTicks = null,
  continueOnTickError = true,
} = {}) {
  return {
    tickIntervalMs: normalizePositiveInteger(
      tickIntervalMs,
      'OpenMAS OS runtime loop tickIntervalMs',
    ),
    heartbeatIntervalMs: normalizePositiveInteger(
      heartbeatIntervalMs,
      'OpenMAS OS runtime loop heartbeatIntervalMs',
    ),
    maxDispatchedJobsPerTick: normalizePositiveInteger(
      maxDispatchedJobsPerTick,
      'OpenMAS OS runtime loop maxDispatchedJobsPerTick',
    ),
    maxSystemCallsPerTick: normalizePositiveInteger(
      maxSystemCallsPerTick,
      'OpenMAS OS runtime loop maxSystemCallsPerTick',
    ),
    staleAfterMs: normalizePositiveInteger(
      staleAfterMs,
      'OpenMAS OS runtime loop staleAfterMs',
    ),
    maxTicks: normalizeNullablePositiveInteger(
      maxTicks,
      'OpenMAS OS runtime loop maxTicks',
    ),
    continueOnTickError: continueOnTickError === undefined
      ? true
      : (() => {
        if (typeof continueOnTickError !== 'boolean') {
          throw new Error('OpenMAS OS runtime loop continueOnTickError must be a boolean when provided.');
        }

        return continueOnTickError;
      })(),
  };
}

function createLifecycleEvent({
  serviceId,
  status,
  occurredAt,
  tickIndex = null,
  tickId = null,
  reason = null,
  error = null,
}) {
  if (!OPENMAS_OS_RUNTIME_LOOP_STATUSES.includes(status)) {
    throw new Error(`OpenMAS OS runtime loop status is invalid: ${status}`);
  }

  return assertSafeOsSerializableValue({
    kind: RUNTIME_LOOP_LIFECYCLE_EVENT_KIND,
    version: RUNTIME_LOOP_LIFECYCLE_EVENT_VERSION,
    serviceId,
    status,
    occurredAt,
    tickIndex,
    tickId,
    reason: reason ? normalizeStopReason(reason) : null,
    error: error
      ? {
        name: createSafeErrorName(error),
        message: createSafeErrorMessage(error),
      }
      : null,
  }, 'OpenMAS OS runtime loop lifecycle event');
}

function createSkippedTickEvent({
  serviceId,
  occurredAt,
  activeTickIndex,
  activeTickStartedAt = null,
  skippedTickCount,
  reason = 'active_tick_in_progress',
}) {
  return assertSafeOsSerializableValue({
    kind: RUNTIME_LOOP_SKIPPED_TICK_EVENT_KIND,
    version: RUNTIME_LOOP_SKIPPED_TICK_EVENT_VERSION,
    serviceId,
    occurredAt,
    activeTickIndex,
    activeTickStartedAt,
    skippedTickCount,
    reason,
  }, 'OpenMAS OS runtime loop skipped tick event');
}

function buildLoopSnapshot({
  serviceId,
  status,
  startedAt,
  config,
  stats,
  lastTick,
  activeTick,
  lastError,
  stopRequested,
  stopReason,
}) {
  return assertSafeOsSerializableValue({
    kind: 'openmas_os_runtime_loop_snapshot',
    version: 1,
    serviceId,
    status,
    startedAt,
    config,
    stats,
    lastTick,
    activeTick,
    lastError,
    stopRequested,
    stopReason,
  }, 'OpenMAS OS runtime loop snapshot');
}

function buildLoopResult({
  serviceId,
  status,
  stopReason,
  startedAt,
  stoppedAt,
  config,
  stats,
  lastTick,
  lastError,
  lifecycleEvents,
}) {
  return assertSafeOsSerializableValue({
    kind: RUNTIME_LOOP_RESULT_KIND,
    version: RUNTIME_LOOP_RESULT_VERSION,
    serviceId,
    status,
    stopReason,
    startedAt,
    stoppedAt,
    config,
    stats,
    lastTick,
    lastError,
    lifecycleEvents,
  }, 'OpenMAS OS runtime loop result');
}

function shouldStopForMaxTicks({ config, stats }) {
  return config.maxTicks !== null && stats.tickCount >= config.maxTicks;
}

async function maybeInvokeCallback(callback, ...args) {
  if (callback) {
    await callback(...args);
  }
}

export function normalizeOpenMasOsRuntimeLoopConfig(options = {}) {
  return createSafeLoopConfig(options);
}

export function createOpenMasOsRuntimeLoopController() {
  let stopRequested = false;
  let stopReason = null;

  return {
    get stopRequested() {
      return stopRequested;
    },
    get stopReason() {
      return stopReason;
    },
    requestStop(reason = 'requested') {
      stopRequested = true;
      stopReason = normalizeStopReason(reason);

      return {
        stopRequested,
        stopReason,
      };
    },
  };
}

export async function runOpenMasOsRuntimeLoop({
  adapter = null,
  projectRootPath = null,
  osRootPath = null,
  serviceId = null,
  tickRunner = runOpenMasOsServiceTick,
  now = defaultNow,
  sleep = defaultSleep,
  controller = createOpenMasOsRuntimeLoopController(),
  shouldStop = null,
  onLifecycleEvent = null,
  onTickResult = null,
  onTickError = null,
  onTickSkipped = null,
  asyncDispatchExecutor = null,
  invocationRunner,
  invocationOptions = {},
  tickIntervalMs = DEFAULT_TICK_INTERVAL_MS,
  heartbeatIntervalMs = DEFAULT_HEARTBEAT_INTERVAL_MS,
  maxDispatchedJobsPerTick = DEFAULT_MAX_DISPATCHED_JOBS_PER_TICK,
  maxSystemCallsPerTick = DEFAULT_MAX_SYSTEM_CALLS_PER_TICK,
  staleAfterMs = DEFAULT_STALE_AFTER_MS,
  maxTicks = null,
  continueOnTickError = true,
  recoverTerminalResultPublicationsOnStart = true,
  reconcileSchedulerQueuesOnStart = true,
} = {}) {
  if (typeof tickRunner !== 'function') {
    throw new Error('OpenMAS OS runtime loop tickRunner must be a function.');
  }

  if (typeof recoverTerminalResultPublicationsOnStart !== 'boolean') {
    throw new Error('OpenMAS OS runtime loop recoverTerminalResultPublicationsOnStart must be a boolean.');
  }

  if (typeof reconcileSchedulerQueuesOnStart !== 'boolean') {
    throw new Error('OpenMAS OS runtime loop reconcileSchedulerQueuesOnStart must be a boolean.');
  }

  const safeServiceId = normalizeServiceId(serviceId);
  const config = createSafeLoopConfig({
    tickIntervalMs,
    heartbeatIntervalMs,
    maxDispatchedJobsPerTick,
    maxSystemCallsPerTick,
    staleAfterMs,
    maxTicks,
    continueOnTickError,
  });
  const nowFn = normalizeNow(now);
  const sleepFn = normalizeSleep(sleep);
  const shouldStopFn = normalizeCallback(shouldStop, 'OpenMAS OS runtime loop shouldStop');
  const onLifecycleEventFn = normalizeCallback(
    onLifecycleEvent,
    'OpenMAS OS runtime loop onLifecycleEvent',
  );
  const onTickResultFn = normalizeCallback(onTickResult, 'OpenMAS OS runtime loop onTickResult');
  const onTickErrorFn = normalizeCallback(onTickError, 'OpenMAS OS runtime loop onTickError');
  const onTickSkippedFn = normalizeCallback(
    onTickSkipped,
    'OpenMAS OS runtime loop onTickSkipped',
  );
  const stats = createInitialStats();
  const lifecycleEvents = [];
  let status = 'starting';
  let lastTick = null;
  let activeTick = null;
  let lastError = null;
  let stopReason = null;
  let finalStatus = 'stopped';
  let terminalResultRecoveryPending = recoverTerminalResultPublicationsOnStart;
  let schedulerQueueReconciliationPending = reconcileSchedulerQueuesOnStart;
  const startedAt = nowFn();

  const snapshot = () => buildLoopSnapshot({
    serviceId: safeServiceId,
    status,
    startedAt,
    config,
    stats,
    lastTick,
    activeTick,
    lastError,
    stopRequested: controller.stopRequested,
    stopReason: controller.stopReason,
  });

  const appendLifecycle = async (eventInput) => {
    const event = createLifecycleEvent({
      serviceId: safeServiceId,
      occurredAt: nowFn(),
      ...eventInput,
    });

    lifecycleEvents.push(event);
    await maybeInvokeCallback(onLifecycleEventFn, event, snapshot());
    return event;
  };

  const shouldStopNow = async () => {
    if (controller.stopRequested) {
      stopReason = controller.stopReason ?? 'requested';
      return true;
    }

    if (shouldStopFn && await shouldStopFn(snapshot())) {
      stopReason = 'should_stop';
      return true;
    }

    if (shouldStopForMaxTicks({ config, stats })) {
      stopReason = 'max_ticks_reached';
      return true;
    }

    return false;
  };

  await appendLifecycle({ status: 'starting' });
  status = 'running';
  await appendLifecycle({ status: 'running' });
  status = 'idle';

  while (!await shouldStopNow()) {
    const tickIndex = stats.tickCount + 1;
    const skippedTickTasks = [];
    let skippedTickCallbackError = null;
    let activeTickInProgress = true;
    const activeTickStartedAt = nowFn();
    const activeTickSnapshot = {
      tickIndex,
      startedAt: activeTickStartedAt,
    };

    activeTick = activeTickSnapshot;
    status = 'ticking';
    await appendLifecycle({
      status: 'ticking',
      tickIndex,
    });

    const backpressureInterval = setInterval(() => {
      if (!activeTickInProgress) {
        return;
      }

      stats.skippedTickCount += 1;
      const skippedTickEvent = createSkippedTickEvent({
        serviceId: safeServiceId,
        occurredAt: nowFn(),
        activeTickIndex: tickIndex,
        activeTickStartedAt,
        skippedTickCount: stats.skippedTickCount,
      });
      const callbackTask = maybeInvokeCallback(
        onTickSkippedFn,
        skippedTickEvent,
        snapshot(),
      ).catch((error) => {
        if (!skippedTickCallbackError) {
          skippedTickCallbackError = error;
        }
      });

      skippedTickTasks.push(callbackTask);
    }, config.tickIntervalMs);

    backpressureInterval.unref?.();

    const stopBackpressureInterval = async () => {
      activeTickInProgress = false;
      clearInterval(backpressureInterval);
      await Promise.all(skippedTickTasks);

      if (skippedTickCallbackError) {
        throw skippedTickCallbackError;
      }
    };

    try {
      const tickResult = await tickRunner({
        adapter,
        projectRootPath,
        osRootPath,
        serviceId: safeServiceId,
        now: nowFn,
        maxDispatchedJobs: config.maxDispatchedJobsPerTick,
        maxSystemCallsPerTick: config.maxSystemCallsPerTick,
        recoverTerminalResultPublications: terminalResultRecoveryPending,
        reconcileSchedulerQueues: schedulerQueueReconciliationPending,
        asyncDispatchExecutor,
        invocationRunner,
        invocationOptions,
      });

      await stopBackpressureInterval();
      terminalResultRecoveryPending = false;
      schedulerQueueReconciliationPending = false;

      stats.tickCount += 1;
      stats[normalizeTickStatus(tickResult.status)] += 1;
      addSystemCallStatsFromTick(stats, tickResult);
      lastTick = summarizeTickResult(tickResult);
      activeTick = null;
      lastError = null;
      await maybeInvokeCallback(onTickResultFn, tickResult, snapshot());

      status = 'idle';
      await appendLifecycle({
        status: 'idle',
        tickIndex,
        tickId: lastTick.tickId,
        reason: lastTick.status,
      });
    } catch (error) {
      terminalResultRecoveryPending = true;
      schedulerQueueReconciliationPending = true;
      activeTickInProgress = false;
      clearInterval(backpressureInterval);
      await Promise.all(skippedTickTasks);

      stats.tickCount += 1;
      stats.failedTickCount += 1;
      activeTick = null;
      lastError = {
        name: createSafeErrorName(error),
        message: createSafeErrorMessage(error),
      };
      await maybeInvokeCallback(onTickErrorFn, lastError, snapshot());
      await appendLifecycle({
        status: 'failed',
        tickIndex,
        error,
      });

      if (!config.continueOnTickError) {
        finalStatus = 'failed';
        stopReason = 'tick_failed';
        break;
      }

      status = 'idle';
      await appendLifecycle({
        status: 'idle',
        tickIndex,
        reason: 'tick_failed',
      });
    }

    if (await shouldStopNow()) {
      break;
    }

    await sleepFn(config.tickIntervalMs, snapshot());
  }

  if (finalStatus !== 'failed' && stats.failedTickCount > 0) {
    finalStatus = 'stopped_with_failures';
  }

  status = 'stopping';
  await appendLifecycle({
    status: 'stopping',
    reason: stopReason ?? 'requested',
  });
  status = finalStatus === 'failed' ? 'failed' : 'stopped';
  const stoppedAt = nowFn();
  await appendLifecycle({
    status,
    reason: stopReason ?? 'requested',
  });

  return buildLoopResult({
    serviceId: safeServiceId,
    status: finalStatus,
    stopReason: stopReason ?? 'requested',
    startedAt,
    stoppedAt,
    config,
    stats,
    lastTick,
    lastError,
    lifecycleEvents,
  });
}

export class LocalOpenMasOsRuntimeLoop {
  constructor(options = {}) {
    this.options = {
      ...options,
    };
    this.controller = options.controller ?? createOpenMasOsRuntimeLoopController();
  }

  requestStop(reason = 'requested') {
    return this.controller.requestStop(reason);
  }

  async run(options = {}) {
    return runOpenMasOsRuntimeLoop({
      ...this.options,
      ...options,
      controller: options.controller ?? this.controller,
    });
  }
}

export function createLocalOpenMasOsRuntimeLoop(options = {}) {
  return new LocalOpenMasOsRuntimeLoop(options);
}

export {
  DEFAULT_HEARTBEAT_INTERVAL_MS,
  DEFAULT_MAX_DISPATCHED_JOBS_PER_TICK,
  DEFAULT_MAX_SYSTEM_CALLS_PER_TICK,
  DEFAULT_STALE_AFTER_MS,
  DEFAULT_TICK_INTERVAL_MS,
  OPENMAS_OS_RUNTIME_LOOP_STATUSES,
  RUNTIME_LOOP_RESULT_KIND,
  RUNTIME_LOOP_RESULT_VERSION,
};
