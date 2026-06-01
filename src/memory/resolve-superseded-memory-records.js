import { assertMemoryRecord } from '../contracts/memory/memory-record-contract.js';

function chooseSupersedingRecordId(existingRecordId, candidateRecordId) {
  if (!existingRecordId) {
    return candidateRecordId;
  }

  return existingRecordId.localeCompare(candidateRecordId) <= 0
    ? existingRecordId
    : candidateRecordId;
}

export function resolveSupersededMemoryRecords(memoryRecords) {
  if (!Array.isArray(memoryRecords)) {
    throw new Error('Supersession resolution requires a memoryRecords array.');
  }

  const records = memoryRecords.map((memoryRecord) => {
    return assertMemoryRecord(memoryRecord);
  });
  const recordIds = new Set(records.map((record) => record.memoryRecordId));
  const supersededByRecordId = new Map();
  const warnings = [];

  for (const record of records.toSorted((left, right) => {
    return left.memoryRecordId.localeCompare(right.memoryRecordId);
  })) {
    if (record.supersession.supersededByMemoryRecordId) {
      const supersedingRecordId = record.supersession.supersededByMemoryRecordId;

      supersededByRecordId.set(
        record.memoryRecordId,
        chooseSupersedingRecordId(
          supersededByRecordId.get(record.memoryRecordId),
          supersedingRecordId,
        ),
      );

      if (!recordIds.has(supersedingRecordId)) {
        warnings.push(`Memory record ${record.memoryRecordId} references missing superseding record ${supersedingRecordId}.`);
      }
    }

    for (const supersededMemoryRecordId of record.supersession.supersedesMemoryRecordIds) {
      supersededByRecordId.set(
        supersededMemoryRecordId,
        chooseSupersedingRecordId(
          supersededByRecordId.get(supersededMemoryRecordId),
          record.memoryRecordId,
        ),
      );

      if (!recordIds.has(supersededMemoryRecordId)) {
        warnings.push(`Memory record ${record.memoryRecordId} supersedes missing record ${supersededMemoryRecordId}.`);
      }
    }
  }

  return {
    memoryRecords: records,
    supersededMemoryRecordIds: [...supersededByRecordId.keys()].toSorted(),
    supersededByRecordId,
    warnings,
  };
}

export function isMemoryRecordSuperseded(memoryRecord, supersessionResolution) {
  const record = assertMemoryRecord(memoryRecord);

  return (
    record.lifecycleStatus === 'superseded'
    || supersessionResolution.supersededByRecordId.has(record.memoryRecordId)
  );
}

export function evaluateMemorySupersession({
  memoryRecord,
  supersessionResolution,
  includeSupersededMemory = false,
} = {}) {
  const record = assertMemoryRecord(memoryRecord);
  const supersededByMemoryRecordId = supersessionResolution?.supersededByRecordId?.get(record.memoryRecordId)
    ?? record.supersession.supersededByMemoryRecordId
    ?? null;
  const superseded = record.lifecycleStatus === 'superseded' || Boolean(supersededByMemoryRecordId);

  if (!superseded) {
    return {
      memoryRecordId: record.memoryRecordId,
      superseded: false,
      supersededByMemoryRecordId: null,
      effect: 'include',
      decisionType: null,
      reason: null,
      warnings: [],
    };
  }

  const reason = supersededByMemoryRecordId
    ? `Memory record ${record.memoryRecordId} is superseded by ${supersededByMemoryRecordId}.`
    : `Memory record ${record.memoryRecordId} lifecycleStatus is superseded.`;
  const warning = `Superseded memory ${includeSupersededMemory ? 'included by explicit option' : 'omitted'}: ${record.memoryRecordId}`;

  return {
    memoryRecordId: record.memoryRecordId,
    superseded: true,
    supersededByMemoryRecordId,
    effect: includeSupersededMemory ? 'include' : 'omit',
    decisionType: 'superseded_source',
    reason,
    warnings: [warning],
  };
}
