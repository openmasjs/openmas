function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function truncateText(value, maxLength = 220) {
  if (!isNonEmptyString(value)) {
    return null;
  }

  const normalizedValue = value.replace(/\s+/gu, ' ').trim();

  if (normalizedValue.length <= maxLength) {
    return normalizedValue;
  }

  return `${normalizedValue.slice(0, maxLength - 3)}...`;
}

export function pickCreatedAt(...values) {
  const value = values.find((candidate) => isNonEmptyString(candidate));

  return value?.trim() ?? null;
}

export function buildSourceReference({
  sourceType,
  sourceId,
  sourceDefinition,
  file,
  createdAt,
  origin = 'system_generated',
}) {
  return {
    kind: 'memory_source_reference',
    version: 1,
    sourceType,
    sourceId,
    path: file.relativePath,
    scope: sourceDefinition.scope,
    ownerId: sourceDefinition.ownerId,
    origin,
    sensitivityLevel: sourceDefinition.defaultSensitivityLevel,
    createdAt: createdAt ?? file.modifiedAt,
    contentSha256: file.contentSha256,
  };
}

export function buildSourceGovernance(sourceDefinition, overrides = {}) {
  return {
    scope: sourceDefinition.scope,
    ownerId: sourceDefinition.ownerId,
    portability: sourceDefinition.defaultPortability,
    visibility: sourceDefinition.defaultVisibility,
    sensitivityLevel: sourceDefinition.defaultSensitivityLevel,
    ...overrides,
  };
}

export function buildSubjectReferencesFromInvocationSession(session) {
  const subjectReferences = [];

  if (isNonEmptyString(session.invocationId)) {
    subjectReferences.push({
      subjectType: 'invocation',
      subjectId: session.invocationId.trim(),
      relationship: 'source-invocation',
    });
  }

  if (isNonEmptyString(session.operationalIdentityId)) {
    subjectReferences.push({
      subjectType: 'operational_identity',
      subjectId: session.operationalIdentityId.trim(),
      relationship: 'invoked-identity',
    });
  }

  const cognitiveIdentityId = session.primaryCognitiveIdentityId;

  if (isNonEmptyString(cognitiveIdentityId)) {
    subjectReferences.push({
      subjectType: 'cognitive_identity',
      subjectId: cognitiveIdentityId.trim(),
      relationship: 'primary-cognitive-identity',
    });
  }

  return subjectReferences;
}

export function buildOwnerSubjectReference(sourceDefinition) {
  if (sourceDefinition.scope === 'mas_instance') {
    return {
      subjectType: 'mas_instance',
      subjectId: sourceDefinition.ownerId,
      relationship: 'memory-owner',
    };
  }

  if (sourceDefinition.scope === 'cognitive_identity') {
    return {
      subjectType: 'cognitive_identity',
      subjectId: sourceDefinition.ownerId,
      relationship: 'memory-owner',
    };
  }

  if (sourceDefinition.scope === 'operational_identity') {
    return {
      subjectType: 'operational_identity',
      subjectId: sourceDefinition.ownerId,
      relationship: 'memory-owner',
    };
  }

  return {
    subjectType: sourceDefinition.scope,
    subjectId: sourceDefinition.ownerId,
    relationship: 'memory-owner',
  };
}
