import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProviderFallbackDecisionTrace } from '../../src/providers/build-provider-fallback-decision-trace.js';

function buildReadiness({
  fallbackBrain = {
    brainId: 'alfred-fallback-brain',
  },
  fallbackProvider = {
    providerId: 'gemini-api',
    status: 'ready',
  },
} = {}) {
  return {
    brainSelection: {
      fallbackBrain,
    },
    providerPreparation: {
      fallbackBrainProvider: fallbackProvider,
    },
  };
}

function buildAttempt(overrides = {}) {
  return {
    brainRole: 'primary',
    brainId: 'alfred-primary-brain',
    providerId: 'openrouter-api',
    modelId: 'openrouter/free',
    status: 'failed',
    providerResponse: {
      providerFailure: {
        category: 'transient_unavailable',
      },
    },
    brainOutput: {
      providerFailure: {
        category: 'transient_unavailable',
      },
    },
    ...overrides,
  };
}

test('buildProviderFallbackDecisionTrace preserves configured fallback visibility when policy skips fallback', () => {
  const primaryAttempt = buildAttempt();

  const trace = buildProviderFallbackDecisionTrace({
    readiness: buildReadiness(),
    primaryAttempt,
    fallbackAttempt: null,
    selectedFinalAttempt: primaryAttempt,
    providerRetryPolicy: {
      kind: 'provider_retry_policy',
      version: 1,
      maxAttempts: 2,
      retryableFailureCategories: [
        'transient_unavailable',
      ],
      backoffStrategy: {
        kind: 'fixed',
        baseDelayMs: 100,
        maxDelayMs: 100,
      },
      maxElapsedMs: 1000,
      allowFallbackProvider: false,
      appliesToRequestTypes: [
        'generate_text',
      ],
    },
    semanticIntentRuntime: {
      providerClassifierAudit: {
        status: 'failed',
        providerRequest: {
          providerId: 'gemini-api',
        },
        attempts: [
          {
            attemptNumber: 1,
            status: 'failed',
            failureCategory: 'malformed_response',
          },
        ],
        fallbackModeUsed: 'safe_clarification',
      },
    },
  });

  assert.equal(trace.status, 'skipped_policy_disallowed');
  assert.equal(trace.policyAllowsFallback, false);
  assert.equal(trace.fallbackConfigured, true);
  assert.equal(trace.fallbackReady, true);
  assert.equal(trace.fallbackAttempted, false);
  assert.equal(trace.fallbackProviderId, 'gemini-api');
  assert.equal(trace.fallbackProviderStatus, 'not_evaluated');
  assert.match(trace.decisionReason, /gemini-api was available but skipped because the retry policy disallows fallback providers/u);
  assert.equal(trace.semanticClassifierImpact.status, 'failed');
  assert.equal(trace.semanticClassifierImpact.providerId, 'gemini-api');
  assert.equal(trace.semanticClassifierImpact.failureCategory, 'malformed_response');
  assert.match(trace.semanticClassifierImpact.summary, /failed independently of the primary\/fallback brain path/u);
});

test('buildProviderFallbackDecisionTrace records fallback success independently from later runtime passes', () => {
  const primaryAttempt = buildAttempt();
  const fallbackAttempt = buildAttempt({
    brainRole: 'fallback',
    brainId: 'alfred-fallback-brain',
    providerId: 'gemini-api',
    modelId: 'gemini-flash-latest',
    status: 'completed',
    providerResponse: {
      providerFailure: null,
    },
    brainOutput: {
      providerFailure: null,
    },
  });

  const trace = buildProviderFallbackDecisionTrace({
    readiness: buildReadiness(),
    primaryAttempt,
    fallbackAttempt,
    selectedFinalAttempt: fallbackAttempt,
    providerRetryPolicy: {
      kind: 'provider_retry_policy',
      version: 1,
      maxAttempts: 1,
      retryableFailureCategories: [
        'transient_unavailable',
      ],
      backoffStrategy: {
        kind: 'none',
        baseDelayMs: 0,
        maxDelayMs: 0,
      },
      maxElapsedMs: null,
      allowFallbackProvider: true,
      appliesToRequestTypes: [
        'generate_text',
      ],
    },
  });

  assert.equal(trace.status, 'fallback_succeeded');
  assert.equal(trace.fallbackConfigured, true);
  assert.equal(trace.fallbackReady, true);
  assert.equal(trace.fallbackAttempted, true);
  assert.equal(trace.fallbackUsed, true);
  assert.equal(trace.fallbackSucceeded, true);
  assert.equal(trace.finalProviderId, 'gemini-api');
});

test('buildProviderFallbackDecisionTrace records configured but not-ready fallback providers explicitly', () => {
  const primaryAttempt = buildAttempt();
  const fallbackAttempt = buildAttempt({
    brainRole: 'fallback',
    brainId: 'alfred-fallback-brain',
    providerId: 'gemini-api',
    modelId: 'gemini-flash-latest',
    status: 'not_ready',
    providerResponse: null,
    brainOutput: null,
  });

  const trace = buildProviderFallbackDecisionTrace({
    readiness: buildReadiness({
      fallbackProvider: {
        providerId: 'gemini-api',
        status: 'not_ready',
      },
    }),
    primaryAttempt,
    fallbackAttempt,
    selectedFinalAttempt: primaryAttempt,
    providerRetryPolicy: {
      kind: 'provider_retry_policy',
      version: 1,
      maxAttempts: 1,
      retryableFailureCategories: [
        'transient_unavailable',
      ],
      backoffStrategy: {
        kind: 'none',
        baseDelayMs: 0,
        maxDelayMs: 0,
      },
      maxElapsedMs: null,
      allowFallbackProvider: true,
      appliesToRequestTypes: [
        'generate_text',
      ],
    },
  });

  assert.equal(trace.status, 'skipped_fallback_not_ready');
  assert.equal(trace.fallbackConfigured, true);
  assert.equal(trace.fallbackReady, false);
  assert.equal(trace.fallbackAttempted, false);
  assert.equal(trace.fallbackProviderStatus, 'not_ready');
  assert.match(trace.decisionReason, /was not ready for invocation/u);
});
