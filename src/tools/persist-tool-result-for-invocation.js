import path from 'node:path';
import { assertToolDefinition } from '../contracts/tools/tool-definition-contract.js';
import { assertToolResult } from '../contracts/tools/tool-result-contract.js';
import { assertToolRunAuditRecord } from '../contracts/tools/tool-run-audit-contract.js';
import { ensureDirectory } from '../persistence/ensure-directory.js';
import { writeJsonFile } from '../persistence/write-json-file.js';

const DEFAULT_INLINE_DATA_LIMIT_BYTES = 8192;
const DEFAULT_MAX_PERSISTED_RESULT_BYTES = 1024 * 1024;
const SAFE_FILE_TOKEN_PATTERN = /^[a-zA-Z0-9._-]+$/u;
const SENSITIVE_KEY_PATTERN = /(api[_-]?key|authorization|bearer|credential|password|private[_-]?key|secret|token)/iu;
const SENSITIVE_ERROR_TEXT_KEY_PATTERN = /^(errors?|stderr|stack|trace)$/iu;
const SENSITIVE_VALUE_PATTERNS = [
  /sk-or-v1-[a-zA-Z0-9._-]+/gu,
  /AIza[a-zA-Z0-9._-]+/gu,
  /Bearer\s+[a-zA-Z0-9._-]+/gu,
];

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function assertPositiveInteger(value, description) {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${description} must be an integer greater than or equal to 1.`);
  }

  return value;
}

function assertInput({
  masRootPath,
  inlineDataLimitBytes,
  maxPersistedResultBytes,
  redactor,
}) {
  if (!isNonEmptyString(masRootPath)) {
    throw new Error('Tool result persistence requires a non-empty masRootPath.');
  }

  assertPositiveInteger(inlineDataLimitBytes, 'Tool result persistence inlineDataLimitBytes');
  assertPositiveInteger(maxPersistedResultBytes, 'Tool result persistence maxPersistedResultBytes');

  if (typeof redactor !== 'function') {
    throw new Error('Tool result persistence redactor must be a function.');
  }
}

function toSafeFileToken(value, description) {
  if (!isNonEmptyString(value)) {
    throw new Error(`${description} must be a non-empty string.`);
  }

  const normalizedValue = value.trim();

  if (!SAFE_FILE_TOKEN_PATTERN.test(normalizedValue)) {
    throw new Error(`${description} contains unsafe filesystem characters: ${normalizedValue}`);
  }

  return normalizedValue;
}

function getJsonByteSize(value) {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

function redactString(value) {
  let redactedValue = value;
  let redactionApplied = false;

  for (const pattern of SENSITIVE_VALUE_PATTERNS) {
    redactedValue = redactedValue.replace(pattern, () => {
      redactionApplied = true;
      return '[REDACTED]';
    });
  }

  return {
    value: redactedValue,
    redactionApplied,
  };
}

function redactValue(value, { currentKey = '', seen = new WeakSet() } = {}) {
  if (SENSITIVE_KEY_PATTERN.test(currentKey)) {
    return {
      value: '[REDACTED]',
      redactionApplied: true,
    };
  }

  if (typeof value === 'string') {
    if (SENSITIVE_ERROR_TEXT_KEY_PATTERN.test(currentKey)) {
      return {
        value: '[REDACTED]',
        redactionApplied: true,
      };
    }

    return redactString(value);
  }

  if (value === null || typeof value === 'number' || typeof value === 'boolean') {
    return {
      value,
      redactionApplied: false,
    };
  }

  if (typeof value === 'bigint') {
    return {
      value: value.toString(),
      redactionApplied: false,
    };
  }

  if (typeof value === 'undefined' || typeof value === 'function' || typeof value === 'symbol') {
    return {
      value: null,
      redactionApplied: true,
    };
  }

  if (value instanceof Date) {
    return {
      value: value.toISOString(),
      redactionApplied: false,
    };
  }

  if (Array.isArray(value)) {
    let redactionApplied = false;
    const redactedItems = value.map((item) => {
      const redactedItem = redactValue(item, { currentKey, seen });
      redactionApplied = redactionApplied || redactedItem.redactionApplied;
      return redactedItem.value;
    });

    return {
      value: redactedItems,
      redactionApplied,
    };
  }

  if (isPlainObject(value)) {
    if (seen.has(value)) {
      return {
        value: '[CIRCULAR_REFERENCE]',
        redactionApplied: true,
      };
    }

    seen.add(value);

    let redactionApplied = false;
    const redactedObject = {};

    for (const [key, childValue] of Object.entries(value)) {
      const redactedChild = redactValue(childValue, { currentKey: key, seen });
      redactedObject[key] = redactedChild.value;
      redactionApplied = redactionApplied || redactedChild.redactionApplied;
    }

    seen.delete(value);

    return {
      value: redactedObject,
      redactionApplied,
    };
  }

  return {
    value: String(value),
    redactionApplied: true,
  };
}

export function redactToolResultForPersistence(toolResult) {
  return redactValue(toolResult);
}

function buildArtifactReference({
  artifactId,
  artifactKind,
  relativePath,
  summary,
}) {
  return {
    artifactId,
    artifactKind,
    path: relativePath.replaceAll(path.sep, '/'),
    summary,
  };
}

function decideFullResultArtifactReason({
  toolDefinition,
  dataSizeBytes,
  inlineDataLimitBytes,
}) {
  if (toolDefinition.artifactPolicy.persistResult) {
    return 'tool_artifact_policy';
  }

  if (dataSizeBytes > inlineDataLimitBytes) {
    return 'inline_data_limit_exceeded';
  }

  return null;
}

function buildToolResultSnapshot({
  toolResult,
  redactedToolResult,
  redactionApplied,
  maxPersistedResultBytes,
  persistedAt,
}) {
  const snapshot = {
    kind: 'tool_result_snapshot',
    version: 1,
    toolId: toolResult.toolId,
    toolRunId: toolResult.toolRunId,
    persistedAt,
    redaction: {
      strategy: 'default_sensitive_key_and_value_redaction',
      redactionApplied,
    },
    result: redactedToolResult,
  };
  const snapshotSizeBytes = getJsonByteSize(snapshot);

  if (snapshotSizeBytes <= maxPersistedResultBytes) {
    return {
      snapshot,
      snapshotSizeBytes,
      truncated: false,
    };
  }

  const truncatedSnapshot = {
    ...snapshot,
    result: {
      ...redactedToolResult,
      data: {
        omitted: true,
        reason: 'Redacted tool result snapshot exceeded maxPersistedResultBytes.',
        originalDataSizeBytes: getJsonByteSize(redactedToolResult.data),
      },
    },
  };

  return {
    snapshot: truncatedSnapshot,
    snapshotSizeBytes: getJsonByteSize(truncatedSnapshot),
    truncated: true,
  };
}

function buildAuditRecord({
  toolResult,
  redactedData,
  redactionApplied,
  inlineDataLimitBytes,
  dataSizeBytes,
  persistedAt,
  fullResultArtifactReason,
  artifactReferences,
}) {
  return assertToolRunAuditRecord({
    kind: 'tool_run_audit_record',
    version: 1,
    toolId: toolResult.toolId,
    toolRunId: toolResult.toolRunId,
    status: toolResult.status,
    summary: toolResult.summary,
    audit: toolResult.audit,
    artifactReferences,
    resultEvidence: {
      dataSizeBytes,
      inlineDataLimitBytes,
      inlineDataIncluded: dataSizeBytes <= inlineDataLimitBytes,
      fullResultArtifactPersisted: fullResultArtifactReason !== null,
      fullResultArtifactReason,
      redactionApplied,
    },
    dataPreview: dataSizeBytes <= inlineDataLimitBytes ? redactedData : null,
    warnings: toolResult.warnings,
    errors: toolResult.errors,
    memoryWritebackCandidateCount: toolResult.memoryWritebackCandidates.length,
    persistedAt,
  });
}

export async function persistToolResultForInvocation({
  masRootPath,
  toolDefinition,
  toolResult,
  inlineDataLimitBytes = DEFAULT_INLINE_DATA_LIMIT_BYTES,
  maxPersistedResultBytes = DEFAULT_MAX_PERSISTED_RESULT_BYTES,
  redactor = redactToolResultForPersistence,
} = {}) {
  assertInput({
    masRootPath,
    inlineDataLimitBytes,
    maxPersistedResultBytes,
    redactor,
  });

  const normalizedToolDefinition = assertToolDefinition(toolDefinition);
  const normalizedToolResult = assertToolResult(toolResult);

  if (normalizedToolDefinition.toolId !== normalizedToolResult.toolId) {
    throw new Error(`Tool result toolId "${normalizedToolResult.toolId}" does not match tool definition "${normalizedToolDefinition.toolId}".`);
  }

  const toolRunFileToken = toSafeFileToken(normalizedToolResult.toolRunId, 'Tool result persistence toolRunId');
  const stateDirectoryPath = path.join(masRootPath, 'memory', 'state');
  const artifactsDirectoryPath = path.join(masRootPath, 'memory', 'artifacts');
  const persistedAt = new Date().toISOString();
  const redactedOutcome = redactor(normalizedToolResult);

  if (!isPlainObject(redactedOutcome) || !('value' in redactedOutcome) || typeof redactedOutcome.redactionApplied !== 'boolean') {
    throw new Error('Tool result persistence redactor must return { value, redactionApplied }.');
  }

  const redactedToolResult = assertToolResult(redactedOutcome.value);
  const redactedData = redactedToolResult.data;
  const dataSizeBytes = getJsonByteSize(redactedData);
  const fullResultArtifactReason = decideFullResultArtifactReason({
    toolDefinition: normalizedToolDefinition,
    dataSizeBytes,
    inlineDataLimitBytes,
  });
  const auditRecordPath = path.join(stateDirectoryPath, `tool-run-${toolRunFileToken}.json`);
  const resultSnapshotPath = fullResultArtifactReason === null
    ? null
    : path.join(artifactsDirectoryPath, `tool-result-${toolRunFileToken}.json`);
  const resultSnapshotRelativePath = resultSnapshotPath === null
    ? null
    : path.join('memory', 'artifacts', `tool-result-${toolRunFileToken}.json`);
  const resultSnapshotArtifact = resultSnapshotPath === null
    ? null
    : buildArtifactReference({
      artifactId: `tool-result-${toolRunFileToken}`,
      artifactKind: 'tool_result_snapshot',
      relativePath: resultSnapshotRelativePath,
      summary: `Redacted tool result snapshot for ${normalizedToolDefinition.toolId}.`,
    });
  const artifactReferences = [
    ...redactedToolResult.artifacts,
    ...(resultSnapshotArtifact ? [resultSnapshotArtifact] : []),
  ];
  const auditRecord = buildAuditRecord({
    toolResult: redactedToolResult,
    redactedData,
    redactionApplied: redactedOutcome.redactionApplied,
    inlineDataLimitBytes,
    dataSizeBytes,
    persistedAt,
    fullResultArtifactReason,
    artifactReferences,
  });
  const resultSnapshot = resultSnapshotPath === null
    ? null
    : buildToolResultSnapshot({
      toolResult: redactedToolResult,
      redactedToolResult,
      redactionApplied: redactedOutcome.redactionApplied,
      maxPersistedResultBytes,
      persistedAt,
    });

  await ensureDirectory(stateDirectoryPath);
  await ensureDirectory(artifactsDirectoryPath);
  await writeJsonFile(auditRecordPath, auditRecord);

  if (resultSnapshotPath && resultSnapshot) {
    await writeJsonFile(resultSnapshotPath, resultSnapshot.snapshot);
  }

  return {
    targetType: 'mas-memory',
    auditRecordPath,
    resultSnapshotPath,
    auditRecord,
    resultSnapshot: resultSnapshot?.snapshot ?? null,
    resultSnapshotTruncated: resultSnapshot?.truncated ?? false,
  };
}

export {
  DEFAULT_INLINE_DATA_LIMIT_BYTES,
  DEFAULT_MAX_PERSISTED_RESULT_BYTES,
};
