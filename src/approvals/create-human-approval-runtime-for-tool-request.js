import { assertBrainToolRequestResolution } from '../contracts/brain/brain-tool-request-contract.js';
import { assertHumanApprovalRequest } from '../contracts/approvals/human-approval-request-contract.js';
import { assertHumanApprovalState } from '../contracts/approvals/human-approval-state-contract.js';
import { assertToolResult } from '../contracts/tools/tool-result-contract.js';

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function assertInput({
  invocationId,
  operationalIdentityId,
  requestedBy,
  requestedAt,
}) {
  if (!isNonEmptyString(invocationId)) {
    throw new Error('Human approval runtime creation requires a non-empty invocationId.');
  }

  if (!isNonEmptyString(operationalIdentityId)) {
    throw new Error('Human approval runtime creation requires a non-empty operationalIdentityId.');
  }

  if (!isNonEmptyString(requestedBy)) {
    throw new Error('Human approval runtime creation requires a non-empty requestedBy.');
  }

  if (!isNonEmptyString(requestedAt)) {
    throw new Error('Human approval runtime creation requires a non-empty requestedAt.');
  }
}

function createApprovalRequestId({
  invocationId,
  toolRequestId,
}) {
  return `approval-${invocationId}-${toolRequestId}`;
}

function summarizeMatchedResources(toolReadinessVerdict) {
  return toolReadinessVerdict.matchedBindings.map((binding) => {
    return binding.resourceId;
  });
}

function createHumanApprovalRequest({
  invocationId,
  operationalIdentityId,
  requestedBy,
  requestedAt,
  approvalRequestId,
  toolRequestResolution,
}) {
  const {
    toolRequest,
    toolReadinessVerdict,
  } = toolRequestResolution;

  return assertHumanApprovalRequest({
    kind: 'human_approval_request',
    version: 1,
    approvalRequestId,
    approvalType: 'tool_execution',
    invocationId,
    operationalIdentityId,
    requestedBy,
    requestedAt,
    expiresAt: null,
    urgency: 'normal',
    subject: {
      toolId: toolRequest.toolId,
      expectedSideEffectLevel: toolRequest.expectedSideEffectLevel,
      purpose: toolRequest.purpose,
      input: toolRequest.input,
    },
    toolRequest,
    toolReadinessVerdict,
    riskAssessment: {
      sideEffectLevel: toolRequest.expectedSideEffectLevel,
      summary: `Human approval is required before executing ${toolRequest.toolId}.`,
      approvalReason: toolRequestResolution.reason,
      matchedResourceIds: summarizeMatchedResources(toolReadinessVerdict),
      warnings: toolRequestResolution.warnings,
    },
    warnings: [
      'No tool execution has been performed. This approval request only records the pending decision.',
    ],
  });
}

function createPendingHumanApprovalState({
  approvalRequest,
  requestedAt,
}) {
  return assertHumanApprovalState({
    kind: 'human_approval_state',
    version: 1,
    approvalRequestId: approvalRequest.approvalRequestId,
    status: 'pending',
    approvalRequest,
    executionAuthorized: false,
    executionBlocked: true,
    decidedAt: null,
    decidedBy: null,
    decisionReason: null,
    createdAt: requestedAt,
    updatedAt: requestedAt,
    warnings: [
      'Pending approval blocks execution until an explicit human decision is recorded.',
    ],
  });
}

function createApprovalRequiredToolResult({
  invocationId,
  operationalIdentityId,
  requestedBy,
  requestedAt,
  approvalRequest,
}) {
  return assertToolResult({
    kind: 'tool_result',
    version: 1,
    toolId: approvalRequest.subject.toolId,
    toolRunId: `tool-run-${approvalRequest.approvalRequestId}`,
    status: 'approval_required',
    summary: `Tool ${approvalRequest.subject.toolId} requires human approval before execution.`,
    data: {
      approvalRequestId: approvalRequest.approvalRequestId,
      toolRequestId: approvalRequest.toolRequest.toolRequestId,
      runtimeAction: 'request_human_approval',
      executionAuthorized: false,
      executionBlocked: true,
    },
    artifacts: [],
    warnings: [
      'No tool execution was performed because human approval is required.',
    ],
    errors: [],
    memoryWritebackCandidates: [],
    audit: {
      invocationId,
      operationalIdentityId,
      requestedBy,
      approvalRequestId: approvalRequest.approvalRequestId,
      startedAt: requestedAt,
      completedAt: requestedAt,
    },
  });
}

export function createHumanApprovalRuntimeForToolRequest({
  invocationId,
  operationalIdentityId,
  requestedBy,
  toolRequestResolution,
  requestedAt = new Date().toISOString(),
} = {}) {
  assertInput({
    invocationId,
    operationalIdentityId,
    requestedBy,
    requestedAt,
  });

  const normalizedToolRequestResolution = assertBrainToolRequestResolution(toolRequestResolution);

  if (normalizedToolRequestResolution.status !== 'approval_required') {
    return null;
  }

  const approvalRequestId = createApprovalRequestId({
    invocationId,
    toolRequestId: normalizedToolRequestResolution.toolRequest.toolRequestId,
  });
  const approvalRequest = createHumanApprovalRequest({
    invocationId,
    operationalIdentityId,
    requestedBy,
    requestedAt,
    approvalRequestId,
    toolRequestResolution: normalizedToolRequestResolution,
  });
  const approvalState = createPendingHumanApprovalState({
    approvalRequest,
    requestedAt,
  });
  const approvalRequiredToolResult = createApprovalRequiredToolResult({
    invocationId,
    operationalIdentityId,
    requestedBy,
    requestedAt,
    approvalRequest,
  });

  return {
    kind: 'human_approval_runtime',
    version: 1,
    approvalRequest,
    approvalState,
    approvalRequiredToolResult,
    executionAuthorized: false,
    executionBlocked: true,
  };
}
