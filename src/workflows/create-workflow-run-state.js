import { assertWorkflowRunState } from '../contracts/workflows/workflow-run-state-contract.js';
import { assertWorkflowRuntimeDefinition } from '../contracts/workflows/workflow-runtime-contract.js';

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function assertNonEmptyString(value, description) {
  if (!isNonEmptyString(value)) {
    throw new Error(`${description} must be a non-empty string.`);
  }

  return value.trim();
}

function createDefaultWorkflowRunId({
  invocationId,
  workflowId,
}) {
  return `workflow-run-${invocationId}-${workflowId}`;
}

function findFirstExecutableStepId(workflowRuntimeDefinition) {
  const firstRootStep = workflowRuntimeDefinition.steps.find((step) => {
    return step.dependsOn.length === 0;
  });

  if (!firstRootStep) {
    throw new Error(`Workflow runtime definition ${workflowRuntimeDefinition.workflowId} has no root step to initialize.`);
  }

  return firstRootStep.stepId;
}

export function createWorkflowRunState({
  workflowRuntimeDefinition,
  workflowRunId = null,
  operationalIdentityId,
  invocationId,
  createdAt = new Date().toISOString(),
} = {}) {
  const definition = assertWorkflowRuntimeDefinition(workflowRuntimeDefinition);
  const normalizedInvocationId = assertNonEmptyString(invocationId, 'Workflow run state creation invocationId');
  const normalizedWorkflowRunId = isNonEmptyString(workflowRunId)
    ? workflowRunId.trim()
    : createDefaultWorkflowRunId({
      invocationId: normalizedInvocationId,
      workflowId: definition.workflowId,
    });
  const normalizedCreatedAt = assertNonEmptyString(createdAt, 'Workflow run state creation createdAt');

  return assertWorkflowRunState({
    kind: 'workflow_run_state',
    version: 1,
    workflowRunId: normalizedWorkflowRunId,
    workflowId: definition.workflowId,
    status: 'created',
    operationalIdentityId: assertNonEmptyString(
      operationalIdentityId,
      'Workflow run state creation operationalIdentityId',
    ),
    invocationId: normalizedInvocationId,
    currentStepId: findFirstExecutableStepId(definition),
    completedSteps: [],
    blockedSteps: [],
    failedSteps: [],
    approvalRequests: [],
    toolRunIds: [],
    artifactReferences: [],
    memoryWritebackCandidateIds: [],
    createdAt: normalizedCreatedAt,
    updatedAt: normalizedCreatedAt,
    warnings: [],
  });
}
