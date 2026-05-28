import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { readExecutionProfileDefinition } from '../../src/operational-identities/read-execution-profile-definition.js';
import { selectBrainForInvocation } from '../../src/operational-identities/select-brain-for-invocation.js';
import { runSystemBoot } from '../../src/boot/run-system-boot.js';
import { prepareAgentInvocation } from '../../src/invocation/prepare-agent-invocation.js';
import { runAgentInvocation } from '../../src/invocation/run-agent-invocation.js';
import { writeSystemStewardCommandModules } from '../helpers/write-system-steward-command-modules.js';

async function createDirectoryTree(rootPath, relativePaths) {
  for (const relativePath of relativePaths) {
    await mkdir(path.join(rootPath, relativePath), { recursive: true });
  }
}

async function createProjectFixture() {
  const temporaryRootPath = await mkdtemp(path.join(os.tmpdir(), 'openmas-execution-profile-'));

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
    'instance/cognitive-identities/system-steward',
    'instance/cognitive-identities/system-steward/commands',
    'instance/cognitive-identities/system-steward/memory',
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
  ]);

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

  await writeFile(path.join(temporaryRootPath, 'instance', 'cognitive-identities', 'system-steward', 'identity.md'), '# System Steward\n', 'utf8');
  await writeFile(path.join(temporaryRootPath, 'instance', 'cognitive-identities', 'system-steward', 'policies.md'), '# Policies\n', 'utf8');
  await writeFile(path.join(temporaryRootPath, 'instance', 'cognitive-identities', 'system-steward', 'capabilities.md'), '# Capabilities\n', 'utf8');
  await writeSystemStewardCommandModules(temporaryRootPath);

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
        attachedCognitiveIdentities: [
          {
            cognitiveIdentityId: 'system-steward',
          },
        ],
        executionProfileId: 'alfred-default',
        persona: {
          tone: 'helpful',
        },
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
        fallbackBrain: {
          brainId: 'gemini-fallback',
          providerId: 'gemini-api',
          modelId: 'gemini-flash-latest',
        },
        enabledCommands: [
          'help',
          'hello',
          'status',
          'bootstrap',
          'gap-analysis',
          'inspect',
          'diagnose',
        ],
      },
      null,
      2,
    ),
    'utf8',
  );

  return temporaryRootPath;
}

test('readExecutionProfileDefinition validates Alfred execution profile', async () => {
  const projectRootPath = await createProjectFixture();
  const operationalIdentityRootPath = path.join(projectRootPath, 'instance', 'operational-identities', 'alfred');

  const { definition } = await readExecutionProfileDefinition({
    operationalIdentityRootPath,
    expectedExecutionProfileId: 'alfred-default',
  });

  assert.equal(definition.executionProfileId, 'alfred-default');
  assert.equal(definition.executionMode, 'deterministic');
  assert.equal(definition.primaryBrain.brainId, 'openrouter-primary');
  assert.equal(definition.fallbackBrain.providerId, 'gemini-api');
});

test('selectBrainForInvocation returns the primary and fallback brain skeleton for deterministic invocation', () => {
  const brainSelection = selectBrainForInvocation({
    request: {
      command: 'hello',
      invocationMode: 'deterministic',
    },
    executionProfileDefinition: {
      executionProfileId: 'alfred-default',
      executionMode: 'deterministic',
      primaryBrain: {
        brainId: 'openrouter-primary',
        providerId: 'openrouter-api',
        modelId: 'openrouter/free',
      },
      fallbackBrain: {
        brainId: 'gemini-fallback',
        providerId: 'gemini-api',
        modelId: 'gemini-flash-latest',
      },
      enabledCommands: ['hello'],
    },
  });

  assert.equal(brainSelection.selectedBrain.brainId, 'openrouter-primary');
  assert.equal(brainSelection.fallbackBrain.brainId, 'gemini-fallback');
  assert.equal(brainSelection.selectionSource, 'primary_brain_default');
  assert.equal(brainSelection.brainRequired, false);
});

test('prepareAgentInvocation resolves Alfred execution profile and brain selection', async () => {
  const projectRootPath = await createProjectFixture();
  const bootResult = await runSystemBoot({ projectRootPath });

  const readiness = await prepareAgentInvocation({
    bootResult,
    request: {
      operationalIdentityId: 'alfred',
      command: 'inspect',
      requestedBy: 'cli',
    },
  });

  assert.equal(readiness.status, 'ready');
  assert.equal(readiness.executionProfileDefinition.executionProfileId, 'alfred-default');
  assert.equal(readiness.executionProfileDefinition.primaryBrain.providerId, 'openrouter-api');
  assert.equal(readiness.brainSelection.selectedBrain.brainId, 'openrouter-primary');
  assert.equal(readiness.brainSelection.fallbackBrain.brainId, 'gemini-fallback');
  assert.equal(readiness.brainSelection.brainRequired, false);
});

test('runAgentInvocation persists execution profile and brain selection metadata for Alfred', async () => {
  const projectRootPath = await createProjectFixture();

  const result = await runAgentInvocation({
    projectRootPath,
    operationalIdentityId: 'alfred',
    command: 'hello',
    requestedBy: 'cli',
  });

  assert.equal(result.status, 'completed');

  const invocationSession = JSON.parse(await readFile(result.persistence.invocationSessionRecordPath, 'utf8'));

  assert.equal(invocationSession.executionProfileId, 'alfred-default');
  assert.equal(invocationSession.executionMode, 'deterministic');
  assert.equal(invocationSession.selectedBrain.brainId, 'openrouter-primary');
  assert.equal(invocationSession.fallbackBrain.brainId, 'gemini-fallback');
  assert.equal(invocationSession.brainSelectionSource, 'primary_brain_default');
  assert.equal(invocationSession.brainRequired, false);
});
