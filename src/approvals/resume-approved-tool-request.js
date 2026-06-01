import crypto from 'node:crypto';
import { assertHumanApprovalState } from '../contracts/approvals/human-approval-state-contract.js';
import { assertToolDefinition } from '../contracts/tools/tool-definition-contract.js';
import { assertToolReadinessVerdict } from '../contracts/tools/tool-readiness-contract.js';
import { writeJsonFile } from '../persistence/write-json-file.js';
import { executeApprovedLocalToolForInvocation } from '../tools/execute-approved-local-tool-for-invocation.js';
import { persistToolResultForInvocation } from '../tools/persist-tool-result-for-invocation.js';
import { readHumanApprovalState } from './read-human-approval-state.js';

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function assertNonEmptyString(value, description) {
  if (!isNonEmptyString(value)) {
    throw new Error(`${description} must be a non-empty string.`);
  }

  return value.trim();
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }

  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map((key) => {
      return `${JSON.stringify(key)}:${stableStringify(value[key])}`;
    }).join(',')}}`;
  }

  return JSON.stringify(value);
}

function createInputFingerprint(input) {
  return crypto.createHash('sha256').update(stableStringify(input)).digest('hex');
}

function buildNotExecutedResult({
  approvalRequestId,
  requestedToolId = null,
  toolRequestId = null,
  reason,
  warnings = [],
  errors = [],
}) {
  return {
    kind: 'approved_tool_resume_result',
    version: 1,
    status: 'not_executed',
    executionPerformed: false,
    approvalRequestId,
    requestedToolId,
    toolRequestId,
    toolRunId: null,
    toolResultStatus: null,
    toolAuditRecordPath: null,
    toolResultSnapshotPath: null,
    observation: null,
    reason,
    warnings,
    errors,
  };
}

function buildObservationFromAuditRecord(auditRecord) {
  return {
    kind: 'approved_tool_observation',
    version: 1,
    toolId: auditRecord.toolId,
    toolRunId: auditRecord.toolRunId,
    status: auditRecord.status,
    summary: auditRecord.summary,
    dataPreview: auditRecord.dataPreview,
    artifactReferences: auditRecord.artifactReferences,
    resultEvidence: auditRecord.resultEvidence,
    warnings: auditRecord.warnings,
    errors: auditRecord.errors,
    audit: auditRecord.audit,
  };
}

function buildExecutedResult({
  approvalRequest,
  toolPersistence,
  approvalState,
}) {
  const auditRecord = toolPersistence.auditRecord;

  return {
    kind: 'approved_tool_resume_result',
    version: 1,
    status: 'executed',
    executionPerformed: true,
    approvalRequestId: approvalRequest.approvalRequestId,
    requestedToolId: approvalRequest.subject.toolId,
    toolRequestId: approvalRequest.toolRequest.toolRequestId,
    toolRunId: auditRecord.toolRunId,
    toolResultStatus: auditRecord.status,
    toolAuditRecordPath: toolPersistence.auditRecordPath,
    toolResultSnapshotPath: toolPersistence.resultSnapshotPath,
    observation: buildObservationFromAuditRecord(auditRecord),
    approvalState,
    reason: `Approved human approval request ${approvalRequest.approvalRequestId} resumed exactly one matching tool execution.`,
    warnings: auditRecord.warnings,
    errors: auditRecord.errors,
  };
}

function validateResumeScope({
  approvalRequest,
  approvalState,
  toolDefinition,
  readinessVerdict,
  operationalIdentityId,
  input,
  now,
}) {
  if (approvalState.status !== 'approved') {
    return `Human approval request ${approvalRequest.approvalRequestId} cannot resume because status is ${approvalState.status}.`;
  }

  if (approvalState.consumedAt !== null || approvalState.consumedByToolRunId !== null) {
    return `Human approval request ${approvalRequest.approvalRequestId} has already been consumed.`;
  }

  if (!approvalState.executionAuthorized || approvalState.executionBlocked) {
    return `Human approval request ${approvalRequest.approvalRequestId} does not authorize execution.`;
  }

  if (approvalRequest.approvalType !== 'tool_execution') {
    return `Human approval request ${approvalRequest.approvalRequestId} is not a tool execution approval.`;
  }

  if (approvalRequest.operationalIdentityId !== operationalIdentityId) {
    return `Human approval request ${approvalRequest.approvalRequestId} belongs to ${approvalRequest.operationalIdentityId}, not ${operationalIdentityId}.`;
  }

  if (approvalRequest.subject.toolId !== toolDefinition.toolId) {
    return `Human approval request ${approvalRequest.approvalRequestId} is scoped to tool ${approvalRequest.subject.toolId}, not ${toolDefinition.toolId}.`;
  }

  if (approvalRequest.subject.toolId !== readinessVerdict.toolId) {
    return `Human approval request ${approvalRequest.approvalRequestId} readiness verdict is scoped to ${readinessVerdict.toolId}, not ${approvalRequest.subject.toolId}.`;
  }

  if (approvalRequest.subject.expectedSideEffectLevel !== toolDefinition.sideEffectLevel) {
    return `Human approval request ${approvalRequest.approvalRequestId} sideEffectLevel changed from ${approvalRequest.subject.expectedSideEffectLevel} to ${toolDefinition.sideEffectLevel}.`;
  }

  if (approvalRequest.subject.expectedSideEffectLevel !== approvalRequest.toolRequest.expectedSideEffectLevel) {
    return `Human approval request ${approvalRequest.approvalRequestId} subject and tool request sideEffectLevel do not match.`;
  }

  if (createInputFingerprint(approvalRequest.subject.input) !== createInputFingerprint(input)) {
    return `Human approval request ${approvalRequest.approvalRequestId} input does not match the approved input fingerprint.`;
  }

  if (approvalRequest.expiresAt && Date.parse(approvalRequest.expiresAt) <= Date.parse(now)) {
    return `Human approval request ${approvalRequest.approvalRequestId} expired at ${approvalRequest.expiresAt}.`;
  }

  return null;
}

async function markApprovalConsumed({
  stateRead,
  consumedAt,
  consumedByToolRunId,
}) {
  const approvalState = assertHumanApprovalState({
    ...stateRead.approvalState,
    status: 'consumed',
    executionAuthorized: false,
    executionBlocked: true,
    consumedAt,
    consumedByToolRunId,
    updatedAt: consumedAt,
    warnings: [
      ...stateRead.approvalState.warnings,
      `Human approval was consumed by tool run ${consumedByToolRunId}.`,
    ],
  });

  await writeJsonFile(stateRead.approvalStateRecordPath, approvalState);
  return approvalState;
}

export async function resumeApprovedToolRequest({
  masRootPath,
  approvalRequestId,
  operationalIdentityId,
  requestedBy,
  toolDefinition,
  readinessVerdict,
  input = null,
  invocationId = null,
  now = new Date().toISOString(),
} = {}) {
  const normalizedMasRootPath = assertNonEmptyString(masRootPath, 'Approved tool resume masRootPath');
  const normalizedOperationalIdentityId = assertNonEmptyString(
    operationalIdentityId,
    'Approved tool resume operationalIdentityId',
  );
  const normalizedRequestedBy = assertNonEmptyString(requestedBy, 'Approved tool resume requestedBy');
  const normalizedToolDefinition = assertToolDefinition(toolDefinition);
  const normalizedReadinessVerdict = assertToolReadinessVerdict(readinessVerdict);
  const normalizedNow = assertNonEmptyString(now, 'Approved tool resume now');
  const stateRead = await readHumanApprovalState({
    masRootPath: normalizedMasRootPath,
    approvalRequestId,
  });
  const approvalRequest = stateRead.approvalRequest;
  const resumeInput = input === null ? approvalRequest.toolRequest.input : input;

  if (!isPlainObject(resumeInput)) {
    throw new Error('Approved tool resume input must be an object when provided.');
  }

  const scopeError = validateResumeScope({
    approvalRequest,
    approvalState: stateRead.approvalState,
    toolDefinition: normalizedToolDefinition,
    readinessVerdict: normalizedReadinessVerdict,
    operationalIdentityId: normalizedOperationalIdentityId,
    input: resumeInput,
    now: normalizedNow,
  });

  if (scopeError) {
    return buildNotExecutedResult({
      approvalRequestId: approvalRequest.approvalRequestId,
      requestedToolId: approvalRequest.subject.toolId,
      toolRequestId: approvalRequest.toolRequest.toolRequestId,
      reason: scopeError,
      warnings: stateRead.approvalState.warnings,
      errors: [scopeError],
    });
  }

  const normalizedInvocationId = isNonEmptyString(invocationId)
    ? invocationId.trim()
    : approvalRequest.invocationId;
  const toolResult = await executeApprovedLocalToolForInvocation({
    masRootPath: normalizedMasRootPath,
    toolDefinition: normalizedToolDefinition,
    readinessVerdict: normalizedReadinessVerdict,
    input: resumeInput,
    invocationId: normalizedInvocationId,
    operationalIdentityId: normalizedOperationalIdentityId,
    requestedBy: normalizedRequestedBy,
    approvalRequestId: approvalRequest.approvalRequestId,
  });
  const toolPersistence = await persistToolResultForInvocation({
    masRootPath: normalizedMasRootPath,
    toolDefinition: normalizedToolDefinition,
    toolResult,
  });
  const consumedState = await markApprovalConsumed({
    stateRead,
    consumedAt: new Date().toISOString(),
    consumedByToolRunId: toolResult.toolRunId,
  });

  return buildExecutedResult({
    approvalRequest,
    toolPersistence,
    approvalState: consumedState,
  });
}
