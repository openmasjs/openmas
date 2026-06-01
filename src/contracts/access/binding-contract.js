const BINDING_ACCESS_MODES = new Set([
  'read',
  'write',
  'execute',
  'publish',
]);

const BINDING_STATES = new Set([
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

export function assertBindingState(value) {
  if (!isNonEmptyString(value)) {
    throw new Error('Binding bindingState must be a non-empty string.');
  }

  const normalizedBindingState = value.trim();

  if (!BINDING_STATES.has(normalizedBindingState)) {
    throw new Error(`Binding bindingState is invalid: ${normalizedBindingState}`);
  }

  return normalizedBindingState;
}

export function assertBindingEntry(entry, index) {
  if (!entry || typeof entry !== 'object') {
    throw new Error(`Binding entry at index ${index} must be an object.`);
  }

  if (!isNonEmptyString(entry.resourceId)) {
    throw new Error(`Binding entry at index ${index} must include a non-empty resourceId.`);
  }

  if (!isNonEmptyString(entry.accessMode)) {
    throw new Error(`Binding entry at index ${index} must include a non-empty accessMode.`);
  }

  const normalizedAccessMode = entry.accessMode.trim();

  if (!BINDING_ACCESS_MODES.has(normalizedAccessMode)) {
    throw new Error(`Binding entry at index ${index} has an invalid accessMode: ${normalizedAccessMode}`);
  }

  const bindingState = assertBindingState(entry.bindingState);

  const credentialReferenceId = entry.credentialReferenceId === undefined || entry.credentialReferenceId === null
    ? null
    : isNonEmptyString(entry.credentialReferenceId)
      ? entry.credentialReferenceId.trim()
      : (() => {
        throw new Error(`Binding entry at index ${index} must include a non-empty credentialReferenceId when provided.`);
      })();

  return {
    resourceId: entry.resourceId.trim(),
    accessMode: normalizedAccessMode,
    bindingState,
    credentialReferenceId,
  };
}

export function assertOperationalIdentityBindings(bindingsFile) {
  if (!bindingsFile || typeof bindingsFile !== 'object') {
    throw new Error('Operational Identity bindings file must be an object.');
  }

  if (bindingsFile.kind !== 'operational_identity_bindings') {
    throw new Error('Operational Identity bindings file must include kind "operational_identity_bindings".');
  }

  if (!Number.isInteger(bindingsFile.version) || bindingsFile.version < 1) {
    throw new Error('Operational Identity bindings file must include an integer version greater than or equal to 1.');
  }

  if (!isNonEmptyString(bindingsFile.operationalIdentityId)) {
    throw new Error('Operational Identity bindings file must include a non-empty operationalIdentityId.');
  }

  if (!Array.isArray(bindingsFile.bindings)) {
    throw new Error('Operational Identity bindings file must include a bindings array.');
  }

  const seenResourceIds = new Set();

  const normalizedBindings = bindingsFile.bindings.map((entry, index) => {
    const normalizedEntry = assertBindingEntry(entry, index);

    if (seenResourceIds.has(normalizedEntry.resourceId)) {
      throw new Error(`Operational Identity bindings file contains a duplicated resourceId: ${normalizedEntry.resourceId}`);
    }

    seenResourceIds.add(normalizedEntry.resourceId);

    return normalizedEntry;
  });

  return {
    kind: bindingsFile.kind,
    version: bindingsFile.version,
    operationalIdentityId: bindingsFile.operationalIdentityId.trim(),
    bindings: normalizedBindings,
  };
}

export function isBindingActive(entry) {
  return assertBindingEntry(entry, 0).bindingState === 'active';
}
