import { assertMemoryRecord } from '../contracts/memory/memory-record-contract.js';
import { truncateText } from '../memory/memory-reader-utils.js';

export function estimateContextTokens(text) {
  if (typeof text !== 'string' || text.length === 0) {
    return 0;
  }

  return Math.ceil(text.length / 4);
}

export function summarizeMemoryRecordForContext(memoryRecord, options = {}) {
  const record = assertMemoryRecord(memoryRecord);
  const maxContentLength = Number.isInteger(options.maxContentLength) && options.maxContentLength > 0
    ? options.maxContentLength
    : 600;
  const includeContent = options.includeContent !== false && record.sensitivityLevel !== 'secret_reference_only';
  const contentSnippet = includeContent && record.content
    ? truncateText(record.content, maxContentLength)
    : null;

  const lines = [
    `- ${record.summary}`,
    `  Memory Record ID: ${record.memoryRecordId}`,
    `  Type: ${record.memoryType}; Scope: ${record.scope}; Owner: ${record.ownerId}; Authority: ${record.authorityLevel}.`,
    contentSnippet ? `  Context Snippet: ${contentSnippet}` : null,
  ].filter(Boolean);
  const contextText = lines.join('\n');

  return {
    memoryRecordId: record.memoryRecordId,
    memoryType: record.memoryType,
    scope: record.scope,
    ownerId: record.ownerId,
    authorityLevel: record.authorityLevel,
    lifecycleStatus: record.lifecycleStatus,
    sensitivityLevel: record.sensitivityLevel,
    summary: record.summary,
    contentSnippet,
    contextText,
    estimatedTokens: estimateContextTokens(contextText),
    sourceReferences: record.sourceReferences,
    warnings: record.warnings,
  };
}
