const MEMORY_SOURCE_TYPES = new Set([
  'invocation_session',
  'invocation_report',
  'boot_report',
  'knowledge_document',
  'policy_document',
  'agent_local_memory',
  'operational_identity_memory',
  'durable_memory_record',
  'working_memory_record',
  'conversation_session',
  'conversation_turn',
  'artifact',
  'tool_result',
  'workflow_run',
]);

const MEMORY_SOURCE_SCOPES = new Set([
  'framework',
  'mas_instance',
  'cognitive_identity',
  'operational_identity',
  'team',
  'workflow',
  'resource',
  'human',
  'evaluation',
]);

const MEMORY_ORIGINS = new Set([
  'administrator_curated',
  'steward_curated',
  'imported_document',
  'runtime_observed',
  'agent_proposed',
  'human_approved',
  'workflow_generated',
  'evaluation_generated',
  'system_generated',
]);

const MEMORY_SENSITIVITY_LEVELS = new Set([
  'public',
  'internal',
  'confidential',
  'restricted',
  'secret_reference_only',
]);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function buildDescription(description, index) {
  return Number.isInteger(index) ? `${description}[${index}]` : description;
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

function assertOptionalContentSha256(value, description) {
  if (value === null || value === undefined) {
    return null;
  }

  if (!isNonEmptyString(value)) {
    throw new Error(`${description} must be a non-empty SHA-256 hex digest when provided.`);
  }

  const normalizedValue = value.trim();

  if (!/^[a-f0-9]{64}$/u.test(normalizedValue)) {
    throw new Error(`${description} must be a lowercase SHA-256 hex digest.`);
  }

  return normalizedValue;
}

export function assertMemorySourceType(value, description = 'Memory source type') {
  return assertEnumValue(value, MEMORY_SOURCE_TYPES, description);
}

export function assertMemorySourceScope(value, description = 'Memory source scope') {
  return assertEnumValue(value, MEMORY_SOURCE_SCOPES, description);
}

export function assertMemoryOrigin(value, description = 'Memory origin') {
  return assertEnumValue(value, MEMORY_ORIGINS, description);
}

export function assertMemorySensitivityLevel(value, description = 'Memory sensitivityLevel') {
  return assertEnumValue(value, MEMORY_SENSITIVITY_LEVELS, description);
}

export function assertMemorySourceReference(sourceReference, index = null, description = 'Memory source reference') {
  const label = buildDescription(description, index);

  if (!isPlainObject(sourceReference)) {
    throw new Error(`${label} must be an object.`);
  }

  if (sourceReference.kind !== 'memory_source_reference') {
    throw new Error(`${label} must include kind "memory_source_reference".`);
  }

  if (!Number.isInteger(sourceReference.version) || sourceReference.version < 1) {
    throw new Error(`${label} must include an integer version greater than or equal to 1.`);
  }

  if (!isNonEmptyString(sourceReference.sourceId)) {
    throw new Error(`${label} must include a non-empty sourceId.`);
  }

  if (!isNonEmptyString(sourceReference.ownerId)) {
    throw new Error(`${label} must include a non-empty ownerId.`);
  }

  const normalizedReference = {
    kind: sourceReference.kind,
    version: sourceReference.version,
    sourceType: assertMemorySourceType(sourceReference.sourceType, `${label} sourceType`),
    sourceId: sourceReference.sourceId.trim(),
    scope: assertMemorySourceScope(sourceReference.scope, `${label} scope`),
    ownerId: sourceReference.ownerId.trim(),
    path: isNonEmptyString(sourceReference.path) ? sourceReference.path.trim() : null,
    origin: sourceReference.origin === undefined || sourceReference.origin === null
      ? null
      : assertMemoryOrigin(sourceReference.origin, `${label} origin`),
    sensitivityLevel: sourceReference.sensitivityLevel === undefined || sourceReference.sensitivityLevel === null
      ? null
      : assertMemorySensitivityLevel(sourceReference.sensitivityLevel, `${label} sensitivityLevel`),
    createdAt: assertOptionalIsoDate(sourceReference.createdAt, `${label} createdAt`),
    contentSha256: assertOptionalContentSha256(sourceReference.contentSha256, `${label} contentSha256`),
    metadata: isPlainObject(sourceReference.metadata) ? { ...sourceReference.metadata } : null,
  };

  if (sourceReference.metadata !== undefined && sourceReference.metadata !== null && !isPlainObject(sourceReference.metadata)) {
    throw new Error(`${label} metadata must be an object when provided.`);
  }

  return normalizedReference;
}

export function assertMemorySourceReferences(sourceReferences, description = 'Memory sourceReferences') {
  if (!Array.isArray(sourceReferences)) {
    throw new Error(`${description} must be an array.`);
  }

  const seenSourceKeys = new Set();

  return sourceReferences.map((sourceReference, index) => {
    const normalizedReference = assertMemorySourceReference(sourceReference, index, description);
    const sourceKey = [
      normalizedReference.sourceType,
      normalizedReference.sourceId,
      normalizedReference.path ?? '',
    ].join(':');

    if (seenSourceKeys.has(sourceKey)) {
      throw new Error(`${description} contains a duplicated source reference: ${sourceKey}`);
    }

    seenSourceKeys.add(sourceKey);
    return normalizedReference;
  });
}

export {
  MEMORY_ORIGINS,
  MEMORY_SENSITIVITY_LEVELS,
  MEMORY_SOURCE_SCOPES,
  MEMORY_SOURCE_TYPES,
};
