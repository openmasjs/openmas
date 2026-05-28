import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { generateMasterKey } from '../../src/credentials/generate-master-key.js';
import { writeCredentialVault } from '../../src/credentials/write-credential-vault.js';
import { runSystemBoot } from '../../src/boot/run-system-boot.js';
import { prepareAgentInvocation } from '../../src/invocation/prepare-agent-invocation.js';
import { assembleBrainInputForInvocation } from '../../src/brain/assemble-brain-input-for-invocation.js';
import { buildToolAvailabilityLayer } from '../../src/brain/build-tool-availability-layer.js';

async function createDirectoryTree(rootPath, relativePaths) {
  for (const relativePath of relativePaths) {
    await mkdir(path.join(rootPath, relativePath), { recursive: true });
  }
}

async function writeJsonFile(filePath, payload) {
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function buildToolDefinition(overrides = {}) {
  return {
    kind: 'tool_definition',
    version: 1,
    toolId: 'mas.system.inspect',
    displayName: 'MAS System Inspect',
    description: 'Reads safe MAS system structure and inventory metadata.',
    lifecycleState: 'active',
    owner: 'mas',
    toolType: 'local_js_module',
    sideEffectLevel: 'read_only',
    inputSchema: {
      type: 'object',
    },
    outputSchema: {
      type: 'object',
    },
    requiredResourceTypes: ['storage'],
    requiredAccessModes: ['read'],
    requiredPermissionModes: ['tool.execute'],
    approvalPolicy: {
      required: false,
    },
    execution: {
      modulePath: 'executor.js',
      timeoutMs: 10000,
      retryPolicy: {
        enabled: false,
      },
    },
    artifactPolicy: {
      persistResult: false,
    },
    memoryPolicy: {
      allowWritebackCandidates: false,
    },
    ...overrides,
  };
}

function createResourcesRegistryContent() {
  return {
    kind: 'resource_registry',
    version: 1,
    resources: [
      {
        kind: 'resource_definition',
        version: 1,
        resourceId: 'mas-filesystem',
        resourceType: 'storage',
        displayName: 'MAS Filesystem',
        ownershipScope: 'shared',
        lifecycleState: 'active',
      },
      {
        kind: 'resource_definition',
        version: 1,
        resourceId: 'meta-channel',
        resourceType: 'channel',
        displayName: 'Meta Channel',
        ownershipScope: 'shared',
        lifecycleState: 'active',
      },
    ],
  };
}

function createAlfredBindingsContent() {
  return {
    kind: 'operational_identity_bindings',
    version: 1,
    operationalIdentityId: 'alfred',
    bindings: [
      {
        resourceId: 'mas-filesystem',
        accessMode: 'read',
        bindingState: 'active',
        secretReferenceId: null,
      },
      {
        resourceId: 'meta-channel',
        accessMode: 'publish',
        bindingState: 'active',
        secretReferenceId: 'meta-token',
      },
    ],
  };
}

function createAlfredPermissionsContent() {
  return {
    kind: 'operational_identity_permissions',
    version: 1,
    operationalIdentityId: 'alfred',
    defaultEffect: 'deny',
    rules: [
      {
        ruleId: 'allow-mas-filesystem-read',
        effect: 'allow',
        resourceId: 'mas-filesystem',
        accessModes: ['read'],
      },
      {
        ruleId: 'allow-meta-channel-publish',
        effect: 'allow',
        resourceId: 'meta-channel',
        accessModes: ['publish'],
      },
    ],
  };
}

async function writeTool(rootPath, definition) {
  const toolRootPath = path.join(rootPath, 'instance', 'tools', definition.toolId);

  await mkdir(toolRootPath, { recursive: true });
  await writeJsonFile(path.join(toolRootPath, 'tool.json'), definition);
}

async function createToolAvailabilityFixture() {
  const temporaryRootPath = await mkdtemp(path.join(os.tmpdir(), 'openmas-tool-availability-'));

  await writeJsonFile(
    path.join(temporaryRootPath, 'package.json'),
    {
      name: 'openmas-tool-availability-fixture',
      private: true,
      type: 'module',
      openmas: {
        projectKind: 'framework',
        schemaVersion: 1,
      },
    },
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

  await writeJsonFile(
    path.join(temporaryRootPath, 'config', 'secret-references.json'),
    {
      kind: 'secret_reference_registry',
      version: 1,
      secretReferences: [
        {
          kind: 'secret_reference_definition',
          version: 1,
          secretReferenceId: 'meta-token',
          secretType: 'access_token',
          valueShape: 'string',
        },
      ],
    },
  );
  {
    const masterKeyHex = generateMasterKey();
    const credentials = {
      'meta-token': 'SECRET_VALUE_SHOULD_NOT_LEAK',
    };

    await mkdir(path.join(temporaryRootPath, 'config', 'credentials'), { recursive: true });
    await writeFile(path.join(temporaryRootPath, 'config', 'credentials', 'development.key'), masterKeyHex, 'utf8');
    await writeCredentialVault({
      projectRootPath: temporaryRootPath,
      environment: 'development',
      credentials,
      masterKeyHex,
    });
  }

  await writeJsonFile(
    path.join(temporaryRootPath, 'instance', 'registries', 'cognitive-identities.json'),
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
  );

  await writeJsonFile(
    path.join(temporaryRootPath, 'instance', 'registries', 'operational-identities.json'),
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
  );

  await writeJsonFile(
    path.join(temporaryRootPath, 'instance', 'registries', 'resources.json'),
    createResourcesRegistryContent(),
  );

  await writeFile(
    path.join(temporaryRootPath, 'instance', 'cognitive-identities', 'system-steward', 'identity.md'),
    '# System Steward\n\nThe System Steward administers the MAS framework.',
    'utf8',
  );
  await writeFile(
    path.join(temporaryRootPath, 'instance', 'cognitive-identities', 'system-steward', 'policies.md'),
    '# Policies\n\n- Be precise and audit-friendly.',
    'utf8',
  );
  await writeFile(
    path.join(temporaryRootPath, 'instance', 'cognitive-identities', 'system-steward', 'capabilities.md'),
    '# Capabilities\n\n- Explain MAS structure and runtime status.',
    'utf8',
  );

  await writeJsonFile(
    path.join(temporaryRootPath, 'instance', 'operational-identities', 'alfred', 'identity.json'),
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
  );

  await writeJsonFile(
    path.join(temporaryRootPath, 'instance', 'operational-identities', 'alfred', 'execution-profile.json'),
    {
      kind: 'execution_profile_definition',
      version: 1,
      executionProfileId: 'alfred-default',
      executionMode: 'hybrid',
      primaryBrain: {
        brainId: 'openrouter-primary',
        providerId: 'openrouter-api',
        modelId: 'openrouter/free',
      },
      fallbackBrain: null,
      enabledCommands: ['ask'],
    },
  );

  await writeJsonFile(
    path.join(temporaryRootPath, 'instance', 'operational-identities', 'alfred', 'bindings.json'),
    createAlfredBindingsContent(),
  );

  await writeJsonFile(
    path.join(temporaryRootPath, 'instance', 'operational-identities', 'alfred', 'permissions.json'),
    createAlfredPermissionsContent(),
  );

  await writeTool(temporaryRootPath, buildToolDefinition());
  await writeTool(temporaryRootPath, buildToolDefinition({
    toolId: 'meta.comments.read',
    displayName: 'Meta Comments Read',
    description: 'Reads Meta comments for community diagnostics.',
    sideEffectLevel: 'read_only',
    requiredResourceTypes: ['channel'],
    requiredAccessModes: ['read'],
    requiredPermissionModes: ['tool.execute'],
  }));
  await writeTool(temporaryRootPath, buildToolDefinition({
    toolId: 'meta.reply.publish',
    displayName: 'Meta Reply Publish',
    description: 'Publishes a reply to a Meta community comment.',
    sideEffectLevel: 'publish_external',
    requiredResourceTypes: ['channel'],
    requiredAccessModes: ['publish'],
    requiredPermissionModes: ['tool.publish'],
    approvalPolicy: {
      required: true,
    },
  }));

  return temporaryRootPath;
}

async function withEnvironment(overrides, callback) {
  const previousValues = new Map();

  for (const [key, value] of Object.entries(overrides)) {
    previousValues.set(key, process.env[key]);

    if (value === null) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    return await callback();
  } finally {
    for (const [key, value] of previousValues.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test('buildToolAvailabilityLayer creates a read-only prompt layer without granting execution authority', async () => {
  await withEnvironment(
    {
      "meta-token": 'SECRET_VALUE_SHOULD_NOT_LEAK',
    },
    async () => {
      const projectRootPath = await createToolAvailabilityFixture();
      const bootResult = await runSystemBoot({ projectRootPath });
      const readiness = await prepareAgentInvocation({
        bootResult,
        request: {
          operationalIdentityId: 'alfred',
          invocationMode: 'probabilistic',
          command: 'ask',
          inputText: 'Which tools can you request?',
          requestedBy: 'test-suite',
        },
      });
      const layer = buildToolAvailabilityLayer({
        toolDefinitions: readiness.toolRegistry.toolDefinitions,
        toolReadinessEvaluation: readiness.toolReadiness,
      });
      const serializedLayer = JSON.stringify(layer);

      assert.equal(layer.layerType, 'tool_availability');
      assert.equal(layer.owner, 'tool-and-workflow-runtime');
      assert.match(layer.content, /Tool availability is runtime evidence, not execution/u);
      assert.match(layer.content, /The runtime remains the only authority/u);
      assert.match(layer.content, /output only the raw JSON object/u);
      assert.match(layer.content, /Do not include markdown fences/u);
      assert.match(layer.content, /must be syntactically valid JSON/u);
      assert.match(layer.content, /prefer emitting the envelope instead of explaining expected behavior/u);
      assert.match(layer.content, /Plan\/preview grounding rule/u);
      assert.match(layer.content, /Do not invent tool ids, artifact names, reports, logs, or filesystem paths/u);
      assert.match(layer.content, /Wait for the runtime tool observation/u);
      assert.match(layer.content, /MAS System Inspect/u);
      assert.match(layer.content, /Meta Reply Publish/u);
      assert.match(layer.content, /Approval Required Tools/u);
      assert.match(layer.content, /Denied Or Unavailable Tools/u);
      assert.match(layer.content, /meta\.comments\.read: denied/u);
      assert.doesNotMatch(serializedLayer, /SECRET_VALUE_SHOULD_NOT_LEAK/u);
      assert.doesNotMatch(serializedLayer, /executor\.js/u);
    },
  );
});

test('assembleBrainInputForInvocation includes tool availability in prompt and provenance', async () => {
  await withEnvironment(
    {
      "meta-token": 'SECRET_VALUE_SHOULD_NOT_LEAK',
    },
    async () => {
      const projectRootPath = await createToolAvailabilityFixture();
      const bootResult = await runSystemBoot({ projectRootPath });
      const request = {
        operationalIdentityId: 'alfred',
        invocationMode: 'probabilistic',
        command: 'ask',
        inputText: 'Can you inspect the MAS and publish a Meta reply?',
        requestedBy: 'test-suite',
      };
      const readiness = await prepareAgentInvocation({
        bootResult,
        request,
      });
      const {
        brainInput,
        instructionLayerSummary,
        promptProvenance,
      } = await assembleBrainInputForInvocation({
        bootResult,
        readiness,
        request,
        invocationId: 'tool-availability-layer-001',
      });
      const layerTypes = instructionLayerSummary.layers.map((layer) => {
        return layer.layerType;
      });
      const provenanceLayer = promptProvenance.includedLayers.find((layer) => {
        return layer.layerType === 'tool_availability';
      });
      const serializedProvenance = JSON.stringify(promptProvenance);

      assert.equal(readiness.toolReadiness.summary.totalEvaluated, 3);
      assert.equal(readiness.toolReadiness.summary.ready, 1);
      assert.equal(readiness.toolReadiness.summary.approvalRequired, 1);
      assert.equal(readiness.toolReadiness.summary.denied, 1);
      assert.equal(instructionLayerSummary.totalLayers, 8);
      assert.equal(layerTypes.includes('tool_availability'), true);
      assert.equal(layerTypes.indexOf('capability') < layerTypes.indexOf('tool_availability'), true);
      assert.equal(layerTypes.indexOf('tool_availability') < layerTypes.indexOf('execution_guard'), true);
      assert.match(brainInput.systemInstructions, /## Tool Availability/u);
      assert.match(brainInput.systemInstructions, /MAS System Inspect/u);
      assert.match(brainInput.systemInstructions, /Meta Reply Publish/u);
      assert.match(brainInput.systemInstructions, /Never claim that a tool was executed unless the runtime returns a tool result/u);
      assert.match(brainInput.systemInstructions, /output only the raw JSON object/u);
      assert.match(brainInput.systemInstructions, /Do not include markdown fences/u);
      assert.match(brainInput.systemInstructions, /Plan\/preview grounding rule/u);
      assert.ok(provenanceLayer);
      assert.equal(provenanceLayer.content, undefined);
      assert.match(provenanceLayer.contentSha256, /^[a-f0-9]{64}$/u);
      assert.equal(provenanceLayer.sourceReferences.some((sourceReference) => {
        return (
          sourceReference.sourceType === 'tool_definition'
          && sourceReference.sourceId === 'mas.system.inspect:tool.json'
          && sourceReference.path === 'instance/tools/mas.system.inspect/tool.json'
        );
      }), true);
      assert.doesNotMatch(serializedProvenance, /MAS System Inspect/u);
      assert.doesNotMatch(serializedProvenance, /SECRET_VALUE_SHOULD_NOT_LEAK/u);
    },
  );
});

test('buildToolAvailabilityLayer returns null when no tools were evaluated', () => {
  const layer = buildToolAvailabilityLayer({
    toolDefinitions: [],
    toolReadinessEvaluation: {
      kind: 'tool_readiness_evaluation',
      version: 1,
      evaluatedTools: [],
      summary: {
        totalEvaluated: 0,
        ready: 0,
        approvalRequired: 0,
        denied: 0,
        unavailable: 0,
      },
      warnings: [],
    },
  });

  assert.equal(layer, null);
});
