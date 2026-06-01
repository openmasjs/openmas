const CONVERSATION_SESSION_STATUSES = new Set([
  'active',
  'paused',
  'closed',
  'archived',
]);

const CONVERSATION_VISIBILITY_LEVELS = new Set([
  'private_to_participants',
  'shared_with_mas',
]);

const SAFE_CONVERSATION_ID_PATTERN = /^[a-zA-Z0-9._-]+$/u;

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

  if (!SAFE_CONVERSATION_ID_PATTERN.test(normalizedValue)) {
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

function assertBoolean(value, description) {
  if (typeof value !== 'boolean') {
    throw new Error(`${description} must be a boolean.`);
  }

  return value;
}

function assertNonNegativeInteger(value, description) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${description} must be a non-negative integer.`);
  }

  return value;
}

function assertPositiveInteger(value, description) {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${description} must be an integer greater than or equal to 1.`);
  }

  return value;
}

function assertSafeIdentifierArray(values, description, { allowEmpty = false } = {}) {
  if (!Array.isArray(values)) {
    throw new Error(`${description} must be an array.`);
  }

  if (!allowEmpty && values.length === 0) {
    throw new Error(`${description} must include at least one value.`);
  }

  const seenValues = new Set();

  return values.map((value, index) => {
    const normalizedValue = assertSafeIdentifier(value, `${description}[${index}]`);

    if (seenValues.has(normalizedValue)) {
      throw new Error(`${description} contains a duplicated value: ${normalizedValue}`);
    }

    seenValues.add(normalizedValue);
    return normalizedValue;
  });
}

function assertConversationOwner(owner) {
  if (!isPlainObject(owner)) {
    throw new Error('Conversation session owner must be an object.');
  }

  if (owner.scope !== 'operational_identity') {
    throw new Error('Conversation session owner.scope must be "operational_identity".');
  }

  return {
    scope: 'operational_identity',
    operationalIdentityId: assertSafeIdentifier(
      owner.operationalIdentityId,
      'Conversation session owner operationalIdentityId',
    ),
  };
}

function assertConversationParticipants(participants) {
  if (!isPlainObject(participants)) {
    throw new Error('Conversation session participants must be an object.');
  }

  return {
    humanParticipantIds: assertSafeIdentifierArray(
      participants.humanParticipantIds ?? [],
      'Conversation session participants humanParticipantIds',
      { allowEmpty: false },
    ),
    operationalIdentityIds: assertSafeIdentifierArray(
      participants.operationalIdentityIds ?? [],
      'Conversation session participants operationalIdentityIds',
      { allowEmpty: false },
    ),
  };
}

function assertConversationPrivacy(privacy) {
  if (!isPlainObject(privacy)) {
    throw new Error('Conversation session privacy must be an object.');
  }

  return {
    visibility: assertEnumValue(
      privacy.visibility,
      CONVERSATION_VISIBILITY_LEVELS,
      'Conversation session privacy visibility',
    ),
    allowedOperationalIdentityIds: assertSafeIdentifierArray(
      privacy.allowedOperationalIdentityIds ?? [],
      'Conversation session privacy allowedOperationalIdentityIds',
      { allowEmpty: false },
    ),
  };
}

function assertConversationContextPolicy(contextPolicy) {
  if (contextPolicy === undefined || contextPolicy === null) {
    return {
      maxRecentTurns: 20,
      allowRawHistoryInPrompt: false,
    };
  }

  if (!isPlainObject(contextPolicy)) {
    throw new Error('Conversation session contextPolicy must be an object when provided.');
  }

  const allowRawHistoryInPrompt = assertBoolean(
    contextPolicy.allowRawHistoryInPrompt ?? false,
    'Conversation session contextPolicy allowRawHistoryInPrompt',
  );

  if (allowRawHistoryInPrompt) {
    throw new Error('Conversation session contextPolicy allowRawHistoryInPrompt must remain false in v1.');
  }

  return {
    maxRecentTurns: assertPositiveInteger(
      contextPolicy.maxRecentTurns ?? 20,
      'Conversation session contextPolicy maxRecentTurns',
    ),
    allowRawHistoryInPrompt,
  };
}

function assertConversationSummary(summary) {
  if (summary === undefined || summary === null) {
    return {
      status: 'none',
      text: null,
      updatedAt: null,
    };
  }

  if (!isPlainObject(summary)) {
    throw new Error('Conversation session summary must be an object when provided.');
  }

  const status = assertEnumValue(
    summary.status ?? 'none',
    new Set(['none', 'stale', 'current']),
    'Conversation session summary status',
  );
  const text = assertNullableString(summary.text, 'Conversation session summary text');

  if (status === 'none' && text !== null) {
    throw new Error('Conversation session summary with status "none" must not include text.');
  }

  if ((status === 'stale' || status === 'current') && text === null) {
    throw new Error(`Conversation session summary with status "${status}" must include text.`);
  }

  return {
    status,
    text,
    updatedAt: assertNullableString(summary.updatedAt, 'Conversation session summary updatedAt'),
  };
}

function assertSessionConsistency(session) {
  if (!session.participants.operationalIdentityIds.includes(session.owner.operationalIdentityId)) {
    throw new Error('Conversation session participants must include the owner Operational Identity.');
  }

  if (!session.privacy.allowedOperationalIdentityIds.includes(session.owner.operationalIdentityId)) {
    throw new Error('Conversation session privacy must allow the owner Operational Identity.');
  }

  for (const operationalIdentityId of session.privacy.allowedOperationalIdentityIds) {
    if (!session.participants.operationalIdentityIds.includes(operationalIdentityId)) {
      throw new Error(`Conversation session privacy references a non-participant Operational Identity: ${operationalIdentityId}`);
    }
  }

  if ((session.status === 'closed' || session.status === 'archived') && session.closedAt === null) {
    throw new Error(`Conversation session with status "${session.status}" must include closedAt.`);
  }

  if ((session.status === 'active' || session.status === 'paused') && session.closedAt !== null) {
    throw new Error(`Conversation session with status "${session.status}" must not include closedAt.`);
  }

  if (session.turnCount === 0 && session.lastTurnId !== null) {
    throw new Error('Conversation session with zero turns must not include lastTurnId.');
  }

  if (session.turnCount > 0 && session.lastTurnId === null) {
    throw new Error('Conversation session with turns must include lastTurnId.');
  }
}

export function assertConversationSession(session) {
  if (!isPlainObject(session)) {
    throw new Error('Conversation session must be an object.');
  }

  if (session.kind !== 'conversation_session') {
    throw new Error('Conversation session must include kind "conversation_session".');
  }

  if (session.version !== 1) {
    throw new Error('Conversation session version must be 1.');
  }

  const normalizedSession = {
    kind: 'conversation_session',
    version: 1,
    conversationId: assertSafeIdentifier(session.conversationId, 'Conversation session conversationId'),
    title: assertNullableString(session.title, 'Conversation session title'),
    status: assertEnumValue(session.status, CONVERSATION_SESSION_STATUSES, 'Conversation session status'),
    owner: assertConversationOwner(session.owner),
    participants: assertConversationParticipants(session.participants),
    privacy: assertConversationPrivacy(session.privacy),
    contextPolicy: assertConversationContextPolicy(session.contextPolicy),
    summary: assertConversationSummary(session.summary),
    turnCount: assertNonNegativeInteger(session.turnCount, 'Conversation session turnCount'),
    lastTurnId: assertNullableString(session.lastTurnId, 'Conversation session lastTurnId'),
    createdBy: assertSafeIdentifier(session.createdBy, 'Conversation session createdBy'),
    createdAt: assertRequiredString(session.createdAt, 'Conversation session createdAt'),
    updatedAt: assertRequiredString(session.updatedAt, 'Conversation session updatedAt'),
    closedAt: assertNullableString(session.closedAt, 'Conversation session closedAt'),
    warnings: Array.isArray(session.warnings)
      ? session.warnings.map((warning, index) => {
        return assertRequiredString(warning, `Conversation session warnings[${index}]`);
      })
      : [],
  };

  assertSessionConsistency(normalizedSession);

  return normalizedSession;
}

export function canOperationalIdentityReadConversation({
  conversationSession,
  operationalIdentityId,
}) {
  const normalizedSession = assertConversationSession(conversationSession);
  const normalizedOperationalIdentityId = assertSafeIdentifier(
    operationalIdentityId,
    'Conversation read operationalIdentityId',
  );

  if (normalizedSession.privacy.visibility === 'shared_with_mas') {
    return true;
  }

  return normalizedSession.privacy.allowedOperationalIdentityIds.includes(normalizedOperationalIdentityId);
}

export {
  CONVERSATION_SESSION_STATUSES,
  CONVERSATION_VISIBILITY_LEVELS,
};
