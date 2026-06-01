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

export function evaluateMemoryStaleness({
  memoryRecord,
  now = new Date(),
  includeStaleMemory = false,
} = {}) {
  const record = assertMemoryRecord(memoryRecord);
  const evaluatedAt = normalizeTimestamp(now, 'Memory staleness evaluation timestamp');
  const evaluatedAtMs = Date.parse(evaluatedAt);
  const staleByRetention = isDueAtOrBefore(record.retention.staleAfter, evaluatedAtMs);
  const staleByLifecycle = record.lifecycleStatus === 'stale';
  const stale = staleByRetention || staleByLifecycle;

  if (!stale) {
    return {
      memoryRecordId: record.memoryRecordId,
      evaluatedAt,
      stale: false,
      effect: 'include',
      decisionType: null,
      reason: null,
      warnings: [],
    };
  }

  const reason = staleByRetention
    ? `Memory record ${record.memoryRecordId} became stale at ${record.retention.staleAfter}.`
    : `Memory record ${record.memoryRecordId} lifecycleStatus is stale.`;
  const staleWarning = `Stale memory ${includeStaleMemory ? 'included by explicit option' : 'omitted'}: ${record.memoryRecordId}`;

  return {
    memoryRecordId: record.memoryRecordId,
    evaluatedAt,
    stale: true,
    effect: includeStaleMemory ? 'include' : 'omit',
    decisionType: 'stale_source',
    reason,
    warnings: [staleWarning],
  };
}
