import path from 'node:path';
import { access } from 'node:fs/promises';
import { assertConversationSession } from '../contracts/conversations/conversation-session-contract.js';
import { ensureDirectory } from '../persistence/ensure-directory.js';
import { writeJsonFile } from '../persistence/write-json-file.js';

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function assertMasRootPath(masRootPath) {
  if (!isNonEmptyString(masRootPath)) {
    throw new Error('Conversation session creation requires a non-empty masRootPath.');
  }

  return masRootPath.trim();
}

function uniqueValues(values) {
  return [...new Set(values.filter((value) => {
    return isNonEmptyString(value);
  }).map((value) => {
    return value.trim();
  }))];
}

async function pathExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return false;
    }

    throw error;
  }
}

function buildConversationSession({
  conversationId,
  title = null,
  ownerOperationalIdentityId,
  humanParticipantIds,
  allowedOperationalIdentityIds,
  createdBy,
  createdAt,
  maxRecentTurns,
}) {
  const operationalIdentityIds = uniqueValues([
    ownerOperationalIdentityId,
    ...(allowedOperationalIdentityIds ?? []),
  ]);

  return assertConversationSession({
    kind: 'conversation_session',
    version: 1,
    conversationId,
    title,
    status: 'active',
    owner: {
      scope: 'operational_identity',
      operationalIdentityId: ownerOperationalIdentityId,
    },
    participants: {
      humanParticipantIds,
      operationalIdentityIds,
    },
    privacy: {
      visibility: 'private_to_participants',
      allowedOperationalIdentityIds: operationalIdentityIds,
    },
    contextPolicy: {
      maxRecentTurns: maxRecentTurns ?? 20,
      allowRawHistoryInPrompt: false,
    },
    summary: {
      status: 'none',
      text: null,
      updatedAt: null,
    },
    turnCount: 0,
    lastTurnId: null,
    createdBy,
    createdAt,
    updatedAt: createdAt,
    closedAt: null,
    warnings: [],
  });
}

export async function createConversationSession({
  masRootPath,
  conversationId,
  title = null,
  ownerOperationalIdentityId,
  humanParticipantIds = [],
  allowedOperationalIdentityIds = null,
  createdBy,
  createdAt = new Date().toISOString(),
  maxRecentTurns = 20,
} = {}) {
  const normalizedMasRootPath = assertMasRootPath(masRootPath);
  const session = buildConversationSession({
    conversationId,
    title,
    ownerOperationalIdentityId,
    humanParticipantIds,
    allowedOperationalIdentityIds,
    createdBy,
    createdAt,
    maxRecentTurns,
  });
  const conversationDirectoryPath = path.join(
    normalizedMasRootPath,
    'memory',
    'state',
    'conversations',
    session.conversationId,
  );
  const sessionRecordPath = path.join(conversationDirectoryPath, 'session.json');
  const turnsRecordPath = path.join(conversationDirectoryPath, 'turns.json');

  if (await pathExists(sessionRecordPath) || await pathExists(turnsRecordPath)) {
    throw new Error(`Conversation already exists: ${session.conversationId}`);
  }

  await ensureDirectory(conversationDirectoryPath);
  await writeJsonFile(sessionRecordPath, session);
  await writeJsonFile(turnsRecordPath, []);

  return {
    targetType: 'mas-memory',
    conversationId: session.conversationId,
    session,
    sessionRecordPath,
    turnsRecordPath,
    relativeSessionPath: `memory/state/conversations/${session.conversationId}/session.json`,
    relativeTurnsPath: `memory/state/conversations/${session.conversationId}/turns.json`,
  };
}
