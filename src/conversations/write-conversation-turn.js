import path from 'node:path';
import { assertConversationSession } from '../contracts/conversations/conversation-session-contract.js';
import { assertConversationTurn } from '../contracts/conversations/conversation-turn-contract.js';
import { writeJsonFile } from '../persistence/write-json-file.js';
import { readConversationSession } from './read-conversation-session.js';

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function buildTurnId({ conversationId, sequenceNumber }) {
  return `turn-${conversationId}-${String(sequenceNumber).padStart(6, '0')}`;
}

function assertAppendableSession(session) {
  if (session.status !== 'active') {
    throw new Error(`Conversation ${session.conversationId} is not appendable because status is ${session.status}.`);
  }
}

function buildConversationTurn({
  conversationId,
  sequenceNumber,
  turn,
  createdAt,
}) {
  if (!turn || typeof turn !== 'object' || Array.isArray(turn)) {
    throw new Error('Conversation turn write requires a turn object.');
  }

  return assertConversationTurn({
    kind: 'conversation_turn',
    version: 1,
    conversationId,
    turnId: isNonEmptyString(turn.turnId)
      ? turn.turnId
      : buildTurnId({ conversationId, sequenceNumber }),
    sequenceNumber: turn.sequenceNumber ?? sequenceNumber,
    role: turn.role,
    speaker: turn.speaker,
    content: turn.content,
    invocationId: turn.invocationId ?? null,
    runtimeReferences: turn.runtimeReferences ?? [],
    privacy: turn.privacy ?? {
      visibility: 'private_to_conversation',
      sensitivityLevel: 'internal',
    },
    createdAt: turn.createdAt ?? createdAt,
  });
}

function buildUpdatedSession({
  session,
  turn,
  updatedAt,
}) {
  const summary = session.summary.status === 'current'
    ? {
      ...session.summary,
      status: 'stale',
      updatedAt,
    }
    : session.summary;

  return assertConversationSession({
    ...session,
    summary,
    turnCount: turn.sequenceNumber,
    lastTurnId: turn.turnId,
    updatedAt,
  });
}

export async function writeConversationTurn({
  masRootPath,
  conversationId,
  requesterOperationalIdentityId = null,
  turn,
  createdAt = new Date().toISOString(),
} = {}) {
  const currentConversation = await readConversationSession({
    masRootPath,
    conversationId,
    requesterOperationalIdentityId,
    maxTurns: Number.MAX_SAFE_INTEGER,
  });

  assertAppendableSession(currentConversation.session);

  const nextSequenceNumber = currentConversation.totalTurnCount + 1;
  const normalizedTurn = buildConversationTurn({
    conversationId: currentConversation.session.conversationId,
    sequenceNumber: nextSequenceNumber,
    turn,
    createdAt,
  });

  if (normalizedTurn.sequenceNumber !== nextSequenceNumber) {
    throw new Error(`Conversation turn sequenceNumber must be ${nextSequenceNumber}.`);
  }

  if (currentConversation.turns.some((storedTurn) => storedTurn.turnId === normalizedTurn.turnId)) {
    throw new Error(`Conversation already contains turnId: ${normalizedTurn.turnId}`);
  }

  const updatedTurns = [...currentConversation.turns, normalizedTurn];
  const updatedSession = buildUpdatedSession({
    session: currentConversation.session,
    turn: normalizedTurn,
    updatedAt: normalizedTurn.createdAt,
  });
  const conversationDirectoryPath = path.dirname(currentConversation.sessionRecordPath);
  const sessionRecordPath = path.join(conversationDirectoryPath, 'session.json');
  const turnsRecordPath = path.join(conversationDirectoryPath, 'turns.json');

  await writeJsonFile(sessionRecordPath, updatedSession);
  await writeJsonFile(turnsRecordPath, updatedTurns);

  return {
    targetType: 'mas-memory',
    conversationId: updatedSession.conversationId,
    session: updatedSession,
    turn: normalizedTurn,
    turns: updatedTurns,
    sessionRecordPath,
    turnsRecordPath,
    relativeSessionPath: `memory/state/conversations/${updatedSession.conversationId}/session.json`,
    relativeTurnsPath: `memory/state/conversations/${updatedSession.conversationId}/turns.json`,
  };
}
