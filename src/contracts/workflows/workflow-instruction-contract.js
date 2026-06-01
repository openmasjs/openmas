const WORKFLOW_LIFECYCLE_STATES = new Set([
  'active',
  'draft',
  'disabled',
  'archived',
]);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
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

function assertStringArray(values, description, { allowEmpty = true } = {}) {
  if (!Array.isArray(values)) {
    throw new Error(`${description} must be an array.`);
  }

  if (!allowEmpty && values.length === 0) {
    throw new Error(`${description} must include at least one value.`);
  }

  const seenValues = new Set();

  return values.map((value, index) => {
    if (!isNonEmptyString(value)) {
      throw new Error(`${description}[${index}] must be a non-empty string.`);
    }

    const normalizedValue = value.trim();

    if (seenValues.has(normalizedValue)) {
      throw new Error(`${description} contains a duplicated value: ${normalizedValue}`);
    }

    seenValues.add(normalizedValue);
    return normalizedValue;
  });
}

export function assertWorkflowInstructionDefinition(definition) {
  if (!isPlainObject(definition)) {
    throw new Error('Workflow instruction definition must be an object.');
  }

  if (definition.kind !== 'workflow_instruction_definition') {
    throw new Error('Workflow instruction definition must include kind "workflow_instruction_definition".');
  }

  if (!Number.isInteger(definition.version) || definition.version < 1) {
    throw new Error('Workflow instruction definition must include an integer version greater than or equal to 1.');
  }

  if (!isNonEmptyString(definition.workflowId)) {
    throw new Error('Workflow instruction definition must include a non-empty workflowId.');
  }

  if (!isNonEmptyString(definition.displayName)) {
    throw new Error('Workflow instruction definition must include a non-empty displayName.');
  }

  return {
    kind: definition.kind,
    version: definition.version,
    workflowId: definition.workflowId.trim(),
    displayName: definition.displayName.trim(),
    lifecycleState: assertEnumValue(
      definition.lifecycleState,
      WORKFLOW_LIFECYCLE_STATES,
      'Workflow instruction definition lifecycleState',
    ),
    description: isNonEmptyString(definition.description) ? definition.description.trim() : null,
    commandTriggers: assertStringArray(
      definition.commandTriggers ?? [],
      'Workflow instruction definition commandTriggers',
      { allowEmpty: false },
    ),
    operationalIdentityIds: assertStringArray(
      definition.operationalIdentityIds ?? [],
      'Workflow instruction definition operationalIdentityIds',
    ),
    cognitiveIdentityIds: assertStringArray(
      definition.cognitiveIdentityIds ?? [],
      'Workflow instruction definition cognitiveIdentityIds',
    ),
  };
}

export {
  WORKFLOW_LIFECYCLE_STATES,
};
