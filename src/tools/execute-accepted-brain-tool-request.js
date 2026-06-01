import { assertBrainToolRequestResolution } from '../contracts/brain/brain-tool-request-contract.js';
import { assertToolDefinition } from '../contracts/tools/tool-definition-contract.js';
import { writeMemoryWritebackRequest } from '../context/write-memory-writeback-request.js';
import { executeGovernedLocalToolForInvocation } from './execute-governed-local-tool-for-invocation.js';
import { executeLocalReadOnlyToolForInvocation } from './execute-local-read-only-tool-for-invocation.js';
import { persistToolResultForInvocation } from './persist-tool-result-for-invocation.js';
import { proposeMemoryWritebackForToolResult } from './propose-memory-writeback-for-tool-result.js';

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertNonEmptyString(value, description) {
  if (!isNonEmptyString(value)) {
    throw new Error(`${description} must be a non-empty string.`);
  }

  return value.trim();
}

function normalizeToolDefinitions(toolDefinitions) {
  if (!Array.isArray(toolDefinitions)) {
    throw new Error('Brain tool execution toolDefinitions must be an array.');
  }

  return toolDefinitions.map(assertToolDefinition);
}

function findToolDefinition({ toolDefinitions, toolId }) {
  return toolDefinitions.find((toolDefinition) => {
    return toolDefinition.toolId === toolId;
  }) ?? null;
}

function buildNotExecutedResult({
  toolRequestResolution,
  reason,
  warnings = [],
  errors = [],
}) {
  return {
    kind: 'brain_tool_execution_result',
    version: 1,
    status: 'not_executed',
    executionPerformed: false,
    requestedToolId: toolRequestResolution?.requestedToolId ?? null,
    toolRequestId: toolRequestResolution?.toolRequest?.toolRequestId ?? null,
    toolRunId: null,
    toolResultStatus: null,
    toolAuditRecordPath: null,
    toolResultSnapshotPath: null,
    memoryWritebackRequest: null,
    memoryWritebackPersistence: null,
    continuationPolicy: null,
    observation: null,
    reason,
    warnings,
    errors,
  };
}

function resolveToolObservationContinuationPolicy(toolId) {
  if (toolId === 'mas.os.delegate') {
    return 'yield_to_kernel';
  }

  if (toolId === 'mas.os.schedule_delegation') {
    return 'return_kernel_acknowledgement';
  }

  return 'continue_with_provider';
}

function buildObservationFromAuditRecord({
  auditRecord,
  toolPersistence,
  memoryWritebackRequest,
  memoryWritebackPersistence,
}) {
  const recoveredDataPreview = auditRecord.dataPreview ?? (
    toolPersistence?.resultSnapshot?.result?.data?.omitted === true
      ? null
      : toolPersistence?.resultSnapshot?.result?.data ?? null
  );

  return {
    kind: 'brain_tool_observation',
    version: 1,
    toolId: auditRecord.toolId,
    toolRunId: auditRecord.toolRunId,
    status: auditRecord.status,
    summary: auditRecord.summary,
    dataPreview: recoveredDataPreview,
    artifactReferences: auditRecord.artifactReferences,
    resultEvidence: auditRecord.resultEvidence,
    warnings: auditRecord.warnings,
    errors: auditRecord.errors,
    audit: auditRecord.audit,
    memoryWritebackCandidateIds: memoryWritebackRequest.memoryWrites.map((candidate) => {
      return candidate.writeId;
    }),
    memoryWritebackRequestPath: memoryWritebackPersistence?.recordPath ?? null,
  };
}

function buildExecutedResult({
  toolRequestResolution,
  toolDefinition,
  toolPersistence,
  memoryWritebackRequest,
  memoryWritebackPersistence,
}) {
  const auditRecord = toolPersistence.auditRecord;
  const runtimeLabel = isGovernedInternalTool(toolDefinition)
    ? 'governed OpenMAS OS Tool Runtime'
    : 'read-only Tool Runtime';

  return {
    kind: 'brain_tool_execution_result',
    version: 1,
    status: 'executed',
    executionPerformed: true,
    requestedToolId: toolRequestResolution.requestedToolId,
    toolRequestId: toolRequestResolution.toolRequest.toolRequestId,
    toolRunId: auditRecord.toolRunId,
    toolResultStatus: auditRecord.status,
    toolAuditRecordPath: toolPersistence.auditRecordPath,
    toolResultSnapshotPath: toolPersistence.resultSnapshotPath,
    memoryWritebackRequest,
    memoryWritebackPersistence,
    continuationPolicy: resolveToolObservationContinuationPolicy(toolDefinition.toolId),
    observation: buildObservationFromAuditRecord({
      auditRecord,
      toolPersistence,
      memoryWritebackRequest,
      memoryWritebackPersistence,
    }),
    reason: `Accepted brain tool request ${toolRequestResolution.toolRequest.toolRequestId} executed through the ${runtimeLabel}.`,
    warnings: [
      ...auditRecord.warnings,
      ...memoryWritebackRequest.warnings,
    ],
    errors: auditRecord.errors,
  };
}

function isGovernedInternalTool(toolDefinition) {
  return toolDefinition.toolId.startsWith('mas.os.')
    && toolDefinition.sideEffectLevel === 'write_internal'
    && toolDefinition.approvalPolicy.required === false;
}

function validateBrainExecutionScope({
  toolRequestResolution,
  toolDefinition,
}) {
  if (toolDefinition.toolType !== 'local_js_module') {
    return `Tool ${toolDefinition.toolId} cannot be executed from a brain request in this slice because toolType is ${toolDefinition.toolType}.`;
  }

  if (toolRequestResolution.toolRequest.expectedSideEffectLevel !== toolDefinition.sideEffectLevel) {
    return `Brain tool request expectedSideEffectLevel must match tool ${toolDefinition.toolId} sideEffectLevel "${toolDefinition.sideEffectLevel}". Received: ${toolRequestResolution.toolRequest.expectedSideEffectLevel}.`;
  }

  if (toolDefinition.sideEffectLevel === 'read_only') {
    return null;
  }

  if (!isGovernedInternalTool(toolDefinition)) {
    return `Tool ${toolDefinition.toolId} cannot be executed from a brain request in this slice because sideEffectLevel is ${toolDefinition.sideEffectLevel}.`;
  }

  return null;
}

function bindTrustedOsParentContext({
  toolId,
  input,
  osRuntimeContext,
}) {
  if (!['mas.os.delegate', 'mas.os.schedule_delegation'].includes(toolId)) {
    return input;
  }

  if (
    !isPlainObject(osRuntimeContext)
    || !isNonEmptyString(osRuntimeContext.processId)
    || !isNonEmptyString(osRuntimeContext.threadId)
  ) {
    return input;
  }

  return {
    ...input,
    parentContext: {
      jobId: isNonEmptyString(osRuntimeContext.jobId) ? osRuntimeContext.jobId.trim() : null,
      processId: osRuntimeContext.processId.trim(),
      threadId: osRuntimeContext.threadId.trim(),
    },
  };
}

async function executeAcceptedToolRequest({
  masRootPath,
  toolDefinition,
  toolRequestResolution,
  invocationId,
  operationalIdentityId,
  requestedBy,
  osRuntimeContext,
}) {
  const executionOptions = {
    masRootPath,
    toolDefinition,
    readinessVerdict: toolRequestResolution.toolReadinessVerdict,
    input: bindTrustedOsParentContext({
      toolId: toolDefinition.toolId,
      input: toolRequestResolution.toolRequest.input,
      osRuntimeContext,
    }),
    invocationId,
    operationalIdentityId,
    requestedBy,
  };

  if (toolDefinition.sideEffectLevel === 'read_only') {
    return executeLocalReadOnlyToolForInvocation(executionOptions);
  }

  return executeGovernedLocalToolForInvocation(executionOptions);
}

export async function executeAcceptedBrainToolRequest({
  masRootPath,
  invocationId,
  operationalIdentityId,
  requestedBy,
  osRuntimeContext = null,
  toolRequestResolution,
  toolDefinitions = [],
} = {}) {
  const normalizedMasRootPath = assertNonEmptyString(masRootPath, 'Brain tool execution masRootPath');
  const normalizedInvocationId = assertNonEmptyString(invocationId, 'Brain tool execution invocationId');
  const normalizedOperationalIdentityId = assertNonEmptyString(
    operationalIdentityId,
    'Brain tool execution operationalIdentityId',
  );
  const normalizedRequestedBy = assertNonEmptyString(requestedBy, 'Brain tool execution requestedBy');
  const normalizedResolution = assertBrainToolRequestResolution(toolRequestResolution);

  if (normalizedResolution.status !== 'accepted') {
    return buildNotExecutedResult({
      toolRequestResolution: normalizedResolution,
      reason: `Brain tool request was not executed because resolution status is ${normalizedResolution.status}.`,
      warnings: normalizedResolution.warnings,
    });
  }

  const normalizedToolDefinitions = normalizeToolDefinitions(toolDefinitions);
  const toolDefinition = findToolDefinition({
    toolDefinitions: normalizedToolDefinitions,
    toolId: normalizedResolution.requestedToolId,
  });

  if (!toolDefinition) {
    return buildNotExecutedResult({
      toolRequestResolution: normalizedResolution,
      reason: `Brain tool request was accepted, but tool definition ${normalizedResolution.requestedToolId} could not be resolved for execution.`,
      errors: [`Tool definition not found: ${normalizedResolution.requestedToolId}`],
    });
  }

  const scopeError = validateBrainExecutionScope({
    toolRequestResolution: normalizedResolution,
    toolDefinition,
  });

  if (scopeError) {
    return buildNotExecutedResult({
      toolRequestResolution: normalizedResolution,
      reason: scopeError,
      errors: [scopeError],
    });
  }

  const toolResult = await executeAcceptedToolRequest({
    masRootPath: normalizedMasRootPath,
    toolDefinition,
    toolRequestResolution: normalizedResolution,
    invocationId: normalizedInvocationId,
    operationalIdentityId: normalizedOperationalIdentityId,
    requestedBy: normalizedRequestedBy,
    osRuntimeContext,
  });
  const toolPersistence = await persistToolResultForInvocation({
    masRootPath: normalizedMasRootPath,
    toolDefinition,
    toolResult,
  });
  const memoryWritebackRequest = proposeMemoryWritebackForToolResult({
    toolResult,
    toolDefinition,
    requestedBy: normalizedRequestedBy,
  });
  const memoryWritebackPersistence = memoryWritebackRequest.memoryWrites.length > 0
    ? await writeMemoryWritebackRequest({
      masRootPath: normalizedMasRootPath,
      memoryWritebackRequest,
      recordId: toolResult.toolRunId,
    })
    : null;

  return buildExecutedResult({
    toolRequestResolution: normalizedResolution,
    toolDefinition,
    toolPersistence,
    memoryWritebackRequest,
    memoryWritebackPersistence,
  });
}
