import { assertBrainWorkflowRequestResolution } from '../contracts/brain/brain-workflow-request-contract.js';
import { assertToolDefinition } from '../contracts/tools/tool-definition-contract.js';
import { runWorkflow } from './run-workflow.js';

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function assertNonEmptyString(value, description) {
  if (!isNonEmptyString(value)) {
    throw new Error(`${description} must be a non-empty string.`);
  }

  return value.trim();
}

function normalizeToolDefinitions(toolDefinitions) {
  if (!Array.isArray(toolDefinitions)) {
    throw new Error('Brain workflow execution toolDefinitions must be an array.');
  }

  return toolDefinitions.map(assertToolDefinition);
}

function buildNotExecutedResult({
  workflowRequestResolution,
  reason,
  warnings = [],
  errors = [],
}) {
  return {
    kind: 'brain_workflow_execution_result',
    version: 1,
    status: 'not_executed',
    executionPerformed: false,
    requestedWorkflowId: workflowRequestResolution?.requestedWorkflowId ?? null,
    workflowRequestId: workflowRequestResolution?.workflowRequest?.workflowRequestId ?? null,
    workflowRunId: null,
    workflowRunStatus: null,
    workflowRunStateRecordPath: null,
    memoryWritebackRequest: null,
    memoryWritebackPersistence: null,
    observation: null,
    reason,
    warnings,
    errors,
  };
}

function createWorkflowRunId({
  invocationId,
  workflowRequestId,
}) {
  return `workflow-run-${invocationId}-${workflowRequestId}`;
}

function createToolDefinitionMap(toolDefinitions) {
  return new Map(toolDefinitions.map((toolDefinition) => {
    return [toolDefinition.toolId, toolDefinition];
  }));
}

function validateReadOnlyWorkflowScope({
  workflowRequestResolution,
  toolDefinitions,
}) {
  const {
    workflowRequest,
    workflowRuntimeDefinition,
  } = workflowRequestResolution;

  if (workflowRequest.expectedSideEffectLevel !== 'read_only') {
    return `Brain workflow request expectedSideEffectLevel must be "read_only" for automatic execution in this slice: ${workflowRequest.expectedSideEffectLevel}.`;
  }

  if (workflowRuntimeDefinition.executionMode !== 'on_demand') {
    return `Workflow ${workflowRuntimeDefinition.workflowId} cannot be executed from a brain request because executionMode is ${workflowRuntimeDefinition.executionMode}.`;
  }

  if (workflowRuntimeDefinition.lifecycleState !== 'active') {
    return `Workflow ${workflowRuntimeDefinition.workflowId} cannot be executed because lifecycleState is ${workflowRuntimeDefinition.lifecycleState}.`;
  }

  const toolDefinitionById = createToolDefinitionMap(toolDefinitions);

  for (const step of workflowRuntimeDefinition.steps) {
    if (step.stepType !== 'tool_call') {
      continue;
    }

    const toolDefinition = toolDefinitionById.get(step.toolId) ?? null;

    if (!toolDefinition) {
      return `Workflow ${workflowRuntimeDefinition.workflowId} step ${step.stepId} references an unknown tool: ${step.toolId}.`;
    }

    if (toolDefinition.sideEffectLevel !== 'read_only') {
      return `Workflow ${workflowRuntimeDefinition.workflowId} step ${step.stepId} cannot be executed from a brain request because tool ${toolDefinition.toolId} sideEffectLevel is ${toolDefinition.sideEffectLevel}.`;
    }
  }

  return null;
}

function summarizeStepResult(stepResult) {
  return {
    stepId: stepResult.stepId,
    stepType: stepResult.stepType,
    toolId: stepResult.toolId ?? null,
    status: stepResult.status,
    reason: stepResult.reason,
    approvalRequestId: stepResult.approvalRequestId ?? null,
    toolRunId: stepResult.toolResult?.toolRunId ?? null,
    toolResultStatus: stepResult.toolResult?.status ?? null,
    toolAuditRecordPath: stepResult.toolPersistence?.auditRecordPath ?? null,
    toolResultSnapshotPath: stepResult.toolPersistence?.resultSnapshotPath ?? null,
    artifactReferences: stepResult.toolPersistence?.auditRecord?.artifactReferences ?? [],
    warnings: stepResult.toolResult?.warnings ?? [],
    errors: stepResult.toolResult?.errors ?? [],
  };
}

function buildWorkflowObservation({
  workflowRunResult,
}) {
  const state = workflowRunResult.workflowRunState;
  const stepSummaries = workflowRunResult.stepResults.map(summarizeStepResult);
  const summary = [
    `Workflow ${workflowRunResult.workflowId} finished with status ${workflowRunResult.status}.`,
    state.completedSteps.length > 0 ? `Completed steps: ${state.completedSteps.join(', ')}.` : null,
    state.blockedSteps.length > 0 ? `Blocked steps: ${state.blockedSteps.join(', ')}.` : null,
    state.failedSteps.length > 0 ? `Failed steps: ${state.failedSteps.join(', ')}.` : null,
  ].filter(Boolean).join(' ');

  return {
    kind: 'brain_workflow_observation',
    version: 1,
    workflowId: workflowRunResult.workflowId,
    workflowRunId: workflowRunResult.workflowRunId,
    status: workflowRunResult.status,
    summary,
    completedSteps: state.completedSteps,
    blockedSteps: state.blockedSteps,
    failedSteps: state.failedSteps,
    approvalRequests: state.approvalRequests,
    toolRunIds: state.toolRunIds,
    artifactReferences: state.artifactReferences,
    workflowRunStateRecordPath: workflowRunResult.persistence?.workflowRunStateRecordPath ?? null,
    statePersistenceRecords: workflowRunResult.statePersistenceRecords,
    stepSummaries,
    memoryWritebackCandidateIds: state.memoryWritebackCandidateIds,
    memoryWritebackRequestPath: workflowRunResult.memoryWritebackPersistence?.recordPath ?? null,
    warnings: workflowRunResult.warnings,
    errors: workflowRunResult.errors,
  };
}

function buildExecutedResult({
  workflowRequestResolution,
  workflowRunResult,
}) {
  const observation = buildWorkflowObservation({
    workflowRunResult,
  });

  return {
    kind: 'brain_workflow_execution_result',
    version: 1,
    status: 'executed',
    executionPerformed: true,
    requestedWorkflowId: workflowRequestResolution.requestedWorkflowId,
    workflowRequestId: workflowRequestResolution.workflowRequest.workflowRequestId,
    workflowRunId: workflowRunResult.workflowRunId,
    workflowRunStatus: workflowRunResult.status,
    workflowRunStateRecordPath: workflowRunResult.persistence?.workflowRunStateRecordPath ?? null,
    memoryWritebackRequest: workflowRunResult.memoryWritebackRequest,
    memoryWritebackPersistence: workflowRunResult.memoryWritebackPersistence,
    observation,
    reason: `Accepted brain workflow request ${workflowRequestResolution.workflowRequest.workflowRequestId} executed through the Workflow Runtime.`,
    warnings: workflowRunResult.warnings,
    errors: workflowRunResult.errors,
  };
}

export async function executeAcceptedBrainWorkflowRequest({
  masRootPath,
  invocationId,
  operationalIdentityId,
  requestedBy,
  workflowRequestResolution,
  toolDefinitions = [],
  resolvedBindings = null,
  permissionEvaluation = null,
  secretResolution = null,
} = {}) {
  const normalizedMasRootPath = assertNonEmptyString(
    masRootPath,
    'Brain workflow execution masRootPath',
  );
  const normalizedInvocationId = assertNonEmptyString(
    invocationId,
    'Brain workflow execution invocationId',
  );
  const normalizedOperationalIdentityId = assertNonEmptyString(
    operationalIdentityId,
    'Brain workflow execution operationalIdentityId',
  );
  const normalizedRequestedBy = assertNonEmptyString(
    requestedBy,
    'Brain workflow execution requestedBy',
  );
  const normalizedResolution = assertBrainWorkflowRequestResolution(workflowRequestResolution);

  if (normalizedResolution.status !== 'accepted') {
    return buildNotExecutedResult({
      workflowRequestResolution: normalizedResolution,
      reason: `Brain workflow request was not executed because resolution status is ${normalizedResolution.status}.`,
      warnings: normalizedResolution.warnings,
    });
  }

  const normalizedToolDefinitions = normalizeToolDefinitions(toolDefinitions);
  const scopeError = validateReadOnlyWorkflowScope({
    workflowRequestResolution: normalizedResolution,
    toolDefinitions: normalizedToolDefinitions,
  });

  if (scopeError) {
    return buildNotExecutedResult({
      workflowRequestResolution: normalizedResolution,
      reason: scopeError,
      errors: [scopeError],
    });
  }

  const workflowRunResult = await runWorkflow({
    masRootPath: normalizedMasRootPath,
    workflowId: normalizedResolution.requestedWorkflowId,
    workflowRuntimeDefinition: normalizedResolution.workflowRuntimeDefinition,
    workflowRunId: createWorkflowRunId({
      invocationId: normalizedInvocationId,
      workflowRequestId: normalizedResolution.workflowRequest.workflowRequestId,
    }),
    operationalIdentityId: normalizedOperationalIdentityId,
    invocationId: normalizedInvocationId,
    requestedBy: normalizedRequestedBy,
    toolDefinitions: normalizedToolDefinitions,
    resolvedBindings,
    permissionEvaluation,
    secretResolution,
    persistState: true,
  });

  return buildExecutedResult({
    workflowRequestResolution: normalizedResolution,
    workflowRunResult,
  });
}
