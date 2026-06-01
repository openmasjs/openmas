import {
  OPENMAS_OS_AGENT_INVOCATION_MODES,
  OPENMAS_OS_INPUT_REF_TYPES,
  OPENMAS_OS_MISSED_RUN_POLICIES,
  OPENMAS_OS_PROGRAM_TYPES,
  OPENMAS_OS_SIGNAL_TYPES,
  OPENMAS_OS_TARGET_TYPES,
  assertSafeOsSerializableValue,
} from './openmas-os-runtime-contract.js';

const OPENMAS_OS_SYSTEM_CALL_SCHEMA_VERSION = 1;

const OPENMAS_OS_SYSTEM_CALL_KINDS = Object.freeze({
  systemCall: 'openmas_os_system_call',
  result: 'openmas_os_system_call_result',
});

const OPENMAS_OS_SYSTEM_CALL_OPERATIONS = new Set([
  'submit_job',
  'schedule_job',
  'delegate',
  'schedule_delegation',
  'signal',
  'cancel_job',
  'inspect_status',
]);

const OPENMAS_OS_SYSTEM_CALL_RESULT_OPERATIONS = new Set([
  ...OPENMAS_OS_SYSTEM_CALL_OPERATIONS,
  'invalid_request',
]);

const OPENMAS_OS_SYSTEM_CALL_STATUSES = new Set([
  'pending',
  'processing',
  'completed',
  'denied',
  'failed',
  'expired',
  'cancelled',
]);

const OPENMAS_OS_SYSTEM_CALL_RESULT_STATUSES = new Set([
  'accepted',
  'completed',
  'denied',
  'failed',
  'expired',
  'cancelled',
]);

const OPENMAS_OS_SYSTEM_CALL_PRINCIPAL_TYPES = new Set([
  'human',
  'operational_identity',
  'process',
  'system',
  'admin_cli',
  'tool_runtime',
  'workflow_runtime',
  'external_adapter',
]);

const OPENMAS_OS_SYSTEM_CALL_INSPECT_SCOPES = new Set([
  'service',
  'job',
  'process',
  'thread',
  'timer',
  'signal',
  'system_call',
  'queue',
]);

const OPENMAS_OS_SYSTEM_CALL_MUTATING_OPERATIONS = new Set([
  'submit_job',
  'schedule_job',
  'delegate',
  'schedule_delegation',
  'signal',
  'cancel_job',
]);

const OPENMAS_OS_SYSTEM_CALL_EMPTY_EFFECT_STATUSES = new Set([
  'denied',
  'failed',
  'expired',
  'cancelled',
]);

const SAFE_OPENMAS_OS_SYSTEM_CALL_IDENTIFIER_PATTERN = /^[a-zA-Z0-9._-]+$/u;
const SAFE_OPENMAS_OS_SYSTEM_CALL_IDEMPOTENCY_KEY_PATTERN = /^[a-zA-Z0-9._:-]+$/u;
const ISO_TIMESTAMP_WITH_ZONE_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/u;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function assertPlainObject(value, description) {
  if (!isPlainObject(value)) {
    throw new Error(`${description} must be an object.`);
  }

  return value;
}

function assertRequiredString(value, description) {
  if (!isNonEmptyString(value)) {
    throw new Error(`${description} must be a non-empty string.`);
  }

  return value.trim();
}

function assertNullableString(value, description) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  return assertRequiredString(value, description);
}

function assertSafeIdentifier(value, description) {
  const normalizedValue = assertRequiredString(value, description);

  if (!SAFE_OPENMAS_OS_SYSTEM_CALL_IDENTIFIER_PATTERN.test(normalizedValue)) {
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

function assertIdempotencyKey(value, description) {
  const normalizedValue = assertRequiredString(value, description);

  if (normalizedValue.length > 256) {
    throw new Error(`${description} must be 256 characters or less.`);
  }

  if (!SAFE_OPENMAS_OS_SYSTEM_CALL_IDEMPOTENCY_KEY_PATTERN.test(normalizedValue)) {
    throw new Error(`${description} contains unsafe characters: ${normalizedValue}`);
  }

  return normalizedValue;
}

function assertNullableIdempotencyKey(value, description) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  return assertIdempotencyKey(value, description);
}

function assertEnumValue(value, allowedValues, description) {
  const normalizedValue = assertRequiredString(value, description);

  if (!allowedValues.has(normalizedValue)) {
    throw new Error(`${description} is invalid: ${normalizedValue}`);
  }

  return normalizedValue;
}

function assertSchemaVersion(value, description) {
  if (!Number.isInteger(value) || value < OPENMAS_OS_SYSTEM_CALL_SCHEMA_VERSION) {
    throw new Error(`${description} must include an integer schemaVersion greater than or equal to ${OPENMAS_OS_SYSTEM_CALL_SCHEMA_VERSION}.`);
  }

  return value;
}

function assertIntegerInRange(value, description, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) {
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

function assertExplicitTimestamp(value, description) {
  const normalizedValue = assertRequiredString(value, description);

  if (!ISO_TIMESTAMP_WITH_ZONE_PATTERN.test(normalizedValue)) {
    throw new Error(`${description} must be an explicit ISO timestamp with timezone offset or Z.`);
  }

  const timestamp = Date.parse(normalizedValue);

  if (Number.isNaN(timestamp)) {
    throw new Error(`${description} must be a valid timestamp.`);
  }

  return normalizedValue;
}

function assertNullableExplicitTimestamp(value, description) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  return assertExplicitTimestamp(value, description);
}

function assertSafeReferenceArray(values, description) {
  if (values === undefined || values === null) {
    return [];
  }

  if (!Array.isArray(values)) {
    throw new Error(`${description} must be an array.`);
  }

  return values.map((value, index) => {
    assertPlainObject(value, `${description}[${index}]`);
    return assertSafeOsSerializableValue(value, `${description}[${index}]`);
  });
}

function assertSafeStringArray(values, description) {
  if (values === undefined || values === null) {
    return [];
  }

  if (!Array.isArray(values)) {
    throw new Error(`${description} must be an array.`);
  }

  return values.map((value, index) => {
    return assertRequiredString(value, `${description}[${index}]`);
  });
}

function assertSafeIdentifierArray(values, description) {
  if (values === undefined || values === null) {
    return [];
  }

  if (!Array.isArray(values)) {
    throw new Error(`${description} must be an array.`);
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

function assertPrincipal(principal, description) {
  assertPlainObject(principal, description);

  const type = assertEnumValue(
    principal.type,
    OPENMAS_OS_SYSTEM_CALL_PRINCIPAL_TYPES,
    `${description} type`,
  );
  const id = assertSafeIdentifier(
    principal.id
      ?? principal.operationalIdentityId
      ?? principal.processId
      ?? principal.serviceId
      ?? principal.externalAdapterId,
    `${description} id`,
  );

  return {
    type,
    id,
  };
}

function assertCorrelation(correlation) {
  if (correlation === undefined || correlation === null) {
    return {
      invocationId: null,
      actionRequestId: null,
      toolRunId: null,
      workflowRunId: null,
      conversationId: null,
      jobId: null,
      processId: null,
      threadId: null,
    };
  }

  assertPlainObject(correlation, 'OpenMAS OS System Call correlation');

  return {
    invocationId: assertNullableSafeIdentifier(correlation.invocationId, 'OpenMAS OS System Call correlation invocationId'),
    actionRequestId: assertNullableSafeIdentifier(correlation.actionRequestId, 'OpenMAS OS System Call correlation actionRequestId'),
    toolRunId: assertNullableSafeIdentifier(correlation.toolRunId, 'OpenMAS OS System Call correlation toolRunId'),
    workflowRunId: assertNullableSafeIdentifier(correlation.workflowRunId, 'OpenMAS OS System Call correlation workflowRunId'),
    conversationId: assertNullableSafeIdentifier(correlation.conversationId, 'OpenMAS OS System Call correlation conversationId'),
    jobId: assertNullableSafeIdentifier(correlation.jobId, 'OpenMAS OS System Call correlation jobId'),
    processId: assertNullableSafeIdentifier(correlation.processId, 'OpenMAS OS System Call correlation processId'),
    threadId: assertNullableSafeIdentifier(correlation.threadId, 'OpenMAS OS System Call correlation threadId'),
  };
}

function assertJobProgram(program, description) {
  assertPlainObject(program, description);

  const programType = assertEnumValue(program.type ?? 'agent_invocation', OPENMAS_OS_PROGRAM_TYPES, `${description} type`);
  const normalizedProgram = {
    type: programType,
  };

  if (programType === 'agent_invocation') {
    if (Object.hasOwn(program, 'agentId')) {
      throw new Error(`${description} must not include agentId. Agent invocation Jobs are assigned to an Operational Identity; Cognitive Identity is resolved during execution.`);
    }

    normalizedProgram.command = assertSafeIdentifier(program.command ?? 'ask', `${description} command`);
    normalizedProgram.mode = assertEnumValue(
      program.mode ?? 'deterministic',
      OPENMAS_OS_AGENT_INVOCATION_MODES,
      `${description} mode`,
    );
  } else {
    normalizedProgram.programId = assertSafeIdentifier(program.programId, `${description} programId`);
  }

  return normalizedProgram;
}

function assertInputRef(inputRef, description) {
  assertPlainObject(inputRef, description);

  const inputRefType = assertEnumValue(inputRef.type ?? 'none', OPENMAS_OS_INPUT_REF_TYPES, `${description} type`);
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

function assertChildInvocation(child, description) {
  assertPlainObject(child, description);

  if (Object.hasOwn(child, 'agentId')) {
    throw new Error(`${description} must not include agentId. Delegation targets an Operational Identity; Cognitive Identity is resolved during execution.`);
  }

  return {
    command: assertSafeIdentifier(child.command ?? 'ask', `${description} command`),
    mode: assertEnumValue(
      child.mode ?? 'probabilistic',
      OPENMAS_OS_AGENT_INVOCATION_MODES,
      `${description} mode`,
    ),
    input: assertRequiredString(child.input, `${description} input`),
    conversationId: assertNullableSafeIdentifier(child.conversationId, `${description} conversationId`),
    priority: child.priority === undefined || child.priority === null
      ? 50
      : assertIntegerInRange(child.priority, `${description} priority`, { min: 0, max: 1000000 }),
    contextRefs: assertSafeReferenceArray(child.contextRefs, `${description} contextRefs`),
    artifactRefs: assertSafeReferenceArray(child.artifactRefs, `${description} artifactRefs`),
    expectedOutput: child.expectedOutput === undefined || child.expectedOutput === null
      ? null
      : assertSafeOsSerializableValue(child.expectedOutput, `${description} expectedOutput`),
  };
}

function assertSubmitJobPayload(payload, description) {
  assertPlainObject(payload, description);

  return {
    assignedOperationalIdentityId: assertSafeIdentifier(
      payload.assignedOperationalIdentityId,
      `${description} assignedOperationalIdentityId`,
    ),
    program: assertJobProgram(payload.program ?? {}, `${description} program`),
    inputRef: assertInputRef(payload.inputRef ?? { type: 'none' }, `${description} inputRef`),
    conversationId: assertNullableSafeIdentifier(payload.conversationId, `${description} conversationId`),
    priority: payload.priority === undefined || payload.priority === null
      ? 50
      : assertIntegerInRange(payload.priority, `${description} priority`, { min: 0, max: 1000000 }),
    policies: payload.policies === undefined || payload.policies === null
      ? {}
      : assertSafeOsSerializableValue(payload.policies, `${description} policies`),
  };
}

function assertScheduleJobPayload(payload) {
  const normalizedPayload = assertSubmitJobPayload(payload, 'OpenMAS OS System Call schedule_job payload');

  return {
    ...normalizedPayload,
    runAt: assertExplicitTimestamp(payload.runAt, 'OpenMAS OS System Call schedule_job payload runAt'),
    missedRunPolicy: payload.missedRunPolicy === undefined || payload.missedRunPolicy === null
      ? 'delay'
      : assertEnumValue(
        payload.missedRunPolicy,
        OPENMAS_OS_MISSED_RUN_POLICIES,
        'OpenMAS OS System Call schedule_job payload missedRunPolicy',
      ),
  };
}

function assertDelegatePayload(payload, description) {
  assertPlainObject(payload, description);

  return {
    requesterOperationalIdentityId: assertSafeIdentifier(
      payload.requesterOperationalIdentityId,
      `${description} requesterOperationalIdentityId`,
    ),
    targetOperationalIdentityId: assertSafeIdentifier(
      payload.targetOperationalIdentityId,
      `${description} targetOperationalIdentityId`,
    ),
    reason: assertNullableString(payload.reason, `${description} reason`),
    parentContext: payload.parentContext === undefined || payload.parentContext === null
      ? null
      : assertSafeOsSerializableValue(payload.parentContext, `${description} parentContext`),
    child: assertChildInvocation(payload.child, `${description} child`),
  };
}

function assertScheduleDelegationPayload(payload) {
  const normalizedPayload = assertDelegatePayload(
    payload,
    'OpenMAS OS System Call schedule_delegation payload',
  );

  return {
    ...normalizedPayload,
    runAt: assertExplicitTimestamp(payload.runAt, 'OpenMAS OS System Call schedule_delegation payload runAt'),
    missedRunPolicy: payload.missedRunPolicy === undefined || payload.missedRunPolicy === null
      ? 'delay'
      : assertEnumValue(
        payload.missedRunPolicy,
        OPENMAS_OS_MISSED_RUN_POLICIES,
        'OpenMAS OS System Call schedule_delegation payload missedRunPolicy',
      ),
  };
}

function assertSignalPayload(payload) {
  assertPlainObject(payload, 'OpenMAS OS System Call signal payload');

  return {
    signalType: assertEnumValue(
      payload.signalType,
      OPENMAS_OS_SIGNAL_TYPES,
      'OpenMAS OS System Call signal payload signalType',
    ),
    targetType: assertEnumValue(
      payload.targetType,
      OPENMAS_OS_TARGET_TYPES,
      'OpenMAS OS System Call signal payload targetType',
    ),
    targetId: assertSafeIdentifier(payload.targetId, 'OpenMAS OS System Call signal payload targetId'),
    reason: assertNullableString(payload.reason, 'OpenMAS OS System Call signal payload reason'),
    payload: payload.payload === undefined || payload.payload === null
      ? {}
      : assertSafeOsSerializableValue(payload.payload, 'OpenMAS OS System Call signal payload payload'),
  };
}

function assertCancelJobPayload(payload) {
  assertPlainObject(payload, 'OpenMAS OS System Call cancel_job payload');

  return {
    jobId: assertSafeIdentifier(payload.jobId, 'OpenMAS OS System Call cancel_job payload jobId'),
    reason: assertNullableString(payload.reason, 'OpenMAS OS System Call cancel_job payload reason'),
  };
}

function assertInspectStatusPayload(payload) {
  const effectivePayload = payload ?? {};
  assertPlainObject(effectivePayload, 'OpenMAS OS System Call inspect_status payload');

  const scope = assertEnumValue(
    effectivePayload.scope ?? 'service',
    OPENMAS_OS_SYSTEM_CALL_INSPECT_SCOPES,
    'OpenMAS OS System Call inspect_status payload scope',
  );
  const targetId = assertNullableSafeIdentifier(
    effectivePayload.targetId,
    'OpenMAS OS System Call inspect_status payload targetId',
  );

  if (!['service', 'queue'].includes(scope) && targetId === null) {
    throw new Error(`OpenMAS OS System Call inspect_status payload targetId is required for scope "${scope}".`);
  }

  return {
    scope,
    targetId,
    includeRecentResults: assertOptionalBoolean(
      effectivePayload.includeRecentResults,
      'OpenMAS OS System Call inspect_status payload includeRecentResults',
      false,
    ),
  };
}

function assertSystemCallPayload({ operation, payload }) {
  const safePayload = assertSafeOsSerializableValue(
    payload ?? {},
    `OpenMAS OS System Call ${operation} payload`,
  );

  if (operation === 'submit_job') {
    return assertSubmitJobPayload(safePayload, 'OpenMAS OS System Call submit_job payload');
  }

  if (operation === 'schedule_job') {
    return assertScheduleJobPayload(safePayload);
  }

  if (operation === 'delegate') {
    return assertDelegatePayload(safePayload, 'OpenMAS OS System Call delegate payload');
  }

  if (operation === 'schedule_delegation') {
    return assertScheduleDelegationPayload(safePayload);
  }

  if (operation === 'signal') {
    return assertSignalPayload(safePayload);
  }

  if (operation === 'cancel_job') {
    return assertCancelJobPayload(safePayload);
  }

  if (operation === 'inspect_status') {
    return assertInspectStatusPayload(safePayload);
  }

  throw new Error(`OpenMAS OS System Call operation is unsupported: ${operation}`);
}

function assertProcessedBy(processedBy) {
  assertPlainObject(processedBy, 'OpenMAS OS System Call Result processedBy');

  return {
    serviceId: assertSafeIdentifier(processedBy.serviceId, 'OpenMAS OS System Call Result processedBy serviceId'),
    tickId: assertNullableSafeIdentifier(processedBy.tickId, 'OpenMAS OS System Call Result processedBy tickId'),
  };
}

function assertDecision(decision) {
  assertPlainObject(decision, 'OpenMAS OS System Call Result decision');

  if (typeof decision.allowed !== 'boolean') {
    throw new Error('OpenMAS OS System Call Result decision allowed must be a boolean.');
  }

  return {
    allowed: decision.allowed,
    reason: assertRequiredString(decision.reason, 'OpenMAS OS System Call Result decision reason'),
    policyRefs: assertSafeReferenceArray(decision.policyRefs, 'OpenMAS OS System Call Result decision policyRefs'),
  };
}

function assertSystemCallEffects(effects) {
  const effectiveEffects = effects ?? {};
  assertPlainObject(effectiveEffects, 'OpenMAS OS System Call Result effects');

  return {
    createdJobIds: assertSafeIdentifierArray(
      effectiveEffects.createdJobIds,
      'OpenMAS OS System Call Result effects createdJobIds',
    ),
    createdTimerIds: assertSafeIdentifierArray(
      effectiveEffects.createdTimerIds,
      'OpenMAS OS System Call Result effects createdTimerIds',
    ),
    createdSignalIds: assertSafeIdentifierArray(
      effectiveEffects.createdSignalIds,
      'OpenMAS OS System Call Result effects createdSignalIds',
    ),
    createdProcessIds: assertSafeIdentifierArray(
      effectiveEffects.createdProcessIds,
      'OpenMAS OS System Call Result effects createdProcessIds',
    ),
    createdThreadIds: assertSafeIdentifierArray(
      effectiveEffects.createdThreadIds,
      'OpenMAS OS System Call Result effects createdThreadIds',
    ),
    eventIds: assertSafeIdentifierArray(
      effectiveEffects.eventIds,
      'OpenMAS OS System Call Result effects eventIds',
    ),
  };
}

function hasCreatedEffects(effects) {
  return Object.values(effects).some((values) => values.length > 0);
}

function assertResultDecisionMatchesStatus({ status, operation, decision, effects }) {
  if (['accepted', 'completed'].includes(status) && decision.allowed !== true) {
    throw new Error(`OpenMAS OS System Call Result with status "${status}" must include decision.allowed=true.`);
  }

  if (['denied', 'expired', 'cancelled'].includes(status) && decision.allowed !== false) {
    throw new Error(`OpenMAS OS System Call Result with status "${status}" must include decision.allowed=false.`);
  }

  if (operation === 'invalid_request' && ['accepted', 'completed'].includes(status)) {
    throw new Error(`OpenMAS OS System Call Result operation "invalid_request" cannot use status "${status}".`);
  }

  if (OPENMAS_OS_SYSTEM_CALL_EMPTY_EFFECT_STATUSES.has(status) && hasCreatedEffects(effects)) {
    throw new Error(`OpenMAS OS System Call Result with status "${status}" must not include created effects.`);
  }
}

export function assertOpenMasOsSystemCall(systemCall) {
  assertPlainObject(systemCall, 'OpenMAS OS System Call');

  const safeSystemCall = assertSafeOsSerializableValue(systemCall, 'OpenMAS OS System Call');
  const operation = assertEnumValue(
    safeSystemCall.operation,
    OPENMAS_OS_SYSTEM_CALL_OPERATIONS,
    'OpenMAS OS System Call operation',
  );
  const requestedAt = assertExplicitTimestamp(safeSystemCall.requestedAt, 'OpenMAS OS System Call requestedAt');
  const expiresAt = assertNullableExplicitTimestamp(safeSystemCall.expiresAt, 'OpenMAS OS System Call expiresAt');
  const idempotencyKey = assertNullableIdempotencyKey(
    safeSystemCall.idempotencyKey,
    'OpenMAS OS System Call idempotencyKey',
  );

  if (OPENMAS_OS_SYSTEM_CALL_MUTATING_OPERATIONS.has(operation) && idempotencyKey === null) {
    throw new Error(`OpenMAS OS System Call operation "${operation}" must include idempotencyKey.`);
  }

  if (expiresAt !== null && Date.parse(expiresAt) <= Date.parse(requestedAt)) {
    throw new Error('OpenMAS OS System Call expiresAt must be after requestedAt.');
  }

  return {
    kind: assertEnumValue(
      safeSystemCall.kind,
      new Set([OPENMAS_OS_SYSTEM_CALL_KINDS.systemCall]),
      'OpenMAS OS System Call kind',
    ),
    schemaVersion: assertSchemaVersion(safeSystemCall.schemaVersion, 'OpenMAS OS System Call'),
    systemCallId: assertSafeIdentifier(safeSystemCall.systemCallId, 'OpenMAS OS System Call systemCallId'),
    operation,
    status: assertEnumValue(
      safeSystemCall.status,
      OPENMAS_OS_SYSTEM_CALL_STATUSES,
      'OpenMAS OS System Call status',
    ),
    requestedAt,
    requestedBy: assertPrincipal(safeSystemCall.requestedBy, 'OpenMAS OS System Call requestedBy'),
    correlation: assertCorrelation(safeSystemCall.correlation),
    idempotencyKey,
    expiresAt,
    payload: assertSystemCallPayload({
      operation,
      payload: safeSystemCall.payload,
    }),
  };
}

export function assertOpenMasOsSystemCallResult(result) {
  assertPlainObject(result, 'OpenMAS OS System Call Result');

  const safeResult = assertSafeOsSerializableValue(result, 'OpenMAS OS System Call Result');
  const operation = assertEnumValue(
    safeResult.operation,
    OPENMAS_OS_SYSTEM_CALL_RESULT_OPERATIONS,
    'OpenMAS OS System Call Result operation',
  );
  const status = assertEnumValue(
    safeResult.status,
    OPENMAS_OS_SYSTEM_CALL_RESULT_STATUSES,
    'OpenMAS OS System Call Result status',
  );
  const decision = assertDecision(safeResult.decision);
  const effects = assertSystemCallEffects(safeResult.effects);

  assertResultDecisionMatchesStatus({
    status,
    operation,
    decision,
    effects,
  });

  return {
    kind: assertEnumValue(
      safeResult.kind,
      new Set([OPENMAS_OS_SYSTEM_CALL_KINDS.result]),
      'OpenMAS OS System Call Result kind',
    ),
    schemaVersion: assertSchemaVersion(safeResult.schemaVersion, 'OpenMAS OS System Call Result'),
    systemCallId: assertSafeIdentifier(
      safeResult.systemCallId,
      'OpenMAS OS System Call Result systemCallId',
    ),
    operation,
    status,
    processedAt: assertExplicitTimestamp(safeResult.processedAt, 'OpenMAS OS System Call Result processedAt'),
    processedBy: assertProcessedBy(safeResult.processedBy),
    decision,
    effects,
    summary: assertRequiredString(safeResult.summary, 'OpenMAS OS System Call Result summary'),
    correlation: assertCorrelation(safeResult.correlation),
    evidenceRefs: assertSafeReferenceArray(safeResult.evidenceRefs, 'OpenMAS OS System Call Result evidenceRefs'),
    warnings: assertSafeStringArray(safeResult.warnings, 'OpenMAS OS System Call Result warnings'),
    details: safeResult.details === undefined || safeResult.details === null
      ? {}
      : assertSafeOsSerializableValue(safeResult.details, 'OpenMAS OS System Call Result details'),
  };
}

export {
  OPENMAS_OS_SYSTEM_CALL_INSPECT_SCOPES,
  OPENMAS_OS_SYSTEM_CALL_KINDS,
  OPENMAS_OS_SYSTEM_CALL_MUTATING_OPERATIONS,
  OPENMAS_OS_SYSTEM_CALL_OPERATIONS,
  OPENMAS_OS_SYSTEM_CALL_PRINCIPAL_TYPES,
  OPENMAS_OS_SYSTEM_CALL_RESULT_OPERATIONS,
  OPENMAS_OS_SYSTEM_CALL_RESULT_STATUSES,
  OPENMAS_OS_SYSTEM_CALL_SCHEMA_VERSION,
  OPENMAS_OS_SYSTEM_CALL_STATUSES,
};
