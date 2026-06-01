import { TOOL_RESULT_STATUSES } from './tool-result-contract.js';

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

function assertBoolean(value, description) {
  if (typeof value !== 'boolean') {
    throw new Error(`${description} must be a boolean.`);
  }

  return value;
}

function assertNonNegativeInteger(value, description) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${description} must be a non-negative integer.`);
  }

  return value;
}

function assertPositiveInteger(value, description) {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${description} must be an integer greater than or equal to 1.`);
  }

  return value;
}

function assertNullableString(value, description) {
  if (value === null || value === undefined) {
    return null;
  }

  if (!isNonEmptyString(value)) {
    throw new Error(`${description} must be a non-empty string when provided.`);
  }

  return value.trim();
}

function assertToolRunAuditAudit(audit) {
  if (!isPlainObject(audit)) {
    throw new Error('Tool run audit record audit must be an object.');
  }

  if (!isNonEmptyString(audit.invocationId)) {
    throw new Error('Tool run audit record audit must include a non-empty invocationId.');
  }

  if (!isNonEmptyString(audit.operationalIdentityId)) {
    throw new Error('Tool run audit record audit must include a non-empty operationalIdentityId.');
  }

  if (!isNonEmptyString(audit.requestedBy)) {
    throw new Error('Tool run audit record audit must include a non-empty requestedBy.');
  }

  if (!isNonEmptyString(audit.startedAt)) {
    throw new Error('Tool run audit record audit must include a non-empty startedAt.');
  }

  if (!isNonEmptyString(audit.completedAt)) {
    throw new Error('Tool run audit record audit must include a non-empty completedAt.');
  }

  return {
    invocationId: audit.invocationId.trim(),
    operationalIdentityId: audit.operationalIdentityId.trim(),
    requestedBy: audit.requestedBy.trim(),
    approvalRequestId: assertNullableString(audit.approvalRequestId, 'Tool run audit record audit.approvalRequestId'),
    startedAt: audit.startedAt.trim(),
    completedAt: audit.completedAt.trim(),
  };
}

function assertArtifactReference(artifact, index) {
  const description = `Tool run audit record artifactReferences[${index}]`;

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
    artifactKind: assertNullableString(artifact.artifactKind, `${description}.artifactKind`),
    path: artifact.path.trim(),
    summary: assertNullableString(artifact.summary, `${description}.summary`),
  };
}

function assertArtifactReferences(artifacts) {
  if (!Array.isArray(artifacts)) {
    throw new Error('Tool run audit record artifactReferences must be an array.');
  }

  const seenArtifactIds = new Set();

  return artifacts.map((artifact, index) => {
    const normalizedArtifact = assertArtifactReference(artifact, index);

    if (seenArtifactIds.has(normalizedArtifact.artifactId)) {
      throw new Error(`Tool run audit record artifactReferences contains a duplicated artifactId: ${normalizedArtifact.artifactId}`);
    }

    seenArtifactIds.add(normalizedArtifact.artifactId);
    return normalizedArtifact;
  });
}

function assertResultEvidence(resultEvidence) {
  if (!isPlainObject(resultEvidence)) {
    throw new Error('Tool run audit record resultEvidence must be an object.');
  }

  return {
    dataSizeBytes: assertNonNegativeInteger(
      resultEvidence.dataSizeBytes,
      'Tool run audit record resultEvidence.dataSizeBytes',
    ),
    inlineDataLimitBytes: assertPositiveInteger(
      resultEvidence.inlineDataLimitBytes,
      'Tool run audit record resultEvidence.inlineDataLimitBytes',
    ),
    inlineDataIncluded: assertBoolean(
      resultEvidence.inlineDataIncluded,
      'Tool run audit record resultEvidence.inlineDataIncluded',
    ),
    fullResultArtifactPersisted: assertBoolean(
      resultEvidence.fullResultArtifactPersisted,
      'Tool run audit record resultEvidence.fullResultArtifactPersisted',
    ),
    fullResultArtifactReason: assertNullableString(
      resultEvidence.fullResultArtifactReason,
      'Tool run audit record resultEvidence.fullResultArtifactReason',
    ),
    redactionApplied: assertBoolean(
      resultEvidence.redactionApplied,
      'Tool run audit record resultEvidence.redactionApplied',
    ),
  };
}

export function assertToolRunAuditRecord(record) {
  if (!isPlainObject(record)) {
    throw new Error('Tool run audit record must be an object.');
  }

  if (record.kind !== 'tool_run_audit_record') {
    throw new Error('Tool run audit record must include kind "tool_run_audit_record".');
  }

  if (!Number.isInteger(record.version) || record.version < 1) {
    throw new Error('Tool run audit record must include an integer version greater than or equal to 1.');
  }

  if (!isNonEmptyString(record.toolId)) {
    throw new Error('Tool run audit record must include a non-empty toolId.');
  }

  if (!isNonEmptyString(record.toolRunId)) {
    throw new Error('Tool run audit record must include a non-empty toolRunId.');
  }

  if (!isNonEmptyString(record.summary)) {
    throw new Error('Tool run audit record must include a non-empty summary.');
  }

  if (!isNonEmptyString(record.persistedAt)) {
    throw new Error('Tool run audit record must include a non-empty persistedAt.');
  }

  return {
    kind: record.kind,
    version: record.version,
    toolId: record.toolId.trim(),
    toolRunId: record.toolRunId.trim(),
    status: assertEnumValue(record.status, TOOL_RESULT_STATUSES, 'Tool run audit record status'),
    summary: record.summary.trim(),
    audit: assertToolRunAuditAudit(record.audit),
    artifactReferences: assertArtifactReferences(record.artifactReferences ?? []),
    resultEvidence: assertResultEvidence(record.resultEvidence),
    dataPreview: record.dataPreview ?? null,
    warnings: assertStringArray(record.warnings ?? [], 'Tool run audit record warnings'),
    errors: assertStringArray(record.errors ?? [], 'Tool run audit record errors'),
    memoryWritebackCandidateCount: assertNonNegativeInteger(
      record.memoryWritebackCandidateCount,
      'Tool run audit record memoryWritebackCandidateCount',
    ),
    persistedAt: record.persistedAt.trim(),
  };
}
