import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  access,
  link,
  mkdir,
  readFile,
  readdir,
  unlink,
  writeFile,
} from 'node:fs/promises';
import {
  assertOpenMasOsSystemCall,
  assertOpenMasOsSystemCallResult,
} from '../../contracts/os/openmas-os-system-call-contract.js';

const LOCAL_SYSTEM_CALL_STATES = Object.freeze([
  'pending',
  'processing',
  'completed',
  'denied',
  'failed',
  'expired',
  'cancelled',
]);

const SAFE_LOCAL_SYSTEM_CALL_IDENTIFIER_PATTERN = /^[a-zA-Z0-9._-]+$/u;

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isNotFoundError(error) {
  return error && error.code === 'ENOENT';
}

function isAlreadyExistsError(error) {
  return error && error.code === 'EEXIST';
}

function assertSafeIdentifier(value, description) {
  if (!isNonEmptyString(value)) {
    throw new Error(`${description} must be a non-empty string.`);
  }

  const normalizedValue = value.trim();

  if (!SAFE_LOCAL_SYSTEM_CALL_IDENTIFIER_PATTERN.test(normalizedValue)) {
    throw new Error(`${description} contains unsafe characters: ${normalizedValue}`);
  }

  return normalizedValue;
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

async function readJsonSnapshot(filePath, description) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (isNotFoundError(error)) {
      throw new Error(`${description} was not found.`);
    }

    if (error instanceof SyntaxError) {
      throw new Error(`${description} could not be parsed as JSON: ${error.message}`);
    }

    throw error;
  }
}

async function readJsonSnapshotOrNull(filePath) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
}

async function publishJsonWithoutOverwrite(filePath, data, description) {
  await ensureDirectory(path.dirname(filePath));

  const temporaryPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${randomUUID()}.tmp`,
  );

  await writeFile(temporaryPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');

  try {
    await link(temporaryPath, filePath);
  } catch (error) {
    if (isAlreadyExistsError(error)) {
      throw new Error(`${description} already exists.`);
    }

    throw error;
  } finally {
    await unlink(temporaryPath).catch(() => {});
  }

  return filePath;
}

function shouldReadJsonSnapshotEntry(directoryEntry) {
  return directoryEntry.isFile()
    && !directoryEntry.name.startsWith('.')
    && directoryEntry.name.endsWith('.json');
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
    if (!shouldReadJsonSnapshotEntry(directoryEntry)) {
      continue;
    }

    const filePath = path.join(directoryPath, directoryEntry.name);
    const record = normalizeRecord(await readJsonSnapshot(
      filePath,
      `OpenMAS OS System Call snapshot ${directoryEntry.name}`,
    ));

    if (matchesFilter(record, filter)) {
      records.push(record);
    }
  }

  records.sort((left, right) => {
    const leftTimestamp = left.requestedAt ?? left.processedAt ?? '';
    const rightTimestamp = right.requestedAt ?? right.processedAt ?? '';
    const timestampComparison = leftTimestamp.localeCompare(rightTimestamp);

    if (timestampComparison !== 0) {
      return timestampComparison;
    }

    return left.systemCallId.localeCompare(right.systemCallId);
  });

  return records;
}

export class LocalSystemCallInbox {
  constructor({ projectRootPath = null, osRootPath = null } = {}) {
    if (!isNonEmptyString(projectRootPath) && !isNonEmptyString(osRootPath)) {
      throw new Error('LocalSystemCallInbox requires projectRootPath or osRootPath.');
    }

    this.projectRootPath = isNonEmptyString(projectRootPath) ? projectRootPath.trim() : null;
    this.osRootPath = isNonEmptyString(osRootPath)
      ? osRootPath.trim()
      : path.join(this.projectRootPath, 'instance', 'os');

    this.systemCallsRootPath = path.join(this.osRootPath, 'system-calls');
    this.stateRootPaths = Object.fromEntries(
      LOCAL_SYSTEM_CALL_STATES.map((state) => {
        return [state, path.join(this.systemCallsRootPath, state)];
      }),
    );
    this.pendingRootPath = this.stateRootPaths.pending;
    this.resultsRootPath = path.join(this.systemCallsRootPath, 'results');
  }

  async initialize() {
    await Promise.all([
      ...Object.values(this.stateRootPaths).map((rootPath) => ensureDirectory(rootPath)),
      ensureDirectory(this.resultsRootPath),
    ]);

    return {
      osRootPath: this.osRootPath,
      systemCallsRootPath: this.systemCallsRootPath,
      pendingRootPath: this.pendingRootPath,
      processingRootPath: this.stateRootPaths.processing,
      completedRootPath: this.stateRootPaths.completed,
      deniedRootPath: this.stateRootPaths.denied,
      failedRootPath: this.stateRootPaths.failed,
      expiredRootPath: this.stateRootPaths.expired,
      cancelledRootPath: this.stateRootPaths.cancelled,
      resultsRootPath: this.resultsRootPath,
    };
  }

  resolveSystemCallSnapshotPath(systemCallId, state = 'pending') {
    const normalizedSystemCallId = assertSafeIdentifier(
      systemCallId,
      'OpenMAS OS System Call systemCallId',
    );
    const stateRootPath = this.stateRootPaths[state];

    if (!stateRootPath) {
      throw new Error(`OpenMAS OS System Call state is invalid: ${state}`);
    }

    return path.join(stateRootPath, `${normalizedSystemCallId}.json`);
  }

  resolvePendingSystemCallPath(systemCallId) {
    return this.resolveSystemCallSnapshotPath(systemCallId, 'pending');
  }

  resolveSystemCallResultPath(systemCallId) {
    const normalizedSystemCallId = assertSafeIdentifier(
      systemCallId,
      'OpenMAS OS System Call Result systemCallId',
    );

    return path.join(this.resultsRootPath, `${normalizedSystemCallId}.result.json`);
  }

  async findExistingSystemCallPath(systemCallId) {
    const normalizedSystemCallId = assertSafeIdentifier(
      systemCallId,
      'OpenMAS OS System Call systemCallId',
    );

    for (const state of LOCAL_SYSTEM_CALL_STATES) {
      const snapshotPath = this.resolveSystemCallSnapshotPath(normalizedSystemCallId, state);

      if (await fileExists(snapshotPath)) {
        return snapshotPath;
      }
    }

    const resultPath = this.resolveSystemCallResultPath(normalizedSystemCallId);

    if (await fileExists(resultPath)) {
      return resultPath;
    }

    return null;
  }

  async listSystemCallIds(state = 'pending') {
    const stateRootPath = this.stateRootPaths[state];

    if (!stateRootPath) {
      throw new Error(`OpenMAS OS System Call state is invalid: ${state}`);
    }

    let directoryEntries;

    try {
      directoryEntries = await readdir(stateRootPath, { withFileTypes: true });
    } catch (error) {
      if (isNotFoundError(error)) {
        return [];
      }

      throw error;
    }

    return directoryEntries
      .filter(shouldReadJsonSnapshotEntry)
      .map((directoryEntry) => {
        return assertSafeIdentifier(
          directoryEntry.name.slice(0, -'.json'.length),
          `OpenMAS OS ${state} System Call file name`,
        );
      })
      .sort();
  }

  async listPendingSystemCallIds() {
    return this.listSystemCallIds('pending');
  }

  async loadSystemCall(systemCallId, state = 'pending') {
    return assertOpenMasOsSystemCall(await readJsonSnapshot(
      this.resolveSystemCallSnapshotPath(systemCallId, state),
      `OpenMAS OS ${state} System Call ${systemCallId}`,
    ));
  }

  async submitSystemCall(systemCall) {
    const normalizedSystemCall = assertOpenMasOsSystemCall(systemCall);

    if (normalizedSystemCall.status !== 'pending') {
      throw new Error('OpenMAS OS System Call Inbox only accepts pending system calls.');
    }

    const existingPath = await this.findExistingSystemCallPath(normalizedSystemCall.systemCallId);

    if (existingPath !== null) {
      throw new Error(`OpenMAS OS System Call ${normalizedSystemCall.systemCallId} already exists.`);
    }

    const pendingPath = this.resolvePendingSystemCallPath(normalizedSystemCall.systemCallId);

    await publishJsonWithoutOverwrite(
      pendingPath,
      normalizedSystemCall,
      `OpenMAS OS System Call ${normalizedSystemCall.systemCallId}`,
    );

    return {
      systemCall: normalizedSystemCall,
      systemCallPath: pendingPath,
      state: 'pending',
    };
  }

  async loadPendingSystemCall(systemCallId) {
    return this.loadSystemCall(systemCallId, 'pending');
  }

  async listPendingSystemCalls(filter = {}) {
    return listJsonSnapshots(
      this.pendingRootPath,
      assertOpenMasOsSystemCall,
      {
        status: 'pending',
        ...filter,
      },
    );
  }

  async listSystemCalls({ state = 'pending', filter = {} } = {}) {
    const stateRootPath = this.stateRootPaths[state];

    if (!stateRootPath) {
      throw new Error(`OpenMAS OS System Call state is invalid: ${state}`);
    }

    return listJsonSnapshots(
      stateRootPath,
      assertOpenMasOsSystemCall,
      filter,
    );
  }

  async moveSystemCall({ systemCallId, fromState, toState } = {}) {
    const normalizedSystemCallId = assertSafeIdentifier(
      systemCallId,
      'OpenMAS OS System Call systemCallId',
    );
    const sourcePath = this.resolveSystemCallSnapshotPath(normalizedSystemCallId, fromState);
    const targetPath = this.resolveSystemCallSnapshotPath(normalizedSystemCallId, toState);
    const sourceSnapshot = await readJsonSnapshotOrNull(sourcePath);

    await ensureDirectory(path.dirname(targetPath));

    if (sourceSnapshot === null) {
      try {
        await link(sourcePath, targetPath);
      } catch (error) {
        if (isAlreadyExistsError(error)) {
          throw new Error(`OpenMAS OS System Call ${normalizedSystemCallId} already exists in state "${toState}".`);
        }

        throw error;
      }
    } else {
      await publishJsonWithoutOverwrite(
        targetPath,
        {
          ...sourceSnapshot,
          status: toState,
        },
        `OpenMAS OS System Call ${normalizedSystemCallId} in state "${toState}"`,
      );
    }

    await unlink(sourcePath);

    return {
      systemCallId: normalizedSystemCallId,
      fromState,
      toState,
      sourcePath,
      targetPath,
    };
  }

  async persistSystemCallResult(result) {
    const normalizedResult = assertOpenMasOsSystemCallResult(result);
    const resultPath = this.resolveSystemCallResultPath(normalizedResult.systemCallId);

    await publishJsonWithoutOverwrite(
      resultPath,
      normalizedResult,
      `OpenMAS OS System Call Result ${normalizedResult.systemCallId}`,
    );

    return {
      result: normalizedResult,
      resultPath,
    };
  }

  async hasSystemCallResult(systemCallId) {
    return fileExists(this.resolveSystemCallResultPath(systemCallId));
  }

  async loadSystemCallResult(systemCallId) {
    return assertOpenMasOsSystemCallResult(await readJsonSnapshot(
      this.resolveSystemCallResultPath(systemCallId),
      `OpenMAS OS System Call Result ${systemCallId}`,
    ));
  }

  async listSystemCallResults(filter = {}) {
    return listJsonSnapshots(
      this.resultsRootPath,
      assertOpenMasOsSystemCallResult,
      filter,
    );
  }
}

export function createLocalSystemCallInbox(options = {}) {
  return new LocalSystemCallInbox(options);
}

export {
  LOCAL_SYSTEM_CALL_STATES,
};
