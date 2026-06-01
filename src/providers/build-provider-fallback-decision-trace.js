import { assertProviderRetryPolicy } from '../contracts/providers/provider-retry-policy-contract.js';
import { assertProviderFallbackDecisionTrace } from '../contracts/providers/provider-fallback-decision-trace-contract.js';

function normalizeOptionalString(value) {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null;
}

function getAttemptFailureCategory(attempt) {
  return normalizeOptionalString(
    attempt?.providerResponse?.providerFailure?.category
    ?? attempt?.brainOutput?.providerFailure?.category
    ?? null,
  );
}

function getAttemptStatus(attempt) {
  return normalizeOptionalString(attempt?.status) ?? 'not_evaluated';
}

function resolveConfiguredFallbackBrain(readiness, fallbackAttempt) {
  return readiness?.brainSelection?.fallbackBrain ?? fallbackAttempt?.brainId ?? null;
}

function resolveConfiguredFallbackProvider(readiness, fallbackAttempt) {
  return readiness?.providerPreparation?.fallbackBrainProvider ?? fallbackAttempt ?? null;
}

function resolveFallbackAvailability({
  readiness,
  fallbackAttempt,
}) {
  const configuredFallbackBrain = resolveConfiguredFallbackBrain(readiness, fallbackAttempt);
  const configuredFallbackProvider = resolveConfiguredFallbackProvider(readiness, fallbackAttempt);
  const fallbackConfigured = Boolean(configuredFallbackBrain) && Boolean(configuredFallbackProvider);
  const fallbackAttemptStatus = fallbackAttempt ? getAttemptStatus(fallbackAttempt) : null;
  const fallbackProviderStatus = fallbackAttemptStatus
    ?? (
      configuredFallbackProvider?.status === 'ready'
        ? 'not_evaluated'
        : configuredFallbackProvider
          ? 'not_ready'
          : 'not_evaluated'
    );
  const fallbackReady = fallbackAttempt
    ? fallbackAttemptStatus !== 'not_ready' && fallbackAttemptStatus !== 'not_evaluated'
    : Boolean(fallbackConfigured && configuredFallbackProvider?.status === 'ready');

  return {
    fallbackConfigured,
    fallbackReady,
    fallbackAttempted: Boolean(fallbackAttempt && fallbackReady),
    fallbackProviderId: normalizeOptionalString(configuredFallbackProvider?.providerId),
    fallbackProviderStatus,
    fallbackFailureCategory: getAttemptFailureCategory(fallbackAttempt),
  };
}

function createSemanticClassifierImpact(semanticIntentRuntime) {
  const providerClassifierAudit = semanticIntentRuntime?.providerClassifierAudit ?? null;

  if (!providerClassifierAudit) {
    return {
      status: 'not_evaluated',
      providerId: null,
      failureCategory: null,
      fallbackModeUsed: null,
      summary: 'Semantic classifier provider activity was not evaluated for this invocation.',
    };
  }

  const providerId = normalizeOptionalString(
    providerClassifierAudit.providerRequest?.providerId
    ?? providerClassifierAudit.providerResponse?.providerId
    ?? null,
  );
  const lastAttempt = Array.isArray(providerClassifierAudit.attempts)
    ? providerClassifierAudit.attempts.at(-1) ?? null
    : null;
  const failureCategory = normalizeOptionalString(
    lastAttempt?.failureCategory
    ?? providerClassifierAudit.providerResponse?.providerFailure?.category
    ?? null,
  );
  const fallbackModeUsed = normalizeOptionalString(providerClassifierAudit.fallbackModeUsed);

  if (providerClassifierAudit.status === 'completed') {
    return {
      status: 'completed',
      providerId,
      failureCategory: null,
      fallbackModeUsed: null,
      summary: providerId
        ? `Semantic classifier provider ${providerId} completed successfully and did not drive brain fallback.`
        : 'Semantic classifier provider completed successfully and did not drive brain fallback.',
    };
  }

  return {
    status: 'failed',
    providerId,
    failureCategory,
    fallbackModeUsed,
    summary: providerId
      ? `Semantic classifier provider ${providerId} failed independently of the primary/fallback brain path${failureCategory ? ` (${failureCategory})` : ''}; runtime used ${fallbackModeUsed ?? 'safe degradation'}.`
      : `Semantic classifier provider failed independently of the primary/fallback brain path${failureCategory ? ` (${failureCategory})` : ''}.`,
  };
}

function buildDecisionReason({
  status,
  primaryAttempt,
  fallbackAvailability,
  normalizedRetryPolicy,
}) {
  const primaryProviderId = normalizeOptionalString(primaryAttempt?.providerId) ?? 'the primary provider';
  const fallbackProviderId = fallbackAvailability.fallbackProviderId ?? 'the fallback provider';
  const primaryFailureCategory = getAttemptFailureCategory(primaryAttempt);
  const fallbackFailureCategory = fallbackAvailability.fallbackFailureCategory;

  if (status === 'skipped_primary_completed') {
    return `Primary provider ${primaryProviderId} completed successfully, so fallback was not needed.`;
  }

  if (status === 'skipped_policy_disallowed') {
    return fallbackAvailability.fallbackConfigured
      ? `Primary provider ${primaryProviderId} did not complete, and fallback provider ${fallbackProviderId} was available but skipped because the retry policy disallows fallback providers.`
      : `Primary provider ${primaryProviderId} did not complete, but fallback was skipped because the retry policy disallows fallback providers.`;
  }

  if (status === 'skipped_fallback_not_configured') {
    return `Primary provider ${primaryProviderId} did not complete, but no fallback brain/provider is configured for this invocation.`;
  }

  if (status === 'skipped_fallback_not_ready') {
    return `Primary provider ${primaryProviderId} did not complete, but fallback provider ${fallbackProviderId} was not ready for invocation.`;
  }

  if (status === 'fallback_succeeded') {
    return `Primary provider ${primaryProviderId} failed${primaryFailureCategory ? ` (${primaryFailureCategory})` : ''}, so runtime used fallback provider ${fallbackProviderId} successfully.`;
  }

  if (status === 'fallback_failed') {
    return `Primary provider ${primaryProviderId} failed${primaryFailureCategory ? ` (${primaryFailureCategory})` : ''}, fallback provider ${fallbackProviderId} was attempted${fallbackFailureCategory ? ` and also failed (${fallbackFailureCategory})` : ' but did not recover the invocation'}.`;
  }

  return normalizedRetryPolicy.allowFallbackProvider
    ? `Fallback decision for ${primaryProviderId} could not be summarized precisely.`
    : `Fallback was disabled by policy for ${primaryProviderId}.`;
}

export function buildProviderFallbackDecisionTrace({
  readiness = null,
  primaryAttempt,
  fallbackAttempt = null,
  selectedFinalAttempt = null,
  providerRetryPolicy = null,
  semanticIntentRuntime = null,
}) {
  const normalizedRetryPolicy = assertProviderRetryPolicy(providerRetryPolicy);
  const primaryStatus = getAttemptStatus(primaryAttempt);
  const fallbackAvailability = resolveFallbackAvailability({
    readiness,
    fallbackAttempt,
  });
  const fallbackUsed = selectedFinalAttempt?.brainRole === 'fallback';
  const fallbackSucceeded = fallbackUsed && selectedFinalAttempt?.status === 'completed';
  let status = 'skipped_primary_completed';

  if (primaryStatus === 'completed') {
    status = 'skipped_primary_completed';
  } else if (!normalizedRetryPolicy.allowFallbackProvider) {
    status = 'skipped_policy_disallowed';
  } else if (!fallbackAvailability.fallbackConfigured) {
    status = 'skipped_fallback_not_configured';
  } else if (!fallbackAvailability.fallbackReady) {
    status = 'skipped_fallback_not_ready';
  } else if (fallbackSucceeded) {
    status = 'fallback_succeeded';
  } else {
    status = 'fallback_failed';
  }

  return assertProviderFallbackDecisionTrace({
    kind: 'provider_fallback_decision_trace',
    version: 1,
    status,
    policyAllowsFallback: normalizedRetryPolicy.allowFallbackProvider,
    fallbackConfigured: fallbackAvailability.fallbackConfigured,
    fallbackReady: fallbackAvailability.fallbackReady,
    fallbackAttempted: fallbackAvailability.fallbackAttempted,
    fallbackUsed,
    fallbackSucceeded,
    primaryProviderId: normalizeOptionalString(primaryAttempt?.providerId),
    primaryProviderStatus: primaryStatus,
    primaryFailureCategory: getAttemptFailureCategory(primaryAttempt),
    fallbackProviderId: fallbackAvailability.fallbackProviderId,
    fallbackProviderStatus: fallbackAvailability.fallbackProviderStatus,
    fallbackFailureCategory: fallbackAvailability.fallbackFailureCategory,
    finalProviderId: normalizeOptionalString(selectedFinalAttempt?.providerId),
    decisionReason: buildDecisionReason({
      status,
      primaryAttempt,
      fallbackAvailability,
      normalizedRetryPolicy,
    }),
    semanticClassifierImpact: createSemanticClassifierImpact(semanticIntentRuntime),
    warnings: [],
  });
}
