import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdir, mkdtemp, utimes, writeFile } from 'node:fs/promises';
import { buildDefaultMemorySourceRegistry } from '../../src/memory/build-default-memory-source-registry.js';
import { readRuntimeStateMemory } from '../../src/memory/read-runtime-state-memory.js';
import { readRuntimeArtifactMemory } from '../../src/memory/read-runtime-artifact-memory.js';
import { readKnowledgeMemory } from '../../src/memory/read-knowledge-memory.js';
import { readPolicyMemory } from '../../src/memory/read-policy-memory.js';
import { collectMemoryRecordsForInvocation } from '../../src/memory/collect-memory-records-for-invocation.js';
import { createDurableMemoryRecordFileName } from '../../src/memory/write-durable-memory-record.js';

const VALID_SHA_256 = 'f'.repeat(64);
const VALID_CREATED_AT = '2026-04-14T12:00:00.000Z';

async function createTemporaryMasRoot() {
  const temporaryRootPath = await mkdtemp(path.join(os.tmpdir(), 'openmas-bounded-memory-'));
  const masRootPath = path.join(temporaryRootPath, 'instance');

  await mkdir(path.join(masRootPath, 'memory', 'state'), { recursive: true });
  await mkdir(path.join(masRootPath, 'memory', 'artifacts'), { recursive: true });
  await mkdir(path.join(masRootPath, 'memory', 'knowledge'), { recursive: true });
  await mkdir(path.join(masRootPath, 'memory', 'policies'), { recursive: true });

  return masRootPath;
}

function getDefaultSource(sourceId, overrides = {}) {
  const registry = buildDefaultMemorySourceRegistry({ masOwnerId: 'sin-cuchillo' });
  const sourceDefinition = registry.memorySources.find((source) => source.sourceId === sourceId);

  return {
    ...sourceDefinition,
    ...overrides,
    readPolicy: {
      ...sourceDefinition.readPolicy,
      ...(overrides.readPolicy ?? {}),
    },
  };
}

function buildDurableMemorySource(overrides = {}) {
  return {
    sourceId: 'durable-memory',
    sourceType: 'durable_memory_directory',
    rootPath: 'memory/durable',
    scope: 'mas_instance',
    ownerId: 'sin-cuchillo',
    defaultPortability: 'not_exportable',
    defaultVisibility: 'shared_with_mas',
    defaultSensitivityLevel: 'internal',
    lifecycleState: 'active',
    readPolicy: {
      maxFiles: 10,
      maxBytesPerFile: 32768,
    },
    ...overrides,
  };
}

function buildDurableMemoryRecord(overrides = {}) {
  return {
    kind: 'memory_record',
    version: 1,
    memoryRecordId: 'mem_company_profile',
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
    summary: 'Sin Cuchillo is a premium meat store.',
    content: 'Sin Cuchillo sells premium meat products and serves local customers.',
    sourceReferences: [
      {
        kind: 'memory_source_reference',
        version: 1,
        sourceType: 'knowledge_document',
        sourceId: 'company-profile.md',
        scope: 'mas_instance',
        ownerId: 'sin-cuchillo',
        path: 'memory/knowledge/company-profile.md',
        origin: 'administrator_curated',
        sensitivityLevel: 'internal',
        createdAt: VALID_CREATED_AT,
        contentSha256: VALID_SHA_256,
      },
    ],
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
  };
}

async function writeJsonFile(filePath, payload, modifiedAt) {
  await writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8');

  if (modifiedAt) {
    await utimes(filePath, modifiedAt, modifiedAt);
  }
}

async function writeDurableMemoryRecordFile({ masRootPath, memoryRecord }) {
  const durableMemoryRootPath = path.join(masRootPath, 'memory', 'durable');

  await mkdir(durableMemoryRootPath, { recursive: true });
  await writeJsonFile(
    path.join(durableMemoryRootPath, createDurableMemoryRecordFileName(memoryRecord.memoryRecordId)),
    memoryRecord,
  );
}

async function writeTextFile(filePath, content, modifiedAt) {
  await writeFile(filePath, content, 'utf8');

  if (modifiedAt) {
    await utimes(filePath, modifiedAt, modifiedAt);
  }
}

test('readRuntimeStateMemory reads recent invocation sessions as runtime evidence', async () => {
  const masRootPath = await createTemporaryMasRoot();
  const stateSource = getDefaultSource('runtime-state', {
    readPolicy: {
      maxFiles: 2,
      maxBytesPerFile: 8192,
    },
  });

  await writeJsonFile(
    path.join(masRootPath, 'memory', 'state', 'agent-invocation-old.json'),
    {
      kind: 'agent_invocation_session',
      invocationId: 'old',
      primaryCognitiveIdentityId: 'community-manager',
      request: {
        command: 'hello',
        invocationMode: 'deterministic',
      },
      readinessStatus: 'ready',
      message: 'Old invocation message.',
      startedAt: '2026-04-14T10:00:00.000Z',
      finishedAt: '2026-04-14T10:00:01.000Z',
      brainOutput: {
        outputText: 'This raw provider text must not become memory content.',
      },
    },
    new Date('2026-04-14T10:00:00.000Z'),
  );

  await writeJsonFile(
    path.join(masRootPath, 'memory', 'state', 'agent-invocation-newer.json'),
    {
      kind: 'agent_invocation_session',
      invocationId: 'newer',
      operationalIdentityId: 'maria',
      primaryCognitiveIdentityId: 'community-manager',
      executionType: 'probabilistic_brain',
      request: {
        command: 'ask',
        invocationMode: 'probabilistic',
      },
      readinessStatus: 'ready',
      message: 'Maria answered through OpenRouter.',
      startedAt: '2026-04-14T11:00:00.000Z',
      finishedAt: '2026-04-14T11:00:01.000Z',
      brainOutput: {
        outputText: 'A long answer that must not be dumped into memory.',
      },
    },
    new Date('2026-04-14T11:00:00.000Z'),
  );

  await writeJsonFile(
    path.join(masRootPath, 'memory', 'state', 'agent-invocation-newest.json'),
    {
      kind: 'agent_invocation_session',
      invocationId: 'newest',
      operationalIdentityId: 'juan',
      primaryCognitiveIdentityId: 'media-buyer',
      executionType: 'deterministic_command',
      request: {
        command: 'inspect',
        invocationMode: 'deterministic',
      },
      readinessStatus: 'ready',
      message: 'Juan inspected the campaign state.',
      startedAt: '2026-04-14T12:00:00.000Z',
      finishedAt: '2026-04-14T12:00:01.000Z',
    },
    new Date('2026-04-14T12:00:00.000Z'),
  );

  const result = await readRuntimeStateMemory({
    masRootPath,
    sourceDefinition: stateSource,
  });

  assert.equal(result.memoryRecords.length, 2);
  assert.equal(result.memoryRecords[0].sourceReferences[0].sourceId, 'newest');
  assert.equal(result.memoryRecords[1].sourceReferences[0].sourceId, 'newer');
  assert.equal(result.memoryRecords[0].memoryType, 'runtime_evidence');
  assert.equal(result.memoryRecords[0].content, null);
  assert.equal(result.memoryRecords[1].summary.includes('A long answer that must not be dumped'), false);
  assert.equal(result.memoryRecords[1].subjectReferences.some((subject) => subject.subjectId === 'maria'), true);
  assert.equal(result.warnings.some((warning) => warning.includes('maxFiles limit')), true);
});

test('readRuntimeArtifactMemory reads artifacts as references without raw report bodies', async () => {
  const masRootPath = await createTemporaryMasRoot();
  const artifactSource = getDefaultSource('runtime-artifacts');
  const reportContent = '# Complaint Report\n\nSensitive body that should not become memory content.\n';

  await writeTextFile(
    path.join(masRootPath, 'memory', 'artifacts', 'complaint-report-1.md'),
    reportContent,
    new Date('2026-04-14T12:00:00.000Z'),
  );

  const result = await readRuntimeArtifactMemory({
    masRootPath,
    sourceDefinition: artifactSource,
  });

  assert.equal(result.memoryRecords.length, 1);
  assert.equal(result.memoryRecords[0].memoryType, 'artifact_reference');
  assert.equal(result.memoryRecords[0].content, null);
  assert.equal(result.memoryRecords[0].summary.includes('complaint-report-1.md'), true);
  assert.equal(result.memoryRecords[0].summary.includes('Sensitive body'), false);
  assert.equal(result.memoryRecords[0].warnings.some((warning) => warning.includes('not included')), true);
});

test('readKnowledgeMemory reads bounded knowledge files with governance metadata', async () => {
  const masRootPath = await createTemporaryMasRoot();
  const knowledgeSource = getDefaultSource('knowledge');

  await writeTextFile(
    path.join(masRootPath, 'memory', 'knowledge', 'company-profile.md'),
    '# Sin Cuchillo Company Profile\n\nSin Cuchillo sells premium meat products.',
    new Date('2026-04-14T12:00:00.000Z'),
  );

  const result = await readKnowledgeMemory({
    masRootPath,
    sourceDefinition: knowledgeSource,
  });

  assert.equal(result.memoryRecords.length, 1);
  assert.equal(result.memoryRecords[0].memoryType, 'company_fact');
  assert.equal(result.memoryRecords[0].scope, 'mas_instance');
  assert.equal(result.memoryRecords[0].ownerId, 'sin-cuchillo');
  assert.equal(result.memoryRecords[0].portability, 'not_exportable');
  assert.equal(result.memoryRecords[0].visibility, 'shared_with_mas');
  assert.equal(result.memoryRecords[0].content.includes('Sin Cuchillo sells premium meat products'), true);
});

test('readPolicyMemory reads bounded policy files as policy context', async () => {
  const masRootPath = await createTemporaryMasRoot();
  const policySource = getDefaultSource('policies');

  await writeTextFile(
    path.join(masRootPath, 'memory', 'policies', 'complaints.md'),
    '# Complaint Handling Policy\n\nSerious complaints must be handled calmly.',
    new Date('2026-04-14T12:00:00.000Z'),
  );

  const result = await readPolicyMemory({
    masRootPath,
    sourceDefinition: policySource,
  });

  assert.equal(result.memoryRecords.length, 1);
  assert.equal(result.memoryRecords[0].memoryType, 'policy_context');
  assert.equal(result.memoryRecords[0].authorityLevel, 'policy');
  assert.equal(result.memoryRecords[0].confidence, 'human_approved');
  assert.equal(result.memoryRecords[0].sourceReferences[0].sourceType, 'policy_document');
});

test('readKnowledgeMemory warns and skips oversized files', async () => {
  const masRootPath = await createTemporaryMasRoot();
  const knowledgeSource = getDefaultSource('knowledge', {
    readPolicy: {
      maxFiles: 10,
      maxBytesPerFile: 20,
    },
  });

  await writeTextFile(
    path.join(masRootPath, 'memory', 'knowledge', 'large-company-note.md'),
    'This content is intentionally much larger than twenty bytes.',
  );

  const result = await readKnowledgeMemory({
    masRootPath,
    sourceDefinition: knowledgeSource,
  });

  assert.equal(result.memoryRecords.length, 0);
  assert.equal(result.warnings.some((warning) => warning.includes('oversized file')), true);
});

test('readRuntimeStateMemory rejects unsafe source roots through bounded path validation', async () => {
  const masRootPath = await createTemporaryMasRoot();

  await assert.rejects(
    () => readRuntimeStateMemory({
      masRootPath,
      sourceDefinition: {
        ...getDefaultSource('runtime-state'),
        rootPath: '../outside',
      },
    }),
    /contains invalid path segments/,
  );
});

test('collectMemoryRecordsForInvocation ignores disabled sources and returns deterministic collected records', async () => {
  const masRootPath = await createTemporaryMasRoot();
  const registry = {
    kind: 'memory_source_registry',
    version: 1,
    memorySources: [
      {
        ...getDefaultSource('knowledge', {
          readPolicy: {
            maxFiles: 5,
            maxBytesPerFile: 4096,
          },
        }),
      },
      {
        ...getDefaultSource('policies'),
        lifecycleState: 'disabled',
      },
    ],
  };

  await writeTextFile(
    path.join(masRootPath, 'memory', 'knowledge', 'brand-rules.md'),
    '# Brand Rules\n\nThe brand voice is warm and precise.',
  );
  await writeTextFile(
    path.join(masRootPath, 'memory', 'policies', 'disabled-policy.md'),
    '# Disabled Policy\n\nThis should not be read.',
  );

  const result = await collectMemoryRecordsForInvocation({
    masRootPath,
    memorySourceRegistry: registry,
  });

  assert.equal(result.summary.sourcesRegistered, 2);
  assert.equal(result.summary.sourcesRead, 1);
  assert.equal(result.memoryRecords.length, 1);
  assert.equal(result.memoryRecords[0].memoryType, 'brand_rule');
  assert.equal(result.memoryRecords[0].sourceReferences[0].sourceId, 'brand-rules.md');
});

test('collectMemoryRecordsForInvocation reads bounded operational identity memory sources', async () => {
  const masRootPath = await createTemporaryMasRoot();
  await mkdir(path.join(masRootPath, 'operational-identities', 'maria', 'memory'), { recursive: true });
  await writeTextFile(
    path.join(masRootPath, 'operational-identities', 'maria', 'memory', 'relationship-note.md'),
    'Maria learned that Carlos prefers concise community updates.',
  );

  const registry = {
    kind: 'memory_source_registry',
    version: 1,
    memorySources: [
      {
        sourceId: 'maria-private-memory',
        sourceType: 'operational_identity_memory_directory',
        rootPath: 'operational-identities/maria/memory',
        scope: 'operational_identity',
        ownerId: 'maria',
        defaultPortability: 'mas_bound',
        defaultVisibility: 'private_to_owner',
        defaultSensitivityLevel: 'internal',
        lifecycleState: 'active',
        readPolicy: {
          maxFiles: 5,
          maxBytesPerFile: 4096,
        },
      },
    ],
  };

  const result = await collectMemoryRecordsForInvocation({
    masRootPath,
    memorySourceRegistry: registry,
  });

  assert.equal(result.memoryRecords.length, 1);
  assert.equal(result.memoryRecords[0].scope, 'operational_identity');
  assert.equal(result.memoryRecords[0].ownerId, 'maria');
  assert.equal(result.memoryRecords[0].sourceReferences[0].sourceType, 'operational_identity_memory');
});

test('collectMemoryRecordsForInvocation reads active durable memory sources deterministically', async () => {
  const masRootPath = await createTemporaryMasRoot();

  await writeDurableMemoryRecordFile({
    masRootPath,
    memoryRecord: buildDurableMemoryRecord({
      memoryRecordId: 'mem_b',
      summary: 'B durable company memory.',
    }),
  });
  await writeDurableMemoryRecordFile({
    masRootPath,
    memoryRecord: buildDurableMemoryRecord({
      memoryRecordId: 'mem_a',
      summary: 'A durable company memory.',
    }),
  });

  const result = await collectMemoryRecordsForInvocation({
    masRootPath,
    memorySourceRegistry: {
      kind: 'memory_source_registry',
      version: 1,
      memorySources: [buildDurableMemorySource()],
    },
  });

  assert.equal(result.summary.sourcesRegistered, 1);
  assert.equal(result.summary.sourcesRead, 1);
  assert.equal(result.summary.memoryRecordsCollected, 2);
  assert.equal(result.sourceResults[0].sourceId, 'durable-memory');
  assert.deepEqual(
    result.memoryRecords.map((memoryRecord) => memoryRecord.memoryRecordId),
    ['mem_a', 'mem_b'],
  );
  assert.equal(result.memoryRecords[0].kind, 'memory_record');
  assert.equal(result.memoryRecords[0].sourceReferences[0].sourceType, 'knowledge_document');
  assert.equal(result.sourceResults[0].recordFiles[0].durableMemoryPath, 'memory/durable/memory-record-mem_a.json');
});

test('collectMemoryRecordsForInvocation reports malformed durable memory without blocking collection', async () => {
  const masRootPath = await createTemporaryMasRoot();
  const durableMemoryRootPath = path.join(masRootPath, 'memory', 'durable');

  await writeDurableMemoryRecordFile({
    masRootPath,
    memoryRecord: buildDurableMemoryRecord({
      memoryRecordId: 'mem_valid',
      summary: 'Valid durable company memory.',
    }),
  });
  await writeFile(path.join(durableMemoryRootPath, 'memory-record-malformed.json'), '{not-json', 'utf8');

  const result = await collectMemoryRecordsForInvocation({
    masRootPath,
    memorySourceRegistry: {
      kind: 'memory_source_registry',
      version: 1,
      memorySources: [buildDurableMemorySource()],
    },
  });

  assert.equal(result.memoryRecords.length, 1);
  assert.equal(result.memoryRecords[0].memoryRecordId, 'mem_valid');
  assert.equal(result.warnings.length, 1);
  assert.equal(result.warnings[0].includes('Failed to read durable memory record memory-record-malformed.json'), true);
});

test('collectMemoryRecordsForInvocation applies durable memory read policy limits', async () => {
  const masRootPath = await createTemporaryMasRoot();

  await writeDurableMemoryRecordFile({
    masRootPath,
    memoryRecord: buildDurableMemoryRecord({
      memoryRecordId: 'mem_a',
      summary: 'A durable company memory.',
    }),
  });
  await writeDurableMemoryRecordFile({
    masRootPath,
    memoryRecord: buildDurableMemoryRecord({
      memoryRecordId: 'mem_b',
      summary: 'B durable company memory.',
    }),
  });

  const result = await collectMemoryRecordsForInvocation({
    masRootPath,
    memorySourceRegistry: {
      kind: 'memory_source_registry',
      version: 1,
      memorySources: [
        buildDurableMemorySource({
          readPolicy: {
            maxFiles: 1,
            maxBytesPerFile: 32768,
          },
        }),
      ],
    },
  });

  assert.deepEqual(
    result.memoryRecords.map((memoryRecord) => memoryRecord.memoryRecordId),
    ['mem_a'],
  );
  assert.equal(result.warnings.some((warning) => warning.includes('maxFiles limit')), true);
});
