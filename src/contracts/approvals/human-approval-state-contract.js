import { assertHumanApprovalRequest } from './human-approval-request-contract.js';

const HUMAN_APPROVAL_STATUSES = new Set([
  'pending',
  'approved',
  'denied',
  'rejected',
  'cancelled',
  'expired',
  'consumed',
]);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function assertEnumValue(value, allowedValues, description) {
  if (!isNonEmptyString(value)) {
    throw new Error(`${description} must be a non-empty string.`);
  }

  const normalizedValue = value.trim();

  if (!allowedValues.has(normalizedValue)) {
    throw new Error(`${description} is invalid: ${normalizedValue}`);
  }

  return normalizedValue;
}

function assertStringArray(values, description) {
  if (!Array.isArray(values)) {
    throw new Error(`${description} must be an array.`);
  }

  return values.map((value, index) => {
    if (!isNonEmptyString(value)) {
      throw new Error(`${description}[${index}] must be a non-empty string.`);
    }

    return value.trim();
  });
}

function assertNullableString(value, description) {
  if (value === undefined || value === null) {
    return null;
  }

  if (!isNonEmptyString(value)) {
    throw new Error(`${description} must be a non-empty string when provided.`);
  }

  return value.trim();
}

function assertStateConsistency(state) {
  if (state.status === 'pending') {
    if (state.decidedAt !== null || state.decidedBy !== null || state.decisionReason !== null) {
      throw new Error('Pending human approval state must not include decision metadata.');
    }

    if (state.consumedAt !== null || state.consumedByToolRunId !== null) {
      throw new Error('Pending human approval state must not include consumption metadata.');
    }

    if (state.executionAuthorized || !state.executionBlocked) {
      throw new Error('Pending human approval state must block execution and must not authorize execution.');
    }
  }

  if (state.status === 'approved') {
    if (state.decidedAt === null || state.decidedBy === null) {
      throw new Error('Approved human approval state must include decidedAt and decidedBy.');
    }

    if (!state.executionAuthorized || state.executionBlocked) {
      throw new Error('Approved human approval state must authorize execution and must not block execution.');
    }

    if (state.consumedAt !== null || state.consumedByToolRunId !== null) {
      throw new Error('Approved human approval state must not include consumption metadata.');
    }
  }

  if (state.status === 'denied' || state.status === 'rejected' || state.status === 'cancelled') {
    if (state.decidedAt === null || state.decidedBy === null) {
      throw new Error(`Human approval state with status "${state.status}" must include decidedAt and decidedBy.`);
    }

    if (state.executionAuthorized || !state.executionBlocked) {
      throw new Error(`Human approval state with status "${state.status}" must block execution.`);
    }

    if (state.consumedAt !== null || state.consumedByToolRunId !== null) {
      throw new Error(`Human approval state with status "${state.status}" must not include consumption metadata.`);
    }
  }

  if (state.status === 'expired') {
    if (state.decidedAt === null) {
      throw new Error('Expired human approval state must include decidedAt.');
    }

    if (state.executionAuthorized || !state.executionBlocked) {
      throw new Error('Expired human approval state must block execution.');
    }

    if (state.consumedAt !== null || state.consumedByToolRunId !== null) {
      throw new Error('Expired human approval state must not include consumption metadata.');
    }
  }

  if (state.status === 'consumed') {
    if (state.decidedAt === null || state.decidedBy === null) {
      throw new Error('Consumed human approval state must preserve decidedAt and decidedBy.');
    }

    if (state.consumedAt === null || state.consumedByToolRunId === null) {
      throw new Error('Consumed human approval state must include consumedAt and consumedByToolRunId.');
    }

    if (state.executionAuthorized || !state.executionBlocked) {
      throw new Error('Consumed human approval state must block execution and must not authorize execution.');
    }
  }
}

export function assertHumanApprovalState(state) {
  if (!isPlainObject(state)) {
    throw new Error('Human approval state must be an object.');
  }

  if (state.kind !== 'human_approval_state') {
    throw new Error('Human approval state must include kind "human_approval_state".');
  }

  if (state.version !== 1) {
    throw new Error('Human approval state version must be 1.');
  }

  if (!isNonEmptyString(state.approvalRequestId)) {
    throw new Error('Human approval state must include a non-empty approvalRequestId.');
  }

  if (!isNonEmptyString(state.createdAt)) {
    throw new Error('Human approval state must include a non-empty createdAt.');
  }

  if (!isNonEmptyString(state.updatedAt)) {
    throw new Error('Human approval state must include a non-empty updatedAt.');
  }

  if (typeof state.executionAuthorized !== 'boolean') {
    throw new Error('Human approval state executionAuthorized must be a boolean.');
  }

  if (typeof state.executionBlocked !== 'boolean') {
    throw new Error('Human approval state executionBlocked must be a boolean.');
  }

  const approvalRequest = assertHumanApprovalRequest(state.approvalRequest);
  const normalizedState = {
    kind: 'human_approval_state',
    version: 1,
    approvalRequestId: state.approvalRequestId.trim(),
    approvalType: approvalRequest.approvalType,
    status: assertEnumValue(state.status, HUMAN_APPROVAL_STATUSES, 'Human approval state status'),
    invocationId: approvalRequest.invocationId,
    operationalIdentityId: approvalRequest.operationalIdentityId,
    approvalRequest,
    executionAuthorized: state.executionAuthorized,
    executionBlocked: state.executionBlocked,
    decidedAt: assertNullableString(state.decidedAt, 'Human approval state decidedAt'),
    decidedBy: assertNullableString(state.decidedBy, 'Human approval state decidedBy'),
    decisionReason: assertNullableString(state.decisionReason, 'Human approval state decisionReason'),
    consumedAt: assertNullableString(state.consumedAt, 'Human approval state consumedAt'),
    consumedByToolRunId: assertNullableString(
      state.consumedByToolRunId,
      'Human approval state consumedByToolRunId',
    ),
    createdAt: state.createdAt.trim(),
    updatedAt: state.updatedAt.trim(),
    warnings: assertStringArray(state.warnings ?? [], 'Human approval state warnings'),
  };

  if (normalizedState.approvalRequestId !== approvalRequest.approvalRequestId) {
    throw new Error('Human approval state approvalRequestId must match approvalRequest.approvalRequestId.');
  }

  assertStateConsistency(normalizedState);

  return normalizedState;
}

export {
  HUMAN_APPROVAL_STATUSES,
};
