import { PROVIDER_FAILURE_CATEGORIES } from './provider-failure-contract.js';
import { PROVIDER_REQUEST_TYPES } from './provider-request-contract.js';

const PROVIDER_REQUEST_TYPE_SET = new Set(PROVIDER_REQUEST_TYPES);

const PROVIDER_RETRY_BACKOFF_STRATEGIES = new Set([
  'none',
  'fixed',
  'linear',
  'exponential',
]);

const DEFAULT_RETRYABLE_PROVIDER_FAILURE_CATEGORIES = Object.freeze([
  'transient_unavailable',
  'rate_limited',
  'empty_output',
  'timeout',
  'network_error',
  'provider_internal_error',
]);

const DEFAULT_PROVIDER_REQUEST_TIMEOUT_MS = 5 * 60 * 1000;

const DEFAULT_PROVIDER_RETRY_POLICY = Object.freeze({
  kind: 'provider_retry_policy',
  version: 1,
  maxAttempts: 1,
  retryableFailureCategories: [...DEFAULT_RETRYABLE_PROVIDER_FAILURE_CATEGORIES],
  backoffStrategy: {
    kind: 'none',
    baseDelayMs: 0,
    maxDelayMs: 0,
  },
  requestTimeoutMs: DEFAULT_PROVIDER_REQUEST_TIMEOUT_MS,
  maxElapsedMs: null,
  allowFallbackProvider: true,
  appliesToRequestTypes: [...PROVIDER_REQUEST_TYPES],
});

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function uniqueStrings(values) {
  const seenValues = new Set();
  const normalizedValues = [];

  for (const value of values) {
    if (!isNonEmptyString(value)) {
      continue;
    }

    const normalizedValue = value.trim();

    if (seenValues.has(normalizedValue)) {
      continue;
    }

    seenValues.add(normalizedValue);
    normalizedValues.push(normalizedValue);
  }

  return normalizedValues;
}

function assertPositiveInteger(value, description) {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${description} must be an integer greater than or equal to 1.`);
  }

  return value;
}

function assertOptionalNonNegativeInteger(value, description, defaultValue = null) {
  if (value === undefined || value === null) {
    return defaultValue;
  }

  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${description} must be a non-negative integer when provided.`);
  }

  return value;
}

function assertBoolean(value, description, defaultValue) {
  if (value === undefined || value === null) {
    return defaultValue;
  }

  if (typeof value !== 'boolean') {
    throw new Error(`${description} must be a boolean when provided.`);
  }

  return value;
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

function assertEnumStringArray(values, description, allowedValues) {
  if (!Array.isArray(values)) {
    throw new Error(`${description} must be an array.`);
  }

  return uniqueStrings(values).map((value) => {
    if (!allowedValues.has(value)) {
      throw new Error(`${description} contains an invalid value: ${value}`);
    }

    return value;
  });
}

function assertBackoffStrategy(backoffStrategy) {
  const normalizedBackoffStrategy = backoffStrategy === undefined || backoffStrategy === null
    ? DEFAULT_PROVIDER_RETRY_POLICY.backoffStrategy
    : backoffStrategy;

  if (!isPlainObject(normalizedBackoffStrategy)) {
    throw new Error('Provider retry policy backoffStrategy must be an object when provided.');
  }

  const kind = assertEnumValue(
    normalizedBackoffStrategy.kind ?? DEFAULT_PROVIDER_RETRY_POLICY.backoffStrategy.kind,
    PROVIDER_RETRY_BACKOFF_STRATEGIES,
    'Provider retry policy backoffStrategy.kind',
  );
  const baseDelayMs = assertOptionalNonNegativeInteger(
    normalizedBackoffStrategy.baseDelayMs,
    'Provider retry policy backoffStrategy.baseDelayMs',
    DEFAULT_PROVIDER_RETRY_POLICY.backoffStrategy.baseDelayMs,
  );
  const maxDelayMs = assertOptionalNonNegativeInteger(
    normalizedBackoffStrategy.maxDelayMs,
    'Provider retry policy backoffStrategy.maxDelayMs',
    DEFAULT_PROVIDER_RETRY_POLICY.backoffStrategy.maxDelayMs,
  );

  if (maxDelayMs !== null && maxDelayMs < baseDelayMs) {
    throw new Error('Provider retry policy backoffStrategy.maxDelayMs must be greater than or equal to baseDelayMs.');
  }

  return {
    kind,
    baseDelayMs,
    maxDelayMs,
  };
}

export function createProviderRetryPolicy(overrides = {}) {
  const candidatePolicy = isPlainObject(overrides)
    ? {
      ...DEFAULT_PROVIDER_RETRY_POLICY,
      ...overrides,
      backoffStrategy: overrides.backoffStrategy === undefined
        ? DEFAULT_PROVIDER_RETRY_POLICY.backoffStrategy
        : overrides.backoffStrategy,
      retryableFailureCategories: overrides.retryableFailureCategories === undefined
        ? DEFAULT_PROVIDER_RETRY_POLICY.retryableFailureCategories
        : overrides.retryableFailureCategories,
      appliesToRequestTypes: overrides.appliesToRequestTypes === undefined
        ? DEFAULT_PROVIDER_RETRY_POLICY.appliesToRequestTypes
        : overrides.appliesToRequestTypes,
    }
    : DEFAULT_PROVIDER_RETRY_POLICY;

  return assertProviderRetryPolicy(candidatePolicy);
}

export function assertProviderRetryPolicy(policy, description = 'Provider retry policy') {
  const normalizedPolicy = policy === undefined || policy === null
    ? DEFAULT_PROVIDER_RETRY_POLICY
    : policy;

  if (!isPlainObject(normalizedPolicy)) {
    throw new Error(`${description} must be an object when provided.`);
  }

  if (normalizedPolicy.kind !== 'provider_retry_policy') {
    throw new Error(`${description} must include kind "provider_retry_policy".`);
  }

  if (normalizedPolicy.version !== 1) {
    throw new Error(`${description} version must be 1.`);
  }

  return {
    kind: 'provider_retry_policy',
    version: 1,
    maxAttempts: assertPositiveInteger(
      normalizedPolicy.maxAttempts ?? DEFAULT_PROVIDER_RETRY_POLICY.maxAttempts,
      `${description} maxAttempts`,
    ),
    retryableFailureCategories: assertEnumStringArray(
      normalizedPolicy.retryableFailureCategories ?? DEFAULT_PROVIDER_RETRY_POLICY.retryableFailureCategories,
      `${description} retryableFailureCategories`,
      PROVIDER_FAILURE_CATEGORIES,
    ),
    backoffStrategy: assertBackoffStrategy(normalizedPolicy.backoffStrategy),
    requestTimeoutMs: assertPositiveInteger(
      normalizedPolicy.requestTimeoutMs ?? DEFAULT_PROVIDER_RETRY_POLICY.requestTimeoutMs,
      `${description} requestTimeoutMs`,
    ),
    maxElapsedMs: assertOptionalNonNegativeInteger(
      normalizedPolicy.maxElapsedMs,
      `${description} maxElapsedMs`,
      DEFAULT_PROVIDER_RETRY_POLICY.maxElapsedMs,
    ),
    allowFallbackProvider: assertBoolean(
      normalizedPolicy.allowFallbackProvider,
      `${description} allowFallbackProvider`,
      DEFAULT_PROVIDER_RETRY_POLICY.allowFallbackProvider,
    ),
    appliesToRequestTypes: assertEnumStringArray(
      normalizedPolicy.appliesToRequestTypes ?? DEFAULT_PROVIDER_RETRY_POLICY.appliesToRequestTypes,
      `${description} appliesToRequestTypes`,
      PROVIDER_REQUEST_TYPE_SET,
    ),
  };
}

export {
  DEFAULT_PROVIDER_RETRY_POLICY,
  DEFAULT_PROVIDER_REQUEST_TIMEOUT_MS,
  DEFAULT_RETRYABLE_PROVIDER_FAILURE_CATEGORIES,
  PROVIDER_RETRY_BACKOFF_STRATEGIES,
};
