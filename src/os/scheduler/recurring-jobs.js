import { randomUUID } from 'node:crypto';
import {
  LOCAL_RUNTIME_TIMER_KIND,
  createLocalRuntimeAdapter,
} from '../adapters/local-runtime-adapter.js';
import {
  OPENMAS_OS_KINDS,
  OPENMAS_OS_SCHEMA_VERSION,
} from '../../contracts/os/openmas-os-runtime-contract.js';
import { runAgentInvocation } from '../../invocation/run-agent-invocation.js';

const MAX_SET_TIMEOUT_DELAY_MS = 2147483647;
const DEFAULT_MAX_CONSECUTIVE_FAILURES = 3;

const RECURRING_TIMER_TRIGGER_TYPE = 'recurring';

const SCHEDULABLE_RECURRING_JOB_STATUSES = new Set([
  'draft',
  'admitted',
  'scheduled',
  'paused',
]);

const ACTIVE_PROCESS_STATUSES = new Set([
  'created',
  'ready',
  'running',
  'blocked',
  'suspended',
  'interrupted',
]);

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function resolveActiveCognitiveIdentityIdFromInvocationResult(invocationResult) {
  for (const candidate of [
    invocationResult?.readiness?.activeCognitiveSet?.primaryCognitiveIdentityId,
    invocationResult?.workCycle?.primaryCognitiveIdentityId,
    invocationResult?.primaryCognitiveIdentityId,
  ]) {
    if (isNonEmptyString(candidate)) {
      return candidate.trim();
    }
  }

  return null;
}

function defaultNow() {
  return new Date().toISOString();
}

function normalizeNow(now) {
  if (now === undefined || now === null) {
    return defaultNow;
  }

  if (typeof now !== 'function') {
    throw new Error('OpenMAS OS recurring scheduler now must be a function when provided.');
  }

  return now;
}

function createSystemActor() {
  return {
    type: 'system',
    id: 'openmas-os',
  };
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
    throw new Error('OpenMAS OS recurring scheduler requires a runtime adapter.');
  }

  for (const methodName of [
    'loadJob',
    'persistJob',
    'persistProcess',
    'listProcesses',
    'persistThread',
    'persistTimer',
    'loadTimer',
    'listTimers',
    'appendEvent',
  ]) {
    if (typeof adapter[methodName] !== 'function') {
      throw new Error(`OpenMAS OS runtime adapter must implement ${methodName}.`);
    }
  }

  return adapter;
}

function parseTimestamp(timestamp, description) {
  if (!isNonEmptyString(timestamp)) {
    throw new Error(`${description} must be a non-empty timestamp string.`);
  }

  const timestampMs = Date.parse(timestamp);

  if (!Number.isFinite(timestampMs)) {
    throw new Error(`${description} is not a valid timestamp: ${timestamp}`);
  }

  return timestampMs;
}

function assertPositiveInteger(value, description) {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${description} must be a positive integer.`);
  }

  return value;
}

function addMilliseconds(timestamp, intervalMs) {
  return new Date(parseTimestamp(timestamp, 'OpenMAS OS timestamp') + intervalMs).toISOString();
}

function computeNextRunAt({ previousRunAt, nowTimestamp, intervalMs }) {
  const nowMs = parseTimestamp(nowTimestamp, 'OpenMAS OS current time');
  let nextRunMs = parseTimestamp(previousRunAt, 'OpenMAS OS recurring timer runAt') + intervalMs;

  while (nextRunMs <= nowMs) {
    nextRunMs += intervalMs;
  }

  return new Date(nextRunMs).toISOString();
}

function computeDelayMs(runAt, nowTimestamp) {
  const delayMs = parseTimestamp(runAt, 'OpenMAS OS recurring timer runAt')
    - parseTimestamp(nowTimestamp, 'OpenMAS OS current time');

  return Math.min(Math.max(0, delayMs), MAX_SET_TIMEOUT_DELAY_MS);
}

function isDueAt(runAt, nowTimestamp) {
  return parseTimestamp(runAt, 'OpenMAS OS recurring timer runAt')
    <= parseTimestamp(nowTimestamp, 'OpenMAS OS current time');
}

function resolveRecurringTimerId(jobId) {
  if (!isNonEmptyString(jobId)) {
    throw new Error('OpenMAS OS recurring Job jobId must be a non-empty string.');
  }

  return `timer_${jobId.trim()}`;
}

function isRecurringTimer(timer) {
  return timer?.payload?.triggerType === RECURRING_TIMER_TRIGGER_TYPE;
}

function assertRecurringJob(job) {
  if (job.trigger.type !== 'recurring') {
    throw new Error(`OpenMAS OS Job ${job.jobId} must use trigger type "recurring".`);
  }

  assertPositiveInteger(job.trigger.intervalMs, `OpenMAS OS Job ${job.jobId} trigger.intervalMs`);

  if (!SCHEDULABLE_RECURRING_JOB_STATUSES.has(job.status)) {
    throw new Error(`OpenMAS OS Job ${job.jobId} cannot be scheduled as recurring from status "${job.status}".`);
  }
}

function assertRunnableRecurringJob(job) {
  if (job.program.type !== 'agent_invocation') {
    throw new Error(`OpenMAS OS recurring execution only supports agent_invocation programs in this slice. Received: ${job.program.type}`);
  }
}

function resolveInputText(inputRef) {
  if (!inputRef || inputRef.type === 'none') {
    return '';
  }

  if (inputRef.type === 'inline_text') {
    return inputRef.text ?? '';
  }

  throw new Error(`OpenMAS OS recurring execution does not support inputRef type "${inputRef.type}" yet.`);
}

function buildInvocationOptionsFromJob({ job, projectRootPath, invocationOptions }) {
  const options = {
    ...invocationOptions,
    projectRootPath,
    operationalIdentityId: job.assignedOperationalIdentityId,
    invocationMode: job.program.mode,
    command: job.program.command,
    inputText: resolveInputText(job.inputRef),
    requestedBy: job.createdBy.id,
  };

  if (job.conversationId) {
    options.conversationRef = job.conversationId;
  }

  return options;
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

function mapInvocationStatusToProcessState(status) {
  if (status === 'completed') {
    return {
      processStatus: 'completed',
      threadStatus: 'completed',
      threadWaitReason: null,
      eventSuffix: 'completed',
      isFailure: false,
    };
  }

  if (status === 'blocked') {
    return {
      processStatus: 'blocked',
      threadStatus: 'blocked',
      threadWaitReason: 'waiting_for_resource',
      eventSuffix: 'blocked',
      isFailure: false,
    };
  }

  return {
    processStatus: 'failed',
    threadStatus: 'failed',
    threadWaitReason: null,
    eventSuffix: 'failed',
    isFailure: true,
  };
}

async function appendLifecycleEvent({
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
    payload,
  });
}

function buildInitialRecurringPayload({
  job,
  firstRunAt,
  nowTimestamp,
  maxConsecutiveFailures,
}) {
  return {
    triggerType: RECURRING_TIMER_TRIGGER_TYPE,
    source: 'job.trigger.intervalMs',
    intervalMs: job.trigger.intervalMs,
    nextRunAt: firstRunAt,
    lastRunAt: null,
    lastCompletedAt: null,
    runCount: 0,
    skippedRunCount: 0,
    consecutiveFailures: 0,
    maxConsecutiveFailures,
    noOverlap: true,
    missedRunPolicy: job.policies.missedRunPolicy ?? 'skip',
    createdAt: nowTimestamp,
  };
}

function updateTimerPayload(timer, updates) {
  return {
    ...(timer.payload ?? {}),
    ...updates,
  };
}

async function hasActiveProcessForJob(adapter, jobId) {
  const processes = await adapter.listProcesses({ jobId });

  return processes.some((processState) => ACTIVE_PROCESS_STATUSES.has(processState.status));
}

async function markRecurringRunSkipped({
  adapter,
  timer,
  job,
  nowTimestamp,
  reason,
}) {
  const nextRunAt = computeNextRunAt({
    previousRunAt: timer.runAt,
    nowTimestamp,
    intervalMs: timer.payload.intervalMs,
  });
  const skippedTimer = await adapter.persistTimer({
    ...timer,
    runAt: nextRunAt,
    updatedAt: nowTimestamp,
    payload: updateTimerPayload(timer, {
      nextRunAt,
      skippedRunCount: (timer.payload.skippedRunCount ?? 0) + 1,
      lastSkippedAt: nowTimestamp,
      lastSkipReason: reason,
    }),
  });

  await appendLifecycleEvent({
    adapter,
    eventType: 'job.run_skipped',
    targetType: 'job',
    targetId: job.jobId,
    jobId: job.jobId,
    occurredAt: nowTimestamp,
    payload: {
      reason,
      timerId: timer.timerId,
      missedRunPolicy: timer.payload.missedRunPolicy ?? 'skip',
      nextRunAt,
    },
  });
  await appendLifecycleEvent({
    adapter,
    eventType: 'timer.rescheduled',
    targetType: 'timer',
    targetId: skippedTimer.timerId,
    jobId: skippedTimer.jobId,
    occurredAt: nowTimestamp,
    payload: {
      runAt: skippedTimer.runAt,
      reason,
    },
  });

  return {
    released: false,
    status: 'skipped',
    reason,
    timer: skippedTimer,
    job,
  };
}

async function evaluateRecurringTimer({ adapter, timer, nowTimestamp }) {
  if (!isRecurringTimer(timer)) {
    return {
      released: false,
      status: 'ignored',
      reason: 'not_recurring_timer',
      timer,
      job: null,
    };
  }

  if (!isDueAt(timer.runAt, nowTimestamp)) {
    return {
      released: false,
      status: 'pending',
      reason: 'timer_not_due',
      timer,
      job: null,
    };
  }

  const job = await adapter.loadJob(timer.jobId);

  if (job.status === 'paused') {
    return {
      released: false,
      status: 'paused',
      reason: 'job_paused',
      timer,
      job,
    };
  }

  if (['cancelled', 'completed', 'expired', 'failed'].includes(job.status)) {
    return {
      released: false,
      status: 'inactive',
      reason: `job_${job.status}`,
      timer,
      job,
    };
  }

  if (timer.payload.noOverlap !== false && await hasActiveProcessForJob(adapter, job.jobId)) {
    return markRecurringRunSkipped({
      adapter,
      timer,
      job,
      nowTimestamp,
      reason: 'active_process_overlap',
    });
  }

  if (job.status !== 'scheduled') {
    return {
      released: false,
      status: job.status,
      reason: 'job_not_scheduled',
      timer,
      job,
    };
  }

  return {
    released: true,
    status: 'due',
    timer,
    job,
  };
}

async function finalizeRecurringTimerAfterRun({
  adapter,
  timer,
  job,
  finishedAt,
  invocationResult,
  statusMapping,
}) {
  const previousConsecutiveFailures = timer.payload.consecutiveFailures ?? 0;
  const consecutiveFailures = statusMapping.isFailure
    ? previousConsecutiveFailures + 1
    : 0;
  const maxConsecutiveFailures = timer.payload.maxConsecutiveFailures ?? DEFAULT_MAX_CONSECUTIVE_FAILURES;
  const shouldPauseForFailures = consecutiveFailures >= maxConsecutiveFailures;
  const nextRunAt = computeNextRunAt({
    previousRunAt: timer.runAt,
    nowTimestamp: finishedAt,
    intervalMs: timer.payload.intervalMs,
  });

  if (shouldPauseForFailures) {
    const cancelledTimer = await adapter.persistTimer({
      ...timer,
      status: 'cancelled',
      updatedAt: finishedAt,
      payload: updateTimerPayload(timer, {
        lastRunAt: timer.runAt,
        lastCompletedAt: finishedAt,
        runCount: (timer.payload.runCount ?? 0) + 1,
        consecutiveFailures,
        lastInvocationStatus: invocationResult.status,
        pausedReason: 'max_consecutive_failures',
      }),
    });
    const pausedJob = await adapter.persistJob({
      ...job,
      status: 'paused',
      updatedAt: finishedAt,
    });

    await appendLifecycleEvent({
      adapter,
      eventType: 'timer.cancelled',
      targetType: 'timer',
      targetId: cancelledTimer.timerId,
      jobId: cancelledTimer.jobId,
      occurredAt: finishedAt,
      payload: {
        reason: 'max_consecutive_failures',
        consecutiveFailures,
      },
    });
    await appendLifecycleEvent({
      adapter,
      eventType: 'job.paused',
      targetType: 'job',
      targetId: pausedJob.jobId,
      jobId: pausedJob.jobId,
      occurredAt: finishedAt,
      payload: {
        reason: 'max_consecutive_failures',
        consecutiveFailures,
      },
    });

    return {
      timer: cancelledTimer,
      job: pausedJob,
      pausedForFailures: true,
    };
  }

  const rescheduledTimer = await adapter.persistTimer({
    ...timer,
    runAt: nextRunAt,
    updatedAt: finishedAt,
    payload: updateTimerPayload(timer, {
      nextRunAt,
      lastRunAt: timer.runAt,
      lastCompletedAt: finishedAt,
      runCount: (timer.payload.runCount ?? 0) + 1,
      consecutiveFailures,
      lastInvocationStatus: invocationResult.status,
    }),
  });
  const scheduledJob = await adapter.persistJob({
    ...job,
    status: 'scheduled',
    updatedAt: finishedAt,
  });

  await appendLifecycleEvent({
    adapter,
    eventType: 'timer.rescheduled',
    targetType: 'timer',
    targetId: rescheduledTimer.timerId,
    jobId: rescheduledTimer.jobId,
    occurredAt: finishedAt,
    payload: {
      runAt: rescheduledTimer.runAt,
      consecutiveFailures,
      lastInvocationStatus: invocationResult.status,
    },
  });

  return {
    timer: rescheduledTimer,
    job: scheduledJob,
    pausedForFailures: false,
  };
}

async function runRecurringJobOnce({
  adapter,
  projectRootPath,
  job,
  timer,
  nowFn,
  invocationRunner,
  invocationOptions,
}) {
  assertRunnableRecurringJob(job);

  const processId = createRuntimeId('process');
  const threadId = createRuntimeId('thread');
  const startedAt = nowFn();
  const activeJob = await adapter.persistJob({
    ...job,
    status: 'active',
    updatedAt: startedAt,
  });

  await appendLifecycleEvent({
    adapter,
    eventType: 'job.activated',
    targetType: 'job',
    targetId: activeJob.jobId,
    jobId: activeJob.jobId,
    occurredAt: startedAt,
    payload: {
      status: activeJob.status,
      timerId: timer.timerId,
      runAt: timer.runAt,
    },
  });

  let processState = await adapter.persistProcess({
    kind: OPENMAS_OS_KINDS.process,
    schemaVersion: OPENMAS_OS_SCHEMA_VERSION,
    processId,
    jobId: activeJob.jobId,
    status: 'running',
    operationalIdentityId: activeJob.assignedOperationalIdentityId,
    activeCognitiveIdentityId: null,
    currentThreadId: threadId,
    parentProcessId: null,
    childProcessIds: [],
    conversationId: activeJob.conversationId,
    memoryContextRefs: [],
    artifactRefs: [],
    credentialReferenceIds: [],
    pendingApprovalRefs: [],
    warnings: [],
    createdAt: startedAt,
    startedAt,
    updatedAt: startedAt,
    completedAt: null,
  });

  await appendLifecycleEvent({
    adapter,
    eventType: 'process.created',
    targetType: 'process',
    targetId: processId,
    jobId: activeJob.jobId,
    processId,
    occurredAt: startedAt,
    payload: {
      status: processState.status,
      operationalIdentityId: processState.operationalIdentityId,
      recurringTimerId: timer.timerId,
    },
  });

  let thread = await adapter.persistThread({
    kind: OPENMAS_OS_KINDS.thread,
    schemaVersion: OPENMAS_OS_SCHEMA_VERSION,
    threadId,
    processId,
    jobId: activeJob.jobId,
    status: 'running',
    threadType: 'agent_invocation',
    priority: activeJob.priority,
    attempt: 1,
    waitReason: null,
    dueAt: timer.runAt,
    createdAt: startedAt,
    startedAt,
    updatedAt: startedAt,
    completedAt: null,
  });

  await appendLifecycleEvent({
    adapter,
    eventType: 'thread.created',
    targetType: 'thread',
    targetId: threadId,
    jobId: activeJob.jobId,
    processId,
    threadId,
    occurredAt: startedAt,
    payload: {
      status: thread.status,
      threadType: thread.threadType,
    },
  });
  await appendLifecycleEvent({
    adapter,
    eventType: 'thread.started',
    targetType: 'thread',
    targetId: threadId,
    jobId: activeJob.jobId,
    processId,
    threadId,
    occurredAt: startedAt,
    payload: {
      status: thread.status,
    },
  });

  let invocationResult;

  try {
    invocationResult = await invocationRunner(buildInvocationOptionsFromJob({
      job: activeJob,
      projectRootPath,
      invocationOptions,
    }));
  } catch (error) {
    invocationResult = {
      invocationId: createRuntimeId('invocation_failure'),
      status: 'failed',
      message: error.message,
      warnings: [],
      errors: [error.message],
      persistence: null,
    };
  }

  const finishedAt = nowFn();
  const statusMapping = mapInvocationStatusToProcessState(invocationResult.status);
  const artifactRefs = buildArtifactRefsFromInvocationResult(invocationResult);

  thread = await adapter.persistThread({
    ...thread,
    status: statusMapping.threadStatus,
    waitReason: statusMapping.threadWaitReason,
    updatedAt: finishedAt,
    completedAt: statusMapping.threadStatus === 'completed' || statusMapping.threadStatus === 'failed'
      ? finishedAt
      : null,
  });

  processState = await adapter.persistProcess({
    ...processState,
    status: statusMapping.processStatus,
    activeCognitiveIdentityId: resolveActiveCognitiveIdentityIdFromInvocationResult(invocationResult),
    currentThreadId: statusMapping.processStatus === 'completed' || statusMapping.processStatus === 'failed'
      ? null
      : thread.threadId,
    artifactRefs,
    warnings: invocationResult.warnings ?? [],
    updatedAt: finishedAt,
    completedAt: statusMapping.processStatus === 'completed' || statusMapping.processStatus === 'failed'
      ? finishedAt
      : null,
  });

  await appendLifecycleEvent({
    adapter,
    eventType: `thread.${statusMapping.eventSuffix}`,
    targetType: 'thread',
    targetId: thread.threadId,
    jobId: activeJob.jobId,
    processId: processState.processId,
    threadId: thread.threadId,
    occurredAt: finishedAt,
    payload: {
      status: thread.status,
      invocationId: invocationResult.invocationId,
      invocationStatus: invocationResult.status,
    },
  });
  await appendLifecycleEvent({
    adapter,
    eventType: `process.${statusMapping.eventSuffix}`,
    targetType: 'process',
    targetId: processState.processId,
    jobId: activeJob.jobId,
    processId: processState.processId,
    occurredAt: finishedAt,
    payload: {
      status: processState.status,
      invocationId: invocationResult.invocationId,
      invocationStatus: invocationResult.status,
    },
  });
  await appendLifecycleEvent({
    adapter,
    eventType: `job.run_${statusMapping.eventSuffix}`,
    targetType: 'job',
    targetId: activeJob.jobId,
    jobId: activeJob.jobId,
    processId: processState.processId,
    threadId: thread.threadId,
    occurredAt: finishedAt,
    payload: {
      status: statusMapping.eventSuffix,
      invocationId: invocationResult.invocationId,
      invocationStatus: invocationResult.status,
      timerId: timer.timerId,
    },
  });

  const finalRecurringState = await finalizeRecurringTimerAfterRun({
    adapter,
    timer,
    job: activeJob,
    finishedAt,
    invocationResult,
    statusMapping,
  });

  return {
    job: finalRecurringState.job,
    process: processState,
    thread,
    timer: finalRecurringState.timer,
    invocationResult,
    pausedForFailures: finalRecurringState.pausedForFailures,
  };
}

export async function scheduleRecurringJob({
  adapter = null,
  projectRootPath = null,
  osRootPath = null,
  jobId,
  now = defaultNow,
  maxConsecutiveFailures = DEFAULT_MAX_CONSECUTIVE_FAILURES,
} = {}) {
  const runtimeAdapter = assertAdapter(createAdapter({ adapter, projectRootPath, osRootPath }));
  const nowFn = normalizeNow(now);
  const nowTimestamp = nowFn();
  const job = await runtimeAdapter.loadJob(jobId);

  assertRecurringJob(job);
  assertPositiveInteger(maxConsecutiveFailures, 'OpenMAS OS recurring maxConsecutiveFailures');

  const firstRunAt = addMilliseconds(nowTimestamp, job.trigger.intervalMs);
  const scheduledJob = await runtimeAdapter.persistJob({
    ...job,
    status: 'scheduled',
    updatedAt: nowTimestamp,
  });
  const timer = await runtimeAdapter.persistTimer({
    kind: LOCAL_RUNTIME_TIMER_KIND,
    schemaVersion: OPENMAS_OS_SCHEMA_VERSION,
    timerId: resolveRecurringTimerId(scheduledJob.jobId),
    jobId: scheduledJob.jobId,
    status: 'scheduled',
    runAt: firstRunAt,
    createdAt: nowTimestamp,
    updatedAt: nowTimestamp,
    payload: buildInitialRecurringPayload({
      job: scheduledJob,
      firstRunAt,
      nowTimestamp,
      maxConsecutiveFailures,
    }),
  });

  await appendLifecycleEvent({
    adapter: runtimeAdapter,
    eventType: 'job.scheduled',
    targetType: 'job',
    targetId: scheduledJob.jobId,
    jobId: scheduledJob.jobId,
    occurredAt: nowTimestamp,
    payload: {
      status: scheduledJob.status,
      intervalMs: scheduledJob.trigger.intervalMs,
      timerId: timer.timerId,
      recurring: true,
    },
  });
  await appendLifecycleEvent({
    adapter: runtimeAdapter,
    eventType: 'timer.scheduled',
    targetType: 'timer',
    targetId: timer.timerId,
    jobId: timer.jobId,
    occurredAt: nowTimestamp,
    payload: {
      status: timer.status,
      runAt: timer.runAt,
      triggerType: RECURRING_TIMER_TRIGGER_TYPE,
    },
  });

  return {
    job: scheduledJob,
    timer,
  };
}

export async function releaseDueRecurringJobs({
  adapter = null,
  projectRootPath = null,
  osRootPath = null,
  now = defaultNow,
} = {}) {
  const runtimeAdapter = assertAdapter(createAdapter({ adapter, projectRootPath, osRootPath }));
  const nowFn = normalizeNow(now);
  const nowTimestamp = nowFn();
  const scheduledTimers = await runtimeAdapter.listTimers({ status: 'scheduled' });
  const results = [];

  for (const timer of scheduledTimers) {
    if (!isRecurringTimer(timer)) {
      continue;
    }

    results.push(await evaluateRecurringTimer({
      adapter: runtimeAdapter,
      timer,
      nowTimestamp,
    }));
  }

  return {
    now: nowTimestamp,
    results,
    released: results.filter((result) => result.released),
    pending: results.filter((result) => result.status === 'pending'),
    skipped: results.filter((result) => result.status === 'skipped'),
    paused: results.filter((result) => result.status === 'paused'),
  };
}

export async function runDueRecurringJobsNow({
  adapter = null,
  projectRootPath,
  osRootPath = null,
  now = defaultNow,
  invocationRunner = runAgentInvocation,
  invocationOptions = {},
} = {}) {
  const runtimeAdapter = assertAdapter(createAdapter({ adapter, projectRootPath, osRootPath }));
  const nowFn = normalizeNow(now);
  const releaseResult = await releaseDueRecurringJobs({
    adapter: runtimeAdapter,
    now: nowFn,
  });
  const executions = [];

  for (const releasedResult of releaseResult.released) {
    await appendLifecycleEvent({
      adapter: runtimeAdapter,
      eventType: 'timer.fired',
      targetType: 'timer',
      targetId: releasedResult.timer.timerId,
      jobId: releasedResult.timer.jobId,
      occurredAt: releaseResult.now,
      payload: {
        runAt: releasedResult.timer.runAt,
        triggerType: RECURRING_TIMER_TRIGGER_TYPE,
      },
    });
    await appendLifecycleEvent({
      adapter: runtimeAdapter,
      eventType: 'job.due',
      targetType: 'job',
      targetId: releasedResult.job.jobId,
      jobId: releasedResult.job.jobId,
      occurredAt: releaseResult.now,
      payload: {
        timerId: releasedResult.timer.timerId,
        runAt: releasedResult.timer.runAt,
        recurring: true,
      },
    });

    executions.push(await runRecurringJobOnce({
      adapter: runtimeAdapter,
      projectRootPath,
      job: releasedResult.job,
      timer: releasedResult.timer,
      nowFn,
      invocationRunner,
      invocationOptions,
    }));
  }

  return {
    releaseResult,
    executions,
  };
}

export class LocalRecurringScheduler {
  constructor({
    adapter = null,
    projectRootPath = null,
    osRootPath = null,
    now = defaultNow,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
    onDue = null,
    unrefTimers = false,
  } = {}) {
    this.adapter = assertAdapter(createAdapter({ adapter, projectRootPath, osRootPath }));
    this.projectRootPath = projectRootPath;
    this.now = normalizeNow(now);
    this.setTimeoutFn = setTimeoutFn;
    this.clearTimeoutFn = clearTimeoutFn;
    this.onDue = onDue;
    this.unrefTimers = unrefTimers;
    this.handlesByTimerId = new Map();
  }

  armTimer(timer) {
    if (timer.status !== 'scheduled' || !isRecurringTimer(timer)) {
      return null;
    }

    this.clearTimer(timer.timerId);

    const delayMs = computeDelayMs(timer.runAt, this.now());
    const handle = this.setTimeoutFn(async () => {
      this.handlesByTimerId.delete(timer.timerId);

      const releaseResult = await releaseDueRecurringJobs({
        adapter: this.adapter,
        now: this.now,
      });

      if (typeof this.onDue === 'function') {
        await this.onDue(releaseResult);
      }
    }, delayMs);

    if (this.unrefTimers && handle && typeof handle.unref === 'function') {
      handle.unref();
    }

    this.handlesByTimerId.set(timer.timerId, handle);

    return {
      timerId: timer.timerId,
      delayMs,
      handle,
    };
  }

  clearTimer(timerId) {
    const handle = this.handlesByTimerId.get(timerId);

    if (handle) {
      this.clearTimeoutFn(handle);
      this.handlesByTimerId.delete(timerId);
    }
  }

  async scheduleJob(jobId) {
    const result = await scheduleRecurringJob({
      adapter: this.adapter,
      jobId,
      now: this.now,
    });
    const armedTimer = this.armTimer(result.timer);

    return {
      ...result,
      armedTimer,
    };
  }

  async restoreTimers() {
    const timers = (await this.adapter.listTimers({ status: 'scheduled' }))
      .filter(isRecurringTimer);
    const armedTimers = [];

    for (const timer of timers) {
      armedTimers.push(this.armTimer(timer));
    }

    return {
      restored: timers.length,
      armedTimers: armedTimers.filter(Boolean),
    };
  }
}

export function createLocalRecurringScheduler(options = {}) {
  return new LocalRecurringScheduler(options);
}

export {
  DEFAULT_MAX_CONSECUTIVE_FAILURES,
  MAX_SET_TIMEOUT_DELAY_MS,
  RECURRING_TIMER_TRIGGER_TYPE,
  resolveRecurringTimerId,
};
