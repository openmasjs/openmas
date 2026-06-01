import path from 'node:path';
import { readdir, readFile, stat } from 'node:fs/promises';
import { resolveBoundedChildPath } from '../contracts/shared/bounded-path-contract.js';
import { assertMemoryRecord } from '../contracts/memory/memory-record-contract.js';
import { assertMemorySourceDefinition } from '../contracts/memory/memory-source-registry-contract.js';
import { readConversationSession } from '../conversations/read-conversation-session.js';
import {
  createMemorySourceFilePath,
  createSha256,
  createStableMemoryRecordId,
} from './read-memory-source-files.js';
import { truncateText } from './memory-reader-utils.js';

const SAFE_CONVERSATION_ID_PATTERN = /^[a-zA-Z0-9._-]+$/u;
const TURN_SNIPPET_LENGTH = 320;

const SENSITIVITY_RANK = new Map([
  ['public', 0],
  ['internal', 1],
  ['confidential', 2],
  ['restricted', 3],
  ['secret_reference_only', 4],
]);

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function resolveOperationalIdentityId(readiness) {
  return readiness?.operationalIdentityDefinition?.operationalIdentityId
    ?? readiness?.resolvedOperationalIdentity?.operationalIdentityId
    ?? readiness?.request?.operationalIdentityId
    ?? null;
}

function resolveSelectedConversationId(readiness) {
  return readiness?.conversationContext?.conversationId ?? null;
}

function isConversationAccessDenied(error) {
  return /not allowed to read conversation/u.test(error.message);
}

function pickHighestSensitivityLevel(values) {
  return values.reduce((highestSensitivityLevel, value) => {
    const currentRank = SENSITIVITY_RANK.get(value) ?? 0;
    const highestRank = SENSITIVITY_RANK.get(highestSensitivityLevel) ?? 0;

    return currentRank > highestRank ? value : highestSensitivityLevel;
  }, 'public');
}

function uniqueSubjectReferences(subjectReferences) {
  const seenKeys = new Set();
  const uniqueReferences = [];

  for (const subjectReference of subjectReferences) {
    const key = [
      subjectReference.subjectType,
      subjectReference.subjectId,
      subjectReference.relationship ?? '',
    ].join(':');

    if (seenKeys.has(key)) {
      continue;
    }

    seenKeys.add(key);
    uniqueReferences.push(subjectReference);
  }

  return uniqueReferences;
}

function buildConversationSubjectReferences({
  session,
  turns,
  requesterOperationalIdentityId,
}) {
  const subjectReferences = [
    {
      subjectType: 'operational_identity',
      subjectId: session.owner.operationalIdentityId,
      relationship: 'conversation-owner',
    },
  ];

  if (requesterOperationalIdentityId !== session.owner.operationalIdentityId) {
    subjectReferences.push({
      subjectType: 'operational_identity',
      subjectId: requesterOperationalIdentityId,
      relationship: 'conversation-reader',
    });
  }

  for (const humanParticipantId of session.participants.humanParticipantIds) {
    subjectReferences.push({
      subjectType: 'human',
      subjectId: humanParticipantId,
      relationship: 'conversation-participant',
    });
  }

  for (const operationalIdentityId of session.participants.operationalIdentityIds) {
    subjectReferences.push({
      subjectType: 'operational_identity',
      subjectId: operationalIdentityId,
      relationship: 'conversation-participant',
    });
  }

  for (const turn of turns) {
    if (turn.speaker.speakerType === 'operational_identity') {
      subjectReferences.push({
        subjectType: 'operational_identity',
        subjectId: turn.speaker.speakerId,
        relationship: 'conversation-speaker',
      });
    }

    if (turn.speaker.speakerType === 'human') {
      subjectReferences.push({
        subjectType: 'human',
        subjectId: turn.speaker.speakerId,
        relationship: 'conversation-speaker',
      });
    }

    if (isNonEmptyString(turn.invocationId)) {
      subjectReferences.push({
        subjectType: 'invocation',
        subjectId: turn.invocationId,
        relationship: 'conversation-turn-invocation',
      });
    }

    for (const runtimeReference of turn.runtimeReferences) {
      if (['invocation', 'tool_run', 'workflow_run'].includes(runtimeReference.referenceType)) {
        subjectReferences.push({
          subjectType: runtimeReference.referenceType,
          subjectId: runtimeReference.referenceId,
          relationship: 'conversation-runtime-reference',
        });
      }
    }
  }

  return uniqueSubjectReferences(subjectReferences);
}

function buildConversationSourceReference({
  sourceType,
  sourceId,
  path: sourcePath,
  ownerId,
  createdAt,
  contentSha256,
  sensitivityLevel,
  metadata,
}) {
  return {
    kind: 'memory_source_reference',
    version: 1,
    sourceType,
    sourceId,
    scope: 'operational_identity',
    ownerId,
    path: sourcePath,
    origin: 'runtime_observed',
    sensitivityLevel,
    createdAt,
    contentSha256,
    metadata,
  };
}

function formatTurnForContext(turn) {
  const speaker = turn.speaker.displayName
    ? `${turn.speaker.displayName} (${turn.speaker.speakerId})`
    : turn.speaker.speakerId;
  const runtimeReferences = turn.runtimeReferences.length > 0
    ? turn.runtimeReferences.map((reference) => {
      return `${reference.referenceType}:${reference.referenceId}`;
    }).join(', ')
    : 'none';

  return [
    `- Turn ${turn.sequenceNumber} | Role: ${turn.role} | Speaker: ${speaker} | Created At: ${turn.createdAt}`,
    `  Content Type: ${turn.content.contentType}`,
    `  Sensitivity: ${turn.privacy.sensitivityLevel}`,
    `  Runtime References: ${runtimeReferences}`,
    `  Text: ${truncateText(turn.content.text, TURN_SNIPPET_LENGTH)}`,
  ].join('\n');
}

function buildConversationMemoryContent({
  session,
  turns,
  totalTurnCount,
  omittedTurnCount,
}) {
  const turnsNewestFirst = [...turns].toReversed();
  const humanTurnsNewestFirst = turnsNewestFirst.filter((turn) => {
    return turn.role === 'human';
  });
  const operationalIdentityTurnsNewestFirst = turnsNewestFirst.filter((turn) => {
    return turn.role === 'operational_identity';
  });
  const otherTurnsNewestFirst = turnsNewestFirst.filter((turn) => {
    return !['human', 'operational_identity'].includes(turn.role);
  });

  return [
    `Conversation ID: ${session.conversationId}`,
    `Title: ${session.title ?? 'untitled'}`,
    `Status: ${session.status}`,
    `Owner Operational Identity: ${session.owner.operationalIdentityId}`,
    `Participants: humans=${session.participants.humanParticipantIds.join(', ')}; operationalIdentities=${session.participants.operationalIdentityIds.join(', ')}`,
    `Privacy: ${session.privacy.visibility}`,
    `Summary Status: ${session.summary.status}`,
    session.summary.text ? `Current Summary: ${session.summary.text}` : 'Current Summary: none',
    `Recent Turns Included: ${turns.length} of ${totalTurnCount}`,
    `Older Turns Omitted: ${omittedTurnCount}`,
    turns.length > 0
      ? 'Recent Human Turns (newest first; high-signal conversation evidence):'
      : 'Recent Turns: none',
    ...humanTurnsNewestFirst.map(formatTurnForContext),
    operationalIdentityTurnsNewestFirst.length > 0
      ? 'Recent Operational Identity Turns (newest first; historical outputs, lower authority than human turns):'
      : null,
    ...operationalIdentityTurnsNewestFirst.map(formatTurnForContext),
    otherTurnsNewestFirst.length > 0
      ? 'Recent Other Turns (newest first):'
      : null,
    ...otherTurnsNewestFirst.map(formatTurnForContext),
  ].join('\n');
}

async function listConversationCandidates({
  masRootPath,
  sourceDefinition,
  sourceRootPath,
  selectedConversationId = null,
}) {
  const warnings = [];
  let directoryEntries;

  try {
    directoryEntries = await readdir(sourceRootPath, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') {
      return {
        candidates: [],
        warnings,
      };
    }

    throw error;
  }

  const candidates = [];

  for (const directoryEntry of directoryEntries) {
    if (!directoryEntry.isDirectory()) {
      warnings.push(`Conversation memory source ${sourceDefinition.sourceId} skipped non-directory entry: ${directoryEntry.name}`);
      continue;
    }

    if (!SAFE_CONVERSATION_ID_PATTERN.test(directoryEntry.name)) {
      warnings.push(`Conversation memory source ${sourceDefinition.sourceId} skipped unsafe conversation directory: ${directoryEntry.name}`);
      continue;
    }

    const conversationDirectoryPath = path.join(sourceRootPath, directoryEntry.name);
    const sessionRecordPath = path.join(conversationDirectoryPath, 'session.json');
    const turnsRecordPath = path.join(conversationDirectoryPath, 'turns.json');

    let sessionFileStat;
    let turnsFileStat;

    try {
      sessionFileStat = await stat(sessionRecordPath);
      turnsFileStat = await stat(turnsRecordPath);
    } catch (error) {
      if (error.code === 'ENOENT') {
        warnings.push(`Conversation memory source ${sourceDefinition.sourceId} skipped incomplete conversation ${directoryEntry.name}.`);
        continue;
      }

      throw error;
    }

    if (sessionFileStat.size > sourceDefinition.readPolicy.maxBytesPerFile) {
      warnings.push(`Conversation memory source ${sourceDefinition.sourceId} skipped oversized session ${directoryEntry.name}: ${sessionFileStat.size} bytes exceeds ${sourceDefinition.readPolicy.maxBytesPerFile}.`);
      continue;
    }

    candidates.push({
      conversationId: directoryEntry.name,
      sessionRecordPath,
      turnsRecordPath,
      relativeSessionPath: createMemorySourceFilePath({
        masRootPath,
        absoluteFilePath: sessionRecordPath,
      }),
      relativeTurnsPath: createMemorySourceFilePath({
        masRootPath,
        absoluteFilePath: turnsRecordPath,
      }),
      turnsFileSizeBytes: turnsFileStat.size,
      turnsOversized: turnsFileStat.size > sourceDefinition.readPolicy.maxBytesPerFile,
      modifiedAtMs: Math.max(sessionFileStat.mtimeMs, turnsFileStat.mtimeMs),
    });
  }

  candidates.sort((left, right) => {
    if (right.modifiedAtMs !== left.modifiedAtMs) {
      return right.modifiedAtMs - left.modifiedAtMs;
    }

    return left.conversationId.localeCompare(right.conversationId);
  });

  const candidatePool = isNonEmptyString(selectedConversationId)
    ? candidates.filter((candidate) => {
      return candidate.conversationId === selectedConversationId;
    })
    : candidates;
  const selectedCandidates = candidatePool.slice(0, sourceDefinition.readPolicy.maxFiles);
  const omittedCandidates = candidatePool.slice(sourceDefinition.readPolicy.maxFiles);

  for (const omittedCandidate of omittedCandidates) {
    warnings.push(`Conversation memory source ${sourceDefinition.sourceId} omitted conversation due to maxFiles limit: ${omittedCandidate.conversationId}`);
  }

  return {
    candidates: selectedCandidates,
    warnings,
  };
}

async function buildConversationMemoryRecord({
  masRootPath,
  sourceDefinition,
  conversationStateRootPath,
  candidate,
  requesterOperationalIdentityId,
}) {
  const conversationRead = await readConversationSession({
    masRootPath,
    conversationId: candidate.conversationId,
    requesterOperationalIdentityId,
    conversationStateRootPath,
  });
  const sessionContent = await readFile(candidate.sessionRecordPath, 'utf8');
  const ownerId = conversationRead.session.owner.operationalIdentityId;
  const isOwnerRead = requesterOperationalIdentityId === ownerId;
  const sensitivityLevel = pickHighestSensitivityLevel([
    sourceDefinition.defaultSensitivityLevel,
    ...conversationRead.turns.map((turn) => turn.privacy.sensitivityLevel),
  ]);
  const content = buildConversationMemoryContent({
    session: conversationRead.session,
    turns: conversationRead.turns,
    totalTurnCount: conversationRead.totalTurnCount,
    omittedTurnCount: conversationRead.omittedTurnCount,
  });
  const recordWarnings = [
    ...conversationRead.session.warnings,
    candidate.turnsOversized
      ? `Conversation ${conversationRead.session.conversationId} admitted oversized turns.json (${candidate.turnsFileSizeBytes} bytes exceeds ${sourceDefinition.readPolicy.maxBytesPerFile}) through bounded recent-turn context.`
      : null,
    conversationRead.omittedTurnCount > 0
      ? `Conversation ${conversationRead.session.conversationId} omitted ${conversationRead.omittedTurnCount} older turns by bounded context policy.`
      : null,
  ].filter(Boolean);

  return assertMemoryRecord({
    kind: 'memory_record',
    version: 1,
    memoryRecordId: createStableMemoryRecordId(
      'conversation-context',
      conversationRead.session.conversationId,
      conversationRead.session.updatedAt,
      conversationRead.session.lastTurnId ?? 'empty',
      conversationRead.turns.map((turn) => turn.turnId).join(','),
    ),
    memoryType: 'conversation_summary',
    scope: 'operational_identity',
    ownerId,
    origin: 'runtime_observed',
    portability: 'mas_bound',
    visibility: isOwnerRead ? 'private_to_owner' : 'shared_with_mas',
    approvalState: isOwnerRead ? 'not_required' : 'approved',
    lifecycleStatus: 'active',
    sensitivityLevel,
    confidence: 'observed',
    authorityLevel: 'runtime_evidence',
    summary: `Conversation ${conversationRead.session.conversationId} has ${conversationRead.totalTurnCount} turns; ${conversationRead.turns.length} recent turns are available as bounded context for ${requesterOperationalIdentityId}.`,
    content,
    sourceReferences: [
      buildConversationSourceReference({
        sourceType: 'conversation_session',
        sourceId: conversationRead.session.conversationId,
        path: candidate.relativeSessionPath,
        ownerId,
        createdAt: conversationRead.session.createdAt,
        contentSha256: createSha256(sessionContent),
        sensitivityLevel,
        metadata: {
          status: conversationRead.session.status,
          totalTurnCount: conversationRead.totalTurnCount,
          omittedTurnCount: conversationRead.omittedTurnCount,
          turnsFileSizeBytes: candidate.turnsFileSizeBytes,
          rawTurnsFileOversized: candidate.turnsOversized,
        },
      }),
      ...conversationRead.turns.map((turn) => {
        return buildConversationSourceReference({
          sourceType: 'conversation_turn',
          sourceId: turn.turnId,
          path: candidate.relativeTurnsPath,
          ownerId,
          createdAt: turn.createdAt,
          contentSha256: createSha256(JSON.stringify(turn)),
          sensitivityLevel: turn.privacy.sensitivityLevel,
          metadata: {
            conversationId: turn.conversationId,
            sequenceNumber: turn.sequenceNumber,
          },
        });
      }),
    ],
    subjectReferences: buildConversationSubjectReferences({
      session: conversationRead.session,
      turns: conversationRead.turns,
      requesterOperationalIdentityId,
    }),
    retention: {
      retentionPolicyId: 'default-conversation-context',
      expiresAt: null,
      staleAfter: null,
      reviewRequiredAt: null,
    },
    supersession: {
      supersedesMemoryRecordIds: [],
      supersededByMemoryRecordId: null,
    },
    privacy: {
      redactionState: 'not_required',
      deletionState: 'active',
      redactedAt: null,
      deletedAt: null,
      reason: null,
    },
    createdAt: conversationRead.session.createdAt,
    updatedAt: conversationRead.session.updatedAt,
    warnings: recordWarnings,
  });
}

export async function readConversationMemory({
  masRootPath,
  sourceDefinition,
  readiness = null,
}) {
  const normalizedSource = assertMemorySourceDefinition(sourceDefinition);
  const requesterOperationalIdentityId = resolveOperationalIdentityId(readiness);
  const warnings = [];

  if (!isNonEmptyString(requesterOperationalIdentityId)) {
    return {
      sourceId: normalizedSource.sourceId,
      memoryRecords: [],
      warnings: [`Conversation memory source ${normalizedSource.sourceId} was skipped because no requester Operational Identity was resolved.`],
      summary: {
        conversationsScanned: 0,
        conversationsIncluded: 0,
        conversationsSkipped: 0,
      },
    };
  }

  const sourceRootPath = resolveBoundedChildPath({
    parentRootPath: masRootPath,
    childRootPath: normalizedSource.rootPath,
    description: `Conversation memory source ${normalizedSource.sourceId} rootPath`,
  });
  const selectedConversationId = resolveSelectedConversationId(readiness);
  const listResult = await listConversationCandidates({
    masRootPath,
    sourceDefinition: normalizedSource,
    sourceRootPath,
    selectedConversationId,
  });
  const candidates = listResult.candidates;
  const memoryRecords = [];

  warnings.push(...listResult.warnings);

  if (isNonEmptyString(selectedConversationId) && candidates.length === 0) {
    warnings.push(`Conversation memory source ${normalizedSource.sourceId} did not find selected conversation ${selectedConversationId}.`);
  }

  for (const candidate of candidates) {
    if (candidate.turnsOversized) {
      warnings.push(`Conversation memory source ${normalizedSource.sourceId} admitted oversized turns ${candidate.conversationId}: ${candidate.turnsFileSizeBytes} bytes exceeds ${normalizedSource.readPolicy.maxBytesPerFile}; using bounded recent-turn context instead of skipping the conversation.`);
    }

    try {
      memoryRecords.push(await buildConversationMemoryRecord({
        masRootPath,
        sourceDefinition: normalizedSource,
        conversationStateRootPath: normalizedSource.rootPath,
        candidate,
        requesterOperationalIdentityId,
      }));
    } catch (error) {
      if (isConversationAccessDenied(error)) {
        warnings.push(`Conversation memory source ${normalizedSource.sourceId} skipped conversation ${candidate.conversationId}: requester ${requesterOperationalIdentityId} is not allowed.`);
        continue;
      }

      warnings.push(`Conversation memory source ${normalizedSource.sourceId} skipped conversation ${candidate.conversationId}: ${error.message}`);
    }
  }

  return {
    sourceId: normalizedSource.sourceId,
    memoryRecords,
    warnings,
    summary: {
      conversationsScanned: candidates.length,
      conversationsIncluded: memoryRecords.length,
      conversationsSkipped: candidates.length - memoryRecords.length,
    },
  };
}
