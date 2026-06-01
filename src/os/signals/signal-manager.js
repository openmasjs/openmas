import { randomUUID } from 'node:crypto';
import {
  OPENMAS_OS_KINDS,
  OPENMAS_OS_SCHEMA_VERSION,
  OPENMAS_OS_TERMINAL_PROCESS_STATUSES,
  assertOpenMasOsSignal,
  assertSafeOsSerializableValue,
} from '../../contracts/os/openmas-os-runtime-contract.js';
import { createLocalRuntimeAdapter } from '../adapters/local-runtime-adapter.js';
import { createSafeFailureSummary } from '../failure-summary.js';

const TERMINAL_JOB_STATUSES = new Set([
  'completed',
  'cancelled',
  'expired',
  'failed',
]);

const TERMINAL_THREAD_STATUSES = new Set([
  'completed',
  'failed',
  'cancelled',
]);

const SUPPORTED_SIGNAL_TYPES = new Set([
  'pause',
  'resume',
  'cancel',
  'timeout',
  'approval_granted',
  'approval_rejected',
  'child_completed',
  'child_failed',
]);

const SECRET_VALUE_REDACTION_PATTERNS = Object.freeze([
  /sk-(?:or-)?[a-zA-Z0-9_-]{8,}/gu,
  /AIza[a-zA-Z0-9_-]{10,}/gu,
  /xox[baprs]-[a-zA-Z0-9-]{8,}/gu,
  /Bearer\s+[a-zA-Z0-9._~+/-]{12,}/giu,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/gu,
]);

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function defaultNow() {
  return new Date().toISOString();
}

function normalizeNow(now) {
  if (now === undefined || now === null) {
    return defaultNow;
  }

  if (typeof now !== 'function') {
    throw new Error('OpenMAS OS Signal Manager now must be a function when provided.');
  }

  return now;
}

function createEventId() {
  return `event_${randomUUID()}`;
}

function createRuntimeId(prefix) {
  return `${prefix}_${randomUUID()}`;
}

function createAdapter({ adapter = null, projectRootPath = null, osRootPath = null } = {}) {
  return adapter ?? createLocalRuntimeAdapter({ projectRootPath, osRootPath });
}

function assertAdapter(adapter) {
  if (!adapter || typeof adapter !== 'object') {
    throw new Error('OpenMAS OS Signal Manager requires a runtime adapter.');
  }

  for (const methodName of [
    'loadJob',
    'persistJob',
    'loadProcess',
    'persistProcess',
    'loadThread',
    'persistThread',
    'loadTimer',
    'persistTimer',
    'appendEvent',
  ]) {
    if (typeof adapter[methodName] !== 'function') {
      throw new Error(`OpenMAS OS runtime adapter must implement ${methodName}.`);
    }
  }

  return adapter;
}

function redactSecretLikeValues(value) {
  const stringValue = String(value ?? '');
  let redactedValue = stringValue;

  for (const pattern of SECRET_VALUE_REDACTION_PATTERNS) {
    redactedValue = redactedValue.replace(pattern, '[redacted-secret]');
  }

  return redactedValue.slice(0, 1000);
}

function createSafeErrorMessage(error, fallbackMessage = 'OpenMAS OS Signal Manager rejected the Signal.') {
  if (error instanceof Error && isNonEmptyString(error.message)) {
    return redactSecretLikeValues(error.message);
  }

  if (isNonEmptyString(error)) {
    return redactSecretLikeValues(error);
  }

  return fallbackMessage;
}

function createSafePayload(payload, description) {
  if (payload === undefined || payload === null) {
    return {};
  }

  try {
    return assertSafeOsSerializableValue(payload, description);
  } catch (error) {
    return {
      omitted: true,
      reason: 'unsafe_payload',
      errorMessage: createSafeErrorMessage(error, 'OpenMAS OS omitted unsafe Signal payload.'),
    };
  }
}

function resolveOneShotTimerId(jobId) {
  return `timer_${jobId}`;
}

function isMissingRuntimeStateError(error) {
  return error instanceof Error && /was not found/u.test(error.message);
}

async function loadTimerIfPresent(adapter, timerId) {
  try {
    return await adapter.loadTimer(timerId);
  } catch (error) {
    if (isMissingRuntimeStateError(error)) {
      return null;
    }

    throw error;
  }
}

function buildEventTargetIds({ targetType, targetId, jobId = null, processId = null, threadId = null } = {}) {
  return {
    jobId: jobId ?? (targetType === 'job' ? targetId : null),
    processId: processId ?? (targetType === 'process' ? targetId : null),
    threadId: threadId ?? (targetType === 'thread' ? targetId : null),
  };
}

async function appendRuntimeEvent({
  adapter,
  eventType,
  source,
  targetType,
  targetId,
  occurredAt,
  jobId = null,
  processId = null,
  threadId = null,
  payload = {},
}) {
  const targetIds = buildEventTargetIds({
    targetType,
    targetId,
    jobId,
    processId,
    threadId,
  });

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
    jobId: targetIds.jobId,
    processId: targetIds.processId,
    threadId: targetIds.threadId,
    occurredAt,
    payload: createSafePayload(payload, `OpenMAS OS Event ${eventType} payload`),
  });
}

function buildSignalAuditReferencePayload(signal) {
  if (signal.signalType !== 'child_completed' && signal.signalType !== 'child_failed') {
    return {};
  }

  return {
    childProcessId: signal.payload?.childProcessId ?? null,
    childJobId: signal.payload?.childJobId ?? null,
    childStatus: signal.payload?.childStatus ?? null,
    childResultRef: signal.payload?.childResultRef ?? null,
  };
}

async function appendSignalAuditEvent({
  adapter,
  eventType,
  signal,
  occurredAt,
  payload = {},
}) {
  return appendRuntimeEvent({
    adapter,
    eventType,
    source: signal.createdBy,
    targetType: signal.targetType,
    targetId: signal.targetId,
    occurredAt,
    payload: {
      signalId: signal.signalId,
      signalType: signal.signalType,
      reason: signal.reason,
      ...buildSignalAuditReferencePayload(signal),
      ...payload,
    },
  });
}

async function cancelTimerForJobIfPresent({ adapter, jobId, signal, nowTimestamp }) {
  const timer = await loadTimerIfPresent(adapter, resolveOneShotTimerId(jobId));

  if (!timer || timer.status !== 'scheduled') {
    return null;
  }

  const cancelledTimer = await adapter.persistTimer({
    ...timer,
    status: 'cancelled',
    updatedAt: nowTimestamp,
  });

  await appendRuntimeEvent({
    adapter,
    eventType: 'timer.cancelled',
    source: signal.createdBy,
    targetType: 'timer',
    targetId: cancelledTimer.timerId,
    jobId: cancelledTimer.jobId,
    occurredAt: nowTimestamp,
    payload: {
      status: cancelledTimer.status,
      signalId: signal.signalId,
      signalType: signal.signalType,
    },
  });

  return cancelledTimer;
}

async function resumeScheduledJobStatus({ adapter, job }) {
  if (!['scheduled_once', 'recurring'].includes(job.trigger.type)) {
    return 'ready';
  }

  const timer = await loadTimerIfPresent(adapter, resolveOneShotTimerId(job.jobId));

  return timer?.status === 'scheduled' ? 'scheduled' : 'ready';
}

async function applyJobSignal({ adapter, signal, nowTimestamp }) {
  const job = await adapter.loadJob(signal.targetId);

  if (signal.signalType === 'cancel') {
    if (TERMINAL_JOB_STATUSES.has(job.status)) {
      return {
        applied: false,
        status: 'ignored',
        reason: 'job_already_terminal',
        job,
      };
    }

    const cancelledTimer = await cancelTimerForJobIfPresent({
      adapter,
      jobId: job.jobId,
      signal,
      nowTimestamp,
    });
    const cancelledJob = await adapter.persistJob({
      ...job,
      status: 'cancelled',
      updatedAt: nowTimestamp,
    });

    await appendRuntimeEvent({
      adapter,
      eventType: 'job.cancelled',
      source: signal.createdBy,
      targetType: 'job',
      targetId: cancelledJob.jobId,
      jobId: cancelledJob.jobId,
      occurredAt: nowTimestamp,
      payload: {
        status: cancelledJob.status,
        previousStatus: job.status,
        signalId: signal.signalId,
        timerId: cancelledTimer?.timerId ?? null,
      },
    });

    return {
      applied: true,
      status: 'cancelled',
      job: cancelledJob,
      timer: cancelledTimer,
    };
  }

  if (signal.signalType === 'pause') {
    if (TERMINAL_JOB_STATUSES.has(job.status)) {
      return {
        applied: false,
        status: 'ignored',
        reason: 'job_already_terminal',
        job,
      };
    }

    if (job.status === 'paused') {
      return {
        applied: false,
        status: 'ignored',
        reason: 'job_already_paused',
        job,
      };
    }

    const pausedJob = await adapter.persistJob({
      ...job,
      status: 'paused',
      updatedAt: nowTimestamp,
    });

    await appendRuntimeEvent({
      adapter,
      eventType: 'job.paused',
      source: signal.createdBy,
      targetType: 'job',
      targetId: pausedJob.jobId,
      jobId: pausedJob.jobId,
      occurredAt: nowTimestamp,
      payload: {
        status: pausedJob.status,
        previousStatus: job.status,
        signalId: signal.signalId,
      },
    });

    return {
      applied: true,
      status: 'paused',
      job: pausedJob,
    };
  }

  if (signal.signalType === 'resume') {
    if (job.status !== 'paused') {
      return {
        applied: false,
        status: 'ignored',
        reason: 'job_not_paused',
        job,
      };
    }

    const resumedStatus = await resumeScheduledJobStatus({ adapter, job });
    const resumedJob = await adapter.persistJob({
      ...job,
      status: resumedStatus,
      updatedAt: nowTimestamp,
    });

    await appendRuntimeEvent({
      adapter,
      eventType: 'job.resumed',
      source: signal.createdBy,
      targetType: 'job',
      targetId: resumedJob.jobId,
      jobId: resumedJob.jobId,
      occurredAt: nowTimestamp,
      payload: {
        status: resumedJob.status,
        previousStatus: job.status,
        signalId: signal.signalId,
      },
    });

    return {
      applied: true,
      status: resumedJob.status,
      job: resumedJob,
    };
  }

  if (signal.signalType === 'timeout') {
    if (TERMINAL_JOB_STATUSES.has(job.status)) {
      return {
        applied: false,
        status: 'ignored',
        reason: 'job_already_terminal',
        job,
      };
    }

    const expiredJob = await adapter.persistJob({
      ...job,
      status: 'expired',
      updatedAt: nowTimestamp,
    });

    await appendRuntimeEvent({
      adapter,
      eventType: 'job.expired',
      source: signal.createdBy,
      targetType: 'job',
      targetId: expiredJob.jobId,
      jobId: expiredJob.jobId,
      occurredAt: nowTimestamp,
      payload: {
        status: expiredJob.status,
        previousStatus: job.status,
        signalId: signal.signalId,
      },
    });

    return {
      applied: true,
      status: 'expired',
      job: expiredJob,
    };
  }

  return {
    applied: false,
    status: 'unsupported_signal',
    reason: `Signal ${signal.signalType} is not supported for Job targets in Signals v1.`,
    job,
  };
}

async function cancelCurrentThreadIfPresent({ adapter, processState, signal, nowTimestamp }) {
  if (!processState.currentThreadId) {
    return null;
  }

  const thread = await adapter.loadThread(processState.currentThreadId);

  if (TERMINAL_THREAD_STATUSES.has(thread.status)) {
    return thread;
  }

  const cancelledThread = await adapter.persistThread({
    ...thread,
    status: 'cancelled',
    waitReason: null,
    updatedAt: nowTimestamp,
    completedAt: nowTimestamp,
  });

  await appendRuntimeEvent({
    adapter,
    eventType: 'thread.cancelled',
    source: signal.createdBy,
    targetType: 'thread',
    targetId: cancelledThread.threadId,
    jobId: cancelledThread.jobId,
    processId: cancelledThread.processId,
    threadId: cancelledThread.threadId,
    occurredAt: nowTimestamp,
    payload: {
      status: cancelledThread.status,
      previousStatus: thread.status,
      signalId: signal.signalId,
    },
  });

  return cancelledThread;
}

async function cancelJobForProcessIfActive({ adapter, processState, signal, nowTimestamp }) {
  const job = await adapter.loadJob(processState.jobId);

  if (TERMINAL_JOB_STATUSES.has(job.status)) {
    return job;
  }

  const cancelledJob = await adapter.persistJob({
    ...job,
    status: 'cancelled',
    updatedAt: nowTimestamp,
  });

  await appendRuntimeEvent({
    adapter,
    eventType: 'job.cancelled',
    source: signal.createdBy,
    targetType: 'job',
    targetId: cancelledJob.jobId,
    jobId: cancelledJob.jobId,
    processId: processState.processId,
    occurredAt: nowTimestamp,
    payload: {
      status: cancelledJob.status,
      previousStatus: job.status,
      signalId: signal.signalId,
    },
  });

  return cancelledJob;
}

async function loadThreadIfPresent(adapter, threadId) {
  if (!isNonEmptyString(threadId)) {
    return null;
  }

  try {
    return await adapter.loadThread(threadId);
  } catch (error) {
    if (isMissingRuntimeStateError(error)) {
      return null;
    }

    throw error;
  }
}

async function loadProcessIfPresent(adapter, processId) {
  if (!isNonEmptyString(processId)) {
    return null;
  }

  try {
    return await adapter.loadProcess(processId);
  } catch (error) {
    if (isMissingRuntimeStateError(error)) {
      return null;
    }

    throw error;
  }
}

function appendUniqueChildProcessId(childProcessIds, childProcessId) {
  if (!isNonEmptyString(childProcessId)) {
    throw new Error('OpenMAS OS child completion Signals require payload.childProcessId.');
  }

  const existingChildProcessIds = Array.isArray(childProcessIds) ? childProcessIds : [];

  return existingChildProcessIds.includes(childProcessId)
    ? existingChildProcessIds
    : [...existingChildProcessIds, childProcessId];
}

function childProcessStatusMatchesCompletionSignal(signalType, childProcessStatus) {
  if (signalType === 'child_completed') {
    return childProcessStatus === 'completed';
  }

  if (signalType === 'child_failed') {
    return ['failed', 'cancelled'].includes(childProcessStatus);
  }

  return false;
}

async function applyChildCompletionSignal({ adapter, signal, processState, nowTimestamp }) {
  if (OPENMAS_OS_TERMINAL_PROCESS_STATUSES.has(processState.status)) {
    return {
      applied: false,
      status: 'ignored',
      reason: 'process_already_terminal',
      process: processState,
    };
  }

  if (processState.status !== 'blocked') {
    return {
      applied: false,
      status: 'ignored',
      reason: 'process_not_waiting_for_child',
      process: processState,
    };
  }

  const childProcessId = signal.payload?.childProcessId;

  if (!isNonEmptyString(childProcessId)) {
    return {
      applied: false,
      status: 'rejected',
      reason: 'missing_child_process_id',
      process: processState,
    };
  }

  const parentThreadId = signal.payload?.parentThreadId ?? processState.currentThreadId;
  const waitThread = await loadThreadIfPresent(adapter, parentThreadId);

  if (
    !waitThread
    || waitThread.status !== 'blocked'
    || waitThread.waitReason !== 'waiting_for_child_process'
  ) {
    return {
      applied: false,
      status: 'ignored',
      reason: 'parent_thread_not_waiting_for_child',
      process: processState,
      thread: waitThread,
    };
  }

  if (waitThread.processId !== processState.processId || waitThread.jobId !== processState.jobId) {
    return {
      applied: false,
      status: 'rejected',
      reason: 'parent_thread_process_mismatch',
      process: processState,
      thread: waitThread,
    };
  }

  if (waitThread.threadId !== processState.currentThreadId) {
    return {
      applied: false,
      status: 'rejected',
      reason: 'parent_thread_not_current',
      process: processState,
      thread: waitThread,
    };
  }

  const childProcess = await loadProcessIfPresent(adapter, childProcessId);

  if (!childProcess) {
    return {
      applied: false,
      status: 'rejected',
      reason: 'child_process_not_found',
      process: processState,
      thread: waitThread,
    };
  }

  if (childProcess.parentProcessId !== processState.processId) {
    return {
      applied: false,
      status: 'rejected',
      reason: 'child_process_parent_mismatch',
      process: processState,
      thread: waitThread,
      childProcess,
    };
  }

  if (!OPENMAS_OS_TERMINAL_PROCESS_STATUSES.has(childProcess.status)) {
    return {
      applied: false,
      status: 'ignored',
      reason: 'child_process_not_terminal',
      process: processState,
      thread: waitThread,
      childProcess,
    };
  }

  if (!childProcessStatusMatchesCompletionSignal(signal.signalType, childProcess.status)) {
    return {
      applied: false,
      status: 'rejected',
      reason: 'child_process_status_mismatch',
      process: processState,
      thread: waitThread,
      childProcess,
    };
  }

  const continuationThreadId = createRuntimeId('thread');
  const completedWaitThread = await adapter.persistThread({
    ...waitThread,
    status: 'completed',
    waitReason: null,
    updatedAt: nowTimestamp,
    completedAt: nowTimestamp,
  });
  const continuationThread = await adapter.persistThread({
    kind: OPENMAS_OS_KINDS.thread,
    schemaVersion: OPENMAS_OS_SCHEMA_VERSION,
    threadId: continuationThreadId,
    processId: processState.processId,
    jobId: processState.jobId,
    status: 'ready',
    threadType: 'child_process_wait',
    priority: waitThread.priority,
    attempt: waitThread.attempt + 1,
    waitReason: null,
    dueAt: null,
    createdAt: nowTimestamp,
    startedAt: null,
    updatedAt: nowTimestamp,
    completedAt: null,
  });
  const readyProcess = await adapter.persistProcess({
    ...processState,
    status: 'ready',
    currentThreadId: continuationThread.threadId,
    childProcessIds: appendUniqueChildProcessId(processState.childProcessIds, childProcessId),
    updatedAt: nowTimestamp,
  });

  await appendRuntimeEvent({
    adapter,
    eventType: 'thread.completed',
    source: signal.createdBy,
    targetType: 'thread',
    targetId: completedWaitThread.threadId,
    jobId: completedWaitThread.jobId,
    processId: completedWaitThread.processId,
    threadId: completedWaitThread.threadId,
    occurredAt: nowTimestamp,
    payload: {
      status: completedWaitThread.status,
      previousStatus: waitThread.status,
      signalId: signal.signalId,
      signalType: signal.signalType,
      childProcessId,
      childResultRef: signal.payload?.childResultRef ?? null,
    },
  });
  await appendRuntimeEvent({
    adapter,
    eventType: 'thread.created',
    source: signal.createdBy,
    targetType: 'thread',
    targetId: continuationThread.threadId,
    jobId: continuationThread.jobId,
    processId: continuationThread.processId,
    threadId: continuationThread.threadId,
    occurredAt: nowTimestamp,
    payload: {
      status: continuationThread.status,
      threadType: continuationThread.threadType,
      resumedFromThreadId: waitThread.threadId,
      childProcessId,
      childStatus: signal.payload?.childStatus ?? null,
      childResultRef: signal.payload?.childResultRef ?? null,
      signalId: signal.signalId,
    },
  });
  await appendRuntimeEvent({
    adapter,
    eventType: 'process.ready',
    source: signal.createdBy,
    targetType: 'process',
    targetId: readyProcess.processId,
    jobId: readyProcess.jobId,
    processId: readyProcess.processId,
    threadId: continuationThread.threadId,
    occurredAt: nowTimestamp,
    payload: {
      status: readyProcess.status,
      previousStatus: processState.status,
      currentThreadId: readyProcess.currentThreadId,
      childProcessId,
      childStatus: signal.payload?.childStatus ?? null,
      childResultRef: signal.payload?.childResultRef ?? null,
      signalId: signal.signalId,
      signalType: signal.signalType,
    },
  });

  return {
    applied: true,
    status: 'ready',
    process: readyProcess,
    completedWaitThread,
    continuationThread,
  };
}

async function applyProcessSignal({ adapter, signal, nowTimestamp }) {
  const processState = await adapter.loadProcess(signal.targetId);

  if (signal.signalType === 'child_completed' || signal.signalType === 'child_failed') {
    return applyChildCompletionSignal({
      adapter,
      signal,
      processState,
      nowTimestamp,
    });
  }

  if (signal.signalType === 'cancel') {
    if (OPENMAS_OS_TERMINAL_PROCESS_STATUSES.has(processState.status)) {
      return {
        applied: false,
        status: 'ignored',
        reason: 'process_already_terminal',
        process: processState,
      };
    }

    const cancelledThread = await cancelCurrentThreadIfPresent({
      adapter,
      processState,
      signal,
      nowTimestamp,
    });
    const cancelledProcess = await adapter.persistProcess({
      ...processState,
      status: 'cancelled',
      currentThreadId: null,
      updatedAt: nowTimestamp,
      completedAt: nowTimestamp,
    });
    const cancelledJob = await cancelJobForProcessIfActive({
      adapter,
      processState,
      signal,
      nowTimestamp,
    });

    await appendRuntimeEvent({
      adapter,
      eventType: 'process.cancelled',
      source: signal.createdBy,
      targetType: 'process',
      targetId: cancelledProcess.processId,
      jobId: cancelledProcess.jobId,
      processId: cancelledProcess.processId,
      occurredAt: nowTimestamp,
      payload: {
        status: cancelledProcess.status,
        previousStatus: processState.status,
        signalId: signal.signalId,
        cancelledThreadId: cancelledThread?.threadId ?? null,
      },
    });

    return {
      applied: true,
      status: 'cancelled',
      process: cancelledProcess,
      thread: cancelledThread,
      job: cancelledJob,
    };
  }

  if (signal.signalType === 'pause') {
    if (OPENMAS_OS_TERMINAL_PROCESS_STATUSES.has(processState.status)) {
      return {
        applied: false,
        status: 'ignored',
        reason: 'process_already_terminal',
        process: processState,
      };
    }

    if (processState.status === 'suspended') {
      return {
        applied: false,
        status: 'ignored',
        reason: 'process_already_suspended',
        process: processState,
      };
    }

    const suspendedProcess = await adapter.persistProcess({
      ...processState,
      status: 'suspended',
      updatedAt: nowTimestamp,
    });

    await appendRuntimeEvent({
      adapter,
      eventType: 'process.suspended',
      source: signal.createdBy,
      targetType: 'process',
      targetId: suspendedProcess.processId,
      jobId: suspendedProcess.jobId,
      processId: suspendedProcess.processId,
      occurredAt: nowTimestamp,
      payload: {
        status: suspendedProcess.status,
        previousStatus: processState.status,
        signalId: signal.signalId,
      },
    });

    return {
      applied: true,
      status: 'suspended',
      process: suspendedProcess,
    };
  }

  if (signal.signalType === 'resume') {
    if (processState.status !== 'suspended') {
      return {
        applied: false,
        status: 'ignored',
        reason: 'process_not_suspended',
        process: processState,
      };
    }

    const resumedProcess = await adapter.persistProcess({
      ...processState,
      status: 'ready',
      updatedAt: nowTimestamp,
    });

    await appendRuntimeEvent({
      adapter,
      eventType: 'process.resumed',
      source: signal.createdBy,
      targetType: 'process',
      targetId: resumedProcess.processId,
      jobId: resumedProcess.jobId,
      processId: resumedProcess.processId,
      occurredAt: nowTimestamp,
      payload: {
        status: resumedProcess.status,
        previousStatus: processState.status,
        signalId: signal.signalId,
      },
    });

    return {
      applied: true,
      status: 'ready',
      process: resumedProcess,
    };
  }

  if (signal.signalType === 'timeout') {
    if (OPENMAS_OS_TERMINAL_PROCESS_STATUSES.has(processState.status)) {
      return {
        applied: false,
        status: 'ignored',
        reason: 'process_already_terminal',
        process: processState,
      };
    }

    const interruptedProcess = await adapter.persistProcess({
      ...processState,
      status: 'interrupted',
      updatedAt: nowTimestamp,
    });

    await appendRuntimeEvent({
      adapter,
      eventType: 'process.interrupted',
      source: signal.createdBy,
      targetType: 'process',
      targetId: interruptedProcess.processId,
      jobId: interruptedProcess.jobId,
      processId: interruptedProcess.processId,
      occurredAt: nowTimestamp,
      payload: {
        status: interruptedProcess.status,
        previousStatus: processState.status,
        signalId: signal.signalId,
      },
    });

    return {
      applied: true,
      status: 'interrupted',
      process: interruptedProcess,
    };
  }

  return {
    applied: false,
    status: 'unsupported_signal',
    reason: `Signal ${signal.signalType} is not supported for Process targets in Signals v1.`,
    process: processState,
  };
}

async function loadOwningProcess(adapter, thread) {
  try {
    return await adapter.loadProcess(thread.processId);
  } catch (error) {
    if (isMissingRuntimeStateError(error)) {
      return null;
    }

    throw error;
  }
}

async function setOwningProcessReadyIfPaused({ adapter, thread, signal, nowTimestamp }) {
  const processState = await loadOwningProcess(adapter, thread);

  if (!processState || OPENMAS_OS_TERMINAL_PROCESS_STATUSES.has(processState.status)) {
    return processState;
  }

  if (!['blocked', 'suspended'].includes(processState.status)) {
    return processState;
  }

  const readyProcess = await adapter.persistProcess({
    ...processState,
    status: 'ready',
    updatedAt: nowTimestamp,
  });

  await appendRuntimeEvent({
    adapter,
    eventType: 'process.ready',
    source: signal.createdBy,
    targetType: 'process',
    targetId: readyProcess.processId,
    jobId: readyProcess.jobId,
    processId: readyProcess.processId,
    threadId: thread.threadId,
    occurredAt: nowTimestamp,
    payload: {
      status: readyProcess.status,
      previousStatus: processState.status,
      signalId: signal.signalId,
    },
  });

  return readyProcess;
}

async function suspendOwningProcessForThread({ adapter, thread, signal, nowTimestamp }) {
  const processState = await loadOwningProcess(adapter, thread);

  if (!processState || OPENMAS_OS_TERMINAL_PROCESS_STATUSES.has(processState.status)) {
    return processState;
  }

  if (processState.status === 'suspended') {
    return processState;
  }

  const suspendedProcess = await adapter.persistProcess({
    ...processState,
    status: 'suspended',
    updatedAt: nowTimestamp,
  });

  await appendRuntimeEvent({
    adapter,
    eventType: 'process.suspended',
    source: signal.createdBy,
    targetType: 'process',
    targetId: suspendedProcess.processId,
    jobId: suspendedProcess.jobId,
    processId: suspendedProcess.processId,
    threadId: thread.threadId,
    occurredAt: nowTimestamp,
    payload: {
      status: suspendedProcess.status,
      previousStatus: processState.status,
      signalId: signal.signalId,
    },
  });

  return suspendedProcess;
}

async function failOwningProcessForThread({
  adapter,
  thread,
  signal,
  nowTimestamp,
  failureSummary = null,
}) {
  const processState = await loadOwningProcess(adapter, thread);

  if (!processState || OPENMAS_OS_TERMINAL_PROCESS_STATUSES.has(processState.status)) {
    return processState;
  }

  const failedProcess = await adapter.persistProcess({
    ...processState,
    status: 'failed',
    currentThreadId: processState.currentThreadId === thread.threadId
      ? null
      : processState.currentThreadId,
    updatedAt: nowTimestamp,
    completedAt: nowTimestamp,
    failedAt: nowTimestamp,
    failureSummary,
  });

  await appendRuntimeEvent({
    adapter,
    eventType: 'process.failed',
    source: signal.createdBy,
    targetType: 'process',
    targetId: failedProcess.processId,
    jobId: failedProcess.jobId,
    processId: failedProcess.processId,
    threadId: thread.threadId,
    occurredAt: nowTimestamp,
    payload: {
      status: failedProcess.status,
      previousStatus: processState.status,
      signalId: signal.signalId,
      failedAt: nowTimestamp,
      failureSummary,
    },
  });

  return failedProcess;
}

async function applyThreadSignal({ adapter, signal, nowTimestamp }) {
  const thread = await adapter.loadThread(signal.targetId);

  if (signal.signalType === 'cancel') {
    if (TERMINAL_THREAD_STATUSES.has(thread.status)) {
      return {
        applied: false,
        status: 'ignored',
        reason: 'thread_already_terminal',
        thread,
      };
    }

    const cancelledThread = await adapter.persistThread({
      ...thread,
      status: 'cancelled',
      waitReason: null,
      updatedAt: nowTimestamp,
      completedAt: nowTimestamp,
    });

    await appendRuntimeEvent({
      adapter,
      eventType: 'thread.cancelled',
      source: signal.createdBy,
      targetType: 'thread',
      targetId: cancelledThread.threadId,
      jobId: cancelledThread.jobId,
      processId: cancelledThread.processId,
      threadId: cancelledThread.threadId,
      occurredAt: nowTimestamp,
      payload: {
        status: cancelledThread.status,
        previousStatus: thread.status,
        signalId: signal.signalId,
      },
    });

    return {
      applied: true,
      status: 'cancelled',
      thread: cancelledThread,
    };
  }

  if (signal.signalType === 'pause') {
    if (TERMINAL_THREAD_STATUSES.has(thread.status)) {
      return {
        applied: false,
        status: 'ignored',
        reason: 'thread_already_terminal',
        thread,
      };
    }

    const blockedThread = await adapter.persistThread({
      ...thread,
      status: 'blocked',
      waitReason: 'manual_pause',
      updatedAt: nowTimestamp,
      completedAt: null,
    });
    const processState = await suspendOwningProcessForThread({
      adapter,
      thread: blockedThread,
      signal,
      nowTimestamp,
    });

    await appendRuntimeEvent({
      adapter,
      eventType: 'thread.blocked',
      source: signal.createdBy,
      targetType: 'thread',
      targetId: blockedThread.threadId,
      jobId: blockedThread.jobId,
      processId: blockedThread.processId,
      threadId: blockedThread.threadId,
      occurredAt: nowTimestamp,
      payload: {
        status: blockedThread.status,
        previousStatus: thread.status,
        waitReason: blockedThread.waitReason,
        signalId: signal.signalId,
      },
    });

    return {
      applied: true,
      status: 'blocked',
      thread: blockedThread,
      process: processState,
    };
  }

  if (signal.signalType === 'resume') {
    if (thread.status !== 'blocked' || thread.waitReason !== 'manual_pause') {
      return {
        applied: false,
        status: 'ignored',
        reason: 'thread_not_manually_paused',
        thread,
      };
    }

    const readyThread = await adapter.persistThread({
      ...thread,
      status: 'ready',
      waitReason: null,
      updatedAt: nowTimestamp,
      completedAt: null,
    });
    const processState = await setOwningProcessReadyIfPaused({
      adapter,
      thread: readyThread,
      signal,
      nowTimestamp,
    });

    await appendRuntimeEvent({
      adapter,
      eventType: 'thread.ready',
      source: signal.createdBy,
      targetType: 'thread',
      targetId: readyThread.threadId,
      jobId: readyThread.jobId,
      processId: readyThread.processId,
      threadId: readyThread.threadId,
      occurredAt: nowTimestamp,
      payload: {
        status: readyThread.status,
        previousStatus: thread.status,
        signalId: signal.signalId,
      },
    });

    return {
      applied: true,
      status: 'ready',
      thread: readyThread,
      process: processState,
    };
  }

  if (signal.signalType === 'approval_granted') {
    if (thread.status !== 'blocked' || thread.waitReason !== 'approval_required') {
      return {
        applied: false,
        status: 'ignored',
        reason: 'thread_not_waiting_for_approval',
        thread,
      };
    }

    const readyThread = await adapter.persistThread({
      ...thread,
      status: 'ready',
      waitReason: null,
      updatedAt: nowTimestamp,
      completedAt: null,
    });
    const processState = await setOwningProcessReadyIfPaused({
      adapter,
      thread: readyThread,
      signal,
      nowTimestamp,
    });

    await appendRuntimeEvent({
      adapter,
      eventType: 'thread.ready',
      source: signal.createdBy,
      targetType: 'thread',
      targetId: readyThread.threadId,
      jobId: readyThread.jobId,
      processId: readyThread.processId,
      threadId: readyThread.threadId,
      occurredAt: nowTimestamp,
      payload: {
        status: readyThread.status,
        previousStatus: thread.status,
        signalId: signal.signalId,
        approvalStatus: 'granted',
      },
    });

    return {
      applied: true,
      status: 'ready',
      thread: readyThread,
      process: processState,
    };
  }

  if (signal.signalType === 'approval_rejected') {
    if (thread.status !== 'blocked' || thread.waitReason !== 'approval_required') {
      return {
        applied: false,
        status: 'ignored',
        reason: 'thread_not_waiting_for_approval',
        thread,
      };
    }

    const failureSummary = createSafeFailureSummary({
      reasonCode: 'approval_rejected',
      reason: 'OpenMAS OS Thread approval was rejected.',
      message: signal.reason ?? 'Approval was rejected.',
      signalId: signal.signalId,
      signalType: signal.signalType,
      source: 'openmas-os-signal-manager',
      failedAt: nowTimestamp,
    });
    const failedThread = await adapter.persistThread({
      ...thread,
      status: 'failed',
      waitReason: null,
      updatedAt: nowTimestamp,
      completedAt: nowTimestamp,
      failedAt: nowTimestamp,
      failureSummary,
    });
    const processState = await failOwningProcessForThread({
      adapter,
      thread: failedThread,
      signal,
      nowTimestamp,
      failureSummary,
    });

    await appendRuntimeEvent({
      adapter,
      eventType: 'thread.failed',
      source: signal.createdBy,
      targetType: 'thread',
      targetId: failedThread.threadId,
      jobId: failedThread.jobId,
      processId: failedThread.processId,
      threadId: failedThread.threadId,
      occurredAt: nowTimestamp,
      payload: {
        status: failedThread.status,
        previousStatus: thread.status,
        signalId: signal.signalId,
        approvalStatus: 'rejected',
        failedAt: nowTimestamp,
        failureSummary,
      },
    });

    return {
      applied: true,
      status: 'failed',
      thread: failedThread,
      process: processState,
    };
  }

  if (signal.signalType === 'timeout') {
    if (TERMINAL_THREAD_STATUSES.has(thread.status)) {
      return {
        applied: false,
        status: 'ignored',
        reason: 'thread_already_terminal',
        thread,
      };
    }

    const failureSummary = createSafeFailureSummary({
      reasonCode: 'thread_timeout',
      reason: 'OpenMAS OS Thread timed out.',
      message: signal.reason ?? 'Thread timed out.',
      signalId: signal.signalId,
      signalType: signal.signalType,
      source: 'openmas-os-signal-manager',
      failedAt: nowTimestamp,
    });
    const failedThread = await adapter.persistThread({
      ...thread,
      status: 'failed',
      waitReason: null,
      updatedAt: nowTimestamp,
      completedAt: nowTimestamp,
      failedAt: nowTimestamp,
      failureSummary,
    });

    await appendRuntimeEvent({
      adapter,
      eventType: 'thread.failed',
      source: signal.createdBy,
      targetType: 'thread',
      targetId: failedThread.threadId,
      jobId: failedThread.jobId,
      processId: failedThread.processId,
      threadId: failedThread.threadId,
      occurredAt: nowTimestamp,
      payload: {
        status: failedThread.status,
        previousStatus: thread.status,
        signalId: signal.signalId,
        reason: 'timeout',
        failedAt: nowTimestamp,
        failureSummary,
      },
    });

    return {
      applied: true,
      status: 'failed',
      thread: failedThread,
    };
  }

  return {
    applied: false,
    status: 'unsupported_signal',
    reason: `Signal ${signal.signalType} is not supported for Thread targets in Signals v1.`,
    thread,
  };
}

async function applyTimerSignal({ adapter, signal, nowTimestamp }) {
  const timer = await adapter.loadTimer(signal.targetId);

  if (signal.signalType !== 'cancel') {
    return {
      applied: false,
      status: 'unsupported_signal',
      reason: `Signal ${signal.signalType} is not supported for Timer targets in Signals v1.`,
      timer,
    };
  }

  if (timer.status !== 'scheduled') {
    return {
      applied: false,
      status: 'ignored',
      reason: 'timer_not_scheduled',
      timer,
    };
  }

  const cancelledTimer = await adapter.persistTimer({
    ...timer,
    status: 'cancelled',
    updatedAt: nowTimestamp,
  });

  await appendRuntimeEvent({
    adapter,
    eventType: 'timer.cancelled',
    source: signal.createdBy,
    targetType: 'timer',
    targetId: cancelledTimer.timerId,
    jobId: cancelledTimer.jobId,
    occurredAt: nowTimestamp,
    payload: {
      status: cancelledTimer.status,
      previousStatus: timer.status,
      signalId: signal.signalId,
    },
  });

  return {
    applied: true,
    status: 'cancelled',
    timer: cancelledTimer,
  };
}

async function applyTargetSignal({ adapter, signal, nowTimestamp }) {
  if (!SUPPORTED_SIGNAL_TYPES.has(signal.signalType)) {
    return {
      applied: false,
      status: 'unsupported_signal',
      reason: `Signal ${signal.signalType} is not supported in Signals v1.`,
    };
  }

  if (signal.targetType === 'job') {
    return applyJobSignal({ adapter, signal, nowTimestamp });
  }

  if (signal.targetType === 'process') {
    return applyProcessSignal({ adapter, signal, nowTimestamp });
  }

  if (signal.targetType === 'thread') {
    return applyThreadSignal({ adapter, signal, nowTimestamp });
  }

  if (signal.targetType === 'timer') {
    return applyTimerSignal({ adapter, signal, nowTimestamp });
  }

  return {
    applied: false,
    status: 'unsupported_target',
    reason: `Signal target type ${signal.targetType} is not supported in Signals v1.`,
  };
}

export function createOpenMasOsSignal({
  signalType,
  targetType,
  targetId,
  createdBy = {
    type: 'human',
    id: 'admin',
  },
  createdAt = defaultNow(),
  reason = null,
  payload = {},
  signalId = `signal_${randomUUID()}`,
} = {}) {
  return assertOpenMasOsSignal({
    kind: OPENMAS_OS_KINDS.signal,
    schemaVersion: OPENMAS_OS_SCHEMA_VERSION,
    signalId,
    signalType,
    targetType,
    targetId,
    createdBy,
    createdAt,
    reason,
    payload,
  });
}

export async function applySignal({
  adapter = null,
  projectRootPath = null,
  osRootPath = null,
  signal,
  now = defaultNow,
} = {}) {
  const runtimeAdapter = assertAdapter(createAdapter({ adapter, projectRootPath, osRootPath }));
  const nowFn = normalizeNow(now);
  const nowTimestamp = nowFn();
  const normalizedSignal = assertOpenMasOsSignal(signal);

  await appendSignalAuditEvent({
    adapter: runtimeAdapter,
    eventType: 'signal.received',
    signal: normalizedSignal,
    occurredAt: nowTimestamp,
    payload: {
      status: 'received',
    },
  });

  try {
    const result = await applyTargetSignal({
      adapter: runtimeAdapter,
      signal: normalizedSignal,
      nowTimestamp,
    });
    const signalEventType = result.applied
      ? 'signal.applied'
      : result.status === 'ignored'
        ? 'signal.ignored'
        : 'signal.rejected';

    await appendSignalAuditEvent({
      adapter: runtimeAdapter,
      eventType: signalEventType,
      signal: normalizedSignal,
      occurredAt: nowTimestamp,
      payload: {
        status: result.status,
        applied: result.applied,
        reason: result.reason ?? null,
      },
    });

    return {
      signal: normalizedSignal,
      ...result,
    };
  } catch (error) {
    const errorMessage = createSafeErrorMessage(error);

    await appendSignalAuditEvent({
      adapter: runtimeAdapter,
      eventType: 'signal.rejected',
      signal: normalizedSignal,
      occurredAt: nowTimestamp,
      payload: {
        status: 'rejected',
        applied: false,
        errorMessage,
      },
    });

    return {
      signal: normalizedSignal,
      applied: false,
      status: 'rejected',
      reason: errorMessage,
    };
  }
}

export class SignalManager {
  constructor({
    adapter = null,
    projectRootPath = null,
    osRootPath = null,
    now = defaultNow,
  } = {}) {
    this.adapter = assertAdapter(createAdapter({ adapter, projectRootPath, osRootPath }));
    this.now = normalizeNow(now);
  }

  async apply(signal) {
    return applySignal({
      adapter: this.adapter,
      signal,
      now: this.now,
    });
  }
}

export function createSignalManager(options = {}) {
  return new SignalManager(options);
}
