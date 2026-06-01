const PROVIDER_REQUEST_TYPES = [
  'classify_intent',
  'generate_text',
];
const PROVIDER_REQUEST_TYPE_SET = new Set(PROVIDER_REQUEST_TYPES);

const PROVIDER_MESSAGE_ROLES = new Set([
  'system',
  'user',
  'assistant',
]);

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function assertProviderMessage(message, index) {
  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    throw new Error(`Provider request messages[${index}] must be an object.`);
  }

  if (!isNonEmptyString(message.role)) {
    throw new Error(`Provider request messages[${index}] must include a non-empty role.`);
  }

  const role = message.role.trim();

  if (!PROVIDER_MESSAGE_ROLES.has(role)) {
    throw new Error(`Provider request messages[${index}] has an invalid role: ${role}`);
  }

  if (!isNonEmptyString(message.content)) {
    throw new Error(`Provider request messages[${index}] must include a non-empty content.`);
  }

  return {
    role,
    content: message.content.trim(),
  };
}

function assertOptionalNumber(value, description) {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== 'number' || Number.isNaN(value) || !Number.isFinite(value)) {
    throw new Error(`${description} must be a finite number when provided.`);
  }

  return value;
}

function assertOptionalPositiveInteger(value, description) {
  if (value === undefined || value === null) {
    return null;
  }

  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${description} must be a positive integer when provided.`);
  }

  return value;
}

export function assertProviderRequest(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    throw new Error('Provider request must be an object.');
  }

  if (!isNonEmptyString(request.providerId)) {
    throw new Error('Provider request must include a non-empty providerId.');
  }

  if (!isNonEmptyString(request.modelId)) {
    throw new Error('Provider request must include a non-empty modelId.');
  }

  if (!isNonEmptyString(request.requestType)) {
    throw new Error('Provider request must include a non-empty requestType.');
  }

  const requestType = request.requestType.trim();

  if (!PROVIDER_REQUEST_TYPE_SET.has(requestType)) {
    throw new Error(`Provider request has an invalid requestType: ${requestType}`);
  }

  if (!Array.isArray(request.messages) || request.messages.length === 0) {
    throw new Error('Provider request must include a non-empty messages array.');
  }

  const messages = request.messages.map((message, index) => {
    return assertProviderMessage(message, index);
  });

  return {
    kind: 'provider_request',
    providerId: request.providerId.trim(),
    modelId: request.modelId.trim(),
    requestType,
    messages,
    temperature: assertOptionalNumber(request.temperature, 'Provider request temperature'),
    maxOutputTokens: assertOptionalPositiveInteger(request.maxOutputTokens, 'Provider request maxOutputTokens'),
  };
}

export {
  PROVIDER_REQUEST_TYPES,
};
