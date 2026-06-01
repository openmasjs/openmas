import { createHash } from 'node:crypto';
import { assertInstructionLayers } from '../contracts/brain/instruction-layer-contract.js';
import { assertPromptProvenance } from '../contracts/prompts/prompt-provenance-contract.js';

const PROMPT_FACTORY_VERSION = 'prompt-factory-v1';
const DEFAULT_PROMPT_PROFILE_ID = 'default-layered-prompt-profile-v1';
const DEFAULT_PROMPT_STACK_VERSION_ID = 'prompt-stack-v1';

const DEFAULT_OMITTED_LAYER_CANDIDATES = [
  {
    layerId: 'workflow-instructions',
    layerType: 'workflow',
    reason: 'not_available_for_current_invocation',
    sourceReferences: [],
  },
  {
    layerId: 'few-shot-examples',
    layerType: 'few_shot',
    reason: 'not_available_in_current_prompt_profile',
    sourceReferences: [],
  },
];

function buildDefaultOmittedLayers(instructionLayers) {
  const includedLayerTypes = new Set(instructionLayers.map((layer) => {
    return layer.layerType;
  }));

  return DEFAULT_OMITTED_LAYER_CANDIDATES.filter((layer) => {
    return !includedLayerTypes.has(layer.layerType);
  });
}

function buildContentSha256(content) {
  return createHash('sha256')
    .update(content, 'utf8')
    .digest('hex');
}

function summarizeIncludedLayer(layer) {
  return {
    layerId: layer.layerId,
    layerType: layer.layerType,
    owner: layer.owner,
    priority: layer.priority,
    sourceReferences: layer.sourceReferences,
    contentLength: layer.content.length,
    contentSha256: buildContentSha256(layer.content),
    summary: layer.summary,
    warnings: layer.warnings,
  };
}

export function buildPromptProvenance({
  instructionLayers,
  brainInput,
  providerRequest,
  promptProfileId = DEFAULT_PROMPT_PROFILE_ID,
  promptStackVersionId = DEFAULT_PROMPT_STACK_VERSION_ID,
  omittedLayers = null,
  warnings = [],
}) {
  const normalizedInstructionLayers = assertInstructionLayers(instructionLayers)
    .toSorted((left, right) => {
      if (left.priority !== right.priority) {
        return left.priority - right.priority;
      }

      return left.layerId.localeCompare(right.layerId);
    });
  const resolvedOmittedLayers = omittedLayers ?? buildDefaultOmittedLayers(normalizedInstructionLayers);

  const includedLayers = normalizedInstructionLayers.map((layer) => {
    return summarizeIncludedLayer(layer);
  });

  return assertPromptProvenance({
    promptFactoryVersion: PROMPT_FACTORY_VERSION,
    promptProfileId,
    promptStackVersionId,
    assemblyStatus: 'assembled',
    providerId: brainInput?.providerId ?? providerRequest?.providerId ?? null,
    modelId: brainInput?.modelId ?? providerRequest?.modelId ?? null,
    requestType: providerRequest?.requestType ?? null,
    assembly: {
      systemInstructionsLength: brainInput?.systemInstructions?.length ?? null,
      userInputLength: brainInput?.userInput?.length ?? null,
      messageCount: brainInput?.messages?.length ?? providerRequest?.messages?.length ?? null,
    },
    includedLayerCount: includedLayers.length,
    omittedLayerCount: resolvedOmittedLayers.length,
    includedLayers,
    omittedLayers: resolvedOmittedLayers,
    warnings,
  });
}

export {
  DEFAULT_PROMPT_PROFILE_ID,
  DEFAULT_PROMPT_STACK_VERSION_ID,
  PROMPT_FACTORY_VERSION,
};
