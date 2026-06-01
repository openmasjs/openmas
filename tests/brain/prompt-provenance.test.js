import test from 'node:test';
import assert from 'node:assert/strict';
import { assertPromptProvenance } from '../../src/contracts/prompts/prompt-provenance-contract.js';
import { buildPromptProvenance } from '../../src/brain/build-prompt-provenance.js';
import { buildContextPackLayer } from '../../src/brain/build-context-pack-layer.js';
import { resolveInstructionLayersForInvocation } from '../../src/brain/resolve-instruction-layers-for-invocation.js';
import { buildSystemInstructionsFromLayers } from '../../src/brain/build-system-instructions.js';
import { buildProviderRequest } from '../../src/brain/build-provider-request.js';
import { assertBrainInput } from '../../src/contracts/brain/brain-input-contract.js';

const VALID_CREATED_AT = '2026-04-14T00:00:00.000Z';
const VALID_SHA_256 = 'e'.repeat(64);

function createOperationalIdentity() {
  return {
    operationalIdentityId: 'alfred',
    displayName: 'Alfred',
    persona: {
      tone: 'helpful',
      presentationStyle: 'warm and professional',
    },
  };
}

function createCognitiveIdentityContext() {
  return {
    cognitiveIdentityId: 'system-steward',
    identityText: '# System Steward\n\nThe System Steward administers the MAS framework.',
    policiesText: '# Policies\n\n- Be precise and audit-friendly.',
    capabilitiesText: '# Capabilities\n\n- Explain MAS structure and runtime status.',
    sourcePaths: {
      identity: 'instance/cognitive-identities/system-steward/identity.md',
      policies: 'instance/cognitive-identities/system-steward/policies.md',
      capabilities: 'instance/cognitive-identities/system-steward/capabilities.md',
    },
  };
}

function createBrainInputAndProviderRequest(instructionLayers) {
  const systemInstructions = buildSystemInstructionsFromLayers({
    instructionLayers,
  });
  const brainInput = assertBrainInput({
    operationalIdentityId: 'alfred',
    operationalDisplayName: 'Alfred',
    persona: {
      tone: 'helpful',
      presentationStyle: 'warm and professional',
    },
    providerId: 'openrouter-api',
    modelId: 'openrouter/free',
    primaryCognitiveIdentityId: 'system-steward',
    secondaryCognitiveIdentityIds: [],
    primaryCognitiveIdentity: createCognitiveIdentityContext(),
    secondaryCognitiveIdentities: [],
    command: 'ask',
    requestedBy: 'cli',
    inputText: 'What is your role?',
    systemInstructions,
    userInput: 'Command: ask\nInput: What is your role?',
    assistantPrimer: null,
    messages: [
      {
        role: 'system',
        content: systemInstructions,
      },
      {
        role: 'user',
        content: 'Command: ask\nInput: What is your role?',
      },
    ],
  });

  return {
    brainInput,
    providerRequest: buildProviderRequest({
      brainInput,
    }),
  };
}

function buildMemorySourceReference(overrides = {}) {
  return {
    kind: 'memory_source_reference',
    version: 1,
    sourceType: 'durable_memory_record',
    sourceId: 'mem_durable_decision',
    scope: 'mas_instance',
    ownerId: 'sin-cuchillo',
    path: 'memory/durable/memory-record-mem_durable_decision.json',
    origin: 'system_generated',
    sensitivityLevel: 'internal',
    createdAt: VALID_CREATED_AT,
    contentSha256: VALID_SHA_256,
    ...overrides,
  };
}

function buildDurableContextPack() {
  const includedDurableSource = buildMemorySourceReference();
  const omittedDurableSource = buildMemorySourceReference({
    sourceId: 'mem_stale_durable',
    path: 'memory/durable/memory-record-mem_stale_durable.json',
  });
  const rejectedDurableSource = buildMemorySourceReference({
    sourceId: 'mem_restricted_durable',
    path: 'memory/durable/memory-record-mem_restricted_durable.json',
  });

  return {
    kind: 'context_pack',
    version: 1,
    contextPackId: 'context-pack-durable-provenance-001',
    invocationId: 'durable-provenance-001',
    operationalIdentityId: 'alfred',
    primaryCognitiveIdentityId: 'system-steward',
    secondaryCognitiveIdentityIds: [],
    sections: [
      {
        sectionId: 'invocation-summary',
        sectionType: 'invocation_summary',
        title: 'Invocation Summary',
        content: 'Alfred is answering with durable memory available.',
        inclusionReason: 'Invocation facts anchor the context pack.',
        sourceReferences: [],
        memoryRecordIds: [],
        visibilityChecked: true,
        authorityLevel: 'runtime_evidence',
        priority: 10,
        estimatedTokens: 10,
        warnings: [],
      },
      {
        sectionId: 'durable-decisions',
        sectionType: 'durable_decisions',
        title: 'Durable Decisions',
        content: 'RAW_DURABLE_MEMORY_CONTENT_MUST_NOT_APPEAR_IN_PROMPT_PROVENANCE',
        inclusionReason: 'Approved durable decisions can shape this invocation.',
        sourceReferences: [includedDurableSource],
        memoryRecordIds: ['mem_durable_decision'],
        visibilityChecked: true,
        authorityLevel: 'mas_guidance',
        priority: 25,
        estimatedTokens: 15,
        warnings: [],
      },
    ],
    sourceReferences: [includedDurableSource],
    omittedSources: [
      {
        sourceId: 'mem_stale_durable',
        decisionType: 'stale_source',
        reason: 'Stale durable memory was omitted by default.',
        memoryRecordIds: ['mem_stale_durable'],
        sourceReferences: [omittedDurableSource],
        warnings: ['Stale memory omitted: mem_stale_durable'],
      },
    ],
    rejectedSources: [
      {
        sourceId: 'mem_restricted_durable',
        decisionType: 'sensitivity_rejection',
        reason: 'Restricted durable memory was rejected.',
        memoryRecordIds: ['mem_restricted_durable'],
        sourceReferences: [rejectedDurableSource],
        warnings: [],
      },
    ],
    budget: {
      estimatedTokens: 25,
      maxTokens: 1200,
    },
    eligibilitySummary: {
      includedMemoryRecords: 1,
      omittedMemoryRecords: 1,
      rejectedMemoryRecords: 1,
    },
    warnings: [],
  };
}

test('assertPromptProvenance accepts a valid minimal provenance object', () => {
  const provenance = assertPromptProvenance({
    promptFactoryVersion: 'prompt-factory-v1',
    promptProfileId: 'default-layered-prompt-profile-v1',
    promptStackVersionId: 'prompt-stack-v1',
    assemblyStatus: 'assembled',
    providerId: 'openrouter-api',
    modelId: 'openrouter/free',
    requestType: 'generate_text',
    assembly: {
      systemInstructionsLength: 100,
      userInputLength: 20,
      messageCount: 2,
    },
    includedLayerCount: 1,
    omittedLayerCount: 0,
    includedLayers: [
      {
        layerId: 'framework-runtime-core',
        layerType: 'framework_runtime',
        owner: 'openmas-framework',
        priority: 10,
        sourceReferences: [
          {
            sourceType: 'framework_runtime',
            sourceId: 'openmas-runtime-core',
            path: 'src/brain/build-runtime-core-layer.js',
          },
        ],
        contentLength: 42,
        contentSha256: 'a'.repeat(64),
        summary: 'Runtime guidance.',
        warnings: [],
      },
    ],
    omittedLayers: [],
    warnings: [],
  });

  assert.equal(provenance.kind, 'prompt_provenance');
  assert.equal(provenance.version, 1);
  assert.equal(provenance.includedLayerCount, 1);
});

test('assertPromptProvenance rejects invalid fingerprints', () => {
  assert.throws(() => {
    assertPromptProvenance({
      promptFactoryVersion: 'prompt-factory-v1',
      promptProfileId: 'default-layered-prompt-profile-v1',
      promptStackVersionId: 'prompt-stack-v1',
      assemblyStatus: 'assembled',
      includedLayerCount: 2,
      omittedLayerCount: 0,
      includedLayers: [
        {
          layerId: 'framework-runtime-core',
          layerType: 'framework_runtime',
          owner: 'openmas-framework',
          priority: 10,
          sourceReferences: [],
          contentLength: 42,
          contentSha256: 'not-a-sha',
          warnings: [],
        },
      ],
      omittedLayers: [],
      warnings: [],
    });
  }, /contentSha256/);
});

test('assertPromptProvenance rejects mismatched layer counts', () => {
  assert.throws(() => {
    assertPromptProvenance({
      promptFactoryVersion: 'prompt-factory-v1',
      promptProfileId: 'default-layered-prompt-profile-v1',
      promptStackVersionId: 'prompt-stack-v1',
      assemblyStatus: 'assembled',
      includedLayerCount: 2,
      omittedLayerCount: 0,
      includedLayers: [
        {
          layerId: 'framework-runtime-core',
          layerType: 'framework_runtime',
          owner: 'openmas-framework',
          priority: 10,
          sourceReferences: [],
          contentLength: 42,
          contentSha256: 'a'.repeat(64),
          warnings: [],
        },
      ],
      omittedLayers: [],
      warnings: [],
    });
  }, /includedLayerCount must match/);
});

test('buildPromptProvenance records source references and fingerprints without raw prompt content', () => {
  const instructionLayers = resolveInstructionLayersForInvocation({
    operationalIdentity: createOperationalIdentity(),
    primaryCognitiveIdentity: createCognitiveIdentityContext(),
    secondaryCognitiveIdentities: [],
    brainReference: {
      providerId: 'openrouter-api',
      modelId: 'openrouter/free',
    },
  });
  const {
    brainInput,
    providerRequest,
  } = createBrainInputAndProviderRequest(instructionLayers);

  const provenance = buildPromptProvenance({
    instructionLayers,
    brainInput,
    providerRequest,
  });
  const serializedProvenance = JSON.stringify(provenance);

  assert.equal(provenance.kind, 'prompt_provenance');
  assert.equal(provenance.promptFactoryVersion, 'prompt-factory-v1');
  assert.equal(provenance.promptProfileId, 'default-layered-prompt-profile-v1');
  assert.equal(provenance.promptStackVersionId, 'prompt-stack-v1');
  assert.equal(provenance.includedLayerCount, 6);
  assert.equal(provenance.omittedLayerCount, 2);
  assert.equal(provenance.providerId, 'openrouter-api');
  assert.equal(provenance.modelId, 'openrouter/free');
  assert.equal(provenance.assembly.messageCount, 2);
  assert.equal(provenance.includedLayers[0].content, undefined);
  assert.match(provenance.includedLayers[0].contentSha256, /^[a-f0-9]{64}$/u);
  assert.equal(
    provenance.includedLayers[2].sourceReferences[0].path,
    'instance/cognitive-identities/system-steward/identity.md',
  );
  assert.equal(provenance.includedLayers.at(-1).layerType, 'execution_guard');
  assert.equal(provenance.omittedLayers[0].layerType, 'workflow');
  assert.equal(provenance.omittedLayers.some((layer) => layer.layerType === 'context_pack'), false);
  assert.doesNotMatch(serializedProvenance, /Be precise and audit-friendly/);
  assert.doesNotMatch(serializedProvenance, /Explain MAS structure and runtime status/);
  assert.doesNotMatch(serializedProvenance, /Stop Conditions/);
  assert.doesNotMatch(serializedProvenance, /What is your role/);
});

test('buildPromptProvenance traces durable memory through the context pack layer without raw durable content', () => {
  const contextPackLayer = buildContextPackLayer({
    contextPack: buildDurableContextPack(),
  });
  const provenance = buildPromptProvenance({
    instructionLayers: [contextPackLayer],
    brainInput: {
      providerId: 'openrouter-api',
      modelId: 'openrouter/free',
      systemInstructions: contextPackLayer.content,
      userInput: 'Command: ask',
      messages: [
        {
          role: 'system',
          content: contextPackLayer.content,
        },
        {
          role: 'user',
          content: 'Command: ask',
        },
      ],
    },
    providerRequest: {
      providerId: 'openrouter-api',
      modelId: 'openrouter/free',
      requestType: 'generate_text',
      messages: [],
    },
  });
  const serializedProvenance = JSON.stringify(provenance);
  const contextPackProvenanceLayer = provenance.includedLayers.find((layer) => {
    return layer.layerType === 'context_pack';
  });

  assert.ok(contextPackProvenanceLayer);
  assert.equal(contextPackProvenanceLayer.sourceReferences.some((sourceReference) => {
    return (
      sourceReference.sourceType === 'durable_memory_record'
      && sourceReference.path === 'memory/durable/memory-record-mem_durable_decision.json'
    );
  }), true);
  assert.match(
    contextPackProvenanceLayer.summary,
    /Durable memory provenance: 1 included, 1 omitted, 1 rejected durable source references\./,
  );
  assert.match(contextPackProvenanceLayer.contentSha256, /^[a-f0-9]{64}$/u);
  assert.equal(contextPackProvenanceLayer.content, undefined);
  assert.doesNotMatch(serializedProvenance, /RAW_DURABLE_MEMORY_CONTENT_MUST_NOT_APPEAR/);
  assert.doesNotMatch(serializedProvenance, /Approved durable decisions can shape this invocation/);
});
