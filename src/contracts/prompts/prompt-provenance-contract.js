const PROMPT_PROVENANCE_ASSEMBLY_STATUSES = new Set([
  'assembled',
  'partially_assembled',
  'failed',
]);

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function assertNonNegativeInteger(value, description) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${description} must be a non-negative integer.`);
  }

  return value;
}

function assertOptionalNonNegativeInteger(value, description) {
  if (value === null || value === undefined) {
    return null;
  }

  return assertNonNegativeInteger(value, description);
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

function assertSourceReference(sourceReference, index, description) {
  if (!sourceReference || typeof sourceReference !== 'object' || Array.isArray(sourceReference)) {
    throw new Error(`${description} sourceReferences[${index}] must be an object.`);
  }

  if (!isNonEmptyString(sourceReference.sourceType)) {
    throw new Error(`${description} sourceReferences[${index}] must include a non-empty sourceType.`);
  }

  if (!isNonEmptyString(sourceReference.sourceId)) {
    throw new Error(`${description} sourceReferences[${index}] must include a non-empty sourceId.`);
  }

  return {
    sourceType: sourceReference.sourceType.trim(),
    sourceId: sourceReference.sourceId.trim(),
    path: isNonEmptyString(sourceReference.path) ? sourceReference.path.trim() : null,
  };
}

function assertContentSha256(value, description) {
  if (!isNonEmptyString(value)) {
    throw new Error(`${description} must include a non-empty contentSha256.`);
  }

  const normalizedValue = value.trim();

  if (!/^[a-f0-9]{64}$/u.test(normalizedValue)) {
    throw new Error(`${description} contentSha256 must be a lowercase SHA-256 hex digest.`);
  }

  return normalizedValue;
}

function assertIncludedLayer(layer, index) {
  const description = `Prompt provenance includedLayers[${index}]`;

  if (!layer || typeof layer !== 'object' || Array.isArray(layer)) {
    throw new Error(`${description} must be an object.`);
  }

  if (!isNonEmptyString(layer.layerId)) {
    throw new Error(`${description} must include a non-empty layerId.`);
  }

  if (!isNonEmptyString(layer.layerType)) {
    throw new Error(`${description} must include a non-empty layerType.`);
  }

  if (!isNonEmptyString(layer.owner)) {
    throw new Error(`${description} must include a non-empty owner.`);
  }

  if (!Array.isArray(layer.sourceReferences)) {
    throw new Error(`${description} must include a sourceReferences array.`);
  }

  return {
    layerId: layer.layerId.trim(),
    layerType: layer.layerType.trim(),
    owner: layer.owner.trim(),
    priority: assertNonNegativeInteger(layer.priority, `${description} priority`),
    sourceReferences: layer.sourceReferences.map((sourceReference, sourceIndex) => {
      return assertSourceReference(sourceReference, sourceIndex, description);
    }),
    contentLength: assertNonNegativeInteger(layer.contentLength, `${description} contentLength`),
    contentSha256: assertContentSha256(layer.contentSha256, description),
    summary: isNonEmptyString(layer.summary) ? layer.summary.trim() : null,
    warnings: assertStringArray(layer.warnings ?? [], `${description} warnings`),
  };
}

function assertOmittedLayer(layer, index) {
  const description = `Prompt provenance omittedLayers[${index}]`;

  if (!layer || typeof layer !== 'object' || Array.isArray(layer)) {
    throw new Error(`${description} must be an object.`);
  }

  if (!isNonEmptyString(layer.layerId)) {
    throw new Error(`${description} must include a non-empty layerId.`);
  }

  if (!isNonEmptyString(layer.layerType)) {
    throw new Error(`${description} must include a non-empty layerType.`);
  }

  if (!isNonEmptyString(layer.reason)) {
    throw new Error(`${description} must include a non-empty reason.`);
  }

  return {
    layerId: layer.layerId.trim(),
    layerType: layer.layerType.trim(),
    reason: layer.reason.trim(),
    sourceReferences: Array.isArray(layer.sourceReferences)
      ? layer.sourceReferences.map((sourceReference, sourceIndex) => {
        return assertSourceReference(sourceReference, sourceIndex, description);
      })
      : [],
  };
}

function assertAssembly(assembly) {
  if (!assembly || typeof assembly !== 'object' || Array.isArray(assembly)) {
    throw new Error('Prompt provenance assembly must be an object.');
  }

  return {
    systemInstructionsLength: assertOptionalNonNegativeInteger(
      assembly.systemInstructionsLength,
      'Prompt provenance assembly systemInstructionsLength',
    ),
    userInputLength: assertOptionalNonNegativeInteger(
      assembly.userInputLength,
      'Prompt provenance assembly userInputLength',
    ),
    messageCount: assertOptionalNonNegativeInteger(
      assembly.messageCount,
      'Prompt provenance assembly messageCount',
    ),
  };
}

export function assertPromptProvenance(provenance) {
  if (!provenance || typeof provenance !== 'object' || Array.isArray(provenance)) {
    throw new Error('Prompt provenance must be an object.');
  }

  if (!isNonEmptyString(provenance.promptFactoryVersion)) {
    throw new Error('Prompt provenance must include a non-empty promptFactoryVersion.');
  }

  if (!isNonEmptyString(provenance.promptProfileId)) {
    throw new Error('Prompt provenance must include a non-empty promptProfileId.');
  }

  if (!isNonEmptyString(provenance.promptStackVersionId)) {
    throw new Error('Prompt provenance must include a non-empty promptStackVersionId.');
  }

  if (!isNonEmptyString(provenance.assemblyStatus)) {
    throw new Error('Prompt provenance must include a non-empty assemblyStatus.');
  }

  const assemblyStatus = provenance.assemblyStatus.trim();

  if (!PROMPT_PROVENANCE_ASSEMBLY_STATUSES.has(assemblyStatus)) {
    throw new Error(`Prompt provenance contains an invalid assemblyStatus: ${assemblyStatus}`);
  }

  if (!Array.isArray(provenance.includedLayers)) {
    throw new Error('Prompt provenance must include an includedLayers array.');
  }

  if (!Array.isArray(provenance.omittedLayers)) {
    throw new Error('Prompt provenance must include an omittedLayers array.');
  }

  const includedLayers = provenance.includedLayers.map((layer, index) => {
    return assertIncludedLayer(layer, index);
  });
  const omittedLayers = provenance.omittedLayers.map((layer, index) => {
    return assertOmittedLayer(layer, index);
  });
  const includedLayerCount = assertNonNegativeInteger(
    provenance.includedLayerCount ?? includedLayers.length,
    'Prompt provenance includedLayerCount',
  );
  const omittedLayerCount = assertNonNegativeInteger(
    provenance.omittedLayerCount ?? omittedLayers.length,
    'Prompt provenance omittedLayerCount',
  );

  if (includedLayerCount !== includedLayers.length) {
    throw new Error('Prompt provenance includedLayerCount must match includedLayers length.');
  }

  if (omittedLayerCount !== omittedLayers.length) {
    throw new Error('Prompt provenance omittedLayerCount must match omittedLayers length.');
  }

  return {
    kind: 'prompt_provenance',
    version: 1,
    promptFactoryVersion: provenance.promptFactoryVersion.trim(),
    promptProfileId: provenance.promptProfileId.trim(),
    promptStackVersionId: provenance.promptStackVersionId.trim(),
    assemblyStatus,
    providerId: isNonEmptyString(provenance.providerId) ? provenance.providerId.trim() : null,
    modelId: isNonEmptyString(provenance.modelId) ? provenance.modelId.trim() : null,
    requestType: isNonEmptyString(provenance.requestType) ? provenance.requestType.trim() : null,
    assembly: assertAssembly(provenance.assembly ?? {}),
    includedLayerCount,
    omittedLayerCount,
    includedLayers,
    omittedLayers,
    warnings: assertStringArray(provenance.warnings ?? [], 'Prompt provenance warnings'),
  };
}
