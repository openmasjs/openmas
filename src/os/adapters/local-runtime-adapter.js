import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  appendFile,
  access,
  link,
  mkdir,
  readFile,
  readdir,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises';
import {
  OPENMAS_OS_SCHEMA_VERSION,
  assertOpenMasOsEvent,
  assertOpenMasOsJob,
  assertOpenMasOsProcess,
  assertOpenMasOsThread,
  assertSafeOsSerializableValue,
} from '../../contracts/os/openmas-os-runtime-contract.js';
import {
  assertOpenMasOsResultRecord,
} from '../../contracts/os/openmas-os-result-record-contract.js';

const LOCAL_RUNTIME_TIMER_KIND = 'openmas_os_timer';
const LOCAL_RUNTIME_SCHEDULER_QUEUE_STATE_KIND = 'openmas_os_scheduler_queue_state';
const LOCAL_RUNTIME_SCHEDULER_QUEUE_STATE_VERSION = 1;

const LOCAL_RUNTIME_TIMER_STATUSES = new Set([
  'scheduled',
  'cancelled',
  'fired',
]);

const LOCAL_RUNTIME_CONVERSATION_RUN_KIND = 'openmas_os_conversation_run';

const LOCAL_RUNTIME_CONVERSATION_RUN_STATUSES = new Set([
  'created',
  'active',
  'completed',
  'failed',
  'cancelled',
]);

const LOCAL_RUNTIME_CONVERSATION_TURN_STATUSES = new Set([
  'pending',
  'ready',
  'active',
  'completed',
  'failed',
  'skipped',
]);

const LOCAL_RUNTIME_JOB_CLAIM_LOCK_KIND = 'openmas_os_job_claim_lock';
const DEFAULT_JOB_CLAIM_LOCK_STALE_AFTER_MS = 30000;
const MIN_JOB_CLAIM_LOCK_STALE_AFTER_MS = DEFAULT_JOB_CLAIM_LOCK_STALE_AFTER_MS;
const TRANSIENT_FILE_OPERATION_MAX_ATTEMPTS = 25;
const TRANSIENT_FILE_OPERATION_RETRY_DELAY_MS = 10;
const TRANSIENT_SNAPSHOT_READ_MAX_ATTEMPTS = 5;
const TRANSIENT_SNAPSHOT_READ_RETRY_DELAY_MS = 10;
const JOB_CLAIM_LOCK_ACQUIRE_MAX_ATTEMPTS = TRANSIENT_FILE_OPERATION_MAX_ATTEMPTS;
const JOB_CLAIM_LOCK_RETRY_DELAY_MS = TRANSIENT_FILE_OPERATION_RETRY_DELAY_MS;
const SAFE_LOCAL_RUNTIME_IDENTIFIER_PATTERN = /^[a-zA-Z0-9._-]+$/u;
const EVENT_LOG_DATE_PATTERN = /^(\d{4}-\d{2}-\d{2})/u;
const LOCAL_RUNTIME_SCHEDULER_QUEUE_DEFINITIONS = Object.freeze({
  jobs: Object.freeze({
    idField: 'jobId',
    statuses: new Set(['ready']),
  }),
  processes: Object.freeze({
    idField: 'processId',
    statuses: new Set(['ready', 'running', 'blocked']),
  }),
  timers: Object.freeze({
    idField: 'timerId',
    statuses: new Set(['scheduled']),
  }),
});

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function assertPlainObject(value, description) {
  if (!isPlainObject(value)) {
    throw new Error(`${description} must be an object.`);
  }

  return value;
}

function assertNonEmptyString(value, description) {
  if (!isNonEmptyString(value)) {
    throw new Error(`${description} must be a non-empty string.`);
  }

  return value.trim();
}

function assertNullableString(value, description) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  return assertNonEmptyString(value, description);
}

function assertSafeIdentifier(value, description) {
  const normalizedValue = assertNonEmptyString(value, description);

  if (!SAFE_LOCAL_RUNTIME_IDENTIFIER_PATTERN.test(normalizedValue)) {
    throw new Error(`${description} contains unsafe characters: ${normalizedValue}`);
  }

  return normalizedValue;
}

function assertNullableSafeIdentifier(value, description) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  return assertSafeIdentifier(value, description);
}

function assertSchemaVersion(value, description) {
  if (!Number.isInteger(value) || value < OPENMAS_OS_SCHEMA_VERSION) {
    throw new Error(`${description} must include an integer schemaVersion greater than or equal to ${OPENMAS_OS_SCHEMA_VERSION}.`);
  }

  return value;
}

function assertTimerStatus(value, description) {
  const normalizedValue = assertNonEmptyString(value, description);

  if (!LOCAL_RUNTIME_TIMER_STATUSES.has(normalizedValue)) {
    throw new Error(`${description} is invalid: ${normalizedValue}`);
  }

  return normalizedValue;
}

function assertConversationRunStatus(value, description) {
  const normalizedValue = assertNonEmptyString(value, description);

  if (!LOCAL_RUNTIME_CONVERSATION_RUN_STATUSES.has(normalizedValue)) {
    throw new Error(`${description} is invalid: ${normalizedValue}`);
  }

  return normalizedValue;
}

function assertConversationTurnStatus(value, description) {
  const normalizedValue = assertNonEmptyString(value, description);

  if (!LOCAL_RUNTIME_CONVERSATION_TURN_STATUSES.has(normalizedValue)) {
    throw new Error(`${description} is invalid: ${normalizedValue}`);
  }

  return normalizedValue;
}

function assertPositiveInteger(value, description) {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${description} must be an integer greater than or equal to 1.`);
  }

  return value;
}

function normalizeJobClaimLockStaleAfterMs(value, description) {
  return Math.max(
    assertPositiveInteger(value, description),
    MIN_JOB_CLAIM_LOCK_STALE_AFTER_MS,
  );
}

function assertNonNegativeInteger(value, description) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${description} must be an integer greater than or equal to 0.`);
  }

  return value;
}

function isNotFoundError(error) {
  return error && error.code === 'ENOENT';
}

function isAlreadyExistsError(error) {
  return error && error.code === 'EEXIST';
}

function isTransientFileAccessError(error) {
  return error && ['EACCES', 'EBUSY', 'EPERM'].includes(error.code);
}

function isSnapshotNotFoundError(error) {
  return isNotFoundError(error) || /was not found/u.test(error.message);
}

function wait(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function resolveEventLogDate(occurredAt) {
  const match = EVENT_LOG_DATE_PATTERN.exec(occurredAt);
  return match ? match[1] : 'undated';
}

function matchesFilter(record, filter = {}) {
  for (const [key, expectedValue] of Object.entries(filter)) {
    if (expectedValue === undefined || expectedValue === null) {
      continue;
    }

    const actualValue = record[key];

    if (Array.isArray(expectedValue)) {
      if (!expectedValue.includes(actualValue)) {
        return false;
      }
    } else if (actualValue !== expectedValue) {
      return false;
    }
  }

  return true;
}

async function ensureDirectory(directoryPath) {
  await mkdir(directoryPath, { recursive: true });
  return directoryPath;
}

async function atomicWriteJson(filePath, data) {
  await ensureDirectory(path.dirname(filePath));

  const temporaryPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${randomUUID()}.tmp`,
  );

  await writeFile(temporaryPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');

  try {
    await renameWithRetry(temporaryPath, filePath);
  } catch (error) {
    await removeFileIfPresent(temporaryPath);
    throw error;
  }

  return filePath;
}

async function renameWithRetry(sourcePath, destinationPath) {
  for (let attempt = 0; attempt < TRANSIENT_FILE_OPERATION_MAX_ATTEMPTS; attempt += 1) {
    try {
      await rename(sourcePath, destinationPath);
      return destinationPath;
    } catch (error) {
      if (!isTransientFileAccessError(error) || attempt === TRANSIENT_FILE_OPERATION_MAX_ATTEMPTS - 1) {
        throw error;
      }

      await wait(TRANSIENT_FILE_OPERATION_RETRY_DELAY_MS * (attempt + 1));
    }
  }

  return destinationPath;
}

async function writeJsonExclusive(filePath, data) {
  await ensureDirectory(path.dirname(filePath));
  const temporaryPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${randomUUID()}.tmp`,
  );

  try {
    await writeFile(temporaryPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    await link(temporaryPath, filePath);
  } finally {
    await removeFileIfPresent(temporaryPath);
  }

  return filePath;
}

async function readJsonSnapshot(filePath, description) {
  for (let attempt = 0; attempt < TRANSIENT_SNAPSHOT_READ_MAX_ATTEMPTS; attempt += 1) {
    try {
      return JSON.parse(await readFile(filePath, 'utf8'));
    } catch (error) {
      if (
        (isNotFoundError(error) || isTransientFileAccessError(error))
        && attempt < TRANSIENT_SNAPSHOT_READ_MAX_ATTEMPTS - 1
      ) {
        await wait(TRANSIENT_SNAPSHOT_READ_RETRY_DELAY_MS * (attempt + 1));
        continue;
      }

      if (isNotFoundError(error)) {
        throw new Error(`${description} was not found.`);
      }

      if (error instanceof SyntaxError) {
        throw new Error(`${description} could not be parsed as JSON: ${error.message}`);
      }

      throw error;
    }
  }

  throw new Error(`${description} could not be read after bounded retries.`);
}

async function removeFileIfPresent(filePath) {
  try {
    await unlink(filePath);
  } catch (error) {
    if (isNotFoundError(error)) {
      return;
    }

    throw error;
  }
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch (error) {
    if (isNotFoundError(error)) {
      return false;
    }

    throw error;
  }
}

function resolveSchedulerQueueDefinition(collectionName) {
  const definition = LOCAL_RUNTIME_SCHEDULER_QUEUE_DEFINITIONS[collectionName];

  if (!definition) {
    throw new Error(`OpenMAS OS Scheduler Queue collection is invalid: ${collectionName}`);
  }

  return definition;
}

function assertSchedulerQueueStatus(collectionName, status) {
  const definition = resolveSchedulerQueueDefinition(collectionName);
  const normalizedStatus = assertNonEmptyString(
    status,
    `OpenMAS OS Scheduler Queue ${collectionName} status`,
  );

  if (!definition.statuses.has(normalizedStatus)) {
    throw new Error(`OpenMAS OS Scheduler Queue ${collectionName} status is invalid: ${normalizedStatus}`);
  }

  return normalizedStatus;
}

async function writeEmptyFileIfMissing(filePath) {
  await ensureDirectory(path.dirname(filePath));

  try {
    await writeFile(filePath, '', {
      encoding: 'utf8',
      flag: 'wx',
    });
  } catch (error) {
    if (!isAlreadyExistsError(error)) {
      throw error;
    }
  }

  return filePath;
}

async function listSchedulerQueueIds(directoryPath, description) {
  let directoryEntries;

  try {
    directoryEntries = await readdir(directoryPath, { withFileTypes: true });
  } catch (error) {
    if (isNotFoundError(error)) {
      return [];
    }

    throw error;
  }

  return directoryEntries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ref'))
    .map((entry) => assertSafeIdentifier(
      entry.name.slice(0, -'.ref'.length),
      `${description} reference id`,
    ))
    .sort();
}

function assertJobClaimLock(lock, description = 'OpenMAS OS Job claim lock') {
  assertPlainObject(lock, description);

  const normalizedLock = {
    kind: lock.kind ?? LOCAL_RUNTIME_JOB_CLAIM_LOCK_KIND,
    schemaVersion: assertSchemaVersion(lock.schemaVersion, description),
    claimId: assertSafeIdentifier(lock.claimId, `${description} claimId`),
    jobId: assertSafeIdentifier(lock.jobId, `${description} jobId`),
    ownerId: assertNullableSafeIdentifier(lock.ownerId, `${description} ownerId`),
    claimedAt: assertNonEmptyString(lock.claimedAt, `${description} claimedAt`),
    staleAfterMs: assertPositiveInteger(lock.staleAfterMs, `${description} staleAfterMs`),
  };

  if (normalizedLock.kind !== LOCAL_RUNTIME_JOB_CLAIM_LOCK_KIND) {
    throw new Error(`${description} must include kind "${LOCAL_RUNTIME_JOB_CLAIM_LOCK_KIND}".`);
  }

  return assertSafeOsSerializableValue(normalizedLock, description);
}

function createJobClaimLock({
  jobId,
  claimedAt,
  ownerId,
  staleAfterMs,
}) {
  return assertJobClaimLock({
    kind: LOCAL_RUNTIME_JOB_CLAIM_LOCK_KIND,
    schemaVersion: OPENMAS_OS_SCHEMA_VERSION,
    claimId: `job_claim_${randomUUID()}`,
    jobId,
    ownerId,
    claimedAt,
    staleAfterMs,
  });
}

function isJobClaimLockStale({
  lock,
  now,
}) {
  const nowMs = Date.parse(now);
  const claimedAtMs = Date.parse(lock.claimedAt);

  if (Number.isNaN(nowMs) || Number.isNaN(claimedAtMs)) {
    return false;
  }

  return Math.max(0, nowMs - claimedAtMs) >= lock.staleAfterMs;
}

async function readJobClaimLock(lockPath) {
  return assertJobClaimLock(await readJsonSnapshot(
    lockPath,
    `OpenMAS OS Job claim lock ${path.basename(lockPath)}`,
  ));
}

async function tryAcquireJobClaimLock({
  lockPath,
  lock,
}) {
  try {
    await writeJsonExclusive(lockPath, lock);
    return {
      acquired: true,
      lock,
      reason: null,
    };
  } catch (error) {
    if (!isAlreadyExistsError(error)) {
      throw error;
    }

    let existingLock;

    try {
      existingLock = await readJobClaimLock(lockPath);
    } catch (readError) {
      if (isSnapshotNotFoundError(readError)) {
        return {
          acquired: false,
          lock: null,
          reason: 'job_claim_retry',
        };
      }

      throw readError;
    }

    return {
      acquired: false,
      lock: existingLock,
      reason: 'job_claim_locked',
    };
  }
}

async function acquireJobClaimLock({
  lockPath,
  lock,
  now,
}) {
  const recoveryGuardPath = `${lockPath}.recovery`;

  for (let attempt = 0; attempt < JOB_CLAIM_LOCK_ACQUIRE_MAX_ATTEMPTS; attempt += 1) {
    const acquisition = await tryAcquireJobClaimLock({
      lockPath,
      lock,
    });

    if (acquisition.acquired) {
      return acquisition;
    }

    if (acquisition.reason === 'job_claim_retry') {
      await wait(JOB_CLAIM_LOCK_RETRY_DELAY_MS);
      continue;
    }

    if (!isJobClaimLockStale({
      lock: acquisition.lock,
      now,
    })) {
      return acquisition;
    }

    let guardAcquired = false;

    try {
      await writeJsonExclusive(recoveryGuardPath, lock);
      guardAcquired = true;
    } catch (error) {
      if (!isAlreadyExistsError(error)) {
        throw error;
      }

      let existingGuard = null;

      try {
        existingGuard = await readJobClaimLock(recoveryGuardPath);
      } catch (readError) {
        if (!isSnapshotNotFoundError(readError)) {
          throw readError;
        }
      }

      if (existingGuard && isJobClaimLockStale({
        lock: existingGuard,
        now,
      })) {
        await removeFileIfPresent(recoveryGuardPath);
      }
    }

    if (!guardAcquired) {
      await wait(JOB_CLAIM_LOCK_RETRY_DELAY_MS);
      continue;
    }

    try {
      let currentLock = null;

      try {
        currentLock = await readJobClaimLock(lockPath);
      } catch (error) {
        if (!isSnapshotNotFoundError(error)) {
          throw error;
        }
      }

      if (
        currentLock
        && currentLock.claimId === acquisition.lock.claimId
        && isJobClaimLockStale({
          lock: currentLock,
          now,
        })
      ) {
        await removeFileIfPresent(lockPath);
      }

      const recoveredAcquisition = await tryAcquireJobClaimLock({
        lockPath,
        lock,
      });

      if (recoveredAcquisition.acquired || recoveredAcquisition.reason === 'job_claim_locked') {
        return recoveredAcquisition;
      }
    } finally {
      await removeFileIfPresent(recoveryGuardPath);
    }

    await wait(JOB_CLAIM_LOCK_RETRY_DELAY_MS);
  }

  return tryAcquireJobClaimLock({
    lockPath,
    lock,
  });
}

async function releaseJobClaimLock({
  lockPath,
  claimId,
}) {
  let lock = null;

  try {
    lock = await readJobClaimLock(lockPath);
  } catch (error) {
    if (isSnapshotNotFoundError(error)) {
      return;
    }

    throw error;
  }

  if (lock.claimId !== claimId) {
    return;
  }

  await removeFileIfPresent(lockPath);
}

async function listJsonSnapshots(directoryPath, normalizeRecord, filter = {}) {
  let directoryEntries;

  try {
    directoryEntries = await readdir(directoryPath, { withFileTypes: true });
  } catch (error) {
    if (isNotFoundError(error)) {
      return [];
    }

    throw error;
  }

  const records = [];

  for (const directoryEntry of directoryEntries) {
    if (!directoryEntry.isFile() || !directoryEntry.name.endsWith('.json')) {
      continue;
    }

    const filePath = path.join(directoryPath, directoryEntry.name);
    const record = normalizeRecord(await readJsonSnapshot(filePath, `Local runtime snapshot ${directoryEntry.name}`));

    if (matchesFilter(record, filter)) {
      records.push(record);
    }
  }

  records.sort((left, right) => {
    const leftId = left.jobId
      ?? left.processId
      ?? left.threadId
      ?? left.timerId
      ?? left.conversationRunId
      ?? left.resultId
      ?? '';
    const rightId = right.jobId
      ?? right.processId
      ?? right.threadId
      ?? right.timerId
      ?? right.conversationRunId
      ?? right.resultId
      ?? '';
    return leftId.localeCompare(rightId);
  });

  return records;
}

function matchesExpectedValue(actualValue, expectedValue) {
  if (expectedValue === undefined || expectedValue === null) {
    return true;
  }

  if (Array.isArray(expectedValue)) {
    return expectedValue.includes(actualValue);
  }

  return actualValue === expectedValue;
}

function resolveResultRecordFilterValue(record, key) {
  if (key === 'producerType') {
    return record.producer.type;
  }

  if (key === 'producerId') {
    return record.producer.id;
  }

  if (key === 'operationalIdentityId') {
    return record.producer.operationalIdentityId;
  }

  if ([
    'jobId',
    'processId',
    'threadId',
    'parentJobId',
    'parentProcessId',
    'parentThreadId',
    'systemCallId',
    'timerId',
    'signalId',
    'eventId',
    'invocationId',
    'toolRunId',
    'workflowRunId',
    'conversationId',
  ].includes(key)) {
    return record.lineage[key];
  }

  return record[key];
}

function matchesResultRecordFilter(record, filter = {}) {
  for (const [key, expectedValue] of Object.entries(filter)) {
    if (!matchesExpectedValue(resolveResultRecordFilterValue(record, key), expectedValue)) {
      return false;
    }
  }

  return true;
}

function sortResultRecordsById(records) {
  return [...records].sort((left, right) => {
    return left.resultId.localeCompare(right.resultId);
  });
}

function sortResultRecordsByCreatedAtDescending(records) {
  return [...records].sort((left, right) => {
    const createdAtOrder = right.createdAt.localeCompare(left.createdAt);

    if (createdAtOrder !== 0) {
      return createdAtOrder;
    }

    return left.resultId.localeCompare(right.resultId);
  });
}

function normalizeOptionalLimit(value, description) {
  if (value === undefined || value === null) {
    return null;
  }

  return assertNonNegativeInteger(value, description);
}

function applyLimit(records, limit) {
  if (limit === null) {
    return records;
  }

  return records.slice(0, limit);
}

async function readResultRecordSnapshots(directoryPath, {
  isolateReadErrors = false,
} = {}) {
  let directoryEntries;

  try {
    directoryEntries = await readdir(directoryPath, { withFileTypes: true });
  } catch (error) {
    if (isNotFoundError(error)) {
      return {
        records: [],
        readErrors: [],
      };
    }

    throw error;
  }

  const records = [];
  const readErrors = [];

  for (const directoryEntry of directoryEntries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!directoryEntry.isFile() || !directoryEntry.name.endsWith('.json')) {
      continue;
    }

    const filePath = path.join(directoryPath, directoryEntry.name);

    try {
      records.push(assertOpenMasOsResultRecord(await readJsonSnapshot(
        filePath,
        `OpenMAS OS Result Record snapshot ${directoryEntry.name}`,
      )));
    } catch (error) {
      if (!isolateReadErrors) {
        throw error;
      }

      readErrors.push({
        scope: `results/${directoryEntry.name}`,
        message: error.message,
      });
    }
  }

  return {
    records,
    readErrors,
  };
}

function assertLocalRuntimeTimer(timer) {
  assertPlainObject(timer, 'OpenMAS OS Local Runtime timer');

  const normalizedTimer = {
    kind: timer.kind ?? LOCAL_RUNTIME_TIMER_KIND,
    schemaVersion: assertSchemaVersion(timer.schemaVersion, 'OpenMAS OS Local Runtime timer'),
    timerId: assertSafeIdentifier(timer.timerId, 'OpenMAS OS Local Runtime timer timerId'),
    jobId: assertSafeIdentifier(timer.jobId, 'OpenMAS OS Local Runtime timer jobId'),
    status: assertTimerStatus(timer.status, 'OpenMAS OS Local Runtime timer status'),
    runAt: assertNonEmptyString(timer.runAt, 'OpenMAS OS Local Runtime timer runAt'),
    createdAt: assertNonEmptyString(timer.createdAt, 'OpenMAS OS Local Runtime timer createdAt'),
    updatedAt: assertNonEmptyString(timer.updatedAt, 'OpenMAS OS Local Runtime timer updatedAt'),
    payload: assertSafeOsSerializableValue(timer.payload ?? {}, 'OpenMAS OS Local Runtime timer payload'),
  };

  if (normalizedTimer.kind !== LOCAL_RUNTIME_TIMER_KIND) {
    throw new Error(`OpenMAS OS Local Runtime timer must include kind "${LOCAL_RUNTIME_TIMER_KIND}".`);
  }

  return normalizedTimer;
}

function assertConversationParticipant(participant, index) {
  assertPlainObject(participant, `OpenMAS OS Conversation Run participants[${index}]`);

  if (Object.hasOwn(participant, 'agentId')) {
    throw new Error(`OpenMAS OS Conversation Run participants[${index}] must not include agentId. Participants are addressed by Operational Identity; cognition is resolved per turn.`);
  }

  return {
    operationalIdentityId: assertSafeIdentifier(
      participant.operationalIdentityId,
      `OpenMAS OS Conversation Run participants[${index}] operationalIdentityId`,
    ),
    displayName: assertNullableString(
      participant.displayName,
      `OpenMAS OS Conversation Run participants[${index}] displayName`,
    ),
    command: assertNonEmptyString(
      participant.command ?? 'ask',
      `OpenMAS OS Conversation Run participants[${index}] command`,
    ),
    mode: assertNonEmptyString(
      participant.mode ?? 'deterministic',
      `OpenMAS OS Conversation Run participants[${index}] mode`,
    ),
    turnInstruction: assertNullableString(
      participant.turnInstruction,
      `OpenMAS OS Conversation Run participants[${index}] turnInstruction`,
    ),
  };
}

function assertConversationParticipants(participants) {
  if (!Array.isArray(participants) || participants.length === 0) {
    throw new Error('OpenMAS OS Conversation Run participants must be a non-empty array.');
  }

  const seenOperationalIdentityIds = new Set();

  return participants.map((participant, index) => {
    const normalizedParticipant = assertConversationParticipant(participant, index);

    if (seenOperationalIdentityIds.has(normalizedParticipant.operationalIdentityId)) {
      throw new Error(`OpenMAS OS Conversation Run participants contains duplicated operationalIdentityId: ${normalizedParticipant.operationalIdentityId}`);
    }

    seenOperationalIdentityIds.add(normalizedParticipant.operationalIdentityId);
    return normalizedParticipant;
  });
}

function assertConversationTurnPlan(turn, index) {
  assertPlainObject(turn, `OpenMAS OS Conversation Run turns[${index}]`);

  return {
    turnIndex: assertNonNegativeInteger(turn.turnIndex, `OpenMAS OS Conversation Run turns[${index}] turnIndex`),
    round: assertPositiveInteger(turn.round ?? 1, `OpenMAS OS Conversation Run turns[${index}] round`),
    operationalIdentityId: assertSafeIdentifier(
      turn.operationalIdentityId,
      `OpenMAS OS Conversation Run turns[${index}] operationalIdentityId`,
    ),
    status: assertConversationTurnStatus(turn.status, `OpenMAS OS Conversation Run turns[${index}] status`),
    childJobId: assertNullableSafeIdentifier(turn.childJobId, `OpenMAS OS Conversation Run turns[${index}] childJobId`),
    childProcessId: assertNullableSafeIdentifier(
      turn.childProcessId,
      `OpenMAS OS Conversation Run turns[${index}] childProcessId`,
    ),
    childThreadId: assertNullableSafeIdentifier(
      turn.childThreadId,
      `OpenMAS OS Conversation Run turns[${index}] childThreadId`,
    ),
    conversationTurnId: assertNullableSafeIdentifier(
      turn.conversationTurnId,
      `OpenMAS OS Conversation Run turns[${index}] conversationTurnId`,
    ),
    invocationId: assertNullableSafeIdentifier(turn.invocationId, `OpenMAS OS Conversation Run turns[${index}] invocationId`),
    startedAt: assertNullableString(turn.startedAt, `OpenMAS OS Conversation Run turns[${index}] startedAt`),
    completedAt: assertNullableString(turn.completedAt, `OpenMAS OS Conversation Run turns[${index}] completedAt`),
  };
}

function assertConversationTurns(turns) {
  if (!Array.isArray(turns)) {
    throw new Error('OpenMAS OS Conversation Run turns must be an array.');
  }

  return turns.map((turn, index) => {
    const normalizedTurn = assertConversationTurnPlan(turn, index);

    if (normalizedTurn.turnIndex !== index) {
      throw new Error(`OpenMAS OS Conversation Run turns must use contiguous turnIndex values. Expected ${index}, received ${normalizedTurn.turnIndex}.`);
    }

    return normalizedTurn;
  });
}

function assertConversationTurnPolicy(turnPolicy) {
  assertPlainObject(turnPolicy, 'OpenMAS OS Conversation Run turnPolicy');

  if ((turnPolicy.type ?? 'sequential') !== 'sequential') {
    throw new Error('OpenMAS OS Conversation Run turnPolicy type must be "sequential" in v1.');
  }

  return {
    type: 'sequential',
    rounds: assertPositiveInteger(turnPolicy.rounds ?? 1, 'OpenMAS OS Conversation Run turnPolicy rounds'),
    maxRecentTurns: assertPositiveInteger(
      turnPolicy.maxRecentTurns ?? 20,
      'OpenMAS OS Conversation Run turnPolicy maxRecentTurns',
    ),
  };
}

function assertLocalRuntimeConversationRun(conversationRun) {
  assertPlainObject(conversationRun, 'OpenMAS OS Conversation Run');

  const safeConversationRun = assertSafeOsSerializableValue(
    conversationRun,
    'OpenMAS OS Conversation Run',
  );
  const normalizedConversationRun = {
    kind: safeConversationRun.kind ?? LOCAL_RUNTIME_CONVERSATION_RUN_KIND,
    schemaVersion: assertSchemaVersion(
      safeConversationRun.schemaVersion,
      'OpenMAS OS Conversation Run',
    ),
    conversationRunId: assertSafeIdentifier(
      safeConversationRun.conversationRunId,
      'OpenMAS OS Conversation Run conversationRunId',
    ),
    conversationId: assertSafeIdentifier(
      safeConversationRun.conversationId,
      'OpenMAS OS Conversation Run conversationId',
    ),
    jobId: assertSafeIdentifier(safeConversationRun.jobId, 'OpenMAS OS Conversation Run jobId'),
    processId: assertSafeIdentifier(safeConversationRun.processId, 'OpenMAS OS Conversation Run processId'),
    status: assertConversationRunStatus(safeConversationRun.status, 'OpenMAS OS Conversation Run status'),
    currentTurnIndex: safeConversationRun.currentTurnIndex === undefined || safeConversationRun.currentTurnIndex === null
      ? null
      : assertNonNegativeInteger(
        safeConversationRun.currentTurnIndex,
        'OpenMAS OS Conversation Run currentTurnIndex',
      ),
    participants: assertConversationParticipants(safeConversationRun.participants),
    turnPolicy: assertConversationTurnPolicy(safeConversationRun.turnPolicy ?? {}),
    turns: assertConversationTurns(safeConversationRun.turns ?? []),
    contextRefs: assertSafeOsSerializableValue(
      safeConversationRun.contextRefs ?? [],
      'OpenMAS OS Conversation Run contextRefs',
    ),
    createdBy: assertSafeOsSerializableValue(
      safeConversationRun.createdBy,
      'OpenMAS OS Conversation Run createdBy',
    ),
    createdAt: assertNonEmptyString(safeConversationRun.createdAt, 'OpenMAS OS Conversation Run createdAt'),
    updatedAt: assertNonEmptyString(safeConversationRun.updatedAt, 'OpenMAS OS Conversation Run updatedAt'),
    completedAt: assertNullableString(safeConversationRun.completedAt, 'OpenMAS OS Conversation Run completedAt'),
  };

  if (normalizedConversationRun.kind !== LOCAL_RUNTIME_CONVERSATION_RUN_KIND) {
    throw new Error(`OpenMAS OS Conversation Run must include kind "${LOCAL_RUNTIME_CONVERSATION_RUN_KIND}".`);
  }

  return normalizedConversationRun;
}

export class LocalRuntimeAdapter {
  constructor({ projectRootPath = null, osRootPath = null } = {}) {
    if (!isNonEmptyString(projectRootPath) && !isNonEmptyString(osRootPath)) {
      throw new Error('LocalRuntimeAdapter requires projectRootPath or osRootPath.');
    }

    this.projectRootPath = isNonEmptyString(projectRootPath) ? projectRootPath.trim() : null;
    this.osRootPath = isNonEmptyString(osRootPath)
      ? osRootPath.trim()
      : path.join(this.projectRootPath, 'instance', 'os');

    this.jobsRootPath = path.join(this.osRootPath, 'jobs');
    this.processesRootPath = path.join(this.osRootPath, 'processes');
    this.threadsRootPath = path.join(this.osRootPath, 'threads');
    this.eventsRootPath = path.join(this.osRootPath, 'events');
    this.timersRootPath = path.join(this.osRootPath, 'timers');
    this.conversationRunsRootPath = path.join(this.osRootPath, 'conversation-runs');
    this.resultsRootPath = path.join(this.osRootPath, 'results');
    this.jobClaimsRootPath = path.join(this.osRootPath, 'job-claims');
    this.schedulerQueuesRootPath = path.join(this.osRootPath, 'scheduler-queues');
    this.schedulerQueueStatePath = path.join(this.schedulerQueuesRootPath, 'state.json');
  }

  async initialize() {
    await Promise.all([
      ensureDirectory(this.jobsRootPath),
      ensureDirectory(this.processesRootPath),
      ensureDirectory(this.threadsRootPath),
      ensureDirectory(this.eventsRootPath),
      ensureDirectory(this.timersRootPath),
      ensureDirectory(this.conversationRunsRootPath),
      ensureDirectory(this.resultsRootPath),
      ensureDirectory(this.jobClaimsRootPath),
      ensureDirectory(this.schedulerQueuesRootPath),
    ]);

    return {
      osRootPath: this.osRootPath,
      jobsRootPath: this.jobsRootPath,
      processesRootPath: this.processesRootPath,
      threadsRootPath: this.threadsRootPath,
      eventsRootPath: this.eventsRootPath,
      timersRootPath: this.timersRootPath,
      conversationRunsRootPath: this.conversationRunsRootPath,
      resultsRootPath: this.resultsRootPath,
      jobClaimsRootPath: this.jobClaimsRootPath,
      schedulerQueuesRootPath: this.schedulerQueuesRootPath,
    };
  }

  resolveJobSnapshotPath(jobId) {
    return path.join(this.jobsRootPath, `${assertSafeIdentifier(jobId, 'OpenMAS OS Job jobId')}.json`);
  }

  resolveProcessSnapshotPath(processId) {
    return path.join(this.processesRootPath, `${assertSafeIdentifier(processId, 'OpenMAS OS Process processId')}.json`);
  }

  resolveThreadSnapshotPath(threadId) {
    return path.join(this.threadsRootPath, `${assertSafeIdentifier(threadId, 'OpenMAS OS Thread threadId')}.json`);
  }

  resolveTimerSnapshotPath(timerId) {
    return path.join(this.timersRootPath, `${assertSafeIdentifier(timerId, 'OpenMAS OS Local Runtime timer timerId')}.json`);
  }

  resolveConversationRunSnapshotPath(conversationRunId) {
    return path.join(
      this.conversationRunsRootPath,
      `${assertSafeIdentifier(conversationRunId, 'OpenMAS OS Conversation Run conversationRunId')}.json`,
    );
  }

  resolveResultRecordSnapshotPath(resultId) {
    return path.join(
      this.resultsRootPath,
      `${assertSafeIdentifier(resultId, 'OpenMAS OS Result Record resultId')}.json`,
    );
  }

  resolveJobClaimLockPath(jobId) {
    return path.join(
      this.jobClaimsRootPath,
      `${assertSafeIdentifier(jobId, 'OpenMAS OS Job claim jobId')}.lock.json`,
    );
  }

  resolveEventLogPath(date) {
    return path.join(this.eventsRootPath, `events_${assertSafeIdentifier(date, 'OpenMAS OS Event log date')}.jsonl`);
  }

  resolveSchedulerQueueStatusPath(collectionName, status) {
    return path.join(
      this.schedulerQueuesRootPath,
      assertNonEmptyString(collectionName, 'OpenMAS OS Scheduler Queue collection'),
      assertSchedulerQueueStatus(collectionName, status),
    );
  }

  resolveSchedulerQueueReferencePath(collectionName, status, recordId) {
    const definition = resolveSchedulerQueueDefinition(collectionName);
    return path.join(
      this.resolveSchedulerQueueStatusPath(collectionName, status),
      `${assertSafeIdentifier(
        recordId,
        `OpenMAS OS Scheduler Queue ${collectionName} ${definition.idField}`,
      )}.ref`,
    );
  }

  async isSchedulerQueueReady() {
    return fileExists(this.schedulerQueueStatePath);
  }

  async persistSchedulerQueuedSnapshot({
    collectionName,
    recordId,
    status,
    snapshotPath,
    snapshot,
  }) {
    const definition = resolveSchedulerQueueDefinition(collectionName);

    if (definition.statuses.has(status)) {
      await writeEmptyFileIfMissing(
        this.resolveSchedulerQueueReferencePath(collectionName, status, recordId),
      );
    }

    await atomicWriteJson(snapshotPath, snapshot);

    await Promise.all([...definition.statuses]
      .filter((actionableStatus) => actionableStatus !== status)
      .map((actionableStatus) => removeFileIfPresent(
        this.resolveSchedulerQueueReferencePath(collectionName, actionableStatus, recordId),
      )));

    return snapshot;
  }

  async listSchedulerQueuedSnapshots({
    collectionName,
    status,
    filter,
    loadSnapshot,
  }) {
    const definition = resolveSchedulerQueueDefinition(collectionName);

    if (!definition.statuses.has(status) || !await this.isSchedulerQueueReady()) {
      return null;
    }

    const recordIds = await listSchedulerQueueIds(
      this.resolveSchedulerQueueStatusPath(collectionName, status),
      `OpenMAS OS Scheduler Queue ${collectionName} ${status}`,
    );
    const records = [];

    for (const recordId of recordIds) {
      let record;

      try {
        record = await loadSnapshot(recordId);
      } catch (error) {
        if (isSnapshotNotFoundError(error)) {
          continue;
        }

        throw error;
      }

      if (matchesFilter(record, filter)) {
        records.push(record);
      }
    }

    return records;
  }

  async reconcileSchedulerQueues({ reconciledAt = new Date().toISOString() } = {}) {
    const safeReconciledAt = assertNonEmptyString(
      reconciledAt,
      'OpenMAS OS Scheduler Queue reconciledAt',
    );

    await ensureDirectory(this.schedulerQueuesRootPath);
    await removeFileIfPresent(this.schedulerQueueStatePath);

    const [jobs, processes, timers] = await Promise.all([
      listJsonSnapshots(this.jobsRootPath, assertOpenMasOsJob),
      listJsonSnapshots(this.processesRootPath, assertOpenMasOsProcess),
      listJsonSnapshots(this.timersRootPath, assertLocalRuntimeTimer),
    ]);
    const snapshotsByCollection = {
      jobs,
      processes,
      timers,
    };
    const counts = {};

    for (const [collectionName, records] of Object.entries(snapshotsByCollection)) {
      const definition = resolveSchedulerQueueDefinition(collectionName);
      let indexedCount = 0;

      for (const record of records) {
        const status = record.status;

        if (!definition.statuses.has(status)) {
          continue;
        }

        // Stale references are validated on read; deleting them here could race a new admission.
        await writeEmptyFileIfMissing(this.resolveSchedulerQueueReferencePath(
          collectionName,
          status,
          record[definition.idField],
        ));
        indexedCount += 1;
      }

      counts[collectionName] = indexedCount;
    }

    const state = assertSafeOsSerializableValue({
      kind: LOCAL_RUNTIME_SCHEDULER_QUEUE_STATE_KIND,
      version: LOCAL_RUNTIME_SCHEDULER_QUEUE_STATE_VERSION,
      status: 'ready',
      reconciledAt: safeReconciledAt,
      counts,
    }, 'OpenMAS OS Scheduler Queue state');

    await atomicWriteJson(this.schedulerQueueStatePath, state);
    return state;
  }

  async persistJob(job) {
    const normalizedJob = assertOpenMasOsJob(job);
    return this.persistSchedulerQueuedSnapshot({
      collectionName: 'jobs',
      recordId: normalizedJob.jobId,
      status: normalizedJob.status,
      snapshotPath: this.resolveJobSnapshotPath(normalizedJob.jobId),
      snapshot: normalizedJob,
    });
  }

  async claimReadyJob({
    jobId,
    claimedAt,
    ownerId = null,
    staleAfterMs = DEFAULT_JOB_CLAIM_LOCK_STALE_AFTER_MS,
  } = {}) {
    const safeJobId = assertSafeIdentifier(jobId, 'OpenMAS OS Job claim jobId');
    const safeClaimedAt = assertNonEmptyString(
      claimedAt ?? new Date().toISOString(),
      'OpenMAS OS Job claim claimedAt',
    );
    const safeStaleAfterMs = normalizeJobClaimLockStaleAfterMs(
      staleAfterMs,
      'OpenMAS OS Job claim staleAfterMs',
    );
    const lockPath = this.resolveJobClaimLockPath(safeJobId);
    const lock = createJobClaimLock({
      jobId: safeJobId,
      claimedAt: safeClaimedAt,
      ownerId,
      staleAfterMs: safeStaleAfterMs,
    });
    const acquisition = await acquireJobClaimLock({
      lockPath,
      lock,
      now: safeClaimedAt,
    });

    if (!acquisition.acquired) {
      return {
        claimed: false,
        reason: acquisition.reason,
        job: acquisition.reason === 'job_claim_locked'
          ? null
          : await this.loadJob(safeJobId),
        lock: acquisition.lock,
      };
    }

    try {
      const currentJob = await this.loadJob(safeJobId);

      if (currentJob.status !== 'ready') {
        return {
          claimed: false,
          reason: 'job_not_ready',
          job: currentJob,
          lock,
        };
      }

      const claimedJob = assertOpenMasOsJob({
        ...currentJob,
        status: 'active',
        updatedAt: safeClaimedAt,
      });

      await this.persistJob(claimedJob);

      return {
        claimed: true,
        reason: null,
        job: claimedJob,
        lock,
      };
    } finally {
      await releaseJobClaimLock({
        lockPath,
        claimId: lock.claimId,
      });
    }
  }

  async loadJob(jobId) {
    return assertOpenMasOsJob(await readJsonSnapshot(
      this.resolveJobSnapshotPath(jobId),
      `OpenMAS OS Job snapshot ${jobId}`,
    ));
  }

  async listJobs(filter = {}) {
    if (isNonEmptyString(filter.status)) {
      const queuedJobs = await this.listSchedulerQueuedSnapshots({
        collectionName: 'jobs',
        status: filter.status,
        filter,
        loadSnapshot: (jobId) => this.loadJob(jobId),
      });

      if (queuedJobs) {
        return queuedJobs;
      }
    }

    return listJsonSnapshots(this.jobsRootPath, assertOpenMasOsJob, filter);
  }

  async persistProcess(processState) {
    const normalizedProcess = assertOpenMasOsProcess(processState);
    return this.persistSchedulerQueuedSnapshot({
      collectionName: 'processes',
      recordId: normalizedProcess.processId,
      status: normalizedProcess.status,
      snapshotPath: this.resolveProcessSnapshotPath(normalizedProcess.processId),
      snapshot: normalizedProcess,
    });
  }

  async loadProcess(processId) {
    return assertOpenMasOsProcess(await readJsonSnapshot(
      this.resolveProcessSnapshotPath(processId),
      `OpenMAS OS Process snapshot ${processId}`,
    ));
  }

  async listProcesses(filter = {}) {
    if (isNonEmptyString(filter.status)) {
      const queuedProcesses = await this.listSchedulerQueuedSnapshots({
        collectionName: 'processes',
        status: filter.status,
        filter,
        loadSnapshot: (processId) => this.loadProcess(processId),
      });

      if (queuedProcesses) {
        return queuedProcesses;
      }
    }

    return listJsonSnapshots(this.processesRootPath, assertOpenMasOsProcess, filter);
  }

  async persistThread(thread) {
    const normalizedThread = assertOpenMasOsThread(thread);
    await atomicWriteJson(this.resolveThreadSnapshotPath(normalizedThread.threadId), normalizedThread);
    return normalizedThread;
  }

  async loadThread(threadId) {
    return assertOpenMasOsThread(await readJsonSnapshot(
      this.resolveThreadSnapshotPath(threadId),
      `OpenMAS OS Thread snapshot ${threadId}`,
    ));
  }

  async listThreads(filter = {}) {
    return listJsonSnapshots(this.threadsRootPath, assertOpenMasOsThread, filter);
  }

  async appendEvent(event) {
    const normalizedEvent = assertOpenMasOsEvent(event);
    const eventLogPath = this.resolveEventLogPath(resolveEventLogDate(normalizedEvent.occurredAt));

    await ensureDirectory(this.eventsRootPath);
    await appendFile(eventLogPath, `${JSON.stringify(normalizedEvent)}\n`, 'utf8');

    return {
      event: normalizedEvent,
      eventLogPath,
    };
  }

  async readEvents({ date = null } = {}) {
    let eventLogFiles;

    try {
      if (date !== null && date !== undefined) {
        eventLogFiles = [this.resolveEventLogPath(date)];
      } else {
        const directoryEntries = await readdir(this.eventsRootPath, { withFileTypes: true });
        eventLogFiles = directoryEntries
          .filter((directoryEntry) => directoryEntry.isFile() && directoryEntry.name.endsWith('.jsonl'))
          .map((directoryEntry) => path.join(this.eventsRootPath, directoryEntry.name))
          .sort();
      }
    } catch (error) {
      if (isNotFoundError(error)) {
        return [];
      }

      throw error;
    }

    const events = [];

    for (const eventLogFile of eventLogFiles) {
      let content;

      try {
        content = await readFile(eventLogFile, 'utf8');
      } catch (error) {
        if (isNotFoundError(error)) {
          continue;
        }

        throw error;
      }

      const lines = content.split(/\r?\n/u).filter((line) => line.trim().length > 0);

      for (const [index, line] of lines.entries()) {
        try {
          events.push(assertOpenMasOsEvent(JSON.parse(line)));
        } catch (error) {
          if (error instanceof SyntaxError) {
            throw new Error(`OpenMAS OS Event log ${eventLogFile} line ${index + 1} could not be parsed as JSON: ${error.message}`);
          }

          throw error;
        }
      }
    }

    return events;
  }

  async persistTimer(timer) {
    const normalizedTimer = assertLocalRuntimeTimer(timer);
    return this.persistSchedulerQueuedSnapshot({
      collectionName: 'timers',
      recordId: normalizedTimer.timerId,
      status: normalizedTimer.status,
      snapshotPath: this.resolveTimerSnapshotPath(normalizedTimer.timerId),
      snapshot: normalizedTimer,
    });
  }

  async loadTimer(timerId) {
    return assertLocalRuntimeTimer(await readJsonSnapshot(
      this.resolveTimerSnapshotPath(timerId),
      `OpenMAS OS Local Runtime timer snapshot ${timerId}`,
    ));
  }

  async listTimers(filter = {}) {
    if (isNonEmptyString(filter.status)) {
      const queuedTimers = await this.listSchedulerQueuedSnapshots({
        collectionName: 'timers',
        status: filter.status,
        filter,
        loadSnapshot: (timerId) => this.loadTimer(timerId),
      });

      if (queuedTimers) {
        return queuedTimers;
      }
    }

    return listJsonSnapshots(this.timersRootPath, assertLocalRuntimeTimer, filter);
  }

  async persistConversationRun(conversationRun) {
    const normalizedConversationRun = assertLocalRuntimeConversationRun(conversationRun);
    await atomicWriteJson(
      this.resolveConversationRunSnapshotPath(normalizedConversationRun.conversationRunId),
      normalizedConversationRun,
    );
    return normalizedConversationRun;
  }

  async loadConversationRun(conversationRunId) {
    return assertLocalRuntimeConversationRun(await readJsonSnapshot(
      this.resolveConversationRunSnapshotPath(conversationRunId),
      `OpenMAS OS Conversation Run snapshot ${conversationRunId}`,
    ));
  }

  async listConversationRuns(filter = {}) {
    return listJsonSnapshots(this.conversationRunsRootPath, assertLocalRuntimeConversationRun, filter);
  }

  async persistResultRecord(resultRecord) {
    const normalizedResultRecord = assertOpenMasOsResultRecord(resultRecord);
    const resultRecordPath = this.resolveResultRecordSnapshotPath(normalizedResultRecord.resultId);

    if (await fileExists(resultRecordPath)) {
      throw new Error(`OpenMAS OS Result Record ${normalizedResultRecord.resultId} already exists.`);
    }

    await atomicWriteJson(resultRecordPath, normalizedResultRecord);
    return normalizedResultRecord;
  }

  async loadResultRecord(resultId) {
    return assertOpenMasOsResultRecord(await readJsonSnapshot(
      this.resolveResultRecordSnapshotPath(resultId),
      `OpenMAS OS Result Record snapshot ${resultId}`,
    ));
  }

  async listResultRecords(filter = {}) {
    const { records } = await readResultRecordSnapshots(this.resultsRootPath);
    return sortResultRecordsById(records.filter((record) => matchesResultRecordFilter(record, filter)));
  }

  async listRecentResultRecords({ filter = {}, limit = 20 } = {}) {
    const safeLimit = normalizeOptionalLimit(limit, 'OpenMAS OS Result Record recent limit');
    const { records } = await readResultRecordSnapshots(this.resultsRootPath);
    const matchingRecords = records.filter((record) => matchesResultRecordFilter(record, filter));

    return applyLimit(sortResultRecordsByCreatedAtDescending(matchingRecords), safeLimit);
  }

  async inspectResultRecords({ filter = {}, limit = null } = {}) {
    const safeLimit = normalizeOptionalLimit(limit, 'OpenMAS OS Result Record inspect limit');
    const { records, readErrors } = await readResultRecordSnapshots(this.resultsRootPath, {
      isolateReadErrors: true,
    });
    const matchingRecords = records.filter((record) => matchesResultRecordFilter(record, filter));

    return {
      records: applyLimit(sortResultRecordsByCreatedAtDescending(matchingRecords), safeLimit),
      readErrors,
    };
  }

  async findResultRecordsByJob(jobId) {
    const safeJobId = assertSafeIdentifier(jobId, 'OpenMAS OS Result Record jobId');
    return this.listResultRecords({ jobId: safeJobId });
  }

  async findResultRecordsByProcess(processId) {
    const safeProcessId = assertSafeIdentifier(processId, 'OpenMAS OS Result Record processId');
    return this.listResultRecords({ processId: safeProcessId });
  }

  async findChildResultRecordsByParentProcess(parentProcessId) {
    const safeParentProcessId = assertSafeIdentifier(
      parentProcessId,
      'OpenMAS OS Result Record parentProcessId',
    );

    return this.listResultRecords({ parentProcessId: safeParentProcessId });
  }
}

export function createLocalRuntimeAdapter(options = {}) {
  return new LocalRuntimeAdapter(options);
}

export {
  LOCAL_RUNTIME_CONVERSATION_RUN_KIND,
  LOCAL_RUNTIME_CONVERSATION_RUN_STATUSES,
  LOCAL_RUNTIME_CONVERSATION_TURN_STATUSES,
  LOCAL_RUNTIME_JOB_CLAIM_LOCK_KIND,
  DEFAULT_JOB_CLAIM_LOCK_STALE_AFTER_MS,
  LOCAL_RUNTIME_SCHEDULER_QUEUE_STATE_KIND,
  LOCAL_RUNTIME_SCHEDULER_QUEUE_STATE_VERSION,
  LOCAL_RUNTIME_TIMER_KIND,
  LOCAL_RUNTIME_TIMER_STATUSES,
  assertLocalRuntimeConversationRun,
  assertJobClaimLock,
};
