import { createHash } from 'node:crypto';
import { assertMemoryWritebackRequest } from '../contracts/memory/memory-writeback-contract.js';
import { assertToolDefinition } from '../contracts/tools/tool-definition-contract.js';
import { assertToolResult } from '../contracts/tools/tool-result-contract.js';
import { truncateText } from '../memory/memory-reader-utils.js';

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function createSha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function createStableWriteId(...parts) {
  return `write_${createSha256(parts.join('|')).slice(0, 32)}`;
}

function buildToolResultSourceReference(toolResult) {
  return {
    kind: 'memory_source_reference',
    version: 1,
    sourceType: 'tool_result',
    sourceId: toolResult.toolRunId,
    scope: 'operational_identity',
    ownerId: toolResult.audit.operationalIdentityId,
    path: `memory/state/tool-run-${toolResult.toolRunId}.json`,
    origin: 'runtime_observed',
    sensitivityLevel: 'internal',
    createdAt: toolResult.audit.completedAt,
    contentSha256: null,
  };
}

function buildToolSubjectReferences(toolResult) {
  return [
    {
      subjectType: 'tool_run',
      subjectId: toolResult.toolRunId,
      relationship: 'source-tool-run',
    },
    {
      subjectType: 'resource',
      subjectId: toolResult.toolId,
      relationship: 'executed-tool',
    },
    {
      subjectType: 'operational_identity',
      subjectId: toolResult.audit.operationalIdentityId,
      relationship: 'tool-request-owner',
    },
    {
      subjectType: 'invocation',
      subjectId: toolResult.audit.invocationId,
      relationship: 'source-invocation',
    },
  ];
}

export function buildToolResultArtifactReferenceCandidate({
  toolResult,
}) {
  const normalizedToolResult = assertToolResult(toolResult);
  const summary = `Tool ${normalizedToolResult.toolId} produced runtime evidence with status "${normalizedToolResult.status}".`;

  return {
    kind: 'memory_write_candidate',
    writeId: createStableWriteId(
      'tool-result-artifact-reference',
      normalizedToolResult.audit.invocationId,
      normalizedToolResult.toolRunId,
    ),
    writeType: 'artifact_reference',
    targetMemoryType: 'artifact_reference',
    scope: 'operational_identity',
    ownerId: normalizedToolResult.audit.operationalIdentityId,
    origin: 'runtime_observed',
    portability: 'mas_bound',
    visibility: 'private_to_owner',
    sensitivityLevel: 'internal',
    authorityLevel: 'runtime_evidence',
    summary: truncateText(summary, 220),
    content: null,
    sourceReferences: [buildToolResultSourceReference(normalizedToolResult)],
    subjectReferences: buildToolSubjectReferences(normalizedToolResult),
    approvalState: 'pending',
    redactionState: 'not_required',
    sourceGovernance: {
      sourceScopes: ['operational_identity'],
      sourceOwnerIds: [normalizedToolResult.audit.operationalIdentityId],
      mostRestrictiveVisibility: 'private_to_owner',
      highestSensitivityLevel: 'internal',
      requiresHumanApproval: false,
    },
    reason: 'The tool produced auditable runtime evidence that may be useful as a reviewed artifact reference.',
    warnings: [
      'Raw tool result data is intentionally not copied into this memory writeback candidate.',
    ],
  };
}

function uniqueCandidates(candidates) {
  const candidateByWriteId = new Map();

  for (const candidate of candidates) {
    candidateByWriteId.set(candidate.writeId, candidate);
  }

  return [...candidateByWriteId.values()];
}

export function proposeMemoryWritebackForToolResult({
  toolResult,
  toolDefinition,
  requestedBy = 'tool-runtime',
} = {}) {
  const normalizedToolResult = assertToolResult(toolResult);
  const normalizedToolDefinition = toolDefinition ? assertToolDefinition(toolDefinition) : null;

  if (normalizedToolDefinition && normalizedToolDefinition.toolId !== normalizedToolResult.toolId) {
    throw new Error(`Tool writeback proposal toolDefinition "${normalizedToolDefinition.toolId}" does not match toolResult "${normalizedToolResult.toolId}".`);
  }

  if (
    normalizedToolDefinition
    && normalizedToolDefinition.memoryPolicy.allowWritebackCandidates !== true
  ) {
    return assertMemoryWritebackRequest({
      kind: 'memory_writeback_request',
      version: 1,
      invocationId: normalizedToolResult.audit.invocationId,
      requestedBy,
      requiresHumanApproval: false,
      memoryWrites: [],
      warnings: [
        `Runtime notice: Tool ${normalizedToolResult.toolId} runtime memory writeback candidates are disabled by tool policy.`,
      ],
    });
  }

  const memoryWrites = uniqueCandidates([
    ...normalizedToolResult.memoryWritebackCandidates,
    buildToolResultArtifactReferenceCandidate({
      toolResult: normalizedToolResult,
    }),
  ]);

  return assertMemoryWritebackRequest({
    kind: 'memory_writeback_request',
    version: 1,
    invocationId: normalizedToolResult.audit.invocationId,
    requestedBy: isNonEmptyString(requestedBy) ? requestedBy.trim() : 'tool-runtime',
    requiresHumanApproval: memoryWrites.length > 0,
    memoryWrites,
    warnings: [],
  });
}
