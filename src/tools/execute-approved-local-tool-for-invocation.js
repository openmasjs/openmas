import crypto from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { assertToolDefinition } from '../contracts/tools/tool-definition-contract.js';
import { assertToolReadinessVerdict } from '../contracts/tools/tool-readiness-contract.js';
import { assertToolResult } from '../contracts/tools/tool-result-contract.js';
import { resolveBoundedChildPath } from '../contracts/shared/bounded-path-contract.js';

const APPROVED_LOCAL_TOOL_SIDE_EFFECT_LEVELS = new Set([
  'write_internal',
  'write_external',
  'publish_external',
  'financial',
]);

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
  approvalRequestId,
  input,
}) {
  if (!isNonEmptyString(masRootPath)) {
    throw new Error('Approved local tool execution requires a non-empty masRootPath.');
  }

  if (!isNonEmptyString(invocationId)) {
    throw new Error('Approved local tool execution requires a non-empty invocationId.');
  }

  if (!isNonEmptyString(operationalIdentityId)) {
    throw new Error('Approved local tool execution requires a non-empty operationalIdentityId.');
  }

  if (!isNonEmptyString(requestedBy)) {
    throw new Error('Approved local tool execution requires a non-empty requestedBy.');
  }

  if (!isNonEmptyString(approvalRequestId)) {
    throw new Error('Approved local tool execution requires a non-empty approvalRequestId.');
  }

  if (!isPlainObject(input)) {
    throw new Error('Approved local tool execution input must be an object.');
  }
}

function assertApprovedExecutableTool({ toolDefinition, readinessVerdict }) {
  if (toolDefinition.lifecycleState !== 'active') {
    throw new Error(`Tool ${toolDefinition.toolId} cannot execute because lifecycleState is not active: ${toolDefinition.lifecycleState}.`);
  }

  if (toolDefinition.toolType !== 'local_js_module') {
    throw new Error(`Tool ${toolDefinition.toolId} cannot execute through the approved local runner because toolType is ${toolDefinition.toolType}.`);
  }

  if (!APPROVED_LOCAL_TOOL_SIDE_EFFECT_LEVELS.has(toolDefinition.sideEffectLevel)) {
    throw new Error(`Tool ${toolDefinition.toolId} cannot execute through the approved local runner because sideEffectLevel is ${toolDefinition.sideEffectLevel}.`);
  }

  if (toolDefinition.approvalPolicy.required !== true) {
    throw new Error(`Tool ${toolDefinition.toolId} cannot execute through the approved local runner without an explicit approval policy.`);
  }

  if (readinessVerdict.toolId !== toolDefinition.toolId) {
    throw new Error(`Tool readiness verdict toolId "${readinessVerdict.toolId}" does not match tool definition "${toolDefinition.toolId}".`);
  }

  if (readinessVerdict.status !== 'approval_required' || readinessVerdict.approvalRequired !== true) {
    throw new Error(`Tool ${toolDefinition.toolId} cannot execute through the approved local runner because readiness status is ${readinessVerdict.status}.`);
  }
}

function createAudit({
  invocationId,
  operationalIdentityId,
  requestedBy,
  approvalRequestId,
  startedAt,
  completedAt,
}) {
  return {
    invocationId,
    operationalIdentityId,
    requestedBy,
    approvalRequestId,
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
    summary: `Tool ${toolDefinition.toolId} failed during approved local execution.`,
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
  toolRunId,
}) {
  const executorPath = resolveBoundedChildPath({
    parentRootPath: toolRootPath,
    childRootPath: modulePath,
    description: `Tool ${toolId} executor modulePath`,
  });
  const executorUrl = pathToFileURL(executorPath);
  executorUrl.search = `run=${encodeURIComponent(toolRunId)}`;
  const executorModule = await import(executorUrl.href);

  if (typeof executorModule.executeTool !== 'function') {
    throw new Error(`Tool ${toolId} executor module must export executeTool.`);
  }

  return executorModule.executeTool;
}

export async function executeApprovedLocalToolForInvocation({
  masRootPath,
  toolDefinition,
  readinessVerdict,
  input = {},
  invocationId,
  operationalIdentityId,
  requestedBy,
  approvalRequestId,
} = {}) {
  assertExecutionInput({
    masRootPath,
    invocationId,
    operationalIdentityId,
    requestedBy,
    approvalRequestId,
    input,
  });

  const normalizedToolDefinition = assertToolDefinition(toolDefinition);
  const normalizedReadinessVerdict = assertToolReadinessVerdict(readinessVerdict);

  assertApprovedExecutableTool({
    toolDefinition: normalizedToolDefinition,
    readinessVerdict: normalizedReadinessVerdict,
  });

  const startedAt = new Date().toISOString();
  const toolRunId = `tool-run-${crypto.randomUUID()}`;
  const auditBase = {
    invocationId,
    operationalIdentityId,
    requestedBy,
    approvalRequestId,
    startedAt,
  };
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
      toolRunId,
    });
    const outcome = await executeTool({
      input,
      masRootPath,
      toolRootPath,
      toolDefinition: normalizedToolDefinition,
      readinessVerdict: normalizedReadinessVerdict,
      toolRunId,
      invocationId,
      operationalIdentityId,
      requestedBy,
      approvalRequestId,
    });
    const completedAt = new Date().toISOString();

    return normalizeExecutorOutcome({
      outcome,
      toolDefinition: normalizedToolDefinition,
      toolRunId,
      audit: createAudit({
        ...auditBase,
        completedAt,
      }),
    });
  } catch (error) {
    const completedAt = new Date().toISOString();

    return buildFailedToolResult({
      toolDefinition: normalizedToolDefinition,
      toolRunId,
      audit: createAudit({
        ...auditBase,
        completedAt,
      }),
      error,
    });
  }
}
