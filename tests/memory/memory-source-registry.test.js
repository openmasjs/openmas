import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import {
  assertMemorySourceRegistry,
  selectActiveMemorySources,
} from '../../src/contracts/memory-source-registry-contract.js';
import { buildDefaultMemorySourceRegistry } from '../../src/memory/build-default-memory-source-registry.js';
import { readMemorySourceRegistry } from '../../src/memory/read-memory-source-registry.js';

async function createTemporaryMasRoot() {
  const temporaryRootPath = await mkdtemp(path.join(os.tmpdir(), 'openmas-memory-sources-'));
  const masRootPath = path.join(temporaryRootPath, 'instance');

  await mkdir(path.join(masRootPath, 'memory'), { recursive: true });

  return masRootPath;
}

function buildCustomRegistry(overrides = {}) {
  return {
    kind: 'memory_source_registry',
    version: 1,
    memorySources: [
      {
        sourceId: 'community-manager-memory',
        sourceType: 'cognitive_identity_memory_directory',
        rootPath: 'cognitive-identities/marketing-and-sales/community-manager/memory',
        scope: 'cognitive_identity',
        ownerId: 'community-manager',
        defaultPortability: 'portable',
        defaultVisibility: 'shared_with_mas',
        defaultSensitivityLevel: 'internal',
        lifecycleState: 'active',
        readPolicy: {
          maxFiles: 5,
          maxBytesPerFile: 16384,
        },
        description: 'Portable Community Manager expert memory.',
      },
    ],
    ...overrides,
  };
}

test('assertMemorySourceRegistry accepts a valid governed memory source registry', () => {
  const registry = assertMemorySourceRegistry(buildCustomRegistry({
    memorySources: [
      {
        sourceId: 'community-manager-memory',
        sourceType: 'cognitive_identity_memory_directory',
        rootPath: ' cognitive-identities\\marketing-and-sales\\community-manager\\memory ',
        scope: 'cognitive_identity',
        ownerId: ' community-manager ',
        defaultPortability: 'portable',
        defaultVisibility: 'shared_with_mas',
        defaultSensitivityLevel: 'internal',
        lifecycleState: 'active',
        readPolicy: {
          maxFiles: 5,
          maxBytesPerFile: 16384,
        },
      },
    ],
  }));

  assert.equal(registry.kind, 'memory_source_registry');
  assert.equal(registry.memorySources.length, 1);
  assert.equal(registry.memorySources[0].sourceId, 'community-manager-memory');
  assert.equal(registry.memorySources[0].rootPath, 'cognitive-identities/marketing-and-sales/community-manager/memory');
  assert.equal(registry.memorySources[0].ownerId, 'community-manager');
  assert.equal(registry.memorySources[0].defaultPortability, 'portable');
});

test('assertMemorySourceRegistry accepts durable memory as a governed MAS source type', () => {
  const registry = assertMemorySourceRegistry(buildCustomRegistry({
    memorySources: [
      {
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
          maxFiles: 25,
          maxBytesPerFile: 32768,
        },
        description: 'Curated durable MAS memory records.',
      },
    ],
  }));

  assert.equal(registry.memorySources.length, 1);
  assert.equal(registry.memorySources[0].sourceId, 'durable-memory');
  assert.equal(registry.memorySources[0].sourceType, 'durable_memory_directory');
  assert.equal(registry.memorySources[0].rootPath, 'memory/durable');
  assert.equal(registry.memorySources[0].scope, 'mas_instance');
});

test('buildDefaultMemorySourceRegistry returns the safe initial MAS memory sources', () => {
  const registry = buildDefaultMemorySourceRegistry({ masOwnerId: 'sin-cuchillo' });

  assert.equal(registry.kind, 'memory_source_registry');
  assert.deepEqual(
    registry.memorySources.map((source) => source.sourceId),
    ['runtime-state', 'runtime-artifacts', 'knowledge', 'policies', 'durable-memory', 'conversation-state'],
  );
  assert.equal(registry.memorySources[0].scope, 'mas_instance');
  assert.equal(registry.memorySources[0].ownerId, 'sin-cuchillo');
  assert.equal(registry.memorySources[0].defaultPortability, 'mas_bound');
  assert.equal(registry.memorySources[0].defaultVisibility, 'restricted');
  assert.equal(registry.memorySources[2].defaultVisibility, 'shared_with_mas');
  assert.equal(registry.memorySources[4].sourceType, 'durable_memory_directory');
  assert.equal(registry.memorySources[4].rootPath, 'memory/durable');
  assert.equal(registry.memorySources[4].readPolicy.maxFiles, 50);
  assert.equal(registry.memorySources[4].readPolicy.maxBytesPerFile, 65536);
  assert.equal(registry.memorySources[5].sourceType, 'conversation_state_directory');
  assert.equal(registry.memorySources[5].rootPath, 'memory/state/conversations');
  assert.equal(registry.memorySources.some((source) => source.sourceType === 'operational_identity_memory_directory'), false);
  assert.equal(registry.memorySources.some((source) => source.sourceType === 'cognitive_identity_memory_directory'), false);
});

test('readMemorySourceRegistry returns a validated default registry when sources.json is missing', async () => {
  const masRootPath = await createTemporaryMasRoot();

  const { registryPath, registry, usedDefaultRegistry } = await readMemorySourceRegistry({
    masRootPath,
    masOwnerId: 'sin-cuchillo',
  });

  assert.equal(registryPath, path.join(masRootPath, 'memory', 'sources.json'));
  assert.equal(usedDefaultRegistry, true);
  assert.equal(registry.memorySources.length, 6);
  assert.equal(registry.memorySources[0].ownerId, 'sin-cuchillo');
});

test('readMemorySourceRegistry reads a custom MAS-owned sources.json registry', async () => {
  const masRootPath = await createTemporaryMasRoot();

  await writeFile(
    path.join(masRootPath, 'memory', 'sources.json'),
    JSON.stringify(buildCustomRegistry(), null, 2),
    'utf8',
  );

  const { registry, usedDefaultRegistry } = await readMemorySourceRegistry({ masRootPath });

  assert.equal(usedDefaultRegistry, false);
  assert.equal(registry.memorySources.length, 1);
  assert.equal(registry.memorySources[0].sourceType, 'cognitive_identity_memory_directory');
  assert.equal(registry.memorySources[0].scope, 'cognitive_identity');
});

test('assertMemorySourceRegistry rejects duplicated source IDs', () => {
  assert.throws(
    () => assertMemorySourceRegistry(buildCustomRegistry({
      memorySources: [
        buildCustomRegistry().memorySources[0],
        {
          ...buildCustomRegistry().memorySources[0],
          rootPath: 'memory/knowledge',
        },
      ],
    })),
    /duplicated sourceId/,
  );
});

test('assertMemorySourceRegistry rejects absolute and traversal root paths', () => {
  assert.throws(
    () => assertMemorySourceRegistry(buildCustomRegistry({
      memorySources: [
        {
          ...buildCustomRegistry().memorySources[0],
          rootPath: path.resolve('outside'),
        },
      ],
    })),
    /must not be absolute/,
  );

  assert.throws(
    () => assertMemorySourceRegistry(buildCustomRegistry({
      memorySources: [
        {
          ...buildCustomRegistry().memorySources[0],
          rootPath: '../outside',
        },
      ],
    })),
    /contains invalid path segments/,
  );
});

test('assertMemorySourceRegistry rejects unsafe registry roots and invalid read policies', () => {
  assert.throws(
    () => assertMemorySourceRegistry(buildCustomRegistry({
      memorySources: [
        {
          ...buildCustomRegistry().memorySources[0],
          rootPath: 'config/secrets',
        },
      ],
    })),
    /disallowed path segment: config/,
  );

  assert.throws(
    () => assertMemorySourceRegistry(buildCustomRegistry({
      memorySources: [
        {
          ...buildCustomRegistry().memorySources[0],
          readPolicy: {
            maxFiles: 0,
            maxBytesPerFile: 1024,
          },
        },
      ],
    })),
    /maxFiles must be a positive integer/,
  );
});

test('assertMemorySourceRegistry applies bounded path rules to durable memory sources', () => {
  assert.throws(
    () => assertMemorySourceRegistry(buildCustomRegistry({
      memorySources: [
        {
          ...buildCustomRegistry().memorySources[0],
          sourceId: 'durable-memory',
          sourceType: 'durable_memory_directory',
          rootPath: '../memory/durable',
          scope: 'mas_instance',
          ownerId: 'sin-cuchillo',
          defaultPortability: 'not_exportable',
        },
      ],
    })),
    /contains invalid path segments/,
  );

  assert.throws(
    () => assertMemorySourceRegistry(buildCustomRegistry({
      memorySources: [
        {
          ...buildCustomRegistry().memorySources[0],
          sourceId: 'durable-memory',
          sourceType: 'durable_memory_directory',
          rootPath: 'config/durable',
          scope: 'mas_instance',
          ownerId: 'sin-cuchillo',
          defaultPortability: 'not_exportable',
        },
      ],
    })),
    /disallowed path segment: config/,
  );
});

test('selectActiveMemorySources preserves disabled sources in the registry but excludes them from active selection', () => {
  const registry = assertMemorySourceRegistry(buildCustomRegistry({
    memorySources: [
      buildCustomRegistry().memorySources[0],
      {
        sourceId: 'durable-memory',
        sourceType: 'durable_memory_directory',
        rootPath: 'memory/durable',
        scope: 'mas_instance',
        ownerId: 'sin-cuchillo',
        defaultPortability: 'mas_bound',
        defaultVisibility: 'shared_with_mas',
        defaultSensitivityLevel: 'internal',
        lifecycleState: 'disabled',
        readPolicy: {
          maxFiles: 3,
          maxBytesPerFile: 4096,
        },
      },
    ],
  }));

  const activeSources = selectActiveMemorySources(registry);

  assert.equal(registry.memorySources.length, 2);
  assert.equal(activeSources.length, 1);
  assert.equal(activeSources[0].sourceId, 'community-manager-memory');
  assert.equal(registry.memorySources[1].lifecycleState, 'disabled');
});

test('readMemorySourceRegistry fails clearly for invalid custom registries', async () => {
  const masRootPath = await createTemporaryMasRoot();

  await writeFile(
    path.join(masRootPath, 'memory', 'sources.json'),
    JSON.stringify({
      kind: 'memory_source_registry',
      version: 1,
      memorySources: [
        {
          sourceId: 'invalid-source',
          sourceType: 'raw_prompt_dump',
          rootPath: 'memory/state',
          scope: 'mas_instance',
          ownerId: 'sin-cuchillo',
          defaultPortability: 'mas_bound',
          defaultVisibility: 'restricted',
          defaultSensitivityLevel: 'internal',
          lifecycleState: 'active',
          readPolicy: {
            maxFiles: 10,
            maxBytesPerFile: 32768,
          },
        },
      ],
    }, null, 2),
    'utf8',
  );

  await assert.rejects(
    () => readMemorySourceRegistry({ masRootPath }),
    /sourceType is invalid: raw_prompt_dump/,
  );
});
