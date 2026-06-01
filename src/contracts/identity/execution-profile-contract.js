function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

const EXECUTION_PROFILE_MODES = new Set([
  'deterministic',
  'probabilistic',
  'hybrid',
]);

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

function assertBrainReference(brainReference, description) {
  if (!brainReference || typeof brainReference !== 'object' || Array.isArray(brainReference)) {
    throw new Error(`${description} must be an object.`);
  }

  if (!isNonEmptyString(brainReference.brainId)) {
    throw new Error(`${description} must include a non-empty brainId.`);
  }

  if (!isNonEmptyString(brainReference.providerId)) {
    throw new Error(`${description} must include a non-empty providerId.`);
  }

  if (!isNonEmptyString(brainReference.modelId)) {
    throw new Error(`${description} must include a non-empty modelId.`);
  }

  return {
    brainId: brainReference.brainId.trim(),
    providerId: brainReference.providerId.trim(),
    modelId: brainReference.modelId.trim(),
  };
}

export function assertExecutionProfileDefinition(definition) {
  if (!definition || typeof definition !== 'object') {
    throw new Error('Execution Profile definition must be an object.');
  }

  if (definition.kind !== 'execution_profile_definition') {
    throw new Error('Execution Profile definition must include kind "execution_profile_definition".');
  }

  if (!Number.isInteger(definition.version) || definition.version < 1) {
    throw new Error('Execution Profile definition must include an integer version greater than or equal to 1.');
  }

  if (!isNonEmptyString(definition.executionProfileId)) {
    throw new Error('Execution Profile definition must include a non-empty executionProfileId.');
  }

  if (!isNonEmptyString(definition.executionMode)) {
    throw new Error('Execution Profile definition must include a non-empty executionMode.');
  }

  const executionMode = definition.executionMode.trim();

  if (!EXECUTION_PROFILE_MODES.has(executionMode)) {
    throw new Error(`Execution Profile definition has an invalid executionMode: ${executionMode}`);
  }

  const primaryBrain = assertBrainReference(
    definition.primaryBrain,
    'Execution Profile definition primaryBrain',
  );

  const fallbackBrain = definition.fallbackBrain === undefined || definition.fallbackBrain === null
    ? null
    : assertBrainReference(
      definition.fallbackBrain,
      'Execution Profile definition fallbackBrain',
    );

  const enabledCommands = definition.enabledCommands === undefined
    ? []
    : assertUniqueStringArray(definition.enabledCommands, 'Execution Profile definition enabledCommands');

  return {
    kind: definition.kind,
    version: definition.version,
    executionProfileId: definition.executionProfileId.trim(),
    executionMode,
    primaryBrain,
    fallbackBrain,
    enabledCommands,
  };
}

export function assertBrainSelection(brainSelection) {
  if (!brainSelection || typeof brainSelection !== 'object') {
    throw new Error('Brain selection must be an object.');
  }

  if (!isNonEmptyString(brainSelection.selectionSource)) {
    throw new Error('Brain selection must include a non-empty selectionSource.');
  }

  if (typeof brainSelection.brainRequired !== 'boolean') {
    throw new Error('Brain selection must include a boolean brainRequired.');
  }

  return {
    selectedBrain: brainSelection.selectedBrain === null
      ? null
      : assertBrainReference(brainSelection.selectedBrain, 'Brain selection selectedBrain'),
    fallbackBrain: brainSelection.fallbackBrain === null || brainSelection.fallbackBrain === undefined
      ? null
      : assertBrainReference(brainSelection.fallbackBrain, 'Brain selection fallbackBrain'),
    selectionSource: brainSelection.selectionSource.trim(),
    brainRequired: brainSelection.brainRequired,
  };
}
