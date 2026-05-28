import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { evaluateDelegationTargetReadiness } from '../../src/os/delegation/delegation-target-readiness.js';

async function writeJson(filePath, value) {
  await writeFile(filePath, JSON.stringify(value, null, 2), 'utf8');
}

async function createDirectoryTree(rootPath, relativePaths) {
  for (const relativePath of relativePaths) {
    await mkdir(path.join(rootPath, relativePath), { recursive: true });
  }
}

async function createReadinessFixture({
  operationalIdentityId = 'bruce',
  cognitiveIdentityId = 'evaluation-audit-steward',
  cognitiveIdentityRootPath = 'stewards/evaluation-audit',
  lifecycleState = 'active',
  routingDefaultPrimaryCognitiveIdentityId = cognitiveIdentityId,
  executionMode = 'hybrid',
  enabledCommands = ['ask', 'hello'],
  writeRequiredAgentComponents = true,
} = {}) {
  const projectRootPath = await mkdtemp(path.join(os.tmpdir(), 'openmas-delegation-target-readiness-'));
  const operationalIdentityRootPath = path.join(
    projectRootPath,
    'instance',
    'operational-identities',
    operationalIdentityId,
  );
  const cognitiveIdentityRootFullPath = path.join(projectRootPath, 'instance', 'cognitive-identities', cognitiveIdentityRootPath);

  await createDirectoryTree(projectRootPath, [
    'instance/registries',
    path.join('instance/operational-identities', operationalIdentityId),
    path.join('instance/cognitive-identities', cognitiveIdentityRootPath),
  ]);
  await writeJson(
    path.join(projectRootPath, 'instance', 'registries', 'operational-identities.json'),
    {
      kind: 'operational_identities_registry',
      version: 1,
      operationalIdentities: [
        {
          operationalIdentityId,
          rootPath: operationalIdentityId,
          category: 'platform',
        },
      ],
    },
  );
  await writeJson(
    path.join(projectRootPath, 'instance', 'registries', 'cognitive-identities.json'),
    {
      kind: 'cognitive_identities_registry',
      version: 1,
      cognitiveIdentities: [
        {
          cognitiveIdentityId,
          rootPath: cognitiveIdentityRootPath,
          category: 'platform',
        },
      ],
    },
  );
  await writeJson(
    path.join(operationalIdentityRootPath, 'identity.json'),
    {
      kind: 'operational_identity_definition',
      version: 1,
      operationalIdentityId,
      displayName: operationalIdentityId,
      lifecycleState,
      auditActorId: `${cognitiveIdentityId}.ops.${operationalIdentityId}.v1`,
      attachedCognitiveIdentities: [
        {
          cognitiveIdentityId,
        },
      ],
      executionProfileId: `${operationalIdentityId}-default`,
    },
  );
  await writeJson(
    path.join(operationalIdentityRootPath, 'routing.json'),
    {
      kind: 'operational_identity_routing_definition',
      version: 1,
      defaultPrimaryCognitiveIdentityId: routingDefaultPrimaryCognitiveIdentityId,
      commandRoutes: [],
    },
  );
  await writeJson(
    path.join(operationalIdentityRootPath, 'execution-profile.json'),
    {
      kind: 'execution_profile_definition',
      version: 1,
      executionProfileId: `${operationalIdentityId}-default`,
      executionMode,
      primaryBrain: {
        brainId: 'openrouter-primary',
        providerId: 'openrouter-api',
        modelId: 'openrouter/free',
      },
      fallbackBrain: null,
      enabledCommands,
    },
  );

  if (writeRequiredAgentComponents) {
    await writeFile(path.join(cognitiveIdentityRootFullPath, 'identity.md'), `# ${cognitiveIdentityId}\n`, 'utf8');
    await writeFile(path.join(cognitiveIdentityRootFullPath, 'policies.md'), '# Policies\n', 'utf8');
    await writeFile(path.join(cognitiveIdentityRootFullPath, 'capabilities.md'), '# Capabilities\n', 'utf8');
  }

  return {
    projectRootPath,
    operationalIdentityId,
    cognitiveIdentityId,
  };
}

test('evaluateDelegationTargetReadiness accepts an active target with compatible routing and execution profile', async () => {
  const {
    projectRootPath,
    operationalIdentityId,
    cognitiveIdentityId,
  } = await createReadinessFixture();

  const readiness = await evaluateDelegationTargetReadiness({
    projectRootPath,
    targetOperationalIdentityId: operationalIdentityId,
    command: 'ask',
    mode: 'probabilistic',
  });

  assert.equal(readiness.ready, true);
  assert.equal(readiness.status, 'ready');
  assert.equal(readiness.reasonCode, 'target_ready_for_delegation');
  assert.equal(readiness.resolvedPrimaryCognitiveIdentityId, cognitiveIdentityId);
  assert.equal(readiness.activeCognitiveSet.primaryCognitiveIdentityId, cognitiveIdentityId);
});

test('evaluateDelegationTargetReadiness blocks targets whose execution profile cannot run the requested mode', async () => {
  const {
    projectRootPath,
    operationalIdentityId,
  } = await createReadinessFixture({
    operationalIdentityId: 'maria',
    cognitiveIdentityId: 'community-manager',
    cognitiveIdentityRootPath: 'marketing-and-sales/community-manager',
    executionMode: 'deterministic',
    enabledCommands: ['hello'],
  });

  const readiness = await evaluateDelegationTargetReadiness({
    projectRootPath,
    targetOperationalIdentityId: operationalIdentityId,
    command: 'ask',
    mode: 'probabilistic',
  });

  assert.equal(readiness.ready, false);
  assert.equal(readiness.status, 'blocked');
  assert.equal(readiness.reasonCode, 'target_execution_mode_not_supported');
  assert.match(readiness.reason, /does not support probabilistic invocation/u);
});

test('evaluateDelegationTargetReadiness catches Operational Identity routing drift before delegation', async () => {
  const {
    projectRootPath,
    operationalIdentityId,
  } = await createReadinessFixture({
    routingDefaultPrimaryCognitiveIdentityId: 'evaluation-audit',
  });

  const readiness = await evaluateDelegationTargetReadiness({
    projectRootPath,
    targetOperationalIdentityId: operationalIdentityId,
    command: 'ask',
    mode: 'probabilistic',
  });

  assert.equal(readiness.ready, false);
  assert.equal(readiness.status, 'blocked');
  assert.equal(readiness.reasonCode, 'target_routing_references_unattached_cognitive_identity');
  assert.match(readiness.reason, /routing default primary cognitive identity is not attached/u);
});

test('evaluateDelegationTargetReadiness allows unverified low-level fixtures when no Operational Identity registry exists', async () => {
  const projectRootPath = await mkdtemp(path.join(os.tmpdir(), 'openmas-delegation-target-readiness-unverified-'));

  const readiness = await evaluateDelegationTargetReadiness({
    projectRootPath,
    targetOperationalIdentityId: 'bruce',
    command: 'ask',
    mode: 'probabilistic',
  });

  assert.equal(readiness.ready, true);
  assert.equal(readiness.status, 'unverified');
  assert.equal(readiness.reasonCode, 'target_readiness_unverified_missing_operational_identity_registry');
  assert.equal(readiness.warnings.length, 1);
});
