const INTENT_RESOLUTION_STATUSES = new Set([
  'no_intent',
  'resolved',
  'ambiguous',
  'blocked',
  'skipped',
]);

const INTENT_RESOLUTION_SOURCES = new Set([
  'none',
  'runtime_pattern',
  'brain_request',
  'semantic_classifier',
]);

const INTENT_TARGET_TYPES = new Set([
  'tool',
  'workflow',
]);

const INTENT_CONFIDENCE_LEVELS = new Set([
  'low',
  'medium',
  'high',
]);

const INTENT_RUNTIME_ACTIONS = new Set([
  'none',
  'answer_only',
  'queue_tool_request',
  'queue_workflow_request',
  'ask_clarification',
  'reject',
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

function assertNullableEnumValue(value, allowedValues, description) {
  if (value === undefined || value === null) {
    return null;
  }

  return assertEnumValue(value, allowedValues, description);
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

function assertNullableIntentTarget(target, status) {
  if (target === undefined || target === null) {
    if (status === 'resolved' || status === 'blocked') {
      throw new Error(`Intent resolution with status "${status}" must include target.`);
    }

    return null;
  }

  if (!isPlainObject(target)) {
    throw new Error('Intent resolution target must be an object.');
  }

  return {
    targetType: assertEnumValue(
      target.targetType,
      INTENT_TARGET_TYPES,
      'Intent resolution target targetType',
    ),
    targetId: (() => {
      if (!isNonEmptyString(target.targetId)) {
        throw new Error('Intent resolution target targetId must be a non-empty string.');
      }

      return target.targetId.trim();
    })(),
  };
}

function assertResolutionConsistency(resolution) {
  if (resolution.status === 'resolved') {
    if (!resolution.intentId || !resolution.intentType || !resolution.target) {
      throw new Error('Resolved intent resolution requires intentId, intentType, and target.');
    }

    if (!resolution.confidence) {
      throw new Error('Resolved intent resolution requires confidence.');
    }

    if (resolution.target.targetType === 'tool') {
      if (!['queue_tool_request', 'answer_only'].includes(resolution.runtimeAction)) {
        throw new Error('Resolved tool intent must use queue_tool_request or answer_only runtimeAction.');
      }
    }

    if (resolution.target.targetType === 'workflow') {
      if (!['queue_workflow_request', 'answer_only'].includes(resolution.runtimeAction)) {
        throw new Error('Resolved workflow intent must use queue_workflow_request or answer_only runtimeAction.');
      }
    }
  }

  if (resolution.status === 'no_intent' || resolution.status === 'skipped') {
    if (
      resolution.intentId !== null
      || resolution.intentType !== null
      || resolution.confidence !== null
      || resolution.target !== null
      || resolution.runtimeAction !== 'none'
    ) {
      throw new Error(`${resolution.status} intent resolution must not include executable intent data.`);
    }
  }

  if (resolution.status === 'ambiguous' && resolution.runtimeAction !== 'ask_clarification') {
    throw new Error('Ambiguous intent resolution must ask for clarification.');
  }

  if (resolution.status === 'blocked' && resolution.runtimeAction !== 'reject') {
    throw new Error('Blocked intent resolution must reject execution.');
  }
}

export function assertIntentResolution(resolution) {
  if (!isPlainObject(resolution)) {
    throw new Error('Intent resolution must be an object.');
  }

  if (resolution.kind !== 'intent_resolution') {
    throw new Error('Intent resolution must include kind "intent_resolution".');
  }

  if (resolution.version !== 1) {
    throw new Error('Intent resolution version must be 1.');
  }

  const status = assertEnumValue(
    resolution.status,
    INTENT_RESOLUTION_STATUSES,
    'Intent resolution status',
  );
  const source = assertEnumValue(
    resolution.source,
    INTENT_RESOLUTION_SOURCES,
    'Intent resolution source',
  );
  const runtimeAction = assertEnumValue(
    resolution.runtimeAction,
    INTENT_RUNTIME_ACTIONS,
    'Intent resolution runtimeAction',
  );

  if (!isNonEmptyString(resolution.reason)) {
    throw new Error('Intent resolution must include a non-empty reason.');
  }

  const normalizedResolution = {
    kind: 'intent_resolution',
    version: 1,
    status,
    intentId: isNonEmptyString(resolution.intentId) ? resolution.intentId.trim() : null,
    intentType: isNonEmptyString(resolution.intentType) ? resolution.intentType.trim() : null,
    source,
    confidence: assertNullableEnumValue(
      resolution.confidence,
      INTENT_CONFIDENCE_LEVELS,
      'Intent resolution confidence',
    ),
    target: assertNullableIntentTarget(resolution.target, status),
    runtimeAction,
    reason: resolution.reason.trim(),
    evidence: assertStringArray(resolution.evidence ?? [], 'Intent resolution evidence'),
    warnings: assertStringArray(resolution.warnings ?? [], 'Intent resolution warnings'),
  };

  assertResolutionConsistency(normalizedResolution);

  return normalizedResolution;
}

export {
  INTENT_CONFIDENCE_LEVELS,
  INTENT_RESOLUTION_SOURCES,
  INTENT_RESOLUTION_STATUSES,
  INTENT_RUNTIME_ACTIONS,
  INTENT_TARGET_TYPES,
};
