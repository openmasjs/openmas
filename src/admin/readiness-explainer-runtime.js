import path from 'node:path';
import { readToolDefinitions } from '../tools/read-tool-definitions.js';
import { evaluateToolReadinessForInvocation } from '../tools/evaluate-tool-readiness-for-invocation.js';
import { readWorkflowRuntimeDefinitions } from '../workflows/read-workflow-runtime-definitions.js';
import { resolveOperationalIdentityRoot } from '../operational-identities/resolve-operational-identity-root.js';
import { readResourcesRegistry } from '../operational-identities/read-resources-registry.js';
import { readBindingDefinitions } from '../operational-identities/read-binding-definitions.js';
import { resolveBindingsForInvocation } from '../operational-identities/resolve-bindings-for-invocation.js';
import { readPermissionDefinitions } from '../operational-identities/read-permission-definitions.js';
import { evaluatePermissionsForInvocation } from '../operational-identities/evaluate-permissions-for-invocation.js';
import { resolveUsableBindingsForInvocation } from '../operational-identities/resolve-usable-bindings-for-invocation.js';
import { readCredentialReferenceRegistry } from '../credential-references/read-credential-reference-registry.js';
import { resolveCredentialReferencesForInvocation } from '../credential-references/resolve-credential-references-for-invocation.js';

const READINESS_ORDER = {
  ready: 0,
  approval_required: 1,
  denied: 2,
  unavailable: 3,
  not_evaluated: 4,
};

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeOptionalIdentifier(value) {
  return isNonEmptyString(value) ? value.trim() : null;
}

function compareById(left, right, fieldName) {
  return left[fieldName].localeCompare(right[fieldName]);
}

function buildEmptySecretResolution() {
  return {
    resolvedCredentialReferences: [],
    summary: {
      totalReferenced: 0,
      resolved: 0,
      unresolved: 0,
      missingDefinitions: 0,
    },
    warnings: [],
    secretValueByReferenceId: new Map(),
  };
}

function withoutSecretValues(secretResolution) {
  return {
    resolvedCredentialReferences: secretResolution.resolvedCredentialReferences.map((entry) => ({
      resourceId: entry.resourceId,
      credentialReferenceId: entry.credentialReferenceId,
      credentialType: entry.credentialType,
      valueShape: entry.valueShape,
      resolutionStatus: entry.resolutionStatus,
      hasSecretValue: entry.hasSecretValue,
    })),
    summary: secretResolution.summary,
    warnings: secretResolution.warnings.map((entry) => {
      return sanitizeSecretResolutionMessage(entry);
    }),
    credentialVaultEnvironment: secretResolution.credentialVaultEnvironment,
    credentialVaultExists: secretResolution.credentialVaultExists,
  };
}

function sanitizeSecretResolutionMessage(message) {
  if (!isNonEmptyString(message)) {
    return 'Secret resolution warning was omitted because it was not a string.';
  }

  return message
    .replaceAll(/Environment variable [A-Z0-9_]+/gu, 'Configured environment variable')
    .replaceAll(/Credential Reference [a-zA-Z0-9._:-]+/gu, 'Credential Reference')
    .trim();
}

function summarizeIntentMetadata(intentMetadata) {
  if (!isPlainObject(intentMetadata)) {
    return null;
  }

  return {
    primaryIntentId: intentMetadata.primaryIntentId,
    semanticTags: intentMetadata.semanticTags,
    requestTypes: intentMetadata.requestTypes,
  };
}

function findVerdict(toolReadinessEvaluation, toolId) {
  return toolReadinessEvaluation.evaluatedTools.find((verdict) => {
    return verdict.toolId === toolId;
  }) ?? null;
}

function summarizeToolDefinition(toolDefinition, readinessVerdict) {
  return {
    toolId: toolDefinition.toolId,
    displayName: toolDefinition.displayName,
    description: toolDefinition.description,
    lifecycleState: toolDefinition.lifecycleState,
    toolType: toolDefinition.toolType,
    sideEffectLevel: toolDefinition.sideEffectLevel,
    approvalRequiredByDefinition: toolDefinition.approvalPolicy.required,
    requiredResourceTypes: toolDefinition.requiredResourceTypes,
    requiredAccessModes: toolDefinition.requiredAccessModes,
    requiredPermissionModes: toolDefinition.requiredPermissionModes,
    sourcePath: toolDefinition.sourcePath ?? null,
    intentMetadata: summarizeIntentMetadata(toolDefinition.intentMetadata),
    readiness: readinessVerdict
      ? {
          status: readinessVerdict.status,
          approvalRequired: readinessVerdict.approvalRequired,
          reason: readinessVerdict.reason,
          matchedBindings: readinessVerdict.matchedBindings,
          missingRequirements: readinessVerdict.missingRequirements,
          warnings: readinessVerdict.warnings,
        }
      : {
          status: 'not_evaluated',
          approvalRequired: false,
          reason: 'Tool readiness was not evaluated for this tool.',
          matchedBindings: [],
          missingRequirements: [],
          warnings: [],
        },
  };
}

function summarizeReadinessCounts(items) {
  return items.reduce((summary, item) => {
    const status = item.readiness.status;
    summary.total++;
    summary[status] = (summary[status] ?? 0) + 1;
    return summary;
  }, {
    total: 0,
    ready: 0,
    approval_required: 0,
    denied: 0,
    unavailable: 0,
    not_evaluated: 0,
  });
}

function filterByOptionalId(items, fieldName, targetId) {
  if (!targetId) {
    return items;
  }

  return items.filter((item) => item[fieldName] === targetId);
}

async function buildOperationalIdentityAccessContext({
  masRootPath,
  operationalIdentityId,
}) {
  if (!isNonEmptyString(masRootPath)) {
    throw new Error('Readiness explainer requires a non-empty masRootPath.');
  }

  if (!isNonEmptyString(operationalIdentityId)) {
    throw new Error('Readiness explainer requires a non-empty operationalIdentityId.');
  }

  const warnings = [];
  const projectRootPath = path.dirname(path.resolve(masRootPath));
  const identityRootResolution = await resolveOperationalIdentityRoot({
    masRootPath,
    operationalIdentityId,
  });
  const resourcesRegistryResult = await readResourcesRegistry({ masRootPath });
  const resourceRegistry = resourcesRegistryResult.registry ?? {
    kind: 'resource_registry',
    version: 1,
    resources: [],
  };

  if (!resourcesRegistryResult.registry) {
    warnings.push('Resource registry is missing; readiness explanations cannot resolve resource definitions.');
  }

  const bindingResult = await readBindingDefinitions({
    operationalIdentityRootPath: identityRootResolution.operationalIdentityRootPath,
    expectedOperationalIdentityId: operationalIdentityId,
  });
  const bindingDefinitions = bindingResult.bindings;

  if (!bindingDefinitions) {
    warnings.push(`Operational Identity ${operationalIdentityId} has no bindings.json file.`);
  }

  const bindingResolution = resolveBindingsForInvocation({
    bindingDefinitions,
    resourceRegistry,
    operationalIdentityId,
  });

  warnings.push(...bindingResolution.warnings);

  const permissionResult = await readPermissionDefinitions({
    operationalIdentityRootPath: identityRootResolution.operationalIdentityRootPath,
    expectedOperationalIdentityId: operationalIdentityId,
  });
  const permissionDefinitions = permissionResult.permissions;

  if (!permissionDefinitions) {
    warnings.push(`Operational Identity ${operationalIdentityId} has no permissions.json file.`);
  }

  const permissionEvaluation = evaluatePermissionsForInvocation({
    resolvedBindings: bindingResolution.resolvedBindings,
    permissionDefinitions,
  });
  const usableBindings = resolveUsableBindingsForInvocation({
    resolvedBindings: bindingResolution.resolvedBindings,
    permissionEvaluation,
  });
  const credentialRegistryResult = await readCredentialReferenceRegistry({
    projectRootPath,
  });
  const credentialReferenceRegistry = credentialRegistryResult.registry ?? {
    kind: 'credential_reference_registry',
    version: 1,
    credentialReferences: [],
  };

  if (!credentialRegistryResult.registry) {
    warnings.push('Credential reference registry is missing; credential-backed readiness may report missing definitions.');
  }

  const secretResolution = usableBindings.length > 0
    ? await resolveCredentialReferencesForInvocation({
        projectRootPath,
        usableBindings,
        credentialReferenceRegistry,
      })
    : buildEmptySecretResolution();

  return {
    operationalIdentityId,
    projectRootPath,
    operationalIdentityRootPath: identityRootResolution.operationalIdentityRootPath,
    resourcesRegistryPath: resourcesRegistryResult.registryPath,
    bindingsPath: bindingResult.bindingsPath,
    permissionsPath: permissionResult.path,
    credentialReferenceRegistryPath: credentialRegistryResult.credentialReferenceRegistryPath,
    resourceRegistry,
    bindingDefinitions,
    resolvedBindings: bindingResolution.resolvedBindings,
    permissionDefinitions,
    permissionEvaluation,
    usableBindings,
    secretResolution,
    warnings,
  };
}

async function readToolReadinessContext({
  masRootPath,
  operationalIdentityId,
}) {
  const accessContext = await buildOperationalIdentityAccessContext({
    masRootPath,
    operationalIdentityId,
  });
  const toolRegistry = await readToolDefinitions({
    masRootPath,
    includeInactive: true,
  });
  const toolReadinessEvaluation = evaluateToolReadinessForInvocation({
    toolDefinitions: toolRegistry.toolDefinitions,
    resolvedBindings: accessContext.resolvedBindings,
    permissionEvaluation: accessContext.permissionEvaluation,
    secretResolution: accessContext.secretResolution,
  });

  return {
    accessContext,
    toolRegistry,
    toolReadinessEvaluation,
    warnings: [
      ...accessContext.warnings,
      ...toolRegistry.warnings,
      ...toolReadinessEvaluation.warnings,
    ],
  };
}

export async function buildToolReadinessExplanation({
  masRootPath,
  operationalIdentityId,
  input = {},
}) {
  const normalizedInput = isPlainObject(input) ? input : {};
  const targetToolId = normalizeOptionalIdentifier(normalizedInput.toolId);
  const {
    toolRegistry,
    toolReadinessEvaluation,
    warnings,
  } = await readToolReadinessContext({
    masRootPath,
    operationalIdentityId,
  });
  const tools = filterByOptionalId(
    toolRegistry.toolDefinitions.map((toolDefinition) => {
      return summarizeToolDefinition(
        toolDefinition,
        findVerdict(toolReadinessEvaluation, toolDefinition.toolId),
      );
    }),
    'toolId',
    targetToolId,
  ).toSorted((left, right) => compareById(left, right, 'toolId'));

  if (targetToolId && tools.length === 0) {
    warnings.push(`Tool readiness inspector could not find tool: ${targetToolId}`);
  }

  return {
    kind: 'admin_tool_readiness_explanation',
    version: 1,
    operationalIdentityId,
    scope: {
      targetToolId,
      includeInactive: true,
    },
    summary: summarizeReadinessCounts(tools),
    tools,
    semantics: [
      'ready means the current Operational Identity passed lifecycle, binding, permission, resource, and secret gates for this invocation context',
      'approval_required means the tool is known and reachable but must pause for human approval before execution',
      'denied means a binding, permission, or ownership gate blocks the tool',
      'unavailable means lifecycle or credential secret-value readiness prevents execution',
    ],
    warnings,
  };
}

function findToolDefinition(toolDefinitions, toolId) {
  return toolDefinitions.find((toolDefinition) => toolDefinition.toolId === toolId) ?? null;
}

function resolveWorkflowStepReadiness({
  workflowRuntimeDefinition,
  toolDefinitions,
  toolReadinessEvaluation,
}) {
  return workflowRuntimeDefinition.steps.map((step) => {
    if (step.stepType !== 'tool_call') {
      return {
        stepId: step.stepId,
        stepType: step.stepType,
        toolId: step.toolId,
        status: 'not_evaluated',
        sideEffectLevel: null,
        approvalRequired: false,
        reason: `Workflow step type ${step.stepType} is not evaluated by the v1 readiness explainer.`,
        onFailure: step.onFailure,
      };
    }

    const toolDefinition = findToolDefinition(toolDefinitions, step.toolId);
    const verdict = findVerdict(toolReadinessEvaluation, step.toolId);

    if (!toolDefinition || !verdict) {
      return {
        stepId: step.stepId,
        stepType: step.stepType,
        toolId: step.toolId,
        status: 'unavailable',
        sideEffectLevel: null,
        approvalRequired: false,
        reason: `Workflow step references tool ${step.toolId}, but that tool is not available in the tool registry.`,
        onFailure: step.onFailure,
      };
    }

    return {
      stepId: step.stepId,
      stepType: step.stepType,
      toolId: step.toolId,
      status: verdict.status,
      sideEffectLevel: toolDefinition.sideEffectLevel,
      approvalRequired: verdict.approvalRequired,
      reason: verdict.reason,
      onFailure: step.onFailure,
    };
  });
}

function resolveWorkflowStatus({
  workflowRuntimeDefinition,
  stepReadiness,
}) {
  if (workflowRuntimeDefinition.lifecycleState !== 'active') {
    return {
      status: 'unavailable',
      approvalRequired: false,
      reason: `Workflow ${workflowRuntimeDefinition.workflowId} lifecycle state is not active: ${workflowRuntimeDefinition.lifecycleState}.`,
    };
  }

  const evaluatedStatuses = stepReadiness.map((step) => step.status);

  if (evaluatedStatuses.includes('denied')) {
    return {
      status: 'denied',
      approvalRequired: false,
      reason: `Workflow ${workflowRuntimeDefinition.workflowId} is denied because at least one required step is denied.`,
    };
  }

  if (evaluatedStatuses.includes('unavailable')) {
    return {
      status: 'unavailable',
      approvalRequired: false,
      reason: `Workflow ${workflowRuntimeDefinition.workflowId} is unavailable because at least one required step is unavailable.`,
    };
  }

  if (evaluatedStatuses.includes('approval_required')) {
    return {
      status: 'approval_required',
      approvalRequired: true,
      reason: `Workflow ${workflowRuntimeDefinition.workflowId} can be requested, but at least one step requires human approval.`,
    };
  }

  if (evaluatedStatuses.includes('not_evaluated')) {
    return {
      status: 'not_evaluated',
      approvalRequired: false,
      reason: `Workflow ${workflowRuntimeDefinition.workflowId} contains step types that the v1 readiness explainer does not evaluate.`,
    };
  }

  return {
    status: 'ready',
    approvalRequired: false,
    reason: `Workflow ${workflowRuntimeDefinition.workflowId} passed v1 readiness checks for the current Operational Identity.`,
  };
}

function summarizeWorkflowDefinition({
  workflowRuntimeDefinition,
  toolDefinitions,
  toolReadinessEvaluation,
}) {
  const stepReadiness = resolveWorkflowStepReadiness({
    workflowRuntimeDefinition,
    toolDefinitions,
    toolReadinessEvaluation,
  });
  const readiness = resolveWorkflowStatus({
    workflowRuntimeDefinition,
    stepReadiness,
  });

  return {
    workflowId: workflowRuntimeDefinition.workflowId,
    lifecycleState: workflowRuntimeDefinition.lifecycleState,
    executionMode: workflowRuntimeDefinition.executionMode,
    sourcePath: workflowRuntimeDefinition.sourcePath ?? null,
    stepCount: workflowRuntimeDefinition.steps.length,
    toolCallStepCount: workflowRuntimeDefinition.steps.filter((step) => step.stepType === 'tool_call').length,
    statePolicy: workflowRuntimeDefinition.statePolicy,
    approvalPolicy: workflowRuntimeDefinition.approvalPolicy,
    artifactPolicy: workflowRuntimeDefinition.artifactPolicy,
    memoryPolicy: workflowRuntimeDefinition.memoryPolicy,
    intentMetadata: summarizeIntentMetadata(workflowRuntimeDefinition.intentMetadata),
    readiness,
    stepReadiness,
  };
}

export async function buildWorkflowReadinessExplanation({
  masRootPath,
  operationalIdentityId,
  input = {},
}) {
  const normalizedInput = isPlainObject(input) ? input : {};
  const targetWorkflowId = normalizeOptionalIdentifier(normalizedInput.workflowId);
  const {
    toolRegistry,
    toolReadinessEvaluation,
    warnings,
  } = await readToolReadinessContext({
    masRootPath,
    operationalIdentityId,
  });
  const workflowRegistry = await readWorkflowRuntimeDefinitions({
    masRootPath,
    includeInactive: true,
  });

  warnings.push(...workflowRegistry.warnings);

  const workflows = filterByOptionalId(
    workflowRegistry.workflowRuntimeDefinitions.map((workflowRuntimeDefinition) => {
      return summarizeWorkflowDefinition({
        workflowRuntimeDefinition,
        toolDefinitions: toolRegistry.toolDefinitions,
        toolReadinessEvaluation,
      });
    }),
    'workflowId',
    targetWorkflowId,
  ).toSorted((left, right) => compareById(left, right, 'workflowId'));

  if (targetWorkflowId && workflows.length === 0) {
    warnings.push(`Workflow readiness inspector could not find workflow: ${targetWorkflowId}`);
  }

  return {
    kind: 'admin_workflow_readiness_explanation',
    version: 1,
    operationalIdentityId,
    scope: {
      targetWorkflowId,
      includeInactive: true,
    },
    summary: summarizeReadinessCounts(workflows),
    workflows,
    semantics: [
      'workflow readiness is derived from workflow lifecycle plus the readiness of referenced tool-call steps',
      'active workflow runtime means an active workflow definition, not a workflow currently running',
      'actual workflow execution still passes through runtime gates and may pause for approval',
    ],
    warnings,
  };
}

function findPermissionDecision(permissionEvaluation, binding) {
  return permissionEvaluation.evaluatedBindings.find((decision) => {
    return decision.resourceId === binding.resourceId && decision.accessMode === binding.accessMode;
  }) ?? null;
}

function findSecretResolution(secretResolution, credentialReferenceId) {
  if (!credentialReferenceId) {
    return null;
  }

  return secretResolution.resolvedCredentialReferences.find((entry) => {
    return entry.credentialReferenceId === credentialReferenceId;
  }) ?? null;
}

function resolvePermissionRecordStatus({
  permissionDecision,
  secretResolutionEntry,
}) {
  if (permissionDecision?.effect === 'deny') {
    return 'denied';
  }

  if (secretResolutionEntry && secretResolutionEntry.resolutionStatus !== 'resolved') {
    return 'unavailable';
  }

  if (permissionDecision?.effect === 'allow') {
    return 'allowed';
  }

  return 'not_evaluated';
}

function summarizePermissionRecords({
  resolvedBindings,
  permissionEvaluation,
  secretResolution,
}) {
  return resolvedBindings.map((binding) => {
    const permissionDecision = findPermissionDecision(permissionEvaluation, binding);
    const secretResolutionEntry = findSecretResolution(secretResolution, binding.credentialReferenceId);
    const status = resolvePermissionRecordStatus({
      permissionDecision,
      secretResolutionEntry,
    });

    return {
      resourceId: binding.resourceId,
      resourceDisplayName: binding.resourceDisplayName,
      resourceType: binding.resourceType,
      accessMode: binding.accessMode,
      ownershipScope: binding.ownershipScope,
      bindingState: binding.bindingState,
      resourceLifecycleState: binding.resourceLifecycleState,
      credentialReferenceId: binding.credentialReferenceId,
      secretResolutionStatus: secretResolutionEntry?.resolutionStatus ?? (binding.credentialReferenceId ? 'not_evaluated' : null),
      status,
      permissionEffect: permissionDecision?.effect ?? 'not_evaluated',
      matchedRuleId: permissionDecision?.matchedRuleId ?? null,
      reason: permissionDecision?.reason ?? 'No permission decision was evaluated for this binding.',
    };
  }).toSorted((left, right) => {
    const resourceComparison = left.resourceId.localeCompare(right.resourceId);

    return resourceComparison === 0
      ? left.accessMode.localeCompare(right.accessMode)
      : resourceComparison;
  });
}

function summarizePermissionCounts(permissionRecords) {
  return permissionRecords.reduce((summary, record) => {
    summary.total++;
    summary[record.status] = (summary[record.status] ?? 0) + 1;
    return summary;
  }, {
    total: 0,
    allowed: 0,
    denied: 0,
    unavailable: 0,
    not_evaluated: 0,
  });
}

export async function buildPermissionReadinessExplanation({
  masRootPath,
  operationalIdentityId,
  input = {},
}) {
  const normalizedInput = isPlainObject(input) ? input : {};
  const targetResourceId = normalizeOptionalIdentifier(normalizedInput.resourceId);
  const targetAccessMode = normalizeOptionalIdentifier(normalizedInput.accessMode);
  const accessContext = await buildOperationalIdentityAccessContext({
    masRootPath,
    operationalIdentityId,
  });
  let permissions = summarizePermissionRecords({
    resolvedBindings: accessContext.resolvedBindings,
    permissionEvaluation: accessContext.permissionEvaluation,
    secretResolution: accessContext.secretResolution,
  });

  if (targetResourceId) {
    permissions = permissions.filter((record) => record.resourceId === targetResourceId);
  }

  if (targetAccessMode) {
    permissions = permissions.filter((record) => record.accessMode === targetAccessMode);
  }

  if ((targetResourceId || targetAccessMode) && permissions.length === 0) {
    accessContext.warnings.push('Permission inspector did not find a binding matching the requested filter.');
  }

  return {
    kind: 'admin_permission_readiness_explanation',
    version: 1,
    operationalIdentityId,
    scope: {
      targetResourceId,
      targetAccessMode,
      currentOperationalIdentityOnly: true,
    },
    summary: summarizePermissionCounts(permissions),
    permissionEvaluationSummary: accessContext.permissionEvaluation.summary,
    permissions,
    secretResolution: withoutSecretValues(accessContext.secretResolution),
    semantics: [
      'allowed means the binding, resource lifecycle, and permission rule passed the permission evaluator',
      'denied means an explicit runtime gate blocked access',
      'unavailable means permission passed but a required secret is not resolved',
      'secret values are never included in this explanation',
    ],
    sourcePaths: {
      bindings: accessContext.bindingsPath,
      permissions: accessContext.permissionsPath,
      resources: accessContext.resourcesRegistryPath,
      credentialReferences: accessContext.credentialReferenceRegistryPath,
    },
    warnings: accessContext.warnings,
  };
}

export function sortReadinessStatus(left, right) {
  return (READINESS_ORDER[left] ?? READINESS_ORDER.not_evaluated)
    - (READINESS_ORDER[right] ?? READINESS_ORDER.not_evaluated);
}
