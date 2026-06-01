import {
  MEMORY_AUTHORITY_LEVELS,
  MEMORY_PORTABILITY_VALUES,
  MEMORY_RECORD_SCOPES,
  MEMORY_SUBJECT_TYPES,
  MEMORY_TYPES,
  MEMORY_VISIBILITY_VALUES,
} from './memory-record-contract.js';
import {
  assertMemoryOrigin,
  assertMemorySensitivityLevel,
  assertMemorySourceReferences,
  MEMORY_SENSITIVITY_LEVELS,
} from './memory-source-reference-contract.js';

const MEMORY_WRITE_TYPES = new Set([
  'conversation_summary',
  'decision',
  'preference',
  'task_state_update',
  'artifact_reference',
  'evaluation_finding',
  'domain_fact',
  'memory_promotion',
  'redacted_summary',
]);

const MEMORY_WRITE_APPROVAL_STATES = new Set([
  'pending',
  'approved',
  'rejected',
]);

const MEMORY_WRITE_REDACTION_STATES = new Set([
  'not_required',
  'pending',
  'redacted',
  'blocked',
]);

const HUMAN_APPROVAL_REQUIRED_WRITE_TYPES = new Set([
  'decision',
  'preference',
  'domain_fact',
  'memory_promotion',
]);

const WRITE_TYPE_TARGET_MEMORY_TYPES = new Map([
  ['conversation_summary', new Set(['conversation_summary'])],
  ['decision', new Set(['durable_decision'])],
  ['preference', new Set(['preference', 'human_preference'])],
  ['task_state_update', new Set(['task_state', 'workflow_state'])],
  ['artifact_reference', new Set(['artifact_reference'])],
  ['evaluation_finding', new Set(['evaluation_finding'])],
  ['domain_fact', new Set(['domain_fact', 'company_fact', 'brand_rule'])],
  ['memory_promotion', MEMORY_TYPES],
  ['redacted_summary', new Set(['conversation_summary', 'relationship_note', 'risk_note', 'evaluation_finding'])],
]);

const SENSITIVITY_RANK = new Map([
  ['public', 0],
  ['internal', 1],
  ['confidential', 2],
  ['restricted', 3],
  ['secret_reference_only', 4],
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
    throw new Error('Memory write candidate content must be a non-empty string when provided.');
  }

  if (sensitivityLevel === 'secret_reference_only') {
    throw new Error('Memory write candidate with sensitivityLevel "secret_reference_only" must not include raw content.');
  }

  return value.trim();
}

function assertSubjectReference(subjectReference, index) {
  const description = `Memory write candidate subjectReferences[${index}]`;

  if (!isPlainObject(subjectReference)) {
    throw new Error(`${description} must be an object.`);
  }

  return {
    subjectType: assertEnumValue(
      subjectReference.subjectType,
      MEMORY_SUBJECT_TYPES,
      `${description} subjectType`,
    ),
    subjectId: isNonEmptyString(subjectReference.subjectId)
      ? subjectReference.subjectId.trim()
      : (() => {
        throw new Error(`${description} must include a non-empty subjectId.`);
      })(),
    relationship: isNonEmptyString(subjectReference.relationship) ? subjectReference.relationship.trim() : null,
    metadata: isPlainObject(subjectReference.metadata) ? { ...subjectReference.metadata } : null,
  };
}

function assertSubjectReferences(subjectReferences) {
  if (!Array.isArray(subjectReferences)) {
    throw new Error('Memory write candidate subjectReferences must be an array.');
  }

  const seenSubjectKeys = new Set();

  return subjectReferences.map((subjectReference, index) => {
    const normalizedReference = assertSubjectReference(subjectReference, index);
    const subjectKey = `${normalizedReference.subjectType}:${normalizedReference.subjectId}:${normalizedReference.relationship ?? ''}`;

    if (seenSubjectKeys.has(subjectKey)) {
      throw new Error(`Memory write candidate subjectReferences contains a duplicated subject reference: ${subjectKey}`);
    }

    seenSubjectKeys.add(subjectKey);
    return normalizedReference;
  });
}

function assertSourceGovernance(sourceGovernance) {
  if (sourceGovernance === undefined || sourceGovernance === null) {
    return {
      sourceScopes: [],
      sourceOwnerIds: [],
      mostRestrictiveVisibility: null,
      highestSensitivityLevel: null,
      requiresHumanApproval: false,
    };
  }

  if (!isPlainObject(sourceGovernance)) {
    throw new Error('Memory write candidate sourceGovernance must be an object when provided.');
  }

  return {
    sourceScopes: (sourceGovernance.sourceScopes ?? []).map((scope, index) => {
      return assertEnumValue(scope, MEMORY_RECORD_SCOPES, `Memory write candidate sourceGovernance sourceScopes[${index}]`);
    }),
    sourceOwnerIds: assertStringArray(
      sourceGovernance.sourceOwnerIds ?? [],
      'Memory write candidate sourceGovernance sourceOwnerIds',
    ),
    mostRestrictiveVisibility: sourceGovernance.mostRestrictiveVisibility === undefined || sourceGovernance.mostRestrictiveVisibility === null
      ? null
      : assertEnumValue(
        sourceGovernance.mostRestrictiveVisibility,
        MEMORY_VISIBILITY_VALUES,
        'Memory write candidate sourceGovernance mostRestrictiveVisibility',
      ),
    highestSensitivityLevel: sourceGovernance.highestSensitivityLevel === undefined || sourceGovernance.highestSensitivityLevel === null
      ? null
      : assertEnumValue(
        sourceGovernance.highestSensitivityLevel,
        MEMORY_SENSITIVITY_LEVELS,
        'Memory write candidate sourceGovernance highestSensitivityLevel',
      ),
    requiresHumanApproval: Boolean(sourceGovernance.requiresHumanApproval),
  };
}

function assertTargetMemoryTypeMatchesWriteType(candidate) {
  const allowedTargetMemoryTypes = WRITE_TYPE_TARGET_MEMORY_TYPES.get(candidate.writeType);

  if (!allowedTargetMemoryTypes?.has(candidate.targetMemoryType)) {
    throw new Error(`Memory write candidate writeType "${candidate.writeType}" cannot target memoryType "${candidate.targetMemoryType}".`);
  }
}

function assertNoSensitivityDowngradeWithoutRedaction(candidate) {
  const inheritedSensitivity = candidate.sourceGovernance.highestSensitivityLevel;

  if (!inheritedSensitivity) {
    return;
  }

  const inheritedRank = SENSITIVITY_RANK.get(inheritedSensitivity);
  const candidateRank = SENSITIVITY_RANK.get(candidate.sensitivityLevel);

  if (candidateRank < inheritedRank && candidate.redactionState !== 'redacted') {
    throw new Error('Memory write candidate must not downgrade inherited source sensitivity without redaction.');
  }
}

function assertNoUnsafePrivateOperationalPromotion(candidate) {
  const sourceGovernance = candidate.sourceGovernance;
  const hasPrivateOperationalSource = (
    sourceGovernance.sourceScopes.includes('operational_identity')
    && sourceGovernance.mostRestrictiveVisibility === 'private_to_owner'
  );

  if (!hasPrivateOperationalSource) {
    return;
  }

  const preservesPrivateOwnerScope = (
    candidate.scope === 'operational_identity'
    && candidate.visibility === 'private_to_owner'
    && sourceGovernance.sourceOwnerIds.includes(candidate.ownerId)
  );

  if (!preservesPrivateOwnerScope && candidate.redactionState !== 'redacted') {
    throw new Error('Memory write candidate must not promote private operational identity memory outside its owner without redaction.');
  }
}

export function memoryWriteCandidateRequiresHumanApproval(candidate) {
  return (
    candidate.approvalState === 'pending'
    || HUMAN_APPROVAL_REQUIRED_WRITE_TYPES.has(candidate.writeType)
    || candidate.sourceGovernance.requiresHumanApproval
  );
}

export function assertMemoryWriteCandidate(candidate, index = null) {
  const description = Number.isInteger(index)
    ? `Memory writeback request memoryWrites[${index}]`
    : 'Memory write candidate';

  if (!isPlainObject(candidate)) {
    throw new Error(`${description} must be an object.`);
  }

  if (candidate.kind !== undefined && candidate.kind !== 'memory_write_candidate') {
    throw new Error(`${description} kind must be "memory_write_candidate" when provided.`);
  }

  if (!isNonEmptyString(candidate.writeId)) {
    throw new Error(`${description} must include a non-empty writeId.`);
  }

  if (!isNonEmptyString(candidate.ownerId)) {
    throw new Error(`${description} must include a non-empty ownerId.`);
  }

  if (!isNonEmptyString(candidate.summary)) {
    throw new Error(`${description} must include a non-empty summary.`);
  }

  if (!isNonEmptyString(candidate.reason)) {
    throw new Error(`${description} must include a non-empty reason.`);
  }

  const sensitivityLevel = assertMemorySensitivityLevel(candidate.sensitivityLevel, `${description} sensitivityLevel`);
  const sourceReferences = assertMemorySourceReferences(candidate.sourceReferences ?? [], `${description} sourceReferences`);

  if (sourceReferences.length === 0) {
    throw new Error(`${description} must include at least one source reference.`);
  }

  const normalizedCandidate = {
    kind: 'memory_write_candidate',
    writeId: candidate.writeId.trim(),
    writeType: assertEnumValue(candidate.writeType, MEMORY_WRITE_TYPES, `${description} writeType`),
    targetMemoryType: assertEnumValue(candidate.targetMemoryType, MEMORY_TYPES, `${description} targetMemoryType`),
    scope: assertEnumValue(candidate.scope, MEMORY_RECORD_SCOPES, `${description} scope`),
    ownerId: candidate.ownerId.trim(),
    origin: assertMemoryOrigin(candidate.origin, `${description} origin`),
    portability: assertEnumValue(candidate.portability, MEMORY_PORTABILITY_VALUES, `${description} portability`),
    visibility: assertEnumValue(candidate.visibility, MEMORY_VISIBILITY_VALUES, `${description} visibility`),
    sensitivityLevel,
    authorityLevel: assertEnumValue(candidate.authorityLevel, MEMORY_AUTHORITY_LEVELS, `${description} authorityLevel`),
    summary: candidate.summary.trim(),
    content: assertOptionalContent(candidate.content, sensitivityLevel),
    sourceReferences,
    subjectReferences: assertSubjectReferences(candidate.subjectReferences ?? []),
    approvalState: assertEnumValue(candidate.approvalState, MEMORY_WRITE_APPROVAL_STATES, `${description} approvalState`),
    redactionState: assertEnumValue(candidate.redactionState, MEMORY_WRITE_REDACTION_STATES, `${description} redactionState`),
    sourceGovernance: assertSourceGovernance(candidate.sourceGovernance),
    reason: candidate.reason.trim(),
    warnings: assertStringArray(candidate.warnings ?? [], `${description} warnings`),
  };

  assertTargetMemoryTypeMatchesWriteType(normalizedCandidate);
  assertNoSensitivityDowngradeWithoutRedaction(normalizedCandidate);
  assertNoUnsafePrivateOperationalPromotion(normalizedCandidate);

  return normalizedCandidate;
}

export function assertMemoryWritebackRequest(writebackRequest) {
  if (!isPlainObject(writebackRequest)) {
    throw new Error('Memory writeback request must be an object.');
  }

  if (writebackRequest.kind !== 'memory_writeback_request') {
    throw new Error('Memory writeback request must include kind "memory_writeback_request".');
  }

  if (!Number.isInteger(writebackRequest.version) || writebackRequest.version < 1) {
    throw new Error('Memory writeback request must include an integer version greater than or equal to 1.');
  }

  if (!isNonEmptyString(writebackRequest.invocationId)) {
    throw new Error('Memory writeback request must include a non-empty invocationId.');
  }

  if (!isNonEmptyString(writebackRequest.requestedBy)) {
    throw new Error('Memory writeback request must include a non-empty requestedBy.');
  }

  if (typeof writebackRequest.requiresHumanApproval !== 'boolean') {
    throw new Error('Memory writeback request must include boolean requiresHumanApproval.');
  }

  if (!Array.isArray(writebackRequest.memoryWrites)) {
    throw new Error('Memory writeback request must include a memoryWrites array.');
  }

  const seenWriteIds = new Set();
  const memoryWrites = writebackRequest.memoryWrites.map((candidate, index) => {
    const normalizedCandidate = assertMemoryWriteCandidate(candidate, index);

    if (seenWriteIds.has(normalizedCandidate.writeId)) {
      throw new Error(`Memory writeback request contains a duplicated writeId: ${normalizedCandidate.writeId}`);
    }

    seenWriteIds.add(normalizedCandidate.writeId);
    return normalizedCandidate;
  });
  const hasApprovalRequiredCandidate = memoryWrites.some(memoryWriteCandidateRequiresHumanApproval);

  if (hasApprovalRequiredCandidate && writebackRequest.requiresHumanApproval !== true) {
    throw new Error('Memory writeback request requiresHumanApproval must be true when any write candidate requires approval.');
  }

  return {
    kind: writebackRequest.kind,
    version: writebackRequest.version,
    invocationId: writebackRequest.invocationId.trim(),
    requestedBy: writebackRequest.requestedBy.trim(),
    requiresHumanApproval: writebackRequest.requiresHumanApproval,
    memoryWrites,
    warnings: assertStringArray(writebackRequest.warnings ?? [], 'Memory writeback request warnings'),
  };
}

export {
  MEMORY_WRITE_APPROVAL_STATES,
  MEMORY_WRITE_REDACTION_STATES,
  MEMORY_WRITE_TYPES,
};
