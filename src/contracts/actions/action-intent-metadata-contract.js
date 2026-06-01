const ACTION_INTENT_METADATA_TARGET_ACTION_TYPES = new Set([
  'tool_execution',
  'workflow_execution',
  'command_execution',
  'approval_resume',
  'handoff',
  'channel_delivery',
  'memory_recall',
  'answer_only',
  'conversation_reply',
]);

const ACTION_INTENT_METADATA_TARGET_TYPES = new Set([
  'tool',
  'workflow',
  'command',
  'approval',
  'handoff',
  'memory',
  'conversation',
  'channel',
]);

const ACTION_INTENT_METADATA_REQUEST_TYPES = new Set([
  'answer',
  'greeting',
  'capability_question',
  'explanation_request',
  'acknowledgment',
  'plan_request',
  'memory_recall',
  'diagnostic',
  'tool_action',
  'workflow_action',
  'mutation',
  'approval',
  'handoff',
  'conversation',
  'unknown',
]);

const ACTION_INTENT_METADATA_SIDE_EFFECT_LEVELS = new Set([
  'read_only',
  'write_internal',
  'write_external',
  'publish_external',
  'financial',
  'destructive',
]);

const SAFE_IDENTIFIER_PATTERN = /^[a-zA-Z0-9._-]+$/u;
const SAFE_TAG_PATTERN = /^[a-z0-9][a-z0-9._:-]*$/u;

const MAX_TAGS = 24;
const MAX_REQUEST_TYPES = 8;
const MAX_GUIDANCE_ITEMS = 12;
const MAX_EXAMPLES = 10;
const MAX_GUIDANCE_LENGTH = 260;

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

  if (!SAFE_IDENTIFIER_PATTERN.test(normalizedValue)) {
    throw new Error(`${description} contains unsafe characters: ${normalizedValue}`);
  }

  return normalizedValue;
}

function assertBoundedString(value, description, maxLength) {
  if (!isNonEmptyString(value)) {
    throw new Error(`${description} must be a non-empty string.`);
  }

  const normalizedValue = value.trim();

  if (normalizedValue.length > maxLength) {
    throw new Error(`${description} must be ${maxLength} characters or less.`);
  }

  return normalizedValue;
}

function assertStringArray(values, description, {
  allowEmpty = true,
  allowedValues = null,
  maxItems = MAX_GUIDANCE_ITEMS,
  maxLength = MAX_GUIDANCE_LENGTH,
  safeTag = false,
} = {}) {
  if (!Array.isArray(values)) {
    throw new Error(`${description} must be an array.`);
  }

  if (!allowEmpty && values.length === 0) {
    throw new Error(`${description} must include at least one value.`);
  }

  if (values.length > maxItems) {
    throw new Error(`${description} must include ${maxItems} items or fewer.`);
  }

  const seenValues = new Set();

  return values.map((value, index) => {
    const normalizedValue = assertBoundedString(
      value,
      `${description}[${index}]`,
      maxLength,
    );

    if (allowedValues && !allowedValues.has(normalizedValue)) {
      throw new Error(`${description}[${index}] is invalid: ${normalizedValue}`);
    }

    if (safeTag && !SAFE_TAG_PATTERN.test(normalizedValue)) {
      throw new Error(`${description}[${index}] contains unsafe tag characters: ${normalizedValue}`);
    }

    if (seenValues.has(normalizedValue)) {
      throw new Error(`${description} contains a duplicated value: ${normalizedValue}`);
    }

    seenValues.add(normalizedValue);
    return normalizedValue;
  });
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

function assertClassificationGuidance(guidance) {
  if (guidance === undefined || guidance === null) {
    return {
      highConfidenceSignals: [],
      ambiguitySignals: [],
      negativeSignals: [],
      requiredContextKeys: [],
    };
  }

  if (!isPlainObject(guidance)) {
    throw new Error('Action intent metadata classificationGuidance must be an object when provided.');
  }

  return {
    highConfidenceSignals: assertStringArray(
      guidance.highConfidenceSignals ?? [],
      'Action intent metadata classificationGuidance.highConfidenceSignals',
    ),
    ambiguitySignals: assertStringArray(
      guidance.ambiguitySignals ?? [],
      'Action intent metadata classificationGuidance.ambiguitySignals',
    ),
    negativeSignals: assertStringArray(
      guidance.negativeSignals ?? [],
      'Action intent metadata classificationGuidance.negativeSignals',
    ),
    requiredContextKeys: assertStringArray(
      guidance.requiredContextKeys ?? [],
      'Action intent metadata classificationGuidance.requiredContextKeys',
      {
        maxItems: MAX_GUIDANCE_ITEMS,
        maxLength: 80,
        safeTag: true,
      },
    ),
  };
}

function assertContextConsistency(metadata, context) {
  if (!context || Object.keys(context).length === 0) {
    return;
  }

  if (context.targetType && metadata.targetType !== context.targetType) {
    throw new Error(`Action intent metadata targetType must match ${context.targetType}.`);
  }

  if (context.targetId && metadata.targetId !== context.targetId) {
    throw new Error(`Action intent metadata targetId must match ${context.targetId}.`);
  }

  if (context.targetActionType && metadata.targetActionType !== context.targetActionType) {
    throw new Error(`Action intent metadata targetActionType must match ${context.targetActionType}.`);
  }

  if (context.expectedSideEffectLevel && metadata.expectedSideEffectLevel !== context.expectedSideEffectLevel) {
    throw new Error(`Action intent metadata expectedSideEffectLevel must match ${context.expectedSideEffectLevel}.`);
  }
}

export function assertActionIntentMetadata(metadata, context = {}) {
  if (metadata === undefined || metadata === null) {
    return null;
  }

  if (!isPlainObject(metadata)) {
    throw new Error('Action intent metadata must be an object when provided.');
  }

  if (metadata.kind !== 'action_intent_metadata') {
    throw new Error('Action intent metadata must include kind "action_intent_metadata".');
  }

  if (metadata.version !== 1) {
    throw new Error('Action intent metadata version must be 1.');
  }

  const normalizedMetadata = {
    kind: 'action_intent_metadata',
    version: 1,
    primaryIntentId: assertSafeIdentifier(
      metadata.primaryIntentId,
      'Action intent metadata primaryIntentId',
    ),
    targetActionType: assertEnumValue(
      metadata.targetActionType,
      ACTION_INTENT_METADATA_TARGET_ACTION_TYPES,
      'Action intent metadata targetActionType',
    ),
    targetType: assertEnumValue(
      metadata.targetType,
      ACTION_INTENT_METADATA_TARGET_TYPES,
      'Action intent metadata targetType',
    ),
    targetId: assertSafeIdentifier(
      metadata.targetId,
      'Action intent metadata targetId',
    ),
    expectedSideEffectLevel: assertEnumValue(
      metadata.expectedSideEffectLevel,
      ACTION_INTENT_METADATA_SIDE_EFFECT_LEVELS,
      'Action intent metadata expectedSideEffectLevel',
    ),
    requestTypes: assertStringArray(
      metadata.requestTypes,
      'Action intent metadata requestTypes',
      {
        allowEmpty: false,
        allowedValues: ACTION_INTENT_METADATA_REQUEST_TYPES,
        maxItems: MAX_REQUEST_TYPES,
        maxLength: 80,
      },
    ),
    semanticTags: assertStringArray(
      metadata.semanticTags,
      'Action intent metadata semanticTags',
      {
        allowEmpty: false,
        maxItems: MAX_TAGS,
        maxLength: 80,
        safeTag: true,
      },
    ),
    whenToUse: assertStringArray(
      metadata.whenToUse,
      'Action intent metadata whenToUse',
      { allowEmpty: false },
    ),
    whenNotToUse: assertStringArray(
      metadata.whenNotToUse ?? [],
      'Action intent metadata whenNotToUse',
    ),
    exampleRequests: assertStringArray(
      metadata.exampleRequests ?? [],
      'Action intent metadata exampleRequests',
      {
        maxItems: MAX_EXAMPLES,
        maxLength: MAX_GUIDANCE_LENGTH,
      },
    ),
    classificationGuidance: assertClassificationGuidance(metadata.classificationGuidance),
    metadata: assertOptionalMetadata(metadata.metadata, 'Action intent metadata metadata'),
  };

  assertContextConsistency(normalizedMetadata, context);

  return normalizedMetadata;
}

export {
  ACTION_INTENT_METADATA_REQUEST_TYPES,
  ACTION_INTENT_METADATA_SIDE_EFFECT_LEVELS,
  ACTION_INTENT_METADATA_TARGET_ACTION_TYPES,
  ACTION_INTENT_METADATA_TARGET_TYPES,
};
