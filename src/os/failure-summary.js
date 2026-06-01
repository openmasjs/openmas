import { assertSafeOsSerializableValue } from '../contracts/os/openmas-os-runtime-contract.js';

const FAILURE_SUMMARY_KIND = 'openmas_os_failure_summary';
const FAILURE_SUMMARY_VERSION = 1;
const MAX_FAILURE_STRING_LENGTH = 1000;

const SECRET_VALUE_REDACTION_PATTERNS = Object.freeze([
  /sk-(?:or-)?[a-zA-Z0-9_-]{8,}/gu,
  /AIza[a-zA-Z0-9_-]{10,}/gu,
  /xox[baprs]-[a-zA-Z0-9-]{8,}/gu,
  /Bearer\s+[a-zA-Z0-9._~+/-]{12,}/giu,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/gu,
]);

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeSafeString(value, fallback = null) {
  if (!isNonEmptyString(value)) {
    return fallback;
  }

  let redactedValue = value.trim();

  for (const pattern of SECRET_VALUE_REDACTION_PATTERNS) {
    redactedValue = redactedValue.replace(pattern, '[redacted-secret]');
  }

  return redactedValue.slice(0, MAX_FAILURE_STRING_LENGTH);
}

function firstNonEmptyString(values) {
  for (const value of values) {
    if (isNonEmptyString(value)) {
      return value;
    }
  }

  return null;
}

function safeErrorName(error, fallbackName = 'Error') {
  if (error instanceof Error) {
    return normalizeSafeString(error.name, fallbackName);
  }

  return fallbackName;
}

function safeErrorMessage(error, fallbackMessage) {
  if (error instanceof Error) {
    return normalizeSafeString(error.message, fallbackMessage);
  }

  return normalizeSafeString(error, fallbackMessage);
}

export function redactSecretLikeValues(value, fallback = '') {
  return normalizeSafeString(value, fallback) ?? fallback;
}

export function createSafeErrorMessage(error, fallbackMessage = 'OpenMAS OS runtime failure.') {
  return safeErrorMessage(error, fallbackMessage);
}

export function createSafeErrorName(error, fallbackName = 'Error') {
  return safeErrorName(error, fallbackName);
}

export function createSafeFailureSummary({
  reasonCode = 'runtime_failure',
  reason = 'OpenMAS OS runtime failure.',
  message = null,
  error = null,
  errorName = null,
  invocationId = null,
  invocationStatus = null,
  signalId = null,
  signalType = null,
  source = 'openmas-os',
  failedAt = null,
} = {}) {
  const fallbackReason = normalizeSafeString(reason, 'OpenMAS OS runtime failure.');
  const normalizedMessage = firstNonEmptyString([
    message,
    error instanceof Error ? error.message : error,
    fallbackReason,
  ]);
  const summary = {
    kind: FAILURE_SUMMARY_KIND,
    version: FAILURE_SUMMARY_VERSION,
    reasonCode: normalizeSafeString(reasonCode, 'runtime_failure'),
    reason: fallbackReason,
    message: normalizeSafeString(normalizedMessage, fallbackReason),
    errorName: normalizeSafeString(errorName, null) ?? (error ? safeErrorName(error) : null),
    invocationId: normalizeSafeString(invocationId, null),
    invocationStatus: normalizeSafeString(invocationStatus, null),
    signalId: normalizeSafeString(signalId, null),
    signalType: normalizeSafeString(signalType, null),
    source: normalizeSafeString(source, 'openmas-os'),
    failedAt: normalizeSafeString(failedAt, null),
  };

  return assertSafeOsSerializableValue(summary, 'OpenMAS OS failure summary');
}

export function createSafeFailureSummaryFromInvocationResult({
  invocationResult = {},
  failedAt,
  source = 'openmas-os-invocation',
  reasonCode = 'invocation_failed',
  reason = 'OpenMAS OS invocation failed.',
} = {}) {
  const invocationErrors = Array.isArray(invocationResult.errors) ? invocationResult.errors : [];
  const message = firstNonEmptyString([
    invocationResult.message,
    ...invocationErrors,
    reason,
  ]);

  return createSafeFailureSummary({
    reasonCode,
    reason,
    message,
    errorName: invocationResult.errorName,
    invocationId: invocationResult.invocationId,
    invocationStatus: invocationResult.status,
    source,
    failedAt,
  });
}
