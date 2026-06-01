import {
  assertSafeOsSerializableValue,
} from './openmas-os-runtime-contract.js';

const OPENMAS_OS_RESULT_RECORD_SCHEMA_VERSION = 1;

const OPENMAS_OS_RESULT_RECORD_KINDS = Object.freeze({
  resultRecord: 'openmas_os_result_record',
  resultSummary: 'openmas_os_result_summary',
});

const OPENMAS_OS_RESULT_RECORD_STATUSES = new Set([
  'accepted',
  'scheduled',
  'released',
  'running',
  'completed',
  'completed_with_warnings',
  'failed',
  'denied',
  'expired',
  'cancelled',
  'skipped',
  'unknown',
]);

const OPENMAS_OS_TERMINAL_RESULT_RECORD_STATUSES = new Set([
  'completed',
  'completed_with_warnings',
  'failed',
  'denied',
  'expired',
  'cancelled',
  'skipped',
]);

const OPENMAS_OS_RESULT_RECORD_RESULT_KINDS = new Set([
  'system_call_result',
  'job_result',
  'process_result',
  'thread_result',
  'agent_invocation_result',
  'tool_run_result',
  'workflow_run_result',
  'foreground_admission_result',
  'foreground_completion_result',
  'scheduled_submission_result',
  'scheduled_release_result',
  'scheduled_child_result',
  'delegation_submission_result',
  'delegated_child_result',
  'parent_resume_result',
  'notification_result',
  'inspection_result',
]);

const OPENMAS_OS_RESULT_RECORD_PHASES = new Set([
  'admission',
  'submission',
  'scheduled',
  'release',
  'running',
  'terminal',
  'notification',
  'inspection',
  'unknown',
]);

const OPENMAS_OS_RESULT_RECORD_PRODUCER_TYPES = new Set([
  'system_call',
  'job',
  'process',
  'thread',
  'agent_invocation',
  'tool_run',
  'workflow_run',
  'timer',
  'signal',
  'event',
  'operational_identity',
  'human',
  'system',
]);

const OPENMAS_OS_RESULT_RECORD_WARNING_SEVERITIES = new Set([
  'info',
  'warning',
  'critical',
]);

const OPENMAS_OS_RESULT_RECORD_FAILURE_CLASSES = new Set([
  'validation_failure',
  'policy_denial',
  'target_not_ready',
  'provider_unavailable',
  'tool_failure',
  'brain_failure',
  'timeout',
  'malformed_output',
  'verification_failure',
  'kernel_processing_failure',
  'cancelled',
  'expired',
  'unknown_failure',
]);

const OPENMAS_OS_RESULT_RECORD_VERIFICATION_STATUSES = new Set([
  'not_applicable',
  'passed',
  'failed',
  'warning',
  'unknown',
]);

const OPENMAS_OS_RESULT_RECORD_EXIT_CLASSES = new Set([
  'success',
  'warnings',
  'failure',
  'denied',
  'cancelled',
  'expired',
  'skipped',
  'unknown',
]);

const SAFE_OPENMAS_OS_RESULT_RECORD_IDENTIFIER_PATTERN = /^[a-zA-Z0-9._-]+$/u;
const SAFE_OPENMAS_OS_RESULT_RECORD_REFERENCE_PATTERN = /^[a-zA-Z0-9._/@:+-]+$/u;
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

  return assertSafeOsSerializableValue(value.trim(), description);
}

function assertNullableString(value, description) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  return assertRequiredString(value, description);
}

function assertKind(value, expectedKind, description) {
  if (value !== expectedKind) {
    throw new Error(`${description} must include kind "${expectedKind}".`);
  }

  return value;
}

function assertSchemaVersion(value, description) {
  if (!Number.isInteger(value) || value < OPENMAS_OS_RESULT_RECORD_SCHEMA_VERSION) {
    throw new Error(`${description} must include an integer schemaVersion greater than or equal to ${OPENMAS_OS_RESULT_RECORD_SCHEMA_VERSION}.`);
  }

  return value;
}

function assertEnumValue(value, allowedValues, description) {
  const normalizedValue = assertRequiredString(value, description);

  if (!allowedValues.has(normalizedValue)) {
    throw new Error(`${description} is invalid: ${normalizedValue}`);
  }

  return normalizedValue;
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

function assertNullableBoolean(value, description) {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== 'boolean') {
    throw new Error(`${description} must be a boolean when provided.`);
  }

  return value;
}

function assertNonNegativeInteger(value, description, defaultValue = undefined) {
  if (value === undefined || value === null) {
    if (defaultValue !== undefined) {
      return defaultValue;
    }

    throw new Error(`${description} must be a non-negative integer.`);
  }

  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${description} must be a non-negative integer.`);
  }

  return value;
}

function assertNullableNonNegativeInteger(value, description) {
  if (value === undefined || value === null) {
    return null;
  }

  return assertNonNegativeInteger(value, description);
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

function assertSafeIdentifier(value, description) {
  const normalizedValue = assertRequiredString(value, description);

  if (!SAFE_OPENMAS_OS_RESULT_RECORD_IDENTIFIER_PATTERN.test(normalizedValue)) {
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

function assertSafeReferenceString(value, description) {
  const normalizedValue = assertRequiredString(value, description);

  if (normalizedValue.length > 512) {
    throw new Error(`${description} must be 512 characters or less.`);
  }

  if (
    normalizedValue.includes('..')
    || normalizedValue.includes('\\')
    || normalizedValue.startsWith('/')
    || /^[a-zA-Z]:/u.test(normalizedValue)
  ) {
    throw new Error(`${description} must be a bounded OpenMAS reference, not a filesystem traversal or absolute path.`);
  }

  if (!SAFE_OPENMAS_OS_RESULT_RECORD_REFERENCE_PATTERN.test(normalizedValue)) {
    throw new Error(`${description} contains unsafe characters: ${normalizedValue}`);
  }

  return normalizedValue;
}

function assertSafeReference(value, description) {
  if (typeof value === 'string') {
    return assertSafeReferenceString(value, description);
  }

  assertPlainObject(value, description);

  return assertSafeOsSerializableValue(value, description);
}

function assertSafeReferenceArray(values, description) {
  if (values === undefined || values === null) {
    return [];
  }

  if (!Array.isArray(values)) {
    throw new Error(`${description} must be an array.`);
  }

  return values.map((value, index) => {
    return assertSafeReference(value, `${description}[${index}]`);
  });
}

function assertSafeIdentifierArray(values, description) {
  if (values === undefined || values === null) {
    return [];
  }

  if (!Array.isArray(values)) {
    throw new Error(`${description} must be an array.`);
  }

  return values.map((value, index) => {
    return assertSafeIdentifier(value, `${description}[${index}]`);
  });
}

function assertProducer(producer, description) {
  assertPlainObject(producer, description);

  return {
    type: assertEnumValue(producer.type, OPENMAS_OS_RESULT_RECORD_PRODUCER_TYPES, `${description} type`),
    id: assertSafeIdentifier(producer.id, `${description} id`),
    operationalIdentityId: assertNullableSafeIdentifier(
      producer.operationalIdentityId,
      `${description} operationalIdentityId`,
    ),
    activeCognitiveIdentityId: assertNullableSafeIdentifier(
      producer.activeCognitiveIdentityId,
      `${description} activeCognitiveIdentityId`,
    ),
  };
}

function assertLineage(lineage = {}, description) {
  assertPlainObject(lineage ?? {}, description);

  return {
    jobId: assertNullableSafeIdentifier(lineage.jobId, `${description} jobId`),
    processId: assertNullableSafeIdentifier(lineage.processId, `${description} processId`),
    threadId: assertNullableSafeIdentifier(lineage.threadId, `${description} threadId`),
    parentJobId: assertNullableSafeIdentifier(lineage.parentJobId, `${description} parentJobId`),
    parentProcessId: assertNullableSafeIdentifier(lineage.parentProcessId, `${description} parentProcessId`),
    parentThreadId: assertNullableSafeIdentifier(lineage.parentThreadId, `${description} parentThreadId`),
    systemCallId: assertNullableSafeIdentifier(lineage.systemCallId, `${description} systemCallId`),
    timerId: assertNullableSafeIdentifier(lineage.timerId, `${description} timerId`),
    signalId: assertNullableSafeIdentifier(lineage.signalId, `${description} signalId`),
    eventId: assertNullableSafeIdentifier(lineage.eventId, `${description} eventId`),
    invocationId: assertNullableSafeIdentifier(lineage.invocationId, `${description} invocationId`),
    toolRunId: assertNullableSafeIdentifier(lineage.toolRunId, `${description} toolRunId`),
    workflowRunId: assertNullableSafeIdentifier(lineage.workflowRunId, `${description} workflowRunId`),
    conversationId: assertNullableSafeIdentifier(lineage.conversationId, `${description} conversationId`),
  };
}

function assertSourceRef(source, description) {
  if (source === undefined || source === null || source === '') {
    return null;
  }

  if (typeof source === 'string') {
    return {
      type: 'unknown',
      id: assertSafeIdentifier(source, description),
    };
  }

  assertPlainObject(source, description);

  return {
    type: assertSafeIdentifier(source.type, `${description} type`),
    id: assertNullableSafeIdentifier(source.id, `${description} id`),
    label: assertNullableString(source.label, `${description} label`),
  };
}

function assertCompletion(completion = {}, description) {
  assertPlainObject(completion ?? {}, description);

  return {
    startedAt: assertNullableExplicitTimestamp(completion.startedAt, `${description} startedAt`),
    completedAt: assertNullableExplicitTimestamp(completion.completedAt, `${description} completedAt`),
    durationMs: assertNullableNonNegativeInteger(completion.durationMs, `${description} durationMs`),
    exitClass: completion.exitClass === undefined || completion.exitClass === null || completion.exitClass === ''
      ? null
      : assertEnumValue(completion.exitClass, OPENMAS_OS_RESULT_RECORD_EXIT_CLASSES, `${description} exitClass`),
  };
}

function assertWarning(warning, description) {
  assertPlainObject(warning, description);

  return {
    source: assertSourceRef(warning.source, `${description} source`),
    severity: assertEnumValue(
      warning.severity ?? 'warning',
      OPENMAS_OS_RESULT_RECORD_WARNING_SEVERITIES,
      `${description} severity`,
    ),
    message: assertRequiredString(warning.message, `${description} message`),
    affectsResultTrust: assertOptionalBoolean(
      warning.affectsResultTrust,
      `${description} affectsResultTrust`,
      false,
    ),
    requiresHumanAction: assertOptionalBoolean(
      warning.requiresHumanAction,
      `${description} requiresHumanAction`,
      false,
    ),
    details: assertSafeOsSerializableValue(warning.details ?? {}, `${description} details`),
  };
}

function assertWarnings(values, description) {
  if (values === undefined || values === null) {
    return [];
  }

  if (!Array.isArray(values)) {
    throw new Error(`${description} must be an array.`);
  }

  return values.map((value, index) => {
    return assertWarning(value, `${description}[${index}]`);
  });
}

function assertFailure(failure, description) {
  if (failure === undefined || failure === null) {
    return null;
  }

  assertPlainObject(failure, description);

  return {
    class: assertEnumValue(
      failure.class,
      OPENMAS_OS_RESULT_RECORD_FAILURE_CLASSES,
      `${description} class`,
    ),
    message: assertRequiredString(failure.message, `${description} message`),
    recoverable: assertOptionalBoolean(failure.recoverable, `${description} recoverable`, false),
    retryable: assertOptionalBoolean(failure.retryable, `${description} retryable`, false),
    reasonCode: assertNullableSafeIdentifier(failure.reasonCode, `${description} reasonCode`),
    source: assertSourceRef(failure.source, `${description} source`),
    failedAt: assertNullableExplicitTimestamp(failure.failedAt, `${description} failedAt`),
    details: assertSafeOsSerializableValue(failure.details ?? {}, `${description} details`),
  };
}

function assertVerification(verification = {}, description) {
  assertPlainObject(verification ?? {}, description);

  return {
    status: assertEnumValue(
      verification.status ?? 'unknown',
      OPENMAS_OS_RESULT_RECORD_VERIFICATION_STATUSES,
      `${description} status`,
    ),
    grounded: assertNullableBoolean(verification.grounded, `${description} grounded`),
    details: assertSafeOsSerializableValue(verification.details ?? {}, `${description} details`),
  };
}

function assertVisibility(visibility = {}, description) {
  assertPlainObject(visibility ?? {}, description);

  return {
    safeForHumanSummary: assertOptionalBoolean(
      visibility.safeForHumanSummary,
      `${description} safeForHumanSummary`,
      true,
    ),
    safeForAgentContext: assertOptionalBoolean(
      visibility.safeForAgentContext,
      `${description} safeForAgentContext`,
      true,
    ),
  };
}

function assertResultConsistency(result) {
  if (result.phase === 'terminal' && !OPENMAS_OS_TERMINAL_RESULT_RECORD_STATUSES.has(result.status)) {
    throw new Error(`OpenMAS OS Result Record with phase "terminal" must use a terminal status. Received: ${result.status}.`);
  }

  if (result.status === 'completed_with_warnings' && result.warnings.length === 0) {
    throw new Error('OpenMAS OS Result Record with status "completed_with_warnings" must include at least one warning.');
  }

  if (result.status === 'completed' && result.warnings.length > 0) {
    throw new Error('OpenMAS OS Result Record with status "completed" must not include warnings. Use "completed_with_warnings".');
  }

  if (result.status === 'failed' && result.failure === null) {
    throw new Error('OpenMAS OS Result Record with status "failed" must include failure details.');
  }

  if (result.status !== 'failed' && result.failure !== null) {
    throw new Error(`OpenMAS OS Result Record with status "${result.status}" must not include failure details.`);
  }
}

export function assertOpenMasOsResultRecord(record) {
  assertPlainObject(record, 'OpenMAS OS Result Record');

  const normalizedResult = {
    kind: assertKind(
      record.kind,
      OPENMAS_OS_RESULT_RECORD_KINDS.resultRecord,
      'OpenMAS OS Result Record',
    ),
    schemaVersion: assertSchemaVersion(record.schemaVersion, 'OpenMAS OS Result Record'),
    resultId: assertSafeIdentifier(record.resultId, 'OpenMAS OS Result Record resultId'),
    resultKind: assertEnumValue(
      record.resultKind,
      OPENMAS_OS_RESULT_RECORD_RESULT_KINDS,
      'OpenMAS OS Result Record resultKind',
    ),
    producer: assertProducer(record.producer, 'OpenMAS OS Result Record producer'),
    lineage: assertLineage(record.lineage ?? {}, 'OpenMAS OS Result Record lineage'),
    status: assertEnumValue(
      record.status,
      OPENMAS_OS_RESULT_RECORD_STATUSES,
      'OpenMAS OS Result Record status',
    ),
    phase: assertEnumValue(
      record.phase ?? 'unknown',
      OPENMAS_OS_RESULT_RECORD_PHASES,
      'OpenMAS OS Result Record phase',
    ),
    completion: assertCompletion(record.completion ?? {}, 'OpenMAS OS Result Record completion'),
    summary: assertRequiredString(record.summary, 'OpenMAS OS Result Record summary'),
    artifactRefs: assertSafeReferenceArray(record.artifactRefs ?? [], 'OpenMAS OS Result Record artifactRefs'),
    toolRunRefs: assertSafeIdentifierArray(record.toolRunRefs ?? [], 'OpenMAS OS Result Record toolRunRefs'),
    workflowRunRefs: assertSafeIdentifierArray(
      record.workflowRunRefs ?? [],
      'OpenMAS OS Result Record workflowRunRefs',
    ),
    childResultRefs: assertSafeReferenceArray(
      record.childResultRefs ?? [],
      'OpenMAS OS Result Record childResultRefs',
    ),
    warnings: assertWarnings(record.warnings ?? [], 'OpenMAS OS Result Record warnings'),
    failure: assertFailure(record.failure, 'OpenMAS OS Result Record failure'),
    verification: assertVerification(record.verification ?? {}, 'OpenMAS OS Result Record verification'),
    visibility: assertVisibility(record.visibility ?? {}, 'OpenMAS OS Result Record visibility'),
    metadata: assertSafeOsSerializableValue(record.metadata ?? {}, 'OpenMAS OS Result Record metadata'),
    createdAt: assertExplicitTimestamp(record.createdAt, 'OpenMAS OS Result Record createdAt'),
  };

  assertResultConsistency(normalizedResult);

  return normalizedResult;
}

export function assertOpenMasOsResultSummary(summary) {
  assertPlainObject(summary, 'OpenMAS OS Result Summary');

  const normalizedSummary = {
    kind: assertKind(
      summary.kind,
      OPENMAS_OS_RESULT_RECORD_KINDS.resultSummary,
      'OpenMAS OS Result Summary',
    ),
    schemaVersion: assertSchemaVersion(summary.schemaVersion, 'OpenMAS OS Result Summary'),
    resultId: assertSafeIdentifier(summary.resultId, 'OpenMAS OS Result Summary resultId'),
    resultKind: assertEnumValue(
      summary.resultKind,
      OPENMAS_OS_RESULT_RECORD_RESULT_KINDS,
      'OpenMAS OS Result Summary resultKind',
    ),
    status: assertEnumValue(
      summary.status,
      OPENMAS_OS_RESULT_RECORD_STATUSES,
      'OpenMAS OS Result Summary status',
    ),
    producerLabel: assertRequiredString(summary.producerLabel, 'OpenMAS OS Result Summary producerLabel'),
    summary: assertRequiredString(summary.summary, 'OpenMAS OS Result Summary summary'),
    artifactRefs: assertSafeReferenceArray(summary.artifactRefs ?? [], 'OpenMAS OS Result Summary artifactRefs'),
    childResultRefs: assertSafeReferenceArray(
      summary.childResultRefs ?? [],
      'OpenMAS OS Result Summary childResultRefs',
    ),
    warningCount: assertNonNegativeInteger(
      summary.warningCount ?? 0,
      'OpenMAS OS Result Summary warningCount',
      0,
    ),
    failure: assertFailure(summary.failure, 'OpenMAS OS Result Summary failure'),
    verificationStatus: summary.verificationStatus === undefined
      || summary.verificationStatus === null
      || summary.verificationStatus === ''
      ? 'unknown'
      : assertEnumValue(
        summary.verificationStatus,
        OPENMAS_OS_RESULT_RECORD_VERIFICATION_STATUSES,
        'OpenMAS OS Result Summary verificationStatus',
      ),
    createdAt: assertExplicitTimestamp(summary.createdAt, 'OpenMAS OS Result Summary createdAt'),
  };

  if (normalizedSummary.status === 'completed_with_warnings' && normalizedSummary.warningCount === 0) {
    throw new Error('OpenMAS OS Result Summary with status "completed_with_warnings" must include warningCount greater than 0.');
  }

  if (normalizedSummary.status === 'completed' && normalizedSummary.warningCount > 0) {
    throw new Error('OpenMAS OS Result Summary with status "completed" must not include warnings. Use "completed_with_warnings".');
  }

  if (normalizedSummary.status === 'failed' && normalizedSummary.failure === null) {
    throw new Error('OpenMAS OS Result Summary with status "failed" must include failure details.');
  }

  if (normalizedSummary.status !== 'failed' && normalizedSummary.failure !== null) {
    throw new Error(`OpenMAS OS Result Summary with status "${normalizedSummary.status}" must not include failure details.`);
  }

  return normalizedSummary;
}

export function createOpenMasOsResultSummaryFromRecord(record, overrides = {}) {
  const normalizedRecord = assertOpenMasOsResultRecord(record);
  const producerLabel = normalizedRecord.producer.operationalIdentityId
    ?? normalizedRecord.producer.id;

  return assertOpenMasOsResultSummary({
    kind: OPENMAS_OS_RESULT_RECORD_KINDS.resultSummary,
    schemaVersion: OPENMAS_OS_RESULT_RECORD_SCHEMA_VERSION,
    resultId: normalizedRecord.resultId,
    resultKind: normalizedRecord.resultKind,
    status: normalizedRecord.status,
    producerLabel,
    summary: normalizedRecord.summary,
    artifactRefs: normalizedRecord.artifactRefs,
    childResultRefs: normalizedRecord.childResultRefs,
    warningCount: normalizedRecord.warnings.length,
    failure: normalizedRecord.failure,
    verificationStatus: normalizedRecord.verification.status,
    createdAt: normalizedRecord.createdAt,
    ...overrides,
  });
}

export {
  OPENMAS_OS_RESULT_RECORD_SCHEMA_VERSION,
  OPENMAS_OS_RESULT_RECORD_KINDS,
  OPENMAS_OS_RESULT_RECORD_STATUSES,
  OPENMAS_OS_TERMINAL_RESULT_RECORD_STATUSES,
  OPENMAS_OS_RESULT_RECORD_RESULT_KINDS,
  OPENMAS_OS_RESULT_RECORD_PHASES,
  OPENMAS_OS_RESULT_RECORD_PRODUCER_TYPES,
  OPENMAS_OS_RESULT_RECORD_WARNING_SEVERITIES,
  OPENMAS_OS_RESULT_RECORD_FAILURE_CLASSES,
  OPENMAS_OS_RESULT_RECORD_VERIFICATION_STATUSES,
  OPENMAS_OS_RESULT_RECORD_EXIT_CLASSES,
};
