import { assertInstructionLayers } from '../contracts/brain/instruction-layer-contract.js';

const DEFAULT_ESTIMATED_CHARACTERS_PER_TOKEN = 4;

function estimateTokensFromCharacters(characters, estimatedCharactersPerToken) {
  if (characters === 0) {
    return 0;
  }

  return Math.ceil(characters / estimatedCharactersPerToken);
}

export function estimatePromptContentSize({
  content,
  estimatedCharactersPerToken = DEFAULT_ESTIMATED_CHARACTERS_PER_TOKEN,
}) {
  const normalizedContent = typeof content === 'string' ? content : '';
  const normalizedCharactersPerToken = Number.isInteger(estimatedCharactersPerToken) && estimatedCharactersPerToken > 0
    ? estimatedCharactersPerToken
    : DEFAULT_ESTIMATED_CHARACTERS_PER_TOKEN;
  const characters = normalizedContent.length;

  return {
    characters,
    estimatedTokens: estimateTokensFromCharacters(characters, normalizedCharactersPerToken),
  };
}

export function estimateInstructionLayersSize({
  instructionLayers,
  estimatedCharactersPerToken = DEFAULT_ESTIMATED_CHARACTERS_PER_TOKEN,
}) {
  const layers = assertInstructionLayers(instructionLayers);
  const layerSizes = layers.map((layer) => {
    return {
      layerId: layer.layerId,
      layerType: layer.layerType,
      ...estimatePromptContentSize({
        content: layer.content,
        estimatedCharactersPerToken,
      }),
    };
  });
  const characters = layerSizes.reduce((total, layer) => {
    return total + layer.characters;
  }, 0);

  return {
    characters,
    estimatedTokens: estimateTokensFromCharacters(characters, estimatedCharactersPerToken),
    layers: layerSizes,
  };
}

export {
  DEFAULT_ESTIMATED_CHARACTERS_PER_TOKEN,
};
