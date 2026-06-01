import { createHash } from 'node:crypto';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolveBoundedChildPath } from '../contracts/shared/bounded-path-contract.js';
import { assertMemoryRecord } from '../contracts/memory/memory-record-contract.js';
import { assertMemoryWriteCandidate } from '../contracts/memory/memory-writeback-contract.js';

const DURABLE_MEMORY_ROOT_PATH = 'memory/durable';
const SAFE_MEMORY_RECORD_ID_PATTERN = /^[A-Za-z0-9_-]+$/u;

function createSha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeTimestamp(value, description) {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (!isNonEmptyString(value)) {
    throw new Error(`${description} must be a non-empty ISO timestamp.`);
  }

  const normalizedValue = value.trim();

  if (Number.isNaN(Date.parse(normalizedValue))) {
    throw new Error(`${description} must be a valid ISO timestamp.`);
  }

  return normalizedValue;
}

function assertSafeMemoryRecordId(memoryRecordId) {
  if (!isNonEmptyString(memoryRecordId)) {
    throw new Error('Durable memory record ID must be a non-empty string.');
  }

  const normalizedMemoryRecordId = memoryRecordId.trim();

  if (!SAFE_MEMORY_RECORD_ID_PATTERN.test(normalizedMemoryRecordId)) {
    throw new Error(`Durable memory record ID contains unsafe characters: ${normalizedMemoryRecordId}`);
  }

  return normalizedMemoryRecordId;
}

function resolveMemoryRecordConfidence(candidate) {
  if (candidate.origin === 'human_approved') {
    return 'human_approved';
  }

  if (candidate.origin === 'steward_curated') {
    return 'steward_approved';
  }

  if (candidate.origin === 'runtime_observed') {
    return 'observed';
  }

  if (candidate.origin === 'agent_proposed') {
    return 'agent_proposed';
  }

  return 'unknown';
}

export function createDurableMemoryRecordIdFromWriteId(writeId) {
  if (!isNonEmptyString(writeId)) {
    throw new Error('Durable memory record ID generation requires a non-empty writeId.');
  }

  return `mem_${createSha256(writeId.trim()).slice(0, 32)}`;
}

export function createDurableMemoryRecordFileName(memoryRecordId) {
  return `memory-record-${assertSafeMemoryRecordId(memoryRecordId)}.json`;
}

export function resolveDurableMemoryRootPath({ masRootPath }) {
  return resolveBoundedChildPath({
    parentRootPath: masRootPath,
    childRootPath: DURABLE_MEMORY_ROOT_PATH,
    description: 'Durable memory rootPath',
  });
}

export function buildDurableMemoryRecordFromWriteCandidate({
  writeCandidate,
  memoryRecordId = null,
  now = new Date(),
} = {}) {
  const candidate = assertMemoryWriteCandidate(writeCandidate);

  if (candidate.approvalState !== 'approved') {
    throw new Error('Only approved memory write candidates can be persisted as durable memory records.');
  }

  const normalizedTimestamp = normalizeTimestamp(now, 'Durable memory record timestamp');
  const durableMemoryRecordId = assertSafeMemoryRecordId(
    memoryRecordId ?? createDurableMemoryRecordIdFromWriteId(candidate.writeId),
  );

  return assertMemoryRecord({
    kind: 'memory_record',
    version: 1,
    memoryRecordId: durableMemoryRecordId,
    memoryType: candidate.targetMemoryType,
    scope: candidate.scope,
    ownerId: candidate.ownerId,
    origin: candidate.origin,
    portability: candidate.portability,
    visibility: candidate.visibility,
    approvalState: 'approved',
    lifecycleStatus: 'active',
    sensitivityLevel: candidate.sensitivityLevel,
    confidence: resolveMemoryRecordConfidence(candidate),
    authorityLevel: candidate.authorityLevel,
    summary: candidate.summary,
    content: candidate.content,
    sourceReferences: candidate.sourceReferences,
    subjectReferences: candidate.subjectReferences,
    retention: {
      retentionPolicyId: 'default-durable-memory',
      expiresAt: null,
      staleAfter: null,
      reviewRequiredAt: null,
    },
    supersession: {
      supersedesMemoryRecordIds: [],
      supersededByMemoryRecordId: null,
    },
    createdAt: normalizedTimestamp,
    updatedAt: normalizedTimestamp,
    warnings: candidate.warnings,
  });
}

export async function writeDurableMemoryRecord({
  masRootPath,
  writeCandidate,
  memoryRecordId = null,
  now = new Date(),
} = {}) {
  const memoryRecord = buildDurableMemoryRecordFromWriteCandidate({
    writeCandidate,
    memoryRecordId,
    now,
  });
  const durableMemoryRootPath = resolveDurableMemoryRootPath({ masRootPath });
  const memoryRecordFileName = createDurableMemoryRecordFileName(memoryRecord.memoryRecordId);
  const memoryRecordPath = path.join(durableMemoryRootPath, memoryRecordFileName);

  await mkdir(durableMemoryRootPath, { recursive: true });

  try {
    await writeFile(
      memoryRecordPath,
      `${JSON.stringify(memoryRecord, null, 2)}\n`,
      {
        encoding: 'utf8',
        flag: 'wx',
      },
    );
  } catch (error) {
    if (error.code === 'EEXIST') {
      throw new Error(`Durable memory record already exists: ${memoryRecord.memoryRecordId}`);
    }

    throw error;
  }

  return {
    memoryRecord,
    durableMemoryRootPath,
    memoryRecordPath,
    memoryRecordFileName,
    created: true,
  };
}

export {
  DURABLE_MEMORY_ROOT_PATH,
};
