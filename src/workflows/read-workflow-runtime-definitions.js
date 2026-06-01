import path from 'node:path';
import { readdir, readFile } from 'node:fs/promises';
import { resolveBoundedChildPath } from '../contracts/shared/bounded-path-contract.js';
import { assertWorkflowRuntimeDefinition } from '../contracts/workflows/workflow-runtime-contract.js';

const WORKFLOW_RUNTIME_FILE_NAME = 'runtime.json';
const WORKFLOWS_ROOT_PATH = 'workflows';
const SAFE_WORKFLOW_DIRECTORY_NAME_PATTERN = /^[a-zA-Z0-9._-]+$/u;

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function assertWorkflowDirectoryName(value, description) {
  if (!isNonEmptyString(value)) {
    throw new Error(`${description} must be a non-empty string.`);
  }

  const normalizedValue = value.trim();

  if (!SAFE_WORKFLOW_DIRECTORY_NAME_PATTERN.test(normalizedValue)) {
    throw new Error(`${description} contains unsafe characters: ${normalizedValue}`);
  }

  return normalizedValue;
}

function normalizeWorkflowRuntimeSourcePath({ workflowDirectoryName }) {
  return `instance/workflows/${workflowDirectoryName}/${WORKFLOW_RUNTIME_FILE_NAME}`;
}

async function readWorkflowRuntimeDirectory({
  workflowsRootPath,
  workflowDirectoryName,
}) {
  const normalizedWorkflowDirectoryName = assertWorkflowDirectoryName(
    workflowDirectoryName,
    `Workflow ${workflowDirectoryName} rootPath`,
  );
  const workflowRootPath = resolveBoundedChildPath({
    parentRootPath: workflowsRootPath,
    childRootPath: normalizedWorkflowDirectoryName,
    description: `Workflow ${normalizedWorkflowDirectoryName} rootPath`,
  });
  const runtimeDefinitionPath = path.join(workflowRootPath, WORKFLOW_RUNTIME_FILE_NAME);
  const rawDefinition = await readFile(runtimeDefinitionPath, 'utf8');
  const definition = assertWorkflowRuntimeDefinition(JSON.parse(rawDefinition));

  if (definition.workflowId !== normalizedWorkflowDirectoryName) {
    throw new Error(`Workflow runtime definition workflowId "${definition.workflowId}" must match its directory name "${normalizedWorkflowDirectoryName}".`);
  }

  return {
    ...definition,
    workflowRootPath,
    runtimeDefinitionPath,
    sourcePath: normalizeWorkflowRuntimeSourcePath({
      workflowDirectoryName: normalizedWorkflowDirectoryName,
    }),
  };
}

export async function readWorkflowRuntimeDefinition({
  masRootPath,
  workflowId,
} = {}) {
  if (!isNonEmptyString(masRootPath)) {
    throw new Error('Workflow runtime reader requires a non-empty masRootPath.');
  }

  const normalizedWorkflowId = assertWorkflowDirectoryName(workflowId, 'Workflow runtime reader workflowId');
  const workflowsRootPath = path.join(masRootPath, WORKFLOWS_ROOT_PATH);

  try {
    return {
      workflowRuntimeDefinition: await readWorkflowRuntimeDirectory({
        workflowsRootPath,
        workflowDirectoryName: normalizedWorkflowId,
      }),
      warnings: [],
    };
  } catch (error) {
    if (error.code === 'ENOENT') {
      return {
        workflowRuntimeDefinition: null,
        warnings: [`Workflow runtime definition does not exist: ${normalizeWorkflowRuntimeSourcePath({
          workflowDirectoryName: normalizedWorkflowId,
        })}`],
      };
    }

    throw error;
  }
}

export async function readWorkflowRuntimeDefinitions({
  masRootPath,
  includeInactive = false,
} = {}) {
  if (!isNonEmptyString(masRootPath)) {
    throw new Error('Workflow runtime reader requires a non-empty masRootPath.');
  }

  if (typeof includeInactive !== 'boolean') {
    throw new Error('Workflow runtime reader includeInactive must be a boolean when provided.');
  }

  const workflowsRootPath = path.join(masRootPath, WORKFLOWS_ROOT_PATH);
  const workflowRuntimeDefinitions = [];
  const warnings = [];
  let directoryEntries;

  try {
    directoryEntries = await readdir(workflowsRootPath, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') {
      return {
        workflowsRootPath,
        workflowRuntimeDefinitions,
        warnings: [`Workflow rootPath does not exist: ${WORKFLOWS_ROOT_PATH}`],
      };
    }

    throw error;
  }

  for (const directoryEntry of directoryEntries.toSorted((left, right) => left.name.localeCompare(right.name))) {
    if (!directoryEntry.isDirectory()) {
      warnings.push(`Workflow runtime reader skipped non-directory entry: ${directoryEntry.name}`);
      continue;
    }

    try {
      const workflowRuntimeDefinition = await readWorkflowRuntimeDirectory({
        workflowsRootPath,
        workflowDirectoryName: directoryEntry.name,
      });

      if (includeInactive || workflowRuntimeDefinition.lifecycleState === 'active') {
        workflowRuntimeDefinitions.push(workflowRuntimeDefinition);
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        warnings.push(`Workflow runtime reader skipped ${directoryEntry.name}: ${error.message}`);
      }
    }
  }

  return {
    workflowsRootPath,
    workflowRuntimeDefinitions: workflowRuntimeDefinitions.toSorted((left, right) => {
      return left.workflowId.localeCompare(right.workflowId);
    }),
    warnings,
  };
}

export {
  WORKFLOW_RUNTIME_FILE_NAME,
  WORKFLOWS_ROOT_PATH,
};
