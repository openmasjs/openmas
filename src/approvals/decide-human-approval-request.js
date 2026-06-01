import { assertHumanApprovalState } from '../contracts/approvals/human-approval-state-contract.js';
import { writeJsonFile } from '../persistence/write-json-file.js';
import { readHumanApprovalState } from './read-human-approval-state.js';

const HUMAN_APPROVAL_DECISIONS = new Set([
  'approve',
  'deny',
  'expire',
]);

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function assertNonEmptyString(value, description) {
  if (!isNonEmptyString(value)) {
    throw new Error(`${description} must be a non-empty string.`);
  }

  return value.trim();
}

function assertDecision(value) {
  const normalizedValue = assertNonEmptyString(value, 'Human approval decision');

  if (!HUMAN_APPROVAL_DECISIONS.has(normalizedValue)) {
    throw new Error(`Human approval decision is invalid: ${normalizedValue}`);
  }

  return normalizedValue;
}

function resolveDecisionState({
  decision,
  currentState,
  decidedAt,
  decidedBy,
  decisionReason,
}) {
  if (decision === 'approve') {
    return {
      ...currentState,
      status: 'approved',
      executionAuthorized: true,
      executionBlocked: false,
      decidedAt,
      decidedBy,
      decisionReason,
      consumedAt: null,
      consumedByToolRunId: null,
      updatedAt: decidedAt,
      warnings: [
        ...currentState.warnings,
        'Human approval has authorized exactly one matching tool execution attempt.',
      ],
    };
  }

  if (decision === 'deny') {
    return {
      ...currentState,
      status: 'denied',
      executionAuthorized: false,
      executionBlocked: true,
      decidedAt,
      decidedBy,
      decisionReason,
      consumedAt: null,
      consumedByToolRunId: null,
      updatedAt: decidedAt,
      warnings: [
        ...currentState.warnings,
        'Human approval was denied. No tool execution is authorized.',
      ],
    };
  }

  return {
    ...currentState,
    status: 'expired',
    executionAuthorized: false,
    executionBlocked: true,
    decidedAt,
    decidedBy,
    decisionReason,
    consumedAt: null,
    consumedByToolRunId: null,
    updatedAt: decidedAt,
    warnings: [
      ...currentState.warnings,
      'Human approval request expired. No tool execution is authorized.',
    ],
  };
}

export async function decideHumanApprovalRequest({
  masRootPath,
  approvalRequestId,
  decision,
  decidedBy,
  decisionReason = null,
  decidedAt = new Date().toISOString(),
} = {}) {
  const normalizedDecision = assertDecision(decision);
  const normalizedDecidedBy = assertNonEmptyString(decidedBy, 'Human approval decidedBy');
  const normalizedDecidedAt = assertNonEmptyString(decidedAt, 'Human approval decidedAt');
  const normalizedDecisionReason = isNonEmptyString(decisionReason) ? decisionReason.trim() : null;
  const stateRead = await readHumanApprovalState({
    masRootPath,
    approvalRequestId,
  });

  if (stateRead.approvalState.status !== 'pending') {
    throw new Error(
      `Human approval request ${stateRead.approvalState.approvalRequestId} cannot be decided because status is ${stateRead.approvalState.status}.`,
    );
  }

  const approvalState = assertHumanApprovalState(resolveDecisionState({
    decision: normalizedDecision,
    currentState: stateRead.approvalState,
    decidedAt: normalizedDecidedAt,
    decidedBy: normalizedDecidedBy,
    decisionReason: normalizedDecisionReason,
  }));

  await writeJsonFile(stateRead.approvalStateRecordPath, approvalState);

  return {
    kind: 'human_approval_decision_result',
    version: 1,
    approvalRequestId: approvalState.approvalRequestId,
    decision: normalizedDecision,
    status: approvalState.status,
    executionAuthorized: approvalState.executionAuthorized,
    executionBlocked: approvalState.executionBlocked,
    approvalState,
    approvalStateRecordPath: stateRead.approvalStateRecordPath,
  };
}

export {
  HUMAN_APPROVAL_DECISIONS,
};
