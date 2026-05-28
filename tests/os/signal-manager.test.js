import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { createLocalRuntimeAdapter } from '../../src/os/adapters/local-runtime-adapter.js';
import { runJobNow } from '../../src/os/manual-job-execution.js';
import { runSchedulerTick } from '../../src/os/scheduler/local-scheduler-dispatcher.js';
import {
  releaseDueOneShotJobs,
  scheduleOneShotJob,
} from '../../src/os/scheduler/one-shot-scheduled-jobs.js';
import {
  applySignal,
  createOpenMasOsSignal,
} from '../../src/os/signals/signal-manager.js';
import { OPENMAS_OS_KINDS } from '../../src/contracts/openmas-os-runtime-contract.js';

const CREATED_AT = '2026-05-14T10:00:00-05:00';
const SIGNALED_AT = '2026-05-14T10:01:00-05:00';
const DUE_AT = '2026-05-14T10:05:00-05:00';
const FINISHED_AT = '2026-05-14T10:06:00-05:00';

async function createTemporaryProjectRoot() {
  return mkdtemp(path.join(os.tmpdir(), 'openmas-signal-manager-'));
}

function createClock(values) {
  const timestamps = [...values];

  return () => {
    if (timestamps.length === 0) {
      return values[values.length - 1];
    }

    return timestamps.shift();
  };
}

function createJob(overrides = {}) {
  return {
    kind: OPENMAS_OS_KINDS.job,
    schemaVersion: 1,
    jobId: 'job_signal_target',
    projectId: 'project_marketing',
    status: 'ready',
    createdBy: {
      type: 'human',
      id: 'admin',
    },
    assignedOperationalIdentityId: 'alfred',
    program: {
      type: 'agent_invocation',
      command: 'ask',
      mode: 'deterministic',
    },
    inputRef: {
      type: 'inline_text',
      text: 'Run the signaled job.',
    },
    conversationId: null,
    trigger: {
      type: 'immediate',
    },
    priority: 50,
    policies: {
      requiresApproval: false,
      maxAttempts: 1,
      noOverlap: false,
    },
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ...overrides,
  };
}

function createScheduledJob(overrides = {}) {
  return createJob({
    jobId: 'job_scheduled_signal_target',
    status: 'draft',
    trigger: {
      type: 'scheduled_once',
      runAt: DUE_AT,
    },
    ...overrides,
  });
}

function createProcess(overrides = {}) {
  return {
    kind: OPENMAS_OS_KINDS.process,
    schemaVersion: 1,
    processId: 'process_signal_target',
    jobId: 'job_signal_target',
    status: 'ready',
    operationalIdentityId: 'alfred',
    activeCognitiveIdentityId: 'system-steward',
    currentThreadId: 'thread_signal_target',
    parentProcessId: null,
    childProcessIds: [],
    conversationId: null,
    memoryContextRefs: [],
    artifactRefs: [],
    secretReferenceIds: [],
    pendingApprovalRefs: [],
    warnings: [],
    createdAt: CREATED_AT,
    startedAt: null,
    updatedAt: CREATED_AT,
    completedAt: null,
    ...overrides,
  };
}

function createThread(overrides = {}) {
  return {
    kind: OPENMAS_OS_KINDS.thread,
    schemaVersion: 1,
    threadId: 'thread_signal_target',
    processId: 'process_signal_target',
    jobId: 'job_signal_target',
    status: 'ready',
    threadType: 'agent_invocation',
    priority: 50,
    attempt: 1,
    waitReason: null,
    dueAt: null,
    createdAt: CREATED_AT,
    startedAt: null,
    updatedAt: CREATED_AT,
    completedAt: null,
    ...overrides,
  };
}

function createSignal(overrides = {}) {
  return createOpenMasOsSignal({
    signalId: 'signal_test_001',
    signalType: 'cancel',
    targetType: 'job',
    targetId: 'job_signal_target',
    createdBy: {
      type: 'human',
      id: 'admin',
    },
    createdAt: SIGNALED_AT,
    reason: 'operator_request',
    payload: {},
    ...overrides,
  });
}

test('applySignal cancels a ready Job and appends Signal audit Events', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const adapter = createLocalRuntimeAdapter({ projectRootPath });

  await adapter.persistJob(createJob());

  const result = await applySignal({
    adapter,
    signal: createSignal(),
    now: () => SIGNALED_AT,
  });

  assert.equal(result.applied, true);
  assert.equal(result.status, 'cancelled');
  assert.equal(result.job.status, 'cancelled');
  assert.equal((await adapter.loadJob('job_signal_target')).status, 'cancelled');

  const events = await adapter.readEvents({ date: '2026-05-14' });

  assert.deepEqual(
    events.map((event) => event.eventType),
    [
      'signal.received',
      'job.cancelled',
      'signal.applied',
    ],
  );
});

test('applySignal cancels a one-shot scheduled Job and its timer before it runs', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const adapter = createLocalRuntimeAdapter({ projectRootPath });

  await adapter.persistJob(createScheduledJob());
  await scheduleOneShotJob({
    adapter,
    jobId: 'job_scheduled_signal_target',
    now: () => CREATED_AT,
  });

  const result = await applySignal({
    adapter,
    signal: createSignal({
      signalId: 'signal_cancel_scheduled_job',
      targetId: 'job_scheduled_signal_target',
    }),
    now: () => SIGNALED_AT,
  });

  assert.equal(result.applied, true);
  assert.equal(result.job.status, 'cancelled');
  assert.equal(result.timer.status, 'cancelled');
  assert.equal((await adapter.loadTimer('timer_job_scheduled_signal_target')).status, 'cancelled');

  const releaseResult = await releaseDueOneShotJobs({
    adapter,
    now: () => DUE_AT,
  });

  assert.deepEqual(releaseResult.results, []);
  assert.equal((await adapter.loadJob('job_scheduled_signal_target')).status, 'cancelled');
});

test('a paused ready Job does not create a Process through manual execution', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const adapter = createLocalRuntimeAdapter({ projectRootPath });
  let invocationRan = false;

  await adapter.persistJob(createJob({
    jobId: 'job_paused_before_run',
  }));

  const result = await applySignal({
    adapter,
    signal: createSignal({
      signalId: 'signal_pause_ready_job',
      signalType: 'pause',
      targetId: 'job_paused_before_run',
    }),
    now: () => SIGNALED_AT,
  });

  assert.equal(result.applied, true);
  assert.equal(result.job.status, 'paused');

  await assert.rejects(
    () => runJobNow({
      adapter,
      projectRootPath,
      jobId: 'job_paused_before_run',
      invocationRunner: async () => {
        invocationRan = true;

        return {
          invocationId: 'invocation_should_not_run',
          status: 'completed',
          message: 'Unexpected.',
          warnings: [],
          errors: [],
          persistence: null,
        };
      },
    }),
    /must be ready/u,
  );

  assert.equal(invocationRan, false);
  assert.deepEqual(await adapter.listProcesses(), []);
});

test('a suspended Process prevents ready Thread dispatch until resumed', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const adapter = createLocalRuntimeAdapter({ projectRootPath });
  const executedThreadIds = [];

  await adapter.persistJob(createJob());
  await adapter.persistProcess(createProcess());
  await adapter.persistThread(createThread());

  const pauseResult = await applySignal({
    adapter,
    signal: createSignal({
      signalId: 'signal_pause_process',
      signalType: 'pause',
      targetType: 'process',
      targetId: 'process_signal_target',
    }),
    now: () => SIGNALED_AT,
  });

  assert.equal(pauseResult.applied, true);
  assert.equal(pauseResult.process.status, 'suspended');

  const pausedTick = await runSchedulerTick({
    adapter,
    now: () => FINISHED_AT,
    executor: async ({ thread }) => {
      executedThreadIds.push(thread.threadId);

      return {
        status: 'completed',
      };
    },
  });

  assert.equal(pausedTick.dispatched, false);
  assert.equal(pausedTick.status, 'process_suspended');
  assert.deepEqual(executedThreadIds, []);
  assert.equal((await adapter.loadThread('thread_signal_target')).status, 'ready');

  const resumeResult = await applySignal({
    adapter,
    signal: createSignal({
      signalId: 'signal_resume_process',
      signalType: 'resume',
      targetType: 'process',
      targetId: 'process_signal_target',
    }),
    now: () => FINISHED_AT,
  });

  assert.equal(resumeResult.applied, true);
  assert.equal(resumeResult.process.status, 'ready');

  const resumedTick = await runSchedulerTick({
    adapter,
    now: createClock([FINISHED_AT, FINISHED_AT]),
    executor: async ({ thread }) => {
      executedThreadIds.push(thread.threadId);

      return {
        status: 'completed',
      };
    },
  });

  assert.equal(resumedTick.dispatched, true);
  assert.equal(resumedTick.status, 'completed');
  assert.deepEqual(executedThreadIds, ['thread_signal_target']);
});

test('approval_granted wakes a blocked Thread and marks the owning Process ready', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const adapter = createLocalRuntimeAdapter({ projectRootPath });

  await adapter.persistJob(createJob({
    status: 'active',
  }));
  await adapter.persistProcess(createProcess({
    status: 'blocked',
  }));
  await adapter.persistThread(createThread({
    status: 'blocked',
    waitReason: 'approval_required',
  }));

  const result = await applySignal({
    adapter,
    signal: createSignal({
      signalId: 'signal_approval_granted',
      signalType: 'approval_granted',
      targetType: 'thread',
      targetId: 'thread_signal_target',
    }),
    now: () => SIGNALED_AT,
  });

  assert.equal(result.applied, true);
  assert.equal(result.thread.status, 'ready');
  assert.equal(result.thread.waitReason, null);
  assert.equal(result.process.status, 'ready');

  assert.equal((await adapter.loadThread('thread_signal_target')).status, 'ready');
  assert.equal((await adapter.loadProcess('process_signal_target')).status, 'ready');

  const events = await adapter.readEvents({ date: '2026-05-14' });

  assert.deepEqual(
    events.map((event) => event.eventType),
    [
      'signal.received',
      'process.ready',
      'thread.ready',
      'signal.applied',
    ],
  );
});

test('approval_rejected fails a blocked Thread and its owning Process', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const adapter = createLocalRuntimeAdapter({ projectRootPath });

  await adapter.persistJob(createJob({
    status: 'active',
  }));
  await adapter.persistProcess(createProcess({
    status: 'blocked',
  }));
  await adapter.persistThread(createThread({
    status: 'blocked',
    waitReason: 'approval_required',
  }));

  const result = await applySignal({
    adapter,
    signal: createSignal({
      signalId: 'signal_approval_rejected',
      signalType: 'approval_rejected',
      targetType: 'thread',
      targetId: 'thread_signal_target',
    }),
    now: () => SIGNALED_AT,
  });

  assert.equal(result.applied, true);
  assert.equal(result.thread.status, 'failed');
  assert.equal(result.process.status, 'failed');
  assert.equal(result.process.currentThreadId, null);
  assert.equal(result.thread.failedAt, SIGNALED_AT);
  assert.equal(result.process.failedAt, SIGNALED_AT);
  assert.equal(result.thread.failureSummary.reasonCode, 'approval_rejected');
  assert.equal(result.process.failureSummary.reasonCode, 'approval_rejected');

  const events = await adapter.readEvents({ date: '2026-05-14' });
  const failureEvents = events.filter((event) => event.eventType.endsWith('.failed'));

  assert.equal(failureEvents.length, 2);
  assert.equal(failureEvents.every((event) => event.payload.failedAt === SIGNALED_AT), true);
  assert.equal(failureEvents.every((event) => event.payload.failureSummary.reasonCode === 'approval_rejected'), true);
});

test('child_completed without childProcessId is rejected without mutating waiting state', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const adapter = createLocalRuntimeAdapter({ projectRootPath });

  await adapter.persistJob(createJob({
    status: 'active',
  }));
  await adapter.persistProcess(createProcess({
    status: 'blocked',
  }));
  await adapter.persistThread(createThread({
    status: 'blocked',
    waitReason: 'waiting_for_child_process',
  }));

  const result = await applySignal({
    adapter,
    signal: createSignal({
      signalId: 'signal_child_completed_missing_child',
      signalType: 'child_completed',
      targetType: 'process',
      targetId: 'process_signal_target',
      payload: {
        parentThreadId: 'thread_signal_target',
        childStatus: 'completed',
      },
    }),
    now: () => SIGNALED_AT,
  });

  assert.equal(result.applied, false);
  assert.equal(result.status, 'rejected');
  assert.equal(result.reason, 'missing_child_process_id');

  const waitingThread = await adapter.loadThread('thread_signal_target');
  const blockedProcess = await adapter.loadProcess('process_signal_target');
  const threads = await adapter.listThreads({ processId: 'process_signal_target' });

  assert.equal(waitingThread.status, 'blocked');
  assert.equal(waitingThread.waitReason, 'waiting_for_child_process');
  assert.equal(blockedProcess.status, 'blocked');
  assert.equal(blockedProcess.currentThreadId, 'thread_signal_target');
  assert.equal(threads.length, 1);

  const events = await adapter.readEvents({ date: '2026-05-14' });

  assert.deepEqual(
    events.map((event) => event.eventType),
    [
      'signal.received',
      'signal.rejected',
    ],
  );
});

test('child_completed cannot resume a Process through another Process waiting Thread', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const adapter = createLocalRuntimeAdapter({ projectRootPath });

  await adapter.persistJob(createJob({
    status: 'active',
  }));
  await adapter.persistProcess(createProcess({
    status: 'blocked',
  }));
  await adapter.persistThread(createThread({
    status: 'blocked',
    waitReason: 'waiting_for_child_process',
  }));

  await adapter.persistJob(createJob({
    jobId: 'job_other_parent',
    status: 'active',
  }));
  await adapter.persistProcess(createProcess({
    processId: 'process_other_parent',
    jobId: 'job_other_parent',
    status: 'blocked',
    currentThreadId: 'thread_other_parent',
  }));
  await adapter.persistThread(createThread({
    threadId: 'thread_other_parent',
    processId: 'process_other_parent',
    jobId: 'job_other_parent',
    status: 'blocked',
    waitReason: 'waiting_for_child_process',
  }));

  const result = await applySignal({
    adapter,
    signal: createSignal({
      signalId: 'signal_child_completed_wrong_parent',
      signalType: 'child_completed',
      targetType: 'process',
      targetId: 'process_signal_target',
      payload: {
        parentThreadId: 'thread_other_parent',
        childProcessId: 'process_child_for_other_parent',
        childStatus: 'completed',
      },
    }),
    now: () => SIGNALED_AT,
  });

  assert.equal(result.applied, false);
  assert.equal(result.status, 'rejected');
  assert.equal(result.reason, 'parent_thread_process_mismatch');

  const targetProcess = await adapter.loadProcess('process_signal_target');
  const targetThread = await adapter.loadThread('thread_signal_target');
  const otherProcess = await adapter.loadProcess('process_other_parent');
  const otherThread = await adapter.loadThread('thread_other_parent');
  const targetThreads = await adapter.listThreads({ processId: 'process_signal_target' });

  assert.equal(targetProcess.status, 'blocked');
  assert.equal(targetProcess.currentThreadId, 'thread_signal_target');
  assert.equal(targetThread.status, 'blocked');
  assert.equal(targetThread.waitReason, 'waiting_for_child_process');
  assert.equal(otherProcess.status, 'blocked');
  assert.equal(otherProcess.currentThreadId, 'thread_other_parent');
  assert.equal(otherThread.status, 'blocked');
  assert.equal(otherThread.waitReason, 'waiting_for_child_process');
  assert.equal(targetThreads.length, 1);

  const events = await adapter.readEvents({ date: '2026-05-14' });

  assert.deepEqual(
    events.map((event) => event.eventType),
    [
      'signal.received',
      'signal.rejected',
    ],
  );
});

test('child_completed rejects unknown child Process without mutating waiting state', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const adapter = createLocalRuntimeAdapter({ projectRootPath });

  await adapter.persistJob(createJob({
    status: 'active',
  }));
  await adapter.persistProcess(createProcess({
    status: 'blocked',
  }));
  await adapter.persistThread(createThread({
    status: 'blocked',
    waitReason: 'waiting_for_child_process',
  }));

  const result = await applySignal({
    adapter,
    signal: createSignal({
      signalId: 'signal_child_completed_unknown_child',
      signalType: 'child_completed',
      targetType: 'process',
      targetId: 'process_signal_target',
      payload: {
        parentThreadId: 'thread_signal_target',
        childProcessId: 'process_missing_child',
        childStatus: 'completed',
      },
    }),
    now: () => SIGNALED_AT,
  });

  assert.equal(result.applied, false);
  assert.equal(result.status, 'rejected');
  assert.equal(result.reason, 'child_process_not_found');

  const waitingThread = await adapter.loadThread('thread_signal_target');
  const blockedProcess = await adapter.loadProcess('process_signal_target');
  const threads = await adapter.listThreads({ processId: 'process_signal_target' });

  assert.equal(waitingThread.status, 'blocked');
  assert.equal(waitingThread.waitReason, 'waiting_for_child_process');
  assert.equal(blockedProcess.status, 'blocked');
  assert.equal(blockedProcess.currentThreadId, 'thread_signal_target');
  assert.equal(threads.length, 1);
});

test('child_completed rejects a child Process that does not belong to the target parent', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const adapter = createLocalRuntimeAdapter({ projectRootPath });

  await adapter.persistJob(createJob({
    status: 'active',
  }));
  await adapter.persistProcess(createProcess({
    status: 'blocked',
  }));
  await adapter.persistThread(createThread({
    status: 'blocked',
    waitReason: 'waiting_for_child_process',
  }));

  await adapter.persistJob(createJob({
    jobId: 'job_unrelated_child',
    status: 'completed',
  }));
  await adapter.persistProcess(createProcess({
    processId: 'process_unrelated_child',
    jobId: 'job_unrelated_child',
    status: 'completed',
    currentThreadId: null,
    parentProcessId: 'process_other_parent',
    completedAt: FINISHED_AT,
  }));

  const result = await applySignal({
    adapter,
    signal: createSignal({
      signalId: 'signal_child_completed_unrelated_child',
      signalType: 'child_completed',
      targetType: 'process',
      targetId: 'process_signal_target',
      payload: {
        parentThreadId: 'thread_signal_target',
        childProcessId: 'process_unrelated_child',
        childStatus: 'completed',
      },
    }),
    now: () => SIGNALED_AT,
  });

  assert.equal(result.applied, false);
  assert.equal(result.status, 'rejected');
  assert.equal(result.reason, 'child_process_parent_mismatch');

  assert.equal((await adapter.loadThread('thread_signal_target')).status, 'blocked');
  assert.equal((await adapter.loadProcess('process_signal_target')).status, 'blocked');
  assert.equal((await adapter.listThreads({ processId: 'process_signal_target' })).length, 1);
});

test('child_completed rejects a failed child Process without mutating waiting state', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const adapter = createLocalRuntimeAdapter({ projectRootPath });

  await adapter.persistJob(createJob({
    status: 'active',
  }));
  await adapter.persistProcess(createProcess({
    status: 'blocked',
  }));
  await adapter.persistThread(createThread({
    status: 'blocked',
    waitReason: 'waiting_for_child_process',
  }));

  await adapter.persistJob(createJob({
    jobId: 'job_child_failed',
    status: 'failed',
  }));
  await adapter.persistProcess(createProcess({
    processId: 'process_child_failed',
    jobId: 'job_child_failed',
    status: 'failed',
    currentThreadId: null,
    parentProcessId: 'process_signal_target',
    completedAt: FINISHED_AT,
  }));

  const result = await applySignal({
    adapter,
    signal: createSignal({
      signalId: 'signal_child_completed_failed_child',
      signalType: 'child_completed',
      targetType: 'process',
      targetId: 'process_signal_target',
      payload: {
        parentThreadId: 'thread_signal_target',
        childProcessId: 'process_child_failed',
        childStatus: 'completed',
      },
    }),
    now: () => SIGNALED_AT,
  });

  assert.equal(result.applied, false);
  assert.equal(result.status, 'rejected');
  assert.equal(result.reason, 'child_process_status_mismatch');
  assert.equal((await adapter.loadThread('thread_signal_target')).status, 'blocked');
  assert.equal((await adapter.loadProcess('process_signal_target')).status, 'blocked');
  assert.equal((await adapter.listThreads({ processId: 'process_signal_target' })).length, 1);
});

test('child_completed resumes the waiting parent only for its own terminal child Process', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const adapter = createLocalRuntimeAdapter({ projectRootPath });

  await adapter.persistJob(createJob({
    status: 'active',
  }));
  await adapter.persistProcess(createProcess({
    status: 'blocked',
  }));
  await adapter.persistThread(createThread({
    status: 'blocked',
    waitReason: 'waiting_for_child_process',
  }));

  await adapter.persistJob(createJob({
    jobId: 'job_child_completed',
    status: 'completed',
  }));
  await adapter.persistProcess(createProcess({
    processId: 'process_child_completed',
    jobId: 'job_child_completed',
    status: 'completed',
    currentThreadId: null,
    parentProcessId: 'process_signal_target',
    completedAt: FINISHED_AT,
  }));

  const result = await applySignal({
    adapter,
    signal: createSignal({
      signalId: 'signal_child_completed_valid',
      signalType: 'child_completed',
      targetType: 'process',
      targetId: 'process_signal_target',
      payload: {
        parentThreadId: 'thread_signal_target',
        childProcessId: 'process_child_completed',
        childStatus: 'completed',
        childResultRef: 'result_delegated_child_process_child_completed',
      },
    }),
    now: () => SIGNALED_AT,
  });

  assert.equal(result.applied, true);
  assert.equal(result.status, 'ready');
  assert.equal(result.completedWaitThread.status, 'completed');
  assert.equal(result.continuationThread.status, 'ready');
  assert.equal(result.process.status, 'ready');
  assert.equal(result.process.currentThreadId, result.continuationThread.threadId);
  assert.deepEqual(result.process.childProcessIds, ['process_child_completed']);

  const events = await adapter.readEvents({ date: '2026-05-14' });

  assert.deepEqual(
    events.map((event) => event.eventType),
    [
      'signal.received',
      'thread.completed',
      'thread.created',
      'process.ready',
      'signal.applied',
    ],
  );
  assert.equal(events[0].payload.childResultRef, 'result_delegated_child_process_child_completed');
  assert.equal(events[1].payload.childResultRef, 'result_delegated_child_process_child_completed');
  assert.equal(events[2].payload.childResultRef, 'result_delegated_child_process_child_completed');
  assert.equal(events[3].payload.childResultRef, 'result_delegated_child_process_child_completed');
  assert.equal(events[4].payload.childResultRef, 'result_delegated_child_process_child_completed');
});

test('child_failed resumes the waiting parent only for its own failed child Process', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const adapter = createLocalRuntimeAdapter({ projectRootPath });

  await adapter.persistJob(createJob({
    status: 'active',
  }));
  await adapter.persistProcess(createProcess({
    status: 'blocked',
  }));
  await adapter.persistThread(createThread({
    status: 'blocked',
    waitReason: 'waiting_for_child_process',
  }));

  await adapter.persistJob(createJob({
    jobId: 'job_child_failed',
    status: 'failed',
  }));
  await adapter.persistProcess(createProcess({
    processId: 'process_child_failed',
    jobId: 'job_child_failed',
    status: 'failed',
    currentThreadId: null,
    parentProcessId: 'process_signal_target',
    completedAt: FINISHED_AT,
  }));

  const result = await applySignal({
    adapter,
    signal: createSignal({
      signalId: 'signal_child_failed_valid',
      signalType: 'child_failed',
      targetType: 'process',
      targetId: 'process_signal_target',
      payload: {
        parentThreadId: 'thread_signal_target',
        childProcessId: 'process_child_failed',
        childStatus: 'failed',
      },
    }),
    now: () => SIGNALED_AT,
  });

  assert.equal(result.applied, true);
  assert.equal(result.status, 'ready');
  assert.equal(result.completedWaitThread.status, 'completed');
  assert.equal(result.continuationThread.status, 'ready');
  assert.equal(result.process.status, 'ready');
  assert.deepEqual(result.process.childProcessIds, ['process_child_failed']);
});

test('invalid Signal targets fail safely with rejected Signal audit evidence', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const adapter = createLocalRuntimeAdapter({ projectRootPath });

  const result = await applySignal({
    adapter,
    signal: createSignal({
      signalId: 'signal_missing_job',
      targetId: 'job_missing',
    }),
    now: () => SIGNALED_AT,
  });

  assert.equal(result.applied, false);
  assert.equal(result.status, 'rejected');
  assert.match(result.reason, /was not found/u);

  const events = await adapter.readEvents({ date: '2026-05-14' });

  assert.deepEqual(
    events.map((event) => event.eventType),
    [
      'signal.received',
      'signal.rejected',
    ],
  );
});
