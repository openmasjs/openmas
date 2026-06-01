import { assertMemoryRecord } from '../contracts/memory/memory-record-contract.js';

function normalizeTimestamp(value, description) {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${description} must be a non-empty ISO timestamp.`);
  }

  const normalizedValue = value.trim();

  if (Number.isNaN(Date.parse(normalizedValue))) {
    throw new Error(`${description} must be a valid ISO timestamp.`);
  }

  return normalizedValue;
}

function isDueAtOrBefore(value, evaluatedAtMs) {
  if (!value) {
    return false;
  }

  return Date.parse(value) <= evaluatedAtMs;
}

export function evaluateMemoryRetention({
  memoryRecord,
  now = new Date(),
  includeExpiredMemory = false,
} = {}) {
  const record = assertMemoryRecord(memoryRecord);
  const evaluatedAt = normalizeTimestamp(now, 'Memory retention evaluation timestamp');
  const evaluatedAtMs = Date.parse(evaluatedAt);
  const warnings = [];

  if (!record.createdAt) {
    warnings.push(`Memory record ${record.memoryRecordId} is missing createdAt.`);
  }

  if (!record.updatedAt) {
    warnings.push(`Memory record ${record.memoryRecordId} is missing updatedAt.`);
  }

  const expiredByRetention = isDueAtOrBefore(record.retention.expiresAt, evaluatedAtMs);
  const reviewRequired = isDueAtOrBefore(record.retention.reviewRequiredAt, evaluatedAtMs);
  const expiredByLifecycle = record.lifecycleStatus === 'expired';
  const expired = expiredByRetention || expiredByLifecycle;

  if (reviewRequired) {
    warnings.push(`Memory record ${record.memoryRecordId} requires review as of ${record.retention.reviewRequiredAt}.`);
  }

  if (!expired) {
    return {
      memoryRecordId: record.memoryRecordId,
      evaluatedAt,
      retentionStatus: reviewRequired ? 'review_required' : 'active',
      expired: false,
      reviewRequired,
      effect: 'include',
      decisionType: null,
      reason: null,
      warnings,
    };
  }

  const reason = expiredByRetention
    ? `Memory record ${record.memoryRecordId} expired at ${record.retention.expiresAt}.`
    : `Memory record ${record.memoryRecordId} lifecycleStatus is expired.`;
  const expiredWarning = `Expired memory ${includeExpiredMemory ? 'included by explicit option' : 'omitted'}: ${record.memoryRecordId}`;

  return {
    memoryRecordId: record.memoryRecordId,
    evaluatedAt,
    retentionStatus: 'expired',
    expired: true,
    reviewRequired,
    effect: includeExpiredMemory ? 'include' : 'omit',
    decisionType: 'expired_source',
    reason,
    warnings: [...warnings, expiredWarning],
  };
}
