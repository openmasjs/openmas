import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { buildContextPackLayer } from '../../src/brain/build-context-pack-layer.js';
import { buildPromptProvenance } from '../../src/brain/build-prompt-provenance.js';
import { createConversationSession } from '../../src/conversations/create-conversation-session.js';
import { writeConversationTurn } from '../../src/conversations/write-conversation-turn.js';
import { buildContextPackForInvocation } from '../../src/context/build-context-pack-for-invocation.js';
import { buildDefaultMemorySourceRegistry } from '../../src/memory/build-default-memory-source-registry.js';
import { readConversationMemory } from '../../src/memory/read-conversation-memory.js';

const VALID_CREATED_AT = '2026-04-17T12:00:00.000Z';

async function createMasRoot() {
  const projectRootPath = await mkdtemp(path.join(os.tmpdir(), 'openmas-conversation-context-'));

  return {
    projectRootPath,
    masRootPath: path.join(projectRootPath, 'instance'),
  };
}

function getConversationSource(overrides = {}) {
  const sourceDefinition = buildDefaultMemorySourceRegistry({
    masOwnerId: 'sin-cuchillo',
  }).memorySources.find((source) => {
    return source.sourceId === 'conversation-state';
  });

  return {
    ...sourceDefinition,
    ...overrides,
    readPolicy: {
      ...sourceDefinition.readPolicy,
      ...(overrides.readPolicy ?? {}),
    },
  };
}

function buildReadiness(overrides = {}) {
  return {
    status: 'ready',
    resolvedPrimaryCognitiveIdentityId: 'community-manager',
    operationalIdentityDefinition: {
      operationalIdentityId: 'maria',
      displayName: 'Maria',
    },
    activeCognitiveSet: {
      primaryCognitiveIdentityId: 'community-manager',
      secondaryCognitiveIdentityIds: [],
    },
    brainSelection: {
      selectedBrain: {
        providerId: 'openrouter-api',
        modelId: 'openrouter/free',
      },
      fallbackBrain: null,
    },
    usableBindings: [],
    ...overrides,
  };
}

function buildRequest(overrides = {}) {
  return {
    operationalIdentityId: 'maria',
    invocationMode: 'probabilistic',
    command: 'ask',
    requestedBy: 'human-admin',
    inputText: 'Continue the current conversation.',
    ...overrides,
  };
}

function buildHumanTurn({ speakerId = 'human-admin', displayName = 'MAS Admin', text }) {
  return {
    role: 'human',
    speaker: {
      speakerType: 'human',
      speakerId,
      displayName,
    },
    content: {
      contentType: 'text',
      text,
    },
    privacy: {
      visibility: 'private_to_conversation',
      sensitivityLevel: 'internal',
    },
  };
}

function buildOperationalIdentityTurn({
  operationalIdentityId,
  displayName,
  text,
  invocationId = null,
}) {
  return {
    role: 'operational_identity',
    speaker: {
      speakerType: 'operational_identity',
      speakerId: operationalIdentityId,
      displayName,
    },
    content: {
      contentType: 'markdown',
      text,
    },
    invocationId,
    runtimeReferences: invocationId
      ? [
        {
          referenceType: 'invocation',
          referenceId: invocationId,
        },
      ]
      : [],
    privacy: {
      visibility: 'private_to_conversation',
      sensitivityLevel: 'internal',
    },
  };
}

async function writeMariaBoundedConversation({ masRootPath }) {
  await createConversationSession({
    masRootPath,
    conversationId: 'maria-complaint-thread',
    title: 'Maria Complaint Follow-up',
    ownerOperationalIdentityId: 'maria',
    humanParticipantIds: ['human-admin'],
    createdBy: 'human-admin',
    createdAt: VALID_CREATED_AT,
    maxRecentTurns: 2,
  });

  await writeConversationTurn({
    masRootPath,
    conversationId: 'maria-complaint-thread',
    requesterOperationalIdentityId: 'maria',
    turn: buildHumanTurn({
      text: 'OLD_CONVERSATION_CONTEXT_MUST_NOT_LEAK: this older complaint detail is outside the bounded context window.',
    }),
    createdAt: '2026-04-17T12:00:01.000Z',
  });
  await writeConversationTurn({
    masRootPath,
    conversationId: 'maria-complaint-thread',
    requesterOperationalIdentityId: 'maria',
    turn: buildOperationalIdentityTurn({
      operationalIdentityId: 'maria',
      displayName: 'Maria',
      text: 'Maria acknowledged the customer frustration and promised a careful follow-up.',
      invocationId: 'invocation-maria-001',
    }),
    createdAt: '2026-04-17T12:00:02.000Z',
  });
  await writeConversationTurn({
    masRootPath,
    conversationId: 'maria-complaint-thread',
    requesterOperationalIdentityId: 'maria',
    turn: buildHumanTurn({
      text: 'Please continue with a calm and specific response about the delivery issue.',
    }),
    createdAt: '2026-04-17T12:00:03.000Z',
  });
}

async function writeAlfredPrivateConversation({ masRootPath }) {
  await createConversationSession({
    masRootPath,
    conversationId: 'alfred-private-admin-thread',
    title: 'Alfred Private Admin Thread',
    ownerOperationalIdentityId: 'alfred',
    humanParticipantIds: ['human-admin'],
    createdBy: 'human-admin',
    createdAt: VALID_CREATED_AT,
    maxRecentTurns: 5,
  });

  await writeConversationTurn({
    masRootPath,
    conversationId: 'alfred-private-admin-thread',
    requesterOperationalIdentityId: 'alfred',
    turn: buildHumanTurn({
      text: 'ALFRED_PRIVATE_CONVERSATION_MUST_NOT_LEAK: inspect private MAS administration details.',
    }),
    createdAt: '2026-04-17T12:00:04.000Z',
  });
}

async function writeMariaOversizedConversation({ masRootPath }) {
  await createConversationSession({
    masRootPath,
    conversationId: 'maria-oversized-thread',
    title: 'Maria Oversized Context Thread',
    ownerOperationalIdentityId: 'maria',
    humanParticipantIds: ['human-admin'],
    createdBy: 'human-admin',
    createdAt: VALID_CREATED_AT,
    maxRecentTurns: 2,
  });

  await writeConversationTurn({
    masRootPath,
    conversationId: 'maria-oversized-thread',
    requesterOperationalIdentityId: 'maria',
    turn: buildHumanTurn({
      text: `OVERSIZED_OLD_TURN_MUST_NOT_LEAK: ${'older context '.repeat(80)}`,
    }),
    createdAt: '2026-04-17T12:00:01.000Z',
  });
  await writeConversationTurn({
    masRootPath,
    conversationId: 'maria-oversized-thread',
    requesterOperationalIdentityId: 'maria',
    turn: buildOperationalIdentityTurn({
      operationalIdentityId: 'maria',
      displayName: 'Maria',
      text: `OVERSIZED_SELECTED_AGENT_MARKER: ${'recent agent context '.repeat(120)}`,
      invocationId: 'invocation-maria-oversized-001',
    }),
    createdAt: '2026-04-17T12:00:02.000Z',
  });
  await writeConversationTurn({
    masRootPath,
    conversationId: 'maria-oversized-thread',
    requesterOperationalIdentityId: 'maria',
    turn: buildHumanTurn({
      text: `OVERSIZED_SELECTED_HUMAN_MARKER: ${'latest human context '.repeat(60)}`,
    }),
    createdAt: '2026-04-17T12:00:03.000Z',
  });
}

function buildConversationMemoryRegistry() {
  return {
    kind: 'memory_source_registry',
    version: 1,
    memorySources: [
      getConversationSource(),
    ],
  };
}

test('readConversationMemory exposes only bounded conversations readable by the current Operational Identity', async () => {
  const {
    masRootPath,
  } = await createMasRoot();

  await writeMariaBoundedConversation({ masRootPath });
  await writeAlfredPrivateConversation({ masRootPath });

  const result = await readConversationMemory({
    masRootPath,
    sourceDefinition: getConversationSource(),
    readiness: buildReadiness(),
  });
  const fullContent = result.memoryRecords.map((record) => record.content).join('\n');

  assert.equal(result.memoryRecords.length, 1);
  assert.equal(result.memoryRecords[0].memoryType, 'conversation_summary');
  assert.equal(result.memoryRecords[0].scope, 'operational_identity');
  assert.equal(result.memoryRecords[0].ownerId, 'maria');
  assert.equal(result.memoryRecords[0].sourceReferences.some((reference) => {
    return reference.sourceType === 'conversation_session';
  }), true);
  assert.equal(result.memoryRecords[0].sourceReferences.some((reference) => {
    return reference.sourceType === 'conversation_turn';
  }), true);
  assert.match(fullContent, /Maria acknowledged the customer frustration/u);
  assert.match(fullContent, /Please continue with a calm and specific response/u);
  assert.doesNotMatch(fullContent, /OLD_CONVERSATION_CONTEXT_MUST_NOT_LEAK/u);
  assert.doesNotMatch(fullContent, /ALFRED_PRIVATE_CONVERSATION_MUST_NOT_LEAK/u);
  assert.equal(result.memoryRecords[0].warnings.some((warning) => {
    return warning.includes('omitted 1 older turns');
  }), true);
  assert.equal(result.warnings.some((warning) => {
    return warning.includes('alfred-private-admin-thread');
  }), true);
});

test('readConversationMemory prioritizes human turns over prior assistant denials for recall', async () => {
  const {
    masRootPath,
  } = await createMasRoot();

  await createConversationSession({
    masRootPath,
    conversationId: 'maria-name-recall',
    title: 'Maria Name Recall',
    ownerOperationalIdentityId: 'maria',
    humanParticipantIds: ['human-admin'],
    createdBy: 'human-admin',
    createdAt: VALID_CREATED_AT,
    maxRecentTurns: 6,
  });
  await writeConversationTurn({
    masRootPath,
    conversationId: 'maria-name-recall',
    requesterOperationalIdentityId: 'maria',
    turn: buildHumanTurn({
      text: 'USER_NAME_RECALL_MARKER: my name is Miguel.',
    }),
    createdAt: '2026-04-17T12:00:01.000Z',
  });
  await writeConversationTurn({
    masRootPath,
    conversationId: 'maria-name-recall',
    requesterOperationalIdentityId: 'maria',
    turn: buildOperationalIdentityTurn({
      operationalIdentityId: 'maria',
      displayName: 'Maria',
      text: 'I do not have any stored memory or user name available.',
      invocationId: 'invocation-maria-denial',
    }),
    createdAt: '2026-04-17T12:00:02.000Z',
  });
  await writeConversationTurn({
    masRootPath,
    conversationId: 'maria-name-recall',
    requesterOperationalIdentityId: 'maria',
    turn: buildHumanTurn({
      text: 'What is my name?',
    }),
    createdAt: '2026-04-17T12:00:03.000Z',
  });

  const result = await readConversationMemory({
    masRootPath,
    sourceDefinition: getConversationSource(),
    readiness: buildReadiness({
      conversationContext: {
        conversationId: 'maria-name-recall',
      },
    }),
  });
  const content = result.memoryRecords[0].content;

  assert.equal(result.memoryRecords.length, 1);
  assert.match(content, /Recent Human Turns \(newest first; high-signal conversation evidence\):/u);
  assert.match(content, /Recent Operational Identity Turns \(newest first; historical outputs, lower authority than human turns\):/u);
  assert.equal(content.includes('null'), false);
  assert.ok(content.indexOf('USER_NAME_RECALL_MARKER') < content.indexOf('I do not have any stored memory'));
});

test('readConversationMemory keeps a selected oversized conversation through bounded recent-turn context', async () => {
  const {
    masRootPath,
  } = await createMasRoot();

  await writeMariaOversizedConversation({ masRootPath });

  const result = await readConversationMemory({
    masRootPath,
    sourceDefinition: getConversationSource({
      readPolicy: {
        maxFiles: 5,
        maxBytesPerFile: 2048,
      },
    }),
    readiness: buildReadiness({
      conversationContext: {
        conversationId: 'maria-oversized-thread',
      },
    }),
  });
  const content = result.memoryRecords[0].content;

  assert.equal(result.memoryRecords.length, 1);
  assert.match(content, /OVERSIZED_SELECTED_AGENT_MARKER/u);
  assert.match(content, /OVERSIZED_SELECTED_HUMAN_MARKER/u);
  assert.doesNotMatch(content, /OVERSIZED_OLD_TURN_MUST_NOT_LEAK/u);
  assert.equal(result.warnings.some((warning) => {
    return warning.includes('admitted oversized turns maria-oversized-thread');
  }), true);
  assert.equal(result.warnings.some((warning) => {
    return warning.includes('did not find selected conversation maria-oversized-thread');
  }), false);
  assert.equal(result.memoryRecords[0].warnings.some((warning) => {
    return warning.includes('admitted oversized turns.json');
  }), true);
});

test('buildContextPackForInvocation includes curated conversation context without unbounded raw history', async () => {
  const {
    masRootPath,
  } = await createMasRoot();

  await writeMariaBoundedConversation({ masRootPath });
  await writeAlfredPrivateConversation({ masRootPath });

  const contextPack = await buildContextPackForInvocation({
    bootResult: {
      status: 'ready',
      masRootPath,
    },
    readiness: buildReadiness(),
    request: buildRequest(),
    invocationId: 'invocation-conversation-context',
    memorySourceRegistry: buildConversationMemoryRegistry(),
  });
  const conversationSection = contextPack.sections.find((section) => {
    return section.sectionType === 'conversation_context';
  });
  const fullContent = contextPack.sections.map((section) => section.content).join('\n');

  assert.ok(conversationSection);
  assert.equal(conversationSection.title, 'Conversation Context');
  assert.equal(conversationSection.memoryRecordIds.length, 1);
  assert.equal(conversationSection.sourceReferences.some((reference) => {
    return reference.sourceType === 'conversation_session';
  }), true);
  assert.equal(conversationSection.sourceReferences.filter((reference) => {
    return reference.sourceType === 'conversation_turn';
  }).length, 2);
  assert.match(conversationSection.content, /Older Turns Omitted: 1/u);
  assert.match(fullContent, /Maria acknowledged the customer frustration/u);
  assert.doesNotMatch(fullContent, /OLD_CONVERSATION_CONTEXT_MUST_NOT_LEAK/u);
  assert.doesNotMatch(fullContent, /ALFRED_PRIVATE_CONVERSATION_MUST_NOT_LEAK/u);
});

test('prompt provenance traces conversation context through the Context Pack layer without raw conversation text', async () => {
  const {
    masRootPath,
  } = await createMasRoot();

  await writeMariaBoundedConversation({ masRootPath });

  const contextPack = await buildContextPackForInvocation({
    bootResult: {
      status: 'ready',
      masRootPath,
    },
    readiness: buildReadiness(),
    request: buildRequest(),
    invocationId: 'invocation-conversation-provenance',
    memorySourceRegistry: buildConversationMemoryRegistry(),
  });
  const contextPackLayer = buildContextPackLayer({ contextPack });
  const provenance = buildPromptProvenance({
    instructionLayers: [contextPackLayer],
    brainInput: {
      providerId: 'openrouter-api',
      modelId: 'openrouter/free',
      systemInstructions: contextPackLayer.content,
      userInput: 'Command: ask',
      messages: [
        {
          role: 'system',
          content: contextPackLayer.content,
        },
        {
          role: 'user',
          content: 'Command: ask',
        },
      ],
    },
    providerRequest: {
      providerId: 'openrouter-api',
      modelId: 'openrouter/free',
      requestType: 'generate_text',
      messages: [],
    },
  });
  const contextPackProvenanceLayer = provenance.includedLayers.find((layer) => {
    return layer.layerType === 'context_pack';
  });
  const serializedProvenance = JSON.stringify(provenance);

  assert.ok(contextPackProvenanceLayer);
  assert.equal(contextPackProvenanceLayer.sourceReferences.some((sourceReference) => {
    return sourceReference.sourceType === 'conversation_session'
      && sourceReference.sourceId === 'maria-complaint-thread';
  }), true);
  assert.equal(contextPackProvenanceLayer.sourceReferences.some((sourceReference) => {
    return sourceReference.sourceType === 'conversation_turn'
      && sourceReference.path === 'memory/state/conversations/maria-complaint-thread/turns.json';
  }), true);
  assert.match(contextPackProvenanceLayer.contentSha256, /^[a-f0-9]{64}$/u);
  assert.equal(contextPackProvenanceLayer.content, undefined);
  assert.doesNotMatch(serializedProvenance, /Maria acknowledged the customer frustration/u);
  assert.doesNotMatch(serializedProvenance, /Please continue with a calm and specific response/u);
});
