import { assertProviderFailure } from '../contracts/providers/provider-failure-contract.js';
import { assertProviderRetryPolicy } from '../contracts/providers/provider-retry-policy-contract.js';
import { assertProviderRequest } from '../contracts/providers/provider-request-contract.js';

function assertOptionalProviderFailure(providerFailure) {
  if (providerFailure === undefined || providerFailure === null) {
    return null;
  }

  return assertProviderFailure(providerFailure);
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

function assertRequestType(requestType) {
  const normalizedRequest = assertProviderRequest({
    providerId: 'provider-retry-decision',
    modelId: 'provider-retry-decision',
    requestType,
    messages: [
      {
        role: 'user',
        content: 'provider retry decision request type validation',
      },
    ],
  });

  return normalizedRequest.requestType;
}

function computeRecommendedBackoffMs({
  backoffStrategy,
  attemptNumber,
}) {
  const baseDelayMs = backoffStrategy.baseDelayMs;
  const maxDelayMs = backoffStrategy.maxDelayMs;

  let recommendedBackoffMs;

  switch (backoffStrategy.kind) {
    case 'fixed':
      recommendedBackoffMs = baseDelayMs;
      break;
    case 'linear':
      recommendedBackoffMs = baseDelayMs * attemptNumber;
      break;
    case 'exponential':
      recommendedBackoffMs = baseDelayMs * (2 ** Math.max(0, attemptNumber - 1));
      break;
    case 'none':
    default:
      recommendedBackoffMs = 0;
      break;
  }

  if (maxDelayMs !== null) {
    return Math.min(recommendedBackoffMs, maxDelayMs);
  }

  return recommendedBackoffMs;
}

function buildRetryDecision({
  requestType,
  attemptNumber,
  elapsedMs,
  providerFailure,
  retryPolicy,
  shouldRetry,
  stopReason,
  reason,
}) {
  return {
    kind: 'provider_retry_decision',
    version: 1,
    requestType,
    attemptNumber,
    elapsedMs,
    providerFailureCategory: providerFailure?.category ?? null,
    retryableFailure: providerFailure?.retryable ?? false,
    shouldRetry,
    allowFallbackProvider: retryPolicy.allowFallbackProvider,
    stopReason,
    reason,
    recommendedBackoffMs: shouldRetry
      ? computeRecommendedBackoffMs({
        backoffStrategy: retryPolicy.backoffStrategy,
        attemptNumber,
      })
      : 0,
  };
}

export function resolveProviderRetryDecision({
  retryPolicy,
  requestType,
  providerFailure,
  attemptNumber,
  elapsedMs,
}) {
  const normalizedRetryPolicy = assertProviderRetryPolicy(retryPolicy);
  const normalizedRequestType = assertRequestType(requestType);
  const normalizedProviderFailure = assertOptionalProviderFailure(providerFailure);
  const normalizedAttemptNumber = assertPositiveInteger(
    attemptNumber,
    'Provider retry decision attemptNumber',
  );
  const normalizedElapsedMs = assertNonNegativeInteger(
    elapsedMs,
    'Provider retry decision elapsedMs',
  );

  if (!normalizedRetryPolicy.appliesToRequestTypes.includes(normalizedRequestType)) {
    return buildRetryDecision({
      requestType: normalizedRequestType,
      attemptNumber: normalizedAttemptNumber,
      elapsedMs: normalizedElapsedMs,
      providerFailure: normalizedProviderFailure,
      retryPolicy: normalizedRetryPolicy,
      shouldRetry: false,
      stopReason: 'request_type_not_retryable',
      reason: `Retry policy does not apply to requestType ${normalizedRequestType}.`,
    });
  }

  if (!normalizedProviderFailure) {
    return buildRetryDecision({
      requestType: normalizedRequestType,
      attemptNumber: normalizedAttemptNumber,
      elapsedMs: normalizedElapsedMs,
      providerFailure: null,
      retryPolicy: normalizedRetryPolicy,
      shouldRetry: false,
      stopReason: 'missing_provider_failure',
      reason: 'No provider failure metadata is available for retry evaluation.',
    });
  }

  if (normalizedAttemptNumber >= normalizedRetryPolicy.maxAttempts) {
    return buildRetryDecision({
      requestType: normalizedRequestType,
      attemptNumber: normalizedAttemptNumber,
      elapsedMs: normalizedElapsedMs,
      providerFailure: normalizedProviderFailure,
      retryPolicy: normalizedRetryPolicy,
      shouldRetry: false,
      stopReason: 'max_attempts_reached',
      reason: `Retry policy maxAttempts ${normalizedRetryPolicy.maxAttempts} was reached.`,
    });
  }

  if (
    normalizedRetryPolicy.maxElapsedMs !== null
    && normalizedElapsedMs >= normalizedRetryPolicy.maxElapsedMs
  ) {
    return buildRetryDecision({
      requestType: normalizedRequestType,
      attemptNumber: normalizedAttemptNumber,
      elapsedMs: normalizedElapsedMs,
      providerFailure: normalizedProviderFailure,
      retryPolicy: normalizedRetryPolicy,
      shouldRetry: false,
      stopReason: 'max_elapsed_time_reached',
      reason: `Retry policy maxElapsedMs ${normalizedRetryPolicy.maxElapsedMs} was reached.`,
    });
  }

  if (normalizedProviderFailure.retryable !== true) {
    return buildRetryDecision({
      requestType: normalizedRequestType,
      attemptNumber: normalizedAttemptNumber,
      elapsedMs: normalizedElapsedMs,
      providerFailure: normalizedProviderFailure,
      retryPolicy: normalizedRetryPolicy,
      shouldRetry: false,
      stopReason: 'failure_marked_non_retryable',
      reason: `Provider failure category ${normalizedProviderFailure.category} is not retryable.`,
    });
  }

  if (!normalizedRetryPolicy.retryableFailureCategories.includes(normalizedProviderFailure.category)) {
    return buildRetryDecision({
      requestType: normalizedRequestType,
      attemptNumber: normalizedAttemptNumber,
      elapsedMs: normalizedElapsedMs,
      providerFailure: normalizedProviderFailure,
      retryPolicy: normalizedRetryPolicy,
      shouldRetry: false,
      stopReason: 'failure_category_not_allowed',
      reason: `Retry policy does not allow provider failure category ${normalizedProviderFailure.category}.`,
    });
  }

  return buildRetryDecision({
    requestType: normalizedRequestType,
    attemptNumber: normalizedAttemptNumber,
    elapsedMs: normalizedElapsedMs,
    providerFailure: normalizedProviderFailure,
    retryPolicy: normalizedRetryPolicy,
    shouldRetry: true,
    stopReason: 'retry_allowed',
    reason: `Provider failure category ${normalizedProviderFailure.category} is retryable under the current policy.`,
  });
}
