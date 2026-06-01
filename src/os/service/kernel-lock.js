import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  mkdir,
  open,
  readFile,
} from 'node:fs/promises';
import {
  OPENMAS_OS_KINDS,
  OPENMAS_OS_SCHEMA_VERSION,
  assertSafeOsSerializableValue,
} from '../../contracts/os/openmas-os-runtime-contract.js';
import { createLocalRuntimeAdapter } from '../adapters/local-runtime-adapter.js';
import {
  publishMutableJsonSnapshot,
  removeFileWithTransientRetry,
} from './mutable-json-publication.js';

const OPENMAS_OS_KERNEL_LOCK_KIND = 'openmas_os_kernel_lock';
const OPENMAS_OS_KERNEL_LOCK_RECOVERY_GUARD_KIND = 'openmas_os_kernel_lock_recovery_guard';
const OPENMAS_OS_KERNEL_LOCK_VERSION = 1;
const DEFAULT_KERNEL_LOCK_STALE_AFTER_MS = 30000;
const KERNEL_LOCK_FILE_NAME = 'kernel-lock.json';
const KERNEL_LOCK_SERVICE_DIRECTORY_NAME = 'service';
const SAFE_SERVICE_ID_PATTERN = /^[a-zA-Z0-9._-]+$/u;

const OPENMAS_OS_KERNEL_LOCK_CLAIM_STATUSES = Object.freeze([
  'claimed',
  'recovered',
  'refused',
]);

const OPENMAS_OS_KERNEL_LOCK_STATUSES = Object.freeze([
  'active',
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

function isAlreadyExistsError(error) {
  return error && error.code === 'EEXIST';
}

function normalizeNow(now) {
  if (now === undefined || now === null) {
    return defaultNow;
  }

  if (typeof now !== 'function') {
    throw new Error('OpenMAS OS kernel lock now must be a function when provided.');
  }

  return now;
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

function normalizeSafeServiceId(serviceId, description = 'OpenMAS OS kernel lock serviceId') {
  if (!isNonEmptyString(serviceId)) {
    throw new Error(`${description} must be a non-empty string.`);
  }

  const normalizedServiceId = serviceId.trim();

  if (!SAFE_SERVICE_ID_PATTERN.test(normalizedServiceId)) {
    throw new Error(`${description} contains unsafe characters: ${normalizedServiceId}`);
  }

  return normalizedServiceId;
}

function normalizeNullableSafeServiceId(serviceId, description) {
  if (serviceId === undefined || serviceId === null || serviceId === '') {
    return null;
  }

  return normalizeSafeServiceId(serviceId, description);
}

function normalizeNonEmptyString(value, description) {
  if (!isNonEmptyString(value)) {
    throw new Error(`${description} must be a non-empty string.`);
  }

  return value.trim();
}

function normalizeIsoDateString(value, description) {
  const normalizedValue = normalizeNonEmptyString(value, description);

  if (Number.isNaN(Date.parse(normalizedValue))) {
    throw new Error(`${description} must be a valid date string.`);
  }

  return normalizedValue;
}

function normalizeHostname(hostname) {
  const normalizedHostname = hostname === undefined || hostname === null || hostname === ''
    ? os.hostname()
    : normalizeNonEmptyString(hostname, 'OpenMAS OS kernel lock hostname');

  return normalizedHostname.slice(0, 255);
}

function normalizePid(pid) {
  const effectivePid = pid === undefined || pid === null
    ? process.pid
    : pid;

  return normalizePositiveInteger(effectivePid, 'OpenMAS OS kernel lock pid');
}

function normalizeLockId(lockId) {
  if (lockId === undefined || lockId === null || lockId === '') {
    return `kernel_lock_${randomUUID()}`;
  }

  return normalizeSafeServiceId(lockId, 'OpenMAS OS kernel lock lockId');
}

function normalizeLockStatus(status) {
  const normalizedStatus = normalizeNonEmptyString(status, 'OpenMAS OS kernel lock status');

  if (!OPENMAS_OS_KERNEL_LOCK_STATUSES.includes(normalizedStatus)) {
    throw new Error(`OpenMAS OS kernel lock status is invalid: ${normalizedStatus}`);
  }

  return normalizedStatus;
}

function resolveOsRootPath({ projectRootPath = null, osRootPath = null } = {}) {
  if (isNonEmptyString(osRootPath)) {
    return osRootPath.trim();
  }

  if (isNonEmptyString(projectRootPath)) {
    return path.join(projectRootPath.trim(), 'instance', 'os');
  }

  throw new Error('OpenMAS OS kernel lock requires projectRootPath or osRootPath.');
}

function resolveKernelLockPaths(options = {}) {
  const osRootPath = resolveOsRootPath(options);
  const serviceRootPath = path.join(osRootPath, KERNEL_LOCK_SERVICE_DIRECTORY_NAME);
  const lockFilePath = path.join(serviceRootPath, KERNEL_LOCK_FILE_NAME);
  const recoveryFilePath = path.join(serviceRootPath, `${KERNEL_LOCK_FILE_NAME}.recovery`);

  return {
    osRootPath,
    serviceRootPath,
    lockFilePath,
    recoveryFilePath,
  };
}

function createExpiresAt(refreshedAt, staleAfterMs) {
  return new Date(Date.parse(refreshedAt) + staleAfterMs).toISOString();
}

function assertOpenMasOsKernelLock(lock) {
  if (!isPlainObject(lock)) {
    throw new Error('OpenMAS OS kernel lock must be an object.');
  }

  const safeLock = assertSafeOsSerializableValue(lock, 'OpenMAS OS kernel lock');
  const normalizedLock = {
    kind: safeLock.kind ?? OPENMAS_OS_KERNEL_LOCK_KIND,
    version: safeLock.version ?? OPENMAS_OS_KERNEL_LOCK_VERSION,
    status: normalizeLockStatus(safeLock.status ?? 'active'),
    lockId: normalizeLockId(safeLock.lockId),
    serviceId: normalizeSafeServiceId(safeLock.serviceId),
    pid: normalizePid(safeLock.pid),
    hostname: normalizeHostname(safeLock.hostname),
    projectRootPath: safeLock.projectRootPath === undefined || safeLock.projectRootPath === null
      ? null
      : normalizeNonEmptyString(safeLock.projectRootPath, 'OpenMAS OS kernel lock projectRootPath'),
    osRootPath: safeLock.osRootPath === undefined || safeLock.osRootPath === null
      ? null
      : normalizeNonEmptyString(safeLock.osRootPath, 'OpenMAS OS kernel lock osRootPath'),
    claimedAt: normalizeIsoDateString(safeLock.claimedAt, 'OpenMAS OS kernel lock claimedAt'),
    refreshedAt: normalizeIsoDateString(safeLock.refreshedAt, 'OpenMAS OS kernel lock refreshedAt'),
    staleAfterMs: normalizePositiveInteger(
      safeLock.staleAfterMs,
      'OpenMAS OS kernel lock staleAfterMs',
    ),
    expiresAt: normalizeIsoDateString(safeLock.expiresAt, 'OpenMAS OS kernel lock expiresAt'),
    refreshCount: safeLock.refreshCount === undefined || safeLock.refreshCount === null
      ? 0
      : normalizeNonNegativeInteger(safeLock.refreshCount, 'OpenMAS OS kernel lock refreshCount'),
    recoveredFromLockId: normalizeNullableSafeServiceId(
      safeLock.recoveredFromLockId,
      'OpenMAS OS kernel lock recoveredFromLockId',
    ),
    recoveredAt: safeLock.recoveredAt === undefined || safeLock.recoveredAt === null
      ? null
      : normalizeIsoDateString(safeLock.recoveredAt, 'OpenMAS OS kernel lock recoveredAt'),
  };

  if (normalizedLock.kind !== OPENMAS_OS_KERNEL_LOCK_KIND) {
    throw new Error(`OpenMAS OS kernel lock must include kind "${OPENMAS_OS_KERNEL_LOCK_KIND}".`);
  }

  if (normalizedLock.version !== OPENMAS_OS_KERNEL_LOCK_VERSION) {
    throw new Error(`OpenMAS OS kernel lock must include version ${OPENMAS_OS_KERNEL_LOCK_VERSION}.`);
  }

  return assertSafeOsSerializableValue(normalizedLock, 'OpenMAS OS kernel lock');
}

function assertKernelLockRecoveryGuard(guard) {
  if (!isPlainObject(guard)) {
    throw new Error('OpenMAS OS kernel lock recovery guard must be an object.');
  }

  const safeGuard = assertSafeOsSerializableValue(guard, 'OpenMAS OS kernel lock recovery guard');
  const normalizedGuard = {
    kind: safeGuard.kind ?? OPENMAS_OS_KERNEL_LOCK_RECOVERY_GUARD_KIND,
    version: safeGuard.version ?? OPENMAS_OS_KERNEL_LOCK_VERSION,
    recoveryId: normalizeSafeServiceId(
      safeGuard.recoveryId,
      'OpenMAS OS kernel lock recovery guard recoveryId',
    ),
    lockId: normalizeSafeServiceId(
      safeGuard.lockId,
      'OpenMAS OS kernel lock recovery guard lockId',
    ),
    serviceId: normalizeSafeServiceId(
      safeGuard.serviceId,
      'OpenMAS OS kernel lock recovery guard serviceId',
    ),
    startedAt: normalizeIsoDateString(
      safeGuard.startedAt,
      'OpenMAS OS kernel lock recovery guard startedAt',
    ),
  };

  if (normalizedGuard.kind !== OPENMAS_OS_KERNEL_LOCK_RECOVERY_GUARD_KIND) {
    throw new Error(
      `OpenMAS OS kernel lock recovery guard must include kind "${OPENMAS_OS_KERNEL_LOCK_RECOVERY_GUARD_KIND}".`,
    );
  }

  if (normalizedGuard.version !== OPENMAS_OS_KERNEL_LOCK_VERSION) {
    throw new Error(`OpenMAS OS kernel lock recovery guard must include version ${OPENMAS_OS_KERNEL_LOCK_VERSION}.`);
  }

  return assertSafeOsSerializableValue(normalizedGuard, 'OpenMAS OS kernel lock recovery guard');
}

function createKernelLock({
  serviceId,
  now,
  staleAfterMs,
  projectRootPath,
  osRootPath,
  pid,
  hostname,
  recoveredFromLockId = null,
  recoveredAt = null,
}) {
  const refreshedAt = now();
  const lock = {
    kind: OPENMAS_OS_KERNEL_LOCK_KIND,
    version: OPENMAS_OS_KERNEL_LOCK_VERSION,
    status: 'active',
    lockId: `kernel_lock_${randomUUID()}`,
    serviceId: normalizeSafeServiceId(serviceId),
    pid: normalizePid(pid),
    hostname: normalizeHostname(hostname),
    projectRootPath: isNonEmptyString(projectRootPath) ? projectRootPath.trim() : null,
    osRootPath: isNonEmptyString(osRootPath) ? osRootPath.trim() : null,
    claimedAt: refreshedAt,
    refreshedAt,
    staleAfterMs,
    expiresAt: createExpiresAt(refreshedAt, staleAfterMs),
    refreshCount: 0,
    recoveredFromLockId,
    recoveredAt,
  };

  return assertOpenMasOsKernelLock(lock);
}

function createKernelLockRecoveryGuard({
  existingLock,
  newLock,
  now,
}) {
  return assertKernelLockRecoveryGuard({
    kind: OPENMAS_OS_KERNEL_LOCK_RECOVERY_GUARD_KIND,
    version: OPENMAS_OS_KERNEL_LOCK_VERSION,
    recoveryId: `kernel_lock_recovery_${randomUUID()}`,
    lockId: existingLock.lockId,
    serviceId: newLock.serviceId,
    startedAt: now,
  });
}

async function ensureDirectory(directoryPath) {
  await mkdir(directoryPath, { recursive: true });
  return directoryPath;
}

async function writeJsonExclusive(filePath, data) {
  await ensureDirectory(path.dirname(filePath));
  const fileHandle = await open(filePath, 'wx');

  try {
    await fileHandle.writeFile(`${JSON.stringify(data, null, 2)}\n`, 'utf8');
  } finally {
    await fileHandle.close();
  }

  return filePath;
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

async function readKernelLockRecoveryGuard(recoveryFilePath) {
  const guard = await readJson(recoveryFilePath, 'OpenMAS OS kernel lock recovery guard');

  if (guard === null) {
    return null;
  }

  return assertKernelLockRecoveryGuard(guard);
}

function isKernelLockRecoveryGuardStale({
  guard,
  existingLock,
  now,
}) {
  return resolveLockFreshness({
    refreshedAt: guard.startedAt,
    staleAfterMs: existingLock.staleAfterMs,
    expiresAt: createExpiresAt(guard.startedAt, existingLock.staleAfterMs),
  }, now).stale;
}

function resolveLockFreshness(lock, now) {
  const nowMs = Date.parse(now);
  const refreshedAtMs = Date.parse(lock.refreshedAt);
  const ageMs = Math.max(0, nowMs - refreshedAtMs);
  const stale = ageMs >= lock.staleAfterMs;

  return {
    stale,
    ageMs,
    expiresAt: lock.expiresAt,
  };
}

function createSystemActor() {
  return {
    type: 'system',
    id: 'openmas-os-service',
  };
}

function createEventId() {
  return `event_${randomUUID()}`;
}

function createAdapter({ adapter = null, projectRootPath = null, osRootPath = null } = {}) {
  return adapter ?? createLocalRuntimeAdapter({ projectRootPath, osRootPath });
}

async function appendKernelLockEvent({
  adapter = null,
  projectRootPath = null,
  osRootPath = null,
  eventType,
  occurredAt,
  lock,
  previousLock = null,
  reason = null,
  audit = true,
}) {
  if (!audit) {
    return null;
  }

  const runtimeAdapter = createAdapter({ adapter, projectRootPath, osRootPath });
  const payload = assertSafeOsSerializableValue({
    lockId: lock?.lockId ?? null,
    serviceId: lock?.serviceId ?? null,
    pid: lock?.pid ?? null,
    hostname: lock?.hostname ?? null,
    refreshedAt: lock?.refreshedAt ?? null,
    staleAfterMs: lock?.staleAfterMs ?? null,
    previousLockId: previousLock?.lockId ?? null,
    previousServiceId: previousLock?.serviceId ?? null,
    reason,
  }, `OpenMAS OS kernel lock Event ${eventType} payload`);

  return runtimeAdapter.appendEvent({
    kind: OPENMAS_OS_KINDS.event,
    schemaVersion: OPENMAS_OS_SCHEMA_VERSION,
    eventId: createEventId(),
    eventType,
    source: createSystemActor(),
    targetRef: null,
    jobId: null,
    processId: null,
    threadId: null,
    occurredAt,
    payload,
  });
}

function createClaimResult({
  status,
  lock,
  lockFilePath,
  previousLock = null,
  freshness = null,
  reason = null,
}) {
  if (!OPENMAS_OS_KERNEL_LOCK_CLAIM_STATUSES.includes(status)) {
    throw new Error(`OpenMAS OS kernel lock claim status is invalid: ${status}`);
  }

  return assertSafeOsSerializableValue({
    kind: 'openmas_os_kernel_lock_claim_result',
    version: 1,
    status,
    claimed: status === 'claimed' || status === 'recovered',
    reason,
    lock,
    previousLock,
    freshness,
    lockFilePath,
  }, 'OpenMAS OS kernel lock claim result');
}

function assertSameLockOwner({ currentLock, serviceId, lockId = null, operation }) {
  const safeServiceId = normalizeSafeServiceId(serviceId);
  const safeLockId = normalizeNullableSafeServiceId(
    lockId,
    `OpenMAS OS kernel lock ${operation} lockId`,
  );

  if (currentLock.serviceId !== safeServiceId) {
    return false;
  }

  return safeLockId === null || currentLock.lockId === safeLockId;
}

async function claimFreshKernelLock({
  lockFilePath,
  lock,
}) {
  await writeJsonExclusive(lockFilePath, lock);
  return lock;
}

async function replaceStaleKernelLock({
  lockFilePath,
  recoveryFilePath,
  existingLock,
  newLock,
  now,
}) {
  const recoveryGuard = createKernelLockRecoveryGuard({
    existingLock,
    newLock,
    now,
  });

  try {
    await writeJsonExclusive(recoveryFilePath, recoveryGuard);
  } catch (error) {
    if (!isAlreadyExistsError(error)) {
      throw error;
    }

    const existingRecoveryGuard = await readKernelLockRecoveryGuard(recoveryFilePath);

    if (
      existingRecoveryGuard !== null
      && !isKernelLockRecoveryGuardStale({
        guard: existingRecoveryGuard,
        existingLock,
        now,
      })
    ) {
      return {
        lock: null,
        reason: 'stale_lock_recovery_in_progress',
      };
    }

    await removeFileWithTransientRetry({
      filePath: recoveryFilePath,
      ignoreNotFound: true,
    });

    try {
      await writeJsonExclusive(recoveryFilePath, recoveryGuard);
    } catch (retryError) {
      if (isAlreadyExistsError(retryError)) {
        return {
          lock: null,
          reason: 'stale_lock_recovery_in_progress',
        };
      }

      throw retryError;
    }
  }

  try {
    const latestLock = await readKernelLock({ lockFilePath });

    if (latestLock === null) {
      await claimFreshKernelLock({ lockFilePath, lock: newLock });
      return {
        lock: newLock,
        reason: null,
      };
    }

    const latestFreshness = resolveLockFreshness(latestLock, now);

    if (latestLock.lockId !== existingLock.lockId || !latestFreshness.stale) {
      return {
        lock: null,
        reason: 'lock_changed_during_recovery',
      };
    }

    const activeRecoveryGuard = await readKernelLockRecoveryGuard(recoveryFilePath);

    if (activeRecoveryGuard?.recoveryId !== recoveryGuard.recoveryId) {
      return {
        lock: null,
        reason: 'stale_lock_recovery_in_progress',
      };
    }

    await publishMutableJsonSnapshot({
      filePath: lockFilePath,
      data: newLock,
    });
    return {
      lock: newLock,
      reason: null,
    };
  } finally {
    const activeRecoveryGuard = await readKernelLockRecoveryGuard(recoveryFilePath);

    if (activeRecoveryGuard?.recoveryId === recoveryGuard.recoveryId) {
      await removeFileWithTransientRetry({
        filePath: recoveryFilePath,
        ignoreNotFound: true,
      });
    }
  }
}

export async function readKernelLock(options = {}) {
  const lockFilePath = options.lockFilePath ?? resolveKernelLockPaths(options).lockFilePath;
  const lock = await readJson(lockFilePath, 'OpenMAS OS kernel lock');

  if (lock === null) {
    return null;
  }

  return assertOpenMasOsKernelLock(lock);
}

export async function claimKernelLock({
  serviceId,
  projectRootPath = null,
  osRootPath = null,
  lockFilePath = null,
  recoveryFilePath = null,
  staleAfterMs = DEFAULT_KERNEL_LOCK_STALE_AFTER_MS,
  now = defaultNow,
  pid = null,
  hostname = null,
  adapter = null,
  audit = true,
} = {}) {
  const nowFn = normalizeNow(now);
  const safeStaleAfterMs = normalizePositiveInteger(
    staleAfterMs,
    'OpenMAS OS kernel lock staleAfterMs',
  );
  const resolvedPaths = lockFilePath
    ? {
      osRootPath: isNonEmptyString(osRootPath) ? osRootPath.trim() : null,
      serviceRootPath: path.dirname(lockFilePath),
      lockFilePath,
      recoveryFilePath: recoveryFilePath ?? `${lockFilePath}.recovery`,
    }
    : resolveKernelLockPaths({ projectRootPath, osRootPath });
  const lock = createKernelLock({
    serviceId,
    now: nowFn,
    staleAfterMs: safeStaleAfterMs,
    projectRootPath,
    osRootPath: resolvedPaths.osRootPath,
    pid,
    hostname,
  });

  try {
    await claimFreshKernelLock({
      lockFilePath: resolvedPaths.lockFilePath,
      lock,
    });
    try {
      await appendKernelLockEvent({
        adapter,
        projectRootPath,
        osRootPath: resolvedPaths.osRootPath,
        eventType: 'os.service.lock.claimed',
        occurredAt: lock.claimedAt,
        lock,
        audit,
      });
    } catch (error) {
      await releaseKernelLock({
        serviceId: lock.serviceId,
        lockId: lock.lockId,
        lockFilePath: resolvedPaths.lockFilePath,
        now: nowFn,
        audit: false,
      });
      throw error;
    }

    return createClaimResult({
      status: 'claimed',
      lock,
      lockFilePath: resolvedPaths.lockFilePath,
    });
  } catch (error) {
    if (!isAlreadyExistsError(error)) {
      throw error;
    }
  }

  const existingLock = await readKernelLock({ lockFilePath: resolvedPaths.lockFilePath });
  const freshness = resolveLockFreshness(existingLock, nowFn());

  if (!freshness.stale) {
    await appendKernelLockEvent({
      adapter,
      projectRootPath,
      osRootPath: resolvedPaths.osRootPath,
      eventType: 'os.service.lock.refused',
      occurredAt: nowFn(),
      lock: existingLock,
      reason: 'fresh_lock_exists',
      audit,
    });

    return createClaimResult({
      status: 'refused',
      lock: existingLock,
      previousLock: existingLock,
      freshness,
      lockFilePath: resolvedPaths.lockFilePath,
      reason: 'fresh_lock_exists',
    });
  }

  const recoveredLock = createKernelLock({
    serviceId,
    now: nowFn,
    staleAfterMs: safeStaleAfterMs,
    projectRootPath,
    osRootPath: resolvedPaths.osRootPath,
    pid,
    hostname,
    recoveredFromLockId: existingLock.lockId,
    recoveredAt: nowFn(),
  });
  const replacement = await replaceStaleKernelLock({
    lockFilePath: resolvedPaths.lockFilePath,
    recoveryFilePath: resolvedPaths.recoveryFilePath,
    existingLock,
    newLock: recoveredLock,
    now: recoveredLock.claimedAt,
  });

  if (replacement.lock === null) {
    const latestLock = await readKernelLock({ lockFilePath: resolvedPaths.lockFilePath });

    return createClaimResult({
      status: 'refused',
      lock: latestLock,
      previousLock: latestLock,
      freshness: latestLock ? resolveLockFreshness(latestLock, nowFn()) : null,
      lockFilePath: resolvedPaths.lockFilePath,
      reason: replacement.reason,
    });
  }

  try {
    await appendKernelLockEvent({
      adapter,
      projectRootPath,
      osRootPath: resolvedPaths.osRootPath,
      eventType: 'os.service.lock.recovered',
      occurredAt: recoveredLock.claimedAt,
      lock: recoveredLock,
      previousLock: existingLock,
      reason: 'stale_lock_recovered',
      audit,
    });
  } catch (error) {
    await releaseKernelLock({
      serviceId: recoveredLock.serviceId,
      lockId: recoveredLock.lockId,
      lockFilePath: resolvedPaths.lockFilePath,
      now: nowFn,
      audit: false,
    });
    throw error;
  }

  return createClaimResult({
    status: 'recovered',
    lock: recoveredLock,
    previousLock: existingLock,
    freshness,
    lockFilePath: resolvedPaths.lockFilePath,
    reason: 'stale_lock_recovered',
  });
}

export async function refreshKernelLock({
  serviceId,
  lockId = null,
  projectRootPath = null,
  osRootPath = null,
  lockFilePath = null,
  now = defaultNow,
  adapter = null,
  audit = true,
} = {}) {
  const nowFn = normalizeNow(now);
  const resolvedPaths = lockFilePath
    ? {
      osRootPath: isNonEmptyString(osRootPath) ? osRootPath.trim() : null,
      lockFilePath,
    }
    : resolveKernelLockPaths({ projectRootPath, osRootPath });
  const currentLock = await readKernelLock({ lockFilePath: resolvedPaths.lockFilePath });

  if (currentLock === null) {
    return assertSafeOsSerializableValue({
      kind: 'openmas_os_kernel_lock_refresh_result',
      version: 1,
      status: 'missing',
      refreshed: false,
      reason: 'lock_missing',
      lock: null,
      lockFilePath: resolvedPaths.lockFilePath,
    }, 'OpenMAS OS kernel lock refresh result');
  }

  if (!assertSameLockOwner({
    currentLock,
    serviceId,
    lockId,
    operation: 'refresh',
  })) {
    return assertSafeOsSerializableValue({
      kind: 'openmas_os_kernel_lock_refresh_result',
      version: 1,
      status: 'refused',
      refreshed: false,
      reason: 'lock_owned_by_another_service',
      lock: currentLock,
      lockFilePath: resolvedPaths.lockFilePath,
    }, 'OpenMAS OS kernel lock refresh result');
  }

  const refreshedAt = nowFn();
  const refreshedLock = assertOpenMasOsKernelLock({
    ...currentLock,
    refreshedAt,
    expiresAt: createExpiresAt(refreshedAt, currentLock.staleAfterMs),
    refreshCount: currentLock.refreshCount + 1,
  });

  await publishMutableJsonSnapshot({
    filePath: resolvedPaths.lockFilePath,
    data: refreshedLock,
  });
  await appendKernelLockEvent({
    adapter,
    projectRootPath,
    osRootPath: resolvedPaths.osRootPath,
    eventType: 'os.service.lock.refreshed',
    occurredAt: refreshedAt,
    lock: refreshedLock,
    audit,
  });

  return assertSafeOsSerializableValue({
    kind: 'openmas_os_kernel_lock_refresh_result',
    version: 1,
    status: 'refreshed',
    refreshed: true,
    reason: null,
    lock: refreshedLock,
    lockFilePath: resolvedPaths.lockFilePath,
  }, 'OpenMAS OS kernel lock refresh result');
}

export async function releaseKernelLock({
  serviceId,
  lockId = null,
  projectRootPath = null,
  osRootPath = null,
  lockFilePath = null,
  now = defaultNow,
  adapter = null,
  audit = true,
} = {}) {
  const nowFn = normalizeNow(now);
  const resolvedPaths = lockFilePath
    ? {
      osRootPath: isNonEmptyString(osRootPath) ? osRootPath.trim() : null,
      lockFilePath,
    }
    : resolveKernelLockPaths({ projectRootPath, osRootPath });
  const currentLock = await readKernelLock({ lockFilePath: resolvedPaths.lockFilePath });

  if (currentLock === null) {
    return assertSafeOsSerializableValue({
      kind: 'openmas_os_kernel_lock_release_result',
      version: 1,
      status: 'missing',
      released: false,
      reason: 'lock_missing',
      lock: null,
      lockFilePath: resolvedPaths.lockFilePath,
    }, 'OpenMAS OS kernel lock release result');
  }

  if (!assertSameLockOwner({
    currentLock,
    serviceId,
    lockId,
    operation: 'release',
  })) {
    return assertSafeOsSerializableValue({
      kind: 'openmas_os_kernel_lock_release_result',
      version: 1,
      status: 'ignored',
      released: false,
      reason: 'lock_owned_by_another_service',
      lock: currentLock,
      lockFilePath: resolvedPaths.lockFilePath,
    }, 'OpenMAS OS kernel lock release result');
  }

  await removeFileWithTransientRetry({
    filePath: resolvedPaths.lockFilePath,
  });
  await appendKernelLockEvent({
    adapter,
    projectRootPath,
    osRootPath: resolvedPaths.osRootPath,
    eventType: 'os.service.lock.released',
    occurredAt: nowFn(),
    lock: currentLock,
    audit,
  });

  return assertSafeOsSerializableValue({
    kind: 'openmas_os_kernel_lock_release_result',
    version: 1,
    status: 'released',
    released: true,
    reason: null,
    lock: currentLock,
    lockFilePath: resolvedPaths.lockFilePath,
  }, 'OpenMAS OS kernel lock release result');
}

export function isKernelLockStale({
  lock,
  now = defaultNow,
} = {}) {
  const safeLock = assertOpenMasOsKernelLock(lock);
  const nowFn = normalizeNow(now);

  return resolveLockFreshness(safeLock, nowFn());
}

export {
  DEFAULT_KERNEL_LOCK_STALE_AFTER_MS,
  KERNEL_LOCK_FILE_NAME,
  KERNEL_LOCK_SERVICE_DIRECTORY_NAME,
  OPENMAS_OS_KERNEL_LOCK_KIND,
  OPENMAS_OS_KERNEL_LOCK_STATUSES,
  OPENMAS_OS_KERNEL_LOCK_VERSION,
  assertOpenMasOsKernelLock,
  resolveKernelLockPaths,
};
