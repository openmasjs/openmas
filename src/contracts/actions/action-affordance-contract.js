import { assertActionIntentMetadata } from './action-intent-metadata-contract.js';

const ACTION_AFFORDANCE_SOURCE_TYPES = new Set([
  'tool_definition',
  'workflow_runtime_definition',
]);

const ACTION_AFFORDANCE_TARGET_TYPES = new Set([
  'tool',
  'workflow',
]);

const ACTION_AFFORDANCE_TARGET_ACTION_TYPES = new Set([
  'tool_execution',
  'workflow_execution',
]);

const ACTION_AFFORDANCE_LIFECYCLE_STATES = new Set([
  'draft',
  'active',
  'disabled',
  'deprecated',
  'archived',
]);

const ACTION_AFFORDANCE_SIDE_EFFECT_LEVELS = new Set([
  'read_only',
  'write_internal',
  'write_external',
  'publish_external',
  'financial',
  'destructive',
]);

const ACTION_AFFORDANCE_READINESS_STATUSES = new Set([
  'not_evaluated',
  'ready',
  'approval_required',
  'denied',
  'unavailable',
]);

const ACTION_AFFORDANCE_READINESS_SOURCES = new Set([
  'none',
  'tool_readiness_evaluation',
  'workflow_lifecycle',
]);

const SAFE_AFFORDANCE_ID_PATTERN = /^[a-zA-Z0-9._:-]+$/u;
const SAFE_SOURCE_PATH_PATTERN = /^[a-zA-Z0-9._/-]+$/u;

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

function assertSafeIdentifier(value, description) {
  if (!isNonEmptyString(value)) {
    throw new Error(`${description} must be a non-empty string.`);
  }

  const normalizedValue = value.trim();

  if (!SAFE_AFFORDANCE_ID_PATTERN.test(normalizedValue)) {
    throw new Error(`${description} contains unsafe characters: ${normalizedValue}`);
  }

  return normalizedValue;
}

function assertNullableString(value, description) {
  if (value === undefined || value === null) {
    return null;
  }

  if (!isNonEmptyString(value)) {
    throw new Error(`${description} must be a non-empty string when provided.`);
  }

  return value.trim();
}

function assertNullableSideEffectLevel(value, description) {
  if (value === undefined || value === null) {
    return null;
  }

  return assertEnumValue(value, ACTION_AFFORDANCE_SIDE_EFFECT_LEVELS, description);
}

function assertSourcePath(value, description) {
  if (!isNonEmptyString(value)) {
    throw new Error(`${description} must be a non-empty string.`);
  }

  const normalizedValue = value.trim().replaceAll('\\', '/');

  if (
    !normalizedValue.startsWith('instance/')
    || normalizedValue.startsWith('/')
    || normalizedValue.includes('..')
    || normalizedValue.includes('//')
    || !SAFE_SOURCE_PATH_PATTERN.test(normalizedValue)
  ) {
    throw new Error(`${description} must be a bounded instance-relative source path.`);
  }

  return normalizedValue;
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

function assertNonNegativeInteger(value, description) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${description} must be a non-negative integer.`);
  }

  return value;
}

function assertOptionalMetadata(value, description) {
  if (value === undefined || value === null) {
    return {};
  }

  if (!isPlainObject(value)) {
    throw new Error(`${description} must be an object when provided.`);
  }

  return { ...value };
}

function assertNullableIntentMetadata(metadata, affordance) {
  if (metadata === undefined || metadata === null) {
    return null;
  }

  return assertActionIntentMetadata(metadata, {
    targetType: affordance.targetType,
    targetActionType: affordance.targetActionType,
    targetId: affordance.targetId,
    expectedSideEffectLevel: affordance.sideEffectLevel ?? undefined,
  });
}

function assertAffordanceConsistency(affordance) {
  if (affordance.sourceType === 'tool_definition') {
    if (affordance.targetType !== 'tool') {
      throw new Error('Tool action affordance must target type "tool".');
    }

    if (affordance.targetActionType !== 'tool_execution') {
      throw new Error('Tool action affordance must use targetActionType "tool_execution".');
    }

    if (affordance.sideEffectLevel === null) {
      throw new Error('Tool action affordance must include sideEffectLevel.');
    }
  }

  if (affordance.sourceType === 'workflow_runtime_definition') {
    if (affordance.targetType !== 'workflow') {
      throw new Error('Workflow action affordance must target type "workflow".');
    }

    if (affordance.targetActionType !== 'workflow_execution') {
      throw new Error('Workflow action affordance must use targetActionType "workflow_execution".');
    }
  }
}

export function assertActionAffordanceReadinessSummary(summary) {
  if (!isPlainObject(summary)) {
    throw new Error('Action affordance readiness summary must be an object.');
  }

  if (summary.kind !== 'action_affordance_readiness_summary') {
    throw new Error('Action affordance readiness summary must include kind "action_affordance_readiness_summary".');
  }

  if (summary.version !== 1) {
    throw new Error('Action affordance readiness summary version must be 1.');
  }

  if (!isNonEmptyString(summary.reason)) {
    throw new Error('Action affordance readiness summary reason must be a non-empty string.');
  }

  const normalizedSummary = {
    kind: 'action_affordance_readiness_summary',
    version: 1,
    status: assertEnumValue(
      summary.status,
      ACTION_AFFORDANCE_READINESS_STATUSES,
      'Action affordance readiness summary status',
    ),
    source: assertEnumValue(
      summary.source,
      ACTION_AFFORDANCE_READINESS_SOURCES,
      'Action affordance readiness summary source',
    ),
    approvalRequired: typeof summary.approvalRequired === 'boolean'
      ? summary.approvalRequired
      : (() => {
        throw new Error('Action affordance readiness summary approvalRequired must be a boolean.');
      })(),
    reason: summary.reason.trim(),
    matchedBindingCount: assertNonNegativeInteger(
      summary.matchedBindingCount ?? 0,
      'Action affordance readiness summary matchedBindingCount',
    ),
    missingRequirementCount: assertNonNegativeInteger(
      summary.missingRequirementCount ?? 0,
      'Action affordance readiness summary missingRequirementCount',
    ),
    warnings: assertStringArray(
      summary.warnings ?? [],
      'Action affordance readiness summary warnings',
    ),
  };

  if (normalizedSummary.status === 'ready' && normalizedSummary.approvalRequired) {
    throw new Error('Ready action affordance readiness summary must not require approval.');
  }

  if (normalizedSummary.status === 'approval_required' && !normalizedSummary.approvalRequired) {
    throw new Error('Approval-required action affordance readiness summary must require approval.');
  }

  return normalizedSummary;
}

export function assertActionAffordance(affordance) {
  if (!isPlainObject(affordance)) {
    throw new Error('Action affordance must be an object.');
  }

  if (affordance.kind !== 'action_affordance') {
    throw new Error('Action affordance must include kind "action_affordance".');
  }

  if (affordance.version !== 1) {
    throw new Error('Action affordance version must be 1.');
  }

  const sourceType = assertEnumValue(
    affordance.sourceType,
    ACTION_AFFORDANCE_SOURCE_TYPES,
    'Action affordance sourceType',
  );
  const targetType = assertEnumValue(
    affordance.targetType,
    ACTION_AFFORDANCE_TARGET_TYPES,
    'Action affordance targetType',
  );
  const targetActionType = assertEnumValue(
    affordance.targetActionType,
    ACTION_AFFORDANCE_TARGET_ACTION_TYPES,
    'Action affordance targetActionType',
  );
  const targetId = assertSafeIdentifier(affordance.targetId, 'Action affordance targetId');
  const sideEffectLevel = assertNullableSideEffectLevel(
    affordance.sideEffectLevel,
    'Action affordance sideEffectLevel',
  );

  const normalizedAffordance = {
    kind: 'action_affordance',
    version: 1,
    affordanceId: assertSafeIdentifier(affordance.affordanceId, 'Action affordance affordanceId'),
    sourceType,
    sourcePath: assertSourcePath(affordance.sourcePath, 'Action affordance sourcePath'),
    targetActionType,
    targetType,
    targetId,
    displayName: assertNullableString(affordance.displayName, 'Action affordance displayName'),
    description: assertNullableString(affordance.description, 'Action affordance description'),
    owner: assertNullableString(affordance.owner, 'Action affordance owner'),
    lifecycleState: assertEnumValue(
      affordance.lifecycleState,
      ACTION_AFFORDANCE_LIFECYCLE_STATES,
      'Action affordance lifecycleState',
    ),
    sideEffectLevel,
    executionMode: assertNullableString(affordance.executionMode, 'Action affordance executionMode'),
    intentMetadata: null,
    readinessSummary: assertActionAffordanceReadinessSummary(affordance.readinessSummary),
    warnings: assertStringArray(affordance.warnings ?? [], 'Action affordance warnings'),
    metadata: assertOptionalMetadata(affordance.metadata, 'Action affordance metadata'),
  };

  normalizedAffordance.intentMetadata = assertNullableIntentMetadata(
    affordance.intentMetadata,
    normalizedAffordance,
  );

  assertAffordanceConsistency(normalizedAffordance);

  return normalizedAffordance;
}

export function assertActionAffordances(affordances) {
  if (!Array.isArray(affordances)) {
    throw new Error('Action affordances must be an array.');
  }

  const seenAffordanceIds = new Set();

  return affordances.map((affordance) => {
    const normalizedAffordance = assertActionAffordance(affordance);

    if (seenAffordanceIds.has(normalizedAffordance.affordanceId)) {
      throw new Error(`Action affordances contain a duplicated affordanceId: ${normalizedAffordance.affordanceId}`);
    }

    seenAffordanceIds.add(normalizedAffordance.affordanceId);
    return normalizedAffordance;
  });
}

export {
  ACTION_AFFORDANCE_LIFECYCLE_STATES,
  ACTION_AFFORDANCE_READINESS_SOURCES,
  ACTION_AFFORDANCE_READINESS_STATUSES,
  ACTION_AFFORDANCE_SIDE_EFFECT_LEVELS,
  ACTION_AFFORDANCE_SOURCE_TYPES,
  ACTION_AFFORDANCE_TARGET_ACTION_TYPES,
  ACTION_AFFORDANCE_TARGET_TYPES,
};
