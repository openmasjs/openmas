import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { resolveBoundedChildPath } from '../contracts/shared/bounded-path-contract.js';
import {
  assertConversationSession,
  canOperationalIdentityReadConversation,
} from '../contracts/conversations/conversation-session-contract.js';
import { assertConversationTurn } from '../contracts/conversations/conversation-turn-contract.js';

const SAFE_CONVERSATION_ID_PATTERN = /^[a-zA-Z0-9._-]+$/u;

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function assertMasRootPath(masRootPath) {
  if (!isNonEmptyString(masRootPath)) {
    throw new Error('Conversation session read requires a non-empty masRootPath.');
  }

  return masRootPath.trim();
}

function assertSafeConversationId(value) {
  if (!isNonEmptyString(value)) {
    throw new Error('Conversation session read requires a non-empty conversationId.');
  }

  const normalizedValue = value.trim();

  if (!SAFE_CONVERSATION_ID_PATTERN.test(normalizedValue)) {
    throw new Error(`Conversation session read conversationId contains unsafe characters: ${normalizedValue}`);
  }

  return normalizedValue;
}

function resolveConversationStateRootPath({ masRootPath, conversationStateRootPath }) {
  return resolveBoundedChildPath({
    parentRootPath: masRootPath,
    childRootPath: conversationStateRootPath ?? 'memory/state/conversations',
    description: 'Conversation session state rootPath',
  });
}

function assertPositiveInteger(value, description) {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${description} must be an integer greater than or equal to 1.`);
  }

  return value;
}

async function readJsonFile(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

function normalizeTurns({ turns, conversationId }) {
  if (!Array.isArray(turns)) {
    throw new Error('Conversation turns record must be an array.');
  }

  const seenTurnIds = new Set();
  const seenSequenceNumbers = new Set();
  const normalizedTurns = turns.map((turn) => {
    const normalizedTurn = assertConversationTurn(turn);

    if (normalizedTurn.conversationId !== conversationId) {
      throw new Error(`Conversation turn ${normalizedTurn.turnId} belongs to another conversation: ${normalizedTurn.conversationId}`);
    }

    if (seenTurnIds.has(normalizedTurn.turnId)) {
      throw new Error(`Conversation turns record contains duplicated turnId: ${normalizedTurn.turnId}`);
    }

    if (seenSequenceNumbers.has(normalizedTurn.sequenceNumber)) {
      throw new Error(`Conversation turns record contains duplicated sequenceNumber: ${normalizedTurn.sequenceNumber}`);
    }

    seenTurnIds.add(normalizedTurn.turnId);
    seenSequenceNumbers.add(normalizedTurn.sequenceNumber);
    return normalizedTurn;
  }).toSorted((left, right) => {
    return left.sequenceNumber - right.sequenceNumber;
  });

  normalizedTurns.forEach((turn, index) => {
    const expectedSequenceNumber = index + 1;

    if (turn.sequenceNumber !== expectedSequenceNumber) {
      throw new Error(`Conversation turns record must use contiguous sequence numbers. Expected ${expectedSequenceNumber}, received ${turn.sequenceNumber}.`);
    }
  });

  return normalizedTurns;
}

function assertSessionTurnConsistency({ session, turns }) {
  if (session.turnCount !== turns.length) {
    throw new Error(`Conversation session turnCount ${session.turnCount} does not match stored turns ${turns.length}.`);
  }

  const lastTurn = turns.at(-1) ?? null;

  if ((lastTurn?.turnId ?? null) !== session.lastTurnId) {
    throw new Error('Conversation session lastTurnId does not match the stored turns record.');
  }
}

function assertConversationAccess({ session, requesterOperationalIdentityId }) {
  if (!isNonEmptyString(requesterOperationalIdentityId)) {
    return;
  }

  if (!canOperationalIdentityReadConversation({
    conversationSession: session,
    operationalIdentityId: requesterOperationalIdentityId,
  })) {
    throw new Error(`Operational Identity ${requesterOperationalIdentityId.trim()} is not allowed to read conversation ${session.conversationId}.`);
  }
}

export async function readConversationSession({
  masRootPath,
  conversationId,
  requesterOperationalIdentityId = null,
  maxTurns = null,
  conversationStateRootPath = 'memory/state/conversations',
} = {}) {
  const normalizedMasRootPath = assertMasRootPath(masRootPath);
  const normalizedConversationId = assertSafeConversationId(conversationId);
  const conversationDirectoryPath = path.join(
    resolveConversationStateRootPath({
      masRootPath: normalizedMasRootPath,
      conversationStateRootPath,
    }),
    normalizedConversationId,
  );
  const sessionRecordPath = path.join(conversationDirectoryPath, 'session.json');
  const turnsRecordPath = path.join(conversationDirectoryPath, 'turns.json');
  const session = assertConversationSession(await readJsonFile(sessionRecordPath));

  if (session.conversationId !== normalizedConversationId) {
    throw new Error(`Conversation session record conversationId ${session.conversationId} does not match requested conversation ${normalizedConversationId}.`);
  }

  assertConversationAccess({
    session,
    requesterOperationalIdentityId,
  });

  const allTurns = normalizeTurns({
    turns: await readJsonFile(turnsRecordPath),
    conversationId: normalizedConversationId,
  });

  assertSessionTurnConsistency({
    session,
    turns: allTurns,
  });

  const effectiveMaxTurns = maxTurns === null || maxTurns === undefined
    ? session.contextPolicy.maxRecentTurns
    : assertPositiveInteger(maxTurns, 'Conversation session read maxTurns');
  const turns = allTurns.slice(-effectiveMaxTurns);
  const omittedTurnCount = allTurns.length - turns.length;

  return {
    kind: 'conversation_session_read',
    version: 1,
    session,
    turns,
    totalTurnCount: allTurns.length,
    omittedTurnCount,
    boundedHistoryApplied: omittedTurnCount > 0,
    sessionRecordPath,
    turnsRecordPath,
  };
}
