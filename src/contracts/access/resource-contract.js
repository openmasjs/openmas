const RESOURCE_OWNERSHIP_SCOPES = new Set([
  'shared',
  'dedicated',
]);

const RESOURCE_LIFECYCLE_STATES = new Set([
  'draft',
  'configured',
  'active',
  'suspended',
  'revoked',
  'archived',
]);

const RESOURCE_TYPES = new Set([
  'brain-provider',
  'channel',
  'tool',
  'knowledge-base',
  'storage',
  'agent-service',
]);

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function assertResourceLifecycleState(value) {
  if (!isNonEmptyString(value)) {
    throw new Error('Resource lifecycleState must be a non-empty string.');
  }

  const normalizedLifecycleState = value.trim();

  if (!RESOURCE_LIFECYCLE_STATES.has(normalizedLifecycleState)) {
    throw new Error(`Resource lifecycleState is invalid: ${normalizedLifecycleState}`);
  }

  return normalizedLifecycleState;
}

export function assertResourceDefinition(definition) {
  if (!definition || typeof definition !== 'object') {
    throw new Error('Resource definition must be an object.');
  }

  if (definition.kind !== 'resource_definition') {
    throw new Error('Resource definition must include kind "resource_definition".');
  }

  if (!Number.isInteger(definition.version) || definition.version < 1) {
    throw new Error('Resource definition must include an integer version greater than or equal to 1.');
  }

  if (!isNonEmptyString(definition.resourceId)) {
    throw new Error('Resource definition must include a non-empty resourceId.');
  }

  if (!isNonEmptyString(definition.resourceType)) {
    throw new Error('Resource definition must include a non-empty resourceType.');
  }

  const normalizedResourceType = definition.resourceType.trim();

  if (!RESOURCE_TYPES.has(normalizedResourceType)) {
    throw new Error(`Resource definition resourceType is invalid: ${normalizedResourceType}`);
  }

  if (!isNonEmptyString(definition.displayName)) {
    throw new Error('Resource definition must include a non-empty displayName.');
  }

  if (!isNonEmptyString(definition.ownershipScope)) {
    throw new Error('Resource definition must include a non-empty ownershipScope.');
  }

  const normalizedOwnershipScope = definition.ownershipScope.trim();

  if (!RESOURCE_OWNERSHIP_SCOPES.has(normalizedOwnershipScope)) {
    throw new Error(`Resource definition ownershipScope is invalid: ${normalizedOwnershipScope}`);
  }

  if (normalizedOwnershipScope === 'dedicated') {
    if (!isNonEmptyString(definition.dedicatedToOperationalIdentityId)) {
      throw new Error('Resource definition with ownershipScope "dedicated" must include a non-empty dedicatedToOperationalIdentityId.');
    }
  }

  if (normalizedOwnershipScope === 'shared' && definition.dedicatedToOperationalIdentityId !== undefined) {
    throw new Error('Resource definition with ownershipScope "shared" must not include dedicatedToOperationalIdentityId.');
  }

  const lifecycleState = assertResourceLifecycleState(definition.lifecycleState);

  return {
    kind: definition.kind,
    version: definition.version,
    resourceId: definition.resourceId.trim(),
    resourceType: normalizedResourceType,
    displayName: definition.displayName.trim(),
    ownershipScope: normalizedOwnershipScope,
    dedicatedToOperationalIdentityId: definition.dedicatedToOperationalIdentityId?.trim() ?? null,
    lifecycleState,
    description: isNonEmptyString(definition.description) ? definition.description.trim() : null,
  };
}

export function assertResourceRegistry(registry) {
  if (!registry || typeof registry !== 'object') {
    throw new Error('Resource registry must be an object.');
  }

  if (registry.kind !== 'resource_registry') {
    throw new Error('Resource registry must include kind "resource_registry".');
  }

  if (!Number.isInteger(registry.version) || registry.version < 1) {
    throw new Error('Resource registry must include an integer version greater than or equal to 1.');
  }

  if (!Array.isArray(registry.resources)) {
    throw new Error('Resource registry must include a resources array.');
  }

  const seenResourceIds = new Set();

  const normalizedResources = registry.resources.map((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      throw new Error(`Resource registry entry at index ${index} must be an object.`);
    }

    const normalizedDefinition = assertResourceDefinition(entry);

    if (seenResourceIds.has(normalizedDefinition.resourceId)) {
      throw new Error(`Resource registry contains a duplicated resourceId: ${normalizedDefinition.resourceId}`);
    }

    seenResourceIds.add(normalizedDefinition.resourceId);

    return normalizedDefinition;
  });

  return {
    kind: registry.kind,
    version: registry.version,
    resources: normalizedResources,
  };
}

export function isResourceActive(definition) {
  return assertResourceDefinition(definition).lifecycleState === 'active';
}
