import { createHash } from 'node:crypto';
import { assertMemoryWritebackRequest } from '../contracts/memory/memory-writeback-contract.js';
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

function resolveOperationalIdentityId(invocationSession) {
  return invocationSession.operationalIdentityId
    ?? 'unknown-owner';
}

function buildInvocationSessionSourceReference(invocationSession) {
  const ownerId = resolveOperationalIdentityId(invocationSession);

  return {
    kind: 'memory_source_reference',
    version: 1,
    sourceType: 'invocation_session',
    sourceId: invocationSession.invocationId,
    scope: invocationSession.operationalIdentityId ? 'operational_identity' : 'mas_instance',
    ownerId,
    path: `memory/state/agent-invocation-${invocationSession.invocationId}.json`,
    origin: 'runtime_observed',
    sensitivityLevel: 'internal',
    createdAt: invocationSession.finishedAt ?? invocationSession.startedAt ?? null,
    contentSha256: null,
  };
}

function buildInvocationReportSourceReference({ invocationSession, invocationReport }) {
  const ownerId = resolveOperationalIdentityId(invocationSession);

  return {
    kind: 'memory_source_reference',
    version: 1,
    sourceType: 'invocation_report',
    sourceId: invocationReport.reportId ?? invocationReport.reportKind ?? `report-${invocationSession.invocationId}`,
    scope: 'mas_instance',
    ownerId,
    path: invocationReport.path ?? null,
    origin: 'runtime_observed',
    sensitivityLevel: 'internal',
    createdAt: invocationSession.finishedAt ?? invocationSession.startedAt ?? null,
    contentSha256: invocationReport.contentSha256 ?? null,
  };
}

function buildInvocationSubjectReferences(invocationSession) {
  const subjectReferences = [
    {
      subjectType: 'invocation',
      subjectId: invocationSession.invocationId,
      relationship: 'source-invocation',
    },
  ];

  if (isNonEmptyString(invocationSession.operationalIdentityId)) {
    subjectReferences.push({
      subjectType: 'operational_identity',
      subjectId: invocationSession.operationalIdentityId.trim(),
      relationship: 'invoked-identity',
    });
  }

  if (isNonEmptyString(invocationSession.primaryCognitiveIdentityId)) {
    subjectReferences.push({
      subjectType: 'cognitive_identity',
      subjectId: invocationSession.primaryCognitiveIdentityId.trim(),
      relationship: 'primary-cognitive-identity',
    });
  }

  return subjectReferences;
}

function buildConversationSummaryCandidate({ invocationSession }) {
  const ownerId = resolveOperationalIdentityId(invocationSession);
  const outputTextLength = typeof invocationSession.brainOutput?.outputText === 'string'
    ? invocationSession.brainOutput.outputText.length
    : 0;
  const command = invocationSession.request?.command ?? 'unknown';
  const providerId = invocationSession.brainOutput?.providerId ?? invocationSession.providerRequestSummary?.providerId ?? 'unknown-provider';
  const modelId = invocationSession.brainOutput?.modelId ?? invocationSession.providerRequestSummary?.modelId ?? 'unknown-model';
  const summary = `Invocation ${invocationSession.invocationId} completed command "${command}" through ${providerId}/${modelId}.`;
  const content = [
    `Invocation ${invocationSession.invocationId} completed as a probabilistic brain invocation.`,
    `Command: ${command}.`,
    `Operational Identity: ${ownerId}.`,
    `Primary Cognitive Identity: ${invocationSession.primaryCognitiveIdentityId ?? 'unknown'}.`,
    `Provider: ${providerId}.`,
    `Model: ${modelId}.`,
    `Output Length: ${outputTextLength} characters.`,
    'Raw model output is intentionally not stored in this writeback candidate.',
  ].join(' ');

  return {
    kind: 'memory_write_candidate',
    writeId: createStableWriteId('conversation-summary', invocationSession.invocationId),
    writeType: 'conversation_summary',
    targetMemoryType: 'conversation_summary',
    scope: invocationSession.operationalIdentityId ? 'operational_identity' : 'mas_instance',
    ownerId,
    origin: 'agent_proposed',
    portability: 'mas_bound',
    visibility: invocationSession.operationalIdentityId ? 'private_to_owner' : 'restricted',
    sensitivityLevel: 'internal',
    authorityLevel: 'operational_note',
    summary: truncateText(summary, 220),
    content,
    sourceReferences: [buildInvocationSessionSourceReference(invocationSession)],
    subjectReferences: buildInvocationSubjectReferences(invocationSession),
    approvalState: 'pending',
    redactionState: 'not_required',
    sourceGovernance: {
      sourceScopes: invocationSession.operationalIdentityId ? ['operational_identity'] : ['mas_instance'],
      sourceOwnerIds: [ownerId],
      mostRestrictiveVisibility: invocationSession.operationalIdentityId ? 'private_to_owner' : 'restricted',
      highestSensitivityLevel: 'internal',
      requiresHumanApproval: false,
    },
    reason: 'The probabilistic invocation produced useful runtime context that may be worth preserving as a governed conversation summary.',
    warnings: [],
  };
}

function buildArtifactReferenceCandidate({ invocationSession, invocationReport }) {
  const ownerId = resolveOperationalIdentityId(invocationSession);
  const reportLabel = invocationReport.reportKind ?? invocationReport.reportId ?? 'invocation report';

  return {
    kind: 'memory_write_candidate',
    writeId: createStableWriteId('artifact-reference', invocationSession.invocationId, reportLabel),
    writeType: 'artifact_reference',
    targetMemoryType: 'artifact_reference',
    scope: 'mas_instance',
    ownerId,
    origin: 'runtime_observed',
    portability: 'mas_bound',
    visibility: 'restricted',
    sensitivityLevel: 'internal',
    authorityLevel: 'runtime_evidence',
    summary: `Invocation ${invocationSession.invocationId} generated artifact reference ${reportLabel}.`,
    content: null,
    sourceReferences: [
      buildInvocationSessionSourceReference(invocationSession),
      buildInvocationReportSourceReference({
        invocationSession,
        invocationReport,
      }),
    ],
    subjectReferences: buildInvocationSubjectReferences(invocationSession),
    approvalState: 'pending',
    redactionState: 'not_required',
    sourceGovernance: {
      sourceScopes: ['mas_instance'],
      sourceOwnerIds: [ownerId],
      mostRestrictiveVisibility: 'restricted',
      highestSensitivityLevel: 'internal',
      requiresHumanApproval: false,
    },
    reason: 'The invocation generated a report artifact that can be preserved as a reference without storing the full artifact body.',
    warnings: ['Artifact body is intentionally not copied into the writeback candidate.'],
  };
}

export function proposeMemoryWritebackForInvocation({
  invocationSession,
  invocationReport = null,
  requestedBy = 'runtime',
} = {}) {
  if (!invocationSession || typeof invocationSession !== 'object' || Array.isArray(invocationSession)) {
    throw new Error('Memory writeback proposal requires an invocationSession object.');
  }

  if (!isNonEmptyString(invocationSession.invocationId)) {
    throw new Error('Memory writeback proposal requires invocationSession.invocationId.');
  }

  if (invocationSession.executionType !== 'probabilistic_brain') {
    return assertMemoryWritebackRequest({
      kind: 'memory_writeback_request',
      version: 1,
      invocationId: invocationSession.invocationId,
      requestedBy,
      requiresHumanApproval: false,
      memoryWrites: [],
      warnings: ['No memory writeback candidates were proposed for a non-probabilistic invocation.'],
    });
  }

  const memoryWrites = [
    buildConversationSummaryCandidate({
      invocationSession,
    }),
  ];

  if (invocationReport) {
    memoryWrites.push(buildArtifactReferenceCandidate({
      invocationSession,
      invocationReport,
    }));
  }

  return assertMemoryWritebackRequest({
    kind: 'memory_writeback_request',
    version: 1,
    invocationId: invocationSession.invocationId,
    requestedBy,
    requiresHumanApproval: memoryWrites.length > 0,
    memoryWrites,
    warnings: [],
  });
}
