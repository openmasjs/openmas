import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile } from 'node:fs/promises';
import { assertConversationSession } from '../../src/contracts/conversation-session-contract.js';
import { assertConversationTurn } from '../../src/contracts/conversation-turn-contract.js';
import { createConversationSession } from '../../src/conversations/create-conversation-session.js';
import { readConversationSession } from '../../src/conversations/read-conversation-session.js';
import { writeConversationTurn } from '../../src/conversations/write-conversation-turn.js';

const VALID_CREATED_AT = '2026-04-17T12:00:00.000Z';

async function createMasRoot() {
  const projectRootPath = await mkdtemp(path.join(os.tmpdir(), 'openmas-conversation-runtime-'));

  return {
    projectRootPath,
    masRootPath: path.join(projectRootPath, 'instance'),
  };
}

function buildSession(overrides = {}) {
  return {
    kind: 'conversation_session',
    version: 1,
    conversationId: 'conversation-001',
    title: 'MAS Health Conversation',
    status: 'active',
    owner: {
      scope: 'operational_identity',
      operationalIdentityId: 'alfred',
    },
    participants: {
      humanParticipantIds: ['human-admin'],
      operationalIdentityIds: ['alfred'],
    },
    privacy: {
      visibility: 'private_to_participants',
      allowedOperationalIdentityIds: ['alfred'],
    },
    contextPolicy: {
      maxRecentTurns: 20,
      allowRawHistoryInPrompt: false,
    },
    summary: {
      status: 'none',
      text: null,
      updatedAt: null,
    },
    turnCount: 0,
    lastTurnId: null,
    createdBy: 'human-admin',
    createdAt: VALID_CREATED_AT,
    updatedAt: VALID_CREATED_AT,
    closedAt: null,
    warnings: [],
    ...overrides,
  };
}

function buildHumanTurn(overrides = {}) {
  return {
    role: 'human',
    speaker: {
      speakerType: 'human',
      speakerId: 'human-admin',
      displayName: 'MAS Admin',
    },
    content: {
      contentType: 'text',
      text: 'Alfred, please help me inspect the MAS health.',
    },
    privacy: {
      visibility: 'private_to_conversation',
      sensitivityLevel: 'internal',
    },
    ...overrides,
  };
}

function buildOperationalIdentityTurn(overrides = {}) {
  return {
    role: 'operational_identity',
    speaker: {
      speakerType: 'operational_identity',
      speakerId: 'alfred',
      displayName: 'Alfred',
    },
    content: {
      contentType: 'markdown',
      text: 'I can help inspect the MAS health through governed runtime tools.',
    },
    invocationId: 'invocation-001',
    runtimeReferences: [
      {
        referenceType: 'invocation',
        referenceId: 'invocation-001',
      },
    ],
    privacy: {
      visibility: 'private_to_conversation',
      sensitivityLevel: 'internal',
    },
    ...overrides,
  };
}

test('assertConversationSession accepts a valid private conversation session', () => {
  const session = assertConversationSession(buildSession());

  assert.equal(session.conversationId, 'conversation-001');
  assert.equal(session.owner.operationalIdentityId, 'alfred');
  assert.equal(session.privacy.allowedOperationalIdentityIds[0], 'alfred');
  assert.equal(session.contextPolicy.allowRawHistoryInPrompt, false);
});

test('assertConversationSession rejects ownership and raw prompt-history violations', () => {
  assert.throws(
    () => assertConversationSession(buildSession({
      participants: {
        humanParticipantIds: ['human-admin'],
        operationalIdentityIds: ['maria'],
      },
    })),
    /must include the owner/u,
  );

  assert.throws(
    () => assertConversationSession(buildSession({
      contextPolicy: {
        maxRecentTurns: 20,
        allowRawHistoryInPrompt: true,
      },
    })),
    /must remain false in v1/u,
  );
});

test('assertConversationTurn accepts a governed conversation turn with runtime references', () => {
  const turn = assertConversationTurn({
    kind: 'conversation_turn',
    version: 1,
    conversationId: 'conversation-001',
    turnId: 'turn-conversation-001-000001',
    sequenceNumber: 1,
    createdAt: VALID_CREATED_AT,
    ...buildOperationalIdentityTurn(),
  });

  assert.equal(turn.role, 'operational_identity');
  assert.equal(turn.runtimeReferences[0].referenceType, 'invocation');
});

test('createConversationSession persists an empty private conversation under MAS runtime state', async () => {
  const {
    masRootPath,
  } = await createMasRoot();
  const persistence = await createConversationSession({
    masRootPath,
    conversationId: 'conversation-001',
    title: 'MAS Health Conversation',
    ownerOperationalIdentityId: 'alfred',
    humanParticipantIds: ['human-admin'],
    createdBy: 'human-admin',
    createdAt: VALID_CREATED_AT,
  });
  const persistedSession = JSON.parse(await readFile(persistence.sessionRecordPath, 'utf8'));
  const persistedTurns = JSON.parse(await readFile(persistence.turnsRecordPath, 'utf8'));

  assert.equal(persistence.targetType, 'mas-memory');
  assert.equal(persistence.relativeSessionPath, 'memory/state/conversations/conversation-001/session.json');
  assert.equal(persistedSession.conversationId, 'conversation-001');
  assert.equal(persistedSession.turnCount, 0);
  assert.deepEqual(persistedTurns, []);
});

test('writeConversationTurn appends turns and updates session metadata', async () => {
  const {
    masRootPath,
  } = await createMasRoot();

  await createConversationSession({
    masRootPath,
    conversationId: 'conversation-001',
    title: 'MAS Health Conversation',
    ownerOperationalIdentityId: 'alfred',
    humanParticipantIds: ['human-admin'],
    createdBy: 'human-admin',
    createdAt: VALID_CREATED_AT,
  });

  const firstWrite = await writeConversationTurn({
    masRootPath,
    conversationId: 'conversation-001',
    requesterOperationalIdentityId: 'alfred',
    turn: buildHumanTurn(),
    createdAt: '2026-04-17T12:00:01.000Z',
  });
  const secondWrite = await writeConversationTurn({
    masRootPath,
    conversationId: 'conversation-001',
    requesterOperationalIdentityId: 'alfred',
    turn: buildOperationalIdentityTurn(),
    createdAt: '2026-04-17T12:00:02.000Z',
  });

  assert.equal(firstWrite.turn.sequenceNumber, 1);
  assert.equal(secondWrite.turn.sequenceNumber, 2);
  assert.equal(secondWrite.session.turnCount, 2);
  assert.equal(secondWrite.session.lastTurnId, 'turn-conversation-001-000002');
  assert.equal(secondWrite.turns.length, 2);
});

test('readConversationSession applies bounded history without mutating stored turns', async () => {
  const {
    masRootPath,
  } = await createMasRoot();

  await createConversationSession({
    masRootPath,
    conversationId: 'conversation-001',
    title: 'Bounded History',
    ownerOperationalIdentityId: 'alfred',
    humanParticipantIds: ['human-admin'],
    createdBy: 'human-admin',
    createdAt: VALID_CREATED_AT,
    maxRecentTurns: 3,
  });

  for (let index = 1; index <= 5; index++) {
    await writeConversationTurn({
      masRootPath,
      conversationId: 'conversation-001',
      requesterOperationalIdentityId: 'alfred',
      turn: buildHumanTurn({
        content: {
          contentType: 'text',
          text: `Message ${index}`,
        },
      }),
      createdAt: `2026-04-17T12:00:0${index}.000Z`,
    });
  }

  const boundedRead = await readConversationSession({
    masRootPath,
    conversationId: 'conversation-001',
    requesterOperationalIdentityId: 'alfred',
    maxTurns: 2,
  });
  const defaultBoundedRead = await readConversationSession({
    masRootPath,
    conversationId: 'conversation-001',
    requesterOperationalIdentityId: 'alfred',
  });

  assert.equal(boundedRead.totalTurnCount, 5);
  assert.equal(boundedRead.omittedTurnCount, 3);
  assert.equal(boundedRead.boundedHistoryApplied, true);
  assert.deepEqual(
    boundedRead.turns.map((turn) => turn.sequenceNumber),
    [4, 5],
  );
  assert.equal(defaultBoundedRead.turns.length, 3);
});

test('readConversationSession enforces cross-identity privacy for private conversations', async () => {
  const {
    masRootPath,
  } = await createMasRoot();

  await createConversationSession({
    masRootPath,
    conversationId: 'conversation-001',
    title: 'Private Alfred Conversation',
    ownerOperationalIdentityId: 'alfred',
    humanParticipantIds: ['human-admin'],
    createdBy: 'human-admin',
    createdAt: VALID_CREATED_AT,
  });
  await writeConversationTurn({
    masRootPath,
    conversationId: 'conversation-001',
    requesterOperationalIdentityId: 'alfred',
    turn: buildHumanTurn(),
    createdAt: '2026-04-17T12:00:01.000Z',
  });

  await assert.rejects(
    () => readConversationSession({
      masRootPath,
      conversationId: 'conversation-001',
      requesterOperationalIdentityId: 'maria',
    }),
    /not allowed to read conversation/u,
  );
});

test('explicitly allowed Operational Identities can read a shared participant conversation', async () => {
  const {
    masRootPath,
  } = await createMasRoot();

  await createConversationSession({
    masRootPath,
    conversationId: 'conversation-001',
    title: 'Alfred And Maria Handoff',
    ownerOperationalIdentityId: 'alfred',
    humanParticipantIds: ['human-admin'],
    allowedOperationalIdentityIds: ['maria'],
    createdBy: 'human-admin',
    createdAt: VALID_CREATED_AT,
  });
  await writeConversationTurn({
    masRootPath,
    conversationId: 'conversation-001',
    requesterOperationalIdentityId: 'alfred',
    turn: buildHumanTurn(),
    createdAt: '2026-04-17T12:00:01.000Z',
  });

  const readAsMaria = await readConversationSession({
    masRootPath,
    conversationId: 'conversation-001',
    requesterOperationalIdentityId: 'maria',
  });

  assert.equal(readAsMaria.session.privacy.allowedOperationalIdentityIds.includes('maria'), true);
  assert.equal(readAsMaria.turns.length, 1);
});
