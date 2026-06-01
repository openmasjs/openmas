import { PROVIDER_FAILURE_CATEGORIES } from './provider-failure-contract.js';

const PROVIDER_HEALTH_STATUSES = new Set([
  'unknown',
  'healthy',
  'degraded',
  'unavailable',
]);

const PROVIDER_EVENT_STATUSES = new Set([
  'completed',
  'failed',
]);

const PROVIDER_ROLE_IDS = new Set([
  'selected_brain',
  'fallback_brain',
  'semantic_classifier',
]);

const PROVIDER_ROLE_IMPACT_LEVELS = new Set([
  'critical',
  'supporting',
]);

const PROVIDER_ROLE_READINESS_STATUSES = new Set([
  'ready',
  'not_ready',
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

function assertOptionalTimestamp(value, description) {
  if (value === undefined || value === null) {
    return null;
  }

  if (!isNonEmptyString(value)) {
    throw new Error(`${description} must be a non-empty ISO timestamp when provided.`);
  }

  const normalizedValue = value.trim();
  const parsedValue = Date.parse(normalizedValue);

  if (Number.isNaN(parsedValue)) {
    throw new Error(`${description} must be a valid ISO timestamp: ${normalizedValue}`);
  }

  return new Date(parsedValue).toISOString();
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

export function assertProviderRoleImpact(providerRoleImpact, description = 'Provider role impact') {
  if (!isPlainObject(providerRoleImpact)) {
    throw new Error(`${description} must be an object.`);
  }

  if (!isNonEmptyString(providerRoleImpact.summary)) {
    throw new Error(`${description} must include a non-empty summary.`);
  }

  return {
    roleId: assertEnumValue(
      providerRoleImpact.roleId,
      PROVIDER_ROLE_IDS,
      `${description} roleId`,
    ),
    impactLevel: assertEnumValue(
      providerRoleImpact.impactLevel,
      PROVIDER_ROLE_IMPACT_LEVELS,
      `${description} impactLevel`,
    ),
    readinessStatus: assertEnumValue(
      providerRoleImpact.readinessStatus,
      PROVIDER_ROLE_READINESS_STATUSES,
      `${description} readinessStatus`,
    ),
    summary: providerRoleImpact.summary.trim(),
  };
}

export function assertProviderHealthSnapshot(snapshot, description = 'Provider health snapshot') {
  if (!isPlainObject(snapshot)) {
    throw new Error(`${description} must be an object.`);
  }

  if (!isNonEmptyString(snapshot.providerId)) {
    throw new Error(`${description} must include a non-empty providerId.`);
  }

  if (!isNonEmptyString(snapshot.providerRoleImpactSummary)) {
    throw new Error(`${description} must include a non-empty providerRoleImpactSummary.`);
  }

  if (!Array.isArray(snapshot.providerRoleImpacts)) {
    throw new Error(`${description} must include a providerRoleImpacts array.`);
  }

  return {
    kind: 'provider_health_snapshot',
    version: 1,
    providerId: snapshot.providerId.trim(),
    modelIds: assertStringArray(snapshot.modelIds ?? [], `${description} modelIds`),
    observedRequestTypes: assertStringArray(
      snapshot.observedRequestTypes ?? [],
      `${description} observedRequestTypes`,
    ),
    latestEventAt: assertOptionalTimestamp(snapshot.latestEventAt, `${description} latestEventAt`),
    latestEventStatus: snapshot.latestEventStatus === null || snapshot.latestEventStatus === undefined
      ? null
      : assertEnumValue(
        snapshot.latestEventStatus,
        PROVIDER_EVENT_STATUSES,
        `${description} latestEventStatus`,
      ),
    lastSuccessAt: assertOptionalTimestamp(snapshot.lastSuccessAt, `${description} lastSuccessAt`),
    lastFailureAt: assertOptionalTimestamp(snapshot.lastFailureAt, `${description} lastFailureAt`),
    lastFailureCategory: snapshot.lastFailureCategory === null || snapshot.lastFailureCategory === undefined
      ? null
      : assertEnumValue(
        snapshot.lastFailureCategory,
        PROVIDER_FAILURE_CATEGORIES,
        `${description} lastFailureCategory`,
      ),
    consecutiveFailureCount: assertOptionalInteger(
      snapshot.consecutiveFailureCount,
      `${description} consecutiveFailureCount`,
    ) ?? 0,
    observedAttemptCount: assertOptionalInteger(
      snapshot.observedAttemptCount,
      `${description} observedAttemptCount`,
    ) ?? 0,
    successfulAttemptCount: assertOptionalInteger(
      snapshot.successfulAttemptCount,
      `${description} successfulAttemptCount`,
    ) ?? 0,
    failedAttemptCount: assertOptionalInteger(
      snapshot.failedAttemptCount,
      `${description} failedAttemptCount`,
    ) ?? 0,
    degraded: assertBoolean(snapshot.degraded, `${description} degraded`),
    unavailable: assertBoolean(snapshot.unavailable, `${description} unavailable`),
    healthStatus: assertEnumValue(
      snapshot.healthStatus,
      PROVIDER_HEALTH_STATUSES,
      `${description} healthStatus`,
    ),
    providerRoleImpactSummary: snapshot.providerRoleImpactSummary.trim(),
    providerRoleImpacts: snapshot.providerRoleImpacts.map((entry, index) => {
      return assertProviderRoleImpact(entry, `${description} providerRoleImpacts[${index}]`);
    }),
    warnings: assertStringArray(snapshot.warnings ?? [], `${description} warnings`),
  };
}

export function assertProviderHealthSnapshotCollection(
  collection,
  description = 'Provider health snapshot collection',
) {
  if (!isPlainObject(collection)) {
    throw new Error(`${description} must be an object.`);
  }

  if (collection.kind !== 'provider_health_snapshot_collection') {
    throw new Error(`${description} must include kind "provider_health_snapshot_collection".`);
  }

  if (collection.version !== 1) {
    throw new Error(`${description} version must be 1.`);
  }

  if (!Array.isArray(collection.snapshots)) {
    throw new Error(`${description} must include a snapshots array.`);
  }

  return {
    kind: 'provider_health_snapshot_collection',
    version: 1,
    generatedAt: assertOptionalTimestamp(collection.generatedAt, `${description} generatedAt`),
    maxHistoricalSessions: assertOptionalInteger(
      collection.maxHistoricalSessions,
      `${description} maxHistoricalSessions`,
    ) ?? 0,
    includedHistoricalSessionCount: assertOptionalInteger(
      collection.includedHistoricalSessionCount,
      `${description} includedHistoricalSessionCount`,
    ) ?? 0,
    includedCurrentInvocation: assertBoolean(
      collection.includedCurrentInvocation,
      `${description} includedCurrentInvocation`,
    ),
    snapshots: collection.snapshots.map((snapshot, index) => {
      return assertProviderHealthSnapshot(snapshot, `${description} snapshots[${index}]`);
    }),
    warnings: assertStringArray(collection.warnings ?? [], `${description} warnings`),
  };
}

export {
  PROVIDER_EVENT_STATUSES,
  PROVIDER_HEALTH_STATUSES,
  PROVIDER_ROLE_IDS,
};
