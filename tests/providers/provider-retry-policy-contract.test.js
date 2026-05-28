import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertProviderRetryPolicy,
} from '../../src/contracts/provider-retry-policy-contract.js';
import { resolveProviderRetryDecision } from '../../src/providers/resolve-provider-retry-decision.js';

function buildProviderFailure(overrides = {}) {
  return {
    kind: 'provider_failure',
    version: 1,
    category: 'transient_unavailable',
    retryable: true,
    httpStatusCode: 503,
    providerErrorCode: null,
    providerErrorStatus: 'UNAVAILABLE',
    providerErrorType: null,
    adapterErrorName: null,
    safeMessage: 'Provider is temporarily unavailable.',
    diagnosticSummary: 'category=transient_unavailable http=503 providerStatus=UNAVAILABLE',
    originalErrorShape: {
      topLevelKeys: [],
      errorKeys: [],
      detailTypes: [],
    },
    metadata: {},
    ...overrides,
  };
}

test('assertProviderRetryPolicy normalizes a provider-neutral retry policy', () => {
  const policy = assertProviderRetryPolicy({
    kind: 'provider_retry_policy',
    version: 1,
    maxAttempts: 3,
    retryableFailureCategories: [
      'transient_unavailable',
      'timeout',
    ],
    backoffStrategy: {
      kind: 'exponential',
      baseDelayMs: 200,
      maxDelayMs: 800,
    },
    maxElapsedMs: 1500,
    allowFallbackProvider: false,
    appliesToRequestTypes: [
      'classify_intent',
    ],
  });

  assert.equal(policy.maxAttempts, 3);
  assert.deepEqual(policy.retryableFailureCategories, [
    'transient_unavailable',
    'timeout',
  ]);
  assert.equal(policy.backoffStrategy.kind, 'exponential');
  assert.equal(policy.backoffStrategy.baseDelayMs, 200);
  assert.equal(policy.backoffStrategy.maxDelayMs, 800);
  assert.equal(policy.maxElapsedMs, 1500);
  assert.equal(policy.allowFallbackProvider, false);
  assert.deepEqual(policy.appliesToRequestTypes, [
    'classify_intent',
  ]);
});

test('resolveProviderRetryDecision retries only allowed retryable categories deterministically', () => {
  const decision = resolveProviderRetryDecision({
    retryPolicy: {
      kind: 'provider_retry_policy',
      version: 1,
      maxAttempts: 3,
      retryableFailureCategories: [
        'transient_unavailable',
      ],
      backoffStrategy: {
        kind: 'linear',
        baseDelayMs: 250,
        maxDelayMs: 1000,
      },
      maxElapsedMs: 5000,
      allowFallbackProvider: true,
      appliesToRequestTypes: [
        'generate_text',
        'classify_intent',
      ],
    },
    requestType: 'generate_text',
    providerFailure: buildProviderFailure(),
    attemptNumber: 2,
    elapsedMs: 400,
  });

  assert.equal(decision.shouldRetry, true);
  assert.equal(decision.stopReason, 'retry_allowed');
  assert.equal(decision.recommendedBackoffMs, 500);
  assert.match(decision.reason, /retryable under the current policy/);
});

test('resolveProviderRetryDecision stops cleanly for non-retryable failures and request-type mismatches', () => {
  const authDecision = resolveProviderRetryDecision({
    retryPolicy: {
      kind: 'provider_retry_policy',
      version: 1,
      maxAttempts: 4,
      retryableFailureCategories: [
        'transient_unavailable',
      ],
      backoffStrategy: {
        kind: 'fixed',
        baseDelayMs: 100,
        maxDelayMs: 100,
      },
      maxElapsedMs: 5000,
      allowFallbackProvider: true,
      appliesToRequestTypes: [
        'generate_text',
      ],
    },
    requestType: 'generate_text',
    providerFailure: buildProviderFailure({
      category: 'authentication_failed',
      retryable: false,
      httpStatusCode: 401,
      safeMessage: 'Invalid API key.',
      diagnosticSummary: 'category=authentication_failed http=401',
    }),
    attemptNumber: 1,
    elapsedMs: 10,
  });
  const requestTypeDecision = resolveProviderRetryDecision({
    retryPolicy: {
      kind: 'provider_retry_policy',
      version: 1,
      maxAttempts: 3,
      retryableFailureCategories: [
        'transient_unavailable',
      ],
      backoffStrategy: {
        kind: 'fixed',
        baseDelayMs: 100,
        maxDelayMs: 100,
      },
      maxElapsedMs: 5000,
      allowFallbackProvider: true,
      appliesToRequestTypes: [
        'classify_intent',
      ],
    },
    requestType: 'generate_text',
    providerFailure: buildProviderFailure(),
    attemptNumber: 1,
    elapsedMs: 10,
  });

  assert.equal(authDecision.shouldRetry, false);
  assert.equal(authDecision.stopReason, 'failure_marked_non_retryable');
  assert.equal(requestTypeDecision.shouldRetry, false);
  assert.equal(requestTypeDecision.stopReason, 'request_type_not_retryable');
});
