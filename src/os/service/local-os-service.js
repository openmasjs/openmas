import { randomUUID } from 'node:crypto';
import {
  OPENMAS_OS_KINDS,
  OPENMAS_OS_SCHEMA_VERSION,
  OPENMAS_OS_TERMINAL_PROCESS_STATUSES,
  assertSafeOsSerializableValue,
} from '../../contracts/os/openmas-os-runtime-contract.js';
import { createLocalRuntimeAdapter } from '../adapters/local-runtime-adapter.js';
import {
  isOpenMasOsJobClaimError,
  recoverUnlinkedForegroundCompletionResults,
  runJobNow,
} from '../manual-job-execution.js';
import {
  recoverUnlinkedDelegatedChildResults,
  recoverUnlinkedParentResumeResults,
  recoverUnlinkedScheduledChildResults,
  resumeParentAfterDelegatedChild,
  runDelegatedJobNow,
} from '../delegation/delegation-manager.js';
import {
  releaseDueOneShotJobs,
  resolveOneShotTimerId,
} from '../scheduler/one-shot-scheduled-jobs.js';
import {
  createKernelSystemCallProcessor,
  reconcileTerminalDelegationSystemCallCallers,
} from '../system-calls/system-call-processor.js';
import { createSafeFailureSummary } from '../failure-summary.js';

const SERVICE_TICK_RESULT_KIND = 'openmas_os_service_tick_result';
const SERVICE_TICK_RESULT_VERSION = 1;
const DEFAULT_MAX_SYSTEM_CALLS_PER_TICK = 25;
const DEFAULT_SERVICE_ID = 'openmas-os-service';
const DEFAULT_STALE_RUNNING_INVOCATION_AFTER_MS = 30 * 60 * 1000;
const STALE_RUNNING_INVOCATION_REASON_CODE = 'stale_running_cli_invocation_recovered';
const STALE_RUNNING_CHILD_INVOCATION_REASON_CODE = 'stale_running_child_invocation_recovered';
const STALE_RUNNING_PARENT_RESUME_REASON_CODE = 'stale_running_parent_resume_recovered';
const ASYNC_DISPATCH_EXECUTOR_SNAPSHOT_KIND = 'openmas_os_async_dispatch_executor_snapshot';
const ASYNC_DISPATCH_EXECUTOR_SNAPSHOT_VERSION = 1;

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
    throw new Error('OpenMAS OS service tick now must be a function when provided.');
  }

  return now;
}

function createEventId() {
  return `event_${randomUUID()}`;
}

function createTickId() {
  return `os_service_tick_${randomUUID()}`;
}

function createRuntimeId(prefix) {
  return `${prefix}_${randomUUID()}`;
}

function createSystemActor() {
  return {
    type: 'system',
    id: 'openmas-os-service',
  };
}

function createAdapter({ adapter = null, projectRootPath = null, osRootPath = null } = {}) {
  return adapter ?? createLocalRuntimeAdapter({ projectRootPath, osRootPath });
}

function assertAdapter(adapter) {
  if (!adapter || typeof adapter !== 'object') {
    throw new Error('OpenMAS OS service tick requires a runtime adapter.');
  }

  for (const methodName of [
    'loadJob',
    'listJobs',
    'listProcesses',
    'listThreads',
    'persistJob',
    'loadProcess',
    'persistProcess',
    'loadThread',
    'persistThread',
    'loadTimer',
    'persistTimer',
    'listTimers',
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

function createSafeErrorMessage(error, fallbackMessage = 'OpenMAS OS service tick failed.') {
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
      errorMessage: createSafeErrorMessage(error, 'OpenMAS OS service tick omitted unsafe payload.'),
    };
  }
}

async function appendServiceEvent({
  adapter,
  eventType,
  occurredAt,
  payload = {},
}) {
  return adapter.appendEvent({
    kind: OPENMAS_OS_KINDS.event,
    schemaVersion: OPENMAS_OS_SCHEMA_VERSION,
    eventId: createEventId(),
    eventType,
    source: createSystemActor(),
    targetRef: null,
    jobId: null,
    processId: null,
    threadId: null,
    occurredAt,
    payload: createSafePayload(payload, `OpenMAS OS service Event ${eventType} payload`),
  });
}

async function appendRuntimeLifecycleEvent({
  adapter,
  eventType,
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
    source: createSystemActor(),
    targetRef: {
      type: targetType,
      id: targetId,
    },
    jobId,
    processId,
    threadId,
    occurredAt,
    payload: createSafePayload(payload, `OpenMAS OS service Event ${eventType} payload`),
  });
}

function createUnsupportedForegroundResourceWaitReconciliationSummary({ observedAt }) {
  return {
    status: 'completed',
    observedAt,
    scannedProcessCount: 0,
    candidateCount: 0,
    terminalizedCount: 0,
    failedCount: 0,
    terminalized: [],
    failures: [],
  };
}

async function reconcileUnsupportedForegroundResourceWaitsForTick({
  adapter,
  serviceId,
  tickId,
  observedAt,
}) {
  const reconciliation = createUnsupportedForegroundResourceWaitReconciliationSummary({
    observedAt,
  });
  let blockedProcesses;

  try {
    blockedProcesses = await adapter.listProcesses({ status: 'blocked' });
  } catch (error) {
    reconciliation.status = 'completed_with_failures';
    reconciliation.failedCount = 1;
    reconciliation.failures.push({
      processId: null,
      errorMessage: createSafeErrorMessage(
        error,
        'OpenMAS OS could not scan blocked Processes for unsupported foreground resource waits.',
      ),
    });
    return reconciliation;
  }

  reconciliation.scannedProcessCount = blockedProcesses.length;

  for (const processState of blockedProcesses) {
    try {
      if (processState.parentProcessId !== null || !isNonEmptyString(processState.currentThreadId)) {
        continue;
      }

      const [
        job,
        thread,
      ] = await Promise.all([
        adapter.loadJob(processState.jobId),
        adapter.loadThread(processState.currentThreadId),
      ]);

      if (
        job.status !== 'active'
        || thread.status !== 'blocked'
        || thread.waitReason !== 'waiting_for_resource'
        || thread.processId !== processState.processId
        || thread.jobId !== processState.jobId
      ) {
        continue;
      }

      reconciliation.candidateCount += 1;

      const failureSummary = createSafeFailureSummary({
        reasonCode: 'unsupported_foreground_resource_wait',
        reason: 'OpenMAS OS cannot preserve a foreground resource wait until a supported resource wake path exists.',
        message: 'OpenMAS OS terminalized historical foreground work because its resource wait has no supported wake path in Milestone 5.',
        errorName: 'UnsupportedForegroundResourceWait',
        source: 'openmas-os-service',
        failedAt: observedAt,
      });
      const payload = {
        tickId,
        serviceId,
        reconciledAt: observedAt,
        reasonCode: failureSummary.reasonCode,
        failureSummary,
      };
      const failedThread = await adapter.persistThread({
        ...thread,
        status: 'failed',
        waitReason: null,
        updatedAt: observedAt,
        completedAt: observedAt,
        failedAt: observedAt,
        failureSummary,
      });
      const failedProcess = await adapter.persistProcess({
        ...processState,
        status: 'failed',
        currentThreadId: null,
        updatedAt: observedAt,
        completedAt: observedAt,
        failedAt: observedAt,
        failureSummary,
      });
      const failedJob = await adapter.persistJob({
        ...job,
        status: 'failed',
        updatedAt: observedAt,
        failedAt: observedAt,
        failureSummary,
      });

      await appendRuntimeLifecycleEvent({
        adapter,
        eventType: 'thread.failed',
        targetType: 'thread',
        targetId: failedThread.threadId,
        jobId: failedJob.jobId,
        processId: failedProcess.processId,
        threadId: failedThread.threadId,
        occurredAt: observedAt,
        payload,
      });
      await appendRuntimeLifecycleEvent({
        adapter,
        eventType: 'process.failed',
        targetType: 'process',
        targetId: failedProcess.processId,
        jobId: failedJob.jobId,
        processId: failedProcess.processId,
        threadId: failedThread.threadId,
        occurredAt: observedAt,
        payload,
      });
      await appendRuntimeLifecycleEvent({
        adapter,
        eventType: 'job.failed',
        targetType: 'job',
        targetId: failedJob.jobId,
        jobId: failedJob.jobId,
        processId: failedProcess.processId,
        threadId: failedThread.threadId,
        occurredAt: observedAt,
        payload,
      });
      await appendServiceEvent({
        adapter,
        eventType: 'os.service.unsupported_foreground_resource_wait.reconciled',
        occurredAt: observedAt,
        payload: {
          ...payload,
          jobId: failedJob.jobId,
          processId: failedProcess.processId,
          threadId: failedThread.threadId,
          operationalIdentityId: failedProcess.operationalIdentityId,
        },
      });

      reconciliation.terminalized.push({
        jobId: failedJob.jobId,
        processId: failedProcess.processId,
        threadId: failedThread.threadId,
        reasonCode: failureSummary.reasonCode,
      });
      reconciliation.terminalizedCount += 1;
    } catch (error) {
      reconciliation.failedCount += 1;
      reconciliation.failures.push({
        processId: processState.processId,
        jobId: processState.jobId,
        errorMessage: createSafeErrorMessage(
          error,
          'OpenMAS OS unsupported foreground resource wait reconciliation failed.',
        ),
      });
    }
  }

  if (reconciliation.failedCount > 0) {
    reconciliation.status = 'completed_with_failures';
  }

  return reconciliation;
}

function assertMaxDispatchedJobs(value) {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error('OpenMAS OS service tick maxDispatchedJobs must be an integer greater than or equal to 1.');
  }

  return value;
}

function assertMaxSystemCallsPerTick(value) {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error('OpenMAS OS service tick maxSystemCallsPerTick must be an integer greater than or equal to 1.');
  }

  return value;
}

function assertStaleRunningInvocationAfterMs(value) {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error('OpenMAS OS service tick staleRunningInvocationAfterMs must be an integer greater than or equal to 1.');
  }

  return value;
}

function parseTimestampMs(value) {
  if (!isNonEmptyString(value)) {
    return null;
  }

  const timestampMs = Date.parse(value);

  return Number.isFinite(timestampMs) ? timestampMs : null;
}

function resolveMostRecentTimestamp(values) {
  const timestamps = values
    .map((value) => {
      return {
        value,
        timestampMs: parseTimestampMs(value),
      };
    })
    .filter((entry) => entry.timestampMs !== null)
    .sort((left, right) => right.timestampMs - left.timestampMs);

  return timestamps[0] ?? null;
}

function isCliManagedRunningInvocationJob(job) {
  return job?.status === 'active'
    && job?.createdBy?.type === 'human'
    && job?.createdBy?.id === 'cli'
    && job?.projectId === 'project_openmas_cli'
    && job?.program?.type === 'agent_invocation'
    && job?.trigger?.type === 'immediate';
}

function isChildManagedRunningInvocationJob(job) {
  return job?.status === 'active'
    && job?.createdBy?.type === 'process'
    && job?.program?.type === 'agent_invocation'
    && ['manual', 'scheduled_once'].includes(job?.trigger?.type);
}

function resolveRunningInvocationRecoveryProfile({ job, thread }) {
  if (thread?.threadType === 'child_process_wait' && job?.status === 'active') {
    return {
      reasonCode: STALE_RUNNING_PARENT_RESUME_REASON_CODE,
      reason: 'OpenMAS OS recovered a stale parent-resume invocation snapshot.',
      message:
        'A parent resume invocation remained running after its stale recovery threshold without an active executor owner. '
        + 'The OpenMAS OS marked its Job, Process, and Thread as failed so its terminal outcome can be recorded safely.',
    };
  }

  if (thread?.threadType !== 'agent_invocation') {
    return null;
  }

  if (isCliManagedRunningInvocationJob(job)) {
    return {
      reasonCode: STALE_RUNNING_INVOCATION_REASON_CODE,
      reason: 'OpenMAS OS recovered a stale CLI-managed running invocation snapshot.',
      message:
        'The CLI-created invocation was still marked running after its stale recovery threshold. '
        + 'The OpenMAS OS marked its Job, Process, and Thread as failed so the runtime state can make progress safely.',
    };
  }

  if (isChildManagedRunningInvocationJob(job)) {
    return {
      reasonCode: STALE_RUNNING_CHILD_INVOCATION_REASON_CODE,
      reason: 'OpenMAS OS recovered a stale kernel-dispatched child invocation snapshot.',
      message:
        'A child invocation admitted by the OpenMAS OS remained running after its stale recovery threshold '
        + 'without an active executor owner. The OS marked its Job, Process, and Thread as failed so durable coordination can continue.',
    };
  }

  return null;
}

function compareReadyJobs(left, right) {
  if (left.priority !== right.priority) {
    return right.priority - left.priority;
  }

  const leftRunAt = left.trigger?.runAt ?? left.createdAt;
  const rightRunAt = right.trigger?.runAt ?? right.createdAt;
  const runAtComparison = leftRunAt.localeCompare(rightRunAt);

  if (runAtComparison !== 0) {
    return runAtComparison;
  }

  return left.jobId.localeCompare(right.jobId);
}

function isScheduledDelegationCandidate(candidate) {
  return candidate?.timer?.payload?.actionType === 'schedule_delegation';
}

function isImmediateDelegationCandidate(candidate) {
  return candidate?.delegationContext !== null && candidate?.delegationContext !== undefined;
}

function isParentResumeCandidate(candidate) {
  return candidate?.parentResumeContext !== null && candidate?.parentResumeContext !== undefined;
}

function resolveDispatchType(candidate) {
  if (isParentResumeCandidate(candidate)) {
    return 'parent_resume';
  }

  if (isScheduledDelegationCandidate(candidate)) {
    return 'scheduled_delegation';
  }

  if (isImmediateDelegationCandidate(candidate)) {
    return 'delegation';
  }

  if (candidate?.timer) {
    return 'one_shot_job';
  }

  return 'ready_job';
}

function summarizeReleaseResult(releaseResult) {
  return {
    now: releaseResult.now,
    resultCount: releaseResult.results.length,
    releasedCount: releaseResult.released.length,
    pendingCount: releaseResult.pending.length,
  };
}

function summarizeSystemCallProcessorResult(processorResult) {
  return {
    status: 'completed',
    processedAt: processorResult.processedAt,
    processedCount: processorResult.processedCount,
    completedCount: processorResult.completedCount,
    deniedCount: processorResult.deniedCount,
    failedCount: processorResult.failedCount,
    expiredCount: processorResult.expiredCount,
    cancelledCount: processorResult.cancelledCount,
    results: processorResult.results.map((entry) => {
      return {
        systemCallId: entry.result.systemCallId,
        operation: entry.result.operation,
        status: entry.result.status,
        finalState: entry.finalState,
        createdJobIds: entry.result.effects.createdJobIds,
        createdTimerIds: entry.result.effects.createdTimerIds,
        createdSignalIds: entry.result.effects.createdSignalIds,
        summary: entry.result.summary,
      };
    }),
  };
}

function createFailedSystemCallSummary({
  processedAt,
  error,
}) {
  return {
    status: 'failed',
    processedAt,
    processedCount: 0,
    completedCount: 0,
    deniedCount: 0,
    failedCount: 1,
    expiredCount: 0,
    cancelledCount: 0,
    results: [],
    errorMessage: createSafeErrorMessage(error, 'OpenMAS OS system call processing failed.'),
  };
}

function summarizeReadyWork({ candidates, dispatchedCandidates }) {
  return {
    candidateCount: candidates.length,
    dispatchedCount: dispatchedCandidates.length,
    deferredCount: candidates.length - dispatchedCandidates.length,
  };
}

function createRecoverySummary({
  observedAt,
  staleRunningInvocationAfterMs,
}) {
  return {
    status: 'completed',
    observedAt,
    staleRunningInvocationAfterMs,
    scannedProcessCount: 0,
    candidateCount: 0,
    recoveredCount: 0,
    activeExecutionSkippedCount: 0,
    failedCount: 0,
    recovered: [],
    failures: [],
  };
}

function createParentWaitRecoverySummary({ observedAt }) {
  return {
    status: 'completed',
    observedAt,
    scannedProcessCount: 0,
    candidateCount: 0,
    recoveredCount: 0,
    failedCount: 0,
    recovered: [],
    failures: [],
  };
}

function createTerminalResultRecoverySummary({
  observedAt,
  scanType,
}) {
  return {
    status: 'completed',
    observedAt,
    ...(scanType === 'timer' ? { scannedTimerCount: 0 } : { scannedProcessCount: 0 }),
    candidateCount: 0,
    recoveredCount: 0,
    activeExecutionSkippedCount: 0,
    legacySkippedCount: 0,
    failedCount: 0,
    recovered: [],
    failures: [],
    skippedReason: 'steady_state_no_reconciliation_trigger',
  };
}

function createStaleRunningInvocationFailureSummary({
  recoveredAt,
  staleAgeMs,
  lastUpdatedAt,
  recoveryProfile,
}) {
  return createSafeFailureSummary({
    reasonCode: recoveryProfile.reasonCode,
    reason: recoveryProfile.reason,
    message: recoveryProfile.message,
    errorName: 'StaleRunningInvocation',
    error: `staleAgeMs=${staleAgeMs}; lastUpdatedAt=${lastUpdatedAt}`,
    source: 'openmas-os-service',
    failedAt: recoveredAt,
  });
}

async function resolveStaleRunningInvocationCandidate({
  adapter,
  processState,
  observedAt,
  staleRunningInvocationAfterMs,
}) {
  if (processState.status !== 'running' || !isNonEmptyString(processState.currentThreadId)) {
    return null;
  }

  const [
    job,
    thread,
  ] = await Promise.all([
    adapter.loadJob(processState.jobId),
    adapter.loadThread(processState.currentThreadId),
  ]);

  if (
    !['running', 'completed', 'failed', 'cancelled'].includes(thread.status)
    || thread.jobId !== job.jobId
    || thread.processId !== processState.processId
  ) {
    return null;
  }

  const recoveryProfile = resolveRunningInvocationRecoveryProfile({
    job,
    thread,
  });

  if (!recoveryProfile) {
    return null;
  }

  const mostRecentTimestamp = resolveMostRecentTimestamp([
    job.updatedAt,
    processState.updatedAt,
    thread.updatedAt,
  ]);
  const observedAtMs = parseTimestampMs(observedAt);

  if (!mostRecentTimestamp || observedAtMs === null) {
    return null;
  }

  const staleAgeMs = observedAtMs - mostRecentTimestamp.timestampMs;

  if (staleAgeMs < staleRunningInvocationAfterMs) {
    return null;
  }

  return {
    job,
    processState,
    thread,
    staleAgeMs,
    lastUpdatedAt: mostRecentTimestamp.value,
    recoveryProfile,
  };
}

async function recoverStaleRunningInvocationCandidate({
  adapter,
  candidate,
  serviceId,
  tickId,
  recoveredAt,
}) {
  const {
    job,
    processState,
    thread,
    staleAgeMs,
    lastUpdatedAt,
    recoveryProfile,
  } = candidate;
  const failureSummary = createStaleRunningInvocationFailureSummary({
    recoveredAt,
    staleAgeMs,
    lastUpdatedAt,
    recoveryProfile,
  });
  const recoveryPayload = {
    tickId,
    serviceId,
    recoveredAt,
    staleAgeMs,
    lastUpdatedAt,
    reasonCode: recoveryProfile.reasonCode,
    failureSummary,
  };
  const failedThread = await adapter.persistThread({
    ...thread,
    status: 'failed',
    waitReason: null,
    updatedAt: recoveredAt,
    completedAt: recoveredAt,
    failedAt: recoveredAt,
    failureSummary,
  });
  const failedProcess = await adapter.persistProcess({
    ...processState,
    status: 'failed',
    currentThreadId: null,
    updatedAt: recoveredAt,
    completedAt: recoveredAt,
    failedAt: recoveredAt,
    failureSummary,
  });
  const failedJob = await adapter.persistJob({
    ...job,
    status: 'failed',
    updatedAt: recoveredAt,
    failedAt: recoveredAt,
    failureSummary,
  });

  await appendRuntimeLifecycleEvent({
    adapter,
    eventType: 'thread.failed',
    targetType: 'thread',
    targetId: failedThread.threadId,
    jobId: failedJob.jobId,
    processId: failedProcess.processId,
    threadId: failedThread.threadId,
    occurredAt: recoveredAt,
    payload: recoveryPayload,
  });
  await appendRuntimeLifecycleEvent({
    adapter,
    eventType: 'process.failed',
    targetType: 'process',
    targetId: failedProcess.processId,
    jobId: failedJob.jobId,
    processId: failedProcess.processId,
    threadId: failedThread.threadId,
    occurredAt: recoveredAt,
    payload: recoveryPayload,
  });
  await appendRuntimeLifecycleEvent({
    adapter,
    eventType: 'job.failed',
    targetType: 'job',
    targetId: failedJob.jobId,
    jobId: failedJob.jobId,
    processId: failedProcess.processId,
    threadId: failedThread.threadId,
    occurredAt: recoveredAt,
    payload: recoveryPayload,
  });
  await appendServiceEvent({
    adapter,
    eventType: 'os.service.stale_running_invocation.recovered',
    occurredAt: recoveredAt,
    payload: {
      ...recoveryPayload,
      jobId: failedJob.jobId,
      processId: failedProcess.processId,
      threadId: failedThread.threadId,
      operationalIdentityId: failedProcess.operationalIdentityId,
    },
  });

  return {
    jobId: failedJob.jobId,
    processId: failedProcess.processId,
    threadId: failedThread.threadId,
    operationalIdentityId: failedProcess.operationalIdentityId,
    recoveredAt,
    staleAgeMs,
    lastUpdatedAt,
    reasonCode: recoveryProfile.reasonCode,
  };
}

async function recoverStaleRunningInvocationsForTick({
  adapter,
  serviceId,
  tickId,
  observedAt,
  staleRunningInvocationAfterMs,
  asyncDispatchExecutor = null,
}) {
  const runningProcesses = await adapter.listProcesses({ status: 'running' });
  const recovery = createRecoverySummary({
    observedAt,
    staleRunningInvocationAfterMs,
  });

  recovery.scannedProcessCount = runningProcesses.length;

  for (const processState of runningProcesses) {
    try {
      const candidate = await resolveStaleRunningInvocationCandidate({
        adapter,
        processState,
        observedAt,
        staleRunningInvocationAfterMs,
      });

      if (!candidate) {
        continue;
      }

      if (asyncDispatchExecutor?.isJobActive(candidate.job.jobId)) {
        recovery.activeExecutionSkippedCount += 1;
        continue;
      }

      recovery.candidateCount += 1;
      recovery.recovered.push(await recoverStaleRunningInvocationCandidate({
        adapter,
        candidate,
        serviceId,
        tickId,
        recoveredAt: observedAt,
      }));
      recovery.recoveredCount += 1;
    } catch (error) {
      recovery.failedCount += 1;
      recovery.failures.push({
        processId: processState.processId,
        jobId: processState.jobId,
        errorMessage: createSafeErrorMessage(error, 'OpenMAS OS stale running invocation recovery failed.'),
      });
    }
  }

  if (recovery.failedCount > 0) {
    recovery.status = 'completed_with_failures';
  }

  return recovery;
}

function appendUniqueChildProcessId(childProcessIds, childProcessId) {
  const normalizedChildProcessIds = Array.isArray(childProcessIds) ? childProcessIds : [];

  if (normalizedChildProcessIds.includes(childProcessId)) {
    return normalizedChildProcessIds;
  }

  return [
    ...normalizedChildProcessIds,
    childProcessId,
  ];
}

function resolveProcessTerminalTimestampMs(processState) {
  return parseTimestampMs(processState.completedAt)
    ?? parseTimestampMs(processState.failedAt)
    ?? parseTimestampMs(processState.updatedAt)
    ?? 0;
}

async function findLatestTerminalChildProcess({
  adapter,
  parentProcessId,
}) {
  const terminalChildren = (await adapter.listProcesses())
    .filter((processState) => {
      return processState.parentProcessId === parentProcessId
        && OPENMAS_OS_TERMINAL_PROCESS_STATUSES.has(processState.status);
    })
    .sort((left, right) => {
      const timestampComparison = resolveProcessTerminalTimestampMs(right)
        - resolveProcessTerminalTimestampMs(left);

      if (timestampComparison !== 0) {
        return timestampComparison;
      }

      return right.processId.localeCompare(left.processId);
    });

  return terminalChildren[0] ?? null;
}

async function resolveLostParentWaitCandidate({
  adapter,
  parentProcess,
}) {
  if (parentProcess.status !== 'blocked' || !isNonEmptyString(parentProcess.currentThreadId)) {
    return null;
  }

  const [
    parentJob,
    parentThread,
  ] = await Promise.all([
    adapter.loadJob(parentProcess.jobId),
    adapter.loadThread(parentProcess.currentThreadId),
  ]);

  if (parentJob.status !== 'active') {
    return null;
  }

  if (
    parentThread.status !== 'blocked'
    || !['waiting_for_system_call', 'waiting_for_child_process'].includes(parentThread.waitReason)
    || parentThread.processId !== parentProcess.processId
    || parentThread.jobId !== parentProcess.jobId
  ) {
    return null;
  }

  const childProcess = await findLatestTerminalChildProcess({
    adapter,
    parentProcessId: parentProcess.processId,
  });

  if (!childProcess) {
    return null;
  }

  return {
    parentJob,
    parentProcess,
    parentThread,
    childProcess,
  };
}

async function recoverLostParentWaitCandidate({
  adapter,
  candidate,
  serviceId,
  tickId,
  recoveredAt,
}) {
  const {
    parentJob,
    parentProcess,
    parentThread,
    childProcess,
  } = candidate;
  const continuationThreadId = createRuntimeId('thread');
  const recoveryPayload = {
    tickId,
    serviceId,
    recoveredAt,
    reasonCode: 'lost_parent_child_wait_recovered',
    parentJobId: parentJob.jobId,
    parentProcessId: parentProcess.processId,
    parentThreadId: parentThread.threadId,
    childProcessId: childProcess.processId,
    childJobId: childProcess.jobId,
    childStatus: childProcess.status,
    previousWaitReason: parentThread.waitReason,
  };
  const completedWaitThread = await adapter.persistThread({
    ...parentThread,
    status: 'completed',
    waitReason: null,
    updatedAt: recoveredAt,
    completedAt: recoveredAt,
  });
  const continuationThread = await adapter.persistThread({
    kind: OPENMAS_OS_KINDS.thread,
    schemaVersion: OPENMAS_OS_SCHEMA_VERSION,
    threadId: continuationThreadId,
    processId: parentProcess.processId,
    jobId: parentProcess.jobId,
    status: 'ready',
    threadType: 'child_process_wait',
    priority: parentThread.priority,
    attempt: parentThread.attempt + 1,
    waitReason: null,
    dueAt: null,
    createdAt: recoveredAt,
    startedAt: null,
    updatedAt: recoveredAt,
    completedAt: null,
  });
  const readyParentProcess = await adapter.persistProcess({
    ...parentProcess,
    status: 'ready',
    currentThreadId: continuationThread.threadId,
    childProcessIds: appendUniqueChildProcessId(parentProcess.childProcessIds, childProcess.processId),
    updatedAt: recoveredAt,
  });

  await appendRuntimeLifecycleEvent({
    adapter,
    eventType: 'thread.completed',
    targetType: 'thread',
    targetId: completedWaitThread.threadId,
    jobId: completedWaitThread.jobId,
    processId: completedWaitThread.processId,
    threadId: completedWaitThread.threadId,
    occurredAt: recoveredAt,
    payload: recoveryPayload,
  });
  await appendRuntimeLifecycleEvent({
    adapter,
    eventType: 'thread.created',
    targetType: 'thread',
    targetId: continuationThread.threadId,
    jobId: continuationThread.jobId,
    processId: continuationThread.processId,
    threadId: continuationThread.threadId,
    occurredAt: recoveredAt,
    payload: {
      ...recoveryPayload,
      status: continuationThread.status,
      threadType: continuationThread.threadType,
      resumedFromThreadId: completedWaitThread.threadId,
    },
  });
  await appendRuntimeLifecycleEvent({
    adapter,
    eventType: 'process.ready',
    targetType: 'process',
    targetId: readyParentProcess.processId,
    jobId: readyParentProcess.jobId,
    processId: readyParentProcess.processId,
    threadId: continuationThread.threadId,
    occurredAt: recoveredAt,
    payload: {
      ...recoveryPayload,
      status: readyParentProcess.status,
      previousStatus: parentProcess.status,
      currentThreadId: readyParentProcess.currentThreadId,
    },
  });
  await appendServiceEvent({
    adapter,
    eventType: 'os.service.parent_wait.recovered',
    occurredAt: recoveredAt,
    payload: {
      ...recoveryPayload,
      continuationThreadId: continuationThread.threadId,
    },
  });

  return {
    parentJobId: parentJob.jobId,
    parentProcessId: readyParentProcess.processId,
    completedWaitThreadId: completedWaitThread.threadId,
    continuationThreadId: continuationThread.threadId,
    childProcessId: childProcess.processId,
    childJobId: childProcess.jobId,
    childStatus: childProcess.status,
    recoveredAt,
    reasonCode: recoveryPayload.reasonCode,
  };
}

async function recoverLostParentWaitsForTick({
  adapter,
  serviceId,
  tickId,
  observedAt,
}) {
  const blockedProcesses = await adapter.listProcesses({ status: 'blocked' });
  const recovery = createParentWaitRecoverySummary({ observedAt });

  recovery.scannedProcessCount = blockedProcesses.length;

  for (const parentProcess of blockedProcesses) {
    try {
      const candidate = await resolveLostParentWaitCandidate({
        adapter,
        parentProcess,
      });

      if (!candidate) {
        continue;
      }

      recovery.candidateCount += 1;
      recovery.recovered.push(await recoverLostParentWaitCandidate({
        adapter,
        candidate,
        serviceId,
        tickId,
        recoveredAt: observedAt,
      }));
      recovery.recoveredCount += 1;
    } catch (error) {
      recovery.failedCount += 1;
      recovery.failures.push({
        processId: parentProcess.processId,
        jobId: parentProcess.jobId,
        errorMessage: createSafeErrorMessage(error, 'OpenMAS OS parent wait recovery failed.'),
      });
    }
  }

  if (recovery.failedCount > 0) {
    recovery.status = 'completed_with_failures';
  }

  return recovery;
}

function summarizeDispatchResult({
  dispatchType,
  candidate,
  execution,
}) {
  const job = execution.childJob ?? execution.job ?? execution.parentJob;
  const processState = execution.childProcess ?? execution.process ?? execution.parentProcess;
  const thread = execution.childThread ?? execution.thread ?? execution.parentThread;

  return {
    dispatched: true,
    status: job.status,
    dispatchType,
    jobId: job.jobId,
    jobStatus: job.status,
    processId: processState.processId,
    processStatus: processState.status,
    threadId: thread.threadId,
    threadStatus: thread.status,
    timerId: candidate.timer?.timerId ?? null,
    timerStatus: candidate.timer?.status ?? null,
    dispatchSource: candidate.source,
    invocationStatus: execution.invocationResult?.status ?? null,
    childResultRef: execution.childResultRecord?.resultId ?? null,
    childResultKind: execution.childResultRecord?.resultKind ?? null,
    parentNotification: execution.notification
      ? {
        notified: execution.notification.notified,
        status: execution.notification.status,
        reason: execution.notification.signalResult?.reason ?? null,
      }
      : null,
    parentCompletion: execution.parentCompletion ?? null,
    parentResume: execution.parentResumeResult
      ? {
        status: execution.parentResumeResult.status,
        evidenceRefCount: execution.parentResumeResult.evidenceRefs.length,
      }
      : null,
  };
}

function createQueuedDispatchResult(candidate) {
  return {
    dispatched: true,
    status: 'queued',
    executionMode: 'asynchronous',
    dispatchType: resolveDispatchType(candidate),
    jobId: candidate.job?.jobId ?? null,
    jobStatus: candidate.job?.status ?? null,
    processId: null,
    processStatus: null,
    threadId: null,
    threadStatus: null,
    timerId: candidate.timer?.timerId ?? null,
    timerStatus: candidate.timer?.status ?? null,
    dispatchSource: candidate.source,
    invocationStatus: null,
    childResultRef: null,
    childResultKind: null,
    parentNotification: null,
    parentCompletion: null,
    parentResume: null,
  };
}

function createDeferredDispatchResult(candidate, reasonCode) {
  return {
    dispatched: false,
    status: 'deferred',
    executionMode: 'asynchronous',
    reasonCode,
    dispatchType: resolveDispatchType(candidate),
    jobId: candidate.job?.jobId ?? null,
    timerId: candidate.timer?.timerId ?? null,
    dispatchSource: candidate.source,
  };
}

function createFailedDispatchResult(candidate, error) {
  return {
    dispatched: false,
    status: 'failed',
    dispatchType: resolveDispatchType(candidate),
    jobId: candidate.job?.jobId ?? null,
    timerId: candidate.timer?.timerId ?? null,
    dispatchSource: candidate.source,
    errorMessage: createSafeErrorMessage(error),
  };
}

function createSkippedDispatchResult(candidate, error) {
  return {
    dispatched: false,
    status: 'skipped',
    reasonCode: error.reasonCode,
    dispatchType: resolveDispatchType(candidate),
    jobId: candidate.job?.jobId ?? null,
    timerId: candidate.timer?.timerId ?? null,
    dispatchSource: candidate.source,
    errorMessage: createSafeErrorMessage(error),
  };
}

function resolveAsyncDispatchExecutionKey(candidate) {
  return [
    resolveDispatchType(candidate),
    candidate.job?.jobId ?? 'unknown_job',
    candidate.parentResumeContext?.continuationThreadId ?? 'no_thread',
  ].join(':');
}

function assertAsyncDispatchExecutor(executor) {
  if (executor === undefined || executor === null) {
    return null;
  }

  for (const methodName of [
    'submit',
    'takeSettledResults',
    'isJobActive',
    'snapshot',
  ]) {
    if (typeof executor[methodName] !== 'function') {
      throw new Error(`OpenMAS OS async dispatch executor must implement ${methodName}.`);
    }
  }

  return executor;
}

export function createLocalAsyncDispatchExecutor({
  maxConcurrentExecutions = 25,
} = {}) {
  const capacity = assertMaxDispatchedJobs(maxConcurrentExecutions);
  const activeExecutions = new Map();
  const settledResults = [];
  const idleWaiters = [];
  let accepting = true;

  const notifyIdleWaiters = () => {
    if (activeExecutions.size !== 0) {
      return;
    }

    while (idleWaiters.length > 0) {
      idleWaiters.shift()();
    }
  };

  const snapshot = () => {
    return {
      kind: ASYNC_DISPATCH_EXECUTOR_SNAPSHOT_KIND,
      version: ASYNC_DISPATCH_EXECUTOR_SNAPSHOT_VERSION,
      accepting,
      maxConcurrentExecutions: capacity,
      activeCount: activeExecutions.size,
      activeJobIds: [...new Set(
        [...activeExecutions.values()].map((execution) => execution.jobId),
      )].sort(),
      settledCount: settledResults.length,
    };
  };

  return {
    submit({
      candidate,
      execute,
    }) {
      if (typeof execute !== 'function') {
        throw new Error('OpenMAS OS async dispatch executor requires an execute function.');
      }

      const executionKey = resolveAsyncDispatchExecutionKey(candidate);

      if (!accepting) {
        return {
          accepted: false,
          result: createDeferredDispatchResult(candidate, 'async_executor_stopping'),
        };
      }

      if (activeExecutions.has(executionKey)) {
        return {
          accepted: false,
          result: createDeferredDispatchResult(candidate, 'async_execution_already_active'),
        };
      }

      if (activeExecutions.size >= capacity) {
        return {
          accepted: false,
          result: createDeferredDispatchResult(candidate, 'async_executor_at_capacity'),
        };
      }

      const execution = {
        executionKey,
        jobId: candidate.job?.jobId ?? null,
        task: null,
      };

      execution.task = Promise.resolve()
        .then(() => execute())
        .then((result) => {
          settledResults.push({
            ...result,
            executionMode: 'asynchronous',
          });
          return result;
        })
        .catch((error) => {
          const result = {
            ...createFailedDispatchResult(candidate, error),
            executionMode: 'asynchronous',
          };
          settledResults.push(result);
          return result;
        })
        .finally(() => {
          activeExecutions.delete(executionKey);
          notifyIdleWaiters();
        });

      activeExecutions.set(executionKey, execution);

      return {
        accepted: true,
        result: createQueuedDispatchResult(candidate),
      };
    },

    takeSettledResults() {
      return settledResults.splice(0, settledResults.length);
    },

    isJobActive(jobId) {
      return [...activeExecutions.values()]
        .some((execution) => execution.jobId === jobId);
    },

    snapshot,

    stopAccepting() {
      accepting = false;
      return snapshot();
    },

    async waitForIdle() {
      if (activeExecutions.size === 0) {
        return snapshot();
      }

      await new Promise((resolve) => {
        idleWaiters.push(resolve);
      });

      return snapshot();
    },
  };
}

async function loadTimerForJobIfPresent(adapter, jobId) {
  try {
    return await adapter.loadTimer(resolveOneShotTimerId(jobId));
  } catch (error) {
    if (error instanceof Error && /was not found/u.test(error.message)) {
      return null;
    }

    throw error;
  }
}

async function resolveImmediateDelegationContext({
  adapter,
  job,
}) {
  if (job.createdBy?.type !== 'process' || !isNonEmptyString(job.createdBy.id)) {
    return null;
  }

  try {
    const parentProcess = await adapter.loadProcess(job.createdBy.id);
    const parentThread = parentProcess.currentThreadId
      ? await adapter.loadThread(parentProcess.currentThreadId)
      : null;

    if (
      parentProcess.status !== 'blocked'
      || parentThread?.status !== 'blocked'
      || parentThread.waitReason !== 'waiting_for_child_process'
    ) {
      return null;
    }

    return {
      parentProcessId: parentProcess.processId,
      parentThreadId: parentThread.threadId,
    };
  } catch (error) {
    if (error instanceof Error && /was not found/u.test(error.message)) {
      return null;
    }

    throw error;
  }
}

async function collectReadyWorkCandidates({
  adapter,
  releaseResult,
}) {
  const candidates = [];
  const seenJobIds = new Set();

  for (const releasedResult of releaseResult.released) {
    candidates.push({
      source: 'released_timer',
      job: releasedResult.job,
      timer: releasedResult.timer,
    });
    seenJobIds.add(releasedResult.job.jobId);
  }

  const readyJobs = (await adapter.listJobs({ status: 'ready' }))
    .filter((job) => !seenJobIds.has(job.jobId))
    .sort(compareReadyJobs);

  for (const readyJob of readyJobs) {
    candidates.push({
      source: 'ready_snapshot',
      job: readyJob,
      timer: await loadTimerForJobIfPresent(adapter, readyJob.jobId),
      delegationContext: await resolveImmediateDelegationContext({
        adapter,
        job: readyJob,
      }),
    });
    seenJobIds.add(readyJob.jobId);
  }

  const readyProcesses = (await adapter.listProcesses({ status: 'ready' }))
    .sort((left, right) => {
      const leftUpdatedAt = left.updatedAt ?? left.createdAt;
      const rightUpdatedAt = right.updatedAt ?? right.createdAt;
      const updatedAtComparison = leftUpdatedAt.localeCompare(rightUpdatedAt);

      if (updatedAtComparison !== 0) {
        return updatedAtComparison;
      }

      return left.processId.localeCompare(right.processId);
    });

  for (const readyProcess of readyProcesses) {
    if (!isNonEmptyString(readyProcess.currentThreadId)) {
      continue;
    }

    const continuationThread = await adapter.loadThread(readyProcess.currentThreadId);

    if (
      continuationThread.status !== 'ready'
      || continuationThread.threadType !== 'child_process_wait'
      || continuationThread.processId !== readyProcess.processId
      || continuationThread.jobId !== readyProcess.jobId
    ) {
      continue;
    }

    const parentJob = await adapter.loadJob(readyProcess.jobId);

    if (parentJob.status !== 'active') {
      continue;
    }

    const childProcessId = Array.isArray(readyProcess.childProcessIds)
      ? readyProcess.childProcessIds.at(-1) ?? null
      : null;

    candidates.push({
      source: 'ready_parent_resume_thread',
      job: parentJob,
      thread: continuationThread,
      parentResumeContext: {
        parentProcessId: readyProcess.processId,
        continuationThreadId: continuationThread.threadId,
        childProcessId,
      },
    });
  }

  return candidates;
}

async function buildParentResumeChildExecution({
  adapter,
  childProcessId,
}) {
  if (!isNonEmptyString(childProcessId)) {
    return null;
  }

  const childProcess = await adapter.loadProcess(childProcessId);

  if (!OPENMAS_OS_TERMINAL_PROCESS_STATUSES.has(childProcess.status)) {
    return null;
  }

  const childJob = await adapter.loadJob(childProcess.jobId);
  const childThread = childProcess.currentThreadId
    ? await adapter.loadThread(childProcess.currentThreadId)
    : null;

  return {
    childJob,
    childProcess,
    childThread,
    invocationResult: null,
  };
}

async function dispatchReadyWorkCandidate({
  adapter,
  projectRootPath,
  osRootPath,
  candidate,
  now,
  invocationRunner,
  invocationOptions,
}) {
  const dispatchType = resolveDispatchType(candidate);

  if (dispatchType === 'parent_resume') {
    const childExecution = await buildParentResumeChildExecution({
      adapter,
      childProcessId: candidate.parentResumeContext.childProcessId,
    });

    if (!childExecution) {
      throw new Error(
        `OpenMAS OS parent resume candidate ${candidate.parentResumeContext.parentProcessId}`
        + ' requires a terminal child Process before resume.',
      );
    }

    const execution = await resumeParentAfterDelegatedChild({
      adapter,
      projectRootPath,
      osRootPath,
      parentProcessId: candidate.parentResumeContext.parentProcessId,
      continuationThreadId: candidate.parentResumeContext.continuationThreadId,
      childExecution,
      now,
      invocationRunner,
      invocationOptions,
    });

    return summarizeDispatchResult({
      dispatchType,
      candidate,
      execution,
    });
  }

  if (dispatchType === 'scheduled_delegation') {
    const execution = await runDelegatedJobNow({
      adapter,
      projectRootPath,
      osRootPath,
      childJobId: candidate.job.jobId,
      parentProcessId: candidate.timer.payload.parentProcessId,
      parentThreadId: candidate.timer.payload.parentThreadId ?? null,
      notifyParent: false,
      parentCompletionMode: 'scheduled_delegation_async',
      childResultKind: 'scheduled_child_result',
      scheduledTimer: candidate.timer,
      deliveryMode: candidate.timer.payload.deliveryMode ?? 'persist_only',
      now,
      invocationRunner,
      invocationOptions,
    });

    return summarizeDispatchResult({
      dispatchType,
      candidate,
      execution,
    });
  }

  if (dispatchType === 'delegation') {
    const execution = await runDelegatedJobNow({
      adapter,
      projectRootPath,
      osRootPath,
      childJobId: candidate.job.jobId,
      parentProcessId: candidate.delegationContext.parentProcessId,
      parentThreadId: candidate.delegationContext.parentThreadId,
      now,
      invocationRunner,
      invocationOptions,
    });

    return summarizeDispatchResult({
      dispatchType,
      candidate,
      execution,
    });
  }

  const execution = await runJobNow({
    adapter,
    projectRootPath,
    osRootPath,
    jobId: candidate.job.jobId,
    now,
    invocationRunner,
    invocationOptions,
  });

  return summarizeDispatchResult({
    dispatchType,
    candidate,
    execution,
  });
}

async function attemptDispatchReadyWorkCandidate(options) {
  try {
    return await dispatchReadyWorkCandidate(options);
  } catch (error) {
    if (isOpenMasOsJobClaimError(error)) {
      return createSkippedDispatchResult(options.candidate, error);
    }

    return createFailedDispatchResult(options.candidate, error);
  }
}

async function dispatchReadyWorkCandidates({
  adapter,
  projectRootPath,
  osRootPath,
  candidates,
  now,
  maxDispatchedJobs,
  invocationRunner,
  invocationOptions,
  asyncDispatchExecutor = null,
}) {
  const dispatches = [];
  const deferredDispatches = [];
  const dispatchedCandidates = [];
  const selectedCandidates = candidates.slice(0, maxDispatchedJobs);

  for (const candidate of selectedCandidates) {
    const executionOptions = {
      adapter,
      projectRootPath,
      osRootPath,
      candidate,
      now,
      invocationRunner,
      invocationOptions,
    };

    if (asyncDispatchExecutor) {
      const submission = asyncDispatchExecutor.submit({
        candidate,
        execute: () => attemptDispatchReadyWorkCandidate(executionOptions),
      });

      if (submission.accepted) {
        dispatches.push(submission.result);
        dispatchedCandidates.push(candidate);
      } else {
        deferredDispatches.push(submission.result);
      }

      continue;
    }

    dispatchedCandidates.push(candidate);
    dispatches.push(await attemptDispatchReadyWorkCandidate({
        adapter,
        projectRootPath,
        osRootPath,
        candidate,
        now,
        invocationRunner,
        invocationOptions,
      }));
  }

  return {
    dispatches,
    dispatchedCandidates,
    deferredDispatches,
  };
}

async function processPendingSystemCallsForTick({
  adapter,
  projectRootPath,
  osRootPath,
  serviceId,
  tickId,
  startedAt,
  maxSystemCallsPerTick,
  systemCallProcessor = null,
  delegationPolicy = undefined,
}) {
  try {
    const processor = systemCallProcessor ?? createKernelSystemCallProcessor({
      adapter,
      projectRootPath,
      osRootPath,
      serviceId,
      tickId,
      now: () => startedAt,
      maxSystemCallsPerRun: maxSystemCallsPerTick,
      delegationPolicy,
    });
    const processorResult = await processor.processPendingSystemCalls({
      serviceId,
      tickId,
      maxSystemCallsPerRun: maxSystemCallsPerTick,
      delegationPolicy,
    });

    return summarizeSystemCallProcessorResult(processorResult);
  } catch (error) {
    return createFailedSystemCallSummary({
      processedAt: startedAt,
      error,
    });
  }
}

export async function runOpenMasOsServiceTick({
  adapter = null,
  projectRootPath = null,
  osRootPath = null,
  now = defaultNow,
  audit = true,
  serviceId = DEFAULT_SERVICE_ID,
  maxDispatchedJobs = 25,
  maxSystemCallsPerTick = DEFAULT_MAX_SYSTEM_CALLS_PER_TICK,
  recoverStaleRunningInvocations = true,
  recoverTerminalResultPublications = true,
  reconcileSchedulerQueues = true,
  staleRunningInvocationAfterMs = DEFAULT_STALE_RUNNING_INVOCATION_AFTER_MS,
  systemCallProcessor = null,
  delegationPolicy = undefined,
  asyncDispatchExecutor = null,
  invocationRunner,
  invocationOptions = {},
} = {}) {
  const runtimeAdapter = assertAdapter(createAdapter({ adapter, projectRootPath, osRootPath }));
  const nowFn = normalizeNow(now);
  const dispatchLimit = assertMaxDispatchedJobs(maxDispatchedJobs);
  const executionDispatcher = assertAsyncDispatchExecutor(asyncDispatchExecutor);
  const systemCallLimit = assertMaxSystemCallsPerTick(maxSystemCallsPerTick);
  const staleRunningInvocationThreshold = assertStaleRunningInvocationAfterMs(staleRunningInvocationAfterMs);
  const tickId = createTickId();
  const startedAt = nowFn();
  const schedulerQueueReconciliation = reconcileSchedulerQueues
    && typeof runtimeAdapter.reconcileSchedulerQueues === 'function'
    ? await runtimeAdapter.reconcileSchedulerQueues({ reconciledAt: startedAt })
    : null;

  if (audit) {
    await appendServiceEvent({
      adapter: runtimeAdapter,
      eventType: 'os.service.tick.started',
      occurredAt: startedAt,
      payload: {
        tickId,
      },
    });
  }

  const systemCalls = await processPendingSystemCallsForTick({
    adapter: runtimeAdapter,
    projectRootPath,
    osRootPath,
    serviceId,
    tickId,
    startedAt,
    maxSystemCallsPerTick: systemCallLimit,
    systemCallProcessor,
    delegationPolicy,
  });
  const systemCallCallerReconciliation = await reconcileTerminalDelegationSystemCallCallers({
    adapter: runtimeAdapter,
    projectRootPath,
    osRootPath,
    observedAt: startedAt,
  });
  const unsupportedResourceWaitReconciliation = await reconcileUnsupportedForegroundResourceWaitsForTick({
    adapter: runtimeAdapter,
    serviceId,
    tickId,
    observedAt: startedAt,
  });
  const releaseResult = await releaseDueOneShotJobs({
    adapter: runtimeAdapter,
    now: () => startedAt,
    recoverUnlinkedReleaseResults: recoverTerminalResultPublications,
  });
  const parentWaitRecovery = await recoverLostParentWaitsForTick({
    adapter: runtimeAdapter,
    serviceId,
    tickId,
    observedAt: startedAt,
  });
  const candidates = await collectReadyWorkCandidates({
    adapter: runtimeAdapter,
    releaseResult,
  });
  const {
    dispatches,
    dispatchedCandidates,
    deferredDispatches,
  } = await dispatchReadyWorkCandidates({
    adapter: runtimeAdapter,
    projectRootPath,
    osRootPath,
    candidates,
    now: nowFn,
    maxDispatchedJobs: dispatchLimit,
    invocationRunner,
    invocationOptions,
    asyncDispatchExecutor: executionDispatcher,
  });
  const settledDispatches = executionDispatcher
    ? executionDispatcher.takeSettledResults()
    : [];
  const finishedAt = nowFn();
  const recovery = recoverStaleRunningInvocations
    ? await recoverStaleRunningInvocationsForTick({
      adapter: runtimeAdapter,
      serviceId,
      tickId,
      observedAt: finishedAt,
      staleRunningInvocationAfterMs: staleRunningInvocationThreshold,
      asyncDispatchExecutor: executionDispatcher,
    })
    : createRecoverySummary({
      observedAt: finishedAt,
      staleRunningInvocationAfterMs: staleRunningInvocationThreshold,
    });
  const failedDispatches = [...dispatches, ...settledDispatches]
    .filter((dispatch) => dispatch.status === 'failed');
  const shouldRecoverTerminalResults = recoverTerminalResultPublications
    || recovery.recoveredCount > 0
    || failedDispatches.length > 0;
  const resultRecoveryJobIsActive = executionDispatcher
    ? (jobId) => executionDispatcher.isJobActive(jobId)
    : null;
  const foregroundResultRecovery = shouldRecoverTerminalResults
    ? await recoverUnlinkedForegroundCompletionResults({
      adapter: runtimeAdapter,
      now: () => finishedAt,
      isJobActive: resultRecoveryJobIsActive,
    })
    : createTerminalResultRecoverySummary({
      observedAt: finishedAt,
      scanType: 'process',
    });
  const scheduledChildRecovery = shouldRecoverTerminalResults
    ? await recoverUnlinkedScheduledChildResults({
      adapter: runtimeAdapter,
      now: () => finishedAt,
      isJobActive: resultRecoveryJobIsActive,
    })
    : createTerminalResultRecoverySummary({
      observedAt: finishedAt,
      scanType: 'timer',
    });
  const delegatedChildRecovery = shouldRecoverTerminalResults
    ? await recoverUnlinkedDelegatedChildResults({
      adapter: runtimeAdapter,
      now: () => finishedAt,
      isJobActive: resultRecoveryJobIsActive,
    })
    : createTerminalResultRecoverySummary({
      observedAt: finishedAt,
      scanType: 'process',
    });
  const parentResumeResultRecovery = shouldRecoverTerminalResults
    ? await recoverUnlinkedParentResumeResults({
      adapter: runtimeAdapter,
      now: () => finishedAt,
      isJobActive: resultRecoveryJobIsActive,
    })
    : createTerminalResultRecoverySummary({
      observedAt: finishedAt,
      scanType: 'process',
    });
  const systemCallFailed = systemCalls.status === 'failed' || systemCalls.failedCount > 0;
  const systemCallCallerReconciliationFailed = systemCallCallerReconciliation.status === 'completed_with_failures'
    || systemCallCallerReconciliation.failedCount > 0;
  const unsupportedResourceWaitReconciliationFailed = unsupportedResourceWaitReconciliation.status === 'completed_with_failures'
    || unsupportedResourceWaitReconciliation.failedCount > 0;
  const parentWaitRecoveryFailed = parentWaitRecovery.status === 'completed_with_failures'
    || parentWaitRecovery.failedCount > 0;
  const recoveryFailed = recovery.status === 'completed_with_failures' || recovery.failedCount > 0;
  const foregroundResultRecoveryFailed = foregroundResultRecovery.status === 'completed_with_failures'
    || foregroundResultRecovery.failedCount > 0;
  const scheduledChildRecoveryFailed = scheduledChildRecovery.status === 'completed_with_failures'
    || scheduledChildRecovery.failedCount > 0;
  const delegatedChildRecoveryFailed = delegatedChildRecovery.status === 'completed_with_failures'
    || delegatedChildRecovery.failedCount > 0;
  const parentResumeResultRecoveryFailed = parentResumeResultRecovery.status === 'completed_with_failures'
    || parentResumeResultRecovery.failedCount > 0;
  const status = systemCallFailed || systemCallCallerReconciliationFailed
      || unsupportedResourceWaitReconciliationFailed
      || failedDispatches.length > 0 || parentWaitRecoveryFailed || recoveryFailed
      || foregroundResultRecoveryFailed
      || scheduledChildRecoveryFailed || delegatedChildRecoveryFailed || parentResumeResultRecoveryFailed
    ? 'completed_with_failures'
    : dispatches.length === 0
      && settledDispatches.length === 0
      && systemCalls.processedCount === 0
      && systemCallCallerReconciliation.terminalizedCount === 0
      && unsupportedResourceWaitReconciliation.terminalizedCount === 0
      && parentWaitRecovery.recoveredCount === 0
      && recovery.recoveredCount === 0
      && foregroundResultRecovery.recoveredCount === 0
      && scheduledChildRecovery.recoveredCount === 0
      && delegatedChildRecovery.recoveredCount === 0
      && parentResumeResultRecovery.recoveredCount === 0
    ? 'idle'
    : 'completed';
  const result = {
    kind: SERVICE_TICK_RESULT_KIND,
    version: SERVICE_TICK_RESULT_VERSION,
    tickId,
    status,
    startedAt,
    finishedAt,
    schedulerQueueReconciliation,
    systemCalls,
    systemCallCallerReconciliation,
    unsupportedResourceWaitReconciliation,
    release: summarizeReleaseResult(releaseResult),
    parentWaitRecovery,
    foregroundResultRecovery,
    scheduledChildRecovery,
    delegatedChildRecovery,
    parentResumeResultRecovery,
    readyWork: summarizeReadyWork({
      candidates,
      dispatchedCandidates,
    }),
    recovery,
    dispatches,
    settledDispatches,
    deferredDispatches,
    asyncExecution: executionDispatcher?.snapshot() ?? null,
  };

  if (audit) {
    await appendServiceEvent({
      adapter: runtimeAdapter,
      eventType: 'os.service.tick.completed',
      occurredAt: finishedAt,
      payload: {
        tickId,
        status,
        systemCallProcessedCount: systemCalls.processedCount,
        systemCallCompletedCount: systemCalls.completedCount,
        systemCallDeniedCount: systemCalls.deniedCount,
        systemCallFailedCount: systemCalls.failedCount,
        systemCallExpiredCount: systemCalls.expiredCount,
        systemCallCancelledCount: systemCalls.cancelledCount,
        systemCallCallerReconciliationTerminalizedCount: systemCallCallerReconciliation.terminalizedCount,
        systemCallCallerReconciliationFailedCount: systemCallCallerReconciliation.failedCount,
        unsupportedResourceWaitReconciliationTerminalizedCount: unsupportedResourceWaitReconciliation.terminalizedCount,
        unsupportedResourceWaitReconciliationFailedCount: unsupportedResourceWaitReconciliation.failedCount,
        releasedCount: releaseResult.released.length,
        parentWaitRecoveryRecoveredCount: parentWaitRecovery.recoveredCount,
        parentWaitRecoveryFailedCount: parentWaitRecovery.failedCount,
        scheduledChildRecoveryRecoveredCount: scheduledChildRecovery.recoveredCount,
        scheduledChildRecoveryFailedCount: scheduledChildRecovery.failedCount,
        delegatedChildRecoveryRecoveredCount: delegatedChildRecovery.recoveredCount,
        delegatedChildRecoveryFailedCount: delegatedChildRecovery.failedCount,
        parentResumeResultRecoveryRecoveredCount: parentResumeResultRecovery.recoveredCount,
        parentResumeResultRecoveryFailedCount: parentResumeResultRecovery.failedCount,
        readyCandidateCount: candidates.length,
        dispatchCount: dispatches.length,
        deferredDispatchCount: candidates.length - dispatchedCandidates.length,
        settledDispatchCount: settledDispatches.length,
        asyncActiveExecutionCount: result.asyncExecution?.activeCount ?? 0,
        failedDispatchCount: failedDispatches.length,
        recoveryRecoveredCount: recovery.recoveredCount,
        recoveryFailedCount: recovery.failedCount,
        foregroundResultRecoveryRecoveredCount: foregroundResultRecovery.recoveredCount,
        foregroundResultRecoveryFailedCount: foregroundResultRecovery.failedCount,
      },
    });
  }

  return assertSafeOsSerializableValue(result, 'OpenMAS OS service tick result');
}

export class LocalOpenMasOsService {
  constructor({
    adapter = null,
    projectRootPath = null,
    osRootPath = null,
    now = defaultNow,
  } = {}) {
    this.adapter = assertAdapter(createAdapter({ adapter, projectRootPath, osRootPath }));
    this.projectRootPath = projectRootPath;
    this.osRootPath = osRootPath;
    this.now = normalizeNow(now);
  }

  async tick(options = {}) {
    return runOpenMasOsServiceTick({
      adapter: this.adapter,
      projectRootPath: this.projectRootPath,
      osRootPath: this.osRootPath,
      now: this.now,
      ...options,
    });
  }
}

export function createLocalOpenMasOsService(options = {}) {
  return new LocalOpenMasOsService(options);
}

export {
  DEFAULT_MAX_SYSTEM_CALLS_PER_TICK,
  DEFAULT_STALE_RUNNING_INVOCATION_AFTER_MS,
  ASYNC_DISPATCH_EXECUTOR_SNAPSHOT_KIND,
  ASYNC_DISPATCH_EXECUTOR_SNAPSHOT_VERSION,
  SERVICE_TICK_RESULT_KIND,
  SERVICE_TICK_RESULT_VERSION,
};
