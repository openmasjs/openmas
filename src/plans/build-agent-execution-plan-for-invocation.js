import { assertAgentExecutionPlan } from '../contracts/identity/agent-execution-plan-contract.js';
import { resolveActionRuntimeLocale } from '../localization/action-runtime-localization.js';

const CLARIFICATION_ACTION_STATUSES = new Set([
  'needs_clarification',
  'ambiguous',
]);

const PLANNABLE_ACTION_STATUSES = new Set([
  'plan_only',
  'accepted',
  'approval_required',
]);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeSafeIdentifier(value, fallbackValue) {
  const normalizedValue = isNonEmptyString(value)
    ? value.trim().replace(/[^a-zA-Z0-9._-]+/gu, '-').replace(/^-+|-+$/gu, '')
    : '';

  return normalizedValue.length > 0 ? normalizedValue : fallbackValue;
}

function mapSideEffectLevelToRiskLevel(sideEffectLevel) {
  if (sideEffectLevel === 'read_only') {
    return 'low';
  }

  if (sideEffectLevel === 'write_internal') {
    return 'medium';
  }

  if ([
    'write_external',
    'publish_external',
    'financial',
    'destructive',
  ].includes(sideEffectLevel)) {
    return 'high';
  }

  return 'medium';
}

function derivePlannerSource({ semanticIntentRuntime, actionResolution }) {
  if (semanticIntentRuntime?.status === 'completed' || semanticIntentRuntime?.status === 'resolved') {
    return 'semantic_intent_runtime';
  }

  return actionResolution?.source ?? 'runtime';
}

function extractUnderstanding({ semanticIntentRuntime, actionResolution }) {
  if (isPlainObject(semanticIntentRuntime?.semanticIntentClassification?.actionIntent?.understanding)) {
    return semanticIntentRuntime.semanticIntentClassification.actionIntent.understanding;
  }

  if (isPlainObject(actionResolution?.actionIntent?.understanding)) {
    return actionResolution.actionIntent.understanding;
  }

  return null;
}

function deriveGoal({
  request,
  actionResolution,
  semanticIntentRuntime,
  selectedCandidate = null,
  clarification = false,
}) {
  const understanding = extractUnderstanding({
    semanticIntentRuntime,
    actionResolution,
  });

  if (isNonEmptyString(understanding?.requestedOutcome)) {
    return understanding.requestedOutcome.trim();
  }

  if (isNonEmptyString(understanding?.summary)) {
    return understanding.summary.trim();
  }

  if (clarification) {
    return 'Clarify the requested action before execution.';
  }

  if (selectedCandidate) {
    return `Safely execute ${selectedCandidate.targetType} ${selectedCandidate.targetId} for the current request.`;
  }

  if (isNonEmptyString(actionResolution?.reason)) {
    return actionResolution.reason.trim();
  }

  if (isNonEmptyString(request?.inputText)) {
    return request.inputText.trim();
  }

  return `Plan the next safe step for command ${request?.command ?? 'ask'}.`;
}

function deriveAssumptions({
  request,
  actionResolution,
  selectedCandidate = null,
  approvalRequired = false,
  previewOnly = false,
}) {
  const assumptions = [
    'The runtime remains the sole authority for capability execution.',
    'This plan may guide execution, but it cannot directly execute any step.',
  ];

  if (previewOnly) {
    assumptions.push('This invocation previews the governed execution plan and will not execute runtime capabilities yet.');
  }

  if (request?.conversationId) {
    assumptions.push('Conversation context is available as bounded supporting context.');
  }

  if (selectedCandidate) {
    assumptions.push(
      `The selected ${selectedCandidate.targetType} candidate ${selectedCandidate.targetId} remains the best available target for this request.`,
    );
  }

  if (approvalRequired) {
    assumptions.push('Execution must pause until a human approval decision is recorded.');
  }

  if (isNonEmptyString(actionResolution?.reason)) {
    assumptions.push(actionResolution.reason.trim());
  }

  return [...new Set(assumptions)];
}

function buildMemoryRequirements({ request, selectedCandidate = null }) {
  const memoryRequirements = [
    {
      kind: 'agent_execution_plan_memory_requirement',
      version: 1,
      requirementId: 'memory-runtime-state-001',
      sourceType: 'runtime_state',
      sourceId: selectedCandidate
        ? `${selectedCandidate.targetType}:${selectedCandidate.targetId}`
        : 'invocation-runtime-state',
      scope: 'mas_instance',
      requirementLevel: 'required',
      reason: 'The plan needs current MAS runtime state and readiness evidence before action execution.',
      metadata: {
        referenceTargetType: selectedCandidate?.targetType ?? null,
        referenceTargetId: selectedCandidate?.targetId ?? null,
      },
    },
  ];

  if (request?.conversationId) {
    memoryRequirements.push({
      kind: 'agent_execution_plan_memory_requirement',
      version: 1,
      requirementId: 'memory-conversation-context-001',
      sourceType: 'conversation_context',
      sourceId: request.conversationId,
      scope: 'conversation',
      requirementLevel: 'preferred',
      reason: 'Recent conversation context may help the agent preserve continuity while following the plan.',
      metadata: {
        conversationId: request.conversationId,
      },
    });
  }

  return memoryRequirements;
}

function derivePlanLocale({
  request,
  actionResolution,
  semanticIntentRuntime,
}) {
  return resolveActionRuntimeLocale({
    request,
    metadata: actionResolution?.clarificationRequest?.metadata
      ?? actionResolution?.actionIntent?.clarificationRequest?.metadata
      ?? semanticIntentRuntime?.semanticIntentClassification?.actionIntent?.clarificationRequest?.metadata
      ?? actionResolution?.metadata
      ?? null,
  });
}

function buildClarificationPlan({ invocationId, request, actionResolution, semanticIntentRuntime }) {
  const clarificationRequest = actionResolution?.clarificationRequest ?? null;
  const locale = derivePlanLocale({
    request,
    actionResolution,
    semanticIntentRuntime,
  });

  if (!clarificationRequest) {
    return null;
  }

  return {
    kind: 'agent_execution_plan',
    version: 1,
    planId: `plan-${invocationId}`,
    goal: deriveGoal({
      request,
      actionResolution,
      semanticIntentRuntime,
      clarification: true,
    }),
    assumptions: deriveAssumptions({
      request,
      actionResolution,
      approvalRequired: false,
    }),
    steps: [
      {
        kind: 'agent_execution_plan_step',
        version: 1,
        stepId: 'analyze-request',
        title: 'Analyze the request',
        description: 'Review the current request and the missing context that prevents safe execution.',
        stepType: 'analysis',
        targetType: null,
        targetId: null,
        dependsOnStepIds: [],
        completionCriteria: [
          'The runtime identifies the missing context that blocks safe execution.',
        ],
        reason: 'Clarification is required before the runtime can proceed safely.',
      },
      {
        kind: 'agent_execution_plan_step',
        version: 1,
        stepId: 'request-clarification',
        title: 'Request clarification',
        description: 'Ask the human for the missing context needed to safely continue.',
        stepType: 'clarification',
        targetType: null,
        targetId: null,
        dependsOnStepIds: [
          'analyze-request',
        ],
        completionCriteria: [
          'One auditable clarification request is prepared for the missing context.',
        ],
        reason: 'The runtime needs more information before it can choose or execute a governed capability.',
      },
      {
        kind: 'agent_execution_plan_step',
        version: 1,
        stepId: 'summarize-next-step',
        title: 'Summarize the next step',
        description: 'Explain to the human what clarification is needed and why execution is paused.',
        stepType: 'summarize',
        targetType: null,
        targetId: null,
        dependsOnStepIds: [
          'request-clarification',
        ],
        completionCriteria: [
          'The final answer explains that clarification is required before execution.',
        ],
        reason: 'The human should understand what needs to happen next.',
      },
    ],
    requiredTools: [],
    requiredWorkflows: [],
    requiredMemory: buildMemoryRequirements({
      request,
      selectedCandidate: null,
    }),
    requiredApprovals: [],
    riskAssessment: {
      kind: 'agent_execution_plan_risk_assessment',
      version: 1,
      overallRiskLevel: 'low',
      summary: 'The plan remains non-executing and only prepares a clarification request.',
      riskItems: [
        'Proceeding without clarification could cause the runtime to choose the wrong action path.',
      ],
      metadata: {
        locale,
        localizationMode: 'runtime_localized',
        plannerSource: derivePlannerSource({
          semanticIntentRuntime,
          actionResolution,
        }),
      },
    },
    verificationCriteria: [
      {
        kind: 'agent_execution_plan_verification_criterion',
        version: 1,
        criterionId: 'verify-clarification-request',
        description: 'The plan emits one clarification request that is auditable and tied to missing context.',
        evidenceTypes: [
          'brain_output',
        ],
        targetType: null,
        targetId: null,
      },
    ],
    clarificationRequest,
    directExecutionAllowed: false,
    metadata: {
      locale,
      localizationMode: 'runtime_localized',
      plannerSource: derivePlannerSource({
        semanticIntentRuntime,
        actionResolution,
      }),
      actionResolutionStatus: actionResolution?.status ?? null,
      requestCommand: request?.command ?? null,
    },
  };
}

function buildExecutionPlan({
  invocationId,
  request,
  actionResolution,
  semanticIntentRuntime,
  approvalRequired = false,
  previewOnly = false,
}) {
  const selectedCandidate = actionResolution?.selectedCandidate ?? null;

  if (!selectedCandidate || !['tool', 'workflow'].includes(selectedCandidate.targetType)) {
    return null;
  }

  const approvalStepId = approvalRequired ? 'request-approval' : null;
  const executionStepId = selectedCandidate.targetType === 'tool'
    ? 'execute-tool'
    : 'execute-workflow';
  const verificationEvidenceType = selectedCandidate.targetType === 'tool'
    ? 'tool_observation'
    : 'workflow_observation';
  const runtimeArtifactId = `${selectedCandidate.targetType}:${selectedCandidate.targetId}`;
  const plannerSource = derivePlannerSource({
    semanticIntentRuntime,
    actionResolution,
  });
  const locale = derivePlanLocale({
    request,
    actionResolution,
    semanticIntentRuntime,
  });

  return {
    kind: 'agent_execution_plan',
    version: 1,
    planId: `plan-${invocationId}`,
    goal: deriveGoal({
      request,
      actionResolution,
      semanticIntentRuntime,
      selectedCandidate,
    }),
    assumptions: deriveAssumptions({
      request,
      actionResolution,
      selectedCandidate,
      approvalRequired,
      previewOnly,
    }),
    steps: [
      {
        kind: 'agent_execution_plan_step',
        version: 1,
        stepId: 'analyze-request',
        title: 'Analyze the request',
        description: 'Review the current request, selected target, and runtime readiness before execution.',
        stepType: 'analysis',
        targetType: null,
        targetId: null,
        dependsOnStepIds: [],
        completionCriteria: [
          'The selected capability and its readiness status are understood before execution.',
        ],
        reason: 'The planner should preserve why this target is the current safest action candidate.',
      },
      ...(approvalRequired
        ? [{
            kind: 'agent_execution_plan_step',
            version: 1,
            stepId: approvalStepId,
            title: 'Request human approval',
            description: 'Pause the plan and request a human approval decision before execution continues.',
            stepType: 'request_approval',
            targetType: 'approval',
            targetId: `human-approval.${selectedCandidate.targetType}.${normalizeSafeIdentifier(selectedCandidate.targetId, 'target')}`,
            dependsOnStepIds: [
              'analyze-request',
            ],
            completionCriteria: [
              'A human approval decision is recorded before the execution step begins.',
            ],
            reason: 'Runtime policy requires explicit approval before this action can execute.',
          }]
        : []),
      {
        kind: 'agent_execution_plan_step',
        version: 1,
        stepId: executionStepId,
        title: selectedCandidate.targetType === 'tool'
          ? 'Execute the selected tool'
          : 'Execute the selected workflow',
        description: selectedCandidate.targetType === 'tool'
          ? previewOnly
            ? `When approved to proceed, run tool ${selectedCandidate.targetId} through the governed runtime.`
            : `Run tool ${selectedCandidate.targetId} through the governed runtime.`
          : previewOnly
            ? `When approved to proceed, run workflow ${selectedCandidate.targetId} through the governed runtime.`
            : `Run workflow ${selectedCandidate.targetId} through the governed runtime.`,
        stepType: selectedCandidate.targetType === 'tool'
          ? 'tool_execution'
          : 'workflow_execution',
        targetType: selectedCandidate.targetType,
        targetId: selectedCandidate.targetId,
        dependsOnStepIds: approvalRequired
          ? [
              approvalStepId,
            ]
          : [
              'analyze-request',
            ],
        completionCriteria: [
          selectedCandidate.targetType === 'tool'
            ? previewOnly
              ? `The plan clearly identifies how the runtime would accept and execute tool ${selectedCandidate.targetId} when execution is requested.`
              : `The runtime accepts and executes tool ${selectedCandidate.targetId}.`
            : previewOnly
              ? `The plan clearly identifies how the runtime would accept and execute workflow ${selectedCandidate.targetId} when execution is requested.`
              : `The runtime accepts and executes workflow ${selectedCandidate.targetId}.`,
        ],
        reason: actionResolution?.reason ?? selectedCandidate.reason,
      },
      {
        kind: 'agent_execution_plan_step',
        version: 1,
        stepId: 'verify-result',
        title: 'Verify runtime evidence',
        description: 'Review the runtime observation evidence before claiming the work is complete.',
        stepType: 'verification',
        targetType: selectedCandidate.targetType,
        targetId: selectedCandidate.targetId,
        dependsOnStepIds: [
          executionStepId,
        ],
        completionCriteria: [
          'Runtime observation evidence confirms the executed action outcome.',
        ],
        reason: 'The agent must verify tool/workflow evidence before summarizing the result.',
      },
      {
        kind: 'agent_execution_plan_step',
        version: 1,
        stepId: 'summarize-result',
        title: 'Summarize the outcome',
        description: 'Explain the executed result with evidence-bounded wording for the human administrator.',
        stepType: 'summarize',
        targetType: null,
        targetId: null,
        dependsOnStepIds: [
          'verify-result',
        ],
        completionCriteria: [
          'The final answer stays within the verified runtime evidence.',
        ],
        reason: 'The human should receive a concise summary that stays grounded in runtime observations.',
      },
    ],
    requiredTools: selectedCandidate.targetType === 'tool'
      ? [selectedCandidate.targetId]
      : [],
    requiredWorkflows: selectedCandidate.targetType === 'workflow'
      ? [selectedCandidate.targetId]
      : [],
    requiredMemory: buildMemoryRequirements({
      request,
      selectedCandidate,
    }),
    requiredApprovals: approvalRequired
      ? [{
          kind: 'agent_execution_plan_approval_requirement',
          version: 1,
          approvalRequirementId: 'approval-requirement-001',
          approvalType: 'human_approval',
          targetType: selectedCandidate.targetType,
          targetId: selectedCandidate.targetId,
          reason: 'Execution must wait for an explicit human approval decision.',
          metadata: {
            plannerSource,
          },
        }]
      : [],
    riskAssessment: {
      kind: 'agent_execution_plan_risk_assessment',
      version: 1,
      overallRiskLevel: mapSideEffectLevelToRiskLevel(selectedCandidate.sideEffectLevel),
      summary: approvalRequired
        ? previewOnly
          ? 'The plan previews a governed execution path that would later pause behind an approval gate.'
          : 'The plan is governed and paused behind an approval gate before execution.'
        : previewOnly
          ? 'The plan remains governed and previews one safe execution path without executing it during this invocation.'
          : 'The plan remains governed and executes only through known runtime affordances.',
      riskItems: approvalRequired
        ? [
            'Execution must not begin until human approval is recorded.',
          ]
        : previewOnly
          ? [
              'Future execution must still pass runtime readiness and observation verification before completion can be claimed.',
            ]
        : [
            'The runtime must confirm readiness and observation evidence before claiming completion.',
          ],
      metadata: {
        locale,
        localizationMode: 'runtime_localized',
        plannerSource,
        targetType: selectedCandidate.targetType,
        targetId: selectedCandidate.targetId,
      },
    },
    verificationCriteria: [
      {
        kind: 'agent_execution_plan_verification_criterion',
        version: 1,
        criterionId: 'verify-runtime-observation',
        description: selectedCandidate.targetType === 'tool'
          ? `The runtime captures a tool observation for ${selectedCandidate.targetId}.`
          : `The runtime captures a workflow observation for ${selectedCandidate.targetId}.`,
        evidenceTypes: approvalRequired
          ? [
              verificationEvidenceType,
              'approval_state',
            ]
          : [
              verificationEvidenceType,
            ],
        targetType: selectedCandidate.targetType,
        targetId: selectedCandidate.targetId,
      },
    ],
    clarificationRequest: null,
    directExecutionAllowed: false,
    metadata: {
      locale,
      localizationMode: 'runtime_localized',
      plannerSource,
      actionResolutionStatus: actionResolution?.status ?? null,
      targetType: selectedCandidate.targetType,
      targetId: selectedCandidate.targetId,
      runtimeArtifactId,
      approvalRequired,
      planMode: previewOnly ? 'preview_only' : 'execution_ready',
    },
  };
}

export function buildAgentExecutionPlanForInvocation({
  invocationId,
  request,
  actionResolution = null,
  toolRequestResolution = null,
  workflowRequestResolution = null,
  semanticIntentRuntime = null,
  knownToolIds = [],
  knownWorkflowIds = [],
} = {}) {
  if (!isNonEmptyString(invocationId)) {
    throw new Error('Plan builder requires a non-empty invocationId.');
  }

  if (!isPlainObject(request)) {
    throw new Error('Plan builder requires the normalized request object.');
  }

  if (!isPlainObject(actionResolution)) {
    return null;
  }

  if (actionResolution.status === 'no_action') {
    return null;
  }

  if (CLARIFICATION_ACTION_STATUSES.has(actionResolution.status)) {
    return assertAgentExecutionPlan(
      buildClarificationPlan({
        invocationId,
        request,
        actionResolution,
        semanticIntentRuntime,
      }),
      {
        knownToolIds,
        knownWorkflowIds,
      },
    );
  }

  if (!PLANNABLE_ACTION_STATUSES.has(actionResolution.status)) {
    return null;
  }

  const selectedCandidate = actionResolution.selectedCandidate ?? null;

  if (!selectedCandidate || !['tool', 'workflow'].includes(selectedCandidate.targetType)) {
    return null;
  }

  const approvalRequired = actionResolution.status === 'approval_required'
    || actionResolution.metadata?.previewApprovalRequired === true
    || toolRequestResolution?.status === 'approval_required'
    || workflowRequestResolution?.status === 'approval_required'
    || actionResolution.approvalRequired === true;
  const previewOnly = actionResolution.status === 'plan_only'
    || actionResolution.metadata?.planMode === 'preview_only';

  return assertAgentExecutionPlan(
    buildExecutionPlan({
      invocationId,
      request,
      actionResolution,
      semanticIntentRuntime,
      approvalRequired,
      previewOnly,
    }),
    {
      knownToolIds,
      knownWorkflowIds,
    },
  );
}
