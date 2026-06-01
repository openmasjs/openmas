import path from 'node:path';
import { readdir, readFile } from 'node:fs/promises';
import { resolveBoundedChildPath } from '../contracts/shared/bounded-path-contract.js';
import { readConversationSession } from './read-conversation-session.js';
import { normalizeConversationReference } from './conversation-reference.js';

const SAFE_CONVERSATION_ID_PATTERN = /^[a-zA-Z0-9._-]+$/u;

function isFileMissing(error) {
  return error?.code === 'ENOENT' || error?.code === 'ENOTDIR';
}

async function tryReadConversationById({
  masRootPath,
  conversationId,
  requesterOperationalIdentityId,
}) {
  try {
    return await readConversationSession({
      masRootPath,
      conversationId,
      requesterOperationalIdentityId,
      maxTurns: Number.MAX_SAFE_INTEGER,
    });
  } catch (error) {
    if (isFileMissing(error)) {
      return null;
    }

    throw error;
  }
}

async function listConversationSessionRecords({ masRootPath }) {
  const conversationRootPath = resolveBoundedChildPath({
    parentRootPath: masRootPath,
    childRootPath: 'memory/state/conversations',
    description: 'Conversation state rootPath',
  });
  let directoryEntries;

  try {
    directoryEntries = await readdir(conversationRootPath, { withFileTypes: true });
  } catch (error) {
    if (isFileMissing(error)) {
      return [];
    }

    throw error;
  }

  const sessionRecords = [];

  for (const directoryEntry of directoryEntries) {
    if (!directoryEntry.isDirectory() || !SAFE_CONVERSATION_ID_PATTERN.test(directoryEntry.name)) {
      continue;
    }

    const sessionPath = path.join(conversationRootPath, directoryEntry.name, 'session.json');

    try {
      const session = JSON.parse(await readFile(sessionPath, 'utf8'));

      sessionRecords.push({
        conversationId: directoryEntry.name,
        title: session.title ?? null,
      });
    } catch (error) {
      if (!isFileMissing(error)) {
        throw error;
      }
    }
  }

  return sessionRecords;
}

export async function resolveConversationReference({
  masRootPath,
  conversationRef,
  requesterOperationalIdentityId,
} = {}) {
  const normalizedConversationRef = normalizeConversationReference(
    conversationRef,
    'Conversation reference',
  );
  const directConversationRead = await tryReadConversationById({
    masRootPath,
    conversationId: normalizedConversationRef,
    requesterOperationalIdentityId,
  });

  if (directConversationRead) {
    return {
      conversationRef: normalizedConversationRef,
      conversationId: directConversationRead.session.conversationId,
      resolutionType: 'conversation_id',
      session: directConversationRead.session,
      totalTurnCount: directConversationRead.totalTurnCount,
      sessionRecordPath: directConversationRead.sessionRecordPath,
      turnsRecordPath: directConversationRead.turnsRecordPath,
    };
  }

  const matchingSessionRecords = (await listConversationSessionRecords({ masRootPath }))
    .filter((sessionRecord) => {
      if (!sessionRecord.title) {
        return false;
      }

      return normalizeConversationReference(sessionRecord.title, 'Conversation title') === normalizedConversationRef;
    });

  if (matchingSessionRecords.length > 1) {
    throw new Error(`Conversation reference ${normalizedConversationRef} is ambiguous; use the canonical conversationId.`);
  }

  if (matchingSessionRecords.length === 1) {
    const conversationRead = await readConversationSession({
      masRootPath,
      conversationId: matchingSessionRecords[0].conversationId,
      requesterOperationalIdentityId,
      maxTurns: Number.MAX_SAFE_INTEGER,
    });

    return {
      conversationRef: normalizedConversationRef,
      conversationId: conversationRead.session.conversationId,
      resolutionType: 'conversation_title',
      session: conversationRead.session,
      totalTurnCount: conversationRead.totalTurnCount,
      sessionRecordPath: conversationRead.sessionRecordPath,
      turnsRecordPath: conversationRead.turnsRecordPath,
    };
  }

  throw new Error(`Conversation not found: ${normalizedConversationRef}. Create it first with --create-conversation ${normalizedConversationRef}.`);
}
