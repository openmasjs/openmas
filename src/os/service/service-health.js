import os from 'node:os';
import path from 'node:path';
import {
  readFile,
} from 'node:fs/promises';
import { assertSafeOsSerializableValue } from '../../contracts/os/openmas-os-runtime-contract.js';
import { publishMutableJsonSnapshot } from './mutable-json-publication.js';

const OPENMAS_OS_SERVICE_HEARTBEAT_KIND = 'openmas_os_service_heartbeat';
const OPENMAS_OS_SERVICE_STATE_KIND = 'openmas_os_service_state';
const OPENMAS_OS_SERVICE_HEALTH_SUMMARY_KIND = 'openmas_os_service_health_summary';
const OPENMAS_OS_SERVICE_HEALTH_VERSION = 1;
const SERVICE_HEARTBEAT_FILE_NAME = 'heartbeat.json';
const SERVICE_STATE_FILE_NAME = 'state.json';
const SERVICE_HEALTH_DIRECTORY_NAME = 'service';

const OPENMAS_OS_SERVICE_STATUSES = Object.freeze([
  'starting',
  'running',
  'idle',
  'ticking',
  'stopping',
  'stopped',
  'stopped_with_failures',
  'failed',
  'recovering',
]);

function defaultNow() {
  return new Date().toISOString();
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isNotFoundError(error) {
  return error && error.code === 'ENOENT';
}

function normalizeNow(now) {
  if (now === undefined || now === null) {
    return defaultNow;
  }

  if (typeof now !== 'function') {
    throw new Error('OpenMAS OS service health now must be a function when provided.');
  }

  return now;
}

function normalizeNonEmptyString(value, description) {
  if (!isNonEmptyString(value)) {
    throw new Error(`${description} must be a non-empty string.`);
  }

  return value.trim();
}

function normalizeNullableString(value, description) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  return normalizeNonEmptyString(value, description);
}

function normalizeIsoDateString(value, description) {
  const normalizedValue = normalizeNonEmptyString(value, description);

  if (Number.isNaN(Date.parse(normalizedValue))) {
    throw new Error(`${description} must be a valid date string.`);
  }

  return normalizedValue;
}

function normalizeNullableIsoDateString(value, description) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  return normalizeIsoDateString(value, description);
}

function normalizePositiveInteger(value, description) {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${description} must be an integer greater than or equal to 1.`);
  }

  return value;
}

function normalizeNonNegativeInteger(value, description) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${description} must be an integer greater than or equal to 0.`);
  }

  return value;
}

function normalizeActiveTick(activeTick) {
  if (activeTick === undefined || activeTick === null) {
    return null;
  }

  const safeActiveTick = assertSafeOsSerializableValue(activeTick, 'OpenMAS OS service activeTick');

  return {
    tickIndex: normalizePositiveInteger(
      safeActiveTick.tickIndex,
      'OpenMAS OS service activeTick tickIndex',
    ),
    startedAt: normalizeIsoDateString(
      safeActiveTick.startedAt,
      'OpenMAS OS service activeTick startedAt',
    ),
  };
}

function normalizeStatus(status, description = 'OpenMAS OS service status') {
  const normalizedStatus = normalizeNonEmptyString(status, description);

  if (!OPENMAS_OS_SERVICE_STATUSES.includes(normalizedStatus)) {
    throw new Error(`${description} is invalid: ${normalizedStatus}`);
  }

  return normalizedStatus;
}

function normalizeHostname(hostname) {
  const normalizedHostname = hostname === undefined || hostname === null || hostname === ''
    ? os.hostname()
    : normalizeNonEmptyString(hostname, 'OpenMAS OS service hostname');

  return normalizedHostname.slice(0, 255);
}

function normalizePid(pid) {
  const effectivePid = pid === undefined || pid === null
    ? process.pid
    : pid;

  return normalizePositiveInteger(effectivePid, 'OpenMAS OS service pid');
}

function normalizeStats(stats = {}) {
  const safeStats = assertSafeOsSerializableValue(stats ?? {}, 'OpenMAS OS service stats');

  return {
    tickCount: normalizeNonNegativeInteger(safeStats.tickCount ?? 0, 'OpenMAS OS service stats tickCount'),
    idleTickCount: normalizeNonNegativeInteger(safeStats.idleTickCount ?? 0, 'OpenMAS OS service stats idleTickCount'),
    completedTickCount: normalizeNonNegativeInteger(
      safeStats.completedTickCount ?? 0,
      'OpenMAS OS service stats completedTickCount',
    ),
    completedWithFailuresTickCount: normalizeNonNegativeInteger(
      safeStats.completedWithFailuresTickCount ?? 0,
      'OpenMAS OS service stats completedWithFailuresTickCount',
    ),
    failedTickCount: normalizeNonNegativeInteger(
      safeStats.failedTickCount ?? 0,
      'OpenMAS OS service stats failedTickCount',
    ),
    skippedTickCount: normalizeNonNegativeInteger(
      safeStats.skippedTickCount ?? 0,
      'OpenMAS OS service stats skippedTickCount',
    ),
    systemCallProcessedCount: normalizeNonNegativeInteger(
      safeStats.systemCallProcessedCount ?? 0,
      'OpenMAS OS service stats systemCallProcessedCount',
    ),
    systemCallCompletedCount: normalizeNonNegativeInteger(
      safeStats.systemCallCompletedCount ?? 0,
      'OpenMAS OS service stats systemCallCompletedCount',
    ),
    systemCallDeniedCount: normalizeNonNegativeInteger(
      safeStats.systemCallDeniedCount ?? 0,
      'OpenMAS OS service stats systemCallDeniedCount',
    ),
    systemCallFailedCount: normalizeNonNegativeInteger(
      safeStats.systemCallFailedCount ?? 0,
      'OpenMAS OS service stats systemCallFailedCount',
    ),
    systemCallExpiredCount: normalizeNonNegativeInteger(
      safeStats.systemCallExpiredCount ?? 0,
      'OpenMAS OS service stats systemCallExpiredCount',
    ),
    systemCallCancelledCount: normalizeNonNegativeInteger(
      safeStats.systemCallCancelledCount ?? 0,
      'OpenMAS OS service stats systemCallCancelledCount',
    ),
  };
}

function normalizeConfig(config = {}) {
  const safeConfig = assertSafeOsSerializableValue(config ?? {}, 'OpenMAS OS service config');

  return {
    tickIntervalMs: normalizePositiveInteger(
      safeConfig.tickIntervalMs ?? 5000,
      'OpenMAS OS service config tickIntervalMs',
    ),
    heartbeatIntervalMs: normalizePositiveInteger(
      safeConfig.heartbeatIntervalMs ?? 5000,
      'OpenMAS OS service config heartbeatIntervalMs',
    ),
    maxDispatchedJobsPerTick: normalizePositiveInteger(
      safeConfig.maxDispatchedJobsPerTick ?? 25,
      'OpenMAS OS service config maxDispatchedJobsPerTick',
    ),
    maxSystemCallsPerTick: normalizePositiveInteger(
      safeConfig.maxSystemCallsPerTick ?? 25,
      'OpenMAS OS service config maxSystemCallsPerTick',
    ),
    staleAfterMs: normalizePositiveInteger(
      safeConfig.staleAfterMs ?? 30000,
      'OpenMAS OS service config staleAfterMs',
    ),
  };
}

function normalizeLastTick(lastTick) {
  if (lastTick === undefined || lastTick === null) {
    return null;
  }

  const safeLastTick = assertSafeOsSerializableValue(lastTick, 'OpenMAS OS service lastTick');

  return {
    tickId: normalizeNullableString(safeLastTick.tickId, 'OpenMAS OS service lastTick tickId'),
    status: normalizeNullableString(safeLastTick.status, 'OpenMAS OS service lastTick status'),
    startedAt: normalizeNullableIsoDateString(
      safeLastTick.startedAt,
      'OpenMAS OS service lastTick startedAt',
    ),
    finishedAt: normalizeNullableIsoDateString(
      safeLastTick.finishedAt,
      'OpenMAS OS service lastTick finishedAt',
    ),
    systemCallProcessedCount: normalizeNonNegativeInteger(
      safeLastTick.systemCallProcessedCount ?? 0,
      'OpenMAS OS service lastTick systemCallProcessedCount',
    ),
    systemCallCompletedCount: normalizeNonNegativeInteger(
      safeLastTick.systemCallCompletedCount ?? 0,
      'OpenMAS OS service lastTick systemCallCompletedCount',
    ),
    systemCallDeniedCount: normalizeNonNegativeInteger(
      safeLastTick.systemCallDeniedCount ?? 0,
      'OpenMAS OS service lastTick systemCallDeniedCount',
    ),
    systemCallFailedCount: normalizeNonNegativeInteger(
      safeLastTick.systemCallFailedCount ?? 0,
      'OpenMAS OS service lastTick systemCallFailedCount',
    ),
    systemCallExpiredCount: normalizeNonNegativeInteger(
      safeLastTick.systemCallExpiredCount ?? 0,
      'OpenMAS OS service lastTick systemCallExpiredCount',
    ),
    systemCallCancelledCount: normalizeNonNegativeInteger(
      safeLastTick.systemCallCancelledCount ?? 0,
      'OpenMAS OS service lastTick systemCallCancelledCount',
    ),
    releasedCount: normalizeNonNegativeInteger(
      safeLastTick.releasedCount ?? 0,
      'OpenMAS OS service lastTick releasedCount',
    ),
    pendingCount: normalizeNonNegativeInteger(
      safeLastTick.pendingCount ?? 0,
      'OpenMAS OS service lastTick pendingCount',
    ),
    readyCandidateCount: normalizeNonNegativeInteger(
      safeLastTick.readyCandidateCount ?? 0,
      'OpenMAS OS service lastTick readyCandidateCount',
    ),
    dispatchedCount: normalizeNonNegativeInteger(
      safeLastTick.dispatchedCount ?? 0,
      'OpenMAS OS service lastTick dispatchedCount',
    ),
    deferredCount: normalizeNonNegativeInteger(
      safeLastTick.deferredCount ?? 0,
      'OpenMAS OS service lastTick deferredCount',
    ),
    settledDispatchCount: normalizeNonNegativeInteger(
      safeLastTick.settledDispatchCount ?? 0,
      'OpenMAS OS service lastTick settledDispatchCount',
    ),
    asyncActiveExecutionCount: normalizeNonNegativeInteger(
      safeLastTick.asyncActiveExecutionCount ?? 0,
      'OpenMAS OS service lastTick asyncActiveExecutionCount',
    ),
    asyncMaxConcurrentExecutions: normalizeNonNegativeInteger(
      safeLastTick.asyncMaxConcurrentExecutions ?? 0,
      'OpenMAS OS service lastTick asyncMaxConcurrentExecutions',
    ),
    failedDispatchCount: normalizeNonNegativeInteger(
      safeLastTick.failedDispatchCount ?? 0,
      'OpenMAS OS service lastTick failedDispatchCount',
    ),
  };
}

function normalizeLastError(lastError) {
  if (lastError === undefined || lastError === null) {
    return null;
  }

  const safeLastError = assertSafeOsSerializableValue(lastError, 'OpenMAS OS service lastError');

  return {
    name: normalizeNonEmptyString(safeLastError.name ?? 'Error', 'OpenMAS OS service lastError name'),
    message: normalizeNonEmptyString(
      safeLastError.message ?? 'OpenMAS OS service error.',
      'OpenMAS OS service lastError message',
    ),
  };
}

function normalizeLockSummary(lock) {
  if (lock === undefined || lock === null) {
    return null;
  }

  const safeLock = assertSafeOsSerializableValue(lock, 'OpenMAS OS service lock summary');

  return {
    lockId: normalizeNullableString(safeLock.lockId, 'OpenMAS OS service lock lockId'),
    serviceId: normalizeNullableString(safeLock.serviceId, 'OpenMAS OS service lock serviceId'),
    status: normalizeNullableString(safeLock.status, 'OpenMAS OS service lock status'),
    claimStatus: normalizeNullableString(
      safeLock.claimStatus,
      'OpenMAS OS service lock claimStatus',
    ),
    refreshedAt: normalizeNullableIsoDateString(
      safeLock.refreshedAt,
      'OpenMAS OS service lock refreshedAt',
    ),
  };
}

function resolveOsRootPath({ projectRootPath = null, osRootPath = null } = {}) {
  if (isNonEmptyString(osRootPath)) {
    return osRootPath.trim();
  }

  if (isNonEmptyString(projectRootPath)) {
    return path.join(projectRootPath.trim(), 'instance', 'os');
  }

  throw new Error('OpenMAS OS service health requires projectRootPath or osRootPath.');
}

function resolveServiceHealthPaths(options = {}) {
  const osRootPath = resolveOsRootPath(options);
  const serviceRootPath = path.join(osRootPath, SERVICE_HEALTH_DIRECTORY_NAME);

  return {
    osRootPath,
    serviceRootPath,
    heartbeatPath: path.join(serviceRootPath, SERVICE_HEARTBEAT_FILE_NAME),
    statePath: path.join(serviceRootPath, SERVICE_STATE_FILE_NAME),
  };
}

async function readJson(filePath, description) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (isNotFoundError(error)) {
      return null;
    }

    if (error instanceof SyntaxError) {
      throw new Error(`${description} could not be parsed as JSON: ${error.message}`);
    }

    throw error;
  }
}

function assertOpenMasOsServiceState(state) {
  if (!isPlainObject(state)) {
    throw new Error('OpenMAS OS service state must be an object.');
  }

  const safeState = assertSafeOsSerializableValue(state, 'OpenMAS OS service state');
  const normalizedState = {
    kind: safeState.kind ?? OPENMAS_OS_SERVICE_STATE_KIND,
    version: safeState.version ?? OPENMAS_OS_SERVICE_HEALTH_VERSION,
    serviceId: normalizeNonEmptyString(safeState.serviceId, 'OpenMAS OS service state serviceId'),
    status: normalizeStatus(safeState.status),
    projectRootPath: normalizeNullableString(
      safeState.projectRootPath,
      'OpenMAS OS service state projectRootPath',
    ),
    osRootPath: normalizeNullableString(safeState.osRootPath, 'OpenMAS OS service state osRootPath'),
    pid: normalizePid(safeState.pid),
    hostname: normalizeHostname(safeState.hostname),
    startedAt: normalizeIsoDateString(safeState.startedAt, 'OpenMAS OS service state startedAt'),
    updatedAt: normalizeIsoDateString(safeState.updatedAt, 'OpenMAS OS service state updatedAt'),
    stoppedAt: normalizeNullableIsoDateString(
      safeState.stoppedAt,
      'OpenMAS OS service state stoppedAt',
    ),
    config: normalizeConfig(safeState.config),
    stats: normalizeStats(safeState.stats),
    lastTick: normalizeLastTick(safeState.lastTick),
    activeTick: normalizeActiveTick(safeState.activeTick),
    lastError: normalizeLastError(safeState.lastError),
    stopRequested: Boolean(safeState.stopRequested ?? false),
    stopReason: normalizeNullableString(safeState.stopReason, 'OpenMAS OS service state stopReason'),
    lock: normalizeLockSummary(safeState.lock),
  };

  if (normalizedState.kind !== OPENMAS_OS_SERVICE_STATE_KIND) {
    throw new Error(`OpenMAS OS service state must include kind "${OPENMAS_OS_SERVICE_STATE_KIND}".`);
  }

  if (normalizedState.version !== OPENMAS_OS_SERVICE_HEALTH_VERSION) {
    throw new Error(`OpenMAS OS service state must include version ${OPENMAS_OS_SERVICE_HEALTH_VERSION}.`);
  }

  return assertSafeOsSerializableValue(normalizedState, 'OpenMAS OS service state');
}

function assertOpenMasOsServiceHeartbeat(heartbeat) {
  if (!isPlainObject(heartbeat)) {
    throw new Error('OpenMAS OS service heartbeat must be an object.');
  }

  const safeHeartbeat = assertSafeOsSerializableValue(
    heartbeat,
    'OpenMAS OS service heartbeat',
  );
  const normalizedHeartbeat = {
    kind: safeHeartbeat.kind ?? OPENMAS_OS_SERVICE_HEARTBEAT_KIND,
    version: safeHeartbeat.version ?? OPENMAS_OS_SERVICE_HEALTH_VERSION,
    serviceId: normalizeNonEmptyString(
      safeHeartbeat.serviceId,
      'OpenMAS OS service heartbeat serviceId',
    ),
    status: normalizeStatus(safeHeartbeat.status, 'OpenMAS OS service heartbeat status'),
    projectRootPath: normalizeNullableString(
      safeHeartbeat.projectRootPath,
      'OpenMAS OS service heartbeat projectRootPath',
    ),
    osRootPath: normalizeNullableString(
      safeHeartbeat.osRootPath,
      'OpenMAS OS service heartbeat osRootPath',
    ),
    pid: normalizePid(safeHeartbeat.pid),
    hostname: normalizeHostname(safeHeartbeat.hostname),
    startedAt: normalizeIsoDateString(
      safeHeartbeat.startedAt,
      'OpenMAS OS service heartbeat startedAt',
    ),
    lastHeartbeatAt: normalizeIsoDateString(
      safeHeartbeat.lastHeartbeatAt,
      'OpenMAS OS service heartbeat lastHeartbeatAt',
    ),
    staleAfterMs: normalizePositiveInteger(
      safeHeartbeat.staleAfterMs,
      'OpenMAS OS service heartbeat staleAfterMs',
    ),
    tickIntervalMs: normalizePositiveInteger(
      safeHeartbeat.tickIntervalMs,
      'OpenMAS OS service heartbeat tickIntervalMs',
    ),
    heartbeatIntervalMs: normalizePositiveInteger(
      safeHeartbeat.heartbeatIntervalMs,
      'OpenMAS OS service heartbeat heartbeatIntervalMs',
    ),
    lastTickId: normalizeNullableString(
      safeHeartbeat.lastTickId,
      'OpenMAS OS service heartbeat lastTickId',
    ),
    lastTickStatus: normalizeNullableString(
      safeHeartbeat.lastTickStatus,
      'OpenMAS OS service heartbeat lastTickStatus',
    ),
    activeTick: normalizeActiveTick(safeHeartbeat.activeTick),
    tickCount: normalizeNonNegativeInteger(
      safeHeartbeat.tickCount ?? 0,
      'OpenMAS OS service heartbeat tickCount',
    ),
    failedTickCount: normalizeNonNegativeInteger(
      safeHeartbeat.failedTickCount ?? 0,
      'OpenMAS OS service heartbeat failedTickCount',
    ),
    skippedTickCount: normalizeNonNegativeInteger(
      safeHeartbeat.skippedTickCount ?? 0,
      'OpenMAS OS service heartbeat skippedTickCount',
    ),
    completedTickCount: normalizeNonNegativeInteger(
      safeHeartbeat.completedTickCount ?? 0,
      'OpenMAS OS service heartbeat completedTickCount',
    ),
    idleTickCount: normalizeNonNegativeInteger(
      safeHeartbeat.idleTickCount ?? 0,
      'OpenMAS OS service heartbeat idleTickCount',
    ),
    systemCallProcessedCount: normalizeNonNegativeInteger(
      safeHeartbeat.systemCallProcessedCount ?? 0,
      'OpenMAS OS service heartbeat systemCallProcessedCount',
    ),
    systemCallFailedCount: normalizeNonNegativeInteger(
      safeHeartbeat.systemCallFailedCount ?? 0,
      'OpenMAS OS service heartbeat systemCallFailedCount',
    ),
    lock: normalizeLockSummary(safeHeartbeat.lock),
  };

  if (normalizedHeartbeat.kind !== OPENMAS_OS_SERVICE_HEARTBEAT_KIND) {
    throw new Error(`OpenMAS OS service heartbeat must include kind "${OPENMAS_OS_SERVICE_HEARTBEAT_KIND}".`);
  }

  if (normalizedHeartbeat.version !== OPENMAS_OS_SERVICE_HEALTH_VERSION) {
    throw new Error(`OpenMAS OS service heartbeat must include version ${OPENMAS_OS_SERVICE_HEALTH_VERSION}.`);
  }

  return assertSafeOsSerializableValue(normalizedHeartbeat, 'OpenMAS OS service heartbeat');
}

function resolveServiceHealthNextRecommendedAction({
  status,
  heartbeatStale,
  heartbeatPresent,
  statePresent,
}) {
  if (status === 'stopped' && (heartbeatPresent || statePresent)) {
    return 'Service is stopped.';
  }

  return heartbeatStale
    ? 'Service heartbeat is stale or missing.'
    : 'Service heartbeat is fresh.';
}

export function buildServiceState({
  serviceId,
  status,
  projectRootPath = null,
  osRootPath = null,
  pid = null,
  hostname = null,
  startedAt,
  updatedAt,
  stoppedAt = null,
  config = {},
  stats = {},
  lastTick = null,
  activeTick = null,
  lastError = null,
  stopRequested = false,
  stopReason = null,
  lock = null,
} = {}) {
  return assertOpenMasOsServiceState({
    kind: OPENMAS_OS_SERVICE_STATE_KIND,
    version: OPENMAS_OS_SERVICE_HEALTH_VERSION,
    serviceId,
    status,
    projectRootPath,
    osRootPath,
    pid,
    hostname,
    startedAt,
    updatedAt,
    stoppedAt,
    config,
    stats,
    lastTick,
    activeTick,
    lastError,
    stopRequested,
    stopReason,
    lock,
  });
}

export function buildServiceHeartbeat({
  state,
  lastHeartbeatAt = null,
} = {}) {
  const safeState = assertOpenMasOsServiceState(state);

  return assertOpenMasOsServiceHeartbeat({
    kind: OPENMAS_OS_SERVICE_HEARTBEAT_KIND,
    version: OPENMAS_OS_SERVICE_HEALTH_VERSION,
    serviceId: safeState.serviceId,
    status: safeState.status,
    projectRootPath: safeState.projectRootPath,
    osRootPath: safeState.osRootPath,
    pid: safeState.pid,
    hostname: safeState.hostname,
    startedAt: safeState.startedAt,
    lastHeartbeatAt: lastHeartbeatAt ?? safeState.updatedAt,
    staleAfterMs: safeState.config.staleAfterMs,
    tickIntervalMs: safeState.config.tickIntervalMs,
    heartbeatIntervalMs: safeState.config.heartbeatIntervalMs,
    lastTickId: safeState.lastTick?.tickId ?? null,
    lastTickStatus: safeState.lastTick?.status ?? null,
    activeTick: safeState.activeTick,
    tickCount: safeState.stats.tickCount,
    failedTickCount: safeState.stats.failedTickCount,
    skippedTickCount: safeState.stats.skippedTickCount,
    completedTickCount: safeState.stats.completedTickCount,
    idleTickCount: safeState.stats.idleTickCount,
    systemCallProcessedCount: safeState.stats.systemCallProcessedCount,
    systemCallFailedCount: safeState.stats.systemCallFailedCount,
    lock: safeState.lock,
  });
}

export function buildServiceHealthSummary({
  heartbeat = null,
  state = null,
  now = defaultNow,
} = {}) {
  const safeHeartbeat = heartbeat ? assertOpenMasOsServiceHeartbeat(heartbeat) : null;
  const safeState = state ? assertOpenMasOsServiceState(state) : null;
  const nowFn = normalizeNow(now);
  const observedAt = nowFn();
  const heartbeatAgeMs = safeHeartbeat
    ? Math.max(0, Date.parse(observedAt) - Date.parse(safeHeartbeat.lastHeartbeatAt))
    : null;
  const heartbeatStale = safeHeartbeat
    ? heartbeatAgeMs >= safeHeartbeat.staleAfterMs
    : true;
  const status = safeState?.status ?? safeHeartbeat?.status ?? 'stopped';
  const activeTick = safeState?.activeTick ?? safeHeartbeat?.activeTick ?? null;
  const activeTickAgeMs = activeTick
    ? Math.max(0, Date.parse(observedAt) - Date.parse(activeTick.startedAt))
    : null;
  const heartbeatPresent = safeHeartbeat !== null;
  const statePresent = safeState !== null;
  const activeAsyncExecutionCount = status === 'stopped'
    ? 0
    : safeState?.lastTick?.asyncActiveExecutionCount ?? 0;
  const asyncMaxConcurrentExecutions = status === 'stopped'
    ? 0
    : safeState?.lastTick?.asyncMaxConcurrentExecutions ?? 0;

  return assertSafeOsSerializableValue({
    kind: OPENMAS_OS_SERVICE_HEALTH_SUMMARY_KIND,
    version: OPENMAS_OS_SERVICE_HEALTH_VERSION,
    serviceId: safeState?.serviceId ?? safeHeartbeat?.serviceId ?? null,
    status,
    observedAt,
    heartbeatPresent,
    statePresent,
    heartbeatAgeMs,
    heartbeatStale,
    lastTickStatus: safeHeartbeat?.lastTickStatus ?? safeState?.lastTick?.status ?? null,
    activeTick,
    activeTickAgeMs,
    tickCount: safeHeartbeat?.tickCount ?? safeState?.stats.tickCount ?? 0,
    failedTickCount: safeHeartbeat?.failedTickCount ?? safeState?.stats.failedTickCount ?? 0,
    skippedTickCount: safeHeartbeat?.skippedTickCount ?? safeState?.stats.skippedTickCount ?? 0,
    activeAsyncExecutionCount,
    asyncMaxConcurrentExecutions,
    systemCallProcessedCount: safeHeartbeat?.systemCallProcessedCount
      ?? safeState?.stats.systemCallProcessedCount
      ?? 0,
    systemCallFailedCount: safeHeartbeat?.systemCallFailedCount
      ?? safeState?.stats.systemCallFailedCount
      ?? 0,
    nextRecommendedAction: resolveServiceHealthNextRecommendedAction({
      status,
      heartbeatStale,
      heartbeatPresent,
      statePresent,
    }),
  }, 'OpenMAS OS service health summary');
}

export async function writeServiceState({
  projectRootPath = null,
  osRootPath = null,
  state,
} = {}) {
  const paths = resolveServiceHealthPaths({ projectRootPath, osRootPath });
  const safeState = assertOpenMasOsServiceState({
    ...state,
    osRootPath: state?.osRootPath ?? paths.osRootPath,
  });

  await publishMutableJsonSnapshot({
    filePath: paths.statePath,
    data: safeState,
  });

  return {
    state: safeState,
    statePath: paths.statePath,
  };
}

export async function readServiceState(options = {}) {
  const paths = resolveServiceHealthPaths(options);
  const state = await readJson(paths.statePath, 'OpenMAS OS service state');

  return state === null ? null : assertOpenMasOsServiceState(state);
}

export async function writeServiceHeartbeat({
  projectRootPath = null,
  osRootPath = null,
  heartbeat,
} = {}) {
  const paths = resolveServiceHealthPaths({ projectRootPath, osRootPath });
  const safeHeartbeat = assertOpenMasOsServiceHeartbeat({
    ...heartbeat,
    osRootPath: heartbeat?.osRootPath ?? paths.osRootPath,
  });

  await publishMutableJsonSnapshot({
    filePath: paths.heartbeatPath,
    data: safeHeartbeat,
  });

  return {
    heartbeat: safeHeartbeat,
    heartbeatPath: paths.heartbeatPath,
  };
}

export async function readServiceHeartbeat(options = {}) {
  const paths = resolveServiceHealthPaths(options);
  const heartbeat = await readJson(paths.heartbeatPath, 'OpenMAS OS service heartbeat');

  return heartbeat === null ? null : assertOpenMasOsServiceHeartbeat(heartbeat);
}

export async function writeServiceHealthSnapshot({
  projectRootPath = null,
  osRootPath = null,
  state,
  lastHeartbeatAt = null,
} = {}) {
  const stateResult = await writeServiceState({
    projectRootPath,
    osRootPath,
    state,
  });
  const heartbeat = buildServiceHeartbeat({
    state: stateResult.state,
    lastHeartbeatAt,
  });
  const heartbeatResult = await writeServiceHeartbeat({
    projectRootPath,
    osRootPath,
    heartbeat,
  });

  return {
    state: stateResult.state,
    heartbeat: heartbeatResult.heartbeat,
    statePath: stateResult.statePath,
    heartbeatPath: heartbeatResult.heartbeatPath,
  };
}

export {
  OPENMAS_OS_SERVICE_HEALTH_SUMMARY_KIND,
  OPENMAS_OS_SERVICE_HEALTH_VERSION,
  OPENMAS_OS_SERVICE_HEARTBEAT_KIND,
  OPENMAS_OS_SERVICE_STATE_KIND,
  OPENMAS_OS_SERVICE_STATUSES,
  SERVICE_HEALTH_DIRECTORY_NAME,
  SERVICE_HEARTBEAT_FILE_NAME,
  SERVICE_STATE_FILE_NAME,
  assertOpenMasOsServiceHeartbeat,
  assertOpenMasOsServiceState,
  resolveServiceHealthPaths,
};
