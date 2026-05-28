import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { runAgentInvocation } from '../../src/invocation/run-agent-invocation.js';
import { runSystemBoot } from '../../src/boot/run-system-boot.js';
import { prepareAgentInvocation } from '../../src/invocation/prepare-agent-invocation.js';
import { writeSystemStewardCommandModules } from '../helpers/write-system-steward-command-modules.js';
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
  const temporaryRootPath = await mkdtemp(path.join(os.tmpdir(), 'openmas-additional-identities-'));

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
  ]);

  await writePortableCognitiveIdentity(temporaryRootPath, 'system-steward', 'System Steward');
  await writePortableCognitiveIdentity(temporaryRootPath, 'marketing-and-sales/community-manager', 'Community Manager');
  await writePortableCognitiveIdentity(temporaryRootPath, 'marketing-and-sales/copywriter-senior', 'Copywriter Senior');
  await writeSystemStewardCommandModules(temporaryRootPath);
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

  await writeFile(
    path.join(temporaryRootPath, 'instance', 'registries', 'cognitive-identities.json'),
    JSON.stringify(
      {
        kind: 'cognitive_identities_registry',
        version: 1,
        cognitiveIdentities: [
          {
            cognitiveIdentityId: 'system-steward',
            rootPath: 'system-steward',
            category: 'platform',
          },
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

  return temporaryRootPath;
}

test('prepareAgentInvocation resolves Maria to community-manager in the single-cognitive baseline scenario', async () => {
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
  assert.equal(readiness.request.operationalIdentityId, 'maria');
  assert.equal(readiness.resolvedPrimaryCognitiveIdentityId, 'community-manager');
  assert.equal(readiness.operationalIdentityDefinition.displayName, 'Maria');
  assert.equal(readiness.auditActorId, 'community-manager.ops.maria.v1');
});

test('runAgentInvocation rejects direct operation of community-manager without an Operational Identity', async () => {
  const projectRootPath = await createProjectFixture();

  await assert.rejects(
    () => runAgentInvocation({
      projectRootPath,
      agentId: 'community-manager',
      command: 'hello',
      requestedBy: 'cli',
    }),
    /operationalIdentityId/u,
  );
});

test('runAgentInvocation rejects direct operation of copywriter-senior without an Operational Identity', async () => {
  const projectRootPath = await createProjectFixture();

  await assert.rejects(
    () => runAgentInvocation({
      projectRootPath,
      agentId: 'copywriter-senior',
      command: 'hello',
      requestedBy: 'cli',
    }),
    /operationalIdentityId/u,
  );
});

test('runAgentInvocation completes Maria hello through community-manager and persists operational metadata', async () => {
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
  assert.match(result.message, /Maria/i);

  const invocationSession = JSON.parse(await readFile(result.persistence.invocationSessionRecordPath, 'utf8'));
  const invocationReport = await readFile(result.persistence.invocationReportPath, 'utf8');

  assert.equal(invocationSession.operationalIdentityId, 'maria');
  assert.equal(invocationSession.operationalDisplayName, 'Maria');
  assert.equal(invocationSession.primaryCognitiveIdentityId, 'community-manager');
  assert.match(invocationReport, /Maria/);
  assert.match(invocationReport, /Operational Identity: maria/);
});
