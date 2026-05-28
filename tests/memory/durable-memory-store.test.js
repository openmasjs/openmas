import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import {
  buildDurableMemoryRecordFromWriteCandidate,
  createDurableMemoryRecordFileName,
  createDurableMemoryRecordIdFromWriteId,
  writeDurableMemoryRecord,
} from '../../src/memory/write-durable-memory-record.js';
import { readDurableMemoryRecords } from '../../src/memory/read-durable-memory-records.js';

const VALID_CREATED_AT = '2026-04-14T00:00:00.000Z';
const VALID_SHA_256 = 'f'.repeat(64);

async function createTemporaryMasRoot() {
  const temporaryRootPath = await mkdtemp(path.join(os.tmpdir(), 'openmas-durable-memory-'));
  const masRootPath = path.join(temporaryRootPath, 'instance');

  await mkdir(masRootPath, { recursive: true });

  return masRootPath;
}

function buildSourceReference(overrides = {}) {
  return {
    kind: 'memory_source_reference',
    version: 1,
    sourceType: 'invocation_session',
    sourceId: 'invocation-001',
    scope: 'operational_identity',
    ownerId: 'maria',
    path: 'memory/state/agent-invocation-invocation-001.json',
    origin: 'runtime_observed',
    sensitivityLevel: 'internal',
    createdAt: VALID_CREATED_AT,
    contentSha256: VALID_SHA_256,
    ...overrides,
  };
}

function buildApprovedWriteCandidate(overrides = {}) {
  return {
    kind: 'memory_write_candidate',
    writeId: 'write_conversation_summary_001',
    writeType: 'conversation_summary',
    targetMemoryType: 'conversation_summary',
    scope: 'operational_identity',
    ownerId: 'maria',
    origin: 'agent_proposed',
    portability: 'mas_bound',
    visibility: 'private_to_owner',
    sensitivityLevel: 'internal',
    authorityLevel: 'operational_note',
    summary: 'Maria completed a customer-facing complaint response.',
    content: 'Invocation completed. Raw model output was not copied.',
    sourceReferences: [buildSourceReference()],
    subjectReferences: [
      {
        subjectType: 'invocation',
        subjectId: 'invocation-001',
        relationship: 'source-invocation',
      },
      {
        subjectType: 'operational_identity',
        subjectId: 'maria',
        relationship: 'owner',
      },
    ],
    approvalState: 'approved',
    redactionState: 'not_required',
    sourceGovernance: {
      sourceScopes: ['operational_identity'],
      sourceOwnerIds: ['maria'],
      mostRestrictiveVisibility: 'private_to_owner',
      highestSensitivityLevel: 'internal',
      requiresHumanApproval: false,
    },
    reason: 'The invocation produced useful continuity context.',
    warnings: [],
    ...overrides,
  };
}

test('writeDurableMemoryRecord writes an approved candidate as a governed memory record', async () => {
  const masRootPath = await createTemporaryMasRoot();
  const now = '2026-04-14T10:00:00.000Z';
  const writeResult = await writeDurableMemoryRecord({
    masRootPath,
    writeCandidate: buildApprovedWriteCandidate(),
    memoryRecordId: 'mem_maria_complaint_summary',
    now,
  });
  const persistedPayload = JSON.parse(await readFile(writeResult.memoryRecordPath, 'utf8'));

  assert.equal(writeResult.created, true);
  assert.equal(writeResult.memoryRecord.kind, 'memory_record');
  assert.equal(writeResult.memoryRecord.memoryRecordId, 'mem_maria_complaint_summary');
  assert.equal(writeResult.memoryRecord.memoryType, 'conversation_summary');
  assert.equal(writeResult.memoryRecord.approvalState, 'approved');
  assert.equal(writeResult.memoryRecord.lifecycleStatus, 'active');
  assert.equal(writeResult.memoryRecord.createdAt, now);
  assert.equal(writeResult.memoryRecord.updatedAt, now);
  assert.equal(writeResult.memoryRecord.sourceReferences.length, 1);
  assert.equal(writeResult.memoryRecord.subjectReferences.length, 2);
  assert.deepEqual(persistedPayload, writeResult.memoryRecord);
});

test('buildDurableMemoryRecordFromWriteCandidate creates stable memory IDs from write IDs', () => {
  const memoryRecord = buildDurableMemoryRecordFromWriteCandidate({
    writeCandidate: buildApprovedWriteCandidate(),
    now: VALID_CREATED_AT,
  });

  assert.equal(
    memoryRecord.memoryRecordId,
    createDurableMemoryRecordIdFromWriteId('write_conversation_summary_001'),
  );
});

test('writeDurableMemoryRecord rejects unapproved write candidates', async () => {
  const masRootPath = await createTemporaryMasRoot();

  await assert.rejects(
    () => writeDurableMemoryRecord({
      masRootPath,
      writeCandidate: buildApprovedWriteCandidate({
        approvalState: 'pending',
      }),
      now: VALID_CREATED_AT,
    }),
    /Only approved memory write candidates/,
  );
});

test('writeDurableMemoryRecord rejects candidates without source references', async () => {
  const masRootPath = await createTemporaryMasRoot();

  await assert.rejects(
    () => writeDurableMemoryRecord({
      masRootPath,
      writeCandidate: buildApprovedWriteCandidate({
        sourceReferences: [],
      }),
      now: VALID_CREATED_AT,
    }),
    /must include at least one source reference/,
  );
});

test('writeDurableMemoryRecord rejects missing governance metadata through the memory contracts', async () => {
  const masRootPath = await createTemporaryMasRoot();

  await assert.rejects(
    () => writeDurableMemoryRecord({
      masRootPath,
      writeCandidate: {
        ...buildApprovedWriteCandidate(),
        portability: undefined,
      },
      now: VALID_CREATED_AT,
    }),
    /portability must be a non-empty string/,
  );
});

test('writeDurableMemoryRecord prevents duplicate durable memory record IDs', async () => {
  const masRootPath = await createTemporaryMasRoot();
  const memoryRecordId = 'mem_duplicate_test';

  await writeDurableMemoryRecord({
    masRootPath,
    writeCandidate: buildApprovedWriteCandidate(),
    memoryRecordId,
    now: VALID_CREATED_AT,
  });

  await assert.rejects(
    () => writeDurableMemoryRecord({
      masRootPath,
      writeCandidate: buildApprovedWriteCandidate({
        writeId: 'write_conversation_summary_002',
      }),
      memoryRecordId,
      now: VALID_CREATED_AT,
    }),
    /already exists/,
  );
});

test('writeDurableMemoryRecord rejects unsafe durable memory record IDs', async () => {
  const masRootPath = await createTemporaryMasRoot();

  await assert.rejects(
    () => writeDurableMemoryRecord({
      masRootPath,
      writeCandidate: buildApprovedWriteCandidate(),
      memoryRecordId: '../escape',
      now: VALID_CREATED_AT,
    }),
    /unsafe characters/,
  );
});

test('readDurableMemoryRecords reads valid durable memory records deterministically', async () => {
  const masRootPath = await createTemporaryMasRoot();

  await writeDurableMemoryRecord({
    masRootPath,
    writeCandidate: buildApprovedWriteCandidate({
      writeId: 'write_b',
      summary: 'B record.',
    }),
    memoryRecordId: 'mem_b',
    now: VALID_CREATED_AT,
  });
  await writeDurableMemoryRecord({
    masRootPath,
    writeCandidate: buildApprovedWriteCandidate({
      writeId: 'write_a',
      summary: 'A record.',
    }),
    memoryRecordId: 'mem_a',
    now: VALID_CREATED_AT,
  });

  const readResult = await readDurableMemoryRecords({ masRootPath });

  assert.deepEqual(
    readResult.memoryRecords.map((memoryRecord) => memoryRecord.memoryRecordId),
    ['mem_a', 'mem_b'],
  );
  assert.equal(readResult.recordFiles[0].durableMemoryPath, 'memory/durable/memory-record-mem_a.json');
  assert.equal(readResult.summary.recordsRead, 2);
  assert.equal(readResult.summary.warnings, 0);
});

test('readDurableMemoryRecords warns or fails for malformed durable memory files', async () => {
  const masRootPath = await createTemporaryMasRoot();
  const durableMemoryRootPath = path.join(masRootPath, 'memory', 'durable');

  await mkdir(durableMemoryRootPath, { recursive: true });
  await writeFile(
    path.join(durableMemoryRootPath, createDurableMemoryRecordFileName('mem_valid')),
    `${JSON.stringify(buildDurableMemoryRecordFromWriteCandidate({
      writeCandidate: buildApprovedWriteCandidate(),
      memoryRecordId: 'mem_valid',
      now: VALID_CREATED_AT,
    }), null, 2)}\n`,
    'utf8',
  );
  await writeFile(path.join(durableMemoryRootPath, 'memory-record-malformed.json'), '{not-json', 'utf8');
  await writeFile(path.join(durableMemoryRootPath, 'notes.txt'), 'not a durable memory record', 'utf8');

  const nonStrictReadResult = await readDurableMemoryRecords({ masRootPath });

  assert.equal(nonStrictReadResult.memoryRecords.length, 1);
  assert.equal(nonStrictReadResult.warnings.length, 2);
  assert.equal(nonStrictReadResult.warnings.some((warning) => warning.includes('malformed')), true);
  assert.equal(nonStrictReadResult.warnings.some((warning) => warning.includes('non-JSON')), true);

  await assert.rejects(
    () => readDurableMemoryRecords({
      masRootPath,
      strict: true,
    }),
    /Failed to read durable memory record memory-record-malformed\.json/,
  );
});
