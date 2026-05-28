import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { runSystemBoot } from '../../src/boot/run-system-boot.js';
import { prepareAgentInvocation } from '../../src/invocation/prepare-agent-invocation.js';
import { assembleBrainInputForInvocation } from '../../src/brain/assemble-brain-input-for-invocation.js';

async function createDirectoryTree(rootPath, relativePaths) {
  for (const relativePath of relativePaths) {
    await mkdir(path.join(rootPath, relativePath), { recursive: true });
  }
}

async function writeMarkdownTriple(rootPath, { identity, policies, capabilities }) {
  await writeFile(path.join(rootPath, 'identity.md'), identity, 'utf8');
  await writeFile(path.join(rootPath, 'policies.md'), policies, 'utf8');
  await writeFile(path.join(rootPath, 'capabilities.md'), capabilities, 'utf8');
}

async function createProjectFixture() {
  const temporaryRootPath = await mkdtemp(path.join(os.tmpdir(), 'openmas-brain-input-'));

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
    'instance/cognitive-identities/system-steward',
    'instance/cognitive-identities/system-steward/commands',
    'instance/cognitive-identities/system-steward/memory',
    'instance/cognitive-identities/marketing-and-sales',
    'instance/cognitive-identities/marketing-and-sales/community-manager',
    'instance/cognitive-identities/marketing-and-sales/copywriter-senior',
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
    'instance/operational-identities/maria',
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
          {
            cognitiveIdentityId: 'community-manager',
            rootPath: 'marketing-and-sales/community-manager',
            category: 'marketing-and-sales',
          },
          {
            cognitiveIdentityId: 'copywriter-senior',
            rootPath: 'marketing-and-sales/copywriter-senior',
            category: 'marketing-and-sales',
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
          {
            operationalIdentityId: 'maria',
            rootPath: 'maria',
            category: 'marketing-and-sales',
          },
        ],
      },
      null,
      2,
    ),
    'utf8',
  );

  await writeMarkdownTriple(path.join(temporaryRootPath, 'instance', 'cognitive-identities', 'system-steward'), {
    identity: '# System Steward\n\nThe `System Steward` helps administer the MAS.',
    policies: '# Policies\n\n- Prefer explicit diagnostics.',
    capabilities: '# Capabilities\n\n- Inspect MAS structure.',
  });

  await writeMarkdownTriple(path.join(temporaryRootPath, 'instance', 'cognitive-identities', 'marketing-and-sales', 'community-manager'), {
    identity: '# Community Manager\n\nThe `Community Manager` handles community-facing communication.',
    policies: '# Policies\n\n- Stay aligned with community context.',
    capabilities: '# Capabilities\n\n- Greet and guide community interactions.',
  });

  await writeMarkdownTriple(path.join(temporaryRootPath, 'instance', 'cognitive-identities', 'marketing-and-sales', 'copywriter-senior'), {
    identity: '# Copywriter Senior\n\nThe `Copywriter Senior` writes persuasive copy.',
    policies: '# Policies\n\n- Protect clarity and persuasion.',
    capabilities: '# Capabilities\n\n- Produce strong marketing text.',
  });

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
          presentationStyle: 'warm and professional',
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
        enabledCommands: ['hello', 'inspect'],
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
          presentationStyle: 'warm and friendly',
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
            secondaryCognitiveIdentityIds: ['copywriter-senior'],
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
          modelId: 'openrouter/free',
        },
        fallbackBrain: {
          brainId: 'gemini-fallback',
          providerId: 'gemini-api',
          modelId: 'gemini-flash-latest',
        },
        enabledCommands: ['hello'],
      },
      null,
      2,
    ),
    'utf8',
  );

  return temporaryRootPath;
}

test('assembleBrainInputForInvocation builds Alfred system and user messages', async () => {
  const projectRootPath = await createProjectFixture();
  const bootResult = await runSystemBoot({ projectRootPath });

  const request = {
    operationalIdentityId: 'alfred',
    command: 'inspect',
    inputText: 'Please explain the current MAS structure briefly.',
    requestedBy: 'cli',
  };

  const readiness = await prepareAgentInvocation({
    bootResult,
    request,
  });

  const {
    brainInput,
    providerRequest,
    instructionLayers,
    instructionLayerSummary,
    promptProvenance,
  } = await assembleBrainInputForInvocation({
    bootResult,
    readiness,
    request,
    invocationId: 'brain-input-alfred-001',
  });

  assert.equal(brainInput.operationalIdentityId, 'alfred');
  assert.equal(brainInput.operationalDisplayName, 'Alfred');
  assert.equal(brainInput.providerId, 'openrouter-api');
  assert.equal(brainInput.modelId, 'openrouter/free');
  assert.equal(brainInput.primaryCognitiveIdentityId, 'system-steward');
  assert.match(brainInput.systemInstructions, /Framework Runtime Core/);
  assert.match(brainInput.systemInstructions, /Current Brain Provider: openrouter-api/);
  assert.match(brainInput.systemInstructions, /Fallback Brain Provider: gemini-api/);
  assert.match(brainInput.systemInstructions, /Operational Identity/);
  assert.match(brainInput.systemInstructions, /System Steward/);
  assert.match(brainInput.systemInstructions, /Execution Guards/);
  assert.match(brainInput.systemInstructions, /Stop Conditions/);
  assert.match(brainInput.systemInstructions, /Context Pack/);
  assert.match(brainInput.systemInstructions, /Context Pack ID: context-pack-brain-input-alfred-001/);
  assert.match(brainInput.userInput, /Please explain the current MAS structure briefly/);
  assert.equal(providerRequest.messages[0].role, 'system');
  assert.equal(providerRequest.messages[1].role, 'user');
  assert.equal(promptProvenance.kind, 'prompt_provenance');
  assert.equal(promptProvenance.includedLayerCount, 7);
  assert.equal(promptProvenance.omittedLayerCount, 2);
  assert.equal(promptProvenance.includedLayers[0].content, undefined);
  assert.equal(promptProvenance.includedLayers[2].sourceReferences[0].path, 'instance/cognitive-identities/system-steward/identity.md');
  assert.equal(promptProvenance.includedLayers.at(-1).layerType, 'context_pack');
  assert.equal(instructionLayers.length, 7);
  assert.equal(instructionLayerSummary.totalLayers, 7);
  assert.deepEqual(
    instructionLayerSummary.layers.map((layer) => layer.layerType),
    [
      'framework_runtime',
      'operational_identity',
      'cognitive_identity',
      'policy',
      'capability',
      'execution_guard',
      'context_pack',
    ],
  );
  assert.equal(
    instructionLayers[2].sourceReferences[0].path,
    'instance/cognitive-identities/system-steward/identity.md',
  );
  assert.equal(
    instructionLayers[3].sourceReferences[0].path,
    'instance/cognitive-identities/system-steward/policies.md',
  );
  assert.equal(
    instructionLayers[4].sourceReferences[0].path,
    'instance/cognitive-identities/system-steward/capabilities.md',
  );
  assert.equal(
    instructionLayers[5].sourceReferences[0].path,
    'src/brain/build-execution-guards-layer.js',
  );
  assert.equal(
    instructionLayers[6].sourceReferences[0].sourceType,
    'context_pack',
  );
});

test('assembleBrainInputForInvocation includes Maria secondary cognitive identity context', async () => {
  const projectRootPath = await createProjectFixture();
  const bootResult = await runSystemBoot({ projectRootPath });

  const request = {
    operationalIdentityId: 'maria',
    command: 'hello',
    inputText: 'Say hello to the audience in a brand-friendly way.',
    requestedBy: 'cli',
  };

  const readiness = await prepareAgentInvocation({
    bootResult,
    request,
  });

  const {
    brainInput,
    providerRequest,
    instructionLayers,
    instructionLayerSummary,
    promptProvenance,
  } = await assembleBrainInputForInvocation({
    bootResult,
    readiness,
    request,
    invocationId: 'brain-input-maria-001',
  });

  assert.equal(brainInput.operationalIdentityId, 'maria');
  assert.equal(brainInput.primaryCognitiveIdentityId, 'community-manager');
  assert.deepEqual(brainInput.secondaryCognitiveIdentityIds, ['copywriter-senior']);
  assert.equal(brainInput.secondaryCognitiveIdentities.length, 1);
  assert.match(brainInput.systemInstructions, /Secondary Cognitive Identities/);
  assert.match(brainInput.systemInstructions, /Copywriter Senior/);
  assert.equal(providerRequest.providerId, 'openrouter-api');
  assert.equal(providerRequest.modelId, 'openrouter/free');
  assert.equal(promptProvenance.includedLayerCount, 7);
  assert.equal(promptProvenance.includedLayers[2].sourceReferences.length, 2);
  assert.equal(promptProvenance.includedLayers.at(-1).layerType, 'context_pack');
  assert.match(brainInput.systemInstructions, /Policy Instructions/);
  assert.match(brainInput.systemInstructions, /Capability Instructions/);
  assert.match(brainInput.systemInstructions, /Execution Guards/);
  assert.match(brainInput.systemInstructions, /Context Pack ID: context-pack-brain-input-maria-001/);
  assert.equal(instructionLayers.length, 7);
  assert.equal(instructionLayerSummary.totalLayers, 7);
  assert.equal(
    instructionLayerSummary.layers.at(-1).layerType,
    'context_pack',
  );
  assert.equal(
    instructionLayers[2].sourceReferences[1].path,
    'instance/cognitive-identities/marketing-and-sales/copywriter-senior/identity.md',
  );
  assert.equal(
    instructionLayers[3].sourceReferences[1].path,
    'instance/cognitive-identities/marketing-and-sales/copywriter-senior/policies.md',
  );
  assert.equal(
    instructionLayers[4].sourceReferences[1].path,
    'instance/cognitive-identities/marketing-and-sales/copywriter-senior/capabilities.md',
  );
});
