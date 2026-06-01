const OPERATIONAL_IDENTITY_LIFECYCLE_STATES = new Set([
  'draft',
  'configured',
  'active',
  'suspended',
  'revoked',
  'archived',
]);

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function assertAttachedCognitiveIdentity(entry, index) {
  if (!entry || typeof entry !== 'object') {
    throw new Error(`Operational Identity attachedCognitiveIdentities[${index}] must be an object.`);
  }

  if (!isNonEmptyString(entry.cognitiveIdentityId)) {
    throw new Error(`Operational Identity attachedCognitiveIdentities[${index}] must include a non-empty cognitiveIdentityId.`);
  }

  return {
    cognitiveIdentityId: entry.cognitiveIdentityId.trim(),
  };
}

function assertUniqueCognitiveIdentityIds(attachedCognitiveIdentities) {
  const seenCognitiveIdentityIds = new Set();

  for (const attachedCognitiveIdentity of attachedCognitiveIdentities) {
    if (seenCognitiveIdentityIds.has(attachedCognitiveIdentity.cognitiveIdentityId)) {
      throw new Error(
        `Operational Identity definition contains a duplicated attached cognitive identity: ${attachedCognitiveIdentity.cognitiveIdentityId}`,
      );
    }

    seenCognitiveIdentityIds.add(attachedCognitiveIdentity.cognitiveIdentityId);
  }
}

function assertUniqueStringArray(values, description) {
  if (!Array.isArray(values)) {
    throw new Error(`${description} must be an array.`);
  }

  const normalizedValues = [];
  const seenValues = new Set();

  values.forEach((value, index) => {
    if (!isNonEmptyString(value)) {
      throw new Error(`${description}[${index}] must be a non-empty string.`);
    }

    const normalizedValue = value.trim();

    if (seenValues.has(normalizedValue)) {
      throw new Error(`${description} contains a duplicated value: ${normalizedValue}`);
    }

    seenValues.add(normalizedValue);
    normalizedValues.push(normalizedValue);
  });

  return normalizedValues;
}

function assertCommandRoute(entry, index) {
  if (!entry || typeof entry !== 'object') {
    throw new Error(`Operational Identity routing commandRoutes[${index}] must be an object.`);
  }

  if (!isNonEmptyString(entry.command)) {
    throw new Error(`Operational Identity routing commandRoutes[${index}] must include a non-empty command.`);
  }

  if (!isNonEmptyString(entry.primaryCognitiveIdentityId)) {
    throw new Error(`Operational Identity routing commandRoutes[${index}] must include a non-empty primaryCognitiveIdentityId.`);
  }

  const secondaryCognitiveIdentityIdsSpecified = entry.secondaryCognitiveIdentityIds !== undefined;
  const normalizedSecondaryCognitiveIdentityIds = !secondaryCognitiveIdentityIdsSpecified
    ? []
    : assertUniqueStringArray(
      entry.secondaryCognitiveIdentityIds,
      `Operational Identity routing commandRoutes[${index}].secondaryCognitiveIdentityIds`,
    );

  if (normalizedSecondaryCognitiveIdentityIds.includes(entry.primaryCognitiveIdentityId.trim())) {
    throw new Error(
      `Operational Identity routing commandRoutes[${index}] must not include the primary cognitive identity inside secondaryCognitiveIdentityIds.`,
    );
  }

  return {
    command: entry.command.trim(),
    primaryCognitiveIdentityId: entry.primaryCognitiveIdentityId.trim(),
    secondaryCognitiveIdentityIds: normalizedSecondaryCognitiveIdentityIds,
    secondaryCognitiveIdentityIdsSpecified,
  };
}

export function assertOperationalIdentityLifecycleState(value) {
  if (!isNonEmptyString(value)) {
    throw new Error('Operational Identity lifecycleState must be a non-empty string.');
  }

  const normalizedLifecycleState = value.trim();

  if (!OPERATIONAL_IDENTITY_LIFECYCLE_STATES.has(normalizedLifecycleState)) {
    throw new Error(`Operational Identity lifecycleState is invalid: ${normalizedLifecycleState}`);
  }

  return normalizedLifecycleState;
}

export function assertOperationalIdentityDefinition(definition) {
  if (!definition || typeof definition !== 'object') {
    throw new Error('Operational Identity definition must be an object.');
  }

  if (definition.kind !== 'operational_identity_definition') {
    throw new Error('Operational Identity definition must include kind "operational_identity_definition".');
  }

  if (!Number.isInteger(definition.version) || definition.version < 1) {
    throw new Error('Operational Identity definition must include an integer version greater than or equal to 1.');
  }

  if (!isNonEmptyString(definition.operationalIdentityId)) {
    throw new Error('Operational Identity definition must include a non-empty operationalIdentityId.');
  }

  if (!isNonEmptyString(definition.displayName)) {
    throw new Error('Operational Identity definition must include a non-empty displayName.');
  }

  const lifecycleState = assertOperationalIdentityLifecycleState(definition.lifecycleState);

  if (!isNonEmptyString(definition.auditActorId)) {
    throw new Error('Operational Identity definition must include a non-empty auditActorId.');
  }

  if (!Array.isArray(definition.attachedCognitiveIdentities) || definition.attachedCognitiveIdentities.length === 0) {
    throw new Error('Operational Identity definition must include at least one attached cognitive identity.');
  }

  const normalizedAttachedCognitiveIdentities = definition.attachedCognitiveIdentities.map(assertAttachedCognitiveIdentity);
  assertUniqueCognitiveIdentityIds(normalizedAttachedCognitiveIdentities);

  if (definition.executionProfileId !== undefined && !isNonEmptyString(definition.executionProfileId)) {
    throw new Error('Operational Identity definition executionProfileId must be a non-empty string when provided.');
  }

  if (definition.persona !== undefined && (typeof definition.persona !== 'object' || definition.persona === null || Array.isArray(definition.persona))) {
    throw new Error('Operational Identity definition persona must be an object when provided.');
  }

  return {
    kind: definition.kind,
    version: definition.version,
    operationalIdentityId: definition.operationalIdentityId.trim(),
    displayName: definition.displayName.trim(),
    lifecycleState,
    auditActorId: definition.auditActorId.trim(),
    attachedCognitiveIdentities: normalizedAttachedCognitiveIdentities,
    executionProfileId: definition.executionProfileId?.trim() ?? null,
    persona: definition.persona ?? {},
  };
}

export function assertOperationalIdentityRegistry(registry) {
  if (!registry || typeof registry !== 'object') {
    throw new Error('Operational Identity registry must be an object.');
  }

  if (registry.kind !== 'operational_identities_registry') {
    throw new Error('Operational Identity registry must include kind "operational_identities_registry".');
  }

  if (!Number.isInteger(registry.version) || registry.version < 1) {
    throw new Error('Operational Identity registry must include an integer version greater than or equal to 1.');
  }

  if (!Array.isArray(registry.operationalIdentities)) {
    throw new Error('Operational Identity registry must include an operationalIdentities array.');
  }

  const seenOperationalIdentityIds = new Set();

  const normalizedOperationalIdentities = registry.operationalIdentities.map((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      throw new Error(`Operational Identity registry entry at index ${index} must be an object.`);
    }

    if (!isNonEmptyString(entry.operationalIdentityId)) {
      throw new Error(`Operational Identity registry entry at index ${index} must include a non-empty operationalIdentityId.`);
    }

    if (!isNonEmptyString(entry.rootPath)) {
      throw new Error(`Operational Identity registry entry for ${entry.operationalIdentityId} must include a non-empty rootPath.`);
    }

    if (entry.category !== undefined && !isNonEmptyString(entry.category)) {
      throw new Error(`Operational Identity registry entry for ${entry.operationalIdentityId} must include a non-empty category when provided.`);
    }

    const normalizedOperationalIdentityId = entry.operationalIdentityId.trim();

    if (seenOperationalIdentityIds.has(normalizedOperationalIdentityId)) {
      throw new Error(`Operational Identity registry contains a duplicated operationalIdentityId: ${normalizedOperationalIdentityId}`);
    }

    seenOperationalIdentityIds.add(normalizedOperationalIdentityId);

    return {
      operationalIdentityId: normalizedOperationalIdentityId,
      rootPath: entry.rootPath.trim(),
      category: entry.category?.trim() ?? null,
    };
  });

  return {
    kind: registry.kind,
    version: registry.version,
    operationalIdentities: normalizedOperationalIdentities,
  };
}

export function assertOperationalIdentityRoutingDefinition(definition) {
  if (!definition || typeof definition !== 'object') {
    throw new Error('Operational Identity routing definition must be an object.');
  }

  if (definition.kind !== 'operational_identity_routing_definition') {
    throw new Error('Operational Identity routing definition must include kind "operational_identity_routing_definition".');
  }

  if (!Number.isInteger(definition.version) || definition.version < 1) {
    throw new Error('Operational Identity routing definition must include an integer version greater than or equal to 1.');
  }

  if (definition.defaultPrimaryCognitiveIdentityId !== undefined && !isNonEmptyString(definition.defaultPrimaryCognitiveIdentityId)) {
    throw new Error('Operational Identity routing definition defaultPrimaryCognitiveIdentityId must be a non-empty string when provided.');
  }

  if (definition.commandRoutes !== undefined && !Array.isArray(definition.commandRoutes)) {
    throw new Error('Operational Identity routing definition commandRoutes must be an array when provided.');
  }

  const normalizedCommandRoutes = (definition.commandRoutes ?? []).map(assertCommandRoute);
  const seenCommands = new Set();

  normalizedCommandRoutes.forEach((commandRoute) => {
    if (seenCommands.has(commandRoute.command)) {
      throw new Error(`Operational Identity routing definition contains a duplicated command route: ${commandRoute.command}`);
    }

    seenCommands.add(commandRoute.command);
  });

  return {
    kind: definition.kind,
    version: definition.version,
    defaultPrimaryCognitiveIdentityId: definition.defaultPrimaryCognitiveIdentityId?.trim() ?? null,
    commandRoutes: normalizedCommandRoutes,
  };
}

export function isOperationalIdentityActive(definition) {
  return assertOperationalIdentityDefinition(definition).lifecycleState === 'active';
}
