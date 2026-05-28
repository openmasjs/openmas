import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile } from 'node:fs/promises';
import { createLocalRuntimeAdapter } from '../../src/os/adapters/local-runtime-adapter.js';
import {
  createMultiAgentConversation,
  runConversationTurnNow,
} from '../../src/os/conversations/multi-agent-conversation-manager.js';
import { readConversationSession } from '../../src/conversations/read-conversation-session.js';

const CREATED_AT = '2026-05-14T11:00:00-05:00';
const TURN1_ACTIVE_AT = '2026-05-14T11:01:00-05:00';
const TURN1_STARTED_AT = '2026-05-14T11:01:10-05:00';
const TURN1_FINISHED_AT = '2026-05-14T11:01:30-05:00';
const TURN2_ACTIVE_AT = '2026-05-14T11:02:00-05:00';
const TURN2_STARTED_AT = '2026-05-14T11:02:10-05:00';
const TURN2_FINISHED_AT = '2026-05-14T11:02:30-05:00';

const INITIAL_HUMAN_TEXT = 'Launch marker: plan the community campaign without storing this prompt in OS state.';

async function createTemporaryProjectRoot() {
  return mkdtemp(path.join(os.tmpdir(), 'openmas-multi-agent-conversation-'));
}

function createClock(values) {
  const timestamps = [...values];

  return () => {
    if (timestamps.length === 0) {
      return values[values.length - 1];
    }

    return timestamps.shift();
  };
}

function createParticipants() {
  return [
    {
      operationalIdentityId: 'alfred',
      displayName: 'Alfred',
      command: 'ask',
      mode: 'deterministic',
      turnInstruction: 'Open the campaign planning conversation with a concise operational view.',
    },
    {
      operationalIdentityId: 'maria',
      displayName: 'Maria',
      command: 'ask',
      mode: 'deterministic',
      turnInstruction: 'Add the community management perspective after Alfred speaks.',
    },
  ];
}

async function createConversationFixture({
  projectRootPath,
  adapter,
  initialTurn = INITIAL_HUMAN_TEXT,
} = {}) {
  return createMultiAgentConversation({
    adapter,
    projectRootPath,
    projectId: 'project_marketing',
    conversationRunId: 'conversation_run_campaign_room',
    conversationId: 'campaign-room',
    title: 'Campaign Room',
    createdBy: {
      type: 'human',
      id: 'admin',
    },
    humanParticipantIds: ['human-admin'],
    participants: createParticipants(),
    turnPolicy: {
      type: 'sequential',
      rounds: 1,
      maxRecentTurns: 2,
    },
    initialTurn,
    priority: 25,
    now: () => CREATED_AT,
  });
}

test('createMultiAgentConversation creates a governed shared conversation with explicit participants and first ready turn', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const adapter = createLocalRuntimeAdapter({ projectRootPath });
  const result = await createConversationFixture({
    projectRootPath,
    adapter,
  });

  assert.equal(result.conversationRun.status, 'active');
  assert.equal(result.conversationRun.currentTurnIndex, 0);
  assert.deepEqual(
    result.conversationRun.participants.map((participant) => participant.operationalIdentityId),
    ['alfred', 'maria'],
  );
  assert.deepEqual(
    result.conversationRun.turns.map((turn) => turn.status),
    ['ready', 'pending'],
  );
  assert.equal(result.currentTurnJob.assignedOperationalIdentityId, 'alfred');
  assert.equal(result.currentTurnJob.conversationId, 'campaign-room');
  assert.equal(result.process.status, 'blocked');
  assert.equal(result.thread.threadType, 'conversation_turn');
  assert.equal(result.thread.waitReason, 'waiting_for_child_process');

  const readAsMaria = await readConversationSession({
    masRootPath: path.join(projectRootPath, 'instance'),
    conversationId: 'campaign-room',
    requesterOperationalIdentityId: 'maria',
  });

  assert.equal(readAsMaria.session.privacy.allowedOperationalIdentityIds.includes('alfred'), true);
  assert.equal(readAsMaria.session.privacy.allowedOperationalIdentityIds.includes('maria'), true);
  assert.equal(readAsMaria.turns.length, 1);
  assert.equal(readAsMaria.turns[0].role, 'human');

  await assert.rejects(
    () => readConversationSession({
      masRootPath: path.join(projectRootPath, 'instance'),
      conversationId: 'campaign-room',
      requesterOperationalIdentityId: 'bruce',
    }),
    /not allowed to read conversation/u,
  );
});

test('runConversationTurnNow enforces sequential turn order and completes the multi-agent conversation', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const adapter = createLocalRuntimeAdapter({ projectRootPath });

  await createConversationFixture({
    projectRootPath,
    adapter,
  });

  await assert.rejects(
    () => runConversationTurnNow({
      adapter,
      projectRootPath,
      conversationRunId: 'conversation_run_campaign_room',
      operationalIdentityId: 'maria',
      childJobId: 'job_conversation_run_campaign_room_turn_001',
      invocationRunner: async () => {
        throw new Error('Maria should not run out of turn.');
      },
    }),
    /cannot speak out of turn/u,
  );

  const firstTurn = await runConversationTurnNow({
    adapter,
    projectRootPath,
    conversationRunId: 'conversation_run_campaign_room',
    operationalIdentityId: 'alfred',
    childJobId: 'job_conversation_run_campaign_room_turn_001',
    now: createClock([TURN1_ACTIVE_AT, TURN1_STARTED_AT, TURN1_FINISHED_AT]),
    invocationRunner: async (options) => {
      assert.equal(options.operationalIdentityId, 'alfred');
      assert.equal(Object.hasOwn(options, 'agentId'), false);
      assert.equal(options.conversationRef, 'campaign-room');

      return {
        invocationId: 'invocation_alfred_campaign_turn',
        status: 'completed',
        message: 'Alfred recommends a focused campaign brief.',
        warnings: [],
        errors: [],
        persistence: null,
      };
    },
  });

  assert.equal(firstTurn.conversationRun.status, 'active');
  assert.equal(firstTurn.conversationRun.currentTurnIndex, 1);
  assert.equal(firstTurn.conversationTurn.speaker.speakerId, 'alfred');
  assert.equal(firstTurn.nextTurnJob.assignedOperationalIdentityId, 'maria');
  assert.deepEqual(
    firstTurn.conversationRun.turns.map((turn) => turn.status),
    ['completed', 'ready'],
  );

  const secondTurn = await runConversationTurnNow({
    adapter,
    projectRootPath,
    conversationRunId: 'conversation_run_campaign_room',
    operationalIdentityId: 'maria',
    childJobId: firstTurn.nextTurnJob.jobId,
    now: createClock([TURN2_ACTIVE_AT, TURN2_STARTED_AT, TURN2_FINISHED_AT]),
    invocationRunner: async (options) => {
      assert.equal(options.operationalIdentityId, 'maria');
      assert.equal(Object.hasOwn(options, 'agentId'), false);
      assert.equal(options.conversationRef, 'campaign-room');

      return {
        invocationId: 'invocation_maria_campaign_turn',
        status: 'completed',
        message: 'Maria recommends a community reply angle.',
        warnings: [],
        errors: [],
        persistence: null,
      };
    },
  });

  assert.equal(secondTurn.conversationRun.status, 'completed');
  assert.equal(secondTurn.conversationRun.currentTurnIndex, null);
  assert.equal(secondTurn.conversationTurn.speaker.speakerId, 'maria');
  assert.equal(secondTurn.nextTurnJob, null);
  assert.equal(secondTurn.job.status, 'completed');
  assert.equal(secondTurn.process.status, 'completed');
  assert.equal(secondTurn.thread.status, 'completed');
  assert.equal((await adapter.loadProcess('process_conversation_run_campaign_room')).childProcessIds.length, 2);

  const boundedConversation = await readConversationSession({
    masRootPath: path.join(projectRootPath, 'instance'),
    conversationId: 'campaign-room',
    requesterOperationalIdentityId: 'alfred',
  });

  assert.equal(boundedConversation.totalTurnCount, 3);
  assert.equal(boundedConversation.turns.length, 2);
  assert.equal(boundedConversation.boundedHistoryApplied, true);
  assert.deepEqual(
    boundedConversation.turns.map((turn) => turn.speaker.speakerId),
    ['alfred', 'maria'],
  );

  const events = await adapter.readEvents({ date: '2026-05-14' });

  assert.deepEqual(
    events.map((event) => event.eventType).filter((eventType) => eventType.startsWith('conversation.')),
    [
      'conversation.created',
      'conversation.turn.ready',
      'conversation.turn.completed',
      'conversation.turn.ready',
      'conversation.turn.completed',
      'conversation.completed',
    ],
  );
});

test('multi-agent conversation OS state stores safe references instead of raw transcript text', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const adapter = createLocalRuntimeAdapter({ projectRootPath });

  await createConversationFixture({
    projectRootPath,
    adapter,
  });

  const serializedOsState = [
    await readFile(adapter.resolveConversationRunSnapshotPath('conversation_run_campaign_room'), 'utf8'),
    await readFile(adapter.resolveJobSnapshotPath('job_conversation_run_campaign_room'), 'utf8'),
    JSON.stringify(await adapter.readEvents({ date: '2026-05-14' })),
  ].join('\n');

  assert.doesNotMatch(serializedOsState, /Launch marker/u);
  assert.match(serializedOsState, /memory\/state\/conversations\/campaign-room\/session\.json/u);
  assert.match(serializedOsState, /conversationRunId/u);
});

test('createMultiAgentConversation rejects unsafe secret-like conversation inputs before creating OS state', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const adapter = createLocalRuntimeAdapter({ projectRootPath });

  await assert.rejects(
    () => createConversationFixture({
      projectRootPath,
      adapter,
      initialTurn: 'Please use sk-or-v1-secretvalue1234567890 in this campaign room.',
    }),
    /secret-like value/u,
  );

  assert.deepEqual(await adapter.listConversationRuns(), []);
  assert.deepEqual(await adapter.readEvents({ date: '2026-05-14' }), []);
});

test('createMultiAgentConversation rejects Cognitive Identity selectors on Operational Identity participants', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const adapter = createLocalRuntimeAdapter({ projectRootPath });

  await assert.rejects(
    () => createMultiAgentConversation({
      adapter,
      projectRootPath,
      projectId: 'project_marketing',
      conversationRunId: 'conversation_run_invalid_participant',
      conversationId: 'invalid-participant-room',
      participants: [
        {
          operationalIdentityId: 'alfred',
          agentId: 'system-steward',
          displayName: 'Alfred',
        },
      ],
      now: () => CREATED_AT,
    }),
    /must not include agentId/u,
  );
});
