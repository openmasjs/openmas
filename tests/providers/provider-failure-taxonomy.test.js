import test from 'node:test';
import assert from 'node:assert/strict';
import { assertProviderFailure } from '../../src/contracts/providers/provider-failure-contract.js';
import { classifyProviderFailure } from '../../src/providers/classify-provider-failure.js';
import { buildFakeGeminiSecretProbe, buildFakeOpenAiSecretProbe } from '../helpers/fake-secret-probes.js';

test('classifyProviderFailure maps Gemini high-demand unavailable errors to transient_unavailable', () => {
  const providerFailure = classifyProviderFailure({
    errorCode: 'http_503',
    httpStatusCode: 503,
    errorMessage: JSON.stringify({
      error: {
        code: 503,
        message: 'This model is currently experiencing high demand. Please try again later.',
        status: 'UNAVAILABLE',
        details: [
          {
            '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
            reason: 'MODEL_OVERLOADED',
          },
        ],
      },
    }),
  });

  assert.equal(providerFailure.kind, 'provider_failure');
  assert.equal(providerFailure.category, 'transient_unavailable');
  assert.equal(providerFailure.retryable, true);
  assert.equal(providerFailure.httpStatusCode, 503);
  assert.equal(providerFailure.providerErrorCode, '503');
  assert.equal(providerFailure.providerErrorStatus, 'UNAVAILABLE');
  assert.equal(providerFailure.originalErrorShape.detailTypes[0], 'type.googleapis.com/google.rpc.ErrorInfo');
  assert.match(providerFailure.safeMessage, /high demand/u);
});

test('classifyProviderFailure maps rate limits, authentication, and authorization separately', () => {
  assert.equal(classifyProviderFailure({
    errorCode: 'http_429',
    errorMessage: '{"error":{"message":"Rate limit exceeded","code":"rate_limited"}}',
  }).category, 'rate_limited');

  assert.equal(classifyProviderFailure({
    errorCode: 'http_401',
    errorMessage: '{"error":{"message":"API key not valid","status":"UNAUTHENTICATED"}}',
  }).category, 'authentication_failed');

  assert.equal(classifyProviderFailure({
    errorCode: 'http_403',
    errorMessage: '{"error":{"message":"Permission denied","status":"PERMISSION_DENIED"}}',
  }).category, 'authorization_failed');
});

test('classifyProviderFailure maps empty provider output without treating it as user ambiguity', () => {
  const providerFailure = classifyProviderFailure({
    errorCode: 'invalid_provider_response',
    errorMessage: 'Ollama provider response did not include a readable output text.',
  });

  assert.equal(providerFailure.category, 'empty_output');
  assert.equal(providerFailure.retryable, true);
  assert.equal(providerFailure.httpStatusCode, null);
});

test('classifyProviderFailure maps adapter exceptions to timeout or network categories', () => {
  assert.equal(classifyProviderFailure({
    errorCode: 'provider_execution_error',
    error: Object.assign(new Error('The operation timed out.'), {
      name: 'AbortError',
    }),
  }).category, 'timeout');

  assert.equal(classifyProviderFailure({
    errorCode: 'provider_execution_error',
    error: Object.assign(new Error('fetch failed: ENOTFOUND provider.test'), {
      name: 'TypeError',
    }),
  }).category, 'network_error');
});

test('classifyProviderFailure redacts secret-like values from safe messages', () => {
  const providerFailure = classifyProviderFailure({
    errorCode: 'http_401',
    errorMessage: `Authorization failed for Bearer ${buildFakeOpenAiSecretProbe('testsecret1234567890123456789012345678901234567890')} and key ${buildFakeGeminiSecretProbe('SyFakeSecret123456789')}.`,
  });

  assert.doesNotMatch(providerFailure.safeMessage, new RegExp(buildFakeOpenAiSecretProbe('testsecret'), 'u'));
  assert.doesNotMatch(providerFailure.safeMessage, new RegExp(buildFakeGeminiSecretProbe('SyFakeSecret'), 'u'));
  assert.match(providerFailure.safeMessage, /\[REDACTED/u);
});

test('assertProviderFailure rejects unknown categories', () => {
  assert.throws(
    () => assertProviderFailure({
      kind: 'provider_failure',
      version: 1,
      category: 'surprise_failure',
      retryable: false,
      safeMessage: 'Unknown category should fail.',
    }),
    /category is invalid/u,
  );
});
