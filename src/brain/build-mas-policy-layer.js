import { assertInstructionLayer } from '../contracts/brain/instruction-layer-contract.js';
import { assertMasPolicySources } from '../contracts/policies/mas-policy-source-contract.js';

const MAS_POLICY_LAYER_PRIORITY = 15;

function formatWarnings(warnings) {
  if (!Array.isArray(warnings) || warnings.length === 0) {
    return [];
  }

  return [
    '',
    'Warnings:',
    ...warnings.map((warning) => `- ${warning}`),
  ];
}

function buildPolicyBlock(policySource, index) {
  return [
    `### MAS Policy ${index + 1}: ${policySource.title}`,
    `Source ID: ${policySource.sourceId}`,
    `Source Path: ${policySource.sourcePath}`,
    `Priority: ${policySource.priority}`,
    '',
    policySource.content,
    ...formatWarnings(policySource.warnings),
  ].join('\n');
}

function buildMasPolicySourceReference(policySource) {
  return {
    sourceType: 'mas_policy_document',
    sourceId: policySource.sourceId,
    path: policySource.sourcePath,
  };
}

export function buildMasPolicyInstructionContent({
  policySources,
}) {
  return [
    '## MAS-Level Policy Instructions',
    'These are MAS-wide policies defined by the current MAS instance.',
    'They have higher prompt authority than Operational Identity persona, Cognitive Identity instructions, capabilities, workflow guidance, examples, and ordinary memory.',
    'They do not grant runtime authority. Tools, resources, channels, secrets, workflows, approvals, and external actions still require runtime readiness, bindings, permissions, and audit evidence.',
    '',
    ...policySources.map(buildPolicyBlock),
  ].join('\n');
}

export function buildMasPolicyLayer({
  policySources = [],
  warnings = [],
} = {}) {
  const normalizedPolicySources = assertMasPolicySources(policySources);

  if (normalizedPolicySources.length === 0) {
    return null;
  }

  return assertInstructionLayer({
    layerId: 'mas-level-policy-instructions',
    layerType: 'mas_policy',
    owner: 'mas-instance',
    priority: MAS_POLICY_LAYER_PRIORITY,
    sourceReferences: normalizedPolicySources.map(buildMasPolicySourceReference),
    content: buildMasPolicyInstructionContent({
      policySources: normalizedPolicySources,
    }),
    summary: `MAS-level policy instructions from ${normalizedPolicySources.length} active policy source(s).`,
    warnings,
  });
}

export {
  MAS_POLICY_LAYER_PRIORITY,
};
