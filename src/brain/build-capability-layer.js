import { assertInstructionLayer } from '../contracts/brain/instruction-layer-contract.js';
import { buildCognitiveIdentityFileSourceReference } from './build-identity-layer.js';

const CAPABILITY_LAYER_PRIORITY = 50;

function buildPrimaryCapabilityBlock(primaryCognitiveIdentity) {
  return [
    '### Primary Cognitive Identity Capabilities',
    `Cognitive Identity ID: ${primaryCognitiveIdentity.cognitiveIdentityId}`,
    '',
    primaryCognitiveIdentity.capabilitiesText,
  ].join('\n');
}

function buildSecondaryCapabilityBlocks(secondaryCognitiveIdentities) {
  if (!secondaryCognitiveIdentities || secondaryCognitiveIdentities.length === 0) {
    return [];
  }

  return [
    '### Secondary Cognitive Identity Capabilities',
    ...secondaryCognitiveIdentities.map((cognitiveIdentity, index) => {
      return [
        `#### Secondary Cognitive Identity Capability ${index + 1}`,
        `Cognitive Identity ID: ${cognitiveIdentity.cognitiveIdentityId}`,
        '',
        cognitiveIdentity.capabilitiesText,
      ].join('\n');
    }),
  ];
}

export function buildCapabilityInstructionContent({
  primaryCognitiveIdentity,
  secondaryCognitiveIdentities = [],
}) {
  return [
    '## Capability Instructions',
    'These instructions describe what the active cognitive identity set is designed to do.',
    '',
    buildPrimaryCapabilityBlock(primaryCognitiveIdentity),
    ...buildSecondaryCapabilityBlocks(secondaryCognitiveIdentities),
  ].join('\n\n');
}

export function buildCapabilityLayer({
  primaryCognitiveIdentity,
  secondaryCognitiveIdentities = [],
}) {
  const activeCognitiveIdentities = [
    primaryCognitiveIdentity,
    ...secondaryCognitiveIdentities,
  ];

  return assertInstructionLayer({
    layerId: 'active-cognitive-capability-instructions',
    layerType: 'capability',
    owner: 'active-cognitive-set',
    priority: CAPABILITY_LAYER_PRIORITY,
    sourceReferences: activeCognitiveIdentities.map((cognitiveIdentity) => {
      return buildCognitiveIdentityFileSourceReference({
        cognitiveIdentity,
        fileName: 'capabilities.md',
      });
    }),
    content: buildCapabilityInstructionContent({
      primaryCognitiveIdentity,
      secondaryCognitiveIdentities,
    }),
    summary: 'Capability instructions from the active cognitive identity set.',
    warnings: [],
  });
}
