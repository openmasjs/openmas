import { randomUUID } from 'node:crypto';
import {
  OPENMAS_OS_ACTION_KINDS,
  OPENMAS_OS_ACTION_SCHEMA_VERSION,
} from '../../contracts/os/openmas-os-action-request-contract.js';
import {
  OPENMAS_OS_KINDS,
  OPENMAS_OS_SCHEMA_VERSION,
} from '../../contracts/os/openmas-os-runtime-contract.js';
import {
  OPENMAS_OS_SYSTEM_CALL_KINDS,
  OPENMAS_OS_SYSTEM_CALL_SCHEMA_VERSION,
  assertOpenMasOsSystemCallResult,
} from '../../contracts/os/openmas-os-system-call-contract.js';
import {
  OPENMAS_OS_RESULT_RECORD_KINDS,
  OPENMAS_OS_RESULT_RECORD_SCHEMA_VERSION,
} from '../../contracts/os/openmas-os-result-record-contract.js';
import { createLocalRuntimeAdapter } from '../adapters/local-runtime-adapter.js';
import {
  delegateToOperationalIdentity,
  scheduleDelegationToOperationalIdentity,
} from '../delegation/delegation-manager.js';
import {
  evaluateDelegationPolicy,
  readDelegationPolicy,
} from '../delegation/delegation-policy.js';
import { evaluateDelegationTargetReadiness } from '../delegation/delegation-target-readiness.js';
import { SCHEDULE_DELEGATION_DELAY_GRACE_MS } from '../actions/os-action-gate.js';
import {
  createSafeErrorMessage,
  createSafeFailureSummary,
} from '../failure-summary.js';
import { createLocalSystemCallInbox } from './local-system-call-inbox.js';

const DEFAULT_MAX_SYSTEM_CALLS_PER_RUN = 25;
const DEFAULT_SERVICE_ID = 'openmas-os';
const TERMINAL_DELEGATION_SYSTEM_CALL_FAILURE_STATUSES = new Set([
  'denied',
  'failed',
  'expired',
  'cancelled',
]);

function defaultNow() {
  return new Date().toISOString();
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function createEventId() {
  return `event_${randomUUID()}`;
}

function createSystemActor() {
  return {
    type: 'system',
    id: 'openmas-os',
  };
}

function isMissingRuntimeStateError(error) {
  return error instanceof Error && /was not found/u.test(error.message);
}

function normalizeNow(now) {
  if (now === undefined || now === null) {
    return defaultNow;
  }

  if (typeof now !== 'function') {
    throw new Error('OpenMAS OS System Call Processor now must be a function when provided.');
  }

  return now;
}

function createAdapter({ adapter = null, projectRootPath = null, osRootPath = null } = {}) {
  return adapter ?? createLocalRuntimeAdapter({ projectRootPath, osRootPath });
}

function createInbox({ inbox = null, projectRootPath = null, osRootPath = null } = {}) {
  return inbox ?? createLocalSystemCallInbox({ projectRootPath, osRootPath });
}

function assertAdapter(adapter) {
  if (!adapter || typeof adapter !== 'object') {
    throw new Error('OpenMAS OS System Call Processor requires a runtime adapter.');
  }

  for (const methodName of [
    'loadJob',
    'persistJob',
    'loadProcess',
    'persistProcess',
    'loadThread',
    'persistThread',
    'appendEvent',
  ]) {
    if (typeof adapter[methodName] !== 'function') {
      throw new Error(`OpenMAS OS runtime adapter must implement ${methodName}.`);
    }
  }

  return adapter;
}

function assertResultRecordAdapter(adapter) {
  if (typeof adapter.persistResultRecord !== 'function') {
    throw new Error('OpenMAS OS runtime adapter must implement persistResultRecord for System Call Result materialization.');
  }

  if (typeof adapter.loadResultRecord !== 'function') {
    throw new Error('OpenMAS OS runtime adapter must implement loadResultRecord for System Call Result materialization.');
  }

  return adapter;
}

function assertInbox(inbox) {
  if (!inbox || typeof inbox !== 'object') {
    throw new Error('OpenMAS OS System Call Processor requires a system call inbox.');
  }

  for (const methodName of [
    'listPendingSystemCallIds',
    'listSystemCallIds',
    'loadSystemCall',
    'loadPendingSystemCall',
    'moveSystemCall',
    'persistSystemCallResult',
    'hasSystemCallResult',
    'loadSystemCallResult',
    'listSystemCallResults',
  ]) {
    if (typeof inbox[methodName] !== 'function') {
      throw new Error(`OpenMAS OS system call inbox must implement ${methodName}.`);
    }
  }

  return inbox;
}

function assertMaxSystemCallsPerRun(value) {
  if (value === undefined || value === null) {
    return DEFAULT_MAX_SYSTEM_CALLS_PER_RUN;
  }

  if (!Number.isInteger(value) || value < 1) {
    throw new Error('OpenMAS OS System Call Processor maxSystemCallsPerRun must be an integer greater than or equal to 1.');
  }

  return value;
}

function normalizeDelegationTargetReadinessEvaluator(evaluator) {
  if (evaluator === undefined || evaluator === null) {
    return evaluateDelegationTargetReadiness;
  }

  if (typeof evaluator !== 'function') {
    throw new Error('OpenMAS OS System Call Processor delegationTargetReadinessEvaluator must be a function.');
  }

  return evaluator;
}

function normalizeReadinessWarningArray(values) {
  if (!Array.isArray(values)) {
    return [];
  }

  return values
    .filter(isNonEmptyString)
    .map((value) => value.trim());
}

function normalizeDelegationTargetReadinessResult(result) {
  if (!isPlainObject(result)) {
    throw new Error('OpenMAS OS delegation target readiness evaluator must return an object.');
  }

  const ready = result.ready === true;
  const status = isNonEmptyString(result.status)
    ? result.status.trim()
    : ready
      ? 'ready'
      : 'blocked';
  const reasonCode = isNonEmptyString(result.reasonCode)
    ? result.reasonCode.trim()
    : ready
      ? 'target_ready_for_delegation'
      : 'target_not_ready_for_delegation';
  const reason = isNonEmptyString(result.reason)
    ? result.reason.trim()
    : ready
      ? 'Delegation target is ready.'
      : 'Delegation target is not ready.';

  return {
    ...result,
    ready,
    status,
    reasonCode,
    reason,
    warnings: normalizeReadinessWarningArray(result.warnings),
  };
}

async function evaluateSystemCallDelegationTargetReadiness({
  systemCall,
  projectRootPath,
  osRootPath,
  delegationTargetReadinessEvaluator,
}) {
  try {
    return normalizeDelegationTargetReadinessResult(await delegationTargetReadinessEvaluator({
      projectRootPath,
      osRootPath,
      systemCall,
      targetOperationalIdentityId: systemCall.payload.targetOperationalIdentityId,
      command: systemCall.payload.child.command,
      mode: systemCall.payload.child.mode,
    }));
  } catch (error) {
    return {
      ready: false,
      status: 'blocked',
      reasonCode: 'target_readiness_check_failed',
      reason: `OpenMAS OS could not verify delegation target readiness: ${error.message}`,
      targetOperationalIdentityId: systemCall.payload.targetOperationalIdentityId,
      command: systemCall.payload.child.command,
      mode: systemCall.payload.child.mode,
      warnings: [],
    };
  }
}

function resultStatusToSystemCallState(status) {
  if (status === 'accepted' || status === 'completed') {
    return 'completed';
  }

  return status;
}

function mapSystemCallResultStatusToSubmissionResultStatus(status) {
  if (status === 'accepted' || status === 'completed') {
    return 'accepted';
  }

  return status;
}

function mapSystemCallResultStatusToScheduledSubmissionResultStatus(status) {
  if (status === 'accepted' || status === 'completed') {
    return 'scheduled';
  }

  return status;
}

function mapSubmissionResultStatusToExitClass(status) {
  if (status === 'accepted' || status === 'scheduled') {
    return 'success';
  }

  if (status === 'denied') {
    return 'denied';
  }

  if (status === 'failed') {
    return 'failure';
  }

  if (status === 'expired') {
    return 'expired';
  }

  if (status === 'cancelled') {
    return 'cancelled';
  }

  if (status === 'skipped') {
    return 'skipped';
  }

  return 'unknown';
}

function parseTimestamp(timestamp) {
  const timestampMs = Date.parse(timestamp);

  return Number.isFinite(timestampMs) ? timestampMs : null;
}

function calculateDurationMs(startedAt, finishedAt) {
  const startedAtMs = parseTimestamp(startedAt);
  const finishedAtMs = parseTimestamp(finishedAt);

  if (startedAtMs === null || finishedAtMs === null) {
    return null;
  }

  return Math.max(0, finishedAtMs - startedAtMs);
}

function isExpired(systemCall, nowTimestamp) {
  if (!isNonEmptyString(systemCall.expiresAt)) {
    return false;
  }

  return parseTimestamp(systemCall.expiresAt) <= parseTimestamp(nowTimestamp);
}

function normalizeCorrelation(correlation) {
  return isPlainObject(correlation) ? correlation : {};
}

function resolveParentContext(systemCall) {
  const payloadParentContext = isPlainObject(systemCall.payload?.parentContext)
    ? systemCall.payload.parentContext
    : {};
  const correlation = normalizeCorrelation(systemCall.correlation);

  return {
    jobId: payloadParentContext.jobId ?? correlation.jobId ?? null,
    processId: payloadParentContext.processId ?? correlation.processId ?? null,
    threadId: payloadParentContext.threadId ?? correlation.threadId ?? null,
  };
}

async function appendCallerLifecycleEvent({
  adapter,
  eventType,
  targetType,
  targetId,
  jobId,
  processId,
  threadId,
  occurredAt,
  payload,
}) {
  return adapter.appendEvent({
    kind: OPENMAS_OS_KINDS.event,
    schemaVersion: OPENMAS_OS_SCHEMA_VERSION,
    eventId: createEventId(),
    eventType,
    source: createSystemActor(),
    targetRef: {
      type: targetType,
      id: targetId,
    },
    jobId,
    processId,
    threadId,
    occurredAt,
    payload,
  });
}

function createTerminalDelegationSystemCallFailureSummary({ systemCall, result }) {
  return createSafeFailureSummary({
    reasonCode: 'terminal_delegation_system_call_failed',
    reason: 'OpenMAS OS terminalized foreground work because its delegation System Call completed without creating child work.',
    message: result.summary
      ?? result.decision?.reason
      ?? `OpenMAS OS delegation System Call ${systemCall.systemCallId} finished with status ${result.status}.`,
    errorName: 'TerminalDelegationSystemCallFailure',
    source: 'openmas-os-system-call-processor',
    failedAt: result.processedAt,
  });
}

async function terminalizeDelegationSystemCallCaller({
  adapter,
  systemCall,
  result,
}) {
  if (
    !systemCall
    || systemCall.operation !== 'delegate'
    || !TERMINAL_DELEGATION_SYSTEM_CALL_FAILURE_STATUSES.has(result.status)
  ) {
    return {
      status: 'not_applicable',
      terminalized: false,
      reason: 'system_call_not_terminal_failed_immediate_delegation',
    };
  }

  const parentContext = resolveParentContext(systemCall);

  if (!isNonEmptyString(parentContext.processId) || !isNonEmptyString(parentContext.threadId)) {
    return {
      status: 'ignored',
      terminalized: false,
      reason: 'parent_context_incomplete',
    };
  }

  try {
    const [
      parentProcess,
      parentThread,
    ] = await Promise.all([
      adapter.loadProcess(parentContext.processId),
      adapter.loadThread(parentContext.threadId),
    ]);
    const parentJob = await adapter.loadJob(parentProcess.jobId);

    if (
      parentJob.status !== 'active'
      || parentProcess.status !== 'blocked'
      || parentProcess.currentThreadId !== parentThread.threadId
      || parentThread.status !== 'blocked'
      || parentThread.waitReason !== 'waiting_for_system_call'
      || parentThread.processId !== parentProcess.processId
      || parentThread.jobId !== parentJob.jobId
      || (isNonEmptyString(parentContext.jobId) && parentContext.jobId !== parentJob.jobId)
    ) {
      return {
        status: 'ignored',
        terminalized: false,
        reason: 'parent_not_waiting_for_matching_system_call',
      };
    }

    const failedAt = result.processedAt;
    const failureSummary = createTerminalDelegationSystemCallFailureSummary({
      systemCall,
      result,
    });
    const payload = {
      systemCallId: systemCall.systemCallId,
      systemCallStatus: result.status,
      operation: systemCall.operation,
      reasonCode: failureSummary.reasonCode,
      failureSummary,
    };
    const failedThread = await adapter.persistThread({
      ...parentThread,
      status: 'failed',
      waitReason: null,
      updatedAt: failedAt,
      completedAt: failedAt,
      failedAt,
      failureSummary,
    });
    const failedProcess = await adapter.persistProcess({
      ...parentProcess,
      status: 'failed',
      currentThreadId: null,
      updatedAt: failedAt,
      completedAt: failedAt,
      failedAt,
      failureSummary,
    });
    const failedJob = await adapter.persistJob({
      ...parentJob,
      status: 'failed',
      updatedAt: failedAt,
      failedAt,
      failureSummary,
    });

    await appendCallerLifecycleEvent({
      adapter,
      eventType: 'thread.failed',
      targetType: 'thread',
      targetId: failedThread.threadId,
      jobId: failedJob.jobId,
      processId: failedProcess.processId,
      threadId: failedThread.threadId,
      occurredAt: failedAt,
      payload,
    });
    await appendCallerLifecycleEvent({
      adapter,
      eventType: 'process.failed',
      targetType: 'process',
      targetId: failedProcess.processId,
      jobId: failedJob.jobId,
      processId: failedProcess.processId,
      threadId: failedThread.threadId,
      occurredAt: failedAt,
      payload,
    });
    await appendCallerLifecycleEvent({
      adapter,
      eventType: 'job.failed',
      targetType: 'job',
      targetId: failedJob.jobId,
      jobId: failedJob.jobId,
      processId: failedProcess.processId,
      threadId: failedThread.threadId,
      occurredAt: failedAt,
      payload,
    });
    await appendCallerLifecycleEvent({
      adapter,
      eventType: 'system_call.caller.failed',
      targetType: 'process',
      targetId: failedProcess.processId,
      jobId: failedJob.jobId,
      processId: failedProcess.processId,
      threadId: failedThread.threadId,
      occurredAt: failedAt,
      payload,
    });

    return {
      status: 'terminalized',
      terminalized: true,
      reason: 'terminal_delegation_system_call_failed',
      systemCallId: systemCall.systemCallId,
      systemCallStatus: result.status,
      jobId: failedJob.jobId,
      processId: failedProcess.processId,
      threadId: failedThread.threadId,
    };
  } catch (error) {
    if (isMissingRuntimeStateError(error)) {
      return {
        status: 'ignored',
        terminalized: false,
        reason: 'parent_runtime_state_missing',
      };
    }

    return {
      status: 'failed',
      terminalized: false,
      reason: 'parent_terminalization_failed',
      errorMessage: createSafeErrorMessage(
        error,
        'OpenMAS OS could not terminalize a caller after delegation System Call failure.',
      ),
    };
  }
}

function buildParentAuthoritySnapshotFromSystemCall({ systemCall, parentContext }) {
  const correlation = normalizeCorrelation(systemCall.correlation);

  return {
    source: 'system_call',
    systemCallId: systemCall.systemCallId,
    operation: systemCall.operation,
    requestedAt: systemCall.requestedAt,
    jobId: parentContext.jobId ?? correlation.jobId ?? null,
    processId: parentContext.processId ?? correlation.processId ?? null,
    threadId: parentContext.threadId ?? correlation.threadId ?? null,
    invocationId: correlation.invocationId ?? null,
  };
}

function assertParentContext(parentContext, operation) {
  if (!isNonEmptyString(parentContext.processId)) {
    throw new Error(`OpenMAS OS System Call operation "${operation}" requires parent processId.`);
  }

  return {
    jobId: isNonEmptyString(parentContext.jobId) ? parentContext.jobId.trim() : null,
    processId: parentContext.processId.trim(),
    threadId: isNonEmptyString(parentContext.threadId) ? parentContext.threadId.trim() : null,
  };
}

function buildProcessedBy({ serviceId, tickId }) {
  return {
    serviceId,
    tickId: tickId ?? null,
  };
}

function buildResultWarningsFromSystemCallResult({ result, systemCall }) {
  if (!Array.isArray(result.warnings)) {
    return [];
  }

  return result.warnings.map((warning, index) => {
    const message = isNonEmptyString(warning)
      ? warning.trim()
      : warning?.message ?? `System Call warning ${index + 1}.`;

    return {
      source: {
        type: 'system_call',
        id: systemCall.systemCallId,
      },
      severity: warning?.severity ?? 'warning',
      message,
      affectsResultTrust: warning?.affectsResultTrust ?? false,
      requiresHumanAction: warning?.requiresHumanAction ?? false,
      details: isPlainObject(warning)
        ? {
          warning,
        }
        : {},
    };
  });
}

function buildFailureFromSystemCallResult({ result, systemCall }) {
  if (result.status !== 'failed') {
    return null;
  }

  return {
    class: 'kernel_processing_failure',
    message: result.decision.reason ?? result.summary ?? `OpenMAS OS System Call ${systemCall.systemCallId} failed.`,
    recoverable: false,
    retryable: false,
    reasonCode: result.details?.reasonCode ?? 'system_call_failed',
    source: {
      type: 'system_call',
      id: systemCall.systemCallId,
    },
    failedAt: result.processedAt,
    details: {
      operation: result.operation,
      systemCallStatus: result.status,
      errorMessage: result.details?.errorMessage ?? null,
    },
  };
}

function resolveChildJobIdFromSystemCallResult(result) {
  return result.details?.childJobId
    ?? result.effects?.createdJobIds?.[0]
    ?? result.details?.reusedEffects?.createdJobIds?.[0]
    ?? null;
}

function resolveTimerIdFromSystemCallResult(result) {
  return result.details?.timerId
    ?? result.effects?.createdTimerIds?.[0]
    ?? result.details?.reusedEffects?.createdTimerIds?.[0]
    ?? null;
}

function resolveParentWaitMode(result) {
  if (result.details?.parentThreadStatus === 'blocked') {
    return 'wait_for_child_process';
  }

  if (result.status === 'completed' || result.status === 'accepted') {
    return 'unknown';
  }

  return null;
}

function buildDelegationSubmissionResultRecord({ systemCall, result }) {
  const submissionStatus = mapSystemCallResultStatusToSubmissionResultStatus(result.status);
  const childJobId = resolveChildJobIdFromSystemCallResult(result);
  const parentContext = resolveParentContext(systemCall);
  const duplicateOfSystemCallId = result.details?.duplicateOfSystemCallId ?? null;
  const originalSubmissionResultId = duplicateOfSystemCallId
    ? `result_delegation_submission_${duplicateOfSystemCallId}`
    : null;

  return {
    kind: OPENMAS_OS_RESULT_RECORD_KINDS.resultRecord,
    schemaVersion: OPENMAS_OS_RESULT_RECORD_SCHEMA_VERSION,
    resultId: `result_delegation_submission_${systemCall.systemCallId}`,
    resultKind: 'delegation_submission_result',
    producer: {
      type: 'system_call',
      id: systemCall.systemCallId,
      operationalIdentityId: systemCall.payload?.requesterOperationalIdentityId ?? systemCall.requestedBy?.id ?? null,
    },
    lineage: {
      jobId: childJobId,
      processId: null,
      threadId: null,
      parentJobId: parentContext.jobId,
      parentProcessId: parentContext.processId,
      parentThreadId: parentContext.threadId,
      systemCallId: systemCall.systemCallId,
      invocationId: systemCall.correlation?.invocationId ?? null,
      toolRunId: systemCall.correlation?.toolRunId ?? null,
      workflowRunId: systemCall.correlation?.workflowRunId ?? null,
      conversationId: systemCall.correlation?.conversationId ?? systemCall.payload?.child?.conversationId ?? null,
    },
    status: submissionStatus,
    phase: 'submission',
    completion: {
      startedAt: systemCall.requestedAt,
      completedAt: result.processedAt,
      durationMs: calculateDurationMs(systemCall.requestedAt, result.processedAt),
      exitClass: mapSubmissionResultStatusToExitClass(submissionStatus),
    },
    summary: result.summary,
    artifactRefs: [],
    toolRunRefs: systemCall.correlation?.toolRunId ? [systemCall.correlation.toolRunId] : [],
    workflowRunRefs: systemCall.correlation?.workflowRunId ? [systemCall.correlation.workflowRunId] : [],
    childResultRefs: [],
    warnings: buildResultWarningsFromSystemCallResult({
      result,
      systemCall,
    }),
    failure: buildFailureFromSystemCallResult({
      result,
      systemCall,
    }),
    verification: {
      status: 'passed',
      grounded: true,
      details: {
        kernelDecisionAllowed: result.decision.allowed,
        systemCallStatus: result.status,
      },
    },
    visibility: {
      safeForHumanSummary: true,
      safeForAgentContext: true,
    },
    metadata: {
      actionType: 'delegate',
      systemCall: {
        systemCallId: systemCall.systemCallId,
        operation: systemCall.operation,
        status: result.status,
        idempotencyKey: systemCall.idempotencyKey,
        duplicateOfSystemCallId,
        originalSubmissionResultId,
      },
      policy: {
        allowed: result.decision.allowed,
        reason: result.decision.reason,
        authorizationRuleId: result.details?.authorizationRuleId ?? null,
        reasonCode: result.details?.reasonCode ?? null,
      },
      parent: {
        jobId: parentContext.jobId,
        processId: result.details?.parentProcessId ?? parentContext.processId,
        threadId: result.details?.parentThreadId ?? parentContext.threadId,
        processStatus: result.details?.parentProcessStatus ?? null,
        threadStatus: result.details?.parentThreadStatus ?? null,
        waitMode: resolveParentWaitMode(result),
      },
      delegation: {
        delegationId: result.details?.delegationId ?? null,
        childJobId,
        childJobStatus: result.details?.childJobStatus ?? null,
        targetOperationalIdentityId: result.details?.targetOperationalIdentityId
          ?? systemCall.payload?.targetOperationalIdentityId
          ?? null,
        childConversationId: result.details?.childConversationId ?? null,
        conversationHandoff: result.details?.conversationHandoff ?? null,
      },
      delivery: {
        mode: submissionStatus === 'accepted'
          ? 'notify_parent_on_child_completion'
          : 'none',
        expectedBehavior: submissionStatus === 'accepted'
          ? 'child_result_then_parent_resume'
          : 'no_child_work_created',
        childCompletionProven: false,
      },
    },
    createdAt: result.processedAt,
  };
}

function buildScheduledSubmissionResultRecord({ systemCall, result }) {
  const submissionStatus = mapSystemCallResultStatusToScheduledSubmissionResultStatus(result.status);
  const childJobId = resolveChildJobIdFromSystemCallResult(result);
  const timerId = resolveTimerIdFromSystemCallResult(result);
  const parentContext = resolveParentContext(systemCall);
  const duplicateOfSystemCallId = result.details?.duplicateOfSystemCallId ?? null;
  const originalSubmissionResultId = duplicateOfSystemCallId
    ? `result_scheduled_submission_${duplicateOfSystemCallId}`
    : null;

  return {
    kind: OPENMAS_OS_RESULT_RECORD_KINDS.resultRecord,
    schemaVersion: OPENMAS_OS_RESULT_RECORD_SCHEMA_VERSION,
    resultId: `result_scheduled_submission_${systemCall.systemCallId}`,
    resultKind: 'scheduled_submission_result',
    producer: {
      type: 'system_call',
      id: systemCall.systemCallId,
      operationalIdentityId: systemCall.payload?.requesterOperationalIdentityId ?? systemCall.requestedBy?.id ?? null,
    },
    lineage: {
      jobId: childJobId,
      processId: null,
      threadId: null,
      parentJobId: parentContext.jobId,
      parentProcessId: parentContext.processId,
      parentThreadId: parentContext.threadId,
      systemCallId: systemCall.systemCallId,
      timerId,
      invocationId: systemCall.correlation?.invocationId ?? null,
      toolRunId: systemCall.correlation?.toolRunId ?? null,
      workflowRunId: systemCall.correlation?.workflowRunId ?? null,
      conversationId: systemCall.correlation?.conversationId ?? systemCall.payload?.child?.conversationId ?? null,
    },
    status: submissionStatus,
    phase: submissionStatus === 'scheduled' ? 'scheduled' : 'submission',
    completion: {
      startedAt: systemCall.requestedAt,
      completedAt: result.processedAt,
      durationMs: calculateDurationMs(systemCall.requestedAt, result.processedAt),
      exitClass: mapSubmissionResultStatusToExitClass(submissionStatus),
    },
    summary: result.summary,
    artifactRefs: [],
    toolRunRefs: systemCall.correlation?.toolRunId ? [systemCall.correlation.toolRunId] : [],
    workflowRunRefs: systemCall.correlation?.workflowRunId ? [systemCall.correlation.workflowRunId] : [],
    childResultRefs: [],
    warnings: buildResultWarningsFromSystemCallResult({
      result,
      systemCall,
    }),
    failure: buildFailureFromSystemCallResult({
      result,
      systemCall,
    }),
    verification: {
      status: 'passed',
      grounded: true,
      details: {
        kernelDecisionAllowed: result.decision.allowed,
        systemCallStatus: result.status,
      },
    },
    visibility: {
      safeForHumanSummary: true,
      safeForAgentContext: true,
    },
    metadata: {
      actionType: 'schedule_delegation',
      systemCall: {
        systemCallId: systemCall.systemCallId,
        operation: systemCall.operation,
        status: result.status,
        idempotencyKey: systemCall.idempotencyKey,
        duplicateOfSystemCallId,
        originalSubmissionResultId,
      },
      policy: {
        allowed: result.decision.allowed,
        reason: result.decision.reason,
        authorizationRuleId: result.details?.authorizationRuleId ?? null,
        reasonCode: result.details?.reasonCode ?? null,
      },
      parent: {
        jobId: parentContext.jobId,
        processId: result.details?.parentProcessId ?? parentContext.processId,
        threadId: result.details?.parentThreadId ?? parentContext.threadId,
        processStatus: result.details?.parentProcessStatus ?? null,
        threadStatus: result.details?.parentThreadStatus ?? null,
        authorityMode: result.details?.parentAuthorityMode ?? null,
        authorityRequestedAt: result.details?.parentAuthorityRequestedAt ?? null,
        authoritySystemCallId: result.details?.parentAuthoritySystemCallId ?? null,
      },
      schedule: {
        childJobId,
        childJobStatus: result.details?.childJobStatus ?? (submissionStatus === 'scheduled' ? 'scheduled' : null),
        timerId,
        timerStatus: result.details?.timerStatus ?? (submissionStatus === 'scheduled' ? 'scheduled' : null),
        runAt: result.details?.runAt ?? systemCall.payload?.runAt ?? null,
        missedRunPolicy: result.details?.missedRunPolicy ?? systemCall.payload?.missedRunPolicy ?? null,
        targetOperationalIdentityId: result.details?.targetOperationalIdentityId
          ?? systemCall.payload?.targetOperationalIdentityId
          ?? null,
        childConversationId: result.details?.childConversationId ?? null,
        conversationHandoff: result.details?.conversationHandoff ?? null,
      },
      delivery: {
        mode: submissionStatus === 'scheduled' ? 'persist_only' : 'none',
        expectedBehavior: submissionStatus === 'scheduled'
          ? 'timer_release_then_child_result_persisted'
          : 'no_scheduled_child_work_created',
        childCompletionProven: false,
      },
    },
    createdAt: result.processedAt,
  };
}

async function persistResultRecordIfMissing({ adapter, resultRecord }) {
  try {
    return await adapter.persistResultRecord(resultRecord);
  } catch (error) {
    if (/already exists/u.test(error.message)) {
      return adapter.loadResultRecord(resultRecord.resultId);
    }

    throw error;
  }
}

async function materializeSubmissionResultRecord({
  adapter,
  systemCall,
  result,
}) {
  if (!systemCall || !['delegate', 'schedule_delegation'].includes(systemCall.operation)) {
    return null;
  }

  const resultRecordAdapter = assertResultRecordAdapter(adapter);
  const resultRecord = systemCall.operation === 'delegate'
    ? buildDelegationSubmissionResultRecord({
      systemCall,
      result,
    })
    : buildScheduledSubmissionResultRecord({
      systemCall,
      result,
    });

  return persistResultRecordIfMissing({
    adapter: resultRecordAdapter,
    resultRecord,
  });
}

function buildEmptyEffects(overrides = {}) {
  return {
    createdJobIds: [],
    createdTimerIds: [],
    createdSignalIds: [],
    createdProcessIds: [],
    createdThreadIds: [],
    eventIds: [],
    ...overrides,
  };
}

function createSystemCallResult({
  systemCallId,
  operation,
  status,
  processedAt,
  processedBy,
  allowed,
  reason,
  effects = {},
  summary,
  correlation = {},
  evidenceRefs = [],
  warnings = [],
  details = {},
}) {
  return assertOpenMasOsSystemCallResult({
    kind: OPENMAS_OS_SYSTEM_CALL_KINDS.result,
    schemaVersion: OPENMAS_OS_SYSTEM_CALL_SCHEMA_VERSION,
    systemCallId,
    operation,
    status,
    processedAt,
    processedBy,
    decision: {
      allowed,
      reason,
    },
    effects: buildEmptyEffects(effects),
    summary,
    correlation,
    evidenceRefs,
    warnings,
    details,
  });
}

function createFailedResultFromError({
  systemCallId,
  operation = 'invalid_request',
  processedAt,
  processedBy,
  error,
}) {
  const message = error?.message ?? String(error);

  return createSystemCallResult({
    systemCallId,
    operation,
    status: 'failed',
    processedAt,
    processedBy,
    allowed: false,
    reason: message,
    summary: `OpenMAS OS failed system call ${systemCallId}: ${message}`,
    details: {
      errorMessage: message,
    },
  });
}

function createExpiredResult({
  systemCall,
  processedAt,
  processedBy,
}) {
  return createSystemCallResult({
    systemCallId: systemCall.systemCallId,
    operation: systemCall.operation,
    status: 'expired',
    processedAt,
    processedBy,
    allowed: false,
    reason: `System call expired at ${systemCall.expiresAt}.`,
    summary: `OpenMAS OS expired system call ${systemCall.systemCallId} without kernel effects.`,
    correlation: systemCall.correlation,
    details: {
      idempotencyKey: systemCall.idempotencyKey,
      requestedAt: systemCall.requestedAt,
      expiresAt: systemCall.expiresAt,
    },
  });
}

function buildActionRequestFromSystemCall(systemCall) {
  const child = systemCall.payload.child ?? {};
  const payload = {
    targetOperationalIdentityId: systemCall.payload.targetOperationalIdentityId,
    task: child.input,
    command: child.command,
    mode: child.mode,
    priority: child.priority,
    reason: systemCall.payload.reason,
    contextRefs: child.contextRefs,
    artifactRefs: child.artifactRefs,
    expectedOutput: child.expectedOutput,
  };

  if (systemCall.operation === 'schedule_delegation') {
    payload.runAt = systemCall.payload.runAt;
    payload.missedRunPolicy = systemCall.payload.missedRunPolicy;
  }

  return {
    kind: OPENMAS_OS_ACTION_KINDS.request,
    schemaVersion: OPENMAS_OS_ACTION_SCHEMA_VERSION,
    actionRequestId: `os_action_request_${systemCall.systemCallId}`,
    actionType: systemCall.operation,
    requestedBy: {
      type: 'operational_identity',
      id: systemCall.payload.requesterOperationalIdentityId,
    },
    conversationId: child.conversationId ?? null,
    parentContext: resolveParentContext(systemCall),
    payload,
    createdAt: systemCall.requestedAt,
  };
}

function buildAllowedDelegationRule(policyDecision) {
  return [
    {
      ruleId: policyDecision.matchedRule.ruleId,
      fromOperationalIdentityId: policyDecision.matchedRule.fromOperationalIdentityId,
      toOperationalIdentityId: policyDecision.matchedRule.toOperationalIdentityId,
      programType: 'agent_invocation',
      command: policyDecision.matchedRule.command,
    },
  ];
}

function buildDelegationRequestFromSystemCall({ systemCall, policyDecision }) {
  const child = systemCall.payload.child;
  const delegationRequest = {
    delegationId: `delegation_${systemCall.systemCallId}`,
    childJobId: `job_${systemCall.systemCallId}`,
    assignedOperationalIdentityId: systemCall.payload.targetOperationalIdentityId,
    program: {
      type: 'agent_invocation',
      command: child.command,
      mode: child.mode,
    },
    inputRef: {
      type: 'inline_text',
      text: child.input,
    },
    conversationId: child.conversationId,
    priority: child.priority,
    contextRefs: child.contextRefs,
    artifactRefs: child.artifactRefs,
    policies: {
      requiresApproval: false,
      maxAttempts: 1,
      noOverlap: false,
    },
    policyEvidence: {
      ruleId: policyDecision.matchedRule.ruleId,
      actionType: systemCall.operation,
    },
  };

  if (systemCall.operation === 'schedule_delegation') {
    delegationRequest.runAt = systemCall.payload.runAt;
  }

  return delegationRequest;
}

async function resolveDelegationPolicy({
  projectRootPath,
  delegationPolicy,
}) {
  if (delegationPolicy !== undefined) {
    return delegationPolicy;
  }

  if (!isNonEmptyString(projectRootPath)) {
    return null;
  }

  const policyRead = await readDelegationPolicy({
    projectRootPath,
  });

  return policyRead.delegationPolicy;
}

function validateDelegationPrincipal(systemCall) {
  if (systemCall.requestedBy.type !== 'operational_identity') {
    return {
      valid: false,
      reason: 'System call requester must be an Operational Identity for delegation operations.',
    };
  }

  if (systemCall.requestedBy.id !== systemCall.payload.requesterOperationalIdentityId) {
    return {
      valid: false,
      reason: `System call requester ${systemCall.requestedBy.id} does not match payload requester ${systemCall.payload.requesterOperationalIdentityId}.`,
    };
  }

  return {
    valid: true,
    reason: null,
  };
}

function evaluateScheduledDelegationRunAt({
  systemCall,
  nowTimestamp,
}) {
  const runAtTimestamp = parseTimestamp(systemCall.payload.runAt);
  const nowTime = parseTimestamp(nowTimestamp);

  if (runAtTimestamp === null || nowTime === null || runAtTimestamp > nowTime) {
    return {
      allowed: true,
      reasonCode: null,
      reason: null,
      warnings: [],
    };
  }

  const latenessMs = nowTime - runAtTimestamp;

  if (
    systemCall.payload.missedRunPolicy === 'delay'
    && latenessMs <= SCHEDULE_DELEGATION_DELAY_GRACE_MS
  ) {
    return {
      allowed: true,
      reasonCode: 'scheduled_time_already_due_but_delay_allowed',
      reason: 'Scheduled delegation runAt is already due; missedRunPolicy delay allows the OpenMAS OS service to run it on the next eligible tick.',
      warnings: [
        'Scheduled delegation runAt is already due; missedRunPolicy delay allows the OpenMAS OS service to run it on the next eligible tick.',
      ],
    };
  }

  return {
    allowed: false,
    reasonCode: 'scheduled_time_not_future',
    reason: 'Scheduled delegation requires a future runAt timestamp.',
    warnings: [],
  };
}

async function evaluateSystemCallDelegationPolicy({
  systemCall,
  delegationPolicy,
}) {
  const principalValidation = validateDelegationPrincipal(systemCall);

  if (!principalValidation.valid) {
    return {
      authorized: false,
      reason: principalValidation.reason,
      matchedRule: null,
    };
  }

  return evaluateDelegationPolicy({
    actionRequest: buildActionRequestFromSystemCall(systemCall),
    delegationPolicy,
  });
}

async function handleDelegateSystemCall({
  systemCall,
  adapter,
  projectRootPath,
  osRootPath,
  delegationPolicy,
  delegationTargetReadinessEvaluator,
  processedAt,
  processedBy,
  now,
}) {
  const parentContext = assertParentContext(resolveParentContext(systemCall), systemCall.operation);
  const policyDecision = await evaluateSystemCallDelegationPolicy({
    systemCall,
    delegationPolicy,
  });

  if (!policyDecision.authorized) {
    return createSystemCallResult({
      systemCallId: systemCall.systemCallId,
      operation: systemCall.operation,
      status: 'denied',
      processedAt,
      processedBy,
      allowed: false,
      reason: policyDecision.reason,
      summary: `OpenMAS OS denied delegation system call ${systemCall.systemCallId}.`,
      correlation: systemCall.correlation,
      details: {
        idempotencyKey: systemCall.idempotencyKey,
        reasonCode: policyDecision.reasonCode ?? 'delegation_not_authorized',
      },
    });
  }

  const targetReadiness = await evaluateSystemCallDelegationTargetReadiness({
    systemCall,
    projectRootPath,
    osRootPath,
    delegationTargetReadinessEvaluator,
  });

  if (!targetReadiness.ready) {
    return createSystemCallResult({
      systemCallId: systemCall.systemCallId,
      operation: systemCall.operation,
      status: 'denied',
      processedAt,
      processedBy,
      allowed: false,
      reason: targetReadiness.reason,
      summary: `OpenMAS OS denied delegation system call ${systemCall.systemCallId} because the target Operational Identity is not ready.`,
      correlation: systemCall.correlation,
      details: {
        idempotencyKey: systemCall.idempotencyKey,
        reasonCode: targetReadiness.reasonCode,
        targetReadiness,
      },
    });
  }

  const delegationResult = await delegateToOperationalIdentity({
    adapter,
    projectRootPath,
    osRootPath,
    parentProcessId: parentContext.processId,
    parentThreadId: parentContext.threadId,
    delegation: buildDelegationRequestFromSystemCall({
      systemCall,
      policyDecision,
    }),
    allowedDelegations: buildAllowedDelegationRule(policyDecision),
    now,
  });

  if (!delegationResult.delegated) {
    return createSystemCallResult({
      systemCallId: systemCall.systemCallId,
      operation: systemCall.operation,
      status: 'denied',
      processedAt,
      processedBy,
      allowed: false,
      reason: delegationResult.reason,
      summary: `OpenMAS OS denied delegation system call ${systemCall.systemCallId}.`,
      correlation: systemCall.correlation,
      details: {
        idempotencyKey: systemCall.idempotencyKey,
        delegationId: delegationResult.delegationId,
        delegationStatus: delegationResult.status,
      },
    });
  }

  return createSystemCallResult({
    systemCallId: systemCall.systemCallId,
    operation: systemCall.operation,
    status: 'completed',
    processedAt,
    processedBy,
    allowed: true,
    reason: policyDecision.reason,
    effects: {
      createdJobIds: [
        delegationResult.childJob.jobId,
      ],
    },
    summary: `OpenMAS OS delegated ${systemCall.payload.requesterOperationalIdentityId} -> ${systemCall.payload.targetOperationalIdentityId}; child Job ${delegationResult.childJob.jobId} is ready.`,
    correlation: systemCall.correlation,
    details: {
      idempotencyKey: systemCall.idempotencyKey,
      delegationId: delegationResult.delegationId,
      authorizationRuleId: policyDecision.matchedRule.ruleId,
      parentProcessId: delegationResult.parentProcess.processId,
      parentThreadId: delegationResult.parentThread.threadId,
      parentProcessStatus: delegationResult.parentProcess.status,
      parentThreadStatus: delegationResult.parentThread.status,
      childJobId: delegationResult.childJob.jobId,
      childJobStatus: delegationResult.childJob.status,
      targetOperationalIdentityId: delegationResult.childJob.assignedOperationalIdentityId,
      childConversationId: delegationResult.childJob.conversationId,
      conversationHandoff: delegationResult.conversationHandoff ?? null,
      targetReadiness,
    },
    warnings: targetReadiness.warnings,
  });
}

async function handleScheduleDelegationSystemCall({
  systemCall,
  adapter,
  projectRootPath,
  osRootPath,
  delegationPolicy,
  delegationTargetReadinessEvaluator,
  processedAt,
  processedBy,
  now,
}) {
  const parentContext = assertParentContext(resolveParentContext(systemCall), systemCall.operation);
  const policyDecision = await evaluateSystemCallDelegationPolicy({
    systemCall,
    delegationPolicy,
  });

  if (!policyDecision.authorized) {
    return createSystemCallResult({
      systemCallId: systemCall.systemCallId,
      operation: systemCall.operation,
      status: 'denied',
      processedAt,
      processedBy,
      allowed: false,
      reason: policyDecision.reason,
      summary: `OpenMAS OS denied scheduled delegation system call ${systemCall.systemCallId}.`,
      correlation: systemCall.correlation,
      details: {
        idempotencyKey: systemCall.idempotencyKey,
        reasonCode: policyDecision.reasonCode ?? 'delegation_not_authorized',
      },
    });
  }

  const runAtEvaluation = evaluateScheduledDelegationRunAt({
    systemCall,
    nowTimestamp: processedAt,
  });

  if (!runAtEvaluation.allowed) {
    return createSystemCallResult({
      systemCallId: systemCall.systemCallId,
      operation: systemCall.operation,
      status: 'denied',
      processedAt,
      processedBy,
      allowed: false,
      reason: runAtEvaluation.reason,
      summary: `OpenMAS OS denied scheduled delegation system call ${systemCall.systemCallId} because runAt is not future.`,
      correlation: systemCall.correlation,
      details: {
        idempotencyKey: systemCall.idempotencyKey,
        reasonCode: runAtEvaluation.reasonCode,
        runAt: systemCall.payload.runAt,
        now: processedAt,
      },
    });
  }

  const targetReadiness = await evaluateSystemCallDelegationTargetReadiness({
    systemCall,
    projectRootPath,
    osRootPath,
    delegationTargetReadinessEvaluator,
  });

  if (!targetReadiness.ready) {
    return createSystemCallResult({
      systemCallId: systemCall.systemCallId,
      operation: systemCall.operation,
      status: 'denied',
      processedAt,
      processedBy,
      allowed: false,
      reason: targetReadiness.reason,
      summary: `OpenMAS OS denied scheduled delegation system call ${systemCall.systemCallId} because the target Operational Identity is not ready.`,
      correlation: systemCall.correlation,
      details: {
        idempotencyKey: systemCall.idempotencyKey,
        reasonCode: targetReadiness.reasonCode,
        targetReadiness,
      },
    });
  }

  const scheduleResult = await scheduleDelegationToOperationalIdentity({
    adapter,
    projectRootPath,
    osRootPath,
    parentProcessId: parentContext.processId,
    parentThreadId: parentContext.threadId,
    delegation: buildDelegationRequestFromSystemCall({
      systemCall,
      policyDecision,
    }),
    runAt: systemCall.payload.runAt,
    missedRunPolicy: systemCall.payload.missedRunPolicy,
    deliveryMode: 'persist_only',
    sourceSystemCallId: systemCall.systemCallId,
    allowedDelegations: buildAllowedDelegationRule(policyDecision),
    allowTerminalParentSnapshot: true,
    parentAuthoritySnapshot: buildParentAuthoritySnapshotFromSystemCall({
      systemCall,
      parentContext,
    }),
    now,
  });

  if (!scheduleResult.scheduled) {
    return createSystemCallResult({
      systemCallId: systemCall.systemCallId,
      operation: systemCall.operation,
      status: 'denied',
      processedAt,
      processedBy,
      allowed: false,
      reason: scheduleResult.reason,
      summary: `OpenMAS OS denied scheduled delegation system call ${systemCall.systemCallId}.`,
      correlation: systemCall.correlation,
      details: {
        idempotencyKey: systemCall.idempotencyKey,
        delegationId: scheduleResult.delegationId,
        delegationStatus: scheduleResult.status,
      },
    });
  }

  return createSystemCallResult({
    systemCallId: systemCall.systemCallId,
    operation: systemCall.operation,
    status: 'completed',
    processedAt,
    processedBy,
    allowed: true,
    reason: policyDecision.reason,
    effects: {
      createdJobIds: [
        scheduleResult.childJob.jobId,
      ],
      createdTimerIds: [
        scheduleResult.timer.timerId,
      ],
    },
    summary: `OpenMAS OS scheduled delegation ${systemCall.payload.requesterOperationalIdentityId} -> ${systemCall.payload.targetOperationalIdentityId} at ${scheduleResult.timer.runAt}; child Job ${scheduleResult.childJob.jobId} is scheduled.`,
    correlation: systemCall.correlation,
    details: {
      idempotencyKey: systemCall.idempotencyKey,
      delegationId: scheduleResult.delegationId,
      authorizationRuleId: policyDecision.matchedRule.ruleId,
      parentProcessId: scheduleResult.parentProcess.processId,
      parentThreadId: scheduleResult.parentThread.threadId,
      parentProcessStatus: scheduleResult.parentProcess.status,
      parentThreadStatus: scheduleResult.parentThread.status,
      parentAuthorityMode: scheduleResult.parentAuthority?.mode ?? null,
      parentAuthorityRequestedAt: scheduleResult.parentAuthority?.requestedAt ?? null,
      parentAuthoritySystemCallId: scheduleResult.parentAuthority?.systemCallId ?? null,
      childJobId: scheduleResult.childJob.jobId,
      childJobStatus: scheduleResult.childJob.status,
      timerId: scheduleResult.timer.timerId,
      timerStatus: scheduleResult.timer.status,
      runAt: scheduleResult.timer.runAt,
      missedRunPolicy: scheduleResult.timer.payload.missedRunPolicy,
      targetOperationalIdentityId: scheduleResult.childJob.assignedOperationalIdentityId,
      childConversationId: scheduleResult.childJob.conversationId,
      conversationHandoff: scheduleResult.conversationHandoff ?? null,
      targetReadiness,
    },
    warnings: [
      ...runAtEvaluation.warnings,
      ...targetReadiness.warnings,
    ],
  });
}

async function handleInspectStatusSystemCall({
  systemCall,
  adapter,
  inbox,
  processedAt,
  processedBy,
}) {
  const scope = systemCall.payload.scope;
  let details = {
    idempotencyKey: systemCall.idempotencyKey,
    scope,
    targetId: systemCall.payload.targetId,
  };

  if (scope === 'service' || scope === 'queue') {
    const pendingSystemCallIds = await inbox.listPendingSystemCallIds();
    details = {
      ...details,
      pendingSystemCallCount: pendingSystemCallIds.length,
    };
  } else if (scope === 'job') {
    details.job = await adapter.loadJob(systemCall.payload.targetId);
  } else if (scope === 'process') {
    details.process = await adapter.loadProcess(systemCall.payload.targetId);
  } else if (scope === 'thread') {
    details.thread = await adapter.loadThread(systemCall.payload.targetId);
  } else if (scope === 'timer') {
    details.timer = await adapter.loadTimer(systemCall.payload.targetId);
  } else if (scope === 'system_call') {
    details.systemCallResult = await inbox.loadSystemCallResult(systemCall.payload.targetId);
  }

  return createSystemCallResult({
    systemCallId: systemCall.systemCallId,
    operation: systemCall.operation,
    status: 'completed',
    processedAt,
    processedBy,
    allowed: true,
    reason: `OpenMAS OS inspected ${scope} status.`,
    summary: `OpenMAS OS inspected ${scope} status.`,
    correlation: systemCall.correlation,
    details,
  });
}

function createUnsupportedOperationResult({
  systemCall,
  processedAt,
  processedBy,
}) {
  return createSystemCallResult({
    systemCallId: systemCall.systemCallId,
    operation: systemCall.operation,
    status: 'failed',
    processedAt,
    processedBy,
    allowed: false,
    reason: `System call operation "${systemCall.operation}" is contract-valid but not implemented by the v1 processor yet.`,
    summary: `OpenMAS OS did not process system call ${systemCall.systemCallId}; operation "${systemCall.operation}" is not implemented yet.`,
    correlation: systemCall.correlation,
    warnings: [
      `Operation ${systemCall.operation} is reserved for a later processor slice.`,
    ],
    details: {
      idempotencyKey: systemCall.idempotencyKey,
      operation: systemCall.operation,
    },
  });
}

async function findExistingIdempotentResult({
  inbox,
  systemCall,
}) {
  if (!isNonEmptyString(systemCall.idempotencyKey)) {
    return null;
  }

  const existingResults = await inbox.listSystemCallResults({
    operation: systemCall.operation,
  });

  return existingResults.find((result) => {
    return result.systemCallId !== systemCall.systemCallId
      && result.details?.idempotencyKey === systemCall.idempotencyKey
      && result.details?.requestedById === systemCall.requestedBy.id;
  }) ?? null;
}

function buildIdempotentReplayResult({
  systemCall,
  existingResult,
  processedAt,
  processedBy,
}) {
  const status = existingResult.status;

  return createSystemCallResult({
    systemCallId: systemCall.systemCallId,
    operation: systemCall.operation,
    status,
    processedAt,
    processedBy,
    allowed: existingResult.decision.allowed,
    reason: `System call reused existing idempotent result from ${existingResult.systemCallId}.`,
    summary: `OpenMAS OS reused idempotent result ${existingResult.systemCallId} for system call ${systemCall.systemCallId}.`,
    correlation: systemCall.correlation,
    details: {
      idempotencyKey: systemCall.idempotencyKey,
      requestedById: systemCall.requestedBy.id,
      duplicateOfSystemCallId: existingResult.systemCallId,
      reusedResultStatus: existingResult.status,
      reusedEffects: existingResult.effects,
    },
  });
}

async function loadRuntimeSnapshotIfPresent(loader) {
  try {
    return await loader();
  } catch (error) {
    if (error?.message?.includes('was not found')) {
      return null;
    }

    throw error;
  }
}

async function findExistingMaterializedSystemCallEffects({
  adapter,
  systemCall,
}) {
  if (systemCall.operation === 'delegate') {
    const childJobId = `job_${systemCall.systemCallId}`;
    const childJob = await loadRuntimeSnapshotIfPresent(() => adapter.loadJob(childJobId));

    if (!childJob) {
      return null;
    }

    return {
      status: 'completed',
      effects: {
        createdJobIds: [childJob.jobId],
      },
      details: {
        recoveryStatus: 'recovered_existing_materialized_effects',
        recoveryReasonCode: 'processing_system_call_effects_found',
        childJobId: childJob.jobId,
        childJobStatus: childJob.status,
        targetOperationalIdentityId: childJob.assignedOperationalIdentityId,
        childConversationId: childJob.conversationId,
      },
      summary: `OpenMAS OS recovered existing delegated child Job ${childJob.jobId} for system call ${systemCall.systemCallId}.`,
    };
  }

  if (systemCall.operation === 'schedule_delegation') {
    const childJobId = `job_${systemCall.systemCallId}`;
    const timerId = `timer_${childJobId}`;
    const childJob = await loadRuntimeSnapshotIfPresent(() => adapter.loadJob(childJobId));
    const timer = await loadRuntimeSnapshotIfPresent(() => adapter.loadTimer(timerId));

    if (!childJob || !timer) {
      return null;
    }

    return {
      status: 'completed',
      effects: {
        createdJobIds: [childJob.jobId],
        createdTimerIds: [timer.timerId],
      },
      details: {
        recoveryStatus: 'recovered_existing_materialized_effects',
        recoveryReasonCode: 'processing_system_call_effects_found',
        childJobId: childJob.jobId,
        childJobStatus: childJob.status,
        timerId: timer.timerId,
        timerStatus: timer.status,
        runAt: timer.runAt,
        missedRunPolicy: timer.payload?.missedRunPolicy ?? null,
        targetOperationalIdentityId: childJob.assignedOperationalIdentityId,
        childConversationId: childJob.conversationId,
      },
      summary: `OpenMAS OS recovered existing scheduled delegation child Job ${childJob.jobId} and Timer ${timer.timerId} for system call ${systemCall.systemCallId}.`,
    };
  }

  return null;
}

async function buildRecoveredMaterializedSystemCallResult({
  adapter,
  systemCall,
  processedAt,
  processedBy,
}) {
  const recoveredEffects = await findExistingMaterializedSystemCallEffects({
    adapter,
    systemCall,
  });

  if (!recoveredEffects) {
    return null;
  }

  return createSystemCallResult({
    systemCallId: systemCall.systemCallId,
    operation: systemCall.operation,
    status: recoveredEffects.status,
    processedAt,
    processedBy,
    allowed: true,
    reason: 'OpenMAS OS recovered a processing system call whose kernel effects were already materialized.',
    effects: recoveredEffects.effects,
    summary: recoveredEffects.summary,
    correlation: systemCall.correlation,
    warnings: [
      'OpenMAS OS recovered an in-flight processing system call from already materialized kernel effects.',
    ],
    details: {
      idempotencyKey: systemCall.idempotencyKey,
      ...recoveredEffects.details,
    },
  });
}

async function processLoadedSystemCall({
  systemCall,
  adapter,
  inbox,
  projectRootPath,
  osRootPath,
  delegationPolicy,
  delegationTargetReadinessEvaluator,
  nowTimestamp,
  processedBy,
  now,
  allowMaterializedEffectRecovery = false,
}) {
  if (await inbox.hasSystemCallResult(systemCall.systemCallId)) {
    return inbox.loadSystemCallResult(systemCall.systemCallId);
  }

  const recoveredMaterializedResult = allowMaterializedEffectRecovery
    ? await buildRecoveredMaterializedSystemCallResult({
      adapter,
      systemCall,
      processedAt: nowTimestamp,
      processedBy,
    })
    : null;

  if (recoveredMaterializedResult) {
    return recoveredMaterializedResult;
  }

  if (isExpired(systemCall, nowTimestamp)) {
    return createExpiredResult({
      systemCall,
      processedAt: nowTimestamp,
      processedBy,
    });
  }

  const existingIdempotentResult = await findExistingIdempotentResult({
    inbox,
    systemCall,
  });

  if (existingIdempotentResult) {
    return buildIdempotentReplayResult({
      systemCall,
      existingResult: existingIdempotentResult,
      processedAt: nowTimestamp,
      processedBy,
    });
  }

  if (systemCall.operation === 'delegate') {
    return handleDelegateSystemCall({
      systemCall,
      adapter,
      projectRootPath,
      osRootPath,
      delegationPolicy,
      delegationTargetReadinessEvaluator,
      processedAt: nowTimestamp,
      processedBy,
      now,
    });
  }

  if (systemCall.operation === 'schedule_delegation') {
    return handleScheduleDelegationSystemCall({
      systemCall,
      adapter,
      projectRootPath,
      osRootPath,
      delegationPolicy,
      delegationTargetReadinessEvaluator,
      processedAt: nowTimestamp,
      processedBy,
      now,
    });
  }

  if (systemCall.operation === 'inspect_status') {
    return handleInspectStatusSystemCall({
      systemCall,
      adapter,
      inbox,
      processedAt: nowTimestamp,
      processedBy,
    });
  }

  return createUnsupportedOperationResult({
    systemCall,
    processedAt: nowTimestamp,
    processedBy,
  });
}

async function persistResultAndMoveSystemCall({
  adapter,
  inbox,
  systemCall = null,
  systemCallId,
  fromState,
  result,
}) {
  if (!(await inbox.hasSystemCallResult(systemCallId))) {
    await inbox.persistSystemCallResult(result);
  }

  await materializeSubmissionResultRecord({
    adapter,
    systemCall,
    result,
  });

  const toState = resultStatusToSystemCallState(result.status);
  await inbox.moveSystemCall({
    systemCallId,
    fromState,
    toState,
  });
  const callerSettlement = await terminalizeDelegationSystemCallCaller({
    adapter,
    systemCall,
    result,
  });

  return {
    result,
    finalState: toState,
    callerSettlement,
  };
}

export async function reconcileTerminalDelegationSystemCallCallers({
  adapter = null,
  inbox = null,
  projectRootPath = null,
  osRootPath = null,
  observedAt = defaultNow(),
} = {}) {
  const runtimeAdapter = assertAdapter(createAdapter({ adapter, projectRootPath, osRootPath }));
  const runtimeInbox = assertInbox(createInbox({ inbox, projectRootPath, osRootPath }));
  const reconciliation = {
    status: 'completed',
    observedAt,
    scannedResultCount: 0,
    candidateCount: 0,
    terminalizedCount: 0,
    ignoredCount: 0,
    failedCount: 0,
    terminalized: [],
    failures: [],
  };
  let terminalResults;

  try {
    terminalResults = (await runtimeInbox.listSystemCallResults({
      operation: 'delegate',
    })).filter((result) => {
      return TERMINAL_DELEGATION_SYSTEM_CALL_FAILURE_STATUSES.has(result.status);
    });
    reconciliation.scannedResultCount = terminalResults.length;
  } catch (error) {
    reconciliation.status = 'completed_with_failures';
    reconciliation.failedCount = 1;
    reconciliation.failures.push({
      systemCallId: null,
      errorMessage: createSafeErrorMessage(
        error,
        'OpenMAS OS could not scan terminal delegation System Call Results.',
      ),
    });
    return reconciliation;
  }

  for (const result of terminalResults) {
    try {
      const systemCall = await runtimeInbox.loadSystemCall(
        result.systemCallId,
        resultStatusToSystemCallState(result.status),
      );
      const callerSettlement = await terminalizeDelegationSystemCallCaller({
        adapter: runtimeAdapter,
        systemCall,
        result,
      });

      if (callerSettlement.status === 'failed') {
        reconciliation.failedCount += 1;
        reconciliation.failures.push({
          systemCallId: result.systemCallId,
          errorMessage: callerSettlement.errorMessage,
        });
        continue;
      }

      if (callerSettlement.terminalized) {
        reconciliation.candidateCount += 1;
        reconciliation.terminalizedCount += 1;
        reconciliation.terminalized.push(callerSettlement);
        continue;
      }

      reconciliation.ignoredCount += 1;
    } catch (error) {
      reconciliation.failedCount += 1;
      reconciliation.failures.push({
        systemCallId: result.systemCallId,
        errorMessage: createSafeErrorMessage(
          error,
          'OpenMAS OS could not reconcile a terminal delegation System Call caller.',
        ),
      });
    }
  }

  if (reconciliation.failedCount > 0) {
    reconciliation.status = 'completed_with_failures';
  }

  return reconciliation;
}

export class KernelSystemCallProcessor {
  constructor({
    inbox = null,
    adapter = null,
    projectRootPath = null,
    osRootPath = null,
    delegationPolicy = undefined,
    delegationTargetReadinessEvaluator = evaluateDelegationTargetReadiness,
    now = defaultNow,
    serviceId = DEFAULT_SERVICE_ID,
    tickId = null,
    maxSystemCallsPerRun = DEFAULT_MAX_SYSTEM_CALLS_PER_RUN,
  } = {}) {
    this.projectRootPath = projectRootPath;
    this.osRootPath = osRootPath;
    this.inbox = assertInbox(createInbox({ inbox, projectRootPath, osRootPath }));
    this.adapter = assertAdapter(createAdapter({ adapter, projectRootPath, osRootPath }));
    this.delegationPolicy = delegationPolicy;
    this.delegationTargetReadinessEvaluator = normalizeDelegationTargetReadinessEvaluator(
      delegationTargetReadinessEvaluator,
    );
    this.now = normalizeNow(now);
    this.serviceId = isNonEmptyString(serviceId) ? serviceId.trim() : DEFAULT_SERVICE_ID;
    this.tickId = tickId;
    this.maxSystemCallsPerRun = assertMaxSystemCallsPerRun(maxSystemCallsPerRun);
  }

  async processPendingSystemCalls(options = {}) {
    const nowTimestamp = this.now();
    const processedBy = buildProcessedBy({
      serviceId: options.serviceId ?? this.serviceId,
      tickId: options.tickId ?? this.tickId,
    });
    const maxSystemCallsPerRun = assertMaxSystemCallsPerRun(
      options.maxSystemCallsPerRun ?? this.maxSystemCallsPerRun,
    );
    const delegationPolicy = await resolveDelegationPolicy({
      projectRootPath: this.projectRootPath,
      delegationPolicy: options.delegationPolicy ?? this.delegationPolicy,
    });
    const processingSystemCallIds = (await this.inbox.listSystemCallIds('processing'))
      .slice(0, maxSystemCallsPerRun);
    const pendingSystemCallIds = (await this.inbox.listPendingSystemCallIds())
      .slice(0, Math.max(0, maxSystemCallsPerRun - processingSystemCallIds.length));
    const results = [];

    for (const systemCallId of processingSystemCallIds) {
      results.push(await this.processSystemCallFromState({
        systemCallId,
        sourceState: 'processing',
        nowTimestamp,
        processedBy,
        delegationPolicy,
      }));
    }

    for (const systemCallId of pendingSystemCallIds) {
      results.push(await this.processSystemCallFromState({
        systemCallId,
        sourceState: 'pending',
        nowTimestamp,
        processedBy,
        delegationPolicy,
      }));
    }

    return {
      kind: 'openmas_os_system_call_processor_result',
      version: 1,
      processedAt: nowTimestamp,
      processedBy,
      processedCount: results.length,
      completedCount: results.filter((result) => result.finalState === 'completed').length,
      deniedCount: results.filter((result) => result.finalState === 'denied').length,
      failedCount: results.filter((result) => result.finalState === 'failed').length,
      expiredCount: results.filter((result) => result.finalState === 'expired').length,
      cancelledCount: results.filter((result) => result.finalState === 'cancelled').length,
      recoveredProcessingCount: results.filter((result) => result.recoveredFromState === 'processing').length,
      results,
    };
  }

  async processSystemCallFromState({
    systemCallId,
    sourceState = 'pending',
    nowTimestamp = this.now(),
    processedBy = buildProcessedBy({
      serviceId: this.serviceId,
      tickId: this.tickId,
    }),
    delegationPolicy = this.delegationPolicy,
  } = {}) {
    let systemCall = null;

    try {
      systemCall = await this.inbox.loadSystemCall(systemCallId, sourceState);
    } catch (error) {
      const failedResult = createFailedResultFromError({
        systemCallId,
        processedAt: nowTimestamp,
        processedBy,
        error,
      });

      const resultState = await persistResultAndMoveSystemCall({
        adapter: this.adapter,
        inbox: this.inbox,
        systemCallId,
        fromState: sourceState,
        result: failedResult,
      });

      return {
        ...resultState,
        recoveredFromState: sourceState === 'processing' ? 'processing' : null,
      };
    }

    if (sourceState === 'pending') {
      await this.inbox.moveSystemCall({
        systemCallId: systemCall.systemCallId,
        fromState: 'pending',
        toState: 'processing',
      });
    }

    const resultState = await this.processLoadedSystemCall({
      systemCall,
      nowTimestamp,
      processedBy,
      delegationPolicy,
      allowMaterializedEffectRecovery: sourceState === 'processing',
    });

    return {
      ...resultState,
      recoveredFromState: sourceState === 'processing' ? 'processing' : null,
    };
  }

  async processPendingSystemCall({
    systemCallId,
    nowTimestamp = this.now(),
    processedBy = buildProcessedBy({
      serviceId: this.serviceId,
      tickId: this.tickId,
    }),
    delegationPolicy = this.delegationPolicy,
  } = {}) {
    return this.processSystemCallFromState({
      systemCallId,
      sourceState: 'pending',
      nowTimestamp,
      processedBy,
      delegationPolicy,
    });
  }

  async processLoadedSystemCall({
    systemCall,
    nowTimestamp = this.now(),
    processedBy = buildProcessedBy({
      serviceId: this.serviceId,
      tickId: this.tickId,
    }),
    delegationPolicy = this.delegationPolicy,
    allowMaterializedEffectRecovery = false,
  } = {}) {
    try {
      const result = await processLoadedSystemCall({
        systemCall,
        adapter: this.adapter,
        inbox: this.inbox,
        projectRootPath: this.projectRootPath,
        osRootPath: this.osRootPath,
        delegationPolicy,
        delegationTargetReadinessEvaluator: this.delegationTargetReadinessEvaluator,
        nowTimestamp,
        processedBy,
        now: this.now,
        allowMaterializedEffectRecovery,
      });
      const resultWithProcessorDetails = assertOpenMasOsSystemCallResult({
        ...result,
        details: {
          ...result.details,
          idempotencyKey: systemCall.idempotencyKey,
          requestedById: systemCall.requestedBy.id,
          requestedAt: systemCall.requestedAt,
        },
      });

      return persistResultAndMoveSystemCall({
        adapter: this.adapter,
        inbox: this.inbox,
        systemCall,
        systemCallId: systemCall.systemCallId,
        fromState: 'processing',
        result: resultWithProcessorDetails,
      });
    } catch (error) {
      const failedResult = createFailedResultFromError({
        systemCallId: systemCall.systemCallId,
        operation: systemCall.operation,
        processedAt: nowTimestamp,
        processedBy,
        error,
      });
      const resultWithProcessorDetails = assertOpenMasOsSystemCallResult({
        ...failedResult,
        correlation: systemCall.correlation,
        details: {
          ...failedResult.details,
          idempotencyKey: systemCall.idempotencyKey,
          requestedById: systemCall.requestedBy.id,
          requestedAt: systemCall.requestedAt,
        },
      });

      return persistResultAndMoveSystemCall({
        adapter: this.adapter,
        inbox: this.inbox,
        systemCall,
        systemCallId: systemCall.systemCallId,
        fromState: 'processing',
        result: resultWithProcessorDetails,
      });
    }
  }
}

export function createKernelSystemCallProcessor(options = {}) {
  return new KernelSystemCallProcessor(options);
}
