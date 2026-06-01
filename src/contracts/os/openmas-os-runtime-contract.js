const OPENMAS_OS_SCHEMA_VERSION = 1;

const OPENMAS_OS_KINDS = Object.freeze({
  job: 'openmas_os_job',
  process: 'openmas_os_process',
  thread: 'openmas_os_thread',
  event: 'openmas_os_event',
  signal: 'openmas_os_signal',
});

const OPENMAS_OS_JOB_STATUSES = new Set([
  'draft',
  'admitted',
  'scheduled',
  'ready',
  'active',
  'paused',
  'completed',
  'cancelled',
  'expired',
  'failed',
]);

const OPENMAS_OS_PROCESS_STATUSES = new Set([
  'created',
  'ready',
  'running',
  'blocked',
  'suspended',
  'completed',
  'failed',
  'cancelled',
  'interrupted',
]);

const OPENMAS_OS_TERMINAL_PROCESS_STATUSES = new Set([
  'completed',
  'failed',
  'cancelled',
]);

const OPENMAS_OS_THREAD_STATUSES = new Set([
  'created',
  'ready',
  'running',
  'yielded',
  'blocked',
  'completed',
  'failed',
  'cancelled',
]);

const OPENMAS_OS_THREAD_TYPES = new Set([
  'agent_invocation',
  'workflow_step',
  'tool_execution',
  'approval_continuation',
  'child_process_wait',
  'event_reaction',
  'conversation_turn',
]);

const OPENMAS_OS_PROGRAM_TYPES = new Set([
  'agent_invocation',
  'workflow',
  'tool',
  'conversation_orchestration',
  'delegation',
]);

const OPENMAS_OS_AGENT_INVOCATION_MODES = new Set([
  'deterministic',
  'probabilistic',
]);

const OPENMAS_OS_TRIGGER_TYPES = new Set([
  'immediate',
  'manual',
  'scheduled_once',
  'recurring',
  'event_driven',
]);

const OPENMAS_OS_INPUT_REF_TYPES = new Set([
  'none',
  'inline_text',
  'artifact_ref',
  'memory_ref',
  'conversation_ref',
]);

const OPENMAS_OS_ACTOR_TYPES = new Set([
  'human',
  'operational_identity',
  'cognitive_identity',
  'agent',
  'system',
  'process',
  'timer',
  'event',
  'external',
]);

const OPENMAS_OS_TARGET_TYPES = new Set([
  'job',
  'process',
  'thread',
  'timer',
  'event',
  'approval',
  'resource',
  'conversation',
]);

const OPENMAS_OS_SIGNAL_TYPES = new Set([
  'pause',
  'resume',
  'cancel',
  'timeout',
  'preempt',
  'approval_granted',
  'approval_rejected',
  'child_completed',
  'child_failed',
  'resource_available',
  'event_matched',
  'escalate',
]);

const OPENMAS_OS_WAIT_REASONS = new Set([
  'approval_required',
  'waiting_for_child_process',
  'waiting_for_system_call',
  'waiting_for_timer',
  'waiting_for_event',
  'waiting_for_resource',
  'retry_scheduled',
  'manual_pause',
]);

const OPENMAS_OS_MISSED_RUN_POLICIES = new Set([
  'skip',
  'delay',
  'run_latest',
]);

const SAFE_OPENMAS_OS_IDENTIFIER_PATTERN = /^[a-zA-Z0-9._-]+$/u;
const SAFE_OPENMAS_OS_EVENT_TYPE_PATTERN = /^[a-zA-Z0-9._-]+$/u;

const SAFE_SECRET_METADATA_FIELD_NAMES = new Set([
  'secretreferenceid',
  'secretreferenceids',
  'secrettype',
  'secrettypes',
  'secretreferencestatus',
  'secretresolutionstatus',
  'requiredsecretreferenceids',
  'missingsecretreferenceids',
]);

const UNSAFE_SECRET_FIELD_NAMES = new Set([
  'secret',
  'secrets',
  'secretvalue',
  'rawsecret',
  'credential',
  'credentials',
  'credentialvalue',
  'apikey',
  'apitoken',
  'token',
  'authtoken',
  'accesstoken',
  'refreshtoken',
  'bearertoken',
  'password',
  'privatekey',
  'clientsecret',
  'authorization',
  'bearer',
]);

const SECRET_VALUE_PATTERNS = Object.freeze([
  /sk-(?:or-)?[a-zA-Z0-9_-]{8,}/u,
  /AIza[a-zA-Z0-9_-]{10,}/u,
  /xox[baprs]-[a-zA-Z0-9-]{8,}/u,
  /Bearer\s+[a-zA-Z0-9._~+/-]{12,}/iu,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/u,
]);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeFieldName(fieldName) {
  return String(fieldName).toLowerCase().replace(/[^a-z0-9]/gu, '');
}

function isUnsafeSecretFieldName(fieldName) {
  const normalizedFieldName = normalizeFieldName(fieldName);

  if (SAFE_SECRET_METADATA_FIELD_NAMES.has(normalizedFieldName)) {
    return false;
  }

  if (UNSAFE_SECRET_FIELD_NAMES.has(normalizedFieldName)) {
    return true;
  }

  return normalizedFieldName.endsWith('apikey')
    || normalizedFieldName.endsWith('apitoken')
    || normalizedFieldName.endsWith('accesstoken')
    || normalizedFieldName.endsWith('refreshtoken')
    || normalizedFieldName.endsWith('authtoken')
    || normalizedFieldName.endsWith('bearertoken')
    || normalizedFieldName.endsWith('password')
    || normalizedFieldName.endsWith('privatekey')
    || normalizedFieldName.endsWith('clientsecret');
}

function containsSecretLikeValue(value) {
  if (!isNonEmptyString(value)) {
    return false;
  }

  return SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(value));
}

function assertPlainObject(value, description) {
  if (!isPlainObject(value)) {
    throw new Error(`${description} must be an object.`);
  }

  return value;
}

function assertSchemaVersion(value, description) {
  if (!Number.isInteger(value) || value < OPENMAS_OS_SCHEMA_VERSION) {
    throw new Error(`${description} must include an integer schemaVersion greater than or equal to ${OPENMAS_OS_SCHEMA_VERSION}.`);
  }

  return value;
}

function assertKind(value, expectedKind, description) {
  if (value !== expectedKind) {
    throw new Error(`${description} must include kind "${expectedKind}".`);
  }

  return value;
}

function assertEnumValue(value, allowedValues, description) {
  if (!isNonEmptyString(value)) {
    throw new Error(`${description} must be a non-empty string.`);
  }

  const normalizedValue = value.trim();

  if (!allowedValues.has(normalizedValue)) {
    throw new Error(`${description} is invalid: ${normalizedValue}`);
  }

  return normalizedValue;
}

function assertSafeIdentifier(value, description) {
  if (!isNonEmptyString(value)) {
    throw new Error(`${description} must be a non-empty string.`);
  }

  const normalizedValue = value.trim();

  if (!SAFE_OPENMAS_OS_IDENTIFIER_PATTERN.test(normalizedValue)) {
    throw new Error(`${description} contains unsafe characters: ${normalizedValue}`);
  }

  return normalizedValue;
}

function assertSafeEventType(value, description) {
  if (!isNonEmptyString(value)) {
    throw new Error(`${description} must be a non-empty string.`);
  }

  const normalizedValue = value.trim();

  if (!SAFE_OPENMAS_OS_EVENT_TYPE_PATTERN.test(normalizedValue)) {
    throw new Error(`${description} contains unsafe characters: ${normalizedValue}`);
  }

  return normalizedValue;
}

function assertNullableSafeIdentifier(value, description) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  return assertSafeIdentifier(value, description);
}

function assertNullableString(value, description) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  if (!isNonEmptyString(value)) {
    throw new Error(`${description} must be a non-empty string when provided.`);
  }

  const normalizedValue = value.trim();

  if (containsSecretLikeValue(normalizedValue)) {
    throw new Error(`${description} contains a secret-like value and cannot be persisted in OpenMAS OS state.`);
  }

  return normalizedValue;
}

function assertRequiredString(value, description) {
  if (!isNonEmptyString(value)) {
    throw new Error(`${description} must be a non-empty string.`);
  }

  const normalizedValue = value.trim();

  if (containsSecretLikeValue(normalizedValue)) {
    throw new Error(`${description} contains a secret-like value and cannot be persisted in OpenMAS OS state.`);
  }

  return normalizedValue;
}

function assertIntegerInRange(value, description, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${description} must be an integer between ${min} and ${max}.`);
  }

  return value;
}

function assertOptionalBoolean(value, description, defaultValue) {
  if (value === undefined || value === null) {
    return defaultValue;
  }

  if (typeof value !== 'boolean') {
    throw new Error(`${description} must be a boolean when provided.`);
  }

  return value;
}

function assertStringArray(values, description, { allowEmpty = true } = {}) {
  if (!Array.isArray(values)) {
    throw new Error(`${description} must be an array.`);
  }

  if (!allowEmpty && values.length === 0) {
    throw new Error(`${description} must include at least one value.`);
  }

  const seenValues = new Set();

  return values.map((value, index) => {
    const normalizedValue = assertSafeIdentifier(value, `${description}[${index}]`);

    if (seenValues.has(normalizedValue)) {
      throw new Error(`${description} contains a duplicated value: ${normalizedValue}`);
    }

    seenValues.add(normalizedValue);
    return normalizedValue;
  });
}

function assertSafeStringArray(values, description) {
  if (!Array.isArray(values)) {
    throw new Error(`${description} must be an array.`);
  }

  return values.map((value, index) => {
    return assertRequiredString(value, `${description}[${index}]`);
  });
}

function assertSafeReference(reference, description) {
  assertPlainObject(reference, description);

  const normalizedReference = {};

  for (const [key, value] of Object.entries(reference)) {
    if (isUnsafeSecretFieldName(key)) {
      throw new Error(`${description}.${key} is a raw secret-like field and cannot be persisted in OpenMAS OS state.`);
    }

    normalizedReference[key] = assertSafeOsSerializableValue(value, `${description}.${key}`);
  }

  return normalizedReference;
}

function assertSafeReferenceArray(values, description) {
  if (!Array.isArray(values)) {
    throw new Error(`${description} must be an array.`);
  }

  return values.map((value, index) => {
    return assertSafeReference(value, `${description}[${index}]`);
  });
}

function assertActor(actor, description) {
  assertPlainObject(actor, description);

  return {
    type: assertEnumValue(actor.type, OPENMAS_OS_ACTOR_TYPES, `${description} type`),
    id: assertSafeIdentifier(actor.id, `${description} id`),
  };
}

function assertNullableTargetRef(targetRef, description) {
  if (targetRef === undefined || targetRef === null) {
    return null;
  }

  assertPlainObject(targetRef, description);

  return {
    type: assertEnumValue(targetRef.type, OPENMAS_OS_TARGET_TYPES, `${description} type`),
    id: assertSafeIdentifier(targetRef.id, `${description} id`),
  };
}

function assertJobProgram(program, description) {
  assertPlainObject(program, description);

  const programType = assertEnumValue(program.type, OPENMAS_OS_PROGRAM_TYPES, `${description} type`);

  const normalizedProgram = {
    type: programType,
  };

  if (programType === 'agent_invocation') {
    if (Object.hasOwn(program, 'agentId')) {
      throw new Error(`${description} must not include agentId. Agent invocation Jobs are assigned to an Operational Identity; Cognitive Identity is resolved during execution.`);
    }

    normalizedProgram.command = isNonEmptyString(program.command)
      ? program.command.trim()
      : 'ask';
    normalizedProgram.mode = assertEnumValue(
      program.mode ?? 'deterministic',
      OPENMAS_OS_AGENT_INVOCATION_MODES,
      `${description} mode`,
    );
  } else {
    normalizedProgram.programId = assertSafeIdentifier(program.programId, `${description} programId`);
  }

  return assertSafeOsSerializableValue(normalizedProgram, description);
}

function assertInputRef(inputRef, description) {
  assertPlainObject(inputRef, description);

  const inputRefType = assertEnumValue(inputRef.type, OPENMAS_OS_INPUT_REF_TYPES, `${description} type`);

  const normalizedInputRef = {
    type: inputRefType,
  };

  if (inputRefType === 'inline_text') {
    normalizedInputRef.text = assertNullableString(inputRef.text, `${description} text`) ?? '';
  } else if (inputRefType !== 'none') {
    normalizedInputRef.refId = assertSafeIdentifier(inputRef.refId, `${description} refId`);
  }

  return normalizedInputRef;
}

function assertJobTrigger(trigger, description) {
  assertPlainObject(trigger, description);

  const triggerType = assertEnumValue(trigger.type, OPENMAS_OS_TRIGGER_TYPES, `${description} type`);

  const normalizedTrigger = {
    type: triggerType,
  };

  if (triggerType === 'scheduled_once') {
    normalizedTrigger.runAt = assertNullableString(trigger.runAt, `${description} runAt`);

    if (normalizedTrigger.runAt === null) {
      throw new Error(`${description} runAt must be provided for scheduled_once triggers.`);
    }
  }

  if (triggerType === 'recurring') {
    normalizedTrigger.intervalMs = assertIntegerInRange(
      trigger.intervalMs,
      `${description} intervalMs`,
      { min: 1 },
    );
  }

  if (triggerType === 'event_driven') {
    normalizedTrigger.eventType = assertSafeEventType(trigger.eventType, `${description} eventType`);
  }

  return normalizedTrigger;
}

function assertJobPolicies(policies, description) {
  const effectivePolicies = policies ?? {};

  assertPlainObject(effectivePolicies, description);
  assertSafeOsSerializableValue(effectivePolicies, description);

  const normalizedPolicies = {};

  normalizedPolicies.requiresApproval = assertOptionalBoolean(
    effectivePolicies.requiresApproval,
    `${description} requiresApproval`,
    false,
  );
  normalizedPolicies.maxAttempts = effectivePolicies.maxAttempts === undefined
    ? 1
    : assertIntegerInRange(effectivePolicies.maxAttempts, `${description} maxAttempts`, { min: 1 });
  normalizedPolicies.noOverlap = assertOptionalBoolean(effectivePolicies.noOverlap, `${description} noOverlap`, false);

  if (effectivePolicies.missedRunPolicy !== undefined && effectivePolicies.missedRunPolicy !== null) {
    normalizedPolicies.missedRunPolicy = assertEnumValue(
      effectivePolicies.missedRunPolicy,
      OPENMAS_OS_MISSED_RUN_POLICIES,
      `${description} missedRunPolicy`,
    );
  } else {
    normalizedPolicies.missedRunPolicy = null;
  }

  return normalizedPolicies;
}

export function assertSafeOsSerializableValue(value, description = 'OpenMAS OS value', depth = 0) {
  if (depth > 8) {
    throw new Error(`${description} exceeds the maximum safe serialization depth.`);
  }

  if (value === null || typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`${description} must be a finite number.`);
    }

    return value;
  }

  if (typeof value === 'string') {
    if (containsSecretLikeValue(value)) {
      throw new Error(`${description} contains a secret-like value and cannot be persisted in OpenMAS OS state.`);
    }

    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry, index) => {
      return assertSafeOsSerializableValue(entry, `${description}[${index}]`, depth + 1);
    });
  }

  if (isPlainObject(value)) {
    const normalizedValue = {};

    for (const [key, entry] of Object.entries(value)) {
      if (isUnsafeSecretFieldName(key)) {
        throw new Error(`${description}.${key} is a raw secret-like field and cannot be persisted in OpenMAS OS state.`);
      }

      normalizedValue[key] = assertSafeOsSerializableValue(entry, `${description}.${key}`, depth + 1);
    }

    return normalizedValue;
  }

  throw new Error(`${description} must be JSON-serializable.`);
}

function assertNullableFailureSummary(value, description) {
  if (value === undefined || value === null) {
    return null;
  }

  assertPlainObject(value, description);

  return assertSafeOsSerializableValue(value, description);
}

export function assertOpenMasOsJob(job) {
  assertPlainObject(job, 'OpenMAS OS Job');

  return {
    kind: assertKind(job.kind, OPENMAS_OS_KINDS.job, 'OpenMAS OS Job'),
    schemaVersion: assertSchemaVersion(job.schemaVersion, 'OpenMAS OS Job'),
    jobId: assertSafeIdentifier(job.jobId, 'OpenMAS OS Job jobId'),
    projectId: assertSafeIdentifier(job.projectId, 'OpenMAS OS Job projectId'),
    status: assertEnumValue(job.status, OPENMAS_OS_JOB_STATUSES, 'OpenMAS OS Job status'),
    createdBy: assertActor(job.createdBy, 'OpenMAS OS Job createdBy'),
    assignedOperationalIdentityId: assertSafeIdentifier(
      job.assignedOperationalIdentityId,
      'OpenMAS OS Job assignedOperationalIdentityId',
    ),
    program: assertJobProgram(job.program, 'OpenMAS OS Job program'),
    inputRef: assertInputRef(job.inputRef, 'OpenMAS OS Job inputRef'),
    conversationId: assertNullableSafeIdentifier(job.conversationId, 'OpenMAS OS Job conversationId'),
    trigger: assertJobTrigger(job.trigger, 'OpenMAS OS Job trigger'),
    priority: assertIntegerInRange(job.priority ?? 50, 'OpenMAS OS Job priority', { min: 0, max: 1000000 }),
    policies: assertJobPolicies(job.policies, 'OpenMAS OS Job policies'),
    createdAt: assertRequiredString(job.createdAt, 'OpenMAS OS Job createdAt'),
    updatedAt: assertRequiredString(job.updatedAt, 'OpenMAS OS Job updatedAt'),
    failedAt: assertNullableString(job.failedAt, 'OpenMAS OS Job failedAt'),
    failureSummary: assertNullableFailureSummary(job.failureSummary, 'OpenMAS OS Job failureSummary'),
  };
}

export function assertOpenMasOsProcess(processState) {
  assertPlainObject(processState, 'OpenMAS OS Process');

  const normalizedProcess = {
    kind: assertKind(processState.kind, OPENMAS_OS_KINDS.process, 'OpenMAS OS Process'),
    schemaVersion: assertSchemaVersion(processState.schemaVersion, 'OpenMAS OS Process'),
    processId: assertSafeIdentifier(processState.processId, 'OpenMAS OS Process processId'),
    jobId: assertSafeIdentifier(processState.jobId, 'OpenMAS OS Process jobId'),
    status: assertEnumValue(processState.status, OPENMAS_OS_PROCESS_STATUSES, 'OpenMAS OS Process status'),
    operationalIdentityId: assertSafeIdentifier(
      processState.operationalIdentityId,
      'OpenMAS OS Process operationalIdentityId',
    ),
    activeCognitiveIdentityId: assertNullableSafeIdentifier(
      processState.activeCognitiveIdentityId,
      'OpenMAS OS Process activeCognitiveIdentityId',
    ),
    currentThreadId: assertNullableSafeIdentifier(processState.currentThreadId, 'OpenMAS OS Process currentThreadId'),
    parentProcessId: assertNullableSafeIdentifier(processState.parentProcessId, 'OpenMAS OS Process parentProcessId'),
    childProcessIds: assertStringArray(processState.childProcessIds ?? [], 'OpenMAS OS Process childProcessIds'),
    conversationId: assertNullableSafeIdentifier(processState.conversationId, 'OpenMAS OS Process conversationId'),
    memoryContextRefs: assertSafeReferenceArray(processState.memoryContextRefs ?? [], 'OpenMAS OS Process memoryContextRefs'),
    artifactRefs: assertSafeReferenceArray(processState.artifactRefs ?? [], 'OpenMAS OS Process artifactRefs'),
    credentialReferenceIds: assertStringArray(processState.credentialReferenceIds ?? [], 'OpenMAS OS Process credentialReferenceIds'),
    pendingApprovalRefs: assertStringArray(processState.pendingApprovalRefs ?? [], 'OpenMAS OS Process pendingApprovalRefs'),
    warnings: assertSafeStringArray(processState.warnings ?? [], 'OpenMAS OS Process warnings'),
    createdAt: assertRequiredString(processState.createdAt, 'OpenMAS OS Process createdAt'),
    startedAt: assertNullableString(processState.startedAt, 'OpenMAS OS Process startedAt'),
    updatedAt: assertRequiredString(processState.updatedAt, 'OpenMAS OS Process updatedAt'),
    completedAt: assertNullableString(processState.completedAt, 'OpenMAS OS Process completedAt'),
    failedAt: assertNullableString(processState.failedAt, 'OpenMAS OS Process failedAt'),
    failureSummary: assertNullableFailureSummary(
      processState.failureSummary,
      'OpenMAS OS Process failureSummary',
    ),
  };

  if (OPENMAS_OS_TERMINAL_PROCESS_STATUSES.has(normalizedProcess.status) && normalizedProcess.currentThreadId !== null) {
    throw new Error(`OpenMAS OS Process with terminal status "${normalizedProcess.status}" must not include currentThreadId.`);
  }

  return normalizedProcess;
}

export function assertOpenMasOsThread(thread) {
  assertPlainObject(thread, 'OpenMAS OS Thread');

  const normalizedThread = {
    kind: assertKind(thread.kind, OPENMAS_OS_KINDS.thread, 'OpenMAS OS Thread'),
    schemaVersion: assertSchemaVersion(thread.schemaVersion, 'OpenMAS OS Thread'),
    threadId: assertSafeIdentifier(thread.threadId, 'OpenMAS OS Thread threadId'),
    processId: assertSafeIdentifier(thread.processId, 'OpenMAS OS Thread processId'),
    jobId: assertSafeIdentifier(thread.jobId, 'OpenMAS OS Thread jobId'),
    status: assertEnumValue(thread.status, OPENMAS_OS_THREAD_STATUSES, 'OpenMAS OS Thread status'),
    threadType: assertEnumValue(thread.threadType, OPENMAS_OS_THREAD_TYPES, 'OpenMAS OS Thread threadType'),
    priority: assertIntegerInRange(thread.priority ?? 50, 'OpenMAS OS Thread priority', { min: 0, max: 1000000 }),
    attempt: assertIntegerInRange(thread.attempt ?? 1, 'OpenMAS OS Thread attempt', { min: 1 }),
    waitReason: thread.waitReason === undefined || thread.waitReason === null || thread.waitReason === ''
      ? null
      : assertEnumValue(thread.waitReason, OPENMAS_OS_WAIT_REASONS, 'OpenMAS OS Thread waitReason'),
    dueAt: assertNullableString(thread.dueAt, 'OpenMAS OS Thread dueAt'),
    createdAt: assertRequiredString(thread.createdAt, 'OpenMAS OS Thread createdAt'),
    startedAt: assertNullableString(thread.startedAt, 'OpenMAS OS Thread startedAt'),
    updatedAt: assertRequiredString(thread.updatedAt, 'OpenMAS OS Thread updatedAt'),
    completedAt: assertNullableString(thread.completedAt, 'OpenMAS OS Thread completedAt'),
    failedAt: assertNullableString(thread.failedAt, 'OpenMAS OS Thread failedAt'),
    failureSummary: assertNullableFailureSummary(thread.failureSummary, 'OpenMAS OS Thread failureSummary'),
  };

  if (normalizedThread.status === 'blocked' && normalizedThread.waitReason === null) {
    throw new Error('OpenMAS OS Thread with status "blocked" must include waitReason.');
  }

  return normalizedThread;
}

export function assertOpenMasOsEvent(event) {
  assertPlainObject(event, 'OpenMAS OS Event');

  return {
    kind: assertKind(event.kind, OPENMAS_OS_KINDS.event, 'OpenMAS OS Event'),
    schemaVersion: assertSchemaVersion(event.schemaVersion, 'OpenMAS OS Event'),
    eventId: assertSafeIdentifier(event.eventId, 'OpenMAS OS Event eventId'),
    eventType: assertSafeEventType(event.eventType, 'OpenMAS OS Event eventType'),
    source: assertActor(event.source, 'OpenMAS OS Event source'),
    targetRef: assertNullableTargetRef(event.targetRef, 'OpenMAS OS Event targetRef'),
    jobId: assertNullableSafeIdentifier(event.jobId, 'OpenMAS OS Event jobId'),
    processId: assertNullableSafeIdentifier(event.processId, 'OpenMAS OS Event processId'),
    threadId: assertNullableSafeIdentifier(event.threadId, 'OpenMAS OS Event threadId'),
    occurredAt: assertRequiredString(event.occurredAt, 'OpenMAS OS Event occurredAt'),
    payload: assertSafeOsSerializableValue(event.payload ?? {}, 'OpenMAS OS Event payload'),
  };
}

export function assertOpenMasOsSignal(signal) {
  assertPlainObject(signal, 'OpenMAS OS Signal');

  return {
    kind: assertKind(signal.kind, OPENMAS_OS_KINDS.signal, 'OpenMAS OS Signal'),
    schemaVersion: assertSchemaVersion(signal.schemaVersion, 'OpenMAS OS Signal'),
    signalId: assertSafeIdentifier(signal.signalId, 'OpenMAS OS Signal signalId'),
    signalType: assertEnumValue(signal.signalType, OPENMAS_OS_SIGNAL_TYPES, 'OpenMAS OS Signal signalType'),
    targetType: assertEnumValue(signal.targetType, OPENMAS_OS_TARGET_TYPES, 'OpenMAS OS Signal targetType'),
    targetId: assertSafeIdentifier(signal.targetId, 'OpenMAS OS Signal targetId'),
    createdBy: assertActor(signal.createdBy, 'OpenMAS OS Signal createdBy'),
    createdAt: assertRequiredString(signal.createdAt, 'OpenMAS OS Signal createdAt'),
    reason: assertNullableString(signal.reason, 'OpenMAS OS Signal reason'),
    payload: assertSafeOsSerializableValue(signal.payload ?? {}, 'OpenMAS OS Signal payload'),
  };
}

export {
  OPENMAS_OS_SCHEMA_VERSION,
  OPENMAS_OS_KINDS,
  OPENMAS_OS_JOB_STATUSES,
  OPENMAS_OS_PROCESS_STATUSES,
  OPENMAS_OS_TERMINAL_PROCESS_STATUSES,
  OPENMAS_OS_THREAD_STATUSES,
  OPENMAS_OS_THREAD_TYPES,
  OPENMAS_OS_PROGRAM_TYPES,
  OPENMAS_OS_AGENT_INVOCATION_MODES,
  OPENMAS_OS_TRIGGER_TYPES,
  OPENMAS_OS_INPUT_REF_TYPES,
  OPENMAS_OS_ACTOR_TYPES,
  OPENMAS_OS_TARGET_TYPES,
  OPENMAS_OS_SIGNAL_TYPES,
  OPENMAS_OS_WAIT_REASONS,
  OPENMAS_OS_MISSED_RUN_POLICIES,
};
