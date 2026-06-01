import { assertPromptBudgetPolicy } from './prompt-budget-contract.js';

const PROMPT_PROFILE_LIFECYCLE_STATES = new Set([
  'active',
  'draft',
  'disabled',
  'archived',
]);

const PROMPT_PROFILE_FIELDS = new Set([
  'kind',
  'version',
  'promptProfileId',
  'promptStackVersionId',
  'displayName',
  'description',
  'lifecycleState',
  'selectionPriority',
  'selectionCriteria',
  'promptBudgetPolicy',
  'warnings',
]);

const PROMPT_PROFILE_SELECTION_CRITERIA_FIELDS = new Set([
  'operationalIdentityIds',
  'cognitiveIdentityIds',
  'commands',
  'invocationModes',
  'executionModes',
  'providerIds',
  'modelIds',
]);

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function assertAllowedFields(value, allowedFields, description) {
  for (const fieldName of Object.keys(value)) {
    if (!allowedFields.has(fieldName)) {
      throw new Error(`${description} contains an unsupported field: ${fieldName}.`);
    }
  }
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

  const normalizedValues = values.map((value, index) => {
    if (!isNonEmptyString(value)) {
      throw new Error(`${description}[${index}] must be a non-empty string.`);
    }

    return value.trim();
  });

  return [...new Set(normalizedValues)];
}

function assertSelectionCriteria(selectionCriteria = {}) {
  if (!selectionCriteria || typeof selectionCriteria !== 'object' || Array.isArray(selectionCriteria)) {
    throw new Error('Prompt profile selectionCriteria must be an object.');
  }

  assertAllowedFields(
    selectionCriteria,
    PROMPT_PROFILE_SELECTION_CRITERIA_FIELDS,
    'Prompt profile selectionCriteria',
  );

  return {
    operationalIdentityIds: assertStringArray(
      selectionCriteria.operationalIdentityIds ?? [],
      'Prompt profile selectionCriteria operationalIdentityIds',
    ),
    cognitiveIdentityIds: assertStringArray(
      selectionCriteria.cognitiveIdentityIds ?? [],
      'Prompt profile selectionCriteria cognitiveIdentityIds',
    ),
    commands: assertStringArray(
      selectionCriteria.commands ?? [],
      'Prompt profile selectionCriteria commands',
    ),
    invocationModes: assertStringArray(
      selectionCriteria.invocationModes ?? [],
      'Prompt profile selectionCriteria invocationModes',
    ),
    executionModes: assertStringArray(
      selectionCriteria.executionModes ?? [],
      'Prompt profile selectionCriteria executionModes',
    ),
    providerIds: assertStringArray(
      selectionCriteria.providerIds ?? [],
      'Prompt profile selectionCriteria providerIds',
    ),
    modelIds: assertStringArray(
      selectionCriteria.modelIds ?? [],
      'Prompt profile selectionCriteria modelIds',
    ),
  };
}

export function assertPromptProfileDefinition(profile) {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
    throw new Error('Prompt profile definition must be an object.');
  }

  assertAllowedFields(profile, PROMPT_PROFILE_FIELDS, 'Prompt profile definition');

  if (!isNonEmptyString(profile.kind) || profile.kind.trim() !== 'prompt_profile_definition') {
    throw new Error('Prompt profile definition kind must be prompt_profile_definition.');
  }

  if (profile.version !== 1) {
    throw new Error('Prompt profile definition version must be 1.');
  }

  if (!isNonEmptyString(profile.promptProfileId)) {
    throw new Error('Prompt profile definition must include a non-empty promptProfileId.');
  }

  if (!isNonEmptyString(profile.promptStackVersionId)) {
    throw new Error('Prompt profile definition must include a non-empty promptStackVersionId.');
  }

  if (!isNonEmptyString(profile.lifecycleState)) {
    throw new Error('Prompt profile definition must include a non-empty lifecycleState.');
  }

  const lifecycleState = profile.lifecycleState.trim();

  if (!PROMPT_PROFILE_LIFECYCLE_STATES.has(lifecycleState)) {
    throw new Error(`Prompt profile definition contains an invalid lifecycleState: ${lifecycleState}.`);
  }

  return {
    kind: 'prompt_profile_definition',
    version: 1,
    promptProfileId: profile.promptProfileId.trim(),
    promptStackVersionId: profile.promptStackVersionId.trim(),
    displayName: isNonEmptyString(profile.displayName) ? profile.displayName.trim() : null,
    description: isNonEmptyString(profile.description) ? profile.description.trim() : null,
    lifecycleState,
    selectionPriority: assertNonNegativeInteger(
      profile.selectionPriority ?? 0,
      'Prompt profile definition selectionPriority',
    ),
    selectionCriteria: assertSelectionCriteria(profile.selectionCriteria ?? {}),
    promptBudgetPolicy: profile.promptBudgetPolicy
      ? assertPromptBudgetPolicy(profile.promptBudgetPolicy)
      : null,
    warnings: assertStringArray(profile.warnings ?? [], 'Prompt profile definition warnings'),
  };
}

export {
  PROMPT_PROFILE_LIFECYCLE_STATES,
};
