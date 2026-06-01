import { assertToolDefinition, toolDefinitionRequiresApproval } from '../contracts/tools/tool-definition-contract.js';
import { assertToolReadinessEvaluation } from '../contracts/tools/tool-readiness-contract.js';
import { resolveUsableBindingsForInvocation } from '../operational-identities/resolve-usable-bindings-for-invocation.js';

function createBindingKey({ resourceId, accessMode }) {
  return `${resourceId}::${accessMode}`;
}

function sortBindings(bindings) {
  return [...bindings].toSorted((left, right) => {
    return createBindingKey(left).localeCompare(createBindingKey(right));
  });
}

function createRequirements(toolDefinition) {
  if (
    toolDefinition.requiredResourceTypes.length === 0
    && toolDefinition.requiredAccessModes.length === 0
  ) {
    return [];
  }

  const resourceTypes = toolDefinition.requiredResourceTypes.length === 0
    ? [null]
    : toolDefinition.requiredResourceTypes;
  const accessModes = toolDefinition.requiredAccessModes.length === 0
    ? [null]
    : toolDefinition.requiredAccessModes;

  return resourceTypes.flatMap((resourceType) => {
    return accessModes.map((accessMode) => ({
      resourceType,
      accessMode,
    }));
  });
}

function bindingMatchesRequirement(binding, requirement) {
  const resourceTypeMatches = requirement.resourceType === null || binding.resourceType === requirement.resourceType;
  const accessModeMatches = requirement.accessMode === null || binding.accessMode === requirement.accessMode;

  return resourceTypeMatches && accessModeMatches;
}

function findMatchingBinding({ bindings, requirement }) {
  return sortBindings(bindings).find((binding) => {
    return bindingMatchesRequirement(binding, requirement);
  }) ?? null;
}

function findPermissionDecision({ permissionEvaluation, binding }) {
  if (!permissionEvaluation) {
    return null;
  }

  return permissionEvaluation.evaluatedBindings.find((decision) => {
    return decision.resourceId === binding.resourceId && decision.accessMode === binding.accessMode;
  }) ?? null;
}

function buildMissingBindingReason({ requirement, resolvedBindings, permissionEvaluation }) {
  const candidateBinding = findMatchingBinding({
    bindings: resolvedBindings,
    requirement,
  });

  if (!candidateBinding) {
    return `No resolved binding satisfies resourceType "${requirement.resourceType ?? '*'}" with accessMode "${requirement.accessMode ?? '*'}".`;
  }

  if (candidateBinding.bindingState !== 'active') {
    return `Binding ${candidateBinding.resourceId} with accessMode ${candidateBinding.accessMode} is not active: ${candidateBinding.bindingState}.`;
  }

  if (candidateBinding.resourceLifecycleState !== 'active') {
    return `Resource ${candidateBinding.resourceId} lifecycle state is not active: ${candidateBinding.resourceLifecycleState}.`;
  }

  const permissionDecision = findPermissionDecision({
    permissionEvaluation,
    binding: candidateBinding,
  });

  if (permissionDecision?.effect === 'deny') {
    return permissionDecision.reason;
  }

  return `Binding ${candidateBinding.resourceId} with accessMode ${candidateBinding.accessMode} is not usable for this invocation.`;
}

function findSecretResolution({ secretResolution, credentialReferenceId }) {
  if (!secretResolution || !credentialReferenceId) {
    return null;
  }

  return secretResolution.resolvedCredentialReferences.find((entry) => {
    return entry.credentialReferenceId === credentialReferenceId;
  }) ?? null;
}

function buildMatchedBinding({ binding, secretResolution }) {
  const secretResolutionEntry = findSecretResolution({
    secretResolution,
    credentialReferenceId: binding.credentialReferenceId,
  });

  return {
    resourceId: binding.resourceId,
    resourceType: binding.resourceType,
    accessMode: binding.accessMode,
    credentialReferenceId: binding.credentialReferenceId,
    secretResolutionStatus: binding.credentialReferenceId
      ? secretResolutionEntry?.resolutionStatus ?? 'unresolved'
      : null,
  };
}

function evaluateSecretReadiness({ matchedBindings }) {
  return matchedBindings
    .filter((binding) => {
      return binding.credentialReferenceId !== null && binding.secretResolutionStatus !== 'resolved';
    })
    .map((binding) => ({
      resourceType: binding.resourceType,
      accessMode: binding.accessMode,
      reason: `Credential Reference ${binding.credentialReferenceId} is not resolved for resource ${binding.resourceId}.`,
    }));
}

function buildToolVerdict({
  toolDefinition,
  resolvedBindings,
  permissionEvaluation,
  usableBindings,
  secretResolution,
}) {
  if (toolDefinition.lifecycleState !== 'active') {
    return {
      kind: 'tool_readiness_verdict',
      version: 1,
      toolId: toolDefinition.toolId,
      status: 'unavailable',
      approvalRequired: false,
      reason: `Tool ${toolDefinition.toolId} lifecycle state is not active: ${toolDefinition.lifecycleState}.`,
      matchedBindings: [],
      missingRequirements: [
        {
          resourceType: null,
          accessMode: null,
          reason: `Tool lifecycle state is not active: ${toolDefinition.lifecycleState}.`,
        },
      ],
      warnings: [],
    };
  }

  const requirements = createRequirements(toolDefinition);
  const missingBindingRequirements = [];
  const matchedBindings = [];

  for (const requirement of requirements) {
    const matchedBinding = findMatchingBinding({
      bindings: usableBindings,
      requirement,
    });

    if (!matchedBinding) {
      missingBindingRequirements.push({
        resourceType: requirement.resourceType,
        accessMode: requirement.accessMode,
        reason: buildMissingBindingReason({
          requirement,
          resolvedBindings,
          permissionEvaluation,
        }),
      });
      continue;
    }

    matchedBindings.push(buildMatchedBinding({
      binding: matchedBinding,
      secretResolution,
    }));
  }

  if (missingBindingRequirements.length > 0) {
    return {
      kind: 'tool_readiness_verdict',
      version: 1,
      toolId: toolDefinition.toolId,
      status: 'denied',
      approvalRequired: false,
      reason: `Tool ${toolDefinition.toolId} is denied because one or more required bindings are not usable.`,
      matchedBindings,
      missingRequirements: missingBindingRequirements,
      warnings: [],
    };
  }

  const missingSecretRequirements = evaluateSecretReadiness({
    matchedBindings,
  });

  if (missingSecretRequirements.length > 0) {
    return {
      kind: 'tool_readiness_verdict',
      version: 1,
      toolId: toolDefinition.toolId,
      status: 'unavailable',
      approvalRequired: false,
      reason: `Tool ${toolDefinition.toolId} is unavailable because one or more required secrets are not resolved.`,
      matchedBindings,
      missingRequirements: missingSecretRequirements,
      warnings: [],
    };
  }

  if (toolDefinitionRequiresApproval(toolDefinition)) {
    return {
      kind: 'tool_readiness_verdict',
      version: 1,
      toolId: toolDefinition.toolId,
      status: 'approval_required',
      approvalRequired: true,
      reason: `Tool ${toolDefinition.toolId} passed readiness gates but requires approval before execution.`,
      matchedBindings,
      missingRequirements: [],
      warnings: [],
    };
  }

  return {
    kind: 'tool_readiness_verdict',
    version: 1,
    toolId: toolDefinition.toolId,
    status: 'ready',
    approvalRequired: false,
    reason: `Tool ${toolDefinition.toolId} passed readiness gates and can be requested for execution.`,
    matchedBindings,
    missingRequirements: [],
    warnings: [],
  };
}

function buildSummary(evaluatedTools) {
  return evaluatedTools.reduce((summary, verdict) => {
    summary.totalEvaluated++;

    if (verdict.status === 'ready') {
      summary.ready++;
    } else if (verdict.status === 'approval_required') {
      summary.approvalRequired++;
    } else if (verdict.status === 'denied') {
      summary.denied++;
    } else if (verdict.status === 'unavailable') {
      summary.unavailable++;
    }

    return summary;
  }, {
    totalEvaluated: 0,
    ready: 0,
    approvalRequired: 0,
    denied: 0,
    unavailable: 0,
  });
}

export function evaluateToolReadinessForInvocation({
  toolDefinitions = [],
  resolvedBindings = [],
  permissionEvaluation = null,
  secretResolution = null,
} = {}) {
  if (!Array.isArray(toolDefinitions)) {
    throw new Error('Tool readiness evaluator toolDefinitions must be an array.');
  }

  if (!Array.isArray(resolvedBindings)) {
    throw new Error('Tool readiness evaluator resolvedBindings must be an array.');
  }

  const normalizedToolDefinitions = toolDefinitions.map(assertToolDefinition);
  const usableBindings = resolveUsableBindingsForInvocation({
    resolvedBindings,
    permissionEvaluation,
  });
  const evaluatedTools = normalizedToolDefinitions
    .map((toolDefinition) => {
      return buildToolVerdict({
        toolDefinition,
        resolvedBindings,
        permissionEvaluation,
        usableBindings,
        secretResolution,
      });
    })
    .toSorted((left, right) => {
      return left.toolId.localeCompare(right.toolId);
    });

  return assertToolReadinessEvaluation({
    kind: 'tool_readiness_evaluation',
    version: 1,
    evaluatedTools,
    summary: buildSummary(evaluatedTools),
    warnings: [],
  });
}
