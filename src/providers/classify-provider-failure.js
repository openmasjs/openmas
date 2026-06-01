import { assertProviderFailure } from '../contracts/providers/provider-failure-contract.js';
import { DEFAULT_RETRYABLE_PROVIDER_FAILURE_CATEGORIES } from '../contracts/providers/provider-retry-policy-contract.js';

const DEFAULT_SAFE_MESSAGE = 'Provider request failed without a provider-specific diagnostic message.';
const MAX_SAFE_MESSAGE_LENGTH = 1000;

const RETRYABLE_CATEGORIES = new Set(DEFAULT_RETRYABLE_PROVIDER_FAILURE_CATEGORIES);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeOptionalString(value) {
  return isNonEmptyString(value) ? value.trim() : null;
}

function normalizeOptionalScalarString(value) {
  if (isNonEmptyString(value)) {
    return value.trim();
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  return null;
}

function parseHttpStatusCode(errorCode) {
  const match = normalizeOptionalString(errorCode)?.match(/^http_(\d{3})$/u);

  if (!match) {
    return null;
  }

  const statusCode = Number.parseInt(match[1], 10);

  return Number.isInteger(statusCode) ? statusCode : null;
}

function truncateText(value, maxLength = MAX_SAFE_MESSAGE_LENGTH) {
  if (!isNonEmptyString(value)) {
    return null;
  }

  const normalizedValue = value.trim();

  if (normalizedValue.length <= maxLength) {
    return normalizedValue;
  }

  return `${normalizedValue.slice(0, maxLength - 3)}...`;
}

function redactSensitiveText(value) {
  if (!isNonEmptyString(value)) {
    return null;
  }

  return value
    .replaceAll(/Bearer\s+[A-Za-z0-9._~+/=-]+/gu, 'Bearer [REDACTED]')
    .replaceAll(/AIza[A-Za-z0-9_-]+/gu, '[REDACTED_GOOGLE_API_KEY]')
    .replaceAll(/sk-[A-Za-z0-9._-]+/gu, '[REDACTED_API_KEY]')
    .replaceAll(/[A-Za-z0-9+/=_-]{48,}/gu, '[REDACTED_TOKEN]');
}

function safeMessage(value) {
  return truncateText(redactSensitiveText(value)) ?? DEFAULT_SAFE_MESSAGE;
}

function tryParseJsonObject(value) {
  if (!isNonEmptyString(value)) {
    return null;
  }

  try {
    const parsedValue = JSON.parse(value);
    return isPlainObject(parsedValue) ? parsedValue : null;
  } catch {
    return null;
  }
}

function extractProviderErrorPayload({ errorMessage, responseBody, error }) {
  if (isPlainObject(responseBody)) {
    return responseBody;
  }

  const parsedMessage = tryParseJsonObject(errorMessage);

  if (parsedMessage) {
    return parsedMessage;
  }

  if (isPlainObject(error?.cause)) {
    return error.cause;
  }

  return null;
}

function extractNestedError(payload) {
  if (!isPlainObject(payload)) {
    return null;
  }

  if (isPlainObject(payload.error)) {
    return payload.error;
  }

  return payload;
}

function extractDetailTypes(errorPayload) {
  const details = Array.isArray(errorPayload?.details)
    ? errorPayload.details
    : [];

  return details
    .map((detail) => {
      if (!isPlainObject(detail)) {
        return null;
      }

      return normalizeOptionalString(detail['@type'])
        ?? normalizeOptionalString(detail.type)
        ?? null;
    })
    .filter(isNonEmptyString);
}

function buildOriginalErrorShape(payload, errorPayload) {
  return {
    topLevelKeys: isPlainObject(payload) ? Object.keys(payload).sort() : [],
    errorKeys: isPlainObject(errorPayload) ? Object.keys(errorPayload).sort() : [],
    detailTypes: extractDetailTypes(errorPayload),
  };
}

function buildDiagnosticSummary({
  category,
  httpStatusCode,
  providerErrorStatus,
  providerErrorCode,
  adapterErrorName,
}) {
  const parts = [
    `category=${category}`,
  ];

  if (httpStatusCode !== null) {
    parts.push(`http=${httpStatusCode}`);
  }

  if (providerErrorStatus) {
    parts.push(`providerStatus=${providerErrorStatus}`);
  }

  if (providerErrorCode) {
    parts.push(`providerCode=${providerErrorCode}`);
  }

  if (adapterErrorName) {
    parts.push(`adapterError=${adapterErrorName}`);
  }

  return parts.join(' ');
}

function containsAny(text, fragments) {
  if (!isNonEmptyString(text)) {
    return false;
  }

  const normalizedText = text.toLowerCase();

  return fragments.some((fragment) => {
    return normalizedText.includes(fragment);
  });
}

function classifyCategory({
  errorCode,
  errorMessage,
  httpStatusCode,
  providerErrorStatus,
  providerErrorCode,
  adapterErrorName,
}) {
  const combinedText = [
    errorCode,
    errorMessage,
    providerErrorStatus,
    providerErrorCode,
    adapterErrorName,
  ].filter(isNonEmptyString).join(' ');

  if (
    adapterErrorName === 'AbortError'
    || containsAny(combinedText, [
      'timeout',
      'timed out',
      'etimedout',
    ])
  ) {
    return 'timeout';
  }

  if (
    containsAny(combinedText, [
      'network',
      'fetch failed',
      'econnreset',
      'econnrefused',
      'enotfound',
      'socket hang up',
    ])
  ) {
    return 'network_error';
  }

  if (
    httpStatusCode === 401
    || containsAny(combinedText, [
      'api key not valid',
      'invalid api key',
      'invalid_api_key',
      'authentication',
      'unauthenticated',
      'unauthorized',
    ])
  ) {
    return 'authentication_failed';
  }

  if (
    httpStatusCode === 403
    || containsAny(combinedText, [
      'permission denied',
      'forbidden',
      'access denied',
      'authorization',
    ])
  ) {
    return 'authorization_failed';
  }

  if (
    httpStatusCode === 429
    || containsAny(combinedText, [
      'rate limit',
      'too many requests',
      'resource_exhausted',
      'quota',
    ])
  ) {
    return 'rate_limited';
  }

  if (
    httpStatusCode === 408
    || httpStatusCode === 503
    || containsAny(combinedText, [
      'unavailable',
      'temporarily unavailable',
      'high demand',
      'overloaded',
      'try again later',
    ])
  ) {
    return 'transient_unavailable';
  }

  if (
    httpStatusCode === 400
    || containsAny(combinedText, [
      'invalid_argument',
      'bad request',
      'invalid request',
    ])
  ) {
    return 'invalid_request';
  }

  if (
    errorCode === 'invalid_provider_response'
    && containsAny(combinedText, [
      'did not include a readable output text',
      'no readable assistant content',
      'empty output',
    ])
  ) {
    return 'empty_output';
  }

  if (
    errorCode === 'invalid_provider_response'
    || containsAny(combinedText, [
      'malformed',
      'not valid json',
      'unexpected token',
      'parse',
    ])
  ) {
    return 'malformed_response';
  }

  if (
    httpStatusCode !== null
    && httpStatusCode >= 500
    && httpStatusCode <= 599
  ) {
    return 'provider_internal_error';
  }

  return 'unknown_provider_failure';
}

export function classifyProviderFailure({
  errorCode = null,
  errorMessage = null,
  httpStatusCode = null,
  responseBody = null,
  error = null,
  metadata = {},
} = {}) {
  const normalizedHttpStatusCode = Number.isInteger(httpStatusCode)
    ? httpStatusCode
    : parseHttpStatusCode(errorCode);
  const payload = extractProviderErrorPayload({
    errorMessage,
    responseBody,
    error,
  });
  const providerErrorPayload = extractNestedError(payload);
  const providerErrorCode = normalizeOptionalScalarString(providerErrorPayload?.code)
    ?? normalizeOptionalScalarString(error?.code)
    ?? null;
  const providerErrorStatus = normalizeOptionalString(providerErrorPayload?.status)
    ?? normalizeOptionalString(error?.status)
    ?? null;
  const providerErrorType = normalizeOptionalString(providerErrorPayload?.type)
    ?? normalizeOptionalString(providerErrorPayload?.['@type'])
    ?? null;
  const adapterErrorName = normalizeOptionalString(error?.name);
  const providerMessage = normalizeOptionalString(providerErrorPayload?.message);
  const effectiveErrorMessage = providerMessage
    ?? normalizeOptionalString(errorMessage)
    ?? normalizeOptionalString(error?.message)
    ?? DEFAULT_SAFE_MESSAGE;
  const category = classifyCategory({
    errorCode,
    errorMessage: effectiveErrorMessage,
    httpStatusCode: normalizedHttpStatusCode,
    providerErrorStatus,
    providerErrorCode,
    adapterErrorName,
  });

  return assertProviderFailure({
    kind: 'provider_failure',
    version: 1,
    category,
    retryable: RETRYABLE_CATEGORIES.has(category),
    httpStatusCode: normalizedHttpStatusCode,
    providerErrorCode: providerErrorCode === null ? null : String(providerErrorCode),
    providerErrorStatus,
    providerErrorType,
    adapterErrorName,
    safeMessage: safeMessage(effectiveErrorMessage),
    diagnosticSummary: buildDiagnosticSummary({
      category,
      httpStatusCode: normalizedHttpStatusCode,
      providerErrorStatus,
      providerErrorCode: providerErrorCode === null ? null : String(providerErrorCode),
      adapterErrorName,
    }),
    originalErrorShape: buildOriginalErrorShape(payload, providerErrorPayload),
    metadata,
  });
}
