import { assertInstructionLayer } from '../contracts/brain/instruction-layer-contract.js';
import { buildCognitiveIdentityFileSourceReference } from './build-identity-layer.js';

const POLICY_LAYER_PRIORITY = 40;

function buildPrimaryPolicyBlock(primaryCognitiveIdentity) {
  return [
    '### Primary Cognitive Identity Policies',
    `Cognitive Identity ID: ${primaryCognitiveIdentity.cognitiveIdentityId}`,
    '',
    primaryCognitiveIdentity.policiesText,
  ].join('\n');
}

function buildSecondaryPolicyBlocks(secondaryCognitiveIdentities) {
  if (!secondaryCognitiveIdentities || secondaryCognitiveIdentities.length === 0) {
    return [];
  }

  return [
    '### Secondary Cognitive Identity Policies',
    ...secondaryCognitiveIdentities.map((cognitiveIdentity, index) => {
      return [
        `#### Secondary Cognitive Identity Policy ${index + 1}`,
        `Cognitive Identity ID: ${cognitiveIdentity.cognitiveIdentityId}`,
        '',
        cognitiveIdentity.policiesText,
      ].join('\n');
    }),
  ];
}

export function buildPolicyInstructionContent({
  primaryCognitiveIdentity,
  secondaryCognitiveIdentities = [],
}) {
  return [
    '## Policy Instructions',
    'These instructions are binding behavioral constraints for the active cognitive identity set.',
    '',
    buildPrimaryPolicyBlock(primaryCognitiveIdentity),
    ...buildSecondaryPolicyBlocks(secondaryCognitiveIdentities),
  ].join('\n\n');
}

export function buildPolicyLayer({
  primaryCognitiveIdentity,
  secondaryCognitiveIdentities = [],
}) {
  const activeCognitiveIdentities = [
    primaryCognitiveIdentity,
    ...secondaryCognitiveIdentities,
  ];

  return assertInstructionLayer({
    layerId: 'active-cognitive-policy-instructions',
    layerType: 'policy',
    owner: 'active-cognitive-set',
    priority: POLICY_LAYER_PRIORITY,
    sourceReferences: activeCognitiveIdentities.map((cognitiveIdentity) => {
      return buildCognitiveIdentityFileSourceReference({
        cognitiveIdentity,
        fileName: 'policies.md',
      });
    }),
    content: buildPolicyInstructionContent({
      primaryCognitiveIdentity,
      secondaryCognitiveIdentities,
    }),
    summary: 'Policy instructions from the active cognitive identity set.',
    warnings: [],
  });
}
