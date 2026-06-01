import { assertActionAffordances } from '../contracts/actions/action-affordance-contract.js';
import { assertToolReadinessVerdict } from '../contracts/tools/tool-readiness-contract.js';
import { readToolDefinitions } from '../tools/read-tool-definitions.js';
import { readWorkflowRuntimeDefinitions } from '../workflows/read-workflow-runtime-definitions.js';

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function assertOptionalBoolean(value, description, defaultValue) {
  if (value === undefined || value === null) {
    return defaultValue;
  }

  if (typeof value !== 'boolean') {
    throw new Error(`${description} must be a boolean when provided.`);
  }

  return value;
}

function findToolReadinessVerdict({
  toolId,
  toolReadinessEvaluation,
}) {
  if (!toolReadinessEvaluation) {
    return {
      verdict: null,
      warnings: [],
    };
  }

  if (!Array.isArray(toolReadinessEvaluation.evaluatedTools)) {
    return {
      verdict: null,
      warnings: ['Action affordance reader ignored malformed toolReadinessEvaluation.evaluatedTools.'],
    };
  }

  const matchingVerdicts = toolReadinessEvaluation.evaluatedTools.filter((verdict) => {
    return verdict?.toolId === toolId;
  });

  if (matchingVerdicts.length === 0) {
    return {
      verdict: null,
      warnings: [],
    };
  }

  if (matchingVerdicts.length > 1) {
    return {
      verdict: null,
      warnings: [`Action affordance reader ignored duplicated readiness verdicts for tool: ${toolId}`],
    };
  }

  try {
    return {
      verdict: assertToolReadinessVerdict(matchingVerdicts[0]),
      warnings: [],
    };
  } catch (error) {
    return {
      verdict: null,
      warnings: [`Action affordance reader ignored malformed readiness verdict for tool ${toolId}: ${error.message}`],
    };
  }
}

function buildReadinessSummaryFromToolVerdict({
  toolDefinition,
  toolReadinessEvaluation,
}) {
  const {
    verdict,
    warnings,
  } = findToolReadinessVerdict({
    toolId: toolDefinition.toolId,
    toolReadinessEvaluation,
  });

  if (!verdict) {
    return {
      readinessSummary: {
        kind: 'action_affordance_readiness_summary',
        version: 1,
        status: 'not_evaluated',
        source: 'none',
        approvalRequired: false,
        reason: 'No tool readiness verdict was available for this action affordance.',
        matchedBindingCount: 0,
        missingRequirementCount: 0,
        warnings,
      },
      warnings,
    };
  }

  return {
    readinessSummary: {
      kind: 'action_affordance_readiness_summary',
      version: 1,
      status: verdict.status,
      source: 'tool_readiness_evaluation',
      approvalRequired: verdict.approvalRequired,
      reason: verdict.reason,
      matchedBindingCount: verdict.matchedBindings.length,
      missingRequirementCount: verdict.missingRequirements.length,
      warnings: [
        ...verdict.warnings,
        ...warnings,
      ],
    },
    warnings,
  };
}

function buildWorkflowReadinessSummary(workflowRuntimeDefinition) {
  if (workflowRuntimeDefinition.lifecycleState !== 'active') {
    return {
      kind: 'action_affordance_readiness_summary',
      version: 1,
      status: 'unavailable',
      source: 'workflow_lifecycle',
      approvalRequired: false,
      reason: `Workflow lifecycle state is not active: ${workflowRuntimeDefinition.lifecycleState}.`,
      matchedBindingCount: 0,
      missingRequirementCount: 1,
      warnings: [],
    };
  }

  return {
    kind: 'action_affordance_readiness_summary',
    version: 1,
    status: 'not_evaluated',
    source: 'workflow_lifecycle',
    approvalRequired: false,
    reason: 'Workflow lifecycle is active; workflow runtime readiness has not been evaluated by this reader.',
    matchedBindingCount: 0,
    missingRequirementCount: 0,
    warnings: [],
  };
}

function buildToolActionAffordance({
  toolDefinition,
  toolReadinessEvaluation,
}) {
  const {
    readinessSummary,
    warnings,
  } = buildReadinessSummaryFromToolVerdict({
    toolDefinition,
    toolReadinessEvaluation,
  });

  return {
    kind: 'action_affordance',
    version: 1,
    affordanceId: `tool:${toolDefinition.toolId}`,
    sourceType: 'tool_definition',
    sourcePath: toolDefinition.sourcePath,
    targetActionType: 'tool_execution',
    targetType: 'tool',
    targetId: toolDefinition.toolId,
    displayName: toolDefinition.displayName,
    description: toolDefinition.description,
    owner: toolDefinition.owner,
    lifecycleState: toolDefinition.lifecycleState,
    sideEffectLevel: toolDefinition.sideEffectLevel,
    executionMode: null,
    intentMetadata: toolDefinition.intentMetadata,
    readinessSummary,
    warnings,
    metadata: {
      toolType: toolDefinition.toolType,
      requiredResourceTypes: toolDefinition.requiredResourceTypes,
      requiredAccessModes: toolDefinition.requiredAccessModes,
      requiredPermissionModes: toolDefinition.requiredPermissionModes,
    },
  };
}

function buildWorkflowActionAffordance(workflowRuntimeDefinition) {
  const sideEffectLevel = workflowRuntimeDefinition.intentMetadata?.expectedSideEffectLevel ?? null;

  return {
    kind: 'action_affordance',
    version: 1,
    affordanceId: `workflow:${workflowRuntimeDefinition.workflowId}`,
    sourceType: 'workflow_runtime_definition',
    sourcePath: workflowRuntimeDefinition.sourcePath,
    targetActionType: 'workflow_execution',
    targetType: 'workflow',
    targetId: workflowRuntimeDefinition.workflowId,
    displayName: workflowRuntimeDefinition.workflowId,
    description: null,
    owner: 'mas',
    lifecycleState: workflowRuntimeDefinition.lifecycleState,
    sideEffectLevel,
    executionMode: workflowRuntimeDefinition.executionMode,
    intentMetadata: workflowRuntimeDefinition.intentMetadata,
    readinessSummary: buildWorkflowReadinessSummary(workflowRuntimeDefinition),
    warnings: [],
    metadata: {
      stepCount: workflowRuntimeDefinition.steps.length,
      persistState: workflowRuntimeDefinition.statePolicy.persistState,
      resumeAllowed: workflowRuntimeDefinition.statePolicy.resumeAllowed,
      persistFinalReport: workflowRuntimeDefinition.artifactPolicy.persistFinalReport,
      allowWritebackCandidates: workflowRuntimeDefinition.memoryPolicy.allowWritebackCandidates,
    },
  };
}

export async function readActionAffordancesForInvocation({
  masRootPath,
  includeInactive = false,
  toolReadinessEvaluation = null,
} = {}) {
  if (!isNonEmptyString(masRootPath)) {
    throw new Error('Action affordance reader requires a non-empty masRootPath.');
  }

  const normalizedIncludeInactive = assertOptionalBoolean(
    includeInactive,
    'Action affordance reader includeInactive',
    false,
  );

  const [
    toolDefinitionResult,
    workflowRuntimeDefinitionResult,
  ] = await Promise.all([
    readToolDefinitions({
      masRootPath,
      includeInactive: normalizedIncludeInactive,
    }),
    readWorkflowRuntimeDefinitions({
      masRootPath,
      includeInactive: normalizedIncludeInactive,
    }),
  ]);

  const actionAffordances = [
    ...toolDefinitionResult.toolDefinitions.map((toolDefinition) => {
      return buildToolActionAffordance({
        toolDefinition,
        toolReadinessEvaluation,
      });
    }),
    ...workflowRuntimeDefinitionResult.workflowRuntimeDefinitions.map((workflowRuntimeDefinition) => {
      return buildWorkflowActionAffordance(workflowRuntimeDefinition);
    }),
  ];

  const normalizedActionAffordances = assertActionAffordances(actionAffordances)
    .toSorted((left, right) => left.affordanceId.localeCompare(right.affordanceId));

  return {
    kind: 'action_affordance_read_result',
    version: 1,
    actionAffordances: normalizedActionAffordances,
    summary: {
      total: normalizedActionAffordances.length,
      tools: normalizedActionAffordances.filter((affordance) => affordance.targetType === 'tool').length,
      workflows: normalizedActionAffordances.filter((affordance) => affordance.targetType === 'workflow').length,
      withIntentMetadata: normalizedActionAffordances.filter((affordance) => affordance.intentMetadata !== null).length,
      ready: normalizedActionAffordances.filter((affordance) => affordance.readinessSummary.status === 'ready').length,
      approvalRequired: normalizedActionAffordances.filter((affordance) => affordance.readinessSummary.status === 'approval_required').length,
      unavailable: normalizedActionAffordances.filter((affordance) => affordance.readinessSummary.status === 'unavailable').length,
      notEvaluated: normalizedActionAffordances.filter((affordance) => affordance.readinessSummary.status === 'not_evaluated').length,
    },
    warnings: [
      ...toolDefinitionResult.warnings,
      ...workflowRuntimeDefinitionResult.warnings,
      ...normalizedActionAffordances.flatMap((affordance) => affordance.warnings),
    ],
  };
}
