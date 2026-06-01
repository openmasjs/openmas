import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  LOCAL_RUNTIME_CONVERSATION_RUN_KIND,
  assertLocalRuntimeConversationRun,
  createLocalRuntimeAdapter,
} from '../adapters/local-runtime-adapter.js';
import {
  OPENMAS_OS_KINDS,
  OPENMAS_OS_SCHEMA_VERSION,
  assertSafeOsSerializableValue,
} from '../../contracts/os/openmas-os-runtime-contract.js';
import { createConversationSession } from '../../conversations/create-conversation-session.js';
import { writeConversationTurn } from '../../conversations/write-conversation-turn.js';
import { runJobNow } from '../manual-job-execution.js';
import { createSafeFailureSummaryFromInvocationResult } from '../failure-summary.js';

const SAFE_IDENTIFIER_PATTERN = /^[a-zA-Z0-9._-]+$/u;

function defaultNow() {
  return new Date().toISOString();
}

function createRuntimeId(prefix) {
  return `${prefix}_${randomUUID()}`;
}

function createEventId() {
  return `event_${randomUUID()}`;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function assertNonEmptyString(value, description) {
  if (!isNonEmptyString(value)) {
    throw new Error(`${description} must be a non-empty string.`);
  }

  return value.trim();
}

function assertSafeIdentifier(value, description) {
  const normalizedValue = assertNonEmptyString(value, description);

  if (!SAFE_IDENTIFIER_PATTERN.test(normalizedValue)) {
    throw new Error(`${description} contains unsafe characters: ${normalizedValue}`);
  }

  return normalizedValue;
}

function assertNullableString(value, description) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  return assertNonEmptyString(value, description);
}

function assertPositiveInteger(value, description) {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${description} must be an integer greater than or equal to 1.`);
  }

  return value;
}

function normalizeNow(now) {
  if (now === undefined || now === null) {
    return defaultNow;
  }

  if (typeof now !== 'function') {
    throw new Error('OpenMAS OS Multi-Agent Conversation Manager now must be a function when provided.');
  }

  return now;
}

function createAdapter({ adapter = null, projectRootPath = null, osRootPath = null } = {}) {
  return adapter ?? createLocalRuntimeAdapter({ projectRootPath, osRootPath });
}

function assertAdapter(adapter) {
  if (!adapter || typeof adapter !== 'object') {
    throw new Error('OpenMAS OS Multi-Agent Conversation Manager requires a runtime adapter.');
  }

  for (const methodName of [
    'persistJob',
    'loadJob',
    'persistProcess',
    'loadProcess',
    'persistThread',
    'loadThread',
    'appendEvent',
    'persistConversationRun',
    'loadConversationRun',
  ]) {
    if (typeof adapter[methodName] !== 'function') {
      throw new Error(`OpenMAS OS runtime adapter must implement ${methodName}.`);
    }
  }

  return adapter;
}

function resolveMasRootPath({ masRootPath = null, projectRootPath = null } = {}) {
  if (isNonEmptyString(masRootPath)) {
    return masRootPath.trim();
  }

  if (isNonEmptyString(projectRootPath)) {
    return path.join(projectRootPath.trim(), 'instance');
  }

  throw new Error('OpenMAS OS Multi-Agent Conversation requires masRootPath or projectRootPath.');
}

function normalizeCreatedBy(createdBy) {
  const actor = createdBy ?? {
    type: 'human',
    id: 'admin',
  };

  if (!isPlainObject(actor)) {
    throw new Error('OpenMAS OS Multi-Agent Conversation createdBy must be an actor object.');
  }

  return {
    type: assertSafeIdentifier(actor.type, 'OpenMAS OS Multi-Agent Conversation createdBy type'),
    id: assertSafeIdentifier(actor.id, 'OpenMAS OS Multi-Agent Conversation createdBy id'),
  };
}

function normalizeParticipant(participant, index) {
  if (!isPlainObject(participant)) {
    throw new Error(`OpenMAS OS Multi-Agent Conversation participants[${index}] must be an object.`);
  }

  const safeParticipant = assertSafeOsSerializableValue(
    participant,
    `OpenMAS OS Multi-Agent Conversation participants[${index}]`,
  );

  if (Object.hasOwn(safeParticipant, 'agentId')) {
    throw new Error(`OpenMAS OS Multi-Agent Conversation participants[${index}] must not include agentId. Participants are addressed by Operational Identity; cognition is resolved per turn.`);
  }

  return {
    operationalIdentityId: assertSafeIdentifier(
      safeParticipant.operationalIdentityId,
      `OpenMAS OS Multi-Agent Conversation participants[${index}] operationalIdentityId`,
    ),
    displayName: assertNullableString(
      safeParticipant.displayName,
      `OpenMAS OS Multi-Agent Conversation participants[${index}] displayName`,
    ),
    command: assertNonEmptyString(
      safeParticipant.command ?? 'ask',
      `OpenMAS OS Multi-Agent Conversation participants[${index}] command`,
    ),
    mode: assertNonEmptyString(
      safeParticipant.mode ?? 'deterministic',
      `OpenMAS OS Multi-Agent Conversation participants[${index}] mode`,
    ),
    turnInstruction: assertNullableString(
      safeParticipant.turnInstruction,
      `OpenMAS OS Multi-Agent Conversation participants[${index}] turnInstruction`,
    ),
  };
}

function normalizeParticipants(participants) {
  if (!Array.isArray(participants) || participants.length === 0) {
    throw new Error('OpenMAS OS Multi-Agent Conversation participants must be a non-empty array.');
  }

  const seenOperationalIdentityIds = new Set();

  return participants.map((participant, index) => {
    const normalizedParticipant = normalizeParticipant(participant, index);

    if (seenOperationalIdentityIds.has(normalizedParticipant.operationalIdentityId)) {
      throw new Error(`OpenMAS OS Multi-Agent Conversation participants contains duplicated operationalIdentityId: ${normalizedParticipant.operationalIdentityId}`);
    }

    seenOperationalIdentityIds.add(normalizedParticipant.operationalIdentityId);
    return normalizedParticipant;
  });
}

function normalizeTurnPolicy(turnPolicy = {}) {
  const safeTurnPolicy = assertSafeOsSerializableValue(
    turnPolicy,
    'OpenMAS OS Multi-Agent Conversation turnPolicy',
  );

  if ((safeTurnPolicy.type ?? 'sequential') !== 'sequential') {
    throw new Error('OpenMAS OS Multi-Agent Conversation turnPolicy type must be "sequential" in v1.');
  }

  return {
    type: 'sequential',
    rounds: assertPositiveInteger(
      safeTurnPolicy.rounds ?? 1,
      'OpenMAS OS Multi-Agent Conversation turnPolicy rounds',
    ),
    maxRecentTurns: assertPositiveInteger(
      safeTurnPolicy.maxRecentTurns ?? 20,
      'OpenMAS OS Multi-Agent Conversation turnPolicy maxRecentTurns',
    ),
  };
}

function normalizeHumanParticipantIds({ humanParticipantIds = null, createdBy }) {
  const ids = Array.isArray(humanParticipantIds) && humanParticipantIds.length > 0
    ? humanParticipantIds
    : [createdBy.id];

  return [...new Set(ids.map((id, index) => {
    return assertSafeIdentifier(id, `OpenMAS OS Multi-Agent Conversation humanParticipantIds[${index}]`);
  }))];
}

function normalizeInitialTurn({ initialTurn = null, createdBy, humanParticipantIds }) {
  if (initialTurn === undefined || initialTurn === null || initialTurn === '') {
    return null;
  }

  const safeInitialTurn = assertSafeOsSerializableValue(
    typeof initialTurn === 'string'
      ? { text: initialTurn }
      : initialTurn,
    'OpenMAS OS Multi-Agent Conversation initialTurn',
  );

  return {
    text: assertNonEmptyString(
      safeInitialTurn.text,
      'OpenMAS OS Multi-Agent Conversation initialTurn text',
    ),
    speakerId: assertSafeIdentifier(
      safeInitialTurn.speakerId ?? humanParticipantIds[0] ?? createdBy.id,
      'OpenMAS OS Multi-Agent Conversation initialTurn speakerId',
    ),
    displayName: assertNullableString(
      safeInitialTurn.displayName,
      'OpenMAS OS Multi-Agent Conversation initialTurn displayName',
    ),
    contentType: assertNonEmptyString(
      safeInitialTurn.contentType ?? 'text',
      'OpenMAS OS Multi-Agent Conversation initialTurn contentType',
    ),
  };
}

async function appendConversationEvent({
  adapter,
  eventType,
  source,
  targetType,
  targetId,
  jobId = null,
  processId = null,
  threadId = null,
  occurredAt,
  payload = {},
}) {
  return adapter.appendEvent({
    kind: OPENMAS_OS_KINDS.event,
    schemaVersion: OPENMAS_OS_SCHEMA_VERSION,
    eventId: createEventId(),
    eventType,
    source,
    targetRef: {
      type: targetType,
      id: targetId,
    },
    jobId: jobId ?? (targetType === 'job' ? targetId : null),
    processId: processId ?? (targetType === 'process' ? targetId : null),
    threadId: threadId ?? (targetType === 'thread' ? targetId : null),
    occurredAt,
    payload,
  });
}

function buildTurnPlans({ participants, turnPolicy }) {
  const turns = [];

  for (let round = 1; round <= turnPolicy.rounds; round++) {
    for (const participant of participants) {
      const turnIndex = turns.length;

      turns.push({
        turnIndex,
        round,
        operationalIdentityId: participant.operationalIdentityId,
        status: turnIndex === 0 ? 'ready' : 'pending',
        childJobId: null,
        childProcessId: null,
        childThreadId: null,
        conversationTurnId: null,
        invocationId: null,
        startedAt: null,
        completedAt: null,
      });
    }
  }

  return turns;
}

function buildTurnInstruction({ participant, conversationId, round, turnIndex }) {
  if (isNonEmptyString(participant.turnInstruction)) {
    return participant.turnInstruction;
  }

  return `Contribute turn ${turnIndex + 1} in conversation ${conversationId} for round ${round}. Use only bounded conversation context and your governed runtime access.`;
}

function buildConversationTurnJob({
  conversationRun,
  participant,
  turn,
  createdByProcessId,
  projectId,
  priority,
  nowTimestamp,
}) {
  return {
    kind: OPENMAS_OS_KINDS.job,
    schemaVersion: OPENMAS_OS_SCHEMA_VERSION,
    jobId: `job_${conversationRun.conversationRunId}_turn_${String(turn.turnIndex + 1).padStart(3, '0')}`,
    projectId,
    status: 'ready',
    createdBy: {
      type: 'process',
      id: createdByProcessId,
    },
    assignedOperationalIdentityId: participant.operationalIdentityId,
    program: {
      type: 'agent_invocation',
      command: participant.command,
      mode: participant.mode,
    },
    inputRef: {
      type: 'inline_text',
      text: buildTurnInstruction({
        participant,
        conversationId: conversationRun.conversationId,
        round: turn.round,
        turnIndex: turn.turnIndex,
      }),
    },
    conversationId: conversationRun.conversationId,
    trigger: {
      type: 'manual',
    },
    priority,
    policies: {
      requiresApproval: false,
      maxAttempts: 1,
      noOverlap: false,
    },
    createdAt: nowTimestamp,
    updatedAt: nowTimestamp,
  };
}

function findParticipant(conversationRun, operationalIdentityId) {
  return conversationRun.participants.find((participant) => {
    return participant.operationalIdentityId === operationalIdentityId;
  }) ?? null;
}

function appendUniqueChildProcessId(childProcessIds, childProcessId) {
  const existingChildProcessIds = Array.isArray(childProcessIds) ? childProcessIds : [];

  return existingChildProcessIds.includes(childProcessId)
    ? existingChildProcessIds
    : [...existingChildProcessIds, childProcessId];
}

function createConversationTurnPayload({ participant, invocationResult }) {
  const outputText = assertSafeOsSerializableValue(
    invocationResult.message ?? `Turn completed by ${participant.operationalIdentityId}.`,
    'OpenMAS OS Multi-Agent Conversation turn output',
  );

  return {
    role: 'operational_identity',
    speaker: {
      speakerType: 'operational_identity',
      speakerId: participant.operationalIdentityId,
      displayName: participant.displayName,
    },
    content: {
      contentType: 'markdown',
      text: outputText,
    },
    invocationId: invocationResult.invocationId ?? null,
    runtimeReferences: invocationResult.invocationId
      ? [
        {
          referenceType: 'invocation',
          referenceId: invocationResult.invocationId,
        },
      ]
      : [],
    privacy: {
      visibility: 'private_to_conversation',
      sensitivityLevel: 'internal',
    },
  };
}

async function createReadyTurnJob({
  adapter,
  conversationRun,
  turnIndex,
  projectId,
  parentProcessId,
  priority,
  nowTimestamp,
}) {
  const turn = conversationRun.turns[turnIndex];
  const participant = findParticipant(conversationRun, turn.operationalIdentityId);
  const childJob = await adapter.persistJob(buildConversationTurnJob({
    conversationRun,
    participant,
    turn,
    createdByProcessId: parentProcessId,
    projectId,
    priority,
    nowTimestamp,
  }));

  return {
    childJob,
    turn: {
      ...turn,
      status: 'ready',
      childJobId: childJob.jobId,
    },
  };
}

export async function createMultiAgentConversation({
  adapter = null,
  projectRootPath = null,
  osRootPath = null,
  masRootPath = null,
  projectId = 'project_openmas',
  conversationRunId = createRuntimeId('conversation_run'),
  conversationId,
  title = null,
  createdBy = {
    type: 'human',
    id: 'admin',
  },
  humanParticipantIds = null,
  participants,
  turnPolicy = {},
  initialTurn = null,
  priority = 50,
  now = defaultNow,
} = {}) {
  const runtimeAdapter = assertAdapter(createAdapter({ adapter, projectRootPath, osRootPath }));
  const nowFn = normalizeNow(now);
  const nowTimestamp = nowFn();
  const normalizedCreatedBy = normalizeCreatedBy(createdBy);
  const normalizedConversationId = assertSafeIdentifier(
    conversationId,
    'OpenMAS OS Multi-Agent Conversation conversationId',
  );
  const normalizedConversationRunId = assertSafeIdentifier(
    conversationRunId,
    'OpenMAS OS Multi-Agent Conversation conversationRunId',
  );
  const normalizedParticipants = normalizeParticipants(participants);
  const normalizedTurnPolicy = normalizeTurnPolicy(turnPolicy);
  const normalizedHumanParticipantIds = normalizeHumanParticipantIds({
    humanParticipantIds,
    createdBy: normalizedCreatedBy,
  });
  const normalizedInitialTurn = normalizeInitialTurn({
    initialTurn,
    createdBy: normalizedCreatedBy,
    humanParticipantIds: normalizedHumanParticipantIds,
  });
  const normalizedMasRootPath = resolveMasRootPath({
    masRootPath,
    projectRootPath,
  });
  const conversationSession = await createConversationSession({
    masRootPath: normalizedMasRootPath,
    conversationId: normalizedConversationId,
    title,
    ownerOperationalIdentityId: normalizedParticipants[0].operationalIdentityId,
    humanParticipantIds: normalizedHumanParticipantIds,
    allowedOperationalIdentityIds: normalizedParticipants.map((participant) => {
      return participant.operationalIdentityId;
    }),
    createdBy: normalizedCreatedBy.id,
    createdAt: nowTimestamp,
    maxRecentTurns: normalizedTurnPolicy.maxRecentTurns,
  });

  let initialConversationTurn = null;

  if (normalizedInitialTurn) {
    const initialWrite = await writeConversationTurn({
      masRootPath: normalizedMasRootPath,
      conversationId: normalizedConversationId,
      requesterOperationalIdentityId: normalizedParticipants[0].operationalIdentityId,
      createdAt: nowTimestamp,
      turn: {
        role: 'human',
        speaker: {
          speakerType: 'human',
          speakerId: normalizedInitialTurn.speakerId,
          displayName: normalizedInitialTurn.displayName,
        },
        content: {
          contentType: normalizedInitialTurn.contentType,
          text: normalizedInitialTurn.text,
        },
        privacy: {
          visibility: 'private_to_conversation',
          sensitivityLevel: 'internal',
        },
      },
    });

    initialConversationTurn = initialWrite.turn;
  }

  const jobId = `job_${normalizedConversationRunId}`;
  const processId = `process_${normalizedConversationRunId}`;
  const threadId = `thread_${normalizedConversationRunId}`;
  const conversationRunShell = {
    kind: LOCAL_RUNTIME_CONVERSATION_RUN_KIND,
    schemaVersion: OPENMAS_OS_SCHEMA_VERSION,
    conversationRunId: normalizedConversationRunId,
    conversationId: normalizedConversationId,
    jobId,
    processId,
    status: 'active',
    currentTurnIndex: 0,
    participants: normalizedParticipants,
    turnPolicy: normalizedTurnPolicy,
    turns: buildTurnPlans({
      participants: normalizedParticipants,
      turnPolicy: normalizedTurnPolicy,
    }),
    contextRefs: [
      {
        sourceType: 'conversation_session',
        conversationId: normalizedConversationId,
        path: conversationSession.relativeSessionPath,
      },
      {
        sourceType: 'conversation_turns',
        conversationId: normalizedConversationId,
        path: conversationSession.relativeTurnsPath,
      },
    ],
    createdBy: normalizedCreatedBy,
    createdAt: nowTimestamp,
    updatedAt: nowTimestamp,
    completedAt: null,
  };
  const firstReadyTurn = await createReadyTurnJob({
    adapter: runtimeAdapter,
    conversationRun: conversationRunShell,
    turnIndex: 0,
    projectId,
    parentProcessId: processId,
    priority,
    nowTimestamp,
  });
  const conversationRun = await runtimeAdapter.persistConversationRun(assertLocalRuntimeConversationRun({
    ...conversationRunShell,
    turns: conversationRunShell.turns.map((turn, index) => {
      return index === 0 ? firstReadyTurn.turn : turn;
    }),
  }));
  const job = await runtimeAdapter.persistJob({
    kind: OPENMAS_OS_KINDS.job,
    schemaVersion: OPENMAS_OS_SCHEMA_VERSION,
    jobId,
    projectId,
    status: 'active',
    createdBy: normalizedCreatedBy,
    assignedOperationalIdentityId: normalizedParticipants[0].operationalIdentityId,
    program: {
      type: 'conversation_orchestration',
      programId: 'multi_agent_conversation_v1',
    },
    inputRef: {
      type: 'conversation_ref',
      refId: normalizedConversationId,
    },
    conversationId: normalizedConversationId,
    trigger: {
      type: 'manual',
    },
    priority,
    policies: {
      requiresApproval: false,
      maxAttempts: 1,
      noOverlap: true,
    },
    createdAt: nowTimestamp,
    updatedAt: nowTimestamp,
  });
  const processState = await runtimeAdapter.persistProcess({
    kind: OPENMAS_OS_KINDS.process,
    schemaVersion: OPENMAS_OS_SCHEMA_VERSION,
    processId,
    jobId,
    status: 'blocked',
    operationalIdentityId: normalizedParticipants[0].operationalIdentityId,
    activeCognitiveIdentityId: null,
    currentThreadId: threadId,
    parentProcessId: null,
    childProcessIds: [],
    conversationId: normalizedConversationId,
    memoryContextRefs: conversationRun.contextRefs,
    artifactRefs: [],
    credentialReferenceIds: [],
    pendingApprovalRefs: [],
    warnings: [],
    createdAt: nowTimestamp,
    startedAt: nowTimestamp,
    updatedAt: nowTimestamp,
    completedAt: null,
  });
  const thread = await runtimeAdapter.persistThread({
    kind: OPENMAS_OS_KINDS.thread,
    schemaVersion: OPENMAS_OS_SCHEMA_VERSION,
    threadId,
    processId,
    jobId,
    status: 'blocked',
    threadType: 'conversation_turn',
    priority,
    attempt: 1,
    waitReason: 'waiting_for_child_process',
    dueAt: null,
    createdAt: nowTimestamp,
    startedAt: nowTimestamp,
    updatedAt: nowTimestamp,
    completedAt: null,
  });
  const source = normalizedCreatedBy;

  await appendConversationEvent({
    adapter: runtimeAdapter,
    eventType: 'conversation.created',
    source,
    targetType: 'conversation',
    targetId: normalizedConversationId,
    jobId,
    processId,
    threadId,
    occurredAt: nowTimestamp,
    payload: {
      conversationRunId: normalizedConversationRunId,
      participantCount: normalizedParticipants.length,
      turnCount: conversationRun.turns.length,
      initialConversationTurnId: initialConversationTurn?.turnId ?? null,
      contextRefCount: conversationRun.contextRefs.length,
    },
  });
  await appendConversationEvent({
    adapter: runtimeAdapter,
    eventType: 'conversation.turn.ready',
    source: {
      type: 'process',
      id: processId,
    },
    targetType: 'conversation',
    targetId: normalizedConversationId,
    jobId,
    processId,
    threadId,
    occurredAt: nowTimestamp,
    payload: {
      conversationRunId: normalizedConversationRunId,
      turnIndex: 0,
      round: 1,
      operationalIdentityId: firstReadyTurn.turn.operationalIdentityId,
      childJobId: firstReadyTurn.childJob.jobId,
    },
  });

  return {
    conversationRun,
    conversationSession,
    initialConversationTurn,
    job,
    process: processState,
    thread,
    currentTurnJob: firstReadyTurn.childJob,
  };
}

function assertCurrentTurn({
  conversationRun,
  operationalIdentityId,
  childJobId,
}) {
  if (conversationRun.status !== 'active') {
    throw new Error(`OpenMAS OS Conversation Run ${conversationRun.conversationRunId} is not active.`);
  }

  const currentTurnIndex = conversationRun.currentTurnIndex;

  if (currentTurnIndex === null || currentTurnIndex === undefined) {
    throw new Error(`OpenMAS OS Conversation Run ${conversationRun.conversationRunId} has no current turn.`);
  }

  const currentTurn = conversationRun.turns[currentTurnIndex];

  if (!currentTurn || currentTurn.status !== 'ready') {
    throw new Error(`OpenMAS OS Conversation Run ${conversationRun.conversationRunId} current turn is not ready.`);
  }

  if (isNonEmptyString(operationalIdentityId) && currentTurn.operationalIdentityId !== operationalIdentityId.trim()) {
    throw new Error(`Operational Identity ${operationalIdentityId.trim()} cannot speak out of turn. Expected ${currentTurn.operationalIdentityId}.`);
  }

  if (isNonEmptyString(childJobId) && currentTurn.childJobId !== childJobId.trim()) {
    throw new Error(`Job ${childJobId.trim()} cannot run out of turn. Expected ${currentTurn.childJobId}.`);
  }

  return currentTurn;
}

function updateTurn(turns, turnIndex, patch) {
  return turns.map((turn, index) => {
    return index === turnIndex
      ? {
        ...turn,
        ...patch,
      }
      : turn;
  });
}

export async function runConversationTurnNow({
  adapter = null,
  projectRootPath = null,
  osRootPath = null,
  masRootPath = null,
  conversationRunId,
  operationalIdentityId = null,
  childJobId = null,
  now = defaultNow,
  invocationRunner,
  invocationOptions = {},
} = {}) {
  const runtimeAdapter = assertAdapter(createAdapter({ adapter, projectRootPath, osRootPath }));
  const nowFn = normalizeNow(now);
  const normalizedMasRootPath = resolveMasRootPath({
    masRootPath,
    projectRootPath,
  });
  let conversationRun = await runtimeAdapter.loadConversationRun(conversationRunId);
  const currentTurn = assertCurrentTurn({
    conversationRun,
    operationalIdentityId,
    childJobId,
  });
  const participant = findParticipant(conversationRun, currentTurn.operationalIdentityId);
  const parentProcess = await runtimeAdapter.loadProcess(conversationRun.processId);
  const parentThread = await runtimeAdapter.loadThread(parentProcess.currentThreadId);
  const startedAt = nowFn();

  conversationRun = await runtimeAdapter.persistConversationRun({
    ...conversationRun,
    turns: updateTurn(conversationRun.turns, currentTurn.turnIndex, {
      status: 'active',
      startedAt,
    }),
    updatedAt: startedAt,
  });

  const execution = await runJobNow({
    adapter: runtimeAdapter,
    projectRootPath,
    osRootPath,
    jobId: currentTurn.childJobId,
    parentProcessId: conversationRun.processId,
    now: nowFn,
    invocationRunner,
    invocationOptions,
  });
  const completedAt = execution.thread.completedAt ?? nowFn();
  const childProcessIds = appendUniqueChildProcessId(
    parentProcess.childProcessIds,
    execution.process.processId,
  );
  let writtenConversationTurn = null;

  if (execution.process.status === 'completed') {
    const turnWrite = await writeConversationTurn({
      masRootPath: normalizedMasRootPath,
      conversationId: conversationRun.conversationId,
      requesterOperationalIdentityId: participant.operationalIdentityId,
      createdAt: completedAt,
      turn: createConversationTurnPayload({
        participant,
        invocationResult: execution.invocationResult,
      }),
    });

    writtenConversationTurn = turnWrite.turn;
  }

  const completedTurnStatus = execution.process.status === 'completed' ? 'completed' : 'failed';
  const failureSummary = completedTurnStatus === 'failed'
    ? (
      execution.process.failureSummary
      ?? execution.thread.failureSummary
      ?? execution.job.failureSummary
      ?? createSafeFailureSummaryFromInvocationResult({
        invocationResult: execution.invocationResult,
        failedAt: completedAt,
        source: 'openmas-os-multi-agent-conversation',
        reasonCode: 'conversation_turn_failed',
        reason: 'OpenMAS OS conversation turn failed.',
      })
    )
    : null;
  const completedTurns = updateTurn(conversationRun.turns, currentTurn.turnIndex, {
    status: completedTurnStatus,
    childProcessId: execution.process.processId,
    childThreadId: execution.thread.threadId,
    conversationTurnId: writtenConversationTurn?.turnId ?? null,
    invocationId: execution.invocationResult.invocationId ?? null,
    completedAt,
  });

  await appendConversationEvent({
    adapter: runtimeAdapter,
    eventType: `conversation.turn.${completedTurnStatus}`,
    source: {
      type: 'process',
      id: execution.process.processId,
    },
    targetType: 'conversation',
    targetId: conversationRun.conversationId,
    jobId: conversationRun.jobId,
    processId: conversationRun.processId,
    threadId: parentThread.threadId,
    occurredAt: completedAt,
    payload: {
      conversationRunId: conversationRun.conversationRunId,
      turnIndex: currentTurn.turnIndex,
      round: currentTurn.round,
      operationalIdentityId: currentTurn.operationalIdentityId,
      childJobId: currentTurn.childJobId,
      childProcessId: execution.process.processId,
      childThreadId: execution.thread.threadId,
      conversationTurnId: writtenConversationTurn?.turnId ?? null,
      invocationId: execution.invocationResult.invocationId ?? null,
      invocationStatus: execution.invocationResult.status,
      ...(failureSummary ? {
        failedAt: completedAt,
        failureSummary,
      } : {}),
    },
  });

  if (execution.process.status !== 'completed') {
    const failedRun = await runtimeAdapter.persistConversationRun({
      ...conversationRun,
      status: 'failed',
      currentTurnIndex: currentTurn.turnIndex,
      turns: completedTurns,
      updatedAt: completedAt,
      completedAt,
    });
    const failedThread = await runtimeAdapter.persistThread({
      ...parentThread,
      status: 'failed',
      waitReason: null,
      updatedAt: completedAt,
      completedAt,
      failedAt: completedAt,
      failureSummary,
    });
    const failedProcess = await runtimeAdapter.persistProcess({
      ...parentProcess,
      status: 'failed',
      currentThreadId: null,
      childProcessIds,
      updatedAt: completedAt,
      completedAt,
      failedAt: completedAt,
      failureSummary,
    });
    const failedJob = await runtimeAdapter.persistJob({
      ...(await runtimeAdapter.loadJob(conversationRun.jobId)),
      status: 'failed',
      updatedAt: completedAt,
      failedAt: completedAt,
      failureSummary,
    });

    return {
      conversationRun: failedRun,
      execution,
      conversationTurn: writtenConversationTurn,
      nextTurnJob: null,
      job: failedJob,
      process: failedProcess,
      thread: failedThread,
    };
  }

  const nextTurnIndex = currentTurn.turnIndex + 1;

  if (nextTurnIndex >= completedTurns.length) {
    const completedRun = await runtimeAdapter.persistConversationRun({
      ...conversationRun,
      status: 'completed',
      currentTurnIndex: null,
      turns: completedTurns,
      updatedAt: completedAt,
      completedAt,
    });
    const completedThread = await runtimeAdapter.persistThread({
      ...parentThread,
      status: 'completed',
      waitReason: null,
      updatedAt: completedAt,
      completedAt,
    });
    const completedProcess = await runtimeAdapter.persistProcess({
      ...parentProcess,
      status: 'completed',
      currentThreadId: null,
      childProcessIds,
      updatedAt: completedAt,
      completedAt,
    });
    const completedJob = await runtimeAdapter.persistJob({
      ...(await runtimeAdapter.loadJob(conversationRun.jobId)),
      status: 'completed',
      updatedAt: completedAt,
    });

    await appendConversationEvent({
      adapter: runtimeAdapter,
      eventType: 'conversation.completed',
      source: {
        type: 'process',
        id: completedProcess.processId,
      },
      targetType: 'conversation',
      targetId: conversationRun.conversationId,
      jobId: completedJob.jobId,
      processId: completedProcess.processId,
      threadId: completedThread.threadId,
      occurredAt: completedAt,
      payload: {
        conversationRunId: completedRun.conversationRunId,
        turnCount: completedRun.turns.length,
        contextRefCount: completedRun.contextRefs.length,
      },
    });

    return {
      conversationRun: completedRun,
      execution,
      conversationTurn: writtenConversationTurn,
      nextTurnJob: null,
      job: completedJob,
      process: completedProcess,
      thread: completedThread,
    };
  }

  const nextTurnRunShell = {
    ...conversationRun,
    turns: completedTurns,
  };
  const nextReadyTurn = await createReadyTurnJob({
    adapter: runtimeAdapter,
    conversationRun: nextTurnRunShell,
    turnIndex: nextTurnIndex,
    projectId: (await runtimeAdapter.loadJob(conversationRun.jobId)).projectId,
    parentProcessId: conversationRun.processId,
    priority: parentThread.priority,
    nowTimestamp: completedAt,
  });
  const activeRun = await runtimeAdapter.persistConversationRun({
    ...conversationRun,
    status: 'active',
    currentTurnIndex: nextTurnIndex,
    turns: completedTurns.map((turn, index) => {
      return index === nextTurnIndex ? nextReadyTurn.turn : turn;
    }),
    updatedAt: completedAt,
  });
  const blockedProcess = await runtimeAdapter.persistProcess({
    ...parentProcess,
    status: 'blocked',
    currentThreadId: parentThread.threadId,
    childProcessIds,
    updatedAt: completedAt,
  });
  const blockedThread = await runtimeAdapter.persistThread({
    ...parentThread,
    status: 'blocked',
    waitReason: 'waiting_for_child_process',
    updatedAt: completedAt,
  });

  await appendConversationEvent({
    adapter: runtimeAdapter,
    eventType: 'conversation.turn.ready',
    source: {
      type: 'process',
      id: blockedProcess.processId,
    },
    targetType: 'conversation',
    targetId: activeRun.conversationId,
    jobId: activeRun.jobId,
    processId: blockedProcess.processId,
    threadId: blockedThread.threadId,
    occurredAt: completedAt,
    payload: {
      conversationRunId: activeRun.conversationRunId,
      turnIndex: nextReadyTurn.turn.turnIndex,
      round: nextReadyTurn.turn.round,
      operationalIdentityId: nextReadyTurn.turn.operationalIdentityId,
      childJobId: nextReadyTurn.childJob.jobId,
    },
  });

  return {
    conversationRun: activeRun,
    execution,
    conversationTurn: writtenConversationTurn,
    nextTurnJob: nextReadyTurn.childJob,
    process: blockedProcess,
    thread: blockedThread,
  };
}

export class MultiAgentConversationManager {
  constructor({
    adapter = null,
    projectRootPath = null,
    osRootPath = null,
    masRootPath = null,
    now = defaultNow,
  } = {}) {
    this.adapter = assertAdapter(createAdapter({ adapter, projectRootPath, osRootPath }));
    this.projectRootPath = projectRootPath;
    this.osRootPath = osRootPath;
    this.masRootPath = masRootPath;
    this.now = normalizeNow(now);
  }

  async create(options = {}) {
    return createMultiAgentConversation({
      adapter: this.adapter,
      projectRootPath: this.projectRootPath,
      osRootPath: this.osRootPath,
      masRootPath: this.masRootPath,
      now: this.now,
      ...options,
    });
  }

  async runTurnNow(options = {}) {
    return runConversationTurnNow({
      adapter: this.adapter,
      projectRootPath: this.projectRootPath,
      osRootPath: this.osRootPath,
      masRootPath: this.masRootPath,
      now: this.now,
      ...options,
    });
  }
}

export function createMultiAgentConversationManager(options = {}) {
  return new MultiAgentConversationManager(options);
}
