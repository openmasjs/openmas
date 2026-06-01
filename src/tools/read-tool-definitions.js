import path from 'node:path';
import { readdir, readFile } from 'node:fs/promises';
import { resolveBoundedChildPath } from '../contracts/shared/bounded-path-contract.js';
import { assertToolDefinition } from '../contracts/tools/tool-definition-contract.js';

const TOOL_ROOT_PATH = 'tools';
const TOOL_DEFINITION_FILE_NAME = 'tool.json';

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeToolSourcePath({ toolDirectoryName }) {
  return `instance/tools/${toolDirectoryName}/${TOOL_DEFINITION_FILE_NAME}`;
}

async function readToolDirectory({
  toolsRootPath,
  toolDirectoryName,
}) {
  const toolRootPath = resolveBoundedChildPath({
    parentRootPath: toolsRootPath,
    childRootPath: toolDirectoryName,
    description: `Tool ${toolDirectoryName} rootPath`,
  });
  const toolDefinitionPath = path.join(toolRootPath, TOOL_DEFINITION_FILE_NAME);
  const rawDefinition = await readFile(toolDefinitionPath, 'utf8');
  const definition = assertToolDefinition(JSON.parse(rawDefinition));

  if (definition.toolId !== toolDirectoryName) {
    throw new Error(`Tool definition toolId "${definition.toolId}" must match its directory name "${toolDirectoryName}".`);
  }

  return {
    ...definition,
    sourcePath: normalizeToolSourcePath({
      toolDirectoryName,
    }),
  };
}

export async function readToolDefinitions({
  masRootPath,
  includeInactive = false,
} = {}) {
  if (!isNonEmptyString(masRootPath)) {
    throw new Error('Tool definition reader requires a non-empty masRootPath.');
  }

  if (typeof includeInactive !== 'boolean') {
    throw new Error('Tool definition reader includeInactive must be a boolean when provided.');
  }

  const toolsRootPath = path.join(masRootPath, TOOL_ROOT_PATH);
  const toolDefinitions = [];
  const warnings = [];
  let directoryEntries;

  try {
    directoryEntries = await readdir(toolsRootPath, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') {
      return {
        toolsRootPath,
        toolDefinitions,
        warnings: [`Tool rootPath does not exist: ${TOOL_ROOT_PATH}`],
      };
    }

    throw error;
  }

  for (const directoryEntry of directoryEntries.toSorted((left, right) => left.name.localeCompare(right.name))) {
    if (!directoryEntry.isDirectory()) {
      warnings.push(`Tool definition reader skipped non-directory entry: ${directoryEntry.name}`);
      continue;
    }

    try {
      const toolDefinition = await readToolDirectory({
        toolsRootPath,
        toolDirectoryName: directoryEntry.name,
      });

      if (includeInactive || toolDefinition.lifecycleState === 'active') {
        toolDefinitions.push(toolDefinition);
      }
    } catch (error) {
      warnings.push(`Tool definition reader skipped ${directoryEntry.name}: ${error.message}`);
    }
  }

  return {
    toolsRootPath,
    toolDefinitions: toolDefinitions.toSorted((left, right) => {
      return left.toolId.localeCompare(right.toolId);
    }),
    warnings,
  };
}

export {
  TOOL_DEFINITION_FILE_NAME,
  TOOL_ROOT_PATH,
};
