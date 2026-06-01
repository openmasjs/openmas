import { assertInstructionLayer } from '../contracts/brain/instruction-layer-contract.js';

const OPERATIONAL_IDENTITY_LAYER_PRIORITY = 20;
const COGNITIVE_IDENTITY_LAYER_PRIORITY = 30;

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function getCognitiveIdentitySourcePath(cognitiveIdentity, fileName) {
  const sourcePaths = cognitiveIdentity?.sourcePaths ?? {};

  if (fileName === 'identity.md') {
    return sourcePaths.identity ?? null;
  }

  if (fileName === 'policies.md') {
    return sourcePaths.policies ?? null;
  }

  if (fileName === 'capabilities.md') {
    return sourcePaths.capabilities ?? null;
  }

  return null;
}

export function buildCognitiveIdentityFileSourceReference({ cognitiveIdentity, fileName }) {
  return {
    sourceType: 'cognitive_identity_file',
    sourceId: `${cognitiveIdentity.cognitiveIdentityId}:${fileName}`,
    path: getCognitiveIdentitySourcePath(cognitiveIdentity, fileName),
  };
}

function buildOperationalIdentitySourceReference(operationalIdentity) {
  return {
    sourceType: 'operational_identity_definition',
    sourceId: operationalIdentity?.operationalIdentityId
      ? `${operationalIdentity.operationalIdentityId}:identity.json`
      : 'unknown-operational-identity:identity.json',
    path: operationalIdentity?.operationalIdentityId
      ? `instance/operational-identities/${operationalIdentity.operationalIdentityId}/identity.json`
      : null,
  };
}

export function buildOperationalIdentityInstructionContent({ operationalIdentity }) {
  const operationalDisplayName = isNonEmptyString(operationalIdentity?.displayName)
    ? operationalIdentity.displayName.trim()
    : operationalIdentity?.operationalIdentityId?.trim() ?? 'this Operational Identity';
  const lines = [
    '## Operational Identity',
  ];

  if (isNonEmptyString(operationalIdentity?.displayName)) {
    lines.push(`Display Name: ${operationalDisplayName}`);
  }

  if (isNonEmptyString(operationalIdentity?.operationalIdentityId)) {
    lines.push(`Operational Identity ID: ${operationalIdentity.operationalIdentityId.trim()}`);
  }

  lines.push(`Acting Agent Name: ${operationalDisplayName}`);
  lines.push('Identity Rule: You act as this Operational Identity. Primary and secondary Cognitive Identities are your resolved expertise, not your operational name and not a separate acting Agent.');
  lines.push(`Self-Identification Rule: If asked who you are or for your operational name, identify yourself as ${operationalDisplayName} and mention a Cognitive Identity only as cognition being used.`);

  if (isNonEmptyString(operationalIdentity?.persona?.tone)) {
    lines.push(`Tone: ${operationalIdentity.persona.tone.trim()}`);
  }

  if (isNonEmptyString(operationalIdentity?.persona?.presentationStyle)) {
    lines.push(`Presentation Style: ${operationalIdentity.persona.presentationStyle.trim()}`);
  }

  return lines.join('\n');
}

function buildCognitiveIdentityBlock({ title, cognitiveIdentity }) {
  return [
    `### ${title}`,
    `Cognitive Identity ID: ${cognitiveIdentity.cognitiveIdentityId}`,
    '',
    '#### Identity',
    cognitiveIdentity.identityText,
  ].join('\n');
}

function buildSecondaryCognitiveIdentityBlocks(secondaryCognitiveIdentities) {
  if (!secondaryCognitiveIdentities || secondaryCognitiveIdentities.length === 0) {
    return [];
  }

  return [
    '### Secondary Cognitive Identities',
    ...secondaryCognitiveIdentities.map((cognitiveIdentity, index) => {
      return buildCognitiveIdentityBlock({
        title: `Secondary Cognitive Identity ${index + 1}`,
        cognitiveIdentity,
      });
    }),
  ];
}

export function buildCognitiveIdentityInstructionContent({
  primaryCognitiveIdentity,
  secondaryCognitiveIdentities = [],
}) {
  return [
    '## Cognitive Identity Instructions',
    'These instructions define the active expert identity set for this invocation.',
    '',
    buildCognitiveIdentityBlock({
      title: 'Primary Cognitive Identity',
      cognitiveIdentity: primaryCognitiveIdentity,
    }),
    ...buildSecondaryCognitiveIdentityBlocks(secondaryCognitiveIdentities),
  ].join('\n\n');
}

export function buildOperationalIdentityLayer({ operationalIdentity }) {
  return assertInstructionLayer({
    layerId: `operational-identity-${operationalIdentity?.operationalIdentityId ?? 'unknown'}`,
    layerType: 'operational_identity',
    owner: operationalIdentity?.operationalIdentityId ?? 'unknown-operational-identity',
    priority: OPERATIONAL_IDENTITY_LAYER_PRIORITY,
    sourceReferences: [
      buildOperationalIdentitySourceReference(operationalIdentity),
    ],
    content: buildOperationalIdentityInstructionContent({
      operationalIdentity,
    }),
    summary: 'Human-facing persona and Operational Identity context.',
    warnings: [],
  });
}

export function buildCognitiveIdentityLayer({
  primaryCognitiveIdentity,
  secondaryCognitiveIdentities = [],
}) {
  const activeCognitiveIdentities = [
    primaryCognitiveIdentity,
    ...secondaryCognitiveIdentities,
  ];

  return assertInstructionLayer({
    layerId: 'active-cognitive-identity-instructions',
    layerType: 'cognitive_identity',
    owner: 'active-cognitive-set',
    priority: COGNITIVE_IDENTITY_LAYER_PRIORITY,
    sourceReferences: activeCognitiveIdentities.map((cognitiveIdentity) => {
      return buildCognitiveIdentityFileSourceReference({
        cognitiveIdentity,
        fileName: 'identity.md',
      });
    }),
    content: buildCognitiveIdentityInstructionContent({
      primaryCognitiveIdentity,
      secondaryCognitiveIdentities,
    }),
    summary: 'Primary and secondary cognitive identity instructions for this invocation.',
    warnings: [],
  });
}
