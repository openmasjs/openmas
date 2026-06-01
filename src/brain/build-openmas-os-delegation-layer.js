import { assertInstructionLayer } from '../contracts/brain/instruction-layer-contract.js';

const OPENMAS_OS_DELEGATION_LAYER_PRIORITY = 63;

function formatList(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return 'none';
  }

  return values.join(', ');
}

function formatNullable(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : 'none';
}

function buildTargetBlock(entry) {
  const target = entry.target;

  return [
    `### ${target.displayName} (${target.operationalIdentityId})`,
    `Operational Identity ID: ${target.operationalIdentityId}`,
    `Lifecycle State: ${target.lifecycleState}`,
    `Role: ${formatNullable(target.roleLabel)}`,
    `Attached Cognitive Identities: ${formatList(target.attachedCognitiveIdentityIds)}`,
    `Operational Scope: ${formatList(target.operationalScope)}`,
    `Policy Rule: ${entry.ruleId}`,
    `Allowed Action Types: ${formatList(entry.actionTypes)}`,
    `Allowed Commands: ${formatList(entry.commands)}`,
    `Allowed Modes: ${formatList(entry.modes)}`,
    `Policy Description: ${formatNullable(entry.description)}`,
  ].join('\n');
}

export function buildOpenMasOsDelegationInstructionContent({
  allowedDelegationTargets = [],
}) {
  return [
    '## OpenMAS OS Delegation Context',
    'This layer lists Operational Identity delegation targets authorized for the current invocation by the OpenMAS OS delegation policy.',
    'Delegation targets are Operational Identities, not necessarily standalone Cognitive Identities. Do not reject a target only because its display name is not listed in the Cognitive Identity registry.',
    'If the user asks the current Operational Identity to ask, assign, or hand off work to one of these targets now, requesting mas.os.delegate is an allowed AI-native path.',
    'If the user asks the current Operational Identity to ask, assign, or hand off work to one of these targets later at an explicit time, requesting mas.os.schedule_delegation is the allowed AI-native path.',
    'Immediate delegation and scheduled delegation are mutually exclusive for a single answer. Choose exactly one OS tool request, never both.',
    'Delegation is asynchronous: submitting immediate work, or scheduling future work, does not prove that the target has completed it.',
    'Only report target completion when runtime evidence includes its completed child Result Record.',
    'For future scheduled delegation, preserve the exact target Operational Identity ID from this layer and use the exact ISO timestamp with timezone from the user or already-established context.',
    'The deterministic OS Action Gate remains the authority that accepts, denies, or executes the delegation.',
    '',
    '## Allowed Delegation Targets',
    allowedDelegationTargets.length > 0
      ? allowedDelegationTargets.map(buildTargetBlock).join('\n\n')
      : 'none',
  ].join('\n');
}

export function buildOpenMasOsDelegationLayer({
  delegationContext = null,
} = {}) {
  if (!delegationContext || delegationContext.allowedDelegationTargets.length === 0) {
    return null;
  }

  return assertInstructionLayer({
    layerId: 'openmas-os-delegation-context',
    layerType: 'delegation_context',
    owner: 'openmas-os',
    priority: OPENMAS_OS_DELEGATION_LAYER_PRIORITY,
    sourceReferences: [
      {
        sourceType: 'openmas_os_delegation_policy',
        sourceId: 'current-invocation-allowed-delegation-targets',
        path: 'instance/registries/delegation-policy.json',
      },
    ],
    content: buildOpenMasOsDelegationInstructionContent({
      allowedDelegationTargets: delegationContext.allowedDelegationTargets,
    }),
    summary: `Allowed OpenMAS OS delegation targets: ${delegationContext.allowedDelegationTargets.length}.`,
    warnings: delegationContext.warnings ?? [],
  });
}

export {
  OPENMAS_OS_DELEGATION_LAYER_PRIORITY,
};
