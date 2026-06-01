import {
  assertSafeOsSerializableValue,
} from './openmas-os-runtime-contract.js';

const OPENMAS_OS_ACTION_SCHEMA_VERSION = 1;

const OPENMAS_OS_ACTION_KINDS = Object.freeze({
  request: 'openmas_os_action_request',
  result: 'openmas_os_action_result',
});

const OPENMAS_OS_ACTION_TYPES = new Set([
  'delegate',
  'schedule_delegation',
]);

const OPENMAS_OS_ACTION_RESULT_ACTION_TYPES = new Set([
  ...OPENMAS_OS_ACTION_TYPES,
  'invalid_request',
]);

const OPENMAS_OS_ACTION_RESULT_STATUSES = new Set([
  'accepted',
  'blocked',
  'rejected',
  'running',
  'completed',
  'failed',
  'cancelled',
]);

const OPENMAS_OS_ACTION_ACTOR_TYPES = new Set([
  'human',
  'operational_identity',
  'process',
  'system',
]);

const OPENMAS_OS_ACTION_INVOCATION_MODES = new Set([
  'deterministic',
  'probabilistic',
]);

const OPENMAS_OS_ACTION_MISSED_RUN_POLICIES = new Set([
  'skip',
  'delay',
  'run_latest',
]);

const SAFE_OPENMAS_OS_ACTION_IDENTIFIER_PATTERN = /^[a-zA-Z0-9._-]+$/u;
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

  if (!SAFE_OPENMAS_OS_ACTION_IDENTIFIER_PATTERN.test(normalizedValue)) {
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

function assertEnumValue(value, allowedValues, description) {
  const normalizedValue = assertRequiredString(value, description);

  if (!allowedValues.has(normalizedValue)) {
    throw new Error(`${description} is invalid: ${normalizedValue}`);
  }

  return normalizedValue;
}

function assertSchemaVersion(value, description) {
  if (!Number.isInteger(value) || value < OPENMAS_OS_ACTION_SCHEMA_VERSION) {
    throw new Error(`${description} must include an integer schemaVersion greater than or equal to ${OPENMAS_OS_ACTION_SCHEMA_VERSION}.`);
  }

  return value;
}

function assertIntegerInRange(value, description, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${description} must be an integer between ${min} and ${max}.`);
  }

  return value;
}

function assertActor(actor, description) {
  assertPlainObject(actor, description);

  return {
    type: assertEnumValue(actor.type, OPENMAS_OS_ACTION_ACTOR_TYPES, `${description} type`),
    id: assertSafeIdentifier(actor.id, `${description} id`),
  };
}

function assertParentContext(parentContext) {
  if (parentContext === undefined || parentContext === null) {
    return {
      jobId: null,
      processId: null,
      threadId: null,
    };
  }

  assertPlainObject(parentContext, 'OpenMAS OS Action Request parentContext');

  return {
    jobId: assertNullableSafeIdentifier(parentContext.jobId, 'OpenMAS OS Action Request parentContext jobId'),
    processId: assertNullableSafeIdentifier(parentContext.processId, 'OpenMAS OS Action Request parentContext processId'),
    threadId: assertNullableSafeIdentifier(parentContext.threadId, 'OpenMAS OS Action Request parentContext threadId'),
  };
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

function assertExplicitRunAt(value, description) {
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

function assertBaseDelegationPayload(payload, description) {
  assertPlainObject(payload, description);

  if (Object.hasOwn(payload, 'agentId')) {
    throw new Error(`${description} must not include agentId. Delegation targets an Operational Identity; Cognitive Identity is resolved during execution.`);
  }

  return {
    targetOperationalIdentityId: assertSafeIdentifier(
      payload.targetOperationalIdentityId,
      `${description} targetOperationalIdentityId`,
    ),
    task: assertRequiredString(payload.task, `${description} task`),
    command: assertRequiredString(payload.command ?? 'ask', `${description} command`),
    mode: assertEnumValue(
      payload.mode ?? 'probabilistic',
      OPENMAS_OS_ACTION_INVOCATION_MODES,
      `${description} mode`,
    ),
    priority: payload.priority === undefined || payload.priority === null
      ? 50
      : assertIntegerInRange(payload.priority, `${description} priority`, { min: 0, max: 1000000 }),
    reason: assertNullableString(payload.reason, `${description} reason`),
    contextRefs: assertSafeReferenceArray(payload.contextRefs, `${description} contextRefs`),
    artifactRefs: assertSafeReferenceArray(payload.artifactRefs, `${description} artifactRefs`),
    expectedOutput: payload.expectedOutput === undefined || payload.expectedOutput === null
      ? null
      : assertSafeOsSerializableValue(payload.expectedOutput, `${description} expectedOutput`),
  };
}

function assertDelegatePayload(payload) {
  return assertBaseDelegationPayload(payload, 'OpenMAS OS Action Request delegate payload');
}

function assertScheduleDelegationPayload(payload) {
  const normalizedPayload = assertBaseDelegationPayload(
    payload,
    'OpenMAS OS Action Request schedule_delegation payload',
  );

  return {
    ...normalizedPayload,
    runAt: assertExplicitRunAt(payload.runAt, 'OpenMAS OS Action Request schedule_delegation payload runAt'),
    missedRunPolicy: payload.missedRunPolicy === undefined || payload.missedRunPolicy === null
      ? 'skip'
      : assertEnumValue(
        payload.missedRunPolicy,
        OPENMAS_OS_ACTION_MISSED_RUN_POLICIES,
        'OpenMAS OS Action Request schedule_delegation payload missedRunPolicy',
      ),
  };
}

function assertActionPayload({ actionType, payload }) {
  const safePayload = assertSafeOsSerializableValue(
    payload,
    `OpenMAS OS Action Request ${actionType} payload`,
  );

  if (actionType === 'delegate') {
    return assertDelegatePayload(safePayload);
  }

  if (actionType === 'schedule_delegation') {
    return assertScheduleDelegationPayload(safePayload);
  }

  throw new Error(`OpenMAS OS Action Request actionType is unsupported: ${actionType}`);
}

export function assertOpenMasOsActionRequest(request) {
  assertPlainObject(request, 'OpenMAS OS Action Request');

  const safeRequest = assertSafeOsSerializableValue(request, 'OpenMAS OS Action Request');
  const actionType = assertEnumValue(
    safeRequest.actionType,
    OPENMAS_OS_ACTION_TYPES,
    'OpenMAS OS Action Request actionType',
  );

  return {
    kind: assertEnumValue(
      safeRequest.kind,
      new Set([OPENMAS_OS_ACTION_KINDS.request]),
      'OpenMAS OS Action Request kind',
    ),
    schemaVersion: assertSchemaVersion(safeRequest.schemaVersion, 'OpenMAS OS Action Request'),
    actionRequestId: assertSafeIdentifier(
      safeRequest.actionRequestId,
      'OpenMAS OS Action Request actionRequestId',
    ),
    actionType,
    requestedBy: assertActor(safeRequest.requestedBy, 'OpenMAS OS Action Request requestedBy'),
    conversationId: assertNullableSafeIdentifier(
      safeRequest.conversationId,
      'OpenMAS OS Action Request conversationId',
    ),
    parentContext: assertParentContext(safeRequest.parentContext),
    payload: assertActionPayload({
      actionType,
      payload: safeRequest.payload,
    }),
    createdAt: assertRequiredString(safeRequest.createdAt, 'OpenMAS OS Action Request createdAt'),
  };
}

export function assertOpenMasOsActionResult(result) {
  assertPlainObject(result, 'OpenMAS OS Action Result');

  const safeResult = assertSafeOsSerializableValue(result, 'OpenMAS OS Action Result');

  return {
    kind: assertEnumValue(
      safeResult.kind,
      new Set([OPENMAS_OS_ACTION_KINDS.result]),
      'OpenMAS OS Action Result kind',
    ),
    schemaVersion: assertSchemaVersion(safeResult.schemaVersion, 'OpenMAS OS Action Result'),
    actionResultId: assertSafeIdentifier(
      safeResult.actionResultId,
      'OpenMAS OS Action Result actionResultId',
    ),
    actionRequestId: assertSafeIdentifier(
      safeResult.actionRequestId,
      'OpenMAS OS Action Result actionRequestId',
    ),
    actionType: assertEnumValue(
      safeResult.actionType,
      OPENMAS_OS_ACTION_RESULT_ACTION_TYPES,
      'OpenMAS OS Action Result actionType',
    ),
    status: assertEnumValue(
      safeResult.status,
      OPENMAS_OS_ACTION_RESULT_STATUSES,
      'OpenMAS OS Action Result status',
    ),
    createdBy: assertActor(safeResult.createdBy, 'OpenMAS OS Action Result createdBy'),
    reason: assertNullableString(safeResult.reason, 'OpenMAS OS Action Result reason'),
    payload: safeResult.payload === undefined || safeResult.payload === null
      ? {}
      : assertSafeOsSerializableValue(safeResult.payload, 'OpenMAS OS Action Result payload'),
    evidenceRefs: assertSafeReferenceArray(safeResult.evidenceRefs, 'OpenMAS OS Action Result evidenceRefs'),
    warnings: assertSafeStringArray(safeResult.warnings, 'OpenMAS OS Action Result warnings'),
    createdAt: assertRequiredString(safeResult.createdAt, 'OpenMAS OS Action Result createdAt'),
    updatedAt: assertRequiredString(safeResult.updatedAt, 'OpenMAS OS Action Result updatedAt'),
    completedAt: assertNullableString(safeResult.completedAt, 'OpenMAS OS Action Result completedAt'),
  };
}

export {
  OPENMAS_OS_ACTION_ACTOR_TYPES,
  OPENMAS_OS_ACTION_INVOCATION_MODES,
  OPENMAS_OS_ACTION_KINDS,
  OPENMAS_OS_ACTION_MISSED_RUN_POLICIES,
  OPENMAS_OS_ACTION_RESULT_ACTION_TYPES,
  OPENMAS_OS_ACTION_RESULT_STATUSES,
  OPENMAS_OS_ACTION_SCHEMA_VERSION,
  OPENMAS_OS_ACTION_TYPES,
};
