const CONVERSATION_TURN_ROLES = new Set([
  'human',
  'operational_identity',
  'runtime',
]);

const CONVERSATION_TURN_CONTENT_TYPES = new Set([
  'text',
  'markdown',
  'runtime_summary',
  'event_summary',
]);

const CONVERSATION_TURN_SENSITIVITY_LEVELS = new Set([
  'public',
  'internal',
  'confidential',
  'restricted',
]);

const CONVERSATION_RUNTIME_REFERENCE_TYPES = new Set([
  'invocation',
  'tool_run',
  'workflow_run',
  'approval_request',
  'channel_delivery',
  'memory_writeback',
]);

const SAFE_CONVERSATION_TURN_ID_PATTERN = /^[a-zA-Z0-9._-]+$/u;
const MAX_CONVERSATION_TURN_TEXT_LENGTH = 32000;

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

  if (!SAFE_CONVERSATION_TURN_ID_PATTERN.test(normalizedValue)) {
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

function assertRequiredString(value, description) {
  if (!isNonEmptyString(value)) {
    throw new Error(`${description} must be a non-empty string.`);
  }

  return value.trim();
}

function assertPositiveInteger(value, description) {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${description} must be an integer greater than or equal to 1.`);
  }

  return value;
}

function assertSpeaker(speaker) {
  if (!isPlainObject(speaker)) {
    throw new Error('Conversation turn speaker must be an object.');
  }

  const speakerType = assertEnumValue(
    speaker.speakerType,
    CONVERSATION_TURN_ROLES,
    'Conversation turn speaker speakerType',
  );

  return {
    speakerType,
    speakerId: assertSafeIdentifier(speaker.speakerId, 'Conversation turn speaker speakerId'),
    displayName: assertNullableString(speaker.displayName, 'Conversation turn speaker displayName'),
  };
}

function assertTurnContent(content) {
  if (!isPlainObject(content)) {
    throw new Error('Conversation turn content must be an object.');
  }

  const text = assertRequiredString(content.text, 'Conversation turn content text');

  if (text.length > MAX_CONVERSATION_TURN_TEXT_LENGTH) {
    throw new Error(`Conversation turn content text exceeds ${MAX_CONVERSATION_TURN_TEXT_LENGTH} characters.`);
  }

  return {
    contentType: assertEnumValue(
      content.contentType,
      CONVERSATION_TURN_CONTENT_TYPES,
      'Conversation turn content contentType',
    ),
    text,
  };
}

function assertRuntimeReference(reference, index) {
  const description = `Conversation turn runtimeReferences[${index}]`;

  if (!isPlainObject(reference)) {
    throw new Error(`${description} must be an object.`);
  }

  return {
    referenceType: assertEnumValue(
      reference.referenceType,
      CONVERSATION_RUNTIME_REFERENCE_TYPES,
      `${description} referenceType`,
    ),
    referenceId: assertSafeIdentifier(reference.referenceId, `${description} referenceId`),
  };
}

function assertRuntimeReferences(references) {
  if (references === undefined || references === null) {
    return [];
  }

  if (!Array.isArray(references)) {
    throw new Error('Conversation turn runtimeReferences must be an array when provided.');
  }

  const seenReferences = new Set();

  return references.map((reference, index) => {
    const normalizedReference = assertRuntimeReference(reference, index);
    const referenceKey = `${normalizedReference.referenceType}:${normalizedReference.referenceId}`;

    if (seenReferences.has(referenceKey)) {
      throw new Error(`Conversation turn runtimeReferences contains a duplicated reference: ${referenceKey}`);
    }

    seenReferences.add(referenceKey);
    return normalizedReference;
  });
}

function assertTurnPrivacy(privacy) {
  if (privacy === undefined || privacy === null) {
    return {
      visibility: 'private_to_conversation',
      sensitivityLevel: 'internal',
    };
  }

  if (!isPlainObject(privacy)) {
    throw new Error('Conversation turn privacy must be an object when provided.');
  }

  return {
    visibility: assertEnumValue(
      privacy.visibility ?? 'private_to_conversation',
      new Set(['private_to_conversation']),
      'Conversation turn privacy visibility',
    ),
    sensitivityLevel: assertEnumValue(
      privacy.sensitivityLevel ?? 'internal',
      CONVERSATION_TURN_SENSITIVITY_LEVELS,
      'Conversation turn privacy sensitivityLevel',
    ),
  };
}

function assertTurnConsistency(turn) {
  if (turn.role !== turn.speaker.speakerType) {
    throw new Error('Conversation turn role must match speaker.speakerType.');
  }
}

export function assertConversationTurn(turn) {
  if (!isPlainObject(turn)) {
    throw new Error('Conversation turn must be an object.');
  }

  if (turn.kind !== 'conversation_turn') {
    throw new Error('Conversation turn must include kind "conversation_turn".');
  }

  if (turn.version !== 1) {
    throw new Error('Conversation turn version must be 1.');
  }

  const normalizedTurn = {
    kind: 'conversation_turn',
    version: 1,
    conversationId: assertSafeIdentifier(turn.conversationId, 'Conversation turn conversationId'),
    turnId: assertSafeIdentifier(turn.turnId, 'Conversation turn turnId'),
    sequenceNumber: assertPositiveInteger(turn.sequenceNumber, 'Conversation turn sequenceNumber'),
    role: assertEnumValue(turn.role, CONVERSATION_TURN_ROLES, 'Conversation turn role'),
    speaker: assertSpeaker(turn.speaker),
    content: assertTurnContent(turn.content),
    invocationId: assertNullableString(turn.invocationId, 'Conversation turn invocationId'),
    runtimeReferences: assertRuntimeReferences(turn.runtimeReferences),
    privacy: assertTurnPrivacy(turn.privacy),
    createdAt: assertRequiredString(turn.createdAt, 'Conversation turn createdAt'),
  };

  assertTurnConsistency(normalizedTurn);

  return normalizedTurn;
}

export {
  CONVERSATION_RUNTIME_REFERENCE_TYPES,
  CONVERSATION_TURN_CONTENT_TYPES,
  CONVERSATION_TURN_ROLES,
  CONVERSATION_TURN_SENSITIVITY_LEVELS,
  MAX_CONVERSATION_TURN_TEXT_LENGTH,
};
