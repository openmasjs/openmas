function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function assertNonNegativeInteger(value, description) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${description} must be a non-negative integer.`);
  }

  return value;
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

function assertSourceReference(sourceReference, index, layerId) {
  if (!sourceReference || typeof sourceReference !== 'object' || Array.isArray(sourceReference)) {
    throw new Error(`Instruction layer ${layerId} sourceReferences[${index}] must be an object.`);
  }

  if (!isNonEmptyString(sourceReference.sourceType)) {
    throw new Error(`Instruction layer ${layerId} sourceReferences[${index}] must include a non-empty sourceType.`);
  }

  if (!isNonEmptyString(sourceReference.sourceId)) {
    throw new Error(`Instruction layer ${layerId} sourceReferences[${index}] must include a non-empty sourceId.`);
  }

  return {
    sourceType: sourceReference.sourceType.trim(),
    sourceId: sourceReference.sourceId.trim(),
    path: isNonEmptyString(sourceReference.path) ? sourceReference.path.trim() : null,
  };
}

export function assertInstructionLayer(layer) {
  if (!layer || typeof layer !== 'object' || Array.isArray(layer)) {
    throw new Error('Instruction layer must be an object.');
  }

  if (!isNonEmptyString(layer.layerId)) {
    throw new Error('Instruction layer must include a non-empty layerId.');
  }

  const layerId = layer.layerId.trim();

  if (!isNonEmptyString(layer.layerType)) {
    throw new Error(`Instruction layer ${layerId} must include a non-empty layerType.`);
  }

  if (!isNonEmptyString(layer.owner)) {
    throw new Error(`Instruction layer ${layerId} must include a non-empty owner.`);
  }

  if (!isNonEmptyString(layer.content)) {
    throw new Error(`Instruction layer ${layerId} must include non-empty content.`);
  }

  if (!Array.isArray(layer.sourceReferences)) {
    throw new Error(`Instruction layer ${layerId} must include a sourceReferences array.`);
  }

  return {
    kind: 'instruction_layer',
    version: 1,
    layerId,
    layerType: layer.layerType.trim(),
    owner: layer.owner.trim(),
    priority: assertNonNegativeInteger(layer.priority, `Instruction layer ${layerId} priority`),
    sourceReferences: layer.sourceReferences.map((sourceReference, index) => {
      return assertSourceReference(sourceReference, index, layerId);
    }),
    content: layer.content.trim(),
    summary: isNonEmptyString(layer.summary) ? layer.summary.trim() : null,
    warnings: assertStringArray(layer.warnings ?? [], `Instruction layer ${layerId} warnings`),
  };
}

export function assertInstructionLayers(layers) {
  if (!Array.isArray(layers)) {
    throw new Error('Instruction layers must be an array.');
  }

  if (layers.length === 0) {
    throw new Error('Instruction layers must include at least one layer.');
  }

  const normalizedLayers = layers.map((layer) => assertInstructionLayer(layer));
  const layerIds = new Set();

  for (const layer of normalizedLayers) {
    if (layerIds.has(layer.layerId)) {
      throw new Error(`Instruction layers contain a duplicate layerId: ${layer.layerId}`);
    }

    layerIds.add(layer.layerId);
  }

  return normalizedLayers;
}
