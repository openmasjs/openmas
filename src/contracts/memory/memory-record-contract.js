import {
  assertMemoryOrigin,
  assertMemorySensitivityLevel,
  assertMemorySourceReferences,
} from './memory-source-reference-contract.js';

const MEMORY_TYPES = new Set([
  'professional_knowledge',
  'runtime_evidence',
  'durable_decision',
  'preference',
  'domain_fact',
  'company_fact',
  'brand_rule',
  'policy_context',
  'task_state',
  'workflow_state',
  'conversation_summary',
  'relationship_note',
  'human_preference',
  'resource_context',
  'artifact_reference',
  'evaluation_finding',
  'risk_note',
  'hypothesis',
]);

const MEMORY_RECORD_SCOPES = new Set([
  'cognitive_identity',
  'operational_identity',
  'mas_instance',
  'team',
  'workflow',
  'resource',
  'human',
  'evaluation',
]);

const MEMORY_PORTABILITY_VALUES = new Set([
  'portable',
  'mas_bound',
  'exportable_with_redaction',
  'not_exportable',
  'requires_approval',
]);

const MEMORY_VISIBILITY_VALUES = new Set([
  'private_to_owner',
  'shared_with_team',
  'shared_with_mas',
  'restricted',
  'public_within_mas',
]);

const MEMORY_APPROVAL_STATES = new Set([
  'not_required',
  'pending',
  'approved',
  'rejected',
  'requires_review',
]);

const MEMORY_LIFECYCLE_STATUSES = new Set([
  'draft',
  'active',
  'stale',
  'superseded',
  'archived',
  'rejected',
  'expired',
]);

const MEMORY_CONFIDENCE_VALUES = new Set([
  'observed',
  'inferred',
  'human_approved',
  'steward_approved',
  'agent_proposed',
  'unknown',
]);

const MEMORY_AUTHORITY_LEVELS = new Set([
  'runtime_evidence',
  'operational_note',
  'team_guidance',
  'mas_guidance',
  'policy',
  'human_directive',
  'system_rule',
]);

const MEMORY_SUBJECT_TYPES = new Set([
  'cognitive_identity',
  'operational_identity',
  'mas_instance',
  'team',
  'workflow',
  'resource',
  'human',
  'evaluation',
  'customer',
  'document',
  'artifact',
  'invocation',
  'tool_run',
  'workflow_run',
  'unknown',
]);

const MEMORY_REDACTION_STATES = new Set([
  'not_required',
  'pending',
  'redacted',
  'blocked',
]);

const MEMORY_DELETION_STATES = new Set([
  'active',
  'pending_deletion',
  'deleted',
]);

const SOURCE_REQUIRED_MEMORY_TYPES = new Set([
  'professional_knowledge',
  'runtime_evidence',
  'durable_decision',
  'preference',
  'domain_fact',
  'company_fact',
  'brand_rule',
  'policy_context',
  'conversation_summary',
  'relationship_note',
  'human_preference',
  'resource_context',
  'artifact_reference',
  'evaluation_finding',
  'risk_note',
  'hypothesis',
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

function assertOptionalIsoDate(value, description) {
  if (value === null || value === undefined) {
    return null;
  }

  if (!isNonEmptyString(value)) {
    throw new Error(`${description} must be a non-empty ISO date string when provided.`);
  }

  const normalizedValue = value.trim();

  if (Number.isNaN(Date.parse(normalizedValue))) {
    throw new Error(`${description} must be a valid ISO date string.`);
  }

  return normalizedValue;
}

function assertStringArray(values, description) {
  if (!Array.isArray(values)) {
    throw new Error(`${description} must be an array.`);
  }

  const seenValues = new Set();

  return values.map((value, index) => {
    if (!isNonEmptyString(value)) {
      throw new Error(`${description}[${index}] must be a non-empty string.`);
    }

    const normalizedValue = value.trim();

    if (seenValues.has(normalizedValue)) {
      throw new Error(`${description} contains a duplicated value: ${normalizedValue}`);
    }

    seenValues.add(normalizedValue);
    return normalizedValue;
  });
}

function assertOptionalContent(value, sensitivityLevel) {
  if (value === undefined || value === null) {
    return null;
  }

  if (!isNonEmptyString(value)) {
    throw new Error('Memory record content must be a non-empty string when provided.');
  }

  if (sensitivityLevel === 'secret_reference_only') {
    throw new Error('Memory record with sensitivityLevel "secret_reference_only" must not include raw content.');
  }

  return value.trim();
}

function assertSubjectReference(subjectReference, index) {
  const description = `Memory record subjectReferences[${index}]`;

  if (!isPlainObject(subjectReference)) {
    throw new Error(`${description} must be an object.`);
  }

  const subjectType = assertEnumValue(
    subjectReference.subjectType,
    MEMORY_SUBJECT_TYPES,
    `${description} subjectType`,
  );

  if (!isNonEmptyString(subjectReference.subjectId)) {
    throw new Error(`${description} must include a non-empty subjectId.`);
  }

  return {
    subjectType,
    subjectId: subjectReference.subjectId.trim(),
    relationship: isNonEmptyString(subjectReference.relationship) ? subjectReference.relationship.trim() : null,
    metadata: isPlainObject(subjectReference.metadata) ? { ...subjectReference.metadata } : null,
  };
}

function assertSubjectReferences(subjectReferences) {
  if (!Array.isArray(subjectReferences)) {
    throw new Error('Memory record subjectReferences must be an array.');
  }

  const seenSubjectKeys = new Set();

  return subjectReferences.map((subjectReference, index) => {
    const normalizedReference = assertSubjectReference(subjectReference, index);
    const subjectKey = `${normalizedReference.subjectType}:${normalizedReference.subjectId}:${normalizedReference.relationship ?? ''}`;

    if (seenSubjectKeys.has(subjectKey)) {
      throw new Error(`Memory record subjectReferences contains a duplicated subject reference: ${subjectKey}`);
    }

    seenSubjectKeys.add(subjectKey);
    return normalizedReference;
  });
}

function assertRetention(retention) {
  if (retention === undefined || retention === null) {
    return {
      retentionPolicyId: null,
      expiresAt: null,
      staleAfter: null,
      reviewRequiredAt: null,
    };
  }

  if (!isPlainObject(retention)) {
    throw new Error('Memory record retention must be an object when provided.');
  }

  return {
    retentionPolicyId: isNonEmptyString(retention.retentionPolicyId) ? retention.retentionPolicyId.trim() : null,
    expiresAt: assertOptionalIsoDate(retention.expiresAt, 'Memory record retention expiresAt'),
    staleAfter: assertOptionalIsoDate(retention.staleAfter, 'Memory record retention staleAfter'),
    reviewRequiredAt: assertOptionalIsoDate(retention.reviewRequiredAt, 'Memory record retention reviewRequiredAt'),
  };
}

function assertSupersession(supersession) {
  if (supersession === undefined || supersession === null) {
    return {
      supersedesMemoryRecordIds: [],
      supersededByMemoryRecordId: null,
    };
  }

  if (!isPlainObject(supersession)) {
    throw new Error('Memory record supersession must be an object when provided.');
  }

  return {
    supersedesMemoryRecordIds: assertStringArray(
      supersession.supersedesMemoryRecordIds ?? [],
      'Memory record supersession supersedesMemoryRecordIds',
    ),
    supersededByMemoryRecordId: isNonEmptyString(supersession.supersededByMemoryRecordId)
      ? supersession.supersededByMemoryRecordId.trim()
      : null,
  };
}

function assertPrivacy(privacy) {
  if (privacy === undefined || privacy === null) {
    return {
      redactionState: 'not_required',
      deletionState: 'active',
      redactedAt: null,
      deletedAt: null,
      reason: null,
    };
  }

  if (!isPlainObject(privacy)) {
    throw new Error('Memory record privacy must be an object when provided.');
  }

  return {
    redactionState: privacy.redactionState === undefined || privacy.redactionState === null
      ? 'not_required'
      : assertEnumValue(privacy.redactionState, MEMORY_REDACTION_STATES, 'Memory record privacy redactionState'),
    deletionState: privacy.deletionState === undefined || privacy.deletionState === null
      ? 'active'
      : assertEnumValue(privacy.deletionState, MEMORY_DELETION_STATES, 'Memory record privacy deletionState'),
    redactedAt: assertOptionalIsoDate(privacy.redactedAt, 'Memory record privacy redactedAt'),
    deletedAt: assertOptionalIsoDate(privacy.deletedAt, 'Memory record privacy deletedAt'),
    reason: isNonEmptyString(privacy.reason) ? privacy.reason.trim() : null,
  };
}

function assertGovernanceRules(record) {
  if (record.portability === 'portable' && record.scope !== 'cognitive_identity') {
    throw new Error('Only cognitive_identity memory records may use portability "portable".');
  }

  if (record.scope === 'operational_identity' && record.visibility !== 'private_to_owner' && record.approvalState !== 'approved') {
    throw new Error('Operational identity memory shared beyond its owner must be approved.');
  }

  if (record.approvalState === 'rejected' && record.lifecycleStatus !== 'rejected') {
    throw new Error('Rejected memory records must use lifecycleStatus "rejected".');
  }

  if (record.lifecycleStatus === 'rejected' && record.approvalState !== 'rejected') {
    throw new Error('Memory records with lifecycleStatus "rejected" must use approvalState "rejected".');
  }

  if (SOURCE_REQUIRED_MEMORY_TYPES.has(record.memoryType) && record.sourceReferences.length === 0) {
    throw new Error(`Memory record with memoryType "${record.memoryType}" must include at least one source reference.`);
  }
}

export function assertMemoryRecord(memoryRecord) {
  if (!isPlainObject(memoryRecord)) {
    throw new Error('Memory record must be an object.');
  }

  if (memoryRecord.kind !== 'memory_record') {
    throw new Error('Memory record must include kind "memory_record".');
  }

  if (!Number.isInteger(memoryRecord.version) || memoryRecord.version < 1) {
    throw new Error('Memory record must include an integer version greater than or equal to 1.');
  }

  if (!isNonEmptyString(memoryRecord.memoryRecordId)) {
    throw new Error('Memory record must include a non-empty memoryRecordId.');
  }

  if (!isNonEmptyString(memoryRecord.ownerId)) {
    throw new Error('Memory record must include a non-empty ownerId.');
  }

  if (!isNonEmptyString(memoryRecord.summary)) {
    throw new Error('Memory record must include a non-empty summary.');
  }

  const sensitivityLevel = assertMemorySensitivityLevel(memoryRecord.sensitivityLevel, 'Memory record sensitivityLevel');

  const normalizedRecord = {
    kind: memoryRecord.kind,
    version: memoryRecord.version,
    memoryRecordId: memoryRecord.memoryRecordId.trim(),
    memoryType: assertEnumValue(memoryRecord.memoryType, MEMORY_TYPES, 'Memory record memoryType'),
    scope: assertEnumValue(memoryRecord.scope, MEMORY_RECORD_SCOPES, 'Memory record scope'),
    ownerId: memoryRecord.ownerId.trim(),
    origin: assertMemoryOrigin(memoryRecord.origin, 'Memory record origin'),
    portability: assertEnumValue(memoryRecord.portability, MEMORY_PORTABILITY_VALUES, 'Memory record portability'),
    visibility: assertEnumValue(memoryRecord.visibility, MEMORY_VISIBILITY_VALUES, 'Memory record visibility'),
    approvalState: assertEnumValue(memoryRecord.approvalState, MEMORY_APPROVAL_STATES, 'Memory record approvalState'),
    lifecycleStatus: assertEnumValue(memoryRecord.lifecycleStatus, MEMORY_LIFECYCLE_STATUSES, 'Memory record lifecycleStatus'),
    sensitivityLevel,
    confidence: assertEnumValue(memoryRecord.confidence, MEMORY_CONFIDENCE_VALUES, 'Memory record confidence'),
    authorityLevel: assertEnumValue(memoryRecord.authorityLevel, MEMORY_AUTHORITY_LEVELS, 'Memory record authorityLevel'),
    summary: memoryRecord.summary.trim(),
    content: assertOptionalContent(memoryRecord.content, sensitivityLevel),
    sourceReferences: assertMemorySourceReferences(memoryRecord.sourceReferences ?? [], 'Memory record sourceReferences'),
    subjectReferences: assertSubjectReferences(memoryRecord.subjectReferences ?? []),
    retention: assertRetention(memoryRecord.retention),
    supersession: assertSupersession(memoryRecord.supersession),
    privacy: assertPrivacy(memoryRecord.privacy),
    createdAt: assertOptionalIsoDate(memoryRecord.createdAt, 'Memory record createdAt'),
    updatedAt: assertOptionalIsoDate(memoryRecord.updatedAt, 'Memory record updatedAt'),
    warnings: assertStringArray(memoryRecord.warnings ?? [], 'Memory record warnings'),
  };

  assertGovernanceRules(normalizedRecord);

  return normalizedRecord;
}

export {
  MEMORY_APPROVAL_STATES,
  MEMORY_AUTHORITY_LEVELS,
  MEMORY_CONFIDENCE_VALUES,
  MEMORY_LIFECYCLE_STATUSES,
  MEMORY_PORTABILITY_VALUES,
  MEMORY_DELETION_STATES,
  MEMORY_RECORD_SCOPES,
  MEMORY_REDACTION_STATES,
  MEMORY_SUBJECT_TYPES,
  MEMORY_TYPES,
  MEMORY_VISIBILITY_VALUES,
};
