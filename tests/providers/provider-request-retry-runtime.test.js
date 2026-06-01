import test from 'node:test';
import assert from 'node:assert/strict';
import { executeProviderRequestWithRetry } from '../../src/providers/execute-provider-request-with-retry.js';

function createPreparedProvider({
  providerId = 'openrouter-api',
  modelId = 'openrouter/free',
  credentialReferenceId = 'openrouter-api-key',
} = {}) {
  return {
    brainId: `${providerId}-primary`,
    providerId,
    modelId,
    resourceId: providerId,
    credentialReferenceId,
    secretResolutionStatus: 'resolved',
    status: 'ready',
    reason: 'Provider is ready for retry execution tests.',
  };
}

function createSecretResolution(credentialReferenceId, secretValue) {
  return {
    resolvedCredentialReferences: [],
    summary: {
      totalReferenced: 1,
      resolved: 1,
      unresolved: 0,
      missingDefinitions: 0,
    },
    warnings: [],
    secretValueByReferenceId: new Map([
      [credentialReferenceId, secretValue],
    ]),
  };
}

function buildFailedProviderResponse(overrides = {}) {
  return {
    kind: 'provider_response',
    providerId: 'openrouter-api',
    modelId: 'openrouter/free',
    requestType: 'generate_text',
    status: 'failed',
    outputText: null,
    finishReason: null,
    providerResponseId: null,
    usage: null,
    warnings: [],
    errorCode: 'http_503',
    errorMessage: 'Provider is temporarily unavailable.',
    providerFailure: {
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
    },
    ...overrides,
  };
}

test('executeProviderRequestWithRetry retries retryable provider execution failures and records a deterministic trace', async () => {
  const timestamps = [
    0,
    0,
    30,
  ];
  let timestampIndex = 0;
  let callCount = 0;

  const result = await executeProviderRequestWithRetry({
    preparedProvider: createPreparedProvider(),
    providerRequest: {
      providerId: 'openrouter-api',
      modelId: 'openrouter/free',
      requestType: 'generate_text',
      messages: [
        {
          role: 'user',
          content: 'Hello.',
        },
      ],
    },
    secretResolution: createSecretResolution('openrouter-api-key', 'openrouter-secret'),
    retryPolicy: {
      kind: 'provider_retry_policy',
      version: 1,
      maxAttempts: 2,
      retryableFailureCategories: [
        'network_error',
      ],
      backoffStrategy: {
        kind: 'fixed',
        baseDelayMs: 150,
        maxDelayMs: 150,
      },
      maxElapsedMs: 1000,
      allowFallbackProvider: true,
      appliesToRequestTypes: [
        'generate_text',
      ],
    },
    currentTimeMsImplementation: () => {
      const currentValue = timestamps[Math.min(timestampIndex, timestamps.length - 1)];
      timestampIndex += 1;
      return currentValue;
    },
    executeProviderRequestImplementation: async () => {
      callCount += 1;

      if (callCount === 1) {
        throw new Error('fetch failed: socket hang up');
      }

      return {
        kind: 'provider_response',
        providerId: 'openrouter-api',
        modelId: 'openrouter/free',
        requestType: 'generate_text',
        status: 'completed',
        outputText: 'Recovered on retry.',
        finishReason: 'stop',
        providerResponseId: 'provider-response-2',
        usage: {
          inputTokens: 10,
          outputTokens: 4,
          totalTokens: 14,
        },
        warnings: [],
        errorCode: null,
        errorMessage: null,
      };
    },
  });

  assert.equal(callCount, 2);
  assert.equal(result.totalAttempts, 2);
  assert.equal(result.stoppedReason, 'completed');
  assert.equal(result.finalProviderResponse.status, 'completed');
  assert.equal(result.attempts[0].providerFailureCategory, 'network_error');
  assert.equal(result.attempts[0].retryDecision.shouldRetry, true);
  assert.equal(result.attempts[0].retryDecision.recommendedBackoffMs, 150);
  assert.equal(result.attempts[1].status, 'completed');
});

test('executeProviderRequestWithRetry does not retry non-retryable provider failures', async () => {
  let callCount = 0;

  const result = await executeProviderRequestWithRetry({
    preparedProvider: createPreparedProvider(),
    providerRequest: {
      providerId: 'openrouter-api',
      modelId: 'openrouter/free',
      requestType: 'generate_text',
      messages: [
        {
          role: 'user',
          content: 'Hello.',
        },
      ],
    },
    secretResolution: createSecretResolution('openrouter-api-key', 'openrouter-secret'),
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
      maxElapsedMs: 1000,
      allowFallbackProvider: true,
      appliesToRequestTypes: [
        'generate_text',
      ],
    },
    executeProviderRequestImplementation: async () => {
      callCount += 1;
      return buildFailedProviderResponse({
        errorCode: 'http_401',
        errorMessage: 'Invalid API key.',
        providerFailure: {
          kind: 'provider_failure',
          version: 1,
          category: 'authentication_failed',
          retryable: false,
          httpStatusCode: 401,
          providerErrorCode: 'invalid_api_key',
          providerErrorStatus: null,
          providerErrorType: null,
          adapterErrorName: null,
          safeMessage: 'Invalid API key.',
          diagnosticSummary: 'category=authentication_failed http=401 providerCode=invalid_api_key',
          originalErrorShape: {
            topLevelKeys: [],
            errorKeys: [],
            detailTypes: [],
          },
          metadata: {},
        },
      });
    },
  });

  assert.equal(callCount, 1);
  assert.equal(result.totalAttempts, 1);
  assert.equal(result.stoppedReason, 'failure_marked_non_retryable');
  assert.equal(result.finalProviderResponse.providerFailure.category, 'authentication_failed');
});

test('executeProviderRequestWithRetry aborts a provider attempt after its configured deadline', async () => {
  let receivedAbortSignal = null;
  let abortObserved = false;

  const result = await executeProviderRequestWithRetry({
    preparedProvider: createPreparedProvider(),
    providerRequest: {
      providerId: 'openrouter-api',
      modelId: 'openrouter/free',
      requestType: 'generate_text',
      messages: [
        {
          role: 'user',
          content: 'Wait forever unless the runtime cancels this request.',
        },
      ],
    },
    secretResolution: createSecretResolution('openrouter-api-key', 'openrouter-secret'),
    retryPolicy: {
      kind: 'provider_retry_policy',
      version: 1,
      maxAttempts: 1,
      retryableFailureCategories: [
        'timeout',
      ],
      backoffStrategy: {
        kind: 'none',
        baseDelayMs: 0,
        maxDelayMs: 0,
      },
      requestTimeoutMs: 20,
      maxElapsedMs: 100,
      allowFallbackProvider: false,
      appliesToRequestTypes: [
        'generate_text',
      ],
    },
    executeProviderRequestImplementation: async ({ abortSignal }) => {
      receivedAbortSignal = abortSignal;
      abortSignal.addEventListener('abort', () => {
        abortObserved = true;
      }, { once: true });

      return new Promise(() => {});
    },
  });

  assert.equal(typeof receivedAbortSignal?.aborted, 'boolean');
  assert.equal(typeof receivedAbortSignal?.addEventListener, 'function');
  assert.equal(abortObserved, true);
  assert.equal(result.totalAttempts, 1);
  assert.equal(result.finalProviderResponse.status, 'failed');
  assert.equal(result.finalProviderResponse.providerFailure.category, 'timeout');
  assert.match(result.finalProviderResponse.errorMessage, /timed out after 20 ms/u);
});
