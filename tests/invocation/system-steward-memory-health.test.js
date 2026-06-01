import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { runDeterministicCommand } from '../../instance/cognitive-identities/system-steward/commands/memory-health.js';
import { assertMemoryRecord } from '../../src/contracts/memory/memory-record-contract.js';
import { createDurableMemoryRecordFileName } from '../../src/memory/write-durable-memory-record.js';
import { buildFakeOpenRouterSecretProbe } from '../helpers/fake-secret-probes.js';

const VALID_CREATED_AT = '2026-04-14T00:00:00.000Z';
const VALID_SHA_256 = 'b'.repeat(64);
const SECRET_LOOKING_VALUE = buildFakeOpenRouterSecretProbe('abcdefghijklmnopqrstuvwxyz123456');

async function createTemporaryMasRoot() {
  const temporaryRootPath = await mkdtemp(path.join(os.tmpdir(), 'openmas-memory-health-'));
  const masRootPath = path.join(temporaryRootPath, 'instance');
  const directories = [
    'cognitive-identities/system-steward',
    'memory/state',
    'memory/artifacts',
    'memory/knowledge',
    'memory/policies',
    'memory/durable',
    'registries',
  ];

  for (const directory of directories) {
    await mkdir(path.join(masRootPath, directory), { recursive: true });
  }

  await writeFile(
    path.join(masRootPath, 'registries', 'cognitive-identities.json'),
    JSON.stringify({
      kind: 'cognitive_identities_registry',
      version: 1,
      cognitiveIdentities: [
        {
          cognitiveIdentityId: 'system-steward',
          rootPath: 'system-steward',
          category: 'platform',
        },
      ],
    }, null, 2),
    'utf8',
  );

  return masRootPath;
}

function buildSourceReference(overrides = {}) {
  return {
    kind: 'memory_source_reference',
    version: 1,
    sourceType: 'knowledge_document',
    sourceId: 'memory-health-fixture.md',
    scope: 'mas_instance',
    ownerId: 'sin-cuchillo',
    path: 'memory/knowledge/memory-health-fixture.md',
    origin: 'administrator_curated',
    sensitivityLevel: 'internal',
    createdAt: VALID_CREATED_AT,
    contentSha256: VALID_SHA_256,
    ...overrides,
  };
}

function buildMemoryRecord(overrides = {}) {
  return assertMemoryRecord({
    kind: 'memory_record',
    version: 1,
    memoryRecordId: 'mem_memory_health_secret_fixture',
    memoryType: 'company_fact',
    scope: 'mas_instance',
    ownerId: 'sin-cuchillo',
    origin: 'human_approved',
    portability: 'not_exportable',
    visibility: 'shared_with_mas',
    approvalState: 'approved',
    lifecycleStatus: 'active',
    sensitivityLevel: 'internal',
    confidence: 'human_approved',
    authorityLevel: 'mas_guidance',
    summary: 'Memory health fixture contains a secret-looking value.',
    content: `This content intentionally contains ${SECRET_LOOKING_VALUE} for audit detection.`,
    sourceReferences: [buildSourceReference()],
    subjectReferences: [
      {
        subjectType: 'mas_instance',
        subjectId: 'sin-cuchillo',
        relationship: 'owner',
      },
    ],
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
    createdAt: VALID_CREATED_AT,
    updatedAt: VALID_CREATED_AT,
    warnings: [],
    ...overrides,
  });
}

async function writeDurableMemoryRecord({ masRootPath, memoryRecord }) {
  await writeFile(
    path.join(
      masRootPath,
      'memory',
      'durable',
      createDurableMemoryRecordFileName(memoryRecord.memoryRecordId),
    ),
    `${JSON.stringify(memoryRecord, null, 2)}\n`,
    'utf8',
  );
}

test('System Steward memory-health command audits governed memory without leaking raw secrets', async () => {
  const masRootPath = await createTemporaryMasRoot();

  await writeDurableMemoryRecord({
    masRootPath,
    memoryRecord: buildMemoryRecord(),
  });

  const outcome = await runDeterministicCommand({
    bootResult: {
      status: 'ready',
      masRootPath,
      invocationReadiness: {
        allowed: true,
      },
    },
    readiness: {
      auditActorId: 'system-steward.ops.alfred.v1',
      operationalIdentityDefinition: {
        operationalIdentityId: 'alfred',
        displayName: 'Alfred',
      },
    },
    request: {
      command: 'memory-health',
    },
  });
  const serializedPayload = JSON.stringify(outcome.outputPayload);

  assert.equal(outcome.reportKind, 'memory_health_diagnostic_report');
  assert.match(outcome.message, /memory health diagnostic report/i);
  assert.match(outcome.reportContent, /Memory Health Diagnostic Report/);
  assert.match(outcome.reportContent, /possible_secret_value/);
  assert.doesNotMatch(outcome.reportContent, new RegExp(SECRET_LOOKING_VALUE, 'u'));
  assert.doesNotMatch(serializedPayload, new RegExp(SECRET_LOOKING_VALUE, 'u'));
  assert.equal(outcome.outputPayload.operationalIdentityId, 'alfred');
  assert.equal(outcome.outputPayload.memoryHealth.collectionSummary.memoryRecordsCollected, 1);
  assert.equal(outcome.outputPayload.memoryHealth.auditSummary.criticalFindings, 1);
  assert.equal(outcome.outputPayload.memoryHealth.findings.some((finding) => {
    return finding.findingType === 'possible_secret_value';
  }), true);
  assert.equal(outcome.outputPayload.memoryHealth.sourceResults.some((sourceResult) => {
    return sourceResult.sourceId === 'durable-memory' && sourceResult.memoryRecords === 1;
  }), true);
});
