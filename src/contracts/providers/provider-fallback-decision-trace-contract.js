import { PROVIDER_FAILURE_CATEGORIES } from './provider-failure-contract.js';

const PROVIDER_FALLBACK_TRACE_STATUSES = new Set([
  'skipped_primary_completed',
  'skipped_policy_disallowed',
  'skipped_fallback_not_configured',
  'skipped_fallback_not_ready',
  'fallback_succeeded',
  'fallback_failed',
]);

const PROVIDER_ATTEMPT_STATUSES = new Set([
  'completed',
  'failed',
  'not_ready',
  'not_evaluated',
]);

const SEMANTIC_CLASSIFIER_IMPACT_STATUSES = new Set([
  'not_evaluated',
  'completed',
  'failed',
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

function assertOptionalString(value, description) {
  if (value === undefined || value === null) {
    return null;
  }

  if (!isNonEmptyString(value)) {
    throw new Error(`${description} must be a non-empty string when provided.`);
  }

  return value.trim();
}

function assertBoolean(value, description) {
  if (typeof value !== 'boolean') {
    throw new Error(`${description} must be a boolean.`);
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

function assertOptionalFailureCategory(value, description) {
  if (value === undefined || value === null) {
    return null;
  }

  return assertEnumValue(value, PROVIDER_FAILURE_CATEGORIES, description);
}

export function assertSemanticClassifierImpact(
  semanticClassifierImpact,
  description = 'Semantic classifier impact',
) {
  if (!isPlainObject(semanticClassifierImpact)) {
    throw new Error(`${description} must be an object.`);
  }

  if (!isNonEmptyString(semanticClassifierImpact.summary)) {
    throw new Error(`${description} must include a non-empty summary.`);
  }

  return {
    status: assertEnumValue(
      semanticClassifierImpact.status,
      SEMANTIC_CLASSIFIER_IMPACT_STATUSES,
      `${description} status`,
    ),
    providerId: assertOptionalString(semanticClassifierImpact.providerId, `${description} providerId`),
    failureCategory: assertOptionalFailureCategory(
      semanticClassifierImpact.failureCategory,
      `${description} failureCategory`,
    ),
    fallbackModeUsed: assertOptionalString(
      semanticClassifierImpact.fallbackModeUsed,
      `${description} fallbackModeUsed`,
    ),
    summary: semanticClassifierImpact.summary.trim(),
  };
}

export function assertProviderFallbackDecisionTrace(
  trace,
  description = 'Provider fallback decision trace',
) {
  if (!isPlainObject(trace)) {
    throw new Error(`${description} must be an object.`);
  }

  if (trace.kind !== 'provider_fallback_decision_trace') {
    throw new Error(`${description} must include kind "provider_fallback_decision_trace".`);
  }

  if (trace.version !== 1) {
    throw new Error(`${description} version must be 1.`);
  }

  if (!isNonEmptyString(trace.decisionReason)) {
    throw new Error(`${description} must include a non-empty decisionReason.`);
  }

  return {
    kind: 'provider_fallback_decision_trace',
    version: 1,
    status: assertEnumValue(
      trace.status,
      PROVIDER_FALLBACK_TRACE_STATUSES,
      `${description} status`,
    ),
    policyAllowsFallback: assertBoolean(trace.policyAllowsFallback, `${description} policyAllowsFallback`),
    fallbackConfigured: assertBoolean(trace.fallbackConfigured, `${description} fallbackConfigured`),
    fallbackReady: assertBoolean(trace.fallbackReady, `${description} fallbackReady`),
    fallbackAttempted: assertBoolean(trace.fallbackAttempted, `${description} fallbackAttempted`),
    fallbackUsed: assertBoolean(trace.fallbackUsed, `${description} fallbackUsed`),
    fallbackSucceeded: assertBoolean(trace.fallbackSucceeded, `${description} fallbackSucceeded`),
    primaryProviderId: assertOptionalString(trace.primaryProviderId, `${description} primaryProviderId`),
    primaryProviderStatus: assertEnumValue(
      trace.primaryProviderStatus,
      PROVIDER_ATTEMPT_STATUSES,
      `${description} primaryProviderStatus`,
    ),
    primaryFailureCategory: assertOptionalFailureCategory(
      trace.primaryFailureCategory,
      `${description} primaryFailureCategory`,
    ),
    fallbackProviderId: assertOptionalString(trace.fallbackProviderId, `${description} fallbackProviderId`),
    fallbackProviderStatus: assertEnumValue(
      trace.fallbackProviderStatus,
      PROVIDER_ATTEMPT_STATUSES,
      `${description} fallbackProviderStatus`,
    ),
    fallbackFailureCategory: assertOptionalFailureCategory(
      trace.fallbackFailureCategory,
      `${description} fallbackFailureCategory`,
    ),
    finalProviderId: assertOptionalString(trace.finalProviderId, `${description} finalProviderId`),
    decisionReason: trace.decisionReason.trim(),
    semanticClassifierImpact: assertSemanticClassifierImpact(
      trace.semanticClassifierImpact ?? {
        status: 'not_evaluated',
        providerId: null,
        failureCategory: null,
        fallbackModeUsed: null,
        summary: 'Semantic classifier impact was not evaluated for this invocation.',
      },
      `${description} semanticClassifierImpact`,
    ),
    warnings: assertStringArray(trace.warnings ?? [], `${description} warnings`),
  };
}

export {
  PROVIDER_FALLBACK_TRACE_STATUSES,
};
