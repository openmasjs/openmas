import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { runSystemBoot } from '../../src/boot/run-system-boot.js';
import { prepareAgentInvocation } from '../../src/invocation/prepare-agent-invocation.js';

async function createDirectoryTree(rootPath, relativePaths) {
  for (const relativePath of relativePaths) {
    await mkdir(path.join(rootPath, relativePath), { recursive: true });
  }
}

async function createProjectFixture({
  omitMasComponents = [],
  createAgentDefinition = true,
  omitAgentFiles = [],
  omitRegistryEntry = false,
  agentRegistryRootPath = 'system-steward',
} = {}) {
  const temporaryRootPath = await mkdtemp(path.join(os.tmpdir(), 'openmas-invocation-'));

  await writeFile(
    path.join(temporaryRootPath, 'package.json'),
    JSON.stringify(
      {
        name: 'openmas-fixture',
        private: true,
        type: 'module',
        openmas: {
          projectKind: 'framework',
          schemaVersion: 1,
        },
      },
      null,
      2,
    ),
    'utf8',
  );

  await createDirectoryTree(temporaryRootPath, [
    'bin',
    'src',
    'docs',
    'var',
    'tests',
    'config',
    'instance',
  ]);

  const masComponentPaths = [
    'instance/cognitive-identities',
    'instance/memory',
    'instance/memory/knowledge',
    'instance/memory/policies',
    'instance/memory/state',
    'instance/memory/artifacts',
    'instance/tools',
    'instance/workflows',
    'instance/registries',
    'instance/evaluations',
    'instance/operational-identities',
    'instance/operational-identities/alfred',
  ].filter((relativePath) => !omitMasComponents.includes(relativePath));

  await createDirectoryTree(temporaryRootPath, masComponentPaths);

  if (!omitMasComponents.includes('instance/registries')) {
    const cognitiveIdentities = omitRegistryEntry
      ? []
      : [
          {
            cognitiveIdentityId: 'system-steward',
            rootPath: agentRegistryRootPath,
            category: 'platform',
          },
        ];

    await writeFile(
      path.join(temporaryRootPath, 'instance', 'registries', 'cognitive-identities.json'),
      JSON.stringify(
        {
          kind: 'cognitive_identities_registry',
          version: 1,
          cognitiveIdentities,
        },
        null,
        2,
      ),
      'utf8',
    );

    await writeFile(
      path.join(temporaryRootPath, 'instance', 'registries', 'operational-identities.json'),
      JSON.stringify(
        {
          kind: 'operational_identities_registry',
          version: 1,
          operationalIdentities: [
            {
              operationalIdentityId: 'alfred',
              rootPath: 'alfred',
              category: 'platform',
            },
          ],
        },
        null,
        2,
      ),
      'utf8',
    );
  }

  if (createAgentDefinition) {
    const cognitiveIdentityRootPath = path.join(temporaryRootPath, 'instance', 'cognitive-identities', 'system-steward');
    await createDirectoryTree(temporaryRootPath, ['instance/cognitive-identities/system-steward', 'instance/cognitive-identities/system-steward/memory']);

    if (!omitAgentFiles.includes('identity.md')) {
      await writeFile(path.join(cognitiveIdentityRootPath, 'identity.md'), '# System Steward\n', 'utf8');
    }

    if (!omitAgentFiles.includes('policies.md')) {
      await writeFile(path.join(cognitiveIdentityRootPath, 'policies.md'), '# Policies\n', 'utf8');
    }

    if (!omitAgentFiles.includes('capabilities.md')) {
      await writeFile(path.join(cognitiveIdentityRootPath, 'capabilities.md'), '# Capabilities\n', 'utf8');
    }
  }

  await writeFile(
    path.join(temporaryRootPath, 'instance', 'operational-identities', 'alfred', 'identity.json'),
    JSON.stringify(
      {
        kind: 'operational_identity_definition',
        version: 1,
        operationalIdentityId: 'alfred',
        displayName: 'Alfred',
        lifecycleState: 'active',
        auditActorId: 'system-steward.ops.alfred.v1',
        attachedCognitiveIdentities: [{ cognitiveIdentityId: 'system-steward' }],
        executionProfileId: 'alfred-default',
        persona: { tone: 'helpful' },
      },
      null,
      2,
    ),
    'utf8',
  );

  await writeFile(
    path.join(temporaryRootPath, 'instance', 'operational-identities', 'alfred', 'execution-profile.json'),
    JSON.stringify(
      {
        kind: 'execution_profile_definition',
        version: 1,
        executionProfileId: 'alfred-default',
        executionMode: 'deterministic',
        primaryBrain: {
          brainId: 'openrouter-primary',
          providerId: 'openrouter-api',
          modelId: 'openrouter/free',
        },
        fallbackBrain: null,
        enabledCommands: ['status'],
      },
      null,
      2,
    ),
    'utf8',
  );

  return temporaryRootPath;
}

test('prepareAgentInvocation returns ready for Alfred with a valid resolved Cognitive Identity definition', async () => {
  const projectRootPath = await createProjectFixture();
  const bootResult = await runSystemBoot({ projectRootPath });

  const readiness = await prepareAgentInvocation({
    bootResult,
    request: {
      operationalIdentityId: 'alfred',
      requestedBy: 'cli',
    },
  });

  assert.equal(readiness.status, 'ready');
  assert.equal(readiness.request.operationalIdentityId, 'alfred');
  assert.equal(readiness.activeCognitiveSet.primaryCognitiveIdentityId, 'system-steward');
  assert.equal(readiness.resolvedCognitiveIdentity.cognitiveIdentityRootPath, path.join(projectRootPath, 'instance', 'cognitive-identities', 'system-steward'));
  assert.equal(readiness.resolvedCognitiveIdentity.registryEntry.cognitiveIdentityId, 'system-steward');
  assert.equal(readiness.errors.length, 0);
});

test('prepareAgentInvocation rejects direct Cognitive Identity execution without an Operational Identity', async () => {
  const projectRootPath = await createProjectFixture();
  const bootResult = await runSystemBoot({ projectRootPath });

  await assert.rejects(
    () => prepareAgentInvocation({
      bootResult,
      request: {
        agentId: 'system-steward',
        requestedBy: 'cli',
      },
    }),
    /operationalIdentityId/u,
  );
});

test('prepareAgentInvocation returns blocked when the boot result is not invocation-ready', async () => {
  const projectRootPath = await createProjectFixture({
    omitMasComponents: ['instance/registries'],
  });
  const bootResult = await runSystemBoot({ projectRootPath });

  const readiness = await prepareAgentInvocation({
    bootResult,
    request: {
      operationalIdentityId: 'alfred',
    },
  });

  assert.equal(readiness.status, 'blocked');
  assert.ok(readiness.errors.includes('System Boot is not ready for Agent Invocation.'));
});

test('prepareAgentInvocation returns blocked when the Cognitive Identity definition misses identity.md', async () => {
  const projectRootPath = await createProjectFixture({
    omitAgentFiles: ['identity.md'],
  });
  const bootResult = await runSystemBoot({ projectRootPath });

  const readiness = await prepareAgentInvocation({
    bootResult,
    request: {
      operationalIdentityId: 'alfred',
    },
  });

  assert.equal(readiness.status, 'blocked');
  assert.ok(readiness.errors.includes('Required Cognitive Identity component is missing: identity.md'));
});

test('prepareAgentInvocation returns failed when the Cognitive Identity registry entry is missing', async () => {
  const projectRootPath = await createProjectFixture({
    omitRegistryEntry: true,
  });
  const bootResult = await runSystemBoot({ projectRootPath });

  const readiness = await prepareAgentInvocation({
    bootResult,
    request: {
      operationalIdentityId: 'alfred',
    },
  });

  assert.equal(readiness.status, 'failed');
  assert.ok(readiness.errors.some((errorMessage) => errorMessage.includes('Cognitive Identity registry entry could not be resolved')));
});

test('prepareAgentInvocation returns failed when the Cognitive Identity registry rootPath escapes the Cognitive Identity root', async () => {
  const projectRootPath = await createProjectFixture({
    agentRegistryRootPath: '../outside-agent',
  });
  const bootResult = await runSystemBoot({ projectRootPath });

  const readiness = await prepareAgentInvocation({
    bootResult,
    request: {
      operationalIdentityId: 'alfred',
    },
  });

  assert.equal(readiness.status, 'failed');
  assert.ok(readiness.errors.some((errorMessage) => errorMessage.includes('contains invalid path segments')));
});
