import { assertAgentExecutionPlan } from '../contracts/identity/agent-execution-plan-contract.js';
import { assertPlanExecutionCoordination } from '../contracts/plans/plan-execution-coordination-contract.js';
import { assertBrainToolRequestResolution } from '../contracts/brain/brain-tool-request-contract.js';
import { assertBrainWorkflowRequestResolution } from '../contracts/brain/brain-workflow-request-contract.js';

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeActionResolution(value) {
  if (!isPlainObject(value)) {
    return null;
  }

  return value;
}

function findFirstStepByType(plan, stepType) {
  return plan.steps.find((step) => {
    return step.stepType === stepType;
  }) ?? null;
}

function findFirstExecutableStep(plan) {
  return plan.steps.find((step) => {
    return step.stepType === 'tool_execution' || step.stepType === 'workflow_execution';
  }) ?? null;
}

function buildBaseCoordination({
  status,
  runtimeAction,
  selectedStep = null,
  executionAllowed,
  executionBlocked,
  approvalRequired,
  approvalRequestId = null,
  reason,
  warnings = [],
  evidence = [],
  toolRequestResolution = null,
  workflowRequestResolution = null,
  metadata = {},
}) {
  return assertPlanExecutionCoordination({
    kind: 'plan_execution_coordination',
    version: 1,
    status,
    runtimeAction,
    selectedStepId: selectedStep?.stepId ?? null,
    selectedStepType: selectedStep?.stepType ?? null,
    selectedTargetType: selectedStep?.targetType ?? null,
    selectedTargetId: selectedStep?.targetId ?? null,
    executionAllowed,
    executionBlocked,
    approvalRequired,
    approvalRequestId,
    reason,
    warnings,
    evidence,
    toolRequestResolution,
    workflowRequestResolution,
    metadata,
  });
}

function buildNoExecutionCoordination({
  executionPlan,
  selectedStep = null,
  reason,
  evidence = [],
  warnings = [],
  metadata = {},
}) {
  return buildBaseCoordination({
    status: 'no_execution',
    runtimeAction: 'none',
    selectedStep: selectedStep ?? findFirstStepByType(executionPlan, 'clarification'),
    executionAllowed: false,
    executionBlocked: false,
    approvalRequired: false,
    reason,
    warnings,
    evidence: [
      `Execution plan ${executionPlan.planId} does not authorize runtime execution for this invocation.`,
      ...evidence,
    ],
    metadata: {
      planId: executionPlan.planId,
      ...metadata,
    },
  });
}

function buildFailedCoordination({
  executionPlan,
  selectedStep = null,
  reason,
  evidence = [],
  warnings = [],
  toolRequestResolution = null,
  workflowRequestResolution = null,
  metadata = {},
}) {
  return buildBaseCoordination({
    status: 'failed',
    runtimeAction: 'stop',
    selectedStep,
    executionAllowed: false,
    executionBlocked: true,
    approvalRequired: false,
    reason,
    warnings,
    evidence: [
      `Execution plan ${executionPlan.planId} could not be coordinated safely.`,
      ...evidence,
    ],
    toolRequestResolution,
    workflowRequestResolution,
    metadata: {
      planId: executionPlan.planId,
      ...metadata,
    },
  });
}

function buildBlockedCoordination({
  executionPlan,
  selectedStep = null,
  reason,
  evidence = [],
  warnings = [],
  toolRequestResolution = null,
  workflowRequestResolution = null,
  metadata = {},
}) {
  return buildBaseCoordination({
    status: 'blocked',
    runtimeAction: 'stop',
    selectedStep,
    executionAllowed: false,
    executionBlocked: true,
    approvalRequired: false,
    reason,
    warnings,
    evidence: [
      `Execution plan ${executionPlan.planId} was stopped by a runtime guard.`,
      ...evidence,
    ],
    toolRequestResolution,
    workflowRequestResolution,
    metadata: {
      planId: executionPlan.planId,
      ...metadata,
    },
  });
}

function buildApprovalRequiredCoordination({
  executionPlan,
  selectedStep,
  reason,
  approvalRequestId = null,
  evidence = [],
  warnings = [],
  toolRequestResolution = null,
  workflowRequestResolution = null,
  metadata = {},
}) {
  return buildBaseCoordination({
    status: 'approval_required',
    runtimeAction: 'pause_for_approval',
    selectedStep,
    executionAllowed: false,
    executionBlocked: true,
    approvalRequired: true,
    approvalRequestId,
    reason,
    warnings,
    evidence: [
      `Execution plan ${executionPlan.planId} is paused behind an approval gate.`,
      ...evidence,
    ],
    toolRequestResolution,
    workflowRequestResolution,
    metadata: {
      planId: executionPlan.planId,
      ...metadata,
    },
  });
}

function buildReadyCoordination({
  executionPlan,
  selectedStep,
  runtimeAction,
  reason,
  evidence = [],
  warnings = [],
  toolRequestResolution = null,
  workflowRequestResolution = null,
  metadata = {},
}) {
  return buildBaseCoordination({
    status: 'ready',
    runtimeAction,
    selectedStep,
    executionAllowed: true,
    executionBlocked: false,
    approvalRequired: false,
    reason,
    warnings,
    evidence: [
      `Execution plan ${executionPlan.planId} authorized one runtime action.`,
      ...evidence,
    ],
    toolRequestResolution,
    workflowRequestResolution,
    metadata: {
      planId: executionPlan.planId,
      ...metadata,
    },
  });
}

function approvalsAreRequired(executionPlan) {
  return executionPlan.requiredApprovals.length > 0 || findFirstStepByType(executionPlan, 'request_approval') !== null;
}

function resolveApprovalState(humanApprovalRuntime) {
  if (!isPlainObject(humanApprovalRuntime)) {
    return {
      status: 'missing',
      approvalRequestId: null,
      executionAuthorized: false,
    };
  }

  return {
    status: isNonEmptyString(humanApprovalRuntime.approvalState?.status)
      ? humanApprovalRuntime.approvalState.status.trim()
      : 'missing',
    approvalRequestId: isNonEmptyString(humanApprovalRuntime.approvalRequest?.approvalRequestId)
      ? humanApprovalRuntime.approvalRequest.approvalRequestId.trim()
      : null,
    executionAuthorized: humanApprovalRuntime.executionAuthorized === true,
  };
}

function selectedCandidateMatchesStep(actionResolution, selectedStep) {
  const selectedCandidate = actionResolution?.selectedCandidate ?? null;

  if (!selectedCandidate) {
    return false;
  }

  return selectedCandidate.targetType === selectedStep.targetType
    && selectedCandidate.targetId === selectedStep.targetId;
}

function acceptedToolSideEffectCanAutoExecute(toolRequest) {
  if (toolRequest.expectedSideEffectLevel === 'read_only') {
    return true;
  }

  return toolRequest.toolId.startsWith('mas.os.')
    && toolRequest.expectedSideEffectLevel === 'write_internal';
}

function coordinateToolExecution({
  executionPlan,
  selectedStep,
  actionResolution,
  toolRequestResolution,
}) {
  if (!toolRequestResolution) {
    return buildFailedCoordination({
      executionPlan,
      selectedStep,
      reason: `Execution plan selected tool ${selectedStep.targetId}, but no toolRequestResolution was available.`,
      evidence: [
        `Selected execution step: ${selectedStep.stepId}.`,
        'Tool execution requires a matching accepted or approval-required tool request resolution.',
      ],
    });
  }

  const normalizedResolution = assertBrainToolRequestResolution(toolRequestResolution);

  if (normalizedResolution.requestedToolId !== selectedStep.targetId) {
    return buildFailedCoordination({
      executionPlan,
      selectedStep,
      toolRequestResolution: normalizedResolution,
      reason: `Execution plan selected tool ${selectedStep.targetId}, but toolRequestResolution targeted ${normalizedResolution.requestedToolId}.`,
      evidence: [
        `Selected execution step: ${selectedStep.stepId}.`,
        `toolRequestResolution requested tool: ${normalizedResolution.requestedToolId}.`,
      ],
    });
  }

  if (!selectedCandidateMatchesStep(actionResolution, selectedStep)) {
    return buildFailedCoordination({
      executionPlan,
      selectedStep,
      toolRequestResolution: normalizedResolution,
      reason: 'Action resolution selected a different target than the execution plan.',
      evidence: [
        `Selected execution step: ${selectedStep.targetType}:${selectedStep.targetId}.`,
        `Action resolution selected: ${actionResolution?.selectedCandidate?.targetType ?? 'none'}:${actionResolution?.selectedCandidate?.targetId ?? 'none'}.`,
      ],
    });
  }

  if (normalizedResolution.status === 'approval_required') {
    return buildApprovalRequiredCoordination({
      executionPlan,
      selectedStep,
      toolRequestResolution: normalizedResolution,
      approvalRequestId: null,
      reason: normalizedResolution.reason,
      warnings: normalizedResolution.warnings,
      evidence: [
        `toolRequestResolution status is ${normalizedResolution.status}.`,
      ],
      metadata: {
        requestedToolId: normalizedResolution.requestedToolId,
      },
    });
  }

  if (normalizedResolution.status === 'denied') {
    return buildBlockedCoordination({
      executionPlan,
      selectedStep,
      toolRequestResolution: normalizedResolution,
      reason: normalizedResolution.reason,
      warnings: normalizedResolution.warnings,
      evidence: [
        `toolRequestResolution status is ${normalizedResolution.status}.`,
      ],
      metadata: {
        requestedToolId: normalizedResolution.requestedToolId,
      },
    });
  }

  if (normalizedResolution.status !== 'accepted') {
    return buildFailedCoordination({
      executionPlan,
      selectedStep,
      toolRequestResolution: normalizedResolution,
      reason: `Tool execution cannot proceed because toolRequestResolution status is ${normalizedResolution.status}.`,
      warnings: normalizedResolution.warnings,
      evidence: [
        `toolRequestResolution status is ${normalizedResolution.status}.`,
      ],
      metadata: {
        requestedToolId: normalizedResolution.requestedToolId,
      },
    });
  }

  if (!acceptedToolSideEffectCanAutoExecute(normalizedResolution.toolRequest)) {
    return buildFailedCoordination({
      executionPlan,
      selectedStep,
      toolRequestResolution: normalizedResolution,
      reason: `Tool ${normalizedResolution.requestedToolId} cannot auto-execute because expectedSideEffectLevel is ${normalizedResolution.toolRequest.expectedSideEffectLevel}.`,
      evidence: [
        `toolRequestResolution status is ${normalizedResolution.status}.`,
      ],
      metadata: {
        requestedToolId: normalizedResolution.requestedToolId,
      },
    });
  }

  return buildReadyCoordination({
    executionPlan,
    selectedStep,
    runtimeAction: 'queue_tool_request',
    toolRequestResolution: normalizedResolution,
    reason: `Tool ${normalizedResolution.requestedToolId} is plan-authorized and ready for governed execution.`,
    warnings: normalizedResolution.warnings,
    evidence: [
      `Selected execution step: ${selectedStep.stepId}.`,
      `toolRequestResolution status is ${normalizedResolution.status}.`,
      `Expected sideEffectLevel is ${normalizedResolution.toolRequest.expectedSideEffectLevel}.`,
    ],
    metadata: {
      requestedToolId: normalizedResolution.requestedToolId,
    },
  });
}

function coordinateWorkflowExecution({
  executionPlan,
  selectedStep,
  actionResolution,
  workflowRequestResolution,
}) {
  if (!workflowRequestResolution) {
    return buildFailedCoordination({
      executionPlan,
      selectedStep,
      reason: `Execution plan selected workflow ${selectedStep.targetId}, but no workflowRequestResolution was available.`,
      evidence: [
        `Selected execution step: ${selectedStep.stepId}.`,
        'Workflow execution requires a matching accepted workflow request resolution.',
      ],
    });
  }

  const normalizedResolution = assertBrainWorkflowRequestResolution(workflowRequestResolution);

  if (normalizedResolution.requestedWorkflowId !== selectedStep.targetId) {
    return buildFailedCoordination({
      executionPlan,
      selectedStep,
      workflowRequestResolution: normalizedResolution,
      reason: `Execution plan selected workflow ${selectedStep.targetId}, but workflowRequestResolution targeted ${normalizedResolution.requestedWorkflowId}.`,
      evidence: [
        `Selected execution step: ${selectedStep.stepId}.`,
        `workflowRequestResolution requested workflow: ${normalizedResolution.requestedWorkflowId}.`,
      ],
    });
  }

  if (!selectedCandidateMatchesStep(actionResolution, selectedStep)) {
    return buildFailedCoordination({
      executionPlan,
      selectedStep,
      workflowRequestResolution: normalizedResolution,
      reason: 'Action resolution selected a different target than the execution plan.',
      evidence: [
        `Selected execution step: ${selectedStep.targetType}:${selectedStep.targetId}.`,
        `Action resolution selected: ${actionResolution?.selectedCandidate?.targetType ?? 'none'}:${actionResolution?.selectedCandidate?.targetId ?? 'none'}.`,
      ],
    });
  }

  if (normalizedResolution.status === 'denied') {
    return buildBlockedCoordination({
      executionPlan,
      selectedStep,
      workflowRequestResolution: normalizedResolution,
      reason: normalizedResolution.reason,
      warnings: normalizedResolution.warnings,
      evidence: [
        `workflowRequestResolution status is ${normalizedResolution.status}.`,
      ],
      metadata: {
        requestedWorkflowId: normalizedResolution.requestedWorkflowId,
      },
    });
  }

  if (normalizedResolution.status !== 'accepted') {
    return buildFailedCoordination({
      executionPlan,
      selectedStep,
      workflowRequestResolution: normalizedResolution,
      reason: `Workflow execution cannot proceed because workflowRequestResolution status is ${normalizedResolution.status}.`,
      warnings: normalizedResolution.warnings,
      evidence: [
        `workflowRequestResolution status is ${normalizedResolution.status}.`,
      ],
      metadata: {
        requestedWorkflowId: normalizedResolution.requestedWorkflowId,
      },
    });
  }

  if (normalizedResolution.workflowRequest.expectedSideEffectLevel !== 'read_only') {
    return buildFailedCoordination({
      executionPlan,
      selectedStep,
      workflowRequestResolution: normalizedResolution,
      reason: `Workflow ${normalizedResolution.requestedWorkflowId} cannot auto-execute because expectedSideEffectLevel is ${normalizedResolution.workflowRequest.expectedSideEffectLevel}.`,
      evidence: [
        `workflowRequestResolution status is ${normalizedResolution.status}.`,
      ],
      metadata: {
        requestedWorkflowId: normalizedResolution.requestedWorkflowId,
      },
    });
  }

  return buildReadyCoordination({
    executionPlan,
    selectedStep,
    runtimeAction: 'queue_workflow_request',
    workflowRequestResolution: normalizedResolution,
    reason: `Workflow ${normalizedResolution.requestedWorkflowId} is plan-authorized and ready for governed execution.`,
    warnings: normalizedResolution.warnings,
    evidence: [
      `Selected execution step: ${selectedStep.stepId}.`,
      `workflowRequestResolution status is ${normalizedResolution.status}.`,
      `Expected sideEffectLevel is ${normalizedResolution.workflowRequest.expectedSideEffectLevel}.`,
    ],
    metadata: {
      requestedWorkflowId: normalizedResolution.requestedWorkflowId,
    },
  });
}

export function coordinatePlanExecutionForInvocation({
  executionPlan = null,
  actionResolution = null,
  toolRequestResolution = null,
  workflowRequestResolution = null,
  humanApprovalRuntime = null,
} = {}) {
  if (executionPlan === null || executionPlan === undefined) {
    return null;
  }

  const normalizedPlan = assertAgentExecutionPlan(executionPlan);
  const normalizedActionResolution = normalizeActionResolution(actionResolution);
  const executableStep = findFirstExecutableStep(normalizedPlan);
  const clarificationStep = findFirstStepByType(normalizedPlan, 'clarification');
  const previewOnly = normalizedPlan.metadata?.planMode === 'preview_only';

  if (previewOnly) {
    return buildNoExecutionCoordination({
      executionPlan: normalizedPlan,
      selectedStep: executableStep,
      reason: 'The current plan previews a governed execution path and does not authorize runtime execution in this invocation.',
      evidence: executableStep
        ? [`Preview step selected: ${executableStep.stepType}:${executableStep.targetId}.`]
        : [],
      metadata: {
        previewOnly: true,
      },
    });
  }

  if (!executableStep) {
    return buildNoExecutionCoordination({
      executionPlan: normalizedPlan,
      reason: clarificationStep
        ? 'The current plan only prepares clarification and does not authorize runtime execution.'
        : 'The current plan does not contain an executable tool or workflow step.',
      evidence: clarificationStep
        ? [`Clarification step selected: ${clarificationStep.stepId}.`]
        : [],
      metadata: {
        clarificationOnly: clarificationStep !== null,
      },
    });
  }

  if (approvalsAreRequired(normalizedPlan)) {
    const approvalState = resolveApprovalState(humanApprovalRuntime);

    if (!approvalState.executionAuthorized) {
      if (approvalState.status === 'denied' || approvalState.status === 'expired') {
        return buildBlockedCoordination({
          executionPlan: normalizedPlan,
          selectedStep: executableStep,
          toolRequestResolution,
          workflowRequestResolution,
          reason: `Execution remains blocked because the approval state is ${approvalState.status}.`,
          evidence: [
            `Approval status: ${approvalState.status}.`,
          ],
          metadata: {
            approvalRequestId: approvalState.approvalRequestId,
          },
        });
      }

      return buildApprovalRequiredCoordination({
        executionPlan: normalizedPlan,
        selectedStep: executableStep,
        toolRequestResolution,
        workflowRequestResolution,
        approvalRequestId: approvalState.approvalRequestId,
        reason: 'Execution is paused until a human approval decision authorizes the planned step.',
        evidence: [
          `Approval status: ${approvalState.status}.`,
        ],
        metadata: {
          approvalRequestId: approvalState.approvalRequestId,
        },
      });
    }
  }

  if (executableStep.stepType === 'tool_execution') {
    return coordinateToolExecution({
      executionPlan: normalizedPlan,
      selectedStep: executableStep,
      actionResolution: normalizedActionResolution,
      toolRequestResolution,
    });
  }

  if (executableStep.stepType === 'workflow_execution') {
    return coordinateWorkflowExecution({
      executionPlan: normalizedPlan,
      selectedStep: executableStep,
      actionResolution: normalizedActionResolution,
      workflowRequestResolution,
    });
  }

  return buildFailedCoordination({
    executionPlan: normalizedPlan,
    selectedStep: executableStep,
    reason: `Unsupported executable plan step type: ${executableStep.stepType}.`,
    evidence: [
      `Selected execution step: ${executableStep.stepId}.`,
    ],
  });
}
