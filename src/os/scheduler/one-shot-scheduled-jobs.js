import { randomUUID } from 'node:crypto';
import {
  LOCAL_RUNTIME_TIMER_KIND,
  createLocalRuntimeAdapter,
} from '../adapters/local-runtime-adapter.js';
import {
  OPENMAS_OS_KINDS,
  OPENMAS_OS_SCHEMA_VERSION,
} from '../../contracts/os/openmas-os-runtime-contract.js';
import {
  OPENMAS_OS_RESULT_RECORD_KINDS,
  OPENMAS_OS_RESULT_RECORD_SCHEMA_VERSION,
} from '../../contracts/os/openmas-os-result-record-contract.js';
import { runJobNow } from '../manual-job-execution.js';

const MAX_SET_TIMEOUT_DELAY_MS = 2147483647;

const SCHEDULABLE_JOB_STATUSES = new Set([
  'draft',
  'admitted',
  'scheduled',
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
    throw new Error('OpenMAS OS one-shot scheduler now must be a function when provided.');
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

function createAdapter({ adapter = null, projectRootPath = null, osRootPath = null } = {}) {
  return adapter ?? createLocalRuntimeAdapter({ projectRootPath, osRootPath });
}

function assertAdapter(adapter) {
  if (!adapter || typeof adapter !== 'object') {
    throw new Error('OpenMAS OS one-shot scheduler requires a runtime adapter.');
  }

  for (const methodName of [
    'loadJob',
    'persistJob',
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

function assertResultRecordAdapter(adapter) {
  if (typeof adapter.persistResultRecord !== 'function') {
    throw new Error('OpenMAS OS runtime adapter must implement persistResultRecord for scheduled release Result materialization.');
  }

  if (typeof adapter.loadResultRecord !== 'function') {
    throw new Error('OpenMAS OS runtime adapter must implement loadResultRecord for scheduled release Result materialization.');
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

function isDueAt(runAt, nowTimestamp) {
  return parseTimestamp(runAt, 'OpenMAS OS timer runAt')
    <= parseTimestamp(nowTimestamp, 'OpenMAS OS current time');
}

function computeDelayMs(runAt, nowTimestamp) {
  const delayMs = parseTimestamp(runAt, 'OpenMAS OS timer runAt')
    - parseTimestamp(nowTimestamp, 'OpenMAS OS current time');

  return Math.min(Math.max(0, delayMs), MAX_SET_TIMEOUT_DELAY_MS);
}

function resolveOneShotTimerId(jobId) {
  if (!isNonEmptyString(jobId)) {
    throw new Error('OpenMAS OS scheduled Job jobId must be a non-empty string.');
  }

  return `timer_${jobId.trim()}`;
}

function assertScheduledOnceJob(job) {
  if (job.trigger.type !== 'scheduled_once') {
    throw new Error(`OpenMAS OS Job ${job.jobId} must use trigger type "scheduled_once".`);
  }

  if (!SCHEDULABLE_JOB_STATUSES.has(job.status)) {
    throw new Error(`OpenMAS OS Job ${job.jobId} cannot be scheduled from status "${job.status}".`);
  }

  parseTimestamp(job.trigger.runAt, `OpenMAS OS Job ${job.jobId} trigger.runAt`);
}

async function appendLifecycleEvent({
  adapter,
  eventType,
  targetType,
  targetId,
  jobId = null,
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
    processId: null,
    threadId: null,
    occurredAt,
    payload,
  });
}

function isScheduledDelegationTimer(timer) {
  return timer?.payload?.actionType === 'schedule_delegation';
}

function buildScheduledReleaseResultId(timerId) {
  return `result_scheduled_release_${timerId}`;
}

function calculateLatenessMs(runAt, releasedAt) {
  return Math.max(
    0,
    parseTimestamp(releasedAt, 'OpenMAS OS scheduled release completedAt')
      - parseTimestamp(runAt, 'OpenMAS OS scheduled release runAt'),
  );
}

function resolveMissedRunOutcome({ timer, latenessMs }) {
  if (latenessMs === 0) {
    return 'released_on_time';
  }

  if (timer.payload?.missedRunPolicy === 'delay') {
    return 'released_late_under_delay_policy';
  }

  return 'released_late';
}

function buildScheduledReleaseResultRecord({
  timer,
  job,
  releasedAt,
  recoveryStatus = 'released_and_recorded',
}) {
  const latenessMs = calculateLatenessMs(timer.runAt, releasedAt);

  return {
    kind: OPENMAS_OS_RESULT_RECORD_KINDS.resultRecord,
    schemaVersion: OPENMAS_OS_RESULT_RECORD_SCHEMA_VERSION,
    resultId: buildScheduledReleaseResultId(timer.timerId),
    resultKind: 'scheduled_release_result',
    producer: {
      type: 'timer',
      id: timer.timerId,
      operationalIdentityId: job.assignedOperationalIdentityId,
    },
    lineage: {
      jobId: job.jobId,
      processId: null,
      threadId: null,
      parentJobId: null,
      parentProcessId: timer.payload?.parentProcessId ?? null,
      parentThreadId: timer.payload?.parentThreadId ?? null,
      systemCallId: timer.payload?.sourceSystemCallId ?? null,
      timerId: timer.timerId,
      invocationId: null,
      toolRunId: null,
      workflowRunId: null,
      conversationId: job.conversationId ?? null,
    },
    status: 'released',
    phase: 'release',
    completion: {
      startedAt: timer.runAt,
      completedAt: releasedAt,
      durationMs: latenessMs,
      exitClass: 'success',
    },
    summary: `OpenMAS OS Timer ${timer.timerId} released scheduled child Job ${job.jobId} for execution; child completion is not yet claimed.`,
    artifactRefs: [],
    toolRunRefs: [],
    workflowRunRefs: [],
    childResultRefs: [],
    warnings: [],
    failure: null,
    verification: {
      status: 'passed',
      grounded: true,
      details: {
        timerStatus: 'fired',
        releasedJobStatus: 'ready',
      },
    },
    visibility: {
      safeForHumanSummary: true,
      safeForAgentContext: true,
    },
    metadata: {
      actionType: 'schedule_delegation',
      schedule: {
        timerId: timer.timerId,
        timerStatus: 'fired',
        childJobId: job.jobId,
        releasedJobStatus: 'ready',
        jobStatusAtMaterialization: job.status,
        runAt: timer.runAt,
        releasedAt,
        latenessMs,
        missedRunPolicy: timer.payload?.missedRunPolicy ?? 'delay',
        missedRunOutcome: resolveMissedRunOutcome({
          timer,
          latenessMs,
        }),
        recoveryStatus,
      },
      delivery: {
        mode: timer.payload?.deliveryMode ?? 'persist_only',
        expectedBehavior: 'child_result_persisted_after_execution',
        childCompletionProven: false,
      },
    },
    createdAt: releasedAt,
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

async function materializeScheduledReleaseResultRecord({
  adapter,
  timer,
  job,
  releasedAt,
  recoveryStatus,
}) {
  if (!isScheduledDelegationTimer(timer)) {
    return null;
  }

  const resultRecordAdapter = assertResultRecordAdapter(adapter);

  return persistResultRecordIfMissing({
    adapter: resultRecordAdapter,
    resultRecord: buildScheduledReleaseResultRecord({
      timer,
      job,
      releasedAt,
      recoveryStatus,
    }),
  });
}

async function linkTimerToScheduledReleaseResult({
  adapter,
  timer,
  releaseResultRecord,
  updatedAt,
}) {
  if (!releaseResultRecord || timer.payload?.releaseResultRef === releaseResultRecord.resultId) {
    return timer;
  }

  return adapter.persistTimer({
    ...timer,
    updatedAt,
    payload: {
      ...(timer.payload ?? {}),
      releaseResultRef: releaseResultRecord.resultId,
    },
  });
}

async function recoverUnlinkedScheduledReleaseResults({
  adapter,
  nowTimestamp,
}) {
  const firedTimers = await adapter.listTimers({ status: 'fired' });
  const recovered = [];

  for (const timer of firedTimers) {
    if (!isScheduledDelegationTimer(timer) || isNonEmptyString(timer.payload?.releaseResultRef)) {
      continue;
    }

    const job = await adapter.loadJob(timer.jobId);
    const releaseResultRecord = await materializeScheduledReleaseResultRecord({
      adapter,
      timer,
      job,
      releasedAt: timer.updatedAt ?? nowTimestamp,
      recoveryStatus: 'recovered_unlinked_release_result',
    });
    const linkedTimer = await linkTimerToScheduledReleaseResult({
      adapter,
      timer,
      releaseResultRecord,
      updatedAt: nowTimestamp,
    });

    recovered.push({
      timer: linkedTimer,
      job,
      releaseResultRecord,
    });
  }

  return recovered;
}

async function releaseOneShotTimer({
  adapter,
  timer,
  nowTimestamp,
} = {}) {
  if (timer.status !== 'scheduled') {
    return {
      released: false,
      status: timer.status,
      reason: 'timer_not_scheduled',
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

  if (job.status === 'cancelled') {
    const cancelledTimer = await adapter.persistTimer({
      ...timer,
      status: 'cancelled',
      updatedAt: nowTimestamp,
    });

    await appendLifecycleEvent({
      adapter,
      eventType: 'timer.cancelled',
      targetType: 'timer',
      targetId: cancelledTimer.timerId,
      jobId: cancelledTimer.jobId,
      occurredAt: nowTimestamp,
      payload: {
        status: cancelledTimer.status,
        reason: 'job_already_cancelled',
      },
    });

    return {
      released: false,
      status: 'cancelled',
      reason: 'job_already_cancelled',
      timer: cancelledTimer,
      job,
    };
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

  const firedTimer = await adapter.persistTimer({
    ...timer,
    status: 'fired',
    updatedAt: nowTimestamp,
  });
  const readyJob = await adapter.persistJob({
    ...job,
    status: 'ready',
    updatedAt: nowTimestamp,
  });

  await appendLifecycleEvent({
    adapter,
    eventType: 'timer.fired',
    targetType: 'timer',
    targetId: firedTimer.timerId,
    jobId: firedTimer.jobId,
    occurredAt: nowTimestamp,
    payload: {
      status: firedTimer.status,
      runAt: firedTimer.runAt,
    },
  });
  await appendLifecycleEvent({
    adapter,
    eventType: 'job.due',
    targetType: 'job',
    targetId: readyJob.jobId,
    jobId: readyJob.jobId,
    occurredAt: nowTimestamp,
    payload: {
      status: readyJob.status,
      timerId: firedTimer.timerId,
    },
  });
  const releaseResultRecord = await materializeScheduledReleaseResultRecord({
    adapter,
    timer: firedTimer,
    job: readyJob,
    releasedAt: nowTimestamp,
    recoveryStatus: 'released_and_recorded',
  });
  const linkedTimer = await linkTimerToScheduledReleaseResult({
    adapter,
    timer: firedTimer,
    releaseResultRecord,
    updatedAt: nowTimestamp,
  });

  return {
    released: true,
    status: 'ready',
    timer: linkedTimer,
    job: readyJob,
    releaseResultRecord,
  };
}

export async function scheduleOneShotJob({
  adapter = null,
  projectRootPath = null,
  osRootPath = null,
  jobId,
  now = defaultNow,
} = {}) {
  const runtimeAdapter = assertAdapter(createAdapter({ adapter, projectRootPath, osRootPath }));
  const nowFn = normalizeNow(now);
  const nowTimestamp = nowFn();
  const job = await runtimeAdapter.loadJob(jobId);

  assertScheduledOnceJob(job);

  const scheduledJob = await runtimeAdapter.persistJob({
    ...job,
    status: 'scheduled',
    updatedAt: nowTimestamp,
  });
  const timer = await runtimeAdapter.persistTimer({
    kind: LOCAL_RUNTIME_TIMER_KIND,
    schemaVersion: OPENMAS_OS_SCHEMA_VERSION,
    timerId: resolveOneShotTimerId(scheduledJob.jobId),
    jobId: scheduledJob.jobId,
    status: 'scheduled',
    runAt: scheduledJob.trigger.runAt,
    createdAt: nowTimestamp,
    updatedAt: nowTimestamp,
    payload: {
      triggerType: 'scheduled_once',
      source: 'job.trigger.runAt',
    },
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
      runAt: scheduledJob.trigger.runAt,
      timerId: timer.timerId,
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
    },
  });

  return {
    job: scheduledJob,
    timer,
  };
}

export async function cancelScheduledJob({
  adapter = null,
  projectRootPath = null,
  osRootPath = null,
  jobId,
  now = defaultNow,
} = {}) {
  const runtimeAdapter = assertAdapter(createAdapter({ adapter, projectRootPath, osRootPath }));
  const nowFn = normalizeNow(now);
  const nowTimestamp = nowFn();
  const timer = await runtimeAdapter.loadTimer(resolveOneShotTimerId(jobId));

  if (timer.status === 'fired') {
    throw new Error(`OpenMAS OS Job ${jobId} cannot be cancelled after its one-shot timer fired.`);
  }

  const job = await runtimeAdapter.loadJob(timer.jobId);

  if (!SCHEDULABLE_JOB_STATUSES.has(job.status) && job.status !== 'cancelled') {
    throw new Error(`OpenMAS OS Job ${job.jobId} cannot be cancelled from status "${job.status}".`);
  }

  const cancelledTimer = await runtimeAdapter.persistTimer({
    ...timer,
    status: 'cancelled',
    updatedAt: nowTimestamp,
  });
  const cancelledJob = await runtimeAdapter.persistJob({
    ...job,
    status: 'cancelled',
    updatedAt: nowTimestamp,
  });

  await appendLifecycleEvent({
    adapter: runtimeAdapter,
    eventType: 'timer.cancelled',
    targetType: 'timer',
    targetId: cancelledTimer.timerId,
    jobId: cancelledTimer.jobId,
    occurredAt: nowTimestamp,
    payload: {
      status: cancelledTimer.status,
    },
  });
  await appendLifecycleEvent({
    adapter: runtimeAdapter,
    eventType: 'job.cancelled',
    targetType: 'job',
    targetId: cancelledJob.jobId,
    jobId: cancelledJob.jobId,
    occurredAt: nowTimestamp,
    payload: {
      status: cancelledJob.status,
      timerId: cancelledTimer.timerId,
    },
  });

  return {
    job: cancelledJob,
    timer: cancelledTimer,
  };
}

export async function releaseDueOneShotJobs({
  adapter = null,
  projectRootPath = null,
  osRootPath = null,
  now = defaultNow,
  recoverUnlinkedReleaseResults = true,
} = {}) {
  const runtimeAdapter = assertAdapter(createAdapter({ adapter, projectRootPath, osRootPath }));
  const nowFn = normalizeNow(now);
  const nowTimestamp = nowFn();
  const recoveredReleaseResults = recoverUnlinkedReleaseResults
    ? await recoverUnlinkedScheduledReleaseResults({
      adapter: runtimeAdapter,
      nowTimestamp,
    })
    : [];
  const scheduledTimers = await runtimeAdapter.listTimers({ status: 'scheduled' });
  const results = [];

  for (const timer of scheduledTimers) {
    results.push(await releaseOneShotTimer({
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
    recoveredReleaseResults,
  };
}

export async function runDueOneShotJobsNow({
  adapter = null,
  projectRootPath,
  osRootPath = null,
  now = defaultNow,
  invocationRunner,
  invocationOptions = {},
} = {}) {
  const runtimeAdapter = assertAdapter(createAdapter({ adapter, projectRootPath, osRootPath }));
  const releaseResult = await releaseDueOneShotJobs({
    adapter: runtimeAdapter,
    now,
  });
  const executions = [];

  for (const releasedResult of releaseResult.released) {
    executions.push(await runJobNow({
      adapter: runtimeAdapter,
      projectRootPath,
      jobId: releasedResult.job.jobId,
      now,
      invocationRunner,
      invocationOptions,
    }));
  }

  return {
    releaseResult,
    executions,
  };
}

export class LocalOneShotScheduler {
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
    if (timer.status !== 'scheduled') {
      return null;
    }

    this.clearTimer(timer.timerId);

    const delayMs = computeDelayMs(timer.runAt, this.now());
    const handle = this.setTimeoutFn(async () => {
      this.handlesByTimerId.delete(timer.timerId);

      const releaseResult = await releaseDueOneShotJobs({
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
    const result = await scheduleOneShotJob({
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

  async cancelJob(jobId) {
    const result = await cancelScheduledJob({
      adapter: this.adapter,
      jobId,
      now: this.now,
    });

    this.clearTimer(result.timer.timerId);

    return result;
  }

  async restoreTimers() {
    const timers = await this.adapter.listTimers({ status: 'scheduled' });
    const armedTimers = [];
    const dueTimers = [];

    for (const timer of timers) {
      if (isDueAt(timer.runAt, this.now())) {
        dueTimers.push(timer);
      } else {
        armedTimers.push(this.armTimer(timer));
      }
    }

    let releaseResult = null;

    if (dueTimers.length > 0) {
      releaseResult = await releaseDueOneShotJobs({
        adapter: this.adapter,
        now: this.now,
      });

      if (typeof this.onDue === 'function') {
        await this.onDue(releaseResult);
      }
    }

    return {
      restored: timers.length,
      armedTimers: armedTimers.filter(Boolean),
      dueTimers,
      releaseResult,
    };
  }
}

export function createLocalOneShotScheduler(options = {}) {
  return new LocalOneShotScheduler(options);
}

export {
  MAX_SET_TIMEOUT_DELAY_MS,
  resolveOneShotTimerId,
};
