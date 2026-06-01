const CREDENTIAL_REFERENCE_TYPES = new Set([
  'api_key',
  'access_token',
  'refresh_token',
  'bot_token',
  'webhook_secret',
  'oauth_client_credentials',
  'oauth_token_set',
  'service_account_json',
  'connection_string',
  'username_password',
  'private_key',
  'certificate',
  'custom_json',
]);

const CREDENTIAL_REFERENCE_VALUE_SHAPES = new Set([
  'string',
  'json_object',
]);

const CREDENTIAL_REFERENCE_RESOLUTION_STATUSES = new Set([
  'resolved',
  'unresolved',
  'missing_definition',
]);

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function assertCredentialReferenceDefinition(definition) {
  if (!definition || typeof definition !== 'object') {
    throw new Error('Credential Reference definition must be an object.');
  }

  if (definition.kind !== 'credential_reference_definition') {
    throw new Error('Credential Reference definition must include kind "credential_reference_definition".');
  }

  if (!Number.isInteger(definition.version) || definition.version < 1) {
    throw new Error('Credential Reference definition must include an integer version greater than or equal to 1.');
  }

  if (!isNonEmptyString(definition.credentialReferenceId)) {
    throw new Error('Credential Reference definition must include a non-empty credentialReferenceId.');
  }

  if (Object.hasOwn(definition, 'resolverType')) {
    throw new Error('Credential Reference definition must not include resolverType. OpenMAS credentials are resolved from the Credential Vault.');
  }

  if (Object.hasOwn(definition, 'environmentVariableName')) {
    throw new Error('Credential Reference definition must not include environmentVariableName. OpenMAS credentials are resolved from the Credential Vault.');
  }

  if (!isNonEmptyString(definition.credentialType)) {
    throw new Error('Credential Reference definition must include a non-empty credentialType.');
  }

  const credentialType = definition.credentialType.trim();

  if (!CREDENTIAL_REFERENCE_TYPES.has(credentialType)) {
    throw new Error(`Credential Reference definition has an invalid credentialType: ${credentialType}`);
  }

  if (!isNonEmptyString(definition.valueShape)) {
    throw new Error('Credential Reference definition must include a non-empty valueShape.');
  }

  const valueShape = definition.valueShape.trim();

  if (!CREDENTIAL_REFERENCE_VALUE_SHAPES.has(valueShape)) {
    throw new Error(`Credential Reference definition has an invalid valueShape: ${valueShape}`);
  }

  return {
    kind: definition.kind,
    version: definition.version,
    credentialReferenceId: definition.credentialReferenceId.trim(),
    credentialType,
    valueShape,
    description: isNonEmptyString(definition.description) ? definition.description.trim() : null,
  };
}

export function assertCredentialReferenceRegistry(registry) {
  if (!registry || typeof registry !== 'object') {
    throw new Error('Credential Reference registry must be an object.');
  }

  if (registry.kind !== 'credential_reference_registry') {
    throw new Error('Credential Reference registry must include kind "credential_reference_registry".');
  }

  if (!Number.isInteger(registry.version) || registry.version < 1) {
    throw new Error('Credential Reference registry must include an integer version greater than or equal to 1.');
  }

  if (!Array.isArray(registry.credentialReferences)) {
    throw new Error('Credential Reference registry must include a credentialReferences array.');
  }

  const seenReferenceIds = new Set();

  const credentialReferences = registry.credentialReferences.map((entry) => {
    const normalizedDefinition = assertCredentialReferenceDefinition(entry);

    if (seenReferenceIds.has(normalizedDefinition.credentialReferenceId)) {
      throw new Error(`Credential Reference registry contains a duplicated credentialReferenceId: ${normalizedDefinition.credentialReferenceId}`);
    }

    seenReferenceIds.add(normalizedDefinition.credentialReferenceId);
    return normalizedDefinition;
  });

  return {
    kind: registry.kind,
    version: registry.version,
    credentialReferences,
  };
}

export function assertResolvedCredentialReference(reference) {
  if (!reference || typeof reference !== 'object') {
    throw new Error('Resolved Credential Reference must be an object.');
  }

  if (!isNonEmptyString(reference.resourceId)) {
    throw new Error('Resolved Credential Reference must include a non-empty resourceId.');
  }

  if (!isNonEmptyString(reference.credentialReferenceId)) {
    throw new Error('Resolved Credential Reference must include a non-empty credentialReferenceId.');
  }

  if (!isNonEmptyString(reference.resolutionStatus)) {
    throw new Error('Resolved Credential Reference must include a non-empty resolutionStatus.');
  }

  const resolutionStatus = reference.resolutionStatus.trim();

  if (!CREDENTIAL_REFERENCE_RESOLUTION_STATUSES.has(resolutionStatus)) {
    throw new Error(`Resolved Credential Reference has an invalid resolutionStatus: ${resolutionStatus}`);
  }

  return {
    resourceId: reference.resourceId.trim(),
    credentialReferenceId: reference.credentialReferenceId.trim(),
    credentialType: isNonEmptyString(reference.credentialType) ? reference.credentialType.trim() : null,
    valueShape: isNonEmptyString(reference.valueShape) ? reference.valueShape.trim() : null,
    resolutionStatus,
    reason: isNonEmptyString(reference.reason) ? reference.reason.trim() : null,
    hasSecretValue: reference.hasSecretValue === true,
  };
}

export function assertCredentialReferenceResolution(result) {
  if (!result || typeof result !== 'object') {
    throw new Error('Credential Reference resolution result must be an object.');
  }

  if (!Array.isArray(result.resolvedCredentialReferences)) {
    throw new Error('Credential Reference resolution result must include a resolvedCredentialReferences array.');
  }

  const resolvedCredentialReferences = result.resolvedCredentialReferences.map((entry) => {
    return assertResolvedCredentialReference(entry);
  });

  if (!result.summary || typeof result.summary !== 'object') {
    throw new Error('Credential Reference resolution result must include a summary object.');
  }

  if (typeof result.summary.totalReferenced !== 'number') {
    throw new Error('Credential Reference resolution summary must include a totalReferenced number.');
  }

  if (typeof result.summary.resolved !== 'number') {
    throw new Error('Credential Reference resolution summary must include a resolved number.');
  }

  if (typeof result.summary.unresolved !== 'number') {
    throw new Error('Credential Reference resolution summary must include an unresolved number.');
  }

  if (typeof result.summary.missingDefinitions !== 'number') {
    throw new Error('Credential Reference resolution summary must include a missingDefinitions number.');
  }

  if (!Array.isArray(result.warnings)) {
    throw new Error('Credential Reference resolution result must include a warnings array.');
  }

  return {
    resolvedCredentialReferences,
    summary: {
      totalReferenced: result.summary.totalReferenced,
      resolved: result.summary.resolved,
      unresolved: result.summary.unresolved,
      missingDefinitions: result.summary.missingDefinitions,
    },
    warnings: result.warnings,
  };
}

export {
  CREDENTIAL_REFERENCE_TYPES,
  CREDENTIAL_REFERENCE_VALUE_SHAPES,
  CREDENTIAL_REFERENCE_RESOLUTION_STATUSES,
};
