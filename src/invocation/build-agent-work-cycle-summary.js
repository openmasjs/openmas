import {
  AGENT_WORK_CYCLE_STAGE_IDS,
  AGENT_WORK_CYCLE_STAGE_STATUSES,
  assertAgentWorkCycleSummary,
} from '../contracts/identity/agent-work-cycle-contract.js';

const ANSWER_ONLY_ACTION_RESOLUTION_STATUSES = new Set([
  'no_action',
]);

const PLAN_ONLY_ACTION_RESOLUTION_STATUSES = new Set([
  'plan_only',
]);

const CLARIFICATION_ACTION_RESOLUTION_STATUSES = new Set([
  'needs_clarification',
  'ambiguous',
]);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function createStage(stageId, status, reason, metadata = null) {
  return {
    kind: 'agent_work_cycle_stage',
    version: 1,
    stageId,
    status,
    reason,
    ...(metadata && Object.keys(metadata).length > 0 ? { metadata } : {}),
  };
}

function hasRuntimeExecution({ brainToolExecution, brainWorkflowExecution }) {
  return brainToolExecution?.executionPerformed === true
    || brainWorkflowExecution?.executionPerformed === true;
}

function hasRuntimeObservation({ brainToolObservation, brainWorkflowObservation }) {
  return isPlainObject(brainToolObservation) || isPlainObject(brainWorkflowObservation);
}

function hasDeterministicExecution({ invocationMode, executionType, executionStatus }) {
  return invocationMode === 'deterministic'
    && executionType === 'deterministic_command'
    && executionStatus === 'completed';
}

function hasProbabilisticRequestUnderstanding({
  semanticIntentRuntime,
  actionResolution,
  invocationMode,
}) {
  if (invocationMode === 'deterministic') {
    return false;
  }

  if (semanticIntentRuntime?.status === 'resolved' || semanticIntentRuntime?.status === 'completed') {
    return true;
  }

  return actionResolution?.source === 'explicit_envelope'
    || actionResolution?.source === 'semantic_classifier'
    || actionResolution?.source === 'human_approval_resume';
}

function buildReceiveRequestStage({ request }) {
  return createStage(
    'receive_request',
    'completed',
    `Invocation request was received for command "${request.command}" in ${request.invocationMode} mode.`,
    {
      command: request.command,
      invocationMode: request.invocationMode,
    },
  );
}

function buildUnderstandStage({
  request,
  executionStatus,
  executionType,
  readiness,
  semanticIntentRuntime,
  actionResolution,
}) {
  if (executionType === 'conversation_creation') {
    return createStage(
      'understand',
      'completed',
      'The runtime understood the request as a conversation-creation action from explicit invocation arguments.',
    );
  }

  if (executionStatus === 'blocked' && !readiness) {
    return createStage(
      'understand',
      'skipped',
      'Request understanding did not begin because the invocation was blocked before runtime preparation completed.',
    );
  }

  if (request.invocationMode === 'deterministic') {
    return createStage(
      'understand',
      'completed',
      'The request was understood through an explicit deterministic command path.',
    );
  }

  if (CLARIFICATION_ACTION_RESOLUTION_STATUSES.has(actionResolution?.status)) {
    return createStage(
      'understand',
      'blocked',
      actionResolution.reason ?? 'The request understanding stage ended in clarification because the runtime could not safely determine the intended action.',
      {
        semanticStatus: semanticIntentRuntime?.status ?? null,
      },
    );
  }

  if (semanticIntentRuntime?.status === 'blocked') {
    return createStage(
      'understand',
      'blocked',
      semanticIntentRuntime.reason ?? 'The semantic intent runtime blocked request understanding.',
    );
  }

  if (
    ANSWER_ONLY_ACTION_RESOLUTION_STATUSES.has(actionResolution?.status)
    && semanticIntentRuntime?.status
    && semanticIntentRuntime.status !== 'resolved'
    && semanticIntentRuntime.status !== 'completed'
  ) {
    return createStage(
      'understand',
      'degraded',
      actionResolution.reason ?? 'Semantic understanding degraded safely and the invocation continued as answer-only.',
      {
        semanticStatus: semanticIntentRuntime.status,
      },
    );
  }

  if (hasProbabilisticRequestUnderstanding({
    semanticIntentRuntime,
    actionResolution,
    invocationMode: request.invocationMode,
  })) {
    return createStage(
      'understand',
      'completed',
      'The runtime established a usable understanding of the request before deciding how to proceed.',
      {
        semanticStatus: semanticIntentRuntime?.status ?? null,
        actionSource: actionResolution?.source ?? null,
      },
    );
  }

  if (executionStatus === 'failed') {
    return createStage(
      'understand',
      'failed',
      'The invocation failed before the runtime could complete request understanding.',
    );
  }

  return createStage(
    'understand',
    'skipped',
    'No dedicated request-understanding stage was required for this invocation path.',
  );
}

function buildDecideStage({ actionResolution, executionStatus, executionType }) {
  if (executionType === 'conversation_creation') {
    return createStage(
      'decide',
      'completed',
      'The runtime decided to create the requested conversation session and stop without further agent execution.',
    );
  }

  if (actionResolution) {
    return createStage(
      'decide',
      'completed',
      actionResolution.reason ?? `The runtime produced an action decision with status "${actionResolution.status}".`,
      {
        actionResolutionStatus: actionResolution.status,
        actionSource: actionResolution.source ?? null,
        runtimeAction: actionResolution.runtimeAction ?? null,
      },
    );
  }

  if (executionStatus === 'failed') {
    return createStage(
      'decide',
      'failed',
      'The invocation failed before the runtime could complete the action decision stage.',
    );
  }

  return createStage(
    'decide',
    'skipped',
    'No action decision was produced for this invocation.',
  );
}

function buildPlanStage({
  executionType,
  executionStatus,
  actionResolution,
  executionPlan,
}) {
  if (executionType === 'conversation_creation') {
    return createStage(
      'plan',
      'skipped',
      'No execution plan was required because the invocation only created a conversation session.',
      {
        plannerEnabled: true,
      },
    );
  }

  if (executionType === 'deterministic_command') {
    return createStage(
      'plan',
      'skipped',
      'The deterministic command path did not require a probabilistic execution plan.',
      {
        plannerEnabled: true,
      },
    );
  }

  if (executionPlan) {
    return createStage(
      'plan',
      'completed',
      executionPlan.clarificationRequest
        ? 'The runtime built a validated clarification plan before execution could continue.'
        : executionPlan.metadata?.planMode === 'preview_only'
          ? 'The runtime built a validated preview plan before any governed capability execution could begin.'
          : 'The runtime built a validated execution plan before governed capability execution.',
      {
        plannerEnabled: true,
        planId: executionPlan.planId,
        stepCount: executionPlan.steps.length,
        requiredToolCount: executionPlan.requiredTools.length,
        requiredWorkflowCount: executionPlan.requiredWorkflows.length,
        requiredApprovalCount: executionPlan.requiredApprovals.length,
      },
    );
  }

  if (ANSWER_ONLY_ACTION_RESOLUTION_STATUSES.has(actionResolution?.status)) {
    return createStage(
      'plan',
      'skipped',
      'No execution plan was required because the invocation remained answer-only.',
      {
        plannerEnabled: true,
      },
    );
  }

  if (PLAN_ONLY_ACTION_RESOLUTION_STATUSES.has(actionResolution?.status)) {
    return createStage(
      'plan',
      'failed',
      'The runtime identified a preview-only planning request, but no validated plan was produced.',
      {
        plannerEnabled: true,
      },
    );
  }

  if (CLARIFICATION_ACTION_RESOLUTION_STATUSES.has(actionResolution?.status)) {
    return createStage(
      'plan',
      'blocked',
      'Planning stopped because the runtime requires clarification before a safe plan can continue.',
      {
        plannerEnabled: true,
      },
    );
  }

  if (actionResolution?.status === 'accepted' || actionResolution?.status === 'approval_required') {
    return createStage(
      'plan',
      'failed',
      'The runtime identified an actionable request, but no validated execution plan was produced.',
      {
        plannerEnabled: true,
      },
    );
  }

  if (executionStatus === 'failed') {
    return createStage(
      'plan',
      'failed',
      'The invocation failed before the planner could produce a usable execution plan.',
      {
        plannerEnabled: true,
      },
    );
  }

  return createStage(
    'plan',
    'skipped',
    'No execution plan was required for this invocation path.',
    {
      plannerEnabled: true,
    },
  );
}

function buildSelectCapabilitiesStage({ actionResolution, executionType }) {
  if (executionType === 'conversation_creation') {
    return createStage(
      'select_capabilities',
      'skipped',
      'No capability selection was required because the invocation only created a conversation session.',
    );
  }

  if (!actionResolution) {
    return createStage(
      'select_capabilities',
      'skipped',
      'No capability selection was available because the runtime did not produce an action decision.',
    );
  }

  if (actionResolution.selectedCandidate) {
    const selectedCandidate = actionResolution.selectedCandidate;

    return createStage(
      'select_capabilities',
      'completed',
      `The runtime selected ${selectedCandidate.targetType}:${selectedCandidate.targetId} for ${selectedCandidate.actionType}.`,
      {
        targetType: selectedCandidate.targetType,
        targetId: selectedCandidate.targetId,
        actionType: selectedCandidate.actionType,
      },
    );
  }

  if (CLARIFICATION_ACTION_RESOLUTION_STATUSES.has(actionResolution.status)) {
    return createStage(
      'select_capabilities',
      'blocked',
      'Capability selection paused because the runtime requires clarification before choosing a safe action target.',
    );
  }

  if (ANSWER_ONLY_ACTION_RESOLUTION_STATUSES.has(actionResolution.status)) {
    return createStage(
      'select_capabilities',
      'skipped',
      'No capability selection was required because the invocation remained answer-only.',
    );
  }

  if (PLAN_ONLY_ACTION_RESOLUTION_STATUSES.has(actionResolution.status)) {
    return createStage(
      'select_capabilities',
      'completed',
      'The runtime selected a governed capability target for planning preview without starting execution.',
      {
        targetType: actionResolution.selectedCandidate?.targetType ?? null,
        targetId: actionResolution.selectedCandidate?.targetId ?? null,
      },
    );
  }

  if (actionResolution.status === 'denied') {
    return createStage(
      'select_capabilities',
      'skipped',
      'No capability was selected because runtime policy denied the requested action before a usable target could proceed.',
    );
  }

  return createStage(
    'select_capabilities',
    'skipped',
    `Capability selection was not required for action resolution status "${actionResolution.status}".`,
  );
}

function buildRequestApprovalStage({
  actionResolution,
  toolRequestResolution,
  workflowRequestResolution,
  humanApprovalRuntime,
}) {
  const approvalRequestId = humanApprovalRuntime?.approvalRequest?.approvalRequestId
    ?? humanApprovalRuntime?.approvalState?.approvalRequestId
    ?? null;
  const approvalPending = actionResolution?.status === 'approval_required'
    || toolRequestResolution?.status === 'approval_required'
    || workflowRequestResolution?.status === 'approval_required'
    || humanApprovalRuntime?.approvalState?.status === 'pending'
    || isPlainObject(humanApprovalRuntime?.approvalRequest);

  if (approvalPending) {
    return createStage(
      'request_approval',
      'blocked',
      'Human approval is required before execution can continue.',
      {
        approvalRequestId,
      },
    );
  }

  return createStage(
    'request_approval',
    'skipped',
    'No human approval was required for this invocation.',
  );
}

function buildExecuteStage({
  request,
  executionStatus,
  executionType,
  actionResolution,
  brainToolExecution,
  brainWorkflowExecution,
}) {
  if (executionType === 'conversation_creation') {
    return createStage(
      'execute',
      'skipped',
      'No agent work execution was performed because the invocation only created a conversation session.',
    );
  }

  if (hasRuntimeExecution({ brainToolExecution, brainWorkflowExecution })) {
    const targetId = brainWorkflowExecution?.requestedWorkflowId
      ?? brainToolExecution?.requestedToolId
      ?? null;

    return createStage(
      'execute',
      'completed',
      `The runtime executed ${targetId ?? 'the selected action'} and produced observable execution evidence.`,
      {
        executionType: brainWorkflowExecution?.executionPerformed === true
          ? 'workflow_execution'
          : 'tool_execution',
        targetId,
      },
    );
  }

  if (hasDeterministicExecution({
    invocationMode: request.invocationMode,
    executionType,
    executionStatus,
  })) {
    return createStage(
      'execute',
      'completed',
      'The runtime executed the deterministic command path without planner-mediated capability execution.',
    );
  }

  if (actionResolution?.status === 'approval_required') {
    return createStage(
      'execute',
      'blocked',
      'Execution is paused until a human approval decision is available.',
    );
  }

  if (CLARIFICATION_ACTION_RESOLUTION_STATUSES.has(actionResolution?.status)) {
    return createStage(
      'execute',
      'blocked',
      'Execution did not begin because the runtime requires clarification first.',
    );
  }

  if (actionResolution?.status === 'denied') {
    return createStage(
      'execute',
      'skipped',
      'Execution did not begin because the requested action was denied.',
    );
  }

  if (ANSWER_ONLY_ACTION_RESOLUTION_STATUSES.has(actionResolution?.status)) {
    return createStage(
      'execute',
      'skipped',
      'No executable runtime action was required for this invocation.',
    );
  }

  if (PLAN_ONLY_ACTION_RESOLUTION_STATUSES.has(actionResolution?.status)) {
    return createStage(
      'execute',
      'skipped',
      'Execution did not begin because this invocation only previewed the governed plan.',
      {
        previewOnly: true,
        targetType: actionResolution.selectedCandidate?.targetType ?? null,
        targetId: actionResolution.selectedCandidate?.targetId ?? null,
      },
    );
  }

  if (executionStatus === 'failed') {
    return createStage(
      'execute',
      'failed',
      'The invocation failed before execution could complete.',
    );
  }

  return createStage(
    'execute',
    'skipped',
    'No runtime execution was performed in this invocation.',
  );
}

function buildObserveStage({
  request,
  executionType,
  brainToolExecution,
  brainWorkflowExecution,
  brainToolObservation,
  brainWorkflowObservation,
}) {
  if (hasRuntimeObservation({ brainToolObservation, brainWorkflowObservation })) {
    return createStage(
      'observe',
      'completed',
      'The runtime captured post-execution observation evidence for the executed action.',
      {
        observationType: brainWorkflowObservation ? 'workflow_observation' : 'tool_observation',
        targetId: brainWorkflowObservation?.workflowId ?? brainToolObservation?.toolId ?? null,
      },
    );
  }

  if (hasRuntimeExecution({ brainToolExecution, brainWorkflowExecution })) {
    return createStage(
      'observe',
      'failed',
      'Execution was observed as started, but no matching runtime observation record was captured.',
    );
  }

  if (hasDeterministicExecution({
    invocationMode: request.invocationMode,
    executionType,
    executionStatus: 'completed',
  })) {
    return createStage(
      'observe',
      'skipped',
      'The deterministic command path does not emit a separate observation stage in this slice.',
    );
  }

  return createStage(
    'observe',
    'skipped',
    'No runtime observation was required because no governed action execution took place.',
  );
}

function buildVerifyStage({ actionResultAssessment, verificationGate, executionType }) {
  if (executionType === 'conversation_creation') {
    return createStage(
      'verify',
      'skipped',
      'No runtime verification was required because the invocation only created a conversation session.',
    );
  }

  if (!actionResultAssessment && !verificationGate) {
    return createStage(
      'verify',
      'skipped',
      'No verification evidence was produced for this invocation.',
    );
  }

  if (verificationGate?.status === 'passed') {
    return createStage(
      'verify',
      'completed',
      verificationGate.reason,
      {
        requestFulfillment: actionResultAssessment?.requestFulfillment ?? null,
        verificationStatus: verificationGate.status,
        verificationOutcome: verificationGate.verificationOutcome,
      },
    );
  }

  if (verificationGate?.status === 'degraded') {
    return createStage(
      'verify',
      'degraded',
      verificationGate.reason,
      {
        requestFulfillment: actionResultAssessment?.requestFulfillment ?? null,
        verificationStatus: verificationGate.status,
        verificationOutcome: verificationGate.verificationOutcome,
      },
    );
  }

  if (verificationGate?.status === 'failed') {
    return createStage(
      'verify',
      'failed',
      verificationGate.reason,
      {
        requestFulfillment: actionResultAssessment?.requestFulfillment ?? null,
        verificationStatus: verificationGate.status,
        verificationOutcome: verificationGate.verificationOutcome,
      },
    );
  }

  if (verificationGate?.status === 'not_applicable' && !actionResultAssessment) {
    return createStage(
      'verify',
      'skipped',
      verificationGate.reason,
      {
        verificationStatus: verificationGate.status,
        verificationOutcome: verificationGate.verificationOutcome,
      },
    );
  }

  if (actionResultAssessment.status === 'success') {
    return createStage(
      'verify',
      'completed',
      actionResultAssessment.reason,
      {
        requestFulfillment: actionResultAssessment.requestFulfillment,
      },
    );
  }

  if (actionResultAssessment.status === 'partial_success') {
    return createStage(
      'verify',
      'degraded',
      actionResultAssessment.reason,
      {
        requestFulfillment: actionResultAssessment.requestFulfillment,
      },
    );
  }

  if (actionResultAssessment.status === 'failure') {
    return createStage(
      'verify',
      'failed',
      actionResultAssessment.reason,
      {
        requestFulfillment: actionResultAssessment.requestFulfillment,
      },
    );
  }

  if (actionResultAssessment.status === 'clarification_required' || actionResultAssessment.status === 'approval_pause') {
    return createStage(
      'verify',
      'blocked',
      actionResultAssessment.reason,
      {
        requestFulfillment: actionResultAssessment.requestFulfillment,
      },
    );
  }

  if (actionResultAssessment.status === 'no_execution') {
    return createStage(
      'verify',
      'completed',
      actionResultAssessment.reason,
      {
        requestFulfillment: actionResultAssessment.requestFulfillment,
      },
    );
  }

  return createStage(
    'verify',
    'skipped',
    actionResultAssessment.reason ?? 'No verification stage was required for this invocation.',
    {
      requestFulfillment: actionResultAssessment.requestFulfillment,
    },
  );
}

function buildSummarizeStage({ message }) {
  if (isNonEmptyString(message)) {
    return createStage(
      'summarize',
      'completed',
      'The runtime produced a final user-facing summary for this invocation.',
    );
  }

  return createStage(
    'summarize',
    'failed',
    'The invocation completed without a usable final summary message.',
  );
}

function buildPersistStage({ persistenceCompleted }) {
  if (persistenceCompleted) {
    return createStage(
      'persist',
      'completed',
      'Invocation session artifacts are scheduled to be persisted for audit and follow-up.',
    );
  }

  return createStage(
    'persist',
    'skipped',
    'This invocation path ended without persisted invocation artifacts.',
  );
}

function buildContinueOrStopStage({ executionStatus, conversationRuntime, nextStep }) {
  if (conversationRuntime?.conversationId) {
    return createStage(
      'continue_or_stop',
      'completed',
      'The invocation completed and may continue through the associated conversation session.',
      {
        conversationId: conversationRuntime.conversationId,
        nextStep,
      },
    );
  }

  if (executionStatus === 'failed') {
    return createStage(
      'continue_or_stop',
      'completed',
      'The invocation stopped after a failure and produced recovery guidance for the next step.',
      {
        nextStep,
      },
    );
  }

  if (executionStatus === 'blocked') {
    return createStage(
      'continue_or_stop',
      'completed',
      'The invocation paused before completion and produced operator guidance for what must happen next.',
      {
        nextStep,
      },
    );
  }

  return createStage(
    'continue_or_stop',
    'completed',
    'The invocation completed for this request and returned next-step guidance for any follow-up work.',
    {
      nextStep,
    },
  );
}

function deriveOverallOutcome({
  executionStatus,
  executionType,
  actionResolution,
  actionResultAssessment,
}) {
  if (executionType === 'conversation_creation') {
    return 'conversation_created';
  }

  if (executionStatus === 'failed') {
    return 'failed';
  }

  if (executionStatus === 'blocked') {
    return 'blocked';
  }

  if (actionResultAssessment?.status === 'success') {
    return 'acted';
  }

  if (actionResultAssessment?.status === 'partial_success') {
    return 'acted_with_review';
  }

  if (actionResultAssessment?.status === 'approval_pause') {
    return 'approval_paused';
  }

  if (actionResultAssessment?.status === 'clarification_required') {
    return 'clarification_required';
  }

  if (actionResultAssessment?.status === 'no_execution') {
    return 'no_execution';
  }

  if (PLAN_ONLY_ACTION_RESOLUTION_STATUSES.has(actionResolution?.status)) {
    return 'planned_only';
  }

  if (actionResultAssessment?.status === 'not_applicable' || ANSWER_ONLY_ACTION_RESOLUTION_STATUSES.has(actionResolution?.status)) {
    return 'answered_only';
  }

  if (executionType === 'deterministic_command') {
    return 'deterministic_completed';
  }

  return 'completed';
}

function buildStageCounts(stages) {
  const counts = {
    totalStages: stages.length,
  };

  for (const status of AGENT_WORK_CYCLE_STAGE_STATUSES) {
    counts[status] = stages.filter((stage) => {
      return stage.status === status;
    }).length;
  }

  return counts;
}

export function buildAgentWorkCycleSummary({
  invocationId,
  primaryCognitiveIdentityId = null,
  operationalIdentityId,
  request,
  executionStatus,
  executionType = null,
  readiness = null,
  actionResolution = null,
  toolRequestResolution = null,
  workflowRequestResolution = null,
  brainToolExecution = null,
  brainToolObservation = null,
  brainWorkflowExecution = null,
  brainWorkflowObservation = null,
  semanticIntentRuntime = null,
  actionResultAssessment = null,
  verificationGate = null,
  humanApprovalRuntime = null,
  executionPlan = null,
  message = null,
  nextStep = null,
  conversationRuntime = null,
  persistenceCompleted = false,
} = {}) {
  if (!isNonEmptyString(invocationId)) {
    throw new Error('Agent work cycle summary builder requires a non-empty invocationId.');
  }

  if (!isNonEmptyString(operationalIdentityId)) {
    throw new Error('Agent work cycle summary builder requires a non-empty operationalIdentityId.');
  }

  if (!isPlainObject(request)) {
    throw new Error('Agent work cycle summary builder requires the normalized request object.');
  }

  const stages = [
    buildReceiveRequestStage({ request }),
    buildUnderstandStage({
      request,
      executionStatus,
      executionType,
      readiness,
      semanticIntentRuntime,
      actionResolution,
    }),
    buildDecideStage({
      actionResolution,
      executionStatus,
      executionType,
    }),
    buildPlanStage({
      executionType,
      executionStatus,
      actionResolution,
      executionPlan,
    }),
    buildSelectCapabilitiesStage({
      actionResolution,
      executionType,
    }),
    buildRequestApprovalStage({
      actionResolution,
      toolRequestResolution,
      workflowRequestResolution,
      humanApprovalRuntime,
    }),
    buildExecuteStage({
      request,
      executionStatus,
      executionType,
      actionResolution,
      brainToolExecution,
      brainWorkflowExecution,
    }),
    buildObserveStage({
      request,
      executionType,
      brainToolExecution,
      brainWorkflowExecution,
      brainToolObservation,
      brainWorkflowObservation,
    }),
    buildVerifyStage({
      actionResultAssessment,
      verificationGate,
      executionType,
    }),
    buildSummarizeStage({
      message,
    }),
    buildPersistStage({
      persistenceCompleted,
    }),
    buildContinueOrStopStage({
      executionStatus,
      conversationRuntime,
      nextStep,
    }),
  ];

  return assertAgentWorkCycleSummary({
    kind: 'agent_work_cycle_summary',
    version: 1,
    invocationId,
    primaryCognitiveIdentityId,
    operationalIdentityId,
    invocationMode: request.invocationMode,
    executionStatus,
    overallOutcome: deriveOverallOutcome({
      executionStatus,
      executionType,
      actionResolution,
      actionResultAssessment,
    }),
    terminalStageId: AGENT_WORK_CYCLE_STAGE_IDS.at(-1),
    stageCounts: buildStageCounts(stages),
    stages,
    metadata: {
      command: request.command,
      executionType,
      conversationId: conversationRuntime?.conversationId ?? null,
    },
  });
}
