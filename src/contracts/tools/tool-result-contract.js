import { assertMemoryWriteCandidate } from '../memory/memory-writeback-contract.js';

const TOOL_RESULT_STATUSES = new Set([
  'succeeded',
  'failed',
  'denied',
  'approval_required',
  'unavailable',
  'cancelled',
  'timed_out',
]);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function assertEnumValue(value, allowedValues, description) {
  if (!isNonEmptyString(value)) {
    throw new Error(`${description} must be a non-empty string.`);
  }

  const normalizedValue = value.trim();

  if (!allowedValues.has(normalizedValue)) {
    throw new Error(`${description} is invalid: ${normalizedValue}`);
  }

  return normalizedValue;
}

function assertStringArray(values, description) {
  if (!Array.isArray(values)) {
    throw new Error(`${description} must be an array.`);
  }

  return values.map((value, index) => {
    if (!isNonEmptyString(value)) {
      throw new Error(`${description}[${index}] must be a non-empty string.`);
    }

    return value.trim();
  });
}

function assertOptionalPlainObject(value, description) {
  if (value === undefined || value === null) {
    return {};
  }

  if (!isPlainObject(value)) {
    throw new Error(`${description} must be an object when provided.`);
  }

  return { ...value };
}

function assertToolResultArtifact(artifact, index) {
  const description = `Tool result artifacts[${index}]`;

  if (!isPlainObject(artifact)) {
    throw new Error(`${description} must be an object.`);
  }

  if (!isNonEmptyString(artifact.artifactId)) {
    throw new Error(`${description} must include a non-empty artifactId.`);
  }

  if (!isNonEmptyString(artifact.path)) {
    throw new Error(`${description} must include a non-empty path.`);
  }

  return {
    artifactId: artifact.artifactId.trim(),
    artifactKind: isNonEmptyString(artifact.artifactKind) ? artifact.artifactKind.trim() : null,
    path: artifact.path.trim(),
    summary: isNonEmptyString(artifact.summary) ? artifact.summary.trim() : null,
  };
}

function assertToolResultArtifacts(artifacts) {
  if (!Array.isArray(artifacts)) {
    throw new Error('Tool result artifacts must be an array.');
  }

  const seenArtifactIds = new Set();

  return artifacts.map((artifact, index) => {
    const normalizedArtifact = assertToolResultArtifact(artifact, index);

    if (seenArtifactIds.has(normalizedArtifact.artifactId)) {
      throw new Error(`Tool result artifacts contains a duplicated artifactId: ${normalizedArtifact.artifactId}`);
    }

    seenArtifactIds.add(normalizedArtifact.artifactId);
    return normalizedArtifact;
  });
}

function assertToolResultAudit(audit) {
  if (!isPlainObject(audit)) {
    throw new Error('Tool result audit must be an object.');
  }

  if (!isNonEmptyString(audit.invocationId)) {
    throw new Error('Tool result audit must include a non-empty invocationId.');
  }

  if (!isNonEmptyString(audit.operationalIdentityId)) {
    throw new Error('Tool result audit must include a non-empty operationalIdentityId.');
  }

  if (!isNonEmptyString(audit.requestedBy)) {
    throw new Error('Tool result audit must include a non-empty requestedBy.');
  }

  if (!isNonEmptyString(audit.startedAt)) {
    throw new Error('Tool result audit must include a non-empty startedAt.');
  }

  if (!isNonEmptyString(audit.completedAt)) {
    throw new Error('Tool result audit must include a non-empty completedAt.');
  }

  return {
    invocationId: audit.invocationId.trim(),
    operationalIdentityId: audit.operationalIdentityId.trim(),
    requestedBy: audit.requestedBy.trim(),
    approvalRequestId: isNonEmptyString(audit.approvalRequestId) ? audit.approvalRequestId.trim() : null,
    startedAt: audit.startedAt.trim(),
    completedAt: audit.completedAt.trim(),
  };
}

function assertMemoryWritebackCandidates(candidates) {
  if (!Array.isArray(candidates)) {
    throw new Error('Tool result memoryWritebackCandidates must be an array.');
  }

  const seenWriteIds = new Set();

  return candidates.map((candidate, index) => {
    const normalizedCandidate = assertMemoryWriteCandidate(candidate, index);

    if (seenWriteIds.has(normalizedCandidate.writeId)) {
      throw new Error(`Tool result memoryWritebackCandidates contains a duplicated writeId: ${normalizedCandidate.writeId}`);
    }

    seenWriteIds.add(normalizedCandidate.writeId);
    return normalizedCandidate;
  });
}

function assertStatusConsistency(result) {
  if (result.status === 'succeeded' && result.errors.length > 0) {
    throw new Error('Tool result with status "succeeded" must not include errors.');
  }

  if ((result.status === 'failed' || result.status === 'timed_out') && result.errors.length === 0) {
    throw new Error(`Tool result with status "${result.status}" must include at least one error.`);
  }

  if (result.status === 'approval_required' && !result.audit.approvalRequestId) {
    throw new Error('Tool result with status "approval_required" must include audit.approvalRequestId.');
  }
}

export function assertToolResult(result) {
  if (!isPlainObject(result)) {
    throw new Error('Tool result must be an object.');
  }

  if (result.kind !== 'tool_result') {
    throw new Error('Tool result must include kind "tool_result".');
  }

  if (!Number.isInteger(result.version) || result.version < 1) {
    throw new Error('Tool result must include an integer version greater than or equal to 1.');
  }

  if (!isNonEmptyString(result.toolId)) {
    throw new Error('Tool result must include a non-empty toolId.');
  }

  if (!isNonEmptyString(result.toolRunId)) {
    throw new Error('Tool result must include a non-empty toolRunId.');
  }

  if (!isNonEmptyString(result.summary)) {
    throw new Error('Tool result must include a non-empty summary.');
  }

  const normalizedResult = {
    kind: result.kind,
    version: result.version,
    toolId: result.toolId.trim(),
    toolRunId: result.toolRunId.trim(),
    status: assertEnumValue(result.status, TOOL_RESULT_STATUSES, 'Tool result status'),
    summary: result.summary.trim(),
    data: assertOptionalPlainObject(result.data, 'Tool result data'),
    artifacts: assertToolResultArtifacts(result.artifacts ?? []),
    warnings: assertStringArray(result.warnings ?? [], 'Tool result warnings'),
    errors: assertStringArray(result.errors ?? [], 'Tool result errors'),
    memoryWritebackCandidates: assertMemoryWritebackCandidates(result.memoryWritebackCandidates ?? []),
    audit: assertToolResultAudit(result.audit),
  };

  assertStatusConsistency(normalizedResult);

  return normalizedResult;
}

export {
  TOOL_RESULT_STATUSES,
};
