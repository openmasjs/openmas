import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { assertHumanApprovalRequest } from '../contracts/approvals/human-approval-request-contract.js';
import { assertHumanApprovalState } from '../contracts/approvals/human-approval-state-contract.js';

const SAFE_APPROVAL_ID_PATTERN = /^[a-zA-Z0-9._-]+$/u;

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function assertSafeApprovalRequestId(value) {
  if (!isNonEmptyString(value)) {
    throw new Error('Human approval state read requires a non-empty approvalRequestId.');
  }

  const normalizedValue = value.trim();

  if (!SAFE_APPROVAL_ID_PATTERN.test(normalizedValue)) {
    throw new Error(`Human approval state read approvalRequestId contains unsafe characters: ${normalizedValue}`);
  }

  return normalizedValue;
}

function assertMasRootPath(masRootPath) {
  if (!isNonEmptyString(masRootPath)) {
    throw new Error('Human approval state read requires a non-empty masRootPath.');
  }

  return masRootPath.trim();
}

async function readJsonFile(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

export async function readHumanApprovalState({
  masRootPath,
  approvalRequestId,
} = {}) {
  const normalizedMasRootPath = assertMasRootPath(masRootPath);
  const normalizedApprovalRequestId = assertSafeApprovalRequestId(approvalRequestId);
  const stateDirectoryPath = path.join(normalizedMasRootPath, 'memory', 'state');
  const approvalRequestRecordPath = path.join(
    stateDirectoryPath,
    `human-approval-request-${normalizedApprovalRequestId}.json`,
  );
  const approvalStateRecordPath = path.join(
    stateDirectoryPath,
    `human-approval-state-${normalizedApprovalRequestId}.json`,
  );
  const approvalRequest = assertHumanApprovalRequest(await readJsonFile(approvalRequestRecordPath));
  const approvalState = assertHumanApprovalState(await readJsonFile(approvalStateRecordPath));

  if (approvalRequest.approvalRequestId !== approvalState.approvalRequestId) {
    throw new Error('Human approval request and state records must share the same approvalRequestId.');
  }

  return {
    kind: 'human_approval_state_read',
    version: 1,
    approvalRequest,
    approvalState,
    approvalRequestRecordPath,
    approvalStateRecordPath,
  };
}
