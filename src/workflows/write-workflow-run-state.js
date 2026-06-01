import path from 'node:path';
import { assertWorkflowRunState } from '../contracts/workflows/workflow-run-state-contract.js';
import { ensureDirectory } from '../persistence/ensure-directory.js';
import { writeJsonFile } from '../persistence/write-json-file.js';

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function assertMasRootPath(masRootPath) {
  if (!isNonEmptyString(masRootPath)) {
    throw new Error('Workflow run state persistence requires a non-empty masRootPath.');
  }

  return masRootPath.trim();
}

export async function writeWorkflowRunState({
  masRootPath,
  workflowRunState,
} = {}) {
  const normalizedMasRootPath = assertMasRootPath(masRootPath);
  const normalizedState = assertWorkflowRunState(workflowRunState);
  const workflowStateDirectoryPath = path.join(normalizedMasRootPath, 'memory', 'state', 'workflows');
  const workflowRunStateRecordPath = path.join(
    workflowStateDirectoryPath,
    `${normalizedState.workflowRunId}.json`,
  );

  await ensureDirectory(workflowStateDirectoryPath);
  await writeJsonFile(workflowRunStateRecordPath, normalizedState);

  return {
    targetType: 'mas-memory',
    workflowRunId: normalizedState.workflowRunId,
    workflowId: normalizedState.workflowId,
    workflowRunStateRecordPath,
    relativePath: `memory/state/workflows/${normalizedState.workflowRunId}.json`,
  };
}
