import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { createConversationSession } from '../../src/conversations/create-conversation-session.js';
import { writeConversationTurn } from '../../src/conversations/write-conversation-turn.js';
import { runAgentInvocation } from '../../src/invocation/run-agent-invocation.js';
import {
  createAlfredProbabilisticProjectFixture,
  withEnvironment,
} from '../helpers/create-alfred-probabilistic-fixture.js';

const SELECTED_FIRST_MARKER = 'CONVERSATION_SELECTED_FIRST_MARKER';
const SELECTED_AGENT_MARKER = 'CONVERSATION_SELECTED_AGENT_MARKER';
const SELECTED_SECOND_MARKER = 'CONVERSATION_SELECTED_SECOND_MARKER';
const OTHER_CONVERSATION_MARKER = 'OTHER_CONVERSATION_MUST_NOT_LEAK';
const USER_NAME_RECALL_MARKER = 'USER_NAME_RECALL_MARKER';
const PRIOR_ASSISTANT_DENIAL_MARKER = 'PRIOR_ASSISTANT_DENIAL_MARKER';

async function readConversationTurns({ projectRootPath, conversationId }) {
  return JSON.parse(await readFile(
    path.join(
      projectRootPath,
      'instance',
      'memory',
      'state',
      'conversations',
      conversationId,
      'turns.json',
    ),
    'utf8',
  ));
}

function createOpenRouterResponse({ responseId, outputText }) {
  return {
    ok: true,
    async json() {
      return {
        id: responseId,
        choices: [
          {
            finish_reason: 'stop',
            message: {
              content: outputText,
            },
          },
        ],
        usage: {
          prompt_tokens: 220,
          completion_tokens: 24,
          total_tokens: 244,
        },
      };
    },
  };
}

async function createOtherAlfredConversation({ projectRootPath }) {
  const masRootPath = path.join(projectRootPath, 'instance');

  await createConversationSession({
    masRootPath,
    conversationId: 'alfred-other-admin',
    title: 'Alfred Other Admin',
    ownerOperationalIdentityId: 'alfred',
    humanParticipantIds: ['human-admin'],
    createdBy: 'human-admin',
    createdAt: '2026-04-17T12:00:00.000Z',
  });
  await writeConversationTurn({
    masRootPath,
    conversationId: 'alfred-other-admin',
    requesterOperationalIdentityId: 'alfred',
    turn: {
      role: 'human',
      speaker: {
        speakerType: 'human',
        speakerId: 'human-admin',
        displayName: 'human-admin',
      },
      content: {
        contentType: 'text',
        text: `${OTHER_CONVERSATION_MARKER}: this readable but unselected conversation must not enter the selected chat prompt.`,
      },
      privacy: {
        visibility: 'private_to_conversation',
        sensitivityLevel: 'internal',
      },
    },
    createdAt: '2026-04-17T12:00:01.000Z',
  });
}

async function createAlfredRecallConversationWithPriorDenial({ projectRootPath }) {
  const masRootPath = path.join(projectRootPath, 'instance');

  await createConversationSession({
    masRootPath,
    conversationId: 'alfred-recall-admin',
    title: 'Alfred Recall Admin',
    ownerOperationalIdentityId: 'alfred',
    humanParticipantIds: ['human-admin'],
    createdBy: 'human-admin',
    createdAt: '2026-04-17T12:00:00.000Z',
  });
  await writeConversationTurn({
    masRootPath,
    conversationId: 'alfred-recall-admin',
    requesterOperationalIdentityId: 'alfred',
    turn: {
      role: 'human',
      speaker: {
        speakerType: 'human',
        speakerId: 'human-admin',
        displayName: 'human-admin',
      },
      content: {
        contentType: 'text',
        text: `${USER_NAME_RECALL_MARKER}: my name is Miguel.`,
      },
      privacy: {
        visibility: 'private_to_conversation',
        sensitivityLevel: 'internal',
      },
    },
    createdAt: '2026-04-17T12:00:01.000Z',
  });
  await writeConversationTurn({
    masRootPath,
    conversationId: 'alfred-recall-admin',
    requesterOperationalIdentityId: 'alfred',
    turn: {
      role: 'operational_identity',
      speaker: {
        speakerType: 'operational_identity',
        speakerId: 'alfred',
        displayName: 'Alfred',
      },
      content: {
        contentType: 'markdown',
        text: `${PRIOR_ASSISTANT_DENIAL_MARKER}: I do not have any stored memory or user name available.`,
      },
      invocationId: 'invocation-prior-denial',
      runtimeReferences: [
        {
          referenceType: 'invocation',
          referenceId: 'invocation-prior-denial',
        },
      ],
      privacy: {
        visibility: 'private_to_conversation',
        sensitivityLevel: 'internal',
      },
    },
    createdAt: '2026-04-17T12:00:02.000Z',
  });
}

test('runAgentInvocation creates a named conversation without running an agent command', async () => {
  const projectRootPath = await createAlfredProbabilisticProjectFixture();

  const result = await runAgentInvocation({
    projectRootPath,
    operationalIdentityId: 'alfred',
    createConversationName: 'alfred-admin',
    requestedBy: 'human-admin',
  });
  const session = JSON.parse(await readFile(
    path.join(projectRootPath, 'instance', 'memory', 'state', 'conversations', 'alfred-admin', 'session.json'),
    'utf8',
  ));
  const turns = await readConversationTurns({
    projectRootPath,
    conversationId: 'alfred-admin',
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.output.executionType, 'conversation_creation');
  assert.equal(result.output.conversationId, 'alfred-admin');
  assert.equal(result.conversation.conversationId, 'alfred-admin');
  assert.equal(result.persistence, null);
  assert.equal(session.owner.operationalIdentityId, 'alfred');
  assert.deepEqual(session.participants.humanParticipantIds, ['human-admin']);
  assert.deepEqual(turns, []);
});

test('runAgentInvocation rejects duplicate conversation creation instead of overwriting chat history', async () => {
  const projectRootPath = await createAlfredProbabilisticProjectFixture();

  const firstResult = await runAgentInvocation({
    projectRootPath,
    operationalIdentityId: 'alfred',
    createConversationName: 'alfred-admin',
    requestedBy: 'human-admin',
  });
  const secondResult = await runAgentInvocation({
    projectRootPath,
    operationalIdentityId: 'alfred',
    createConversationName: 'alfred-admin',
    requestedBy: 'human-admin',
  });

  assert.equal(firstResult.status, 'completed');
  assert.equal(secondResult.status, 'failed');
  assert.match(secondResult.message, /Conversation already exists: alfred-admin/u);
});

test('runAgentInvocation can create a conversation and talk in the same invocation', async () => {
  await withEnvironment(
    {
      "openrouter-api-key": 'openrouter-secret',
      "gemini-api-key": 'gemini-secret',
    },
    async () => {
      const projectRootPath = await createAlfredProbabilisticProjectFixture();
      let fetchCallCount = 0;

      const result = await runAgentInvocation({
        projectRootPath,
        operationalIdentityId: 'alfred',
        createConversationName: 'alfred-admin',
        invocationMode: 'probabilistic',
        command: 'ask',
        inputText: 'Hola Alfred, vamos a iniciar una conversación llamada alfred-admin.',
        requestedBy: 'human-admin',
        fetchImplementation: async (url, options) => {
          fetchCallCount += 1;
          assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions');

          const body = JSON.parse(options.body);
          const systemPrompt = body.messages[0].content;
          const userPrompt = body.messages[1].content;

          assert.match(systemPrompt, /Conversation Memory Recall Guard/u);
          assert.match(systemPrompt, /Conversation ID: alfred-admin/u);
          assert.match(systemPrompt, /Hola Alfred, vamos a iniciar una conversación/u);
          assert.match(userPrompt, /Hola Alfred, vamos a iniciar una conversación/u);

          return createOpenRouterResponse({
            responseId: 'conversation-create-and-talk-openrouter-1',
            outputText: 'Hola. Soy Alfred, y esta conversación alfred-admin ya quedó iniciada.',
          });
        },
      });
      const turns = await readConversationTurns({
        projectRootPath,
        conversationId: 'alfred-admin',
      });
      const invocationSession = JSON.parse(await readFile(
        result.persistence.invocationSessionRecordPath,
        'utf8',
      ));

      assert.equal(fetchCallCount, 1);
      assert.equal(result.status, 'completed');
      assert.equal(result.conversation.created, true);
      assert.equal(result.conversation.conversationId, 'alfred-admin');
      assert.equal(result.conversation.humanTurnId, 'turn-alfred-admin-000001');
      assert.equal(result.conversation.agentTurnId, 'turn-alfred-admin-000002');
      assert.equal(turns.length, 2);
      assert.equal(turns[0].role, 'human');
      assert.equal(turns[1].role, 'operational_identity');
      assert.equal(turns[1].invocationId, result.invocationId);
      assert.match(turns[1].content.text, /Soy Alfred/u);
      assert.equal(invocationSession.conversationRuntime.created, true);
      assert.equal(invocationSession.request.createConversationName, null);
      assert.equal(invocationSession.request.conversationId, 'alfred-admin');
    },
  );
});

test('runAgentInvocation resumes a selected conversation and excludes other readable conversations', async () => {
  await withEnvironment(
    {
      "openrouter-api-key": 'openrouter-secret',
      "gemini-api-key": 'gemini-secret',
    },
    async () => {
      const projectRootPath = await createAlfredProbabilisticProjectFixture();
      let fetchCallCount = 0;

      await runAgentInvocation({
        projectRootPath,
        operationalIdentityId: 'alfred',
        createConversationName: 'alfred-admin',
        requestedBy: 'human-admin',
      });
      await createOtherAlfredConversation({ projectRootPath });

      const firstResult = await runAgentInvocation({
        projectRootPath,
        operationalIdentityId: 'alfred',
        invocationMode: 'probabilistic',
        command: 'ask',
        conversationRef: 'alfred-admin',
        inputText: `${SELECTED_FIRST_MARKER}: please remember this selected conversation fact.`,
        requestedBy: 'human-admin',
        fetchImplementation: async (url, options) => {
          fetchCallCount += 1;
          assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions');

          const body = JSON.parse(options.body);
          const systemPrompt = body.messages[0].content;

          assert.match(systemPrompt, /Conversation Memory Recall Guard/u);
          assert.match(systemPrompt, /Conversation ID: alfred-admin/u);
          assert.match(systemPrompt, /Conversation Memory Recall Guard/u);
          assert.match(systemPrompt, new RegExp(SELECTED_FIRST_MARKER, 'u'));
          assert.doesNotMatch(systemPrompt, new RegExp(OTHER_CONVERSATION_MARKER, 'u'));

          return createOpenRouterResponse({
            responseId: 'conversation-aware-openrouter-1',
            outputText: `${SELECTED_AGENT_MARKER}: Alfred remembered the selected conversation safely.`,
          });
        },
      });
      const firstTurns = await readConversationTurns({
        projectRootPath,
        conversationId: 'alfred-admin',
      });

      assert.equal(firstResult.status, 'completed');
      assert.equal(firstResult.conversation.conversationId, 'alfred-admin');
      assert.equal(firstResult.conversation.humanTurnId, 'turn-alfred-admin-000001');
      assert.equal(firstResult.conversation.agentTurnId, 'turn-alfred-admin-000002');
      assert.equal(firstTurns.length, 2);
      assert.equal(firstTurns[0].role, 'human');
      assert.equal(firstTurns[1].role, 'operational_identity');
      assert.equal(firstTurns[1].invocationId, firstResult.invocationId);
      assert.match(firstTurns[1].content.text, new RegExp(SELECTED_AGENT_MARKER, 'u'));

      const secondResult = await runAgentInvocation({
        projectRootPath,
        operationalIdentityId: 'alfred',
        invocationMode: 'probabilistic',
        command: 'ask',
        conversationRef: 'alfred-admin',
        inputText: `${SELECTED_SECOND_MARKER}: what did you remember from this chat?`,
        requestedBy: 'human-admin',
        fetchImplementation: async (url, options) => {
          fetchCallCount += 1;
          assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions');

          const body = JSON.parse(options.body);
          const systemPrompt = body.messages[0].content;

          assert.match(systemPrompt, new RegExp(SELECTED_FIRST_MARKER, 'u'));
          assert.match(systemPrompt, new RegExp(SELECTED_AGENT_MARKER, 'u'));
          assert.match(systemPrompt, new RegExp(SELECTED_SECOND_MARKER, 'u'));
          assert.doesNotMatch(systemPrompt, new RegExp(OTHER_CONVERSATION_MARKER, 'u'));

          return createOpenRouterResponse({
            responseId: 'conversation-aware-openrouter-2',
            outputText: 'Alfred used the selected conversation continuity.',
          });
        },
      });
      const secondTurns = await readConversationTurns({
        projectRootPath,
        conversationId: 'alfred-admin',
      });
      const secondInvocationSession = JSON.parse(await readFile(
        secondResult.persistence.invocationSessionRecordPath,
        'utf8',
      ));

      assert.equal(fetchCallCount, 2);
      assert.equal(secondResult.status, 'completed');
      assert.equal(secondTurns.length, 4);
      assert.equal(secondResult.conversation.humanTurnId, 'turn-alfred-admin-000003');
      assert.equal(secondResult.conversation.agentTurnId, 'turn-alfred-admin-000004');
      assert.equal(secondInvocationSession.conversationRuntime.conversationId, 'alfred-admin');
      assert.equal(secondInvocationSession.request.conversationId, 'alfred-admin');
      assert.doesNotMatch(JSON.stringify(secondInvocationSession), /openrouter-secret|gemini-secret/u);
    },
  );
});

test('runAgentInvocation gives human conversation facts higher prompt visibility than prior assistant denials', async () => {
  await withEnvironment(
    {
      "openrouter-api-key": 'openrouter-secret',
      "gemini-api-key": 'gemini-secret',
    },
    async () => {
      const projectRootPath = await createAlfredProbabilisticProjectFixture();

      await createAlfredRecallConversationWithPriorDenial({ projectRootPath });

      const result = await runAgentInvocation({
        projectRootPath,
        operationalIdentityId: 'alfred',
        invocationMode: 'probabilistic',
        command: 'ask',
        conversationRef: 'alfred-recall-admin',
        inputText: 'What is my name?',
        requestedBy: 'human-admin',
        fetchImplementation: async (url, options) => {
          assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions');

          const body = JSON.parse(options.body);
          const systemPrompt = body.messages[0].content;

          assert.match(systemPrompt, /Conversation Memory Recall Guard/u);
          assert.match(systemPrompt, /Do not let an older assistant denial override/u);
          assert.match(systemPrompt, new RegExp(USER_NAME_RECALL_MARKER, 'u'));
          assert.match(systemPrompt, new RegExp(PRIOR_ASSISTANT_DENIAL_MARKER, 'u'));
          assert.ok(systemPrompt.indexOf(USER_NAME_RECALL_MARKER) < systemPrompt.indexOf(PRIOR_ASSISTANT_DENIAL_MARKER));

          return createOpenRouterResponse({
            responseId: 'conversation-human-fact-priority-openrouter-1',
            outputText: 'Your name is Miguel.',
          });
        },
      });

      assert.equal(result.status, 'completed');
    },
  );
});

test('runAgentInvocation fails safely when a conversation reference does not exist', async () => {
  const projectRootPath = await createAlfredProbabilisticProjectFixture();

  const result = await runAgentInvocation({
    projectRootPath,
    operationalIdentityId: 'alfred',
    invocationMode: 'probabilistic',
    command: 'ask',
    conversationRef: 'missing-chat',
    inputText: 'This should not create a conversation by typo.',
    requestedBy: 'human-admin',
  });

  assert.equal(result.status, 'failed');
  assert.match(result.message, /Conversation not found: missing-chat/u);
});
