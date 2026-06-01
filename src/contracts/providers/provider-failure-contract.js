const PROVIDER_FAILURE_CATEGORIES = new Set([
  'transient_unavailable',
  'rate_limited',
  'authentication_failed',
  'authorization_failed',
  'invalid_request',
  'malformed_response',
  'empty_output',
  'timeout',
  'network_error',
  'provider_internal_error',
  'unknown_provider_failure',
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

function assertOptionalSafeString(value, description) {
  if (value === undefined || value === null) {
    return null;
  }

  if (!isNonEmptyString(value)) {
    throw new Error(`${description} must be a non-empty string when provided.`);
  }

  return value.trim();
}

function assertOptionalInteger(value, description) {
  if (value === undefined || value === null) {
    return null;
  }

  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${description} must be a non-negative integer when provided.`);
  }

  return value;
}

function assertOptionalBoolean(value, description, defaultValue) {
  if (value === undefined || value === null) {
    return defaultValue;
  }

  if (typeof value !== 'boolean') {
    throw new Error(`${description} must be a boolean when provided.`);
  }

  return value;
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

function assertOptionalMetadata(value, description) {
  if (value === undefined || value === null) {
    return {};
  }

  if (!isPlainObject(value)) {
    throw new Error(`${description} must be an object when provided.`);
  }

  return { ...value };
}

export function assertProviderFailure(providerFailure) {
  if (!isPlainObject(providerFailure)) {
    throw new Error('Provider failure must be an object.');
  }

  if (providerFailure.kind !== 'provider_failure') {
    throw new Error('Provider failure must include kind "provider_failure".');
  }

  if (providerFailure.version !== 1) {
    throw new Error('Provider failure version must be 1.');
  }

  if (!isNonEmptyString(providerFailure.safeMessage)) {
    throw new Error('Provider failure safeMessage must be a non-empty string.');
  }

  return {
    kind: 'provider_failure',
    version: 1,
    category: assertEnumValue(
      providerFailure.category,
      PROVIDER_FAILURE_CATEGORIES,
      'Provider failure category',
    ),
    retryable: assertOptionalBoolean(
      providerFailure.retryable,
      'Provider failure retryable',
      false,
    ),
    httpStatusCode: assertOptionalInteger(
      providerFailure.httpStatusCode,
      'Provider failure httpStatusCode',
    ),
    providerErrorCode: assertOptionalSafeString(
      providerFailure.providerErrorCode,
      'Provider failure providerErrorCode',
    ),
    providerErrorStatus: assertOptionalSafeString(
      providerFailure.providerErrorStatus,
      'Provider failure providerErrorStatus',
    ),
    providerErrorType: assertOptionalSafeString(
      providerFailure.providerErrorType,
      'Provider failure providerErrorType',
    ),
    adapterErrorName: assertOptionalSafeString(
      providerFailure.adapterErrorName,
      'Provider failure adapterErrorName',
    ),
    safeMessage: providerFailure.safeMessage.trim(),
    diagnosticSummary: assertOptionalSafeString(
      providerFailure.diagnosticSummary,
      'Provider failure diagnosticSummary',
    ),
    originalErrorShape: isPlainObject(providerFailure.originalErrorShape)
      ? {
        topLevelKeys: assertStringArray(
          providerFailure.originalErrorShape.topLevelKeys ?? [],
          'Provider failure originalErrorShape.topLevelKeys',
        ),
        errorKeys: assertStringArray(
          providerFailure.originalErrorShape.errorKeys ?? [],
          'Provider failure originalErrorShape.errorKeys',
        ),
        detailTypes: assertStringArray(
          providerFailure.originalErrorShape.detailTypes ?? [],
          'Provider failure originalErrorShape.detailTypes',
        ),
      }
      : {
        topLevelKeys: [],
        errorKeys: [],
        detailTypes: [],
      },
    metadata: assertOptionalMetadata(
      providerFailure.metadata,
      'Provider failure metadata',
    ),
  };
}

export {
  PROVIDER_FAILURE_CATEGORIES,
};
