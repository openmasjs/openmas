import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { runSystemBoot } from '../../src/boot/run-system-boot.js';
import { prepareAgentInvocation } from '../../src/invocation/prepare-agent-invocation.js';
import { runAgentInvocation } from '../../src/invocation/run-agent-invocation.js';
import { writeSystemStewardCommandModules } from '../helpers/write-system-steward-command-modules.js';

async function createDirectoryTree(rootPath, relativePaths) {
  for (const relativePath of relativePaths) {
    await mkdir(path.join(rootPath, relativePath), { recursive: true });
  }
}

async function createProjectFixture({
  operationalLifecycleState = 'active',
  attachedCognitiveIdentities = [{ cognitiveIdentityId: 'system-steward' }],
} = {}) {
  const temporaryRootPath = await mkdtemp(path.join(os.tmpdir(), 'openmas-operational-preflight-'));

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
        lifecycleState: operationalLifecycleState,
        auditActorId: 'system-steward.ops.alfred.v1',
        attachedCognitiveIdentities,
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

test('prepareAgentInvocation resolves Alfred and prepares invocation metadata for System Steward', async () => {
  const projectRootPath = await createProjectFixture();
  const bootResult = await runSystemBoot({ projectRootPath });

  const readiness = await prepareAgentInvocation({
    bootResult,
    request: {
      operationalIdentityId: 'alfred',
      command: 'status',
      requestedBy: 'cli',
    },
  });

  assert.equal(readiness.status, 'ready');
  assert.equal(readiness.request.operationalIdentityId, 'alfred');
  assert.equal(readiness.resolvedPrimaryCognitiveIdentityId, 'system-steward');
  assert.equal(readiness.auditActorId, 'system-steward.ops.alfred.v1');
  assert.equal(readiness.resolvedOperationalIdentity.operationalIdentityId, 'alfred');
  assert.equal(readiness.operationalIdentityDefinition.displayName, 'Alfred');
  assert.equal(readiness.resolvedCognitiveIdentity.cognitiveIdentityId, 'system-steward');
});

test('prepareAgentInvocation blocks Alfred when the operational identity is not active', async () => {
  const projectRootPath = await createProjectFixture({
    operationalLifecycleState: 'suspended',
  });
  const bootResult = await runSystemBoot({ projectRootPath });

  const readiness = await prepareAgentInvocation({
    bootResult,
    request: {
      operationalIdentityId: 'alfred',
      command: 'status',
      requestedBy: 'cli',
    },
  });

  assert.equal(readiness.status, 'blocked');
  assert.equal(readiness.resolvedPrimaryCognitiveIdentityId, 'system-steward');
  assert.ok(readiness.errors.includes('Operational Identity is not active: alfred (suspended).'));
});

test('prepareAgentInvocation rejects a caller Cognitive Identity selector even when an Operational Identity is supplied', async () => {
  const projectRootPath = await createProjectFixture();
  const bootResult = await runSystemBoot({ projectRootPath });

  await assert.rejects(
    () => prepareAgentInvocation({
      bootResult,
      request: {
        operationalIdentityId: 'alfred',
        agentId: 'community-manager',
        command: 'status',
        requestedBy: 'cli',
      },
    }),
    /must not include agentId/u,
  );
});

test('prepareAgentInvocation requires authored routing when Alfred has multiple attached cognitive identities', async () => {
  const projectRootPath = await createProjectFixture({
    attachedCognitiveIdentities: [
      { cognitiveIdentityId: 'system-steward' },
      { cognitiveIdentityId: 'community-manager' },
    ],
  });
  const bootResult = await runSystemBoot({ projectRootPath });

  const readiness = await prepareAgentInvocation({
    bootResult,
    request: {
      operationalIdentityId: 'alfred',
      command: 'status',
      requestedBy: 'cli',
    },
  });

  assert.equal(readiness.status, 'failed');
  assert.ok(readiness.errors.some((errorMessage) => errorMessage.includes('requires deterministic routing')));
});

test('runAgentInvocation completes Alfred deterministic execution through System Steward and persists operational metadata', async () => {
  const projectRootPath = await createProjectFixture();

  const result = await runAgentInvocation({
    projectRootPath,
    operationalIdentityId: 'alfred',
    command: 'hello',
    requestedBy: 'cli',
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.primaryCognitiveIdentityId, 'system-steward');
  assert.equal(Object.hasOwn(result, 'agentId'), false);
  assert.equal(result.operationalIdentityId, 'alfred');
  assert.match(result.message, /Alfred/i);
  assert.ok(result.persistence);

  const invocationSession = JSON.parse(await readFile(result.persistence.invocationSessionRecordPath, 'utf8'));
  const invocationReport = await readFile(result.persistence.invocationReportPath, 'utf8');

  assert.equal(invocationSession.operationalIdentityId, 'alfred');
  assert.equal(invocationSession.operationalDisplayName, 'Alfred');
  assert.equal(invocationSession.auditActorId, 'system-steward.ops.alfred.v1');
  assert.equal(invocationSession.primaryCognitiveIdentityId, 'system-steward');
  assert.equal(Object.hasOwn(invocationSession, 'agentId'), false);
  assert.match(invocationReport, /Alfred/);
  assert.match(invocationReport, /Operational Identity: alfred/);
});
