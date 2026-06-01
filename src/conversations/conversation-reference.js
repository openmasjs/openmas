const SAFE_CONVERSATION_REFERENCE_PATTERN = /^[a-z0-9._-]+$/u;
const MAX_CONVERSATION_REFERENCE_LENGTH = 80;

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function slugifyConversationReference(value) {
  return value
    .trim()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, '-')
    .replace(/-+/gu, '-')
    .replace(/^[._-]+|[._-]+$/gu, '');
}

export function normalizeConversationReference(value, description = 'Conversation reference') {
  if (!isNonEmptyString(value)) {
    throw new Error(`${description} must be a non-empty string.`);
  }

  const normalizedReference = slugifyConversationReference(value);

  if (!isNonEmptyString(normalizedReference)) {
    throw new Error(`${description} must contain at least one safe identifier character.`);
  }

  if (normalizedReference.length > MAX_CONVERSATION_REFERENCE_LENGTH) {
    throw new Error(`${description} exceeds ${MAX_CONVERSATION_REFERENCE_LENGTH} characters after normalization.`);
  }

  if (!SAFE_CONVERSATION_REFERENCE_PATTERN.test(normalizedReference)) {
    throw new Error(`${description} contains unsafe characters after normalization: ${normalizedReference}`);
  }

  return normalizedReference;
}

export function normalizeOptionalConversationReference(value, description = 'Conversation reference') {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  return normalizeConversationReference(value, description);
}
