function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function assertProviderPreparationStatus(value, description) {
  if (!isNonEmptyString(value)) {
    throw new Error(`${description} must include a non-empty status.`);
  }

  const status = value.trim();

  if (!['ready', 'not_ready'].includes(status)) {
    throw new Error(`${description} has an invalid status: ${status}`);
  }

  return status;
}

export function assertBrainProviderPreparation(preparation, description = 'Brain Provider preparation') {
  if (preparation === null) {
    return null;
  }

  if (!preparation || typeof preparation !== 'object') {
    throw new Error(`${description} must be an object or null.`);
  }

  if (!isNonEmptyString(preparation.brainId)) {
    throw new Error(`${description} must include a non-empty brainId.`);
  }

  if (!isNonEmptyString(preparation.providerId)) {
    throw new Error(`${description} must include a non-empty providerId.`);
  }

  if (!isNonEmptyString(preparation.modelId)) {
    throw new Error(`${description} must include a non-empty modelId.`);
  }

  if (!isNonEmptyString(preparation.reason)) {
    throw new Error(`${description} must include a non-empty reason.`);
  }

  return {
    brainId: preparation.brainId.trim(),
    providerId: preparation.providerId.trim(),
    modelId: preparation.modelId.trim(),
    resourceId: isNonEmptyString(preparation.resourceId) ? preparation.resourceId.trim() : null,
    credentialReferenceId: isNonEmptyString(preparation.credentialReferenceId) ? preparation.credentialReferenceId.trim() : null,
    secretResolutionStatus: isNonEmptyString(preparation.secretResolutionStatus)
      ? preparation.secretResolutionStatus.trim()
      : null,
    status: assertProviderPreparationStatus(preparation.status, description),
    reason: preparation.reason.trim(),
  };
}

export function assertChannelProviderPreparation(preparation) {
  if (!preparation || typeof preparation !== 'object') {
    throw new Error('Channel Provider preparation must be an object.');
  }

  if (!isNonEmptyString(preparation.resourceId)) {
    throw new Error('Channel Provider preparation must include a non-empty resourceId.');
  }

  if (!isNonEmptyString(preparation.accessMode)) {
    throw new Error('Channel Provider preparation must include a non-empty accessMode.');
  }

  if (!isNonEmptyString(preparation.reason)) {
    throw new Error('Channel Provider preparation must include a non-empty reason.');
  }

  return {
    resourceId: preparation.resourceId.trim(),
    accessMode: preparation.accessMode.trim(),
    credentialReferenceId: isNonEmptyString(preparation.credentialReferenceId) ? preparation.credentialReferenceId.trim() : null,
    secretResolutionStatus: isNonEmptyString(preparation.secretResolutionStatus)
      ? preparation.secretResolutionStatus.trim()
      : null,
    status: assertProviderPreparationStatus(preparation.status, 'Channel Provider preparation'),
    reason: preparation.reason.trim(),
  };
}

export function assertProviderIntegrationPreparation(preparation) {
  if (!preparation || typeof preparation !== 'object') {
    throw new Error('Provider Integration preparation must be an object.');
  }

  if (!Array.isArray(preparation.channelProviders)) {
    throw new Error('Provider Integration preparation must include a channelProviders array.');
  }

  return {
    selectedBrainProvider: assertBrainProviderPreparation(preparation.selectedBrainProvider, 'Selected Brain Provider preparation'),
    fallbackBrainProvider: assertBrainProviderPreparation(preparation.fallbackBrainProvider, 'Fallback Brain Provider preparation'),
    channelProviders: preparation.channelProviders.map((entry) => {
      return assertChannelProviderPreparation(entry);
    }),
  };
}
