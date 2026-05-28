import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolveActiveCognitiveSet } from '../../src/operational-identities/resolve-active-cognitive-set.js';
import { runSystemBoot } from '../../src/boot/run-system-boot.js';
import { prepareAgentInvocation } from '../../src/invocation/prepare-agent-invocation.js';
import { runAgentInvocation } from '../../src/invocation/run-agent-invocation.js';
import { writeSimpleHelloCommandModule } from '../helpers/write-simple-hello-command-module.js';

async function createDirectoryTree(rootPath, relativePaths) {
  for (const relativePath of relativePaths) {
    await mkdir(path.join(rootPath, relativePath), { recursive: true });
  }
}

async function writePortableCognitiveIdentity(rootPath, relativeCognitiveIdentityPath, title) {
  const cognitiveIdentityRootPath = path.join(rootPath, 'instance', 'cognitive-identities', relativeCognitiveIdentityPath);

  await createDirectoryTree(rootPath, [`instance/cognitive-identities/${relativeCognitiveIdentityPath}`]);
  await writeFile(path.join(cognitiveIdentityRootPath, 'identity.md'), `# ${title}\n`, 'utf8');
  await writeFile(path.join(cognitiveIdentityRootPath, 'policies.md'), '# Policies\n', 'utf8');
  await writeFile(path.join(cognitiveIdentityRootPath, 'capabilities.md'), '# Capabilities\n', 'utf8');
}

async function createProjectFixture() {
  const temporaryRootPath = await mkdtemp(path.join(os.tmpdir(), 'openmas-active-cognitive-set-'));

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
    'instance/operational-identities/maria',
    'instance/operational-identities/juan',
  ]);

  await writePortableCognitiveIdentity(temporaryRootPath, 'marketing-and-sales/community-manager', 'Community Manager');
  await writePortableCognitiveIdentity(temporaryRootPath, 'marketing-and-sales/copywriter-senior', 'Copywriter Senior');
  await writePortableCognitiveIdentity(temporaryRootPath, 'marketing-and-sales/media-buyer', 'Media Buyer');

  await writeSimpleHelloCommandModule({
    projectRootPath: temporaryRootPath,
    relativeCognitiveIdentityPath: 'marketing-and-sales/community-manager',
    roleName: 'Community Manager',
    defaultSpeakerLabel: 'Community Manager',
    reportKind: 'community_manager_welcome_report',
    messageText: 'I am ready to help with community-facing work in this OpenMAS instance.',
  });
  await writeSimpleHelloCommandModule({
    projectRootPath: temporaryRootPath,
    relativeCognitiveIdentityPath: 'marketing-and-sales/copywriter-senior',
    roleName: 'Copywriter Senior',
    defaultSpeakerLabel: 'Copywriter Senior',
    reportKind: 'copywriter_senior_welcome_report',
    messageText: 'I am ready to help with persuasive writing inside this OpenMAS instance.',
  });
  await writeSimpleHelloCommandModule({
    projectRootPath: temporaryRootPath,
    relativeCognitiveIdentityPath: 'marketing-and-sales/media-buyer',
    roleName: 'Media Buyer',
    defaultSpeakerLabel: 'Media Buyer',
    reportKind: 'media_buyer_welcome_report',
    messageText: 'I am ready to help with media buying and campaign investment work in this OpenMAS instance.',
  });

  await writeFile(
    path.join(temporaryRootPath, 'instance', 'registries', 'cognitive-identities.json'),
    JSON.stringify(
      {
        kind: 'cognitive_identities_registry',
        version: 1,
        cognitiveIdentities: [
          {
            cognitiveIdentityId: 'community-manager',
            rootPath: 'marketing-and-sales/community-manager',
            category: 'domain',
          },
          {
            cognitiveIdentityId: 'copywriter-senior',
            rootPath: 'marketing-and-sales/copywriter-senior',
            category: 'domain',
          },
          {
            cognitiveIdentityId: 'media-buyer',
            rootPath: 'marketing-and-sales/media-buyer',
            category: 'domain',
          },
        ],
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
            operationalIdentityId: 'maria',
            rootPath: 'maria',
            category: 'domain',
          },
          {
            operationalIdentityId: 'juan',
            rootPath: 'juan',
            category: 'domain',
          },
        ],
      },
      null,
      2,
    ),
    'utf8',
  );

  await writeFile(
    path.join(temporaryRootPath, 'instance', 'operational-identities', 'maria', 'identity.json'),
    JSON.stringify(
      {
        kind: 'operational_identity_definition',
        version: 1,
        operationalIdentityId: 'maria',
        displayName: 'Maria',
        lifecycleState: 'active',
        auditActorId: 'community-manager.ops.maria.v1',
        attachedCognitiveIdentities: [
          {
            cognitiveIdentityId: 'community-manager',
          },
          {
            cognitiveIdentityId: 'copywriter-senior',
          },
        ],
        executionProfileId: 'maria-default',
        persona: {
          tone: 'enthusiastic',
        },
      },
      null,
      2,
    ),
    'utf8',
  );

  await writeFile(
    path.join(temporaryRootPath, 'instance', 'operational-identities', 'maria', 'routing.json'),
    JSON.stringify(
      {
        kind: 'operational_identity_routing_definition',
        version: 1,
        defaultPrimaryCognitiveIdentityId: 'community-manager',
        commandRoutes: [
          {
            command: 'hello',
            primaryCognitiveIdentityId: 'community-manager',
            secondaryCognitiveIdentityIds: [
              'copywriter-senior',
            ],
          },
        ],
      },
      null,
      2,
    ),
    'utf8',
  );

  await writeFile(
    path.join(temporaryRootPath, 'instance', 'operational-identities', 'maria', 'execution-profile.json'),
    JSON.stringify(
      {
        kind: 'execution_profile_definition',
        version: 1,
        executionProfileId: 'maria-default',
        executionMode: 'deterministic',
        primaryBrain: {
          brainId: 'openrouter-primary',
          providerId: 'openrouter-api',
          modelId: 'anthropic/claude-3.7-sonnet',
        },
        fallbackBrain: null,
        enabledCommands: [
          'hello',
        ],
      },
      null,
      2,
    ),
    'utf8',
  );

  await writeFile(
    path.join(temporaryRootPath, 'instance', 'operational-identities', 'juan', 'identity.json'),
    JSON.stringify(
      {
        kind: 'operational_identity_definition',
        version: 1,
        operationalIdentityId: 'juan',
        displayName: 'Juan',
        lifecycleState: 'active',
        auditActorId: 'media-buyer.ops.juan.v1',
        attachedCognitiveIdentities: [
          {
            cognitiveIdentityId: 'media-buyer',
          },
          {
            cognitiveIdentityId: 'community-manager',
          },
        ],
        executionProfileId: 'juan-default',
        persona: {
          tone: 'strict but kind',
        },
      },
      null,
      2,
    ),
    'utf8',
  );

  await writeFile(
    path.join(temporaryRootPath, 'instance', 'operational-identities', 'juan', 'routing.json'),
    JSON.stringify(
      {
        kind: 'operational_identity_routing_definition',
        version: 1,
        defaultPrimaryCognitiveIdentityId: 'media-buyer',
        commandRoutes: [
          {
            command: 'hello',
            primaryCognitiveIdentityId: 'media-buyer',
            secondaryCognitiveIdentityIds: [
              'community-manager',
            ],
          },
        ],
      },
      null,
      2,
    ),
    'utf8',
  );

  await writeFile(
    path.join(temporaryRootPath, 'instance', 'operational-identities', 'juan', 'execution-profile.json'),
    JSON.stringify(
      {
        kind: 'execution_profile_definition',
        version: 1,
        executionProfileId: 'juan-default',
        executionMode: 'deterministic',
        primaryBrain: {
          brainId: 'claude-opus-primary',
          providerId: 'claude-api',
          modelId: 'claude-opus-4.1',
        },
        fallbackBrain: {
          brainId: 'gemini-fallback',
          providerId: 'gemini-api',
          modelId: 'gemini-2.5-pro',
        },
        enabledCommands: [
          'hello',
        ],
      },
      null,
      2,
    ),
    'utf8',
  );

  return temporaryRootPath;
}

test('resolveActiveCognitiveSet resolves a command-routed primary and secondary set', () => {
  const activeCognitiveSet = resolveActiveCognitiveSet({
    request: {
      command: 'hello',
    },
    operationalIdentityDefinition: {
      operationalIdentityId: 'maria',
      attachedCognitiveIdentities: [
        { cognitiveIdentityId: 'community-manager' },
        { cognitiveIdentityId: 'copywriter-senior' },
      ],
    },
    routingDefinition: {
      defaultPrimaryCognitiveIdentityId: 'community-manager',
      commandRoutes: [
        {
          command: 'hello',
          primaryCognitiveIdentityId: 'community-manager',
          secondaryCognitiveIdentityIds: ['copywriter-senior'],
        },
      ],
    },
  });

  assert.equal(activeCognitiveSet.primaryCognitiveIdentityId, 'community-manager');
  assert.deepEqual(activeCognitiveSet.secondaryCognitiveIdentityIds, ['copywriter-senior']);
  assert.equal(activeCognitiveSet.resolutionSource, 'command_route');
});

test('resolveActiveCognitiveSet preserves an explicitly empty command-routed secondary set', () => {
  const activeCognitiveSet = resolveActiveCognitiveSet({
    request: {
      command: 'copy-only',
    },
    operationalIdentityDefinition: {
      operationalIdentityId: 'maria',
      attachedCognitiveIdentities: [
        { cognitiveIdentityId: 'community-manager' },
        { cognitiveIdentityId: 'copywriter-senior' },
      ],
    },
    routingDefinition: {
      defaultPrimaryCognitiveIdentityId: 'community-manager',
      commandRoutes: [
        {
          command: 'copy-only',
          primaryCognitiveIdentityId: 'copywriter-senior',
          secondaryCognitiveIdentityIds: [],
        },
      ],
    },
  });

  assert.equal(activeCognitiveSet.primaryCognitiveIdentityId, 'copywriter-senior');
  assert.deepEqual(activeCognitiveSet.secondaryCognitiveIdentityIds, []);
  assert.equal(activeCognitiveSet.resolutionSource, 'command_route');
});

test('resolveActiveCognitiveSet preserves authored routing for the requested command', () => {
  const activeCognitiveSet = resolveActiveCognitiveSet({
    request: {
      command: 'hello',
    },
    operationalIdentityDefinition: {
      operationalIdentityId: 'maria',
      attachedCognitiveIdentities: [
        { cognitiveIdentityId: 'community-manager' },
        { cognitiveIdentityId: 'copywriter-senior' },
      ],
    },
    routingDefinition: {
      defaultPrimaryCognitiveIdentityId: 'community-manager',
      commandRoutes: [
        {
          command: 'hello',
          primaryCognitiveIdentityId: 'community-manager',
          secondaryCognitiveIdentityIds: ['copywriter-senior'],
        },
      ],
    },
  });

  assert.equal(activeCognitiveSet.primaryCognitiveIdentityId, 'community-manager');
  assert.deepEqual(activeCognitiveSet.secondaryCognitiveIdentityIds, ['copywriter-senior']);
  assert.equal(activeCognitiveSet.resolutionSource, 'command_route');
});

test('prepareAgentInvocation resolves Maria hello with an explicit active cognitive set', async () => {
  const projectRootPath = await createProjectFixture();
  const bootResult = await runSystemBoot({ projectRootPath });

  const readiness = await prepareAgentInvocation({
    bootResult,
    request: {
      operationalIdentityId: 'maria',
      command: 'hello',
      requestedBy: 'cli',
    },
  });

  assert.equal(readiness.status, 'ready');
  assert.equal(readiness.resolvedPrimaryCognitiveIdentityId, 'community-manager');
  assert.equal(readiness.activeCognitiveSet.primaryCognitiveIdentityId, 'community-manager');
  assert.deepEqual(readiness.activeCognitiveSet.secondaryCognitiveIdentityIds, ['copywriter-senior']);
  assert.equal(readiness.activeCognitiveSet.resolutionSource, 'command_route');
});

test('prepareAgentInvocation rejects a caller Cognitive Identity selector for Maria', async () => {
  const projectRootPath = await createProjectFixture();
  const bootResult = await runSystemBoot({ projectRootPath });

  await assert.rejects(
    () => prepareAgentInvocation({
      bootResult,
      request: {
        operationalIdentityId: 'maria',
        agentId: 'copywriter-senior',
        command: 'hello',
        requestedBy: 'cli',
      },
    }),
    /must not include agentId/u,
  );
});

test('prepareAgentInvocation resolves Juan hello to media-buyer with community-manager as a secondary cognitive identity', async () => {
  const projectRootPath = await createProjectFixture();
  const bootResult = await runSystemBoot({ projectRootPath });

  const readiness = await prepareAgentInvocation({
    bootResult,
    request: {
      operationalIdentityId: 'juan',
      command: 'hello',
      requestedBy: 'cli',
    },
  });

  assert.equal(readiness.status, 'ready');
  assert.equal(readiness.resolvedPrimaryCognitiveIdentityId, 'media-buyer');
  assert.equal(readiness.activeCognitiveSet.primaryCognitiveIdentityId, 'media-buyer');
  assert.deepEqual(readiness.activeCognitiveSet.secondaryCognitiveIdentityIds, ['community-manager']);
  assert.equal(readiness.activeCognitiveSet.resolutionSource, 'command_route');
});

test('runAgentInvocation persists the active cognitive set for Maria hello', async () => {
  const projectRootPath = await createProjectFixture();

  const result = await runAgentInvocation({
    projectRootPath,
    operationalIdentityId: 'maria',
    command: 'hello',
    requestedBy: 'cli',
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.primaryCognitiveIdentityId, 'community-manager');
  assert.equal(result.operationalIdentityId, 'maria');

  const invocationSession = JSON.parse(await readFile(result.persistence.invocationSessionRecordPath, 'utf8'));

  assert.equal(invocationSession.primaryCognitiveIdentityId, 'community-manager');
  assert.deepEqual(invocationSession.secondaryCognitiveIdentityIds, ['copywriter-senior']);
  assert.equal(invocationSession.activeCognitiveSetResolutionSource, 'command_route');
});
