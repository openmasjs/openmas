import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  OPENMAS_OS_KINDS,
  OPENMAS_OS_SCHEMA_VERSION,
  OPENMAS_OS_TERMINAL_PROCESS_STATUSES,
  assertOpenMasOsJob,
  assertSafeOsSerializableValue,
} from '../../contracts/os/openmas-os-runtime-contract.js';
import {
  OPENMAS_OS_RESULT_RECORD_KINDS,
  OPENMAS_OS_RESULT_RECORD_SCHEMA_VERSION,
  createOpenMasOsResultSummaryFromRecord,
} from '../../contracts/os/openmas-os-result-record-contract.js';
import { createLocalRuntimeAdapter } from '../adapters/local-runtime-adapter.js';
import { runJobNow } from '../manual-job-execution.js';
import { scheduleOneShotJob } from '../scheduler/one-shot-scheduled-jobs.js';
import { runAgentInvocation } from '../../invocation/run-agent-invocation.js';
import { readConversationSession } from '../../conversations/read-conversation-session.js';
import {
  applySignal,
  createOpenMasOsSignal,
} from '../signals/signal-manager.js';
import {
  createSafeErrorMessage,
  createSafeFailureSummaryFromInvocationResult,
} from '../failure-summary.js';

const TERMINAL_THREAD_STATUSES = new Set([
  'completed',
  'failed',
  'cancelled',
]);
const TERMINAL_CHILD_JOB_STATUSES = new Set([
  'completed',
  'failed',
  'cancelled',
]);

const PARENT_RESUME_RESULT_KIND = 'openmas_os_parent_resume_result';
const PARENT_RESUME_RESULT_VERSION = 1;

const CHILD_RESULT_SUMMARY_KIND = 'openmas_os_child_result_summary';
const CHILD_RESULT_SUMMARY_VERSION = 1;
const PROCESS_DELEGATION_LOCKS = new Map();

function createSystemActor() {
  return {
    type: 'system',
    id: 'openmas-os',
  };
}

function createRuntimeId(prefix) {
  return `${prefix}_${randomUUID()}`;
}

function createEventId() {
  return `event_${randomUUID()}`;
}

function defaultNow() {
  return new Date().toISOString();
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function safeTrimmedString(value, fallback = null) {
  return isNonEmptyString(value) ? value.trim() : fallback;
}

function normalizeNow(now) {
  if (now === undefined || now === null) {
    return defaultNow;
  }

  if (typeof now !== 'function') {
    throw new Error('OpenMAS OS Delegation Manager now must be a function when provided.');
  }

  return now;
}

async function withProcessDelegationLock(processId, operation) {
  const lockId = isNonEmptyString(processId) ? processId.trim() : 'unknown_process';
  const previousLock = PROCESS_DELEGATION_LOCKS.get(lockId) ?? Promise.resolve();
  let releaseLock;
  const currentLock = new Promise((resolve) => {
    releaseLock = resolve;
  });
  const queuedLock = previousLock.catch(() => {}).then(() => currentLock);

  PROCESS_DELEGATION_LOCKS.set(lockId, queuedLock);
  await previousLock.catch(() => {});

  try {
    return await operation();
  } finally {
    releaseLock();

    if (PROCESS_DELEGATION_LOCKS.get(lockId) === queuedLock) {
      PROCESS_DELEGATION_LOCKS.delete(lockId);
    }
  }
}

function createAdapter({ adapter = null, projectRootPath = null, osRootPath = null } = {}) {
  return adapter ?? createLocalRuntimeAdapter({ projectRootPath, osRootPath });
}

function assertAdapter(adapter) {
  if (!adapter || typeof adapter !== 'object') {
    throw new Error('OpenMAS OS Delegation Manager requires a runtime adapter.');
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
    throw new Error('OpenMAS OS runtime adapter must implement persistResultRecord for Delegation Result materialization.');
  }

  if (typeof adapter.loadResultRecord !== 'function') {
    throw new Error('OpenMAS OS runtime adapter must implement loadResultRecord for Delegation Result materialization.');
  }

  return adapter;
}

function assertDelegationRequest(delegation) {
  if (!isPlainObject(delegation)) {
    throw new Error('OpenMAS OS Delegation request must be an object.');
  }

  const safeDelegation = assertSafeOsSerializableValue(delegation, 'OpenMAS OS Delegation request');

  if (!isNonEmptyString(safeDelegation.assignedOperationalIdentityId)) {
    throw new Error('OpenMAS OS Delegation request must include assignedOperationalIdentityId.');
  }

  return safeDelegation;
}

function assertParentThreadOwnership({ parentProcess, parentThread }) {
  if (parentThread.processId !== parentProcess.processId) {
    throw new Error(`OpenMAS OS Thread ${parentThread.threadId} does not belong to Process ${parentProcess.processId}.`);
  }

  if (parentThread.jobId !== parentProcess.jobId) {
    throw new Error(`OpenMAS OS Thread ${parentThread.threadId} does not belong to Job ${parentProcess.jobId}.`);
  }
}

function assertParentState({ parentProcess, parentThread }) {
  assertParentThreadOwnership({
    parentProcess,
    parentThread,
  });

  if (OPENMAS_OS_TERMINAL_PROCESS_STATUSES.has(parentProcess.status)) {
    throw new Error(`OpenMAS OS Process ${parentProcess.processId} cannot delegate after reaching terminal status "${parentProcess.status}".`);
  }

  if (TERMINAL_THREAD_STATUSES.has(parentThread.status)) {
    throw new Error(`OpenMAS OS Thread ${parentThread.threadId} cannot delegate after reaching terminal status "${parentThread.status}".`);
  }

  const parentIsRunning = parentProcess.status === 'running' && parentThread.status === 'running';
  const parentIsWaitingForSystemCall = parentProcess.status === 'blocked'
    && parentThread.status === 'blocked'
    && parentThread.waitReason === 'waiting_for_system_call';

  if (!parentIsRunning && !parentIsWaitingForSystemCall) {
    throw new Error(
      `OpenMAS OS Process ${parentProcess.processId} and Thread ${parentThread.threadId}`
      + ' must be running before delegation, or waiting for a delegation system call before kernel completion.'
      + ` Current process status: ${parentProcess.status}; thread status: ${parentThread.status}; waitReason: ${parentThread.waitReason}.`,
    );
  }

  if (parentProcess.currentThreadId !== parentThread.threadId) {
    throw new Error(`OpenMAS OS Thread ${parentThread.threadId} is not the current Thread for Process ${parentProcess.processId}.`);
  }
}

function parseTimestampMs(timestamp) {
  if (!isNonEmptyString(timestamp)) {
    return null;
  }

  const timestampMs = Date.parse(timestamp.trim());

  return Number.isFinite(timestampMs) ? timestampMs : null;
}

function normalizeParentAuthoritySnapshot(parentAuthoritySnapshot) {
  if (!isPlainObject(parentAuthoritySnapshot)) {
    return null;
  }

  return {
    source: safeTrimmedString(parentAuthoritySnapshot.source, 'system_call'),
    systemCallId: safeTrimmedString(parentAuthoritySnapshot.systemCallId),
    operation: safeTrimmedString(parentAuthoritySnapshot.operation),
    requestedAt: safeTrimmedString(parentAuthoritySnapshot.requestedAt),
    jobId: safeTrimmedString(parentAuthoritySnapshot.jobId),
    processId: safeTrimmedString(parentAuthoritySnapshot.processId),
    threadId: safeTrimmedString(parentAuthoritySnapshot.threadId),
    invocationId: safeTrimmedString(parentAuthoritySnapshot.invocationId),
  };
}

function assertSnapshotMatchesParent({
  snapshot,
  parentProcess,
  parentThread,
}) {
  if (!snapshot) {
    return;
  }

  if (isNonEmptyString(snapshot.jobId) && snapshot.jobId !== parentProcess.jobId) {
    throw new Error(`OpenMAS OS scheduled delegation authority snapshot Job ${snapshot.jobId} does not match parent Job ${parentProcess.jobId}.`);
  }

  if (isNonEmptyString(snapshot.processId) && snapshot.processId !== parentProcess.processId) {
    throw new Error(`OpenMAS OS scheduled delegation authority snapshot Process ${snapshot.processId} does not match parent Process ${parentProcess.processId}.`);
  }

  if (isNonEmptyString(snapshot.threadId) && snapshot.threadId !== parentThread.threadId) {
    throw new Error(`OpenMAS OS scheduled delegation authority snapshot Thread ${snapshot.threadId} does not match parent Thread ${parentThread.threadId}.`);
  }
}

function resolveTerminalTimestampMs(record, label) {
  const timestamp = record.completedAt ?? record.failedAt ?? record.cancelledAt ?? record.updatedAt;
  const timestampMs = parseTimestampMs(timestamp);

  if (timestampMs === null) {
    throw new Error(`OpenMAS OS ${label} ${record.processId ?? record.threadId ?? record.jobId} is terminal but has no valid terminal timestamp.`);
  }

  return {
    timestamp,
    timestampMs,
  };
}

function assertScheduledParentAuthority({
  parentProcess,
  parentThread,
  allowTerminalParentSnapshot = false,
  parentAuthoritySnapshot = null,
}) {
  const snapshot = normalizeParentAuthoritySnapshot(parentAuthoritySnapshot);

  assertParentThreadOwnership({
    parentProcess,
    parentThread,
  });
  assertSnapshotMatchesParent({
    snapshot,
    parentProcess,
    parentThread,
  });

  const parentProcessIsTerminal = OPENMAS_OS_TERMINAL_PROCESS_STATUSES.has(parentProcess.status);
  const parentThreadIsTerminal = TERMINAL_THREAD_STATUSES.has(parentThread.status);

  if (!parentProcessIsTerminal && !parentThreadIsTerminal) {
    assertParentState({
      parentProcess,
      parentThread,
    });

    return {
      mode: 'live_parent',
      requestedAt: snapshot?.requestedAt ?? null,
      systemCallId: snapshot?.systemCallId ?? null,
      source: snapshot?.source ?? null,
    };
  }

  if (!allowTerminalParentSnapshot) {
    assertParentState({
      parentProcess,
      parentThread,
    });
  }

  if (!parentProcessIsTerminal || !parentThreadIsTerminal) {
    throw new Error(
      `OpenMAS OS scheduled delegation authority for Process ${parentProcess.processId}`
      + ` and Thread ${parentThread.threadId} must be either live together or terminal together.`
      + ` Current process status: ${parentProcess.status}; thread status: ${parentThread.status}.`,
    );
  }

  if (!snapshot || !isNonEmptyString(snapshot.requestedAt)) {
    throw new Error('OpenMAS OS scheduled delegation from a terminal parent requires a system-call authority snapshot with requestedAt.');
  }

  if (!isNonEmptyString(snapshot.processId) || !isNonEmptyString(snapshot.threadId)) {
    throw new Error('OpenMAS OS scheduled delegation from a terminal parent requires a system-call authority snapshot with processId and threadId.');
  }

  const requestedAtMs = parseTimestampMs(snapshot.requestedAt);

  if (requestedAtMs === null) {
    throw new Error(`OpenMAS OS scheduled delegation authority snapshot requestedAt is not a valid timestamp: ${snapshot.requestedAt}`);
  }

  const processTerminalAt = resolveTerminalTimestampMs(parentProcess, 'Process');
  const threadTerminalAt = resolveTerminalTimestampMs(parentThread, 'Thread');

  if (requestedAtMs > processTerminalAt.timestampMs) {
    throw new Error(
      `OpenMAS OS scheduled delegation authority snapshot for Process ${parentProcess.processId}`
      + ` was requested at ${snapshot.requestedAt}, after the Process terminal timestamp ${processTerminalAt.timestamp}.`,
    );
  }

  if (requestedAtMs > threadTerminalAt.timestampMs) {
    throw new Error(
      `OpenMAS OS scheduled delegation authority snapshot for Thread ${parentThread.threadId}`
      + ` was requested at ${snapshot.requestedAt}, after the Thread terminal timestamp ${threadTerminalAt.timestamp}.`,
    );
  }

  return {
    mode: 'terminal_parent_snapshot',
    requestedAt: snapshot.requestedAt,
    systemCallId: snapshot.systemCallId,
    source: snapshot.source,
  };
}

function assertScheduledRunAt(runAt) {
  if (!isNonEmptyString(runAt)) {
    throw new Error('OpenMAS OS scheduled delegation requires a runAt timestamp.');
  }

  const normalizedRunAt = runAt.trim();
  const timestampMs = Date.parse(normalizedRunAt);

  if (!Number.isFinite(timestampMs)) {
    throw new Error(`OpenMAS OS scheduled delegation runAt is not a valid timestamp: ${runAt}`);
  }

  return normalizedRunAt;
}

function matchesRuleValue(ruleValue, expectedValue) {
  if (ruleValue === undefined || ruleValue === null || ruleValue === '') {
    return true;
  }

  if (ruleValue === '*') {
    return true;
  }

  if (Array.isArray(ruleValue)) {
    return ruleValue.includes('*') || ruleValue.includes(expectedValue);
  }

  return ruleValue === expectedValue;
}

function resolveRuleFrom(rule) {
  return rule.fromOperationalIdentityId ?? rule.from ?? rule.sourceOperationalIdentityId;
}

function resolveRuleTo(rule) {
  return rule.toOperationalIdentityId ?? rule.to ?? rule.targetOperationalIdentityId;
}

function resolveRuleId(rule, index) {
  return isNonEmptyString(rule.ruleId) ? rule.ruleId.trim() : `delegation_rule_${index + 1}`;
}

function matchDelegationRule({ rule, index, fromOperationalIdentityId, delegation }) {
  if (!isPlainObject(rule)) {
    return null;
  }

  if (rule.effect === 'deny' || rule.allow === false) {
    return null;
  }

  const programType = delegation.program?.type ?? 'agent_invocation';
  const command = delegation.program?.command ?? 'ask';

  if (!matchesRuleValue(resolveRuleFrom(rule), fromOperationalIdentityId)) {
    return null;
  }

  if (!matchesRuleValue(resolveRuleTo(rule), delegation.assignedOperationalIdentityId)) {
    return null;
  }

  if (!matchesRuleValue(rule.programType, programType)) {
    return null;
  }

  if (!matchesRuleValue(rule.command, command)) {
    return null;
  }

  return {
    ruleId: resolveRuleId(rule, index),
    fromOperationalIdentityId,
    toOperationalIdentityId: delegation.assignedOperationalIdentityId,
    programType,
    command,
  };
}

export function authorizeDelegation({
  parentProcess,
  delegation,
  allowedDelegations = [],
} = {}) {
  if (!Array.isArray(allowedDelegations) || allowedDelegations.length === 0) {
    return {
      authorized: false,
      reason: 'no_delegation_rules',
    };
  }

  const fromOperationalIdentityId = parentProcess?.operationalIdentityId;

  for (const [index, rule] of allowedDelegations.entries()) {
    const matchedRule = matchDelegationRule({
      rule,
      index,
      fromOperationalIdentityId,
      delegation,
    });

    if (matchedRule) {
      return {
        authorized: true,
        reason: 'allowed_by_rule',
        rule: matchedRule,
      };
    }
  }

  return {
    authorized: false,
    reason: 'no_matching_delegation_rule',
  };
}

async function appendDelegationEvent({
  adapter,
  eventType,
  source = createSystemActor(),
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

function createChildJob({
  delegation,
  parentJob,
  parentProcess,
  parentThread,
  conversationId,
  status = 'ready',
  trigger = {
    type: 'manual',
  },
  nowTimestamp,
}) {
  const program = delegation.program ?? {};

  return assertOpenMasOsJob({
    kind: OPENMAS_OS_KINDS.job,
    schemaVersion: OPENMAS_OS_SCHEMA_VERSION,
    jobId: delegation.childJobId ?? createRuntimeId('job'),
    projectId: delegation.projectId ?? parentJob.projectId,
    status,
    createdBy: {
      type: 'process',
      id: parentProcess.processId,
    },
    assignedOperationalIdentityId: delegation.assignedOperationalIdentityId,
    program: {
      type: program.type ?? 'agent_invocation',
      command: program.command ?? 'ask',
      mode: program.mode ?? 'deterministic',
      programId: program.programId,
    },
    inputRef: delegation.inputRef ?? {
      type: 'none',
    },
    conversationId,
    trigger,
    priority: delegation.priority ?? parentThread.priority,
    policies: {
      requiresApproval: false,
      maxAttempts: 1,
      noOverlap: false,
      ...(delegation.policies ?? {}),
    },
    createdAt: nowTimestamp,
    updatedAt: nowTimestamp,
  });
}

function getRequestedChildConversationId({ delegation, parentProcess }) {
  if (isNonEmptyString(delegation.conversationId)) {
    return {
      conversationId: delegation.conversationId.trim(),
      source: 'delegation_request',
    };
  }

  if (isNonEmptyString(parentProcess.conversationId)) {
    return {
      conversationId: parentProcess.conversationId.trim(),
      source: 'parent_process',
    };
  }

  return {
    conversationId: null,
    source: 'none',
  };
}

async function resolveChildConversationHandoff({
  projectRootPath,
  delegation,
  parentProcess,
}) {
  const requestedConversation = getRequestedChildConversationId({
    delegation,
    parentProcess,
  });

  if (!isNonEmptyString(requestedConversation.conversationId)) {
    return assertSafeOsSerializableValue({
      status: 'not_requested',
      source: requestedConversation.source,
      requestedConversationId: null,
      childConversationId: null,
      targetOperationalIdentityId: delegation.assignedOperationalIdentityId,
      reason: null,
    }, 'OpenMAS OS delegation conversation handoff');
  }

  if (!isNonEmptyString(projectRootPath)) {
    return assertSafeOsSerializableValue({
      status: 'retained_unverified',
      source: requestedConversation.source,
      requestedConversationId: requestedConversation.conversationId,
      childConversationId: requestedConversation.conversationId,
      targetOperationalIdentityId: delegation.assignedOperationalIdentityId,
      reason: 'projectRootPath unavailable, conversation readability could not be verified',
    }, 'OpenMAS OS delegation conversation handoff');
  }

  try {
    await readConversationSession({
      masRootPath: path.join(projectRootPath.trim(), 'instance'),
      conversationId: requestedConversation.conversationId,
      requesterOperationalIdentityId: delegation.assignedOperationalIdentityId,
      maxTurns: 1,
    });

    return assertSafeOsSerializableValue({
      status: 'retained_readable',
      source: requestedConversation.source,
      requestedConversationId: requestedConversation.conversationId,
      childConversationId: requestedConversation.conversationId,
      targetOperationalIdentityId: delegation.assignedOperationalIdentityId,
      reason: null,
    }, 'OpenMAS OS delegation conversation handoff');
  } catch (error) {
    return assertSafeOsSerializableValue({
      status: 'dropped_unreadable',
      source: requestedConversation.source,
      requestedConversationId: requestedConversation.conversationId,
      childConversationId: null,
      targetOperationalIdentityId: delegation.assignedOperationalIdentityId,
      reason: safeTrimmedString(error.message, 'conversation readability check failed'),
    }, 'OpenMAS OS delegation conversation handoff');
  }
}

function buildArtifactRefsFromProcess(processState) {
  return Array.isArray(processState?.artifactRefs) ? processState.artifactRefs : [];
}

function firstNonEmptyString(values) {
  for (const value of values) {
    if (isNonEmptyString(value)) {
      return value.trim();
    }
  }

  return null;
}

function calculateDurationMs(startedAt, finishedAt) {
  const startedAtMs = Date.parse(startedAt);
  const finishedAtMs = Date.parse(finishedAt);

  if (Number.isNaN(startedAtMs) || Number.isNaN(finishedAtMs)) {
    return null;
  }

  return Math.max(0, finishedAtMs - startedAtMs);
}

function buildDelegatedChildResultId(childProcessId) {
  return `result_delegated_child_${childProcessId}`;
}

function buildScheduledChildResultId(childProcessId) {
  return `result_scheduled_child_${childProcessId}`;
}

function buildParentResumeResultRecordId(parentThreadId) {
  return `result_parent_resume_${parentThreadId}`;
}

function isResultRecordAlreadyExistsError(error) {
  return error instanceof Error && /OpenMAS OS Result Record .+ already exists/u.test(error.message);
}

function isResultRecordNotFoundError(error) {
  return error instanceof Error && /was not found/u.test(error.message);
}

async function resultRecordExists({
  adapter,
  resultId,
}) {
  try {
    await adapter.loadResultRecord(resultId);
    return true;
  } catch (error) {
    if (isResultRecordNotFoundError(error)) {
      return false;
    }

    throw error;
  }
}

function resolveSystemCallIdFromChildJob(childJob, scheduledTimer = null) {
  if (isNonEmptyString(scheduledTimer?.payload?.sourceSystemCallId)) {
    return scheduledTimer.payload.sourceSystemCallId.trim();
  }

  if (isNonEmptyString(childJob?.jobId) && childJob.jobId.startsWith('job_syscall_')) {
    return childJob.jobId.slice('job_'.length);
  }

  return null;
}

async function hasChildResultRecoveryProvenance({
  adapter,
  childJob,
  resultKind,
  scheduledTimer = null,
  incompleteTerminalCommit,
}) {
  if (
    incompleteTerminalCommit
    || childJob.failureSummary?.reasonCode === 'stale_running_child_invocation_recovered'
  ) {
    return true;
  }

  const sourceSystemCallId = resolveSystemCallIdFromChildJob(childJob, scheduledTimer);

  if (!sourceSystemCallId) {
    return false;
  }

  const submissionPrefix = resultKind === 'scheduled_child_result'
    ? 'scheduled_submission'
    : 'delegation_submission';

  return resultRecordExists({
    adapter,
    resultId: `result_${submissionPrefix}_${sourceSystemCallId}`,
  });
}

async function hasParentResumeRecoveryProvenance({
  adapter,
  parentJob,
  parentProcess,
}) {
  if (
    parentJob.status === 'active'
    || parentJob.failureSummary?.reasonCode === 'stale_running_parent_resume_recovered'
  ) {
    return true;
  }

  return resultRecordExists({
    adapter,
    resultId: `result_foreground_admission_${parentProcess.processId}`,
  });
}

async function persistResultRecordIfMissing({
  adapter,
  resultRecord,
}) {
  try {
    return await adapter.persistResultRecord(resultRecord);
  } catch (error) {
    if (isResultRecordAlreadyExistsError(error)) {
      return adapter.loadResultRecord(resultRecord.resultId);
    }

    throw error;
  }
}

function warningMessageFromEntry(entry, fallbackMessage) {
  if (typeof entry === 'string') {
    return safeTrimmedString(entry, fallbackMessage);
  }

  if (isPlainObject(entry)) {
    return safeTrimmedString(entry.message, fallbackMessage);
  }

  return fallbackMessage;
}

function warningSeverityFromEntry(entry) {
  if (
    isPlainObject(entry)
    && ['info', 'warning', 'critical'].includes(entry.severity)
  ) {
    return entry.severity;
  }

  return 'warning';
}

function buildResultWarningsFromEntries({
  entries,
  source,
  fallbackMessage,
  reasonCode,
  affectsResultTrust = false,
} = {}) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return [];
  }

  const warnings = [];
  const seenMessages = new Set();

  for (const entry of entries) {
    const message = warningMessageFromEntry(entry, fallbackMessage);

    if (!isNonEmptyString(message) || seenMessages.has(message)) {
      continue;
    }

    seenMessages.add(message);
    warnings.push({
      source,
      severity: warningSeverityFromEntry(entry),
      message,
      affectsResultTrust: isPlainObject(entry) && typeof entry.affectsResultTrust === 'boolean'
        ? entry.affectsResultTrust
        : affectsResultTrust,
      requiresHumanAction: isPlainObject(entry) && entry.requiresHumanAction === true,
      details: {
        reasonCode,
      },
    });
  }

  return warnings;
}

function warningMessagesFromResultWarnings(warnings) {
  if (!Array.isArray(warnings)) {
    return [];
  }

  return warnings.map((warning) => warning.message).filter(isNonEmptyString);
}

function invocationWarningsAffectResultTrust(invocationResult) {
  const verificationGate = invocationResult?.verificationGate
    ?? invocationResult?.output?.verificationGate
    ?? null;

  return verificationGate?.status === 'failed'
    || verificationGate?.verificationOutcome === 'not_verified'
    || invocationResult?.output?.actionResultAssessment?.answerGroundedInEvidence === false;
}

function resolveInvocationWarnings({
  invocationResult,
  processState,
}) {
  if (Array.isArray(invocationResult?.warnings) && invocationResult.warnings.length > 0) {
    return invocationResult.warnings;
  }

  if (Array.isArray(processState?.warnings) && processState.warnings.length > 0) {
    return processState.warnings;
  }

  return [];
}

function mapResultStatusToExitClass(status) {
  if (status === 'completed') {
    return 'success';
  }

  if (status === 'completed_with_warnings') {
    return 'warnings';
  }

  if (status === 'failed') {
    return 'failure';
  }

  if (status === 'cancelled') {
    return 'cancelled';
  }

  return 'unknown';
}

function mapProcessTerminalStatusToResultStatus({
  processState,
  warnings,
}) {
  if (processState?.status === 'completed') {
    return warnings.length > 0 ? 'completed_with_warnings' : 'completed';
  }

  if (processState?.status === 'failed') {
    return 'failed';
  }

  if (processState?.status === 'cancelled') {
    return 'cancelled';
  }

  return 'unknown';
}

function buildResultFailure({
  failureSummary,
  invocationResult,
  failedAt,
  defaultReason,
  defaultReasonCode,
  defaultSource,
}) {
  if (!failureSummary) {
    return null;
  }

  return {
    class: 'brain_failure',
    message: failureSummary.message
      ?? invocationResult?.message
      ?? defaultReason
      ?? 'OpenMAS OS invocation failed.',
    recoverable: false,
    retryable: false,
    reasonCode: failureSummary.reasonCode ?? defaultReasonCode ?? 'invocation_failed',
    source: {
      type: 'agent_invocation',
      id: invocationResult?.invocationId ?? failureSummary.invocationId ?? null,
    },
    failedAt,
    details: {
      reason: failureSummary.reason ?? defaultReason ?? null,
      source: failureSummary.source ?? defaultSource ?? 'openmas-os',
      invocationStatus: invocationResult?.status ?? failureSummary.invocationStatus ?? null,
    },
  };
}

function resolveBrainWorkflowExecution(invocationResult) {
  return invocationResult?.output?.brainWorkflowExecution ?? invocationResult?.brainWorkflowExecution ?? null;
}

function collectToolRunRefsFromInvocationResult(invocationResult) {
  const brainToolExecution = resolveBrainToolExecution(invocationResult);
  const observation = brainToolExecution?.observation ?? null;

  return [
    invocationResult?.output?.toolRunId,
    invocationResult?.toolRunId,
    brainToolExecution?.toolRunId,
    brainToolExecution?.requestedToolId,
    observation?.observationId,
  ].filter(isNonEmptyString);
}

function collectWorkflowRunRefsFromInvocationResult(invocationResult) {
  const brainWorkflowExecution = resolveBrainWorkflowExecution(invocationResult);

  return [
    invocationResult?.output?.workflowRunId,
    invocationResult?.workflowRunId,
    brainWorkflowExecution?.workflowRunId,
  ].filter(isNonEmptyString);
}

function mapVerificationGateStatus(verificationGate) {
  if (!verificationGate) {
    return 'unknown';
  }

  if (verificationGate.status === 'degraded') {
    return 'warning';
  }

  if (verificationGate.status === 'passed') {
    return 'passed';
  }

  if (verificationGate.status === 'failed') {
    return 'failed';
  }

  if (verificationGate.status === 'not_applicable') {
    return 'not_applicable';
  }

  if (verificationGate.verificationOutcome === 'verified') {
    return 'passed';
  }

  if (verificationGate.verificationOutcome === 'not_verified') {
    return 'failed';
  }

  if (verificationGate.verificationOutcome === 'partially_verified') {
    return 'warning';
  }

  return 'unknown';
}

function buildResultVerification(invocationResult) {
  const verificationGate = invocationResult?.verificationGate
    ?? invocationResult?.output?.verificationGate
    ?? null;

  return {
    status: mapVerificationGateStatus(verificationGate),
    grounded: verificationGate
      ? verificationGate.executionObserved ?? null
      : null,
    details: verificationGate
      ? {
        gateStatus: verificationGate.status ?? null,
        verificationOutcome: verificationGate.verificationOutcome ?? null,
        reason: verificationGate.reason ?? null,
      }
      : {},
  };
}

function buildDelegatedChildResultRecord({
  childJob,
  childProcess,
  childThread,
  parentProcess = null,
  parentThreadId = null,
  invocationResult = null,
  resultKind = 'delegated_child_result',
  scheduledTimer = null,
  deliveryMode = null,
  recoveryStatus = null,
  completedAt,
} = {}) {
  const warnings = buildResultWarningsFromEntries({
    entries: resolveInvocationWarnings({
      invocationResult,
      processState: childProcess,
    }),
    source: {
      type: 'agent_invocation',
      id: invocationResult?.invocationId ?? childProcess.processId,
    },
    fallbackMessage: 'Delegated child runtime warning.',
    reasonCode: 'delegated_child_warning',
    affectsResultTrust: invocationWarningsAffectResultTrust(invocationResult),
  });
  const status = mapProcessTerminalStatusToResultStatus({
    processState: childProcess,
    warnings,
  });
  const finishedAt = childProcess.completedAt
    ?? childProcess.failedAt
    ?? completedAt;
  const failureSummary = childProcess.failureSummary
    ?? childJob.failureSummary
    ?? (status === 'failed'
      ? createSafeFailureSummaryFromInvocationResult({
        invocationResult,
        failedAt: finishedAt,
        source: 'openmas-os-delegated-child',
        reasonCode: 'delegated_child_failed',
        reason: 'OpenMAS OS delegated child invocation failed.',
      })
      : null);
  const artifactRefs = buildArtifactRefsFromProcess(childProcess);
  const toolRunRefs = collectToolRunRefsFromInvocationResult(invocationResult);
  const workflowRunRefs = collectWorkflowRunRefsFromInvocationResult(invocationResult);

  return {
    kind: OPENMAS_OS_RESULT_RECORD_KINDS.resultRecord,
    schemaVersion: OPENMAS_OS_RESULT_RECORD_SCHEMA_VERSION,
    resultId: resultKind === 'scheduled_child_result'
      ? buildScheduledChildResultId(childProcess.processId)
      : buildDelegatedChildResultId(childProcess.processId),
    resultKind,
    producer: {
      type: 'process',
      id: childProcess.processId,
      operationalIdentityId: childProcess.operationalIdentityId,
      activeCognitiveIdentityId: childProcess.activeCognitiveIdentityId,
    },
    lineage: {
      jobId: childJob.jobId,
      processId: childProcess.processId,
      threadId: childThread?.threadId ?? null,
      parentJobId: parentProcess?.jobId ?? null,
      parentProcessId: childProcess.parentProcessId,
      parentThreadId,
      systemCallId: scheduledTimer?.payload?.sourceSystemCallId ?? null,
      timerId: scheduledTimer?.timerId ?? null,
      invocationId: invocationResult?.invocationId ?? failureSummary?.invocationId ?? null,
      toolRunId: toolRunRefs[0] ?? null,
      workflowRunId: workflowRunRefs[0] ?? null,
      conversationId: childProcess.conversationId ?? childJob.conversationId,
    },
    status,
    phase: 'terminal',
    completion: {
      startedAt: childProcess.startedAt,
      completedAt: finishedAt,
      durationMs: calculateDurationMs(childProcess.startedAt, finishedAt),
      exitClass: mapResultStatusToExitClass(status),
    },
    summary: firstNonEmptyString([
      invocationResult?.message,
      failureSummary?.message,
      `OpenMAS OS delegated child Process ${childProcess.processId} finished with status ${status}.`,
    ]),
    artifactRefs,
    toolRunRefs,
    workflowRunRefs,
    childResultRefs: [],
    warnings,
    failure: status === 'failed' ? buildResultFailure({
      failureSummary,
      invocationResult,
      failedAt: finishedAt,
      defaultReason: 'OpenMAS OS delegated child invocation failed.',
      defaultReasonCode: 'delegated_child_failed',
      defaultSource: 'openmas-os-delegated-child',
    }) : null,
    verification: buildResultVerification(invocationResult),
    visibility: {
      safeForHumanSummary: true,
      safeForAgentContext: true,
    },
    metadata: {
      child: {
        jobId: childJob.jobId,
        jobStatus: childJob.status,
        processId: childProcess.processId,
        processStatus: childProcess.status,
        threadId: childThread?.threadId ?? null,
        threadStatus: childThread?.status ?? null,
        operationalIdentityId: childProcess.operationalIdentityId,
      },
      parent: {
        processId: childProcess.parentProcessId,
        jobId: parentProcess?.jobId ?? null,
        threadId: parentThreadId,
      },
      invocationStatus: invocationResult?.status ?? failureSummary?.invocationStatus ?? null,
      command: childJob.program.command ?? null,
      mode: childJob.program.mode ?? null,
      triggerType: childJob.trigger?.type ?? null,
      ...(recoveryStatus ? {
        recovery: {
          status: recoveryStatus,
        },
      } : {}),
      ...(scheduledTimer ? {
        schedule: {
          timerId: scheduledTimer.timerId,
          timerStatus: scheduledTimer.status,
          runAt: scheduledTimer.runAt,
          missedRunPolicy: scheduledTimer.payload?.missedRunPolicy ?? null,
          releaseResultRef: scheduledTimer.payload?.releaseResultRef ?? null,
          recoveryStatus,
        },
        delivery: {
          mode: deliveryMode ?? scheduledTimer.payload?.deliveryMode ?? 'persist_only',
          parentNotificationAttempted: false,
        },
      } : {}),
    },
    createdAt: finishedAt,
  };
}

function createChildResultSummaryFromResultRecord({
  resultRecord,
  childJob,
  childProcess,
  invocationResult = null,
} = {}) {
  const resultSummary = createOpenMasOsResultSummaryFromRecord(resultRecord);

  return assertSafeOsSerializableValue({
    kind: CHILD_RESULT_SUMMARY_KIND,
    version: CHILD_RESULT_SUMMARY_VERSION,
    childJobId: childJob?.jobId ?? childProcess?.jobId ?? resultRecord.lineage.jobId,
    childProcessId: childProcess?.processId ?? resultRecord.lineage.processId,
    childStatus: childProcess?.status ?? resultRecord.status,
    childOperationalIdentityId: childProcess?.operationalIdentityId
      ?? childJob?.assignedOperationalIdentityId
      ?? resultRecord.producer.operationalIdentityId,
    childConversationId: childProcess?.conversationId ?? childJob?.conversationId ?? resultRecord.lineage.conversationId,
    childResultId: resultRecord.resultId,
    childResultKind: resultRecord.resultKind,
    childResultStatus: resultRecord.status,
    resultSummary,
    invocationId: resultRecord.lineage.invocationId ?? invocationResult?.invocationId ?? null,
    invocationStatus: invocationResult?.status ?? resultRecord.metadata?.invocationStatus ?? null,
    message: resultRecord.summary,
    failureSummary: childProcess?.failureSummary ?? childJob?.failureSummary ?? resultRecord.failure,
    artifactRefs: resultRecord.artifactRefs,
    warnings: warningMessagesFromResultWarnings(resultRecord.warnings),
    warningCount: resultRecord.warnings.length,
    errors: Array.isArray(invocationResult?.errors)
      ? invocationResult.errors
      : (resultRecord.failure ? [resultRecord.failure.message] : []),
    failure: resultRecord.failure,
  }, 'OpenMAS OS child result summary');
}

async function loadParentProcessForChild({
  adapter,
  childProcess,
}) {
  if (!isNonEmptyString(childProcess?.parentProcessId)) {
    return null;
  }

  try {
    return await adapter.loadProcess(childProcess.parentProcessId);
  } catch {
    return null;
  }
}

async function materializeDelegatedChildResultRecord({
  adapter,
  childExecution,
  parentThreadId = null,
  resultKind = 'delegated_child_result',
  scheduledTimer = null,
  deliveryMode = null,
  recoveryStatus = null,
  completedAt,
} = {}) {
  const resultRecordAdapter = assertResultRecordAdapter(adapter);
  const childJob = childExecution?.childJob ?? childExecution?.job;
  const childProcess = childExecution?.childProcess ?? childExecution?.process;
  const childThread = childExecution?.childThread ?? childExecution?.thread ?? null;

  if (!childJob || !childProcess) {
    throw new Error('OpenMAS OS delegated child Result materialization requires child Job and Process state.');
  }

  const parentProcess = await loadParentProcessForChild({
    adapter,
    childProcess,
  });
  const resultRecord = buildDelegatedChildResultRecord({
    childJob,
    childProcess,
    childThread,
    parentProcess,
    parentThreadId,
    invocationResult: childExecution.invocationResult ?? null,
    resultKind,
    scheduledTimer,
    deliveryMode,
    recoveryStatus,
    completedAt,
  });

  return persistResultRecordIfMissing({
    adapter: resultRecordAdapter,
    resultRecord,
  });
}

async function linkScheduledChildResultToTimer({
  adapter,
  scheduledTimer,
  childResultRecord,
  linkedAt,
}) {
  if (!scheduledTimer || !childResultRecord || childResultRecord.resultKind !== 'scheduled_child_result') {
    return scheduledTimer;
  }

  if (typeof adapter.persistTimer !== 'function') {
    throw new Error('OpenMAS OS runtime adapter must implement persistTimer for scheduled child Result linkage.');
  }

  if (scheduledTimer.payload?.childResultRef === childResultRecord.resultId) {
    return scheduledTimer;
  }

  return adapter.persistTimer({
    ...scheduledTimer,
    updatedAt: linkedAt,
    payload: {
      ...(scheduledTimer.payload ?? {}),
      childResultRef: childResultRecord.resultId,
    },
  });
}

function assertChildResultRecoveryAdapter(adapter) {
  for (const methodName of [
    'listProcesses',
    'listThreads',
  ]) {
    if (typeof adapter[methodName] !== 'function') {
      throw new Error(`OpenMAS OS runtime adapter must implement ${methodName} for child Result recovery.`);
    }
  }

  return assertResultRecordAdapter(adapter);
}

function assertScheduledChildRecoveryAdapter(adapter) {
  const resultRecordAdapter = assertChildResultRecoveryAdapter(adapter);

  if (typeof resultRecordAdapter.listTimers !== 'function') {
    throw new Error('OpenMAS OS runtime adapter must implement listTimers for scheduled child Result recovery.');
  }

  return resultRecordAdapter;
}

function isScheduledDelegationTimer(timer) {
  return timer?.status === 'fired' && timer.payload?.actionType === 'schedule_delegation';
}

function resolveTerminalTimestamp(state) {
  return state?.completedAt ?? state?.failedAt ?? state?.updatedAt ?? state?.createdAt ?? '';
}

function compareTerminalStateDescending(left, right) {
  const timestampComparison = resolveTerminalTimestamp(right).localeCompare(resolveTerminalTimestamp(left));

  if (timestampComparison !== 0) {
    return timestampComparison;
  }

  return (right.processId ?? right.threadId ?? '').localeCompare(left.processId ?? left.threadId ?? '');
}

function normalizeJobActivityProbe(isJobActive) {
  if (isJobActive === undefined || isJobActive === null) {
    return () => false;
  }

  if (typeof isJobActive !== 'function') {
    throw new Error('OpenMAS OS child Result recovery isJobActive must be a function when provided.');
  }

  return isJobActive;
}

async function findTerminalScheduledChildExecution({
  adapter,
  timer,
}) {
  const childJob = await adapter.loadJob(timer.jobId);

  const childProcess = (await adapter.listProcesses({ jobId: childJob.jobId }))
    .filter((processState) => OPENMAS_OS_TERMINAL_PROCESS_STATUSES.has(processState.status))
    .sort(compareTerminalStateDescending)[0] ?? null;

  if (!childProcess) {
    return null;
  }

  const childThread = (await adapter.listThreads({ processId: childProcess.processId }))
    .filter((thread) => TERMINAL_THREAD_STATUSES.has(thread.status))
    .sort(compareTerminalStateDescending)[0] ?? null;

  return {
    childJob,
    childProcess,
    childThread,
  };
}

async function recoverTerminalJobStateFromProcess({
  adapter,
  job,
  processState,
  recoveredAt,
}) {
  if (TERMINAL_CHILD_JOB_STATUSES.has(job.status)) {
    return job;
  }

  if (job.status !== 'active' || !OPENMAS_OS_TERMINAL_PROCESS_STATUSES.has(processState.status)) {
    return null;
  }

  const recoveredJob = await adapter.persistJob({
    ...job,
    status: processState.status,
    updatedAt: recoveredAt,
    failedAt: processState.status === 'failed'
      ? processState.failedAt ?? recoveredAt
      : null,
    failureSummary: processState.status === 'failed'
      ? processState.failureSummary ?? null
      : null,
  });

  await appendDelegationEvent({
    adapter,
    eventType: 'job.terminal_state.recovered',
    targetType: 'job',
    targetId: recoveredJob.jobId,
    jobId: recoveredJob.jobId,
    processId: processState.processId,
    occurredAt: recoveredAt,
    payload: {
      processStatus: processState.status,
      recoveryStatus: 'recovered_terminal_job_from_process',
    },
  });

  return recoveredJob;
}

function isImmediateDelegatedChildJob(job) {
  return job?.createdBy?.type === 'process'
    && job?.program?.type === 'agent_invocation'
    && job?.trigger?.type === 'manual';
}

async function loadLatestTerminalThreadForProcess({
  adapter,
  processId,
}) {
  return (await adapter.listThreads({ processId }))
    .filter((thread) => TERMINAL_THREAD_STATUSES.has(thread.status))
    .sort(compareTerminalStateDescending)[0] ?? null;
}

export async function recoverUnlinkedDelegatedChildResults({
  adapter = null,
  projectRootPath = null,
  osRootPath = null,
  now = defaultNow,
  isJobActive = null,
} = {}) {
  const runtimeAdapter = assertChildResultRecoveryAdapter(
    assertAdapter(createAdapter({ adapter, projectRootPath, osRootPath })),
  );
  const recoveredAt = normalizeNow(now)();
  const jobIsActive = normalizeJobActivityProbe(isJobActive);
  const terminalProcesses = (await runtimeAdapter.listProcesses())
    .filter((processState) => {
      return isNonEmptyString(processState.parentProcessId)
        && OPENMAS_OS_TERMINAL_PROCESS_STATUSES.has(processState.status);
    });
  const recovery = {
    status: 'completed',
    observedAt: recoveredAt,
    scannedProcessCount: terminalProcesses.length,
    candidateCount: 0,
    recoveredCount: 0,
    activeExecutionSkippedCount: 0,
    legacySkippedCount: 0,
    failedCount: 0,
    recovered: [],
    failures: [],
  };

  for (const childProcess of terminalProcesses) {
    try {
      const childJob = await runtimeAdapter.loadJob(childProcess.jobId);
      const incompleteTerminalCommit = childJob.status === 'active';

      if (!isImmediateDelegatedChildJob(childJob)) {
        continue;
      }

      if (jobIsActive(childJob.jobId)) {
        recovery.activeExecutionSkippedCount += 1;
        continue;
      }

      const terminalChildJob = await recoverTerminalJobStateFromProcess({
        adapter: runtimeAdapter,
        job: childJob,
        processState: childProcess,
        recoveredAt,
      });

      if (!terminalChildJob) {
        continue;
      }

      const resultId = buildDelegatedChildResultId(childProcess.processId);

      try {
        await runtimeAdapter.loadResultRecord(resultId);
        continue;
      } catch (error) {
        if (!isResultRecordNotFoundError(error)) {
          throw error;
        }
      }

      if (!await hasChildResultRecoveryProvenance({
        adapter: runtimeAdapter,
        childJob: terminalChildJob,
        resultKind: 'delegated_child_result',
        incompleteTerminalCommit,
      })) {
        recovery.legacySkippedCount += 1;
        continue;
      }

      recovery.candidateCount += 1;
      const childThread = await loadLatestTerminalThreadForProcess({
        adapter: runtimeAdapter,
        processId: childProcess.processId,
      });
      const childResultRecord = await materializeDelegatedChildResultRecord({
        adapter: runtimeAdapter,
        childExecution: {
          childJob: terminalChildJob,
          childProcess,
          childThread,
        },
        resultKind: 'delegated_child_result',
        recoveryStatus: 'recovered_terminal_child_result',
        completedAt: resolveTerminalTimestamp(childProcess),
      });

      await appendDelegationEvent({
        adapter: runtimeAdapter,
        eventType: 'delegation.child_result.recovered',
        targetType: 'process',
        targetId: childProcess.processId,
        jobId: childJob.jobId,
        processId: childProcess.processId,
        threadId: childThread?.threadId ?? null,
        occurredAt: recoveredAt,
        payload: {
          resultId: childResultRecord.resultId,
          recoveryStatus: 'recovered_terminal_child_result',
        },
      });

      recovery.recovered.push({
        jobId: terminalChildJob.jobId,
        processId: childProcess.processId,
        resultId: childResultRecord.resultId,
        resultStatus: childResultRecord.status,
      });
      recovery.recoveredCount += 1;
    } catch (error) {
      recovery.failedCount += 1;
      recovery.failures.push({
        processId: childProcess.processId,
        jobId: childProcess.jobId,
        errorMessage: safeTrimmedString(error.message, 'Delegated child Result recovery failed.'),
      });
    }
  }

  if (recovery.failedCount > 0) {
    recovery.status = 'completed_with_failures';
  }

  return recovery;
}

export async function recoverUnlinkedScheduledChildResults({
  adapter = null,
  projectRootPath = null,
  osRootPath = null,
  now = defaultNow,
  isJobActive = null,
} = {}) {
  const runtimeAdapter = assertScheduledChildRecoveryAdapter(
    assertAdapter(createAdapter({ adapter, projectRootPath, osRootPath })),
  );
  const recoveredAt = normalizeNow(now)();
  const jobIsActive = normalizeJobActivityProbe(isJobActive);
  const firedTimers = await runtimeAdapter.listTimers({ status: 'fired' });
  const recovery = {
    status: 'completed',
    observedAt: recoveredAt,
    scannedTimerCount: firedTimers.length,
    candidateCount: 0,
    recoveredCount: 0,
    activeExecutionSkippedCount: 0,
    legacySkippedCount: 0,
    failedCount: 0,
    recovered: [],
    failures: [],
  };

  for (const timer of firedTimers) {
    if (!isScheduledDelegationTimer(timer) || isNonEmptyString(timer.payload?.childResultRef)) {
      continue;
    }

    if (jobIsActive(timer.jobId)) {
      recovery.activeExecutionSkippedCount += 1;
      continue;
    }

    try {
      const childExecution = await findTerminalScheduledChildExecution({
        adapter: runtimeAdapter,
        timer,
      });

      if (!childExecution) {
        continue;
      }

      const incompleteTerminalCommit = childExecution.childJob.status === 'active';
      const terminalChildJob = await recoverTerminalJobStateFromProcess({
        adapter: runtimeAdapter,
        job: childExecution.childJob,
        processState: childExecution.childProcess,
        recoveredAt,
      });

      if (!terminalChildJob) {
        continue;
      }

      const existingResultId = buildScheduledChildResultId(childExecution.childProcess.processId);
      const existingResult = await resultRecordExists({
        adapter: runtimeAdapter,
        resultId: existingResultId,
      });

      if (
        !existingResult
        && !await hasChildResultRecoveryProvenance({
          adapter: runtimeAdapter,
          childJob: terminalChildJob,
          resultKind: 'scheduled_child_result',
          scheduledTimer: timer,
          incompleteTerminalCommit,
        })
      ) {
        recovery.legacySkippedCount += 1;
        continue;
      }

      recovery.candidateCount += 1;
      const childResultRecord = await materializeDelegatedChildResultRecord({
        adapter: runtimeAdapter,
        childExecution: {
          ...childExecution,
          childJob: terminalChildJob,
        },
        parentThreadId: timer.payload?.parentThreadId ?? null,
        resultKind: 'scheduled_child_result',
        scheduledTimer: timer,
        deliveryMode: timer.payload?.deliveryMode ?? 'persist_only',
        recoveryStatus: 'recovered_terminal_child_result',
        completedAt: resolveTerminalTimestamp(childExecution.childProcess),
      });
      const linkedTimer = await linkScheduledChildResultToTimer({
        adapter: runtimeAdapter,
        scheduledTimer: timer,
        childResultRecord,
        linkedAt: recoveredAt,
      });

      await appendDelegationEvent({
        adapter: runtimeAdapter,
        eventType: 'delegation.scheduled_child_result.recovered',
        targetType: 'process',
        targetId: childExecution.childProcess.processId,
        jobId: childExecution.childJob.jobId,
        processId: childExecution.childProcess.processId,
        threadId: childExecution.childThread?.threadId ?? null,
        occurredAt: recoveredAt,
        payload: {
          timerId: linkedTimer.timerId,
          resultId: childResultRecord.resultId,
          recoveryStatus: 'recovered_terminal_child_result',
        },
      });

      recovery.recovered.push({
        timerId: linkedTimer.timerId,
        jobId: terminalChildJob.jobId,
        processId: childExecution.childProcess.processId,
        resultId: childResultRecord.resultId,
        resultStatus: childResultRecord.status,
      });
      recovery.recoveredCount += 1;
    } catch (error) {
      recovery.failedCount += 1;
      recovery.failures.push({
        timerId: timer.timerId,
        jobId: timer.jobId,
        errorMessage: safeTrimmedString(error.message, 'Scheduled child Result recovery failed.'),
      });
    }
  }

  if (recovery.failedCount > 0) {
    recovery.status = 'completed_with_failures';
  }

  return recovery;
}

async function resolveDelegatedChildResultRecordForResume({
  adapter,
  childExecution,
  childResultSummary,
  parentThreadId = null,
  completedAt,
} = {}) {
  const resultRecordAdapter = assertResultRecordAdapter(adapter);
  const childProcess = childExecution?.childProcess ?? childExecution?.process;
  const existingResultId = childResultSummary?.childResultId
    ?? childResultSummary?.resultSummary?.resultId
    ?? (childProcess?.processId ? buildDelegatedChildResultId(childProcess.processId) : null);

  if (existingResultId) {
    try {
      return await resultRecordAdapter.loadResultRecord(existingResultId);
    } catch (error) {
      if (!isResultRecordNotFoundError(error)) {
        throw error;
      }
    }
  }

  return materializeDelegatedChildResultRecord({
    adapter: resultRecordAdapter,
    childExecution,
    parentThreadId,
    completedAt,
  });
}

function createSafeChildResultSummary({
  childJob,
  childProcess,
  invocationResult = null,
} = {}) {
  const summary = {
    kind: CHILD_RESULT_SUMMARY_KIND,
    version: CHILD_RESULT_SUMMARY_VERSION,
    childJobId: childJob?.jobId ?? childProcess?.jobId ?? null,
    childProcessId: childProcess?.processId ?? null,
    childStatus: childProcess?.status ?? null,
    childOperationalIdentityId: childProcess?.operationalIdentityId ?? childJob?.assignedOperationalIdentityId ?? null,
    childConversationId: childProcess?.conversationId ?? childJob?.conversationId ?? null,
    invocationId: invocationResult?.invocationId ?? null,
    invocationStatus: invocationResult?.status ?? null,
    message: safeTrimmedString(invocationResult?.message, null),
    failureSummary: childProcess?.failureSummary ?? childJob?.failureSummary ?? null,
    artifactRefs: buildArtifactRefsFromProcess(childProcess),
    warnings: Array.isArray(invocationResult?.warnings) ? invocationResult.warnings : [],
    errors: Array.isArray(invocationResult?.errors) ? invocationResult.errors : [],
  };

  try {
    return assertSafeOsSerializableValue(summary, 'OpenMAS OS child result summary');
  } catch {
    return {
      kind: CHILD_RESULT_SUMMARY_KIND,
      version: CHILD_RESULT_SUMMARY_VERSION,
      childJobId: summary.childJobId,
      childProcessId: summary.childProcessId,
      childStatus: summary.childStatus,
      childOperationalIdentityId: summary.childOperationalIdentityId,
      childConversationId: summary.childConversationId,
      invocationId: summary.invocationId,
      invocationStatus: summary.invocationStatus,
      message: 'Child result summary was omitted because it did not pass OpenMAS OS safe serialization.',
      artifactRefs: summary.artifactRefs,
      warnings: ['OpenMAS OS omitted unsafe child result summary content.'],
      errors: [],
      omittedUnsafeSummary: true,
      unsafeSummaryReason: 'unsafe_child_result_summary',
    };
  }
}

function buildParentResumeInputText({
  childResultSummary,
} = {}) {
  const summary = childResultSummary ?? {};
  const artifactLines = Array.isArray(summary.artifactRefs) && summary.artifactRefs.length > 0
    ? summary.artifactRefs.map((artifactRef) => {
      return `- ${artifactRef.artifactKind ?? 'artifact'}: ${artifactRef.path}`;
    })
    : ['- none'];
  const warningLines = Array.isArray(summary.warnings) && summary.warnings.length > 0
    ? summary.warnings.map((warning) => `- ${warning}`)
    : ['- none'];
  const errorLines = Array.isArray(summary.errors) && summary.errors.length > 0
    ? summary.errors.map((error) => `- ${error}`)
    : ['- none'];

  return [
    'OpenMAS OS parent resume notice.',
    '',
    'A delegated child Process has finished and this parent Operational Identity is resuming.',
    'Produce the final answer for the human using only the bounded child result summary and evidence references below.',
    'Do not fabricate child findings that are not present in the child message or evidence references.',
    '',
    'Child Result Summary:',
    `- Child Result ID: ${summary.childResultId ?? summary.resultSummary?.resultId ?? 'n/a'}`,
    `- Child Result Status: ${summary.childResultStatus ?? summary.resultSummary?.status ?? 'n/a'}`,
    `- Child Job ID: ${summary.childJobId ?? 'n/a'}`,
    `- Child Process ID: ${summary.childProcessId ?? 'n/a'}`,
    `- Child Operational Identity: ${summary.childOperationalIdentityId ?? 'n/a'}`,
    `- Child Status: ${summary.childStatus ?? 'n/a'}`,
    `- Child Invocation ID: ${summary.invocationId ?? 'n/a'}`,
    `- Child Invocation Status: ${summary.invocationStatus ?? 'n/a'}`,
    `- Child Message: ${summary.message ?? 'n/a'}`,
    '',
    'Child Evidence References:',
    ...artifactLines,
    '',
    'Child Warnings:',
    ...warningLines,
    '',
    'Child Errors:',
    ...errorLines,
  ].join('\n');
}

function buildParentResumeInvocationOptions({
  parentJob,
  parentProcess,
  continuationThread,
  childJob,
  childResultSummary,
  projectRootPath,
  invocationOptions = {},
} = {}) {
  const conversationRef = parentProcess.conversationId ?? parentJob.conversationId ?? childJob?.conversationId ?? null;
  const options = {
    ...invocationOptions,
    projectRootPath,
    operationalIdentityId: parentProcess.operationalIdentityId,
    invocationMode: parentJob.program.mode,
    command: parentJob.program.command,
    inputText: buildParentResumeInputText({
      childResultSummary,
    }),
    requestedBy: 'openmas-os',
    osRuntimeContext: {
      jobId: parentJob.jobId,
      processId: parentProcess.processId,
      threadId: continuationThread.threadId,
      parentProcessId: parentProcess.parentProcessId,
      source: 'openmas-os-parent-resume',
    },
  };

  if (conversationRef) {
    options.conversationRef = conversationRef;
  }

  return options;
}

function extractMissingConversationId(error) {
  const message = error?.message ?? String(error ?? '');
  const match = /Conversation not found:\s*([^\s.]+)/u.exec(message);

  return match?.[1] ?? null;
}

function buildParentResumeConversationFallbackWarning(conversationId) {
  return `OpenMAS OS parent resume conversation ${conversationId} was unavailable; final answer completed without conversation writeback.`;
}

function buildParentResumeWithoutConversationFallbackOptions({
  options,
  missingConversationId,
} = {}) {
  const fallbackOptions = {
    ...options,
    inputText: [
      options.inputText,
      '',
      'Parent Resume Runtime Notice:',
      `- Requested parent conversation "${missingConversationId}" was unavailable.`,
      '- Complete the parent final answer without conversation writeback, using only the bounded child result summary and evidence references.',
    ].join('\n'),
    osRuntimeContext: {
      ...(options.osRuntimeContext ?? {}),
      parentResumeConversationFallback: {
        reasonCode: 'parent_conversation_missing',
        missingConversationId,
      },
    },
  };

  delete fallbackOptions.conversationRef;

  return fallbackOptions;
}

function resolveBrainToolExecution(invocationResult) {
  return invocationResult?.output?.brainToolExecution ?? invocationResult?.brainToolExecution ?? null;
}

function isSuccessfulDelegateToolExecution(toolExecution) {
  return toolExecution?.executionPerformed === true
    && toolExecution?.requestedToolId === 'mas.os.delegate'
    && toolExecution?.toolResultStatus === 'succeeded';
}

function parentResumeSubmittedDelegationSystemCall(invocationResult) {
  const toolExecution = resolveBrainToolExecution(invocationResult);
  const dataPreview = toolExecution?.observation?.dataPreview ?? null;

  return isSuccessfulDelegateToolExecution(toolExecution)
    && dataPreview?.systemCall?.operation === 'delegate'
    && dataPreview?.systemCall?.status === 'pending';
}

function parentResumeDelegatedAgain(invocationResult) {
  const toolExecution = resolveBrainToolExecution(invocationResult);
  const dataPreview = toolExecution?.observation?.dataPreview ?? null;

  if (!isSuccessfulDelegateToolExecution(toolExecution)) {
    return false;
  }

  if (dataPreview?.systemCall?.operation === 'delegate') {
    return dataPreview.delegated === true;
  }

  return true;
}

function mapParentResumeStatus(invocationResult) {
  if (parentResumeSubmittedDelegationSystemCall(invocationResult)) {
    return {
      jobStatus: 'active',
      processStatus: 'blocked',
      threadStatus: 'blocked',
      threadWaitReason: 'waiting_for_system_call',
      terminal: false,
      eventSuffix: null,
    };
  }

  if (parentResumeDelegatedAgain(invocationResult)) {
    return {
      jobStatus: 'active',
      processStatus: 'blocked',
      threadStatus: 'blocked',
      threadWaitReason: 'waiting_for_child_process',
      terminal: false,
      eventSuffix: null,
    };
  }

  if (invocationResult.status === 'completed') {
    return {
      jobStatus: 'completed',
      processStatus: 'completed',
      threadStatus: 'completed',
      threadWaitReason: null,
      terminal: true,
      eventSuffix: 'completed',
    };
  }

  if (invocationResult.status === 'blocked') {
    return {
      jobStatus: 'active',
      processStatus: 'blocked',
      threadStatus: 'blocked',
      threadWaitReason: 'waiting_for_resource',
      terminal: false,
      eventSuffix: 'blocked',
    };
  }

  return {
    jobStatus: 'failed',
    processStatus: 'failed',
    threadStatus: 'failed',
    threadWaitReason: null,
    terminal: true,
    eventSuffix: 'failed',
  };
}

function buildArtifactRefsFromInvocationResult(invocationResult) {
  if (!invocationResult?.persistence) {
    return [];
  }

  const artifactRefs = [];

  if (invocationResult.persistence.invocationSessionRecordPath) {
    artifactRefs.push({
      artifactId: `invocation_session_${invocationResult.invocationId}`,
      artifactKind: 'invocation_session',
      path: invocationResult.persistence.invocationSessionRecordPath,
    });
  }

  if (invocationResult.persistence.invocationReportPath) {
    artifactRefs.push({
      artifactId: `invocation_report_${invocationResult.invocationId}`,
      artifactKind: 'invocation_report',
      path: invocationResult.persistence.invocationReportPath,
    });
  }

  return artifactRefs;
}

function buildParentResumeResult({
  status,
  parentJob,
  parentProcess,
  parentThread,
  childResultSummary,
  invocationResult,
  evidenceRefs,
  childResultRef = null,
  parentResumeResultRef = null,
} = {}) {
  return assertSafeOsSerializableValue({
    kind: PARENT_RESUME_RESULT_KIND,
    version: PARENT_RESUME_RESULT_VERSION,
    status,
    resultRecordId: parentResumeResultRef,
    parent: {
      jobId: parentJob.jobId,
      jobStatus: parentJob.status,
      processId: parentProcess.processId,
      processStatus: parentProcess.status,
      threadId: parentThread.threadId,
      threadStatus: parentThread.status,
      threadType: parentThread.threadType,
    },
    childResultRef,
    child: childResultSummary,
    finalAnswer: {
      invocationId: invocationResult.invocationId,
      status: invocationResult.status,
      message: invocationResult.message,
    },
    evidenceRefs,
  }, 'OpenMAS OS parent resume result');
}

function buildParentResumeChildWarnings(childResultRecord) {
  const childWarnings = Array.isArray(childResultRecord?.warnings)
    ? childResultRecord.warnings
    : [];
  const propagatedWarnings = childWarnings.map((warning) => {
    return {
      source: {
        type: 'result_record',
        id: childResultRecord.resultId,
      },
      severity: warning.severity ?? 'warning',
      message: warning.message,
      affectsResultTrust: warning.affectsResultTrust ?? false,
      requiresHumanAction: warning.requiresHumanAction ?? false,
      details: {
        reasonCode: 'child_result_warning',
        childResultId: childResultRecord.resultId,
      },
    };
  });

  if (childResultRecord?.status === 'failed') {
    propagatedWarnings.push({
      source: {
        type: 'result_record',
        id: childResultRecord.resultId,
      },
      severity: 'warning',
      message: childResultRecord.failure?.message
        ?? `Delegated child Result ${childResultRecord.resultId} failed.`,
      affectsResultTrust: true,
      requiresHumanAction: false,
      details: {
        reasonCode: 'child_result_failed',
        childResultId: childResultRecord.resultId,
      },
    });
  }

  if (childResultRecord?.status === 'cancelled') {
    propagatedWarnings.push({
      source: {
        type: 'result_record',
        id: childResultRecord.resultId,
      },
      severity: 'warning',
      message: `Delegated child Result ${childResultRecord.resultId} was cancelled.`,
      affectsResultTrust: true,
      requiresHumanAction: false,
      details: {
        reasonCode: 'child_result_cancelled',
        childResultId: childResultRecord.resultId,
      },
    });
  }

  return propagatedWarnings;
}

function mapParentResumeResultRecordStatus({
  statusMapping,
  warnings,
}) {
  if (statusMapping.processStatus === 'failed') {
    return 'failed';
  }

  if (statusMapping.processStatus === 'completed') {
    return warnings.length > 0 ? 'completed_with_warnings' : 'completed';
  }

  if (statusMapping.processStatus === 'cancelled') {
    return 'cancelled';
  }

  return 'running';
}

function buildParentResumeResultRecord({
  parentJob,
  parentProcess,
  parentThread,
  childResultRecord,
  childResultSummary,
  invocationResult,
  statusMapping,
  failureSummary,
  parentArtifactRefs,
  startedAt,
  finishedAt,
  recoveryStatus = null,
} = {}) {
  const parentWarnings = buildResultWarningsFromEntries({
    entries: invocationResult?.warnings ?? [],
    source: {
      type: 'agent_invocation',
      id: invocationResult?.invocationId ?? parentThread.threadId,
    },
    fallbackMessage: 'Parent resume runtime warning.',
    reasonCode: 'parent_resume_warning',
    affectsResultTrust: invocationWarningsAffectResultTrust(invocationResult),
  });
  const warnings = [
    ...buildParentResumeChildWarnings(childResultRecord),
    ...parentWarnings,
  ];
  const status = mapParentResumeResultRecordStatus({
    statusMapping,
    warnings,
  });

  return {
    kind: OPENMAS_OS_RESULT_RECORD_KINDS.resultRecord,
    schemaVersion: OPENMAS_OS_RESULT_RECORD_SCHEMA_VERSION,
    resultId: buildParentResumeResultRecordId(parentThread.threadId),
    resultKind: 'parent_resume_result',
    producer: {
      type: 'process',
      id: parentProcess.processId,
      operationalIdentityId: parentProcess.operationalIdentityId,
      activeCognitiveIdentityId: parentProcess.activeCognitiveIdentityId,
    },
    lineage: {
      jobId: parentJob.jobId,
      processId: parentProcess.processId,
      threadId: parentThread.threadId,
      parentProcessId: parentProcess.parentProcessId,
      invocationId: invocationResult?.invocationId ?? null,
      conversationId: parentProcess.conversationId ?? parentJob.conversationId,
    },
    status,
    phase: statusMapping.terminal ? 'terminal' : 'running',
    completion: {
      startedAt,
      completedAt: statusMapping.terminal ? finishedAt : null,
      durationMs: statusMapping.terminal ? calculateDurationMs(startedAt, finishedAt) : null,
      exitClass: statusMapping.terminal ? mapResultStatusToExitClass(status) : null,
    },
    summary: firstNonEmptyString([
      invocationResult?.message,
      `OpenMAS OS parent Process ${parentProcess.processId} resumed after child Result ${childResultRecord.resultId}.`,
    ]),
    artifactRefs: parentArtifactRefs,
    toolRunRefs: collectToolRunRefsFromInvocationResult(invocationResult),
    workflowRunRefs: collectWorkflowRunRefsFromInvocationResult(invocationResult),
    childResultRefs: [
      childResultRecord.resultId,
    ],
    warnings,
    failure: status === 'failed' ? buildResultFailure({
      failureSummary,
      invocationResult,
      failedAt: finishedAt,
      defaultReason: 'OpenMAS OS parent resume invocation failed.',
      defaultReasonCode: 'parent_resume_failed',
      defaultSource: 'openmas-os-parent-resume',
    }) : null,
    verification: buildResultVerification(invocationResult),
    visibility: {
      safeForHumanSummary: true,
      safeForAgentContext: true,
    },
    metadata: {
      parent: {
        jobId: parentJob.jobId,
        jobStatus: parentJob.status,
        processId: parentProcess.processId,
        processStatus: parentProcess.status,
        threadId: parentThread.threadId,
        threadStatus: parentThread.status,
      },
      child: {
        resultId: childResultRecord.resultId,
        resultKind: childResultRecord.resultKind,
        status: childResultRecord.status,
        processId: childResultRecord.lineage.processId,
        jobId: childResultRecord.lineage.jobId,
      },
      childResultSummary,
      finalAnswer: {
        invocationId: invocationResult?.invocationId ?? null,
        status: invocationResult?.status ?? null,
      },
      parentResumeStatus: statusMapping.processStatus,
      actionResultAssessment: invocationResult?.output?.actionResultAssessment ?? null,
      ...(recoveryStatus ? {
        recovery: {
          status: recoveryStatus,
        },
      } : {}),
    },
    createdAt: finishedAt,
  };
}

function buildRecoveredParentResumeInvocationResult({
  parentProcess,
}) {
  const failed = parentProcess.status === 'failed';
  const failedMessage = parentProcess.failureSummary?.message
    ?? 'OpenMAS OS recovered a failed parent resume from durable terminal Process state.';

  return {
    invocationId: null,
    status: failed ? 'failed' : 'completed',
    message: failed
      ? failedMessage
      : 'OpenMAS OS recovered completed parent resume evidence from durable terminal Process state.',
    warnings: parentProcess.warnings ?? [],
    errors: failed ? [failedMessage] : [],
    persistence: null,
  };
}

async function resolveChildResultRecordForRecoveredParentResume({
  adapter,
  childProcessId,
  completedAt,
}) {
  const childProcess = await adapter.loadProcess(childProcessId);
  const childJob = await adapter.loadJob(childProcess.jobId);
  const resultId = buildDelegatedChildResultId(childProcess.processId);

  try {
    return {
      childJob,
      childProcess,
      childResultRecord: await adapter.loadResultRecord(resultId),
    };
  } catch (error) {
    if (!isResultRecordNotFoundError(error)) {
      throw error;
    }
  }

  const childThread = await loadLatestTerminalThreadForProcess({
    adapter,
    processId: childProcess.processId,
  });
  const childResultRecord = await materializeDelegatedChildResultRecord({
    adapter,
    childExecution: {
      childJob,
      childProcess,
      childThread,
    },
    resultKind: 'delegated_child_result',
    recoveryStatus: 'recovered_terminal_child_result',
    completedAt,
  });

  return {
    childJob,
    childProcess,
    childResultRecord,
  };
}

export async function recoverUnlinkedParentResumeResults({
  adapter = null,
  projectRootPath = null,
  osRootPath = null,
  now = defaultNow,
  isJobActive = null,
} = {}) {
  const runtimeAdapter = assertChildResultRecoveryAdapter(
    assertAdapter(createAdapter({ adapter, projectRootPath, osRootPath })),
  );
  const recoveredAt = normalizeNow(now)();
  const jobIsActive = normalizeJobActivityProbe(isJobActive);
  const terminalParents = (await runtimeAdapter.listProcesses())
    .filter((processState) => {
      return processState.parentProcessId === null
        && Array.isArray(processState.childProcessIds)
        && processState.childProcessIds.length > 0
        && ['completed', 'failed'].includes(processState.status);
    });
  const recovery = {
    status: 'completed',
    observedAt: recoveredAt,
    scannedProcessCount: terminalParents.length,
    candidateCount: 0,
    recoveredCount: 0,
    activeExecutionSkippedCount: 0,
    legacySkippedCount: 0,
    failedCount: 0,
    recovered: [],
    failures: [],
  };

  for (const parentProcess of terminalParents) {
    try {
      const parentJob = await runtimeAdapter.loadJob(parentProcess.jobId);

      if (!await hasParentResumeRecoveryProvenance({
        adapter: runtimeAdapter,
        parentJob,
        parentProcess,
      })) {
        recovery.legacySkippedCount += 1;
        continue;
      }

      const parentThreads = (await runtimeAdapter.listThreads({ processId: parentProcess.processId }))
        .filter((thread) => {
          return thread.threadType === 'child_process_wait'
            && TERMINAL_THREAD_STATUSES.has(thread.status);
        });

      for (const parentThread of parentThreads) {
        const resultId = buildParentResumeResultRecordId(parentThread.threadId);

        try {
          await runtimeAdapter.loadResultRecord(resultId);
          continue;
        } catch (error) {
          if (!isResultRecordNotFoundError(error)) {
            throw error;
          }
        }

        if (jobIsActive(parentJob.jobId)) {
          recovery.activeExecutionSkippedCount += 1;
          continue;
        }

        const terminalParentJob = await recoverTerminalJobStateFromProcess({
          adapter: runtimeAdapter,
          job: parentJob,
          processState: parentProcess,
          recoveredAt,
        });

        if (!terminalParentJob) {
          continue;
        }

        const childProcessId = Array.isArray(parentProcess.childProcessIds)
          ? parentProcess.childProcessIds.at(-1) ?? null
          : null;

        if (!isNonEmptyString(childProcessId)) {
          continue;
        }

        recovery.candidateCount += 1;
        const {
          childJob,
          childProcess,
          childResultRecord,
        } = await resolveChildResultRecordForRecoveredParentResume({
          adapter: runtimeAdapter,
          childProcessId,
          completedAt: recoveredAt,
        });
        const invocationResult = buildRecoveredParentResumeInvocationResult({
          parentProcess,
        });
        const childResultSummary = createChildResultSummaryFromResultRecord({
          resultRecord: childResultRecord,
          childJob,
          childProcess,
        });
        const statusMapping = mapParentResumeStatus(invocationResult);
        const finishedAt = resolveTerminalTimestamp(parentProcess);
        const parentResumeResultRecord = await persistResultRecordIfMissing({
          adapter: runtimeAdapter,
          resultRecord: buildParentResumeResultRecord({
            parentJob: terminalParentJob,
            parentProcess,
            parentThread,
            childResultRecord,
            childResultSummary,
            invocationResult,
            statusMapping,
            failureSummary: parentProcess.failureSummary ?? terminalParentJob.failureSummary ?? null,
            parentArtifactRefs: buildArtifactRefsFromProcess(parentProcess),
            startedAt: parentThread.startedAt ?? parentProcess.startedAt ?? parentThread.createdAt,
            finishedAt,
            recoveryStatus: 'recovered_terminal_parent_resume_result',
          }),
        });

        await appendDelegationEvent({
          adapter: runtimeAdapter,
          eventType: 'delegation.parent_resume_result.recovered',
          targetType: 'process',
          targetId: parentProcess.processId,
          jobId: terminalParentJob.jobId,
          processId: parentProcess.processId,
          threadId: parentThread.threadId,
          occurredAt: recoveredAt,
          payload: {
            resultId: parentResumeResultRecord.resultId,
            childResultId: childResultRecord.resultId,
            recoveryStatus: 'recovered_terminal_parent_resume_result',
          },
        });

        recovery.recovered.push({
          jobId: terminalParentJob.jobId,
          processId: parentProcess.processId,
          threadId: parentThread.threadId,
          resultId: parentResumeResultRecord.resultId,
          resultStatus: parentResumeResultRecord.status,
        });
        recovery.recoveredCount += 1;
      }
    } catch (error) {
      recovery.failedCount += 1;
      recovery.failures.push({
        processId: parentProcess.processId,
        jobId: parentProcess.jobId,
        errorMessage: safeTrimmedString(error.message, 'Parent resume Result recovery failed.'),
      });
    }
  }

  if (recovery.failedCount > 0) {
    recovery.status = 'completed_with_failures';
  }

  return recovery;
}

async function delegateToOperationalIdentityUnlocked({
  adapter = null,
  projectRootPath = null,
  osRootPath = null,
  parentProcessId,
  parentThreadId,
  delegation,
  allowedDelegations = [],
  now = defaultNow,
} = {}) {
  const runtimeAdapter = assertAdapter(createAdapter({ adapter, projectRootPath, osRootPath }));
  const nowFn = normalizeNow(now);
  const nowTimestamp = nowFn();
  const safeDelegation = assertDelegationRequest(delegation);
  const parentProcess = await runtimeAdapter.loadProcess(parentProcessId);
  const parentThread = await runtimeAdapter.loadThread(parentThreadId ?? parentProcess.currentThreadId);
  const parentJob = await runtimeAdapter.loadJob(parentProcess.jobId);

  assertParentState({
    parentProcess,
    parentThread,
  });

  const authorization = authorizeDelegation({
    parentProcess,
    delegation: safeDelegation,
    allowedDelegations,
  });
  const delegationId = safeDelegation.delegationId ?? createRuntimeId('delegation');

  if (!authorization.authorized) {
    await appendDelegationEvent({
      adapter: runtimeAdapter,
      eventType: 'delegation.denied',
      source: {
        type: 'process',
        id: parentProcess.processId,
      },
      targetType: 'process',
      targetId: parentProcess.processId,
      jobId: parentProcess.jobId,
      processId: parentProcess.processId,
      threadId: parentThread.threadId,
      occurredAt: nowTimestamp,
      payload: {
        delegationId,
        reason: authorization.reason,
        fromOperationalIdentityId: parentProcess.operationalIdentityId,
        toOperationalIdentityId: safeDelegation.assignedOperationalIdentityId ?? null,
        programType: safeDelegation.program?.type ?? 'agent_invocation',
        command: safeDelegation.program?.command ?? 'ask',
      },
    });

    return {
      delegated: false,
      status: 'denied',
      reason: authorization.reason,
      authorization,
      delegationId,
      parentProcess,
      parentThread,
    };
  }

  const conversationHandoff = await resolveChildConversationHandoff({
    projectRootPath,
    delegation: safeDelegation,
    parentProcess,
  });
  const childJob = await runtimeAdapter.persistJob(createChildJob({
    delegation: safeDelegation,
    parentJob,
    parentProcess,
    parentThread,
    conversationId: conversationHandoff.childConversationId,
    nowTimestamp,
  }));
  const blockedParentThread = await runtimeAdapter.persistThread({
    ...parentThread,
    status: 'blocked',
    waitReason: 'waiting_for_child_process',
    updatedAt: nowTimestamp,
    completedAt: null,
  });
  const blockedParentProcess = await runtimeAdapter.persistProcess({
    ...parentProcess,
    status: 'blocked',
    currentThreadId: blockedParentThread.threadId,
    updatedAt: nowTimestamp,
  });

  await appendDelegationEvent({
    adapter: runtimeAdapter,
    eventType: 'delegation.requested',
    source: {
      type: 'process',
      id: parentProcess.processId,
    },
    targetType: 'process',
    targetId: blockedParentProcess.processId,
    jobId: blockedParentProcess.jobId,
    processId: blockedParentProcess.processId,
    threadId: blockedParentThread.threadId,
    occurredAt: nowTimestamp,
    payload: {
      delegationId,
      childJobId: childJob.jobId,
      authorizationRuleId: authorization.rule.ruleId,
      fromOperationalIdentityId: parentProcess.operationalIdentityId,
      toOperationalIdentityId: childJob.assignedOperationalIdentityId,
      programType: childJob.program.type,
      command: childJob.program.command ?? null,
      contextRefCount: Array.isArray(safeDelegation.contextRefs) ? safeDelegation.contextRefs.length : 0,
      conversationHandoff,
    },
  });
  await appendDelegationEvent({
    adapter: runtimeAdapter,
    eventType: 'job.created',
    source: {
      type: 'process',
      id: parentProcess.processId,
    },
    targetType: 'job',
    targetId: childJob.jobId,
    jobId: childJob.jobId,
    occurredAt: nowTimestamp,
    payload: {
      status: childJob.status,
      delegationId,
      parentProcessId: parentProcess.processId,
      parentThreadId: parentThread.threadId,
      assignedOperationalIdentityId: childJob.assignedOperationalIdentityId,
      programType: childJob.program.type,
      conversationId: childJob.conversationId,
      conversationHandoff,
    },
  });
  await appendDelegationEvent({
    adapter: runtimeAdapter,
    eventType: 'thread.blocked',
    source: {
      type: 'process',
      id: parentProcess.processId,
    },
    targetType: 'thread',
    targetId: blockedParentThread.threadId,
    jobId: blockedParentThread.jobId,
    processId: blockedParentThread.processId,
    threadId: blockedParentThread.threadId,
    occurredAt: nowTimestamp,
    payload: {
      status: blockedParentThread.status,
      waitReason: blockedParentThread.waitReason,
      delegationId,
      childJobId: childJob.jobId,
    },
  });
  await appendDelegationEvent({
    adapter: runtimeAdapter,
    eventType: 'process.blocked',
    source: {
      type: 'process',
      id: parentProcess.processId,
    },
    targetType: 'process',
    targetId: blockedParentProcess.processId,
    jobId: blockedParentProcess.jobId,
    processId: blockedParentProcess.processId,
    threadId: blockedParentThread.threadId,
    occurredAt: nowTimestamp,
    payload: {
      status: blockedParentProcess.status,
      currentThreadId: blockedParentProcess.currentThreadId,
      delegationId,
      childJobId: childJob.jobId,
    },
  });

  return {
    delegated: true,
    status: 'child_job_ready',
    delegationId,
    authorization,
    childJob,
    parentProcess: blockedParentProcess,
    parentThread: blockedParentThread,
    conversationHandoff,
  };
}

export async function delegateToOperationalIdentity(options = {}) {
  return withProcessDelegationLock(options.parentProcessId, () => {
    return delegateToOperationalIdentityUnlocked(options);
  });
}

async function scheduleDelegationToOperationalIdentityUnlocked({
  adapter = null,
  projectRootPath = null,
  osRootPath = null,
  parentProcessId,
  parentThreadId,
  delegation,
  runAt,
  missedRunPolicy = 'skip',
  deliveryMode = 'persist_only',
  sourceSystemCallId = null,
  allowedDelegations = [],
  allowTerminalParentSnapshot = false,
  parentAuthoritySnapshot = null,
  now = defaultNow,
} = {}) {
  const runtimeAdapter = assertAdapter(createAdapter({ adapter, projectRootPath, osRootPath }));
  const nowFn = normalizeNow(now);
  const nowTimestamp = nowFn();
  const safeDelegation = assertDelegationRequest(delegation);
  const scheduledRunAt = assertScheduledRunAt(runAt ?? safeDelegation.runAt);
  const parentProcess = await runtimeAdapter.loadProcess(parentProcessId);
  const parentThread = await runtimeAdapter.loadThread(parentThreadId ?? parentProcess.currentThreadId);
  const parentJob = await runtimeAdapter.loadJob(parentProcess.jobId);

  const parentAuthority = assertScheduledParentAuthority({
    parentProcess,
    parentThread,
    allowTerminalParentSnapshot,
    parentAuthoritySnapshot,
  });

  const authorization = authorizeDelegation({
    parentProcess,
    delegation: safeDelegation,
    allowedDelegations,
  });
  const delegationId = safeDelegation.delegationId ?? createRuntimeId('delegation');

  if (!authorization.authorized) {
    await appendDelegationEvent({
      adapter: runtimeAdapter,
      eventType: 'delegation.denied',
      source: {
        type: 'process',
        id: parentProcess.processId,
      },
      targetType: 'process',
      targetId: parentProcess.processId,
      jobId: parentProcess.jobId,
      processId: parentProcess.processId,
      threadId: parentThread.threadId,
      occurredAt: nowTimestamp,
      payload: {
        delegationId,
        actionType: 'schedule_delegation',
        reason: authorization.reason,
        fromOperationalIdentityId: parentProcess.operationalIdentityId,
        toOperationalIdentityId: safeDelegation.assignedOperationalIdentityId ?? null,
        programType: safeDelegation.program?.type ?? 'agent_invocation',
        command: safeDelegation.program?.command ?? 'ask',
        runAt: scheduledRunAt,
        parentAuthority,
      },
    });

    return {
      scheduled: false,
      status: 'denied',
      reason: authorization.reason,
      authorization,
      delegationId,
      parentProcess,
      parentThread,
      parentAuthority,
    };
  }

  const conversationHandoff = await resolveChildConversationHandoff({
    projectRootPath,
    delegation: safeDelegation,
    parentProcess,
  });
  const draftChildJob = await runtimeAdapter.persistJob(createChildJob({
    delegation: safeDelegation,
    parentJob,
    parentProcess,
    parentThread,
    conversationId: conversationHandoff.childConversationId,
    status: 'draft',
    trigger: {
      type: 'scheduled_once',
      runAt: scheduledRunAt,
    },
    nowTimestamp,
  }));
  const scheduledWork = await scheduleOneShotJob({
    adapter: runtimeAdapter,
    jobId: draftChildJob.jobId,
    now: () => nowTimestamp,
  });
  const scheduledTimer = await runtimeAdapter.persistTimer({
    ...scheduledWork.timer,
    payload: {
      ...(scheduledWork.timer.payload ?? {}),
      actionType: 'schedule_delegation',
      delegationId,
      parentProcessId: parentProcess.processId,
      parentThreadId: parentThread.threadId,
      missedRunPolicy,
      deliveryMode,
      ...(isNonEmptyString(sourceSystemCallId) ? {
        sourceSystemCallId: sourceSystemCallId.trim(),
      } : {}),
    },
  });

  await appendDelegationEvent({
    adapter: runtimeAdapter,
    eventType: 'delegation.scheduled',
    source: {
      type: 'process',
      id: parentProcess.processId,
    },
    targetType: 'process',
    targetId: parentProcess.processId,
    jobId: parentProcess.jobId,
    processId: parentProcess.processId,
    threadId: parentThread.threadId,
    occurredAt: nowTimestamp,
    payload: {
      delegationId,
      childJobId: scheduledWork.job.jobId,
      timerId: scheduledTimer.timerId,
      runAt: scheduledTimer.runAt,
      missedRunPolicy,
      authorizationRuleId: authorization.rule.ruleId,
      fromOperationalIdentityId: parentProcess.operationalIdentityId,
      toOperationalIdentityId: scheduledWork.job.assignedOperationalIdentityId,
      programType: scheduledWork.job.program.type,
      command: scheduledWork.job.program.command ?? null,
      contextRefCount: Array.isArray(safeDelegation.contextRefs) ? safeDelegation.contextRefs.length : 0,
      conversationHandoff,
      parentAuthority,
    },
  });

  return {
    scheduled: true,
    status: 'child_job_scheduled',
    delegationId,
    authorization,
    childJob: scheduledWork.job,
    timer: scheduledTimer,
    parentProcess,
    parentThread,
    conversationHandoff,
    parentAuthority,
  };
}

export async function scheduleDelegationToOperationalIdentity(options = {}) {
  return withProcessDelegationLock(options.parentProcessId, () => {
    return scheduleDelegationToOperationalIdentityUnlocked(options);
  });
}

function resolveChildSignalType(childProcess) {
  if (childProcess.status === 'completed') {
    return 'child_completed';
  }

  if (childProcess.status === 'failed' || childProcess.status === 'cancelled') {
    return 'child_failed';
  }

  return null;
}

export async function notifyDelegatedChildCompletion({
  adapter = null,
  projectRootPath = null,
  osRootPath = null,
  childProcessId,
  parentThreadId = null,
  childResultSummary = null,
  now = defaultNow,
} = {}) {
  const runtimeAdapter = assertAdapter(createAdapter({ adapter, projectRootPath, osRootPath }));
  const nowFn = normalizeNow(now);
  const childProcess = await runtimeAdapter.loadProcess(childProcessId);
  const signalType = resolveChildSignalType(childProcess);

  if (!isNonEmptyString(childProcess.parentProcessId)) {
    return {
      notified: false,
      status: 'child_process_has_no_parent',
      childProcess,
    };
  }

  if (!signalType) {
    return {
      notified: false,
      status: 'child_process_not_terminal',
      childProcess,
    };
  }

  const signaledAt = nowFn();
  const safeChildResultSummary = childResultSummary ?? createSafeChildResultSummary({
    childProcess,
  });
  const childResultRef = safeChildResultSummary.childResultId
    ?? safeChildResultSummary.resultSummary?.resultId
    ?? null;
  const signal = createOpenMasOsSignal({
    signalType,
    targetType: 'process',
    targetId: childProcess.parentProcessId,
    createdBy: {
      type: 'process',
      id: childProcess.processId,
    },
    createdAt: signaledAt,
    reason: `child_process_${childProcess.status}`,
    payload: {
      childProcessId: childProcess.processId,
      childJobId: childProcess.jobId,
      childStatus: childProcess.status,
      parentThreadId,
      childResultRef,
      childResultSummary: safeChildResultSummary,
    },
  });
  const signalResult = await applySignal({
    adapter: runtimeAdapter,
    signal,
    now: () => signaledAt,
  });

  return {
    notified: signalResult.applied,
    status: signalResult.status,
    childProcess,
    signalResult,
  };
}

export async function runDelegatedJobNow({
  adapter = null,
  projectRootPath = null,
  osRootPath = null,
  childJobId,
  parentProcessId,
  parentThreadId = null,
  notifyParent = true,
  parentCompletionMode = null,
  childResultKind = null,
  scheduledTimer = null,
  deliveryMode = null,
  now = defaultNow,
  invocationRunner,
  invocationOptions = {},
} = {}) {
  const runtimeAdapter = assertAdapter(createAdapter({ adapter, projectRootPath, osRootPath }));
  const execution = await runJobNow({
    adapter: runtimeAdapter,
    projectRootPath,
    osRootPath,
    jobId: childJobId,
    parentProcessId,
    now,
    invocationRunner,
    invocationOptions,
  });
  const materializedResultKind = childResultKind ?? (notifyParent ? 'delegated_child_result' : null);
  const childCompleted = OPENMAS_OS_TERMINAL_PROCESS_STATUSES.has(execution.process.status);
  const childResultRecord = materializedResultKind && childCompleted
    ? await materializeDelegatedChildResultRecord({
      adapter: runtimeAdapter,
      childExecution: {
        ...execution,
        childJob: execution.job,
        childProcess: execution.process,
        childThread: execution.thread,
      },
      parentThreadId,
      resultKind: materializedResultKind,
      scheduledTimer,
      deliveryMode,
      completedAt: execution.process.completedAt ?? execution.process.failedAt ?? execution.process.updatedAt,
    })
    : null;
  const linkedScheduledTimer = await linkScheduledChildResultToTimer({
    adapter: runtimeAdapter,
    scheduledTimer,
    childResultRecord,
    linkedAt: execution.process.completedAt ?? execution.process.failedAt ?? execution.process.updatedAt,
  });
  const childResultSummary = childResultRecord
    ? createChildResultSummaryFromResultRecord({
      resultRecord: childResultRecord,
      childJob: execution.job,
      childProcess: execution.process,
      invocationResult: execution.invocationResult,
    })
    : createSafeChildResultSummary({
      childJob: execution.job,
      childProcess: execution.process,
      invocationResult: execution.invocationResult,
    });
  const notification = notifyParent
    ? await notifyDelegatedChildCompletion({
      adapter: runtimeAdapter,
      projectRootPath,
      osRootPath,
      childProcessId: execution.process.processId,
      parentThreadId,
      childResultSummary,
      now,
    })
    : null;
  const parentCompletion = notifyParent
    ? {
      mode: 'parent_signal',
      notified: notification.notified,
      status: notification.status,
      reason: notification.signalResult?.reason ?? null,
    }
    : {
      mode: parentCompletionMode ?? 'no_parent_notification',
      notified: false,
      status: 'not_expected',
      reason: 'parent_notification_not_expected',
    };

  return {
    ...execution,
    childJob: execution.job,
    childProcess: execution.process,
    childThread: execution.thread,
    childResultSummary,
    childResultRecord,
    scheduledTimer: linkedScheduledTimer,
    notification,
    parentCompletion,
  };
}

async function resumeParentAfterDelegatedChildUnlocked({
  adapter = null,
  projectRootPath = null,
  osRootPath = null,
  parentProcessId,
  continuationThreadId = null,
  childExecution,
  childResultSummary = null,
  now = defaultNow,
  invocationRunner = runAgentInvocation,
  invocationOptions = {},
} = {}) {
  const runtimeAdapter = assertAdapter(createAdapter({ adapter, projectRootPath, osRootPath }));
  const nowFn = normalizeNow(now);
  const parentProcess = await runtimeAdapter.loadProcess(parentProcessId);
  const parentJob = await runtimeAdapter.loadJob(parentProcess.jobId);
  const continuationThread = await runtimeAdapter.loadThread(continuationThreadId ?? parentProcess.currentThreadId);

  if (parentProcess.status !== 'ready') {
    throw new Error(`OpenMAS OS parent Process ${parentProcess.processId} must be ready before resume. Current status: ${parentProcess.status}.`);
  }

  if (continuationThread.status !== 'ready' || continuationThread.threadType !== 'child_process_wait') {
    throw new Error(`OpenMAS OS parent continuation Thread ${continuationThread.threadId} must be a ready child_process_wait Thread before resume.`);
  }

  const resumeChildProcess = childExecution?.childProcess ?? childExecution?.process;
  const childResultRecord = await resolveDelegatedChildResultRecordForResume({
    adapter: runtimeAdapter,
    childExecution,
    childResultSummary,
    parentThreadId: continuationThread.threadId,
    completedAt: resumeChildProcess?.completedAt ?? resumeChildProcess?.failedAt ?? resumeChildProcess?.updatedAt,
  });
  const safeChildResultSummary = childResultSummary?.childResultId || childResultSummary?.resultSummary?.resultId
    ? assertSafeOsSerializableValue(childResultSummary, 'OpenMAS OS child result summary')
    : createChildResultSummaryFromResultRecord({
      resultRecord: childResultRecord,
      childJob: childExecution?.childJob ?? childExecution?.job,
      childProcess: childExecution?.childProcess ?? childExecution?.process,
      invocationResult: childExecution?.invocationResult,
    });
  const startedAt = nowFn();
  const runningThread = await runtimeAdapter.persistThread({
    ...continuationThread,
    status: 'running',
    waitReason: null,
    startedAt: continuationThread.startedAt ?? startedAt,
    updatedAt: startedAt,
    completedAt: null,
  });
  const runningProcess = await runtimeAdapter.persistProcess({
    ...parentProcess,
    status: 'running',
    currentThreadId: runningThread.threadId,
    updatedAt: startedAt,
  });

  await appendDelegationEvent({
    adapter: runtimeAdapter,
    eventType: 'delegation.parent_resume.started',
    source: createSystemActor(),
    targetType: 'process',
    targetId: runningProcess.processId,
    jobId: runningProcess.jobId,
    processId: runningProcess.processId,
    threadId: runningThread.threadId,
    occurredAt: startedAt,
    payload: {
      childResultSummary: safeChildResultSummary,
    },
  });

  let invocationResult;
  const parentResumeInvocationOptions = buildParentResumeInvocationOptions({
    parentJob,
    parentProcess: runningProcess,
    continuationThread: runningThread,
    childJob: childExecution?.childJob ?? childExecution?.job ?? null,
    childResultSummary: safeChildResultSummary,
    projectRootPath,
    invocationOptions,
  });

  try {
    invocationResult = await invocationRunner(parentResumeInvocationOptions);
  } catch (error) {
    const missingConversationId = extractMissingConversationId(error);

    if (missingConversationId && parentResumeInvocationOptions.conversationRef) {
      const fallbackWarning = buildParentResumeConversationFallbackWarning(missingConversationId);

      try {
        invocationResult = await invocationRunner(buildParentResumeWithoutConversationFallbackOptions({
          options: parentResumeInvocationOptions,
          missingConversationId,
        }));
        invocationResult = {
          ...invocationResult,
          warnings: [
            ...(invocationResult.warnings ?? []),
            fallbackWarning,
          ],
        };
      } catch (fallbackError) {
        const safeMessage = createSafeErrorMessage(fallbackError, 'OpenMAS OS parent resume invocation failed.');

        invocationResult = {
          invocationId: createRuntimeId('parent_resume_failure'),
          status: 'failed',
          message: safeMessage,
          warnings: [fallbackWarning],
          errors: [safeMessage],
          persistence: null,
        };
      }
    } else {
      const safeMessage = createSafeErrorMessage(error, 'OpenMAS OS parent resume invocation failed.');

      invocationResult = {
        invocationId: createRuntimeId('parent_resume_failure'),
        status: 'failed',
        message: safeMessage,
        warnings: [],
        errors: [safeMessage],
        persistence: null,
      };
    }
  }

  const missingConversationIdFromFailedResult = invocationResult?.status === 'failed'
    && parentResumeInvocationOptions.conversationRef
    ? extractMissingConversationId(invocationResult)
    : null;

  if (missingConversationIdFromFailedResult) {
    const fallbackWarning = buildParentResumeConversationFallbackWarning(missingConversationIdFromFailedResult);

    try {
      invocationResult = await invocationRunner(buildParentResumeWithoutConversationFallbackOptions({
        options: parentResumeInvocationOptions,
        missingConversationId: missingConversationIdFromFailedResult,
      }));
      invocationResult = {
        ...invocationResult,
        warnings: [
          ...(invocationResult.warnings ?? []),
          fallbackWarning,
        ],
      };
    } catch (fallbackError) {
      const safeMessage = createSafeErrorMessage(fallbackError, 'OpenMAS OS parent resume invocation failed.');

      invocationResult = {
        invocationId: createRuntimeId('parent_resume_failure'),
        status: 'failed',
        message: safeMessage,
        warnings: [
          ...(invocationResult.warnings ?? []),
          fallbackWarning,
        ],
        errors: [safeMessage],
        persistence: null,
      };
    }
  }

  const finishedAt = nowFn();
  const statusMapping = mapParentResumeStatus(invocationResult);
  const failureSummary = statusMapping.eventSuffix === 'failed'
    ? createSafeFailureSummaryFromInvocationResult({
      invocationResult,
      failedAt: finishedAt,
      source: 'openmas-os-parent-resume',
      reasonCode: 'parent_resume_failed',
      reason: 'OpenMAS OS parent resume invocation failed.',
    })
    : null;
  const finalParentThread = await runtimeAdapter.persistThread({
    ...runningThread,
    status: statusMapping.threadStatus,
    waitReason: statusMapping.threadWaitReason,
    updatedAt: finishedAt,
    completedAt: statusMapping.terminal ? finishedAt : null,
    failedAt: statusMapping.threadStatus === 'failed' ? finishedAt : null,
    failureSummary: statusMapping.threadStatus === 'failed' ? failureSummary : null,
  });
  const parentArtifactRefs = buildArtifactRefsFromInvocationResult(invocationResult);
  const finalParentProcess = await runtimeAdapter.persistProcess({
    ...runningProcess,
    status: statusMapping.processStatus,
    activeCognitiveIdentityId: firstNonEmptyString([
      invocationResult?.readiness?.activeCognitiveSet?.primaryCognitiveIdentityId,
      invocationResult?.workCycle?.primaryCognitiveIdentityId,
      invocationResult?.primaryCognitiveIdentityId,
      runningProcess.activeCognitiveIdentityId,
    ]),
    currentThreadId: statusMapping.terminal ? null : finalParentThread.threadId,
    artifactRefs: [
      ...buildArtifactRefsFromProcess(runningProcess),
      ...parentArtifactRefs,
    ],
    warnings: [
      ...(runningProcess.warnings ?? []),
      ...(invocationResult.warnings ?? []),
    ],
    updatedAt: finishedAt,
    completedAt: statusMapping.terminal ? finishedAt : null,
    failedAt: statusMapping.processStatus === 'failed' ? finishedAt : null,
    failureSummary: statusMapping.processStatus === 'failed' ? failureSummary : null,
  });
  const finalParentJob = await runtimeAdapter.persistJob({
    ...parentJob,
    status: statusMapping.jobStatus,
    updatedAt: finishedAt,
    failedAt: statusMapping.jobStatus === 'failed' ? finishedAt : null,
    failureSummary: statusMapping.jobStatus === 'failed' ? failureSummary : null,
  });
  const evidenceRefs = [
    ...safeChildResultSummary.artifactRefs,
    ...parentArtifactRefs,
  ];

  if (statusMapping.eventSuffix) {
    await appendDelegationEvent({
      adapter: runtimeAdapter,
      eventType: `thread.${statusMapping.eventSuffix}`,
      source: createSystemActor(),
      targetType: 'thread',
      targetId: finalParentThread.threadId,
      jobId: finalParentThread.jobId,
      processId: finalParentThread.processId,
      threadId: finalParentThread.threadId,
      occurredAt: finishedAt,
      payload: {
        invocationId: invocationResult.invocationId,
        invocationStatus: invocationResult.status,
        ...(failureSummary ? {
          failedAt: finalParentThread.failedAt,
          failureSummary,
        } : {}),
      },
    });
    await appendDelegationEvent({
      adapter: runtimeAdapter,
      eventType: `process.${statusMapping.eventSuffix}`,
      source: createSystemActor(),
      targetType: 'process',
      targetId: finalParentProcess.processId,
      jobId: finalParentProcess.jobId,
      processId: finalParentProcess.processId,
      threadId: finalParentThread.threadId,
      occurredAt: finishedAt,
      payload: {
        invocationId: invocationResult.invocationId,
        invocationStatus: invocationResult.status,
        ...(failureSummary ? {
          failedAt: finalParentProcess.failedAt,
          failureSummary,
        } : {}),
      },
    });
    await appendDelegationEvent({
      adapter: runtimeAdapter,
      eventType: `job.${statusMapping.eventSuffix}`,
      source: createSystemActor(),
      targetType: 'job',
      targetId: finalParentJob.jobId,
      jobId: finalParentJob.jobId,
      processId: finalParentProcess.processId,
      threadId: finalParentThread.threadId,
      occurredAt: finishedAt,
      payload: {
        invocationId: invocationResult.invocationId,
        invocationStatus: invocationResult.status,
        ...(failureSummary ? {
          failedAt: finalParentJob.failedAt,
          failureSummary,
        } : {}),
      },
    });
  }

  const parentResumeResultRecord = await persistResultRecordIfMissing({
    adapter: assertResultRecordAdapter(runtimeAdapter),
    resultRecord: buildParentResumeResultRecord({
      parentJob: finalParentJob,
      parentProcess: finalParentProcess,
      parentThread: finalParentThread,
      childResultRecord,
      childResultSummary: safeChildResultSummary,
      invocationResult,
      statusMapping,
      failureSummary,
      parentArtifactRefs,
      startedAt,
      finishedAt,
    }),
  });
  const parentResumeResult = buildParentResumeResult({
    status: statusMapping.terminal ? 'final_answer_completed' : 'parent_blocked',
    parentJob: finalParentJob,
    parentProcess: finalParentProcess,
    parentThread: finalParentThread,
    childResultSummary: safeChildResultSummary,
    invocationResult,
    evidenceRefs,
    childResultRef: childResultRecord.resultId,
    parentResumeResultRef: parentResumeResultRecord.resultId,
  });

  await appendDelegationEvent({
    adapter: runtimeAdapter,
    eventType: 'delegation.parent_resume.completed',
    source: createSystemActor(),
    targetType: 'process',
    targetId: finalParentProcess.processId,
    jobId: finalParentProcess.jobId,
    processId: finalParentProcess.processId,
    threadId: finalParentThread.threadId,
    occurredAt: finishedAt,
    payload: parentResumeResult,
  });

  return {
    resumed: true,
    status: parentResumeResult.status,
    parentJob: finalParentJob,
    parentProcess: finalParentProcess,
    parentThread: finalParentThread,
    childResultSummary: safeChildResultSummary,
    invocationResult,
    parentResumeResult,
    parentResumeResultRecord,
  };
}

export async function resumeParentAfterDelegatedChild(options = {}) {
  return withProcessDelegationLock(options.parentProcessId, () => {
    return resumeParentAfterDelegatedChildUnlocked(options);
  });
}

export async function runDelegatedJobAndResumeParentNow({
  adapter = null,
  projectRootPath = null,
  osRootPath = null,
  childJobId,
  parentProcessId,
  parentThreadId = null,
  now = defaultNow,
  childInvocationRunner,
  parentInvocationRunner = runAgentInvocation,
  childInvocationOptions = {},
  parentInvocationOptions = {},
} = {}) {
  const runtimeAdapter = assertAdapter(createAdapter({ adapter, projectRootPath, osRootPath }));
  const childExecution = await runDelegatedJobNow({
    adapter: runtimeAdapter,
    projectRootPath,
    osRootPath,
    childJobId,
    parentProcessId,
    parentThreadId,
    now,
    invocationRunner: childInvocationRunner,
    invocationOptions: childInvocationOptions,
  });

  if (!childExecution.notification.notified || !childExecution.notification.signalResult?.applied) {
    return {
      childExecution,
      parentResume: null,
      parentResumeResult: null,
      status: 'parent_not_resumed',
    };
  }

  const parentResume = await resumeParentAfterDelegatedChild({
    adapter: runtimeAdapter,
    projectRootPath,
    osRootPath,
    parentProcessId,
    continuationThreadId: childExecution.notification.signalResult.continuationThread?.threadId,
    childExecution,
    childResultSummary: childExecution.childResultSummary,
    now,
    invocationRunner: parentInvocationRunner,
    invocationOptions: parentInvocationOptions,
  });

  return {
    childExecution,
    parentResume,
    parentResumeResult: parentResume.parentResumeResult,
    parentResumeResultRecord: parentResume.parentResumeResultRecord,
    status: parentResume.status,
  };
}

export class DelegationManager {
  constructor({
    adapter = null,
    projectRootPath = null,
    osRootPath = null,
    allowedDelegations = [],
    now = defaultNow,
  } = {}) {
    this.adapter = assertAdapter(createAdapter({ adapter, projectRootPath, osRootPath }));
    this.projectRootPath = projectRootPath;
    this.osRootPath = osRootPath;
    this.allowedDelegations = allowedDelegations;
    this.now = normalizeNow(now);
  }

  async delegate(options = {}) {
    return delegateToOperationalIdentity({
      adapter: this.adapter,
      projectRootPath: this.projectRootPath,
      osRootPath: this.osRootPath,
      allowedDelegations: this.allowedDelegations,
      now: this.now,
      ...options,
    });
  }

  async scheduleDelegation(options = {}) {
    return scheduleDelegationToOperationalIdentity({
      adapter: this.adapter,
      projectRootPath: this.projectRootPath,
      osRootPath: this.osRootPath,
      allowedDelegations: this.allowedDelegations,
      now: this.now,
      ...options,
    });
  }

  async runChildNow(options = {}) {
    return runDelegatedJobNow({
      adapter: this.adapter,
      projectRootPath: this.projectRootPath,
      osRootPath: this.osRootPath,
      now: this.now,
      ...options,
    });
  }

  async runChildAndResumeParentNow(options = {}) {
    return runDelegatedJobAndResumeParentNow({
      adapter: this.adapter,
      projectRootPath: this.projectRootPath,
      osRootPath: this.osRootPath,
      now: this.now,
      ...options,
    });
  }

  async resumeParentAfterChild(options = {}) {
    return resumeParentAfterDelegatedChild({
      adapter: this.adapter,
      projectRootPath: this.projectRootPath,
      osRootPath: this.osRootPath,
      now: this.now,
      ...options,
    });
  }

  async notifyChildCompletion(options = {}) {
    return notifyDelegatedChildCompletion({
      adapter: this.adapter,
      projectRootPath: this.projectRootPath,
      osRootPath: this.osRootPath,
      now: this.now,
      ...options,
    });
  }
}

export function createDelegationManager(options = {}) {
  return new DelegationManager(options);
}
