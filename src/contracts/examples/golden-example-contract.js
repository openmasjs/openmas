const GOLDEN_EXAMPLE_SET_LIFECYCLE_STATES = new Set([
  'active',
  'draft',
  'disabled',
  'archived',
]);

const ALLOWED_EXAMPLE_SET_FIELDS = new Set([
  'kind',
  'version',
  'exampleSetId',
  'displayName',
  'lifecycleState',
  'description',
  'commandTriggers',
  'operationalIdentityIds',
  'cognitiveIdentityIds',
  'examples',
]);

const ALLOWED_EXAMPLE_FIELDS = new Set([
  'exampleId',
  'title',
  'userInput',
  'idealOutput',
  'qualityCriteria',
  'antiPatterns',
]);

const DISALLOWED_POLICY_FIELD_NAMES = new Set([
  'policy',
  'policies',
  'policyInstructions',
  'rules',
  'constraints',
  'guardrails',
  'permissions',
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

function assertAllowedFields(payload, allowedFields, description) {
  for (const fieldName of Object.keys(payload)) {
    if (DISALLOWED_POLICY_FIELD_NAMES.has(fieldName)) {
      throw new Error(`${description} must not include policy-like field "${fieldName}". Policies belong in the Policy layer.`);
    }

    if (!allowedFields.has(fieldName)) {
      throw new Error(`${description} contains an unsupported field: ${fieldName}.`);
    }
  }
}

function assertExample(example, index) {
  const description = `Golden example set examples[${index}]`;

  if (!isPlainObject(example)) {
    throw new Error(`${description} must be an object.`);
  }

  assertAllowedFields(example, ALLOWED_EXAMPLE_FIELDS, description);

  if (!isNonEmptyString(example.exampleId)) {
    throw new Error(`${description} must include a non-empty exampleId.`);
  }

  if (!isNonEmptyString(example.title)) {
    throw new Error(`${description} must include a non-empty title.`);
  }

  if (!isNonEmptyString(example.userInput)) {
    throw new Error(`${description} must include non-empty userInput.`);
  }

  if (!isNonEmptyString(example.idealOutput)) {
    throw new Error(`${description} must include non-empty idealOutput.`);
  }

  return {
    exampleId: example.exampleId.trim(),
    title: example.title.trim(),
    userInput: example.userInput.trim(),
    idealOutput: example.idealOutput.trim(),
    qualityCriteria: assertStringArray(example.qualityCriteria ?? [], `${description} qualityCriteria`),
    antiPatterns: assertStringArray(example.antiPatterns ?? [], `${description} antiPatterns`),
  };
}

function assertExamples(examples) {
  if (!Array.isArray(examples)) {
    throw new Error('Golden example set must include an examples array.');
  }

  if (examples.length === 0) {
    throw new Error('Golden example set examples must include at least one example.');
  }

  const seenExampleIds = new Set();

  return examples.map((example, index) => {
    const normalizedExample = assertExample(example, index);

    if (seenExampleIds.has(normalizedExample.exampleId)) {
      throw new Error(`Golden example set contains a duplicated exampleId: ${normalizedExample.exampleId}`);
    }

    seenExampleIds.add(normalizedExample.exampleId);
    return normalizedExample;
  });
}

export function assertGoldenExampleSetDefinition(definition) {
  if (!isPlainObject(definition)) {
    throw new Error('Golden example set definition must be an object.');
  }

  assertAllowedFields(definition, ALLOWED_EXAMPLE_SET_FIELDS, 'Golden example set definition');

  if (definition.kind !== 'golden_example_set_definition') {
    throw new Error('Golden example set definition must include kind "golden_example_set_definition".');
  }

  if (!Number.isInteger(definition.version) || definition.version < 1) {
    throw new Error('Golden example set definition must include an integer version greater than or equal to 1.');
  }

  if (!isNonEmptyString(definition.exampleSetId)) {
    throw new Error('Golden example set definition must include a non-empty exampleSetId.');
  }

  if (!isNonEmptyString(definition.displayName)) {
    throw new Error('Golden example set definition must include a non-empty displayName.');
  }

  return {
    kind: definition.kind,
    version: definition.version,
    exampleSetId: definition.exampleSetId.trim(),
    displayName: definition.displayName.trim(),
    lifecycleState: assertEnumValue(
      definition.lifecycleState,
      GOLDEN_EXAMPLE_SET_LIFECYCLE_STATES,
      'Golden example set definition lifecycleState',
    ),
    description: isNonEmptyString(definition.description) ? definition.description.trim() : null,
    commandTriggers: assertStringArray(
      definition.commandTriggers ?? [],
      'Golden example set definition commandTriggers',
      { allowEmpty: false },
    ),
    operationalIdentityIds: assertStringArray(
      definition.operationalIdentityIds ?? [],
      'Golden example set definition operationalIdentityIds',
    ),
    cognitiveIdentityIds: assertStringArray(
      definition.cognitiveIdentityIds ?? [],
      'Golden example set definition cognitiveIdentityIds',
    ),
    examples: assertExamples(definition.examples),
  };
}

export {
  GOLDEN_EXAMPLE_SET_LIFECYCLE_STATES,
};
