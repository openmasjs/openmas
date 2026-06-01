import path from 'node:path';
import { assertHumanApprovalRequest } from '../contracts/approvals/human-approval-request-contract.js';
import { assertHumanApprovalState } from '../contracts/approvals/human-approval-state-contract.js';
import { ensureDirectory } from '../persistence/ensure-directory.js';
import { writeJsonFile } from '../persistence/write-json-file.js';

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function assertInput({
  masRootPath,
  approvalRuntime,
}) {
  if (!isNonEmptyString(masRootPath)) {
    throw new Error('Human approval runtime persistence requires a non-empty masRootPath.');
  }

  if (!approvalRuntime || typeof approvalRuntime !== 'object' || Array.isArray(approvalRuntime)) {
    throw new Error('Human approval runtime persistence requires an approvalRuntime object.');
  }
}

export async function writeHumanApprovalRuntimeArtifacts({
  masRootPath,
  approvalRuntime,
} = {}) {
  if (!approvalRuntime) {
    return null;
  }

  assertInput({
    masRootPath,
    approvalRuntime,
  });

  const approvalRequest = assertHumanApprovalRequest(approvalRuntime.approvalRequest);
  const approvalState = assertHumanApprovalState(approvalRuntime.approvalState);
  const stateDirectoryPath = path.join(masRootPath, 'memory', 'state');
  const approvalRequestRecordPath = path.join(
    stateDirectoryPath,
    `human-approval-request-${approvalRequest.approvalRequestId}.json`,
  );
  const approvalStateRecordPath = path.join(
    stateDirectoryPath,
    `human-approval-state-${approvalState.approvalRequestId}.json`,
  );

  await ensureDirectory(stateDirectoryPath);
  await writeJsonFile(approvalRequestRecordPath, approvalRequest);
  await writeJsonFile(approvalStateRecordPath, approvalState);

  return {
    targetType: 'mas-memory',
    approvalRequestRecordPath,
    approvalStateRecordPath,
  };
}
