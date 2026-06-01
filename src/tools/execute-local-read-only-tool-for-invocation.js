import crypto from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { assertToolDefinition } from '../contracts/tools/tool-definition-contract.js';
import { assertToolReadinessVerdict } from '../contracts/tools/tool-readiness-contract.js';
import { assertToolResult } from '../contracts/tools/tool-result-contract.js';
import { resolveBoundedChildPath } from '../contracts/shared/bounded-path-contract.js';

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function assertExecutionInput({
  masRootPath,
  invocationId,
  operationalIdentityId,
  requestedBy,
  input,
}) {
  if (!isNonEmptyString(masRootPath)) {
    throw new Error('Local read-only tool execution requires a non-empty masRootPath.');
  }

  if (!isNonEmptyString(invocationId)) {
    throw new Error('Local read-only tool execution requires a non-empty invocationId.');
  }

  if (!isNonEmptyString(operationalIdentityId)) {
    throw new Error('Local read-only tool execution requires a non-empty operationalIdentityId.');
  }

  if (!isNonEmptyString(requestedBy)) {
    throw new Error('Local read-only tool execution requires a non-empty requestedBy.');
  }

  if (!isPlainObject(input)) {
    throw new Error('Local read-only tool execution input must be an object.');
  }
}

function assertExecutableTool({ toolDefinition, readinessVerdict }) {
  if (toolDefinition.lifecycleState !== 'active') {
    throw new Error(`Tool ${toolDefinition.toolId} cannot execute because lifecycleState is not active: ${toolDefinition.lifecycleState}.`);
  }

  if (toolDefinition.toolType !== 'local_js_module') {
    throw new Error(`Tool ${toolDefinition.toolId} cannot execute through the local read-only runner because toolType is ${toolDefinition.toolType}.`);
  }

  if (toolDefinition.sideEffectLevel !== 'read_only') {
    throw new Error(`Tool ${toolDefinition.toolId} cannot execute through the local read-only runner because sideEffectLevel is ${toolDefinition.sideEffectLevel}.`);
  }

  if (readinessVerdict.toolId !== toolDefinition.toolId) {
    throw new Error(`Tool readiness verdict toolId "${readinessVerdict.toolId}" does not match tool definition "${toolDefinition.toolId}".`);
  }

  if (readinessVerdict.status !== 'ready') {
    throw new Error(`Tool ${toolDefinition.toolId} cannot execute because readiness status is ${readinessVerdict.status}.`);
  }
}

function createAudit({
  invocationId,
  operationalIdentityId,
  requestedBy,
  startedAt,
  completedAt,
}) {
  return {
    invocationId,
    operationalIdentityId,
    requestedBy,
    startedAt,
    completedAt,
  };
}

function normalizeExecutorOutcome({
  outcome,
  toolDefinition,
  toolRunId,
  audit,
}) {
  if (!isPlainObject(outcome)) {
    throw new Error(`Tool executor for ${toolDefinition.toolId} must return an object.`);
  }

  return assertToolResult({
    kind: 'tool_result',
    version: 1,
    toolId: toolDefinition.toolId,
    toolRunId,
    status: outcome.status ?? 'succeeded',
    summary: outcome.summary,
    data: outcome.data ?? {},
    artifacts: outcome.artifacts ?? [],
    warnings: outcome.warnings ?? [],
    errors: outcome.errors ?? [],
    memoryWritebackCandidates: outcome.memoryWritebackCandidates ?? [],
    audit,
  });
}

function buildFailedToolResult({
  toolDefinition,
  toolRunId,
  audit,
  error,
}) {
  return assertToolResult({
    kind: 'tool_result',
    version: 1,
    toolId: toolDefinition.toolId,
    toolRunId,
    status: 'failed',
    summary: `Tool ${toolDefinition.toolId} failed during local read-only execution.`,
    data: {},
    artifacts: [],
    warnings: [],
    errors: [error.message],
    memoryWritebackCandidates: [],
    audit,
  });
}

async function loadToolExecutor({
  toolRootPath,
  modulePath,
  toolId,
}) {
  const executorPath = resolveBoundedChildPath({
    parentRootPath: toolRootPath,
    childRootPath: modulePath,
    description: `Tool ${toolId} executor modulePath`,
  });
  const executorModule = await import(pathToFileURL(executorPath));

  if (typeof executorModule.executeTool !== 'function') {
    throw new Error(`Tool ${toolId} executor module must export executeTool.`);
  }

  return executorModule.executeTool;
}

export async function executeLocalReadOnlyToolForInvocation({
  masRootPath,
  toolDefinition,
  readinessVerdict,
  input = {},
  invocationId,
  operationalIdentityId,
  requestedBy,
} = {}) {
  assertExecutionInput({
    masRootPath,
    invocationId,
    operationalIdentityId,
    requestedBy,
    input,
  });

  const normalizedToolDefinition = assertToolDefinition(toolDefinition);
  const normalizedReadinessVerdict = assertToolReadinessVerdict(readinessVerdict);

  assertExecutableTool({
    toolDefinition: normalizedToolDefinition,
    readinessVerdict: normalizedReadinessVerdict,
  });

  const startedAt = new Date().toISOString();
  const toolRunId = `tool-run-${crypto.randomUUID()}`;
  const toolRootPath = resolveBoundedChildPath({
    parentRootPath: path.join(masRootPath, 'tools'),
    childRootPath: normalizedToolDefinition.toolId,
    description: `Tool ${normalizedToolDefinition.toolId} rootPath`,
  });

  try {
    const executeTool = await loadToolExecutor({
      toolRootPath,
      modulePath: normalizedToolDefinition.execution.modulePath,
      toolId: normalizedToolDefinition.toolId,
    });
    const outcome = await executeTool({
      input,
      masRootPath,
      projectRootPath: path.dirname(path.resolve(masRootPath)),
      toolRootPath,
      toolDefinition: normalizedToolDefinition,
      readinessVerdict: normalizedReadinessVerdict,
      toolRunId,
      invocationId,
      operationalIdentityId,
      requestedBy,
    });
    const completedAt = new Date().toISOString();

    return normalizeExecutorOutcome({
      outcome,
      toolDefinition: normalizedToolDefinition,
      toolRunId,
      audit: createAudit({
        invocationId,
        operationalIdentityId,
        requestedBy,
        startedAt,
        completedAt,
      }),
    });
  } catch (error) {
    const completedAt = new Date().toISOString();

    return buildFailedToolResult({
      toolDefinition: normalizedToolDefinition,
      toolRunId,
      audit: createAudit({
        invocationId,
        operationalIdentityId,
        requestedBy,
        startedAt,
        completedAt,
      }),
      error,
    });
  }
}
