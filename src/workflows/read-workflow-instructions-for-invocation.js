import path from 'node:path';
import { readdir, readFile } from 'node:fs/promises';
import { resolveBoundedChildPath } from '../contracts/shared/bounded-path-contract.js';
import { assertWorkflowInstructionDefinition } from '../contracts/workflows/workflow-instruction-contract.js';

const WORKFLOW_DEFINITION_FILE_NAME = 'workflow.json';
const WORKFLOW_INSTRUCTIONS_FILE_NAME = 'workflow.md';

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeWorkflowSourcePath({ workflowDirectoryName, fileName }) {
  return `instance/workflows/${workflowDirectoryName}/${fileName}`;
}

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => {
    return isNonEmptyString(value);
  }).map((value) => value.trim()))];
}

function resolveActiveCognitiveIdentityIds(readiness) {
  return uniqueStrings([
    readiness?.activeCognitiveSet?.primaryCognitiveIdentityId,
    ...(readiness?.activeCognitiveSet?.secondaryCognitiveIdentityIds ?? []),
  ]);
}

function resolveOperationalIdentityId(readiness) {
  return readiness?.operationalIdentityDefinition?.operationalIdentityId
    ?? readiness?.resolvedOperationalIdentity?.operationalIdentityId
    ?? null;
}

function hasIntersection(leftValues, rightValues) {
  const rightValueSet = new Set(rightValues);

  return leftValues.some((value) => rightValueSet.has(value));
}

function matchesInvocation({ definition, request, readiness }) {
  if (definition.lifecycleState !== 'active') {
    return false;
  }

  if (!definition.commandTriggers.includes(request?.command)) {
    return false;
  }

  const operationalIdentityId = resolveOperationalIdentityId(readiness);

  if (
    definition.operationalIdentityIds.length > 0
    && (!operationalIdentityId || !definition.operationalIdentityIds.includes(operationalIdentityId))
  ) {
    return false;
  }

  const activeCognitiveIdentityIds = resolveActiveCognitiveIdentityIds(readiness);

  if (
    definition.cognitiveIdentityIds.length > 0
    && !hasIntersection(definition.cognitiveIdentityIds, activeCognitiveIdentityIds)
  ) {
    return false;
  }

  return true;
}

async function readWorkflowDirectory({
  workflowsRootPath,
  workflowDirectoryName,
  request,
  readiness,
}) {
  const workflowRootPath = resolveBoundedChildPath({
    parentRootPath: workflowsRootPath,
    childRootPath: workflowDirectoryName,
    description: `Workflow ${workflowDirectoryName} rootPath`,
  });
  const definitionPath = path.join(workflowRootPath, WORKFLOW_DEFINITION_FILE_NAME);
  const instructionsPath = path.join(workflowRootPath, WORKFLOW_INSTRUCTIONS_FILE_NAME);
  const rawDefinition = await readFile(definitionPath, 'utf8');
  const definition = assertWorkflowInstructionDefinition(JSON.parse(rawDefinition));

  if (!matchesInvocation({ definition, request, readiness })) {
    return null;
  }

  const instructionText = (await readFile(instructionsPath, 'utf8')).trim();

  if (!instructionText) {
    throw new Error(`${WORKFLOW_INSTRUCTIONS_FILE_NAME} must contain non-empty workflow guidance.`);
  }

  return {
    ...definition,
    instructionText,
    sourcePaths: {
      definition: normalizeWorkflowSourcePath({
        workflowDirectoryName,
        fileName: WORKFLOW_DEFINITION_FILE_NAME,
      }),
      instructions: normalizeWorkflowSourcePath({
        workflowDirectoryName,
        fileName: WORKFLOW_INSTRUCTIONS_FILE_NAME,
      }),
    },
  };
}

export async function readWorkflowInstructionsForInvocation({
  masRootPath,
  request,
  readiness,
} = {}) {
  if (!isNonEmptyString(masRootPath)) {
    throw new Error('Workflow instruction reader requires a non-empty masRootPath.');
  }

  const workflowsRootPath = path.join(masRootPath, 'workflows');
  const workflowContexts = [];
  const warnings = [];
  let directoryEntries;

  try {
    directoryEntries = await readdir(workflowsRootPath, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') {
      return {
        workflowContexts,
        warnings: [`Workflow rootPath does not exist: workflows`],
      };
    }

    throw error;
  }

  for (const directoryEntry of directoryEntries.toSorted((left, right) => left.name.localeCompare(right.name))) {
    if (!directoryEntry.isDirectory()) {
      warnings.push(`Workflow instruction reader skipped non-directory entry: ${directoryEntry.name}`);
      continue;
    }

    try {
      const workflowContext = await readWorkflowDirectory({
        workflowsRootPath,
        workflowDirectoryName: directoryEntry.name,
        request,
        readiness,
      });

      if (workflowContext) {
        workflowContexts.push(workflowContext);
      }
    } catch (error) {
      warnings.push(`Workflow instruction reader skipped ${directoryEntry.name}: ${error.message}`);
    }
  }

  return {
    workflowContexts: workflowContexts.toSorted((left, right) => {
      return left.workflowId.localeCompare(right.workflowId);
    }),
    warnings,
  };
}

export {
  WORKFLOW_DEFINITION_FILE_NAME,
  WORKFLOW_INSTRUCTIONS_FILE_NAME,
};
