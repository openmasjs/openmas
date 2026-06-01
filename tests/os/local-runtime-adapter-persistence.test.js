import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  writeFile,
} from 'node:fs/promises';
import {
  LOCAL_RUNTIME_CONVERSATION_RUN_KIND,
  LOCAL_RUNTIME_JOB_CLAIM_LOCK_KIND,
  LOCAL_RUNTIME_TIMER_KIND,
  assertJobClaimLock,
  createLocalRuntimeAdapter,
} from '../../src/os/adapters/local-runtime-adapter.js';
import { OPENMAS_OS_KINDS } from '../../src/contracts/os/openmas-os-runtime-contract.js';
import { buildFakeOpenRouterSecretProbe } from '../helpers/fake-secret-probes.js';

const NOW = '2026-05-14T10:00:00-05:00';

async function createTemporaryProjectRoot() {
  return mkdtemp(path.join(os.tmpdir(), 'openmas-local-runtime-'));
}

async function assertFileExists(filePath) {
  await access(filePath);
}

function createJob(overrides = {}) {
  return {
    kind: OPENMAS_OS_KINDS.job,
    schemaVersion: 1,
    jobId: 'job_alfred_health_report',
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
      mode: 'probabilistic',
    },
    inputRef: {
      type: 'inline_text',
      text: 'Generate the weekly health report.',
    },
    conversationId: 'alfred-admin',
    trigger: {
      type: 'immediate',
    },
    priority: 50,
    policies: {
      requiresApproval: false,
      maxAttempts: 3,
      noOverlap: true,
      missedRunPolicy: 'skip',
    },
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function createProcess(overrides = {}) {
  return {
    kind: OPENMAS_OS_KINDS.process,
    schemaVersion: 1,
    processId: 'process_alfred_health_report_001',
    jobId: 'job_alfred_health_report',
    status: 'running',
    operationalIdentityId: 'alfred',
    activeCognitiveIdentityId: 'system-steward',
    currentThreadId: 'thread_alfred_health_report_001',
    parentProcessId: null,
    childProcessIds: [],
    conversationId: 'alfred-admin',
    memoryContextRefs: [],
    artifactRefs: [],
    credentialReferenceIds: [
      'providers.openrouter.shared.default.api_key',
    ],
    pendingApprovalRefs: [],
    warnings: [],
    createdAt: NOW,
    startedAt: NOW,
    updatedAt: NOW,
    completedAt: null,
    ...overrides,
  };
}

function createThread(overrides = {}) {
  return {
    kind: OPENMAS_OS_KINDS.thread,
    schemaVersion: 1,
    threadId: 'thread_alfred_health_report_001',
    processId: 'process_alfred_health_report_001',
    jobId: 'job_alfred_health_report',
    status: 'ready',
    threadType: 'agent_invocation',
    priority: 50,
    attempt: 1,
    waitReason: null,
    dueAt: null,
    createdAt: NOW,
    startedAt: null,
    updatedAt: NOW,
    completedAt: null,
    ...overrides,
  };
}

function createEvent(overrides = {}) {
  return {
    kind: OPENMAS_OS_KINDS.event,
    schemaVersion: 1,
    eventId: 'event_thread_completed_001',
    eventType: 'thread.completed',
    source: {
      type: 'system',
      id: 'openmas-os',
    },
    targetRef: {
      type: 'thread',
      id: 'thread_alfred_health_report_001',
    },
    jobId: 'job_alfred_health_report',
    processId: 'process_alfred_health_report_001',
    threadId: 'thread_alfred_health_report_001',
    occurredAt: NOW,
    payload: {
      resultStatus: 'completed',
      artifactRefs: [
        {
          artifactId: 'artifact_alfred_health_report_001',
        },
      ],
    },
    ...overrides,
  };
}

function createTimer(overrides = {}) {
  return {
    kind: LOCAL_RUNTIME_TIMER_KIND,
    schemaVersion: 1,
    timerId: 'timer_alfred_health_report_001',
    jobId: 'job_alfred_health_report',
    status: 'scheduled',
    runAt: '2026-05-18T08:00:00-05:00',
    createdAt: NOW,
    updatedAt: NOW,
    payload: {
      triggerType: 'scheduled_once',
    },
    ...overrides,
  };
}

function createConversationRun(overrides = {}) {
  return {
    kind: LOCAL_RUNTIME_CONVERSATION_RUN_KIND,
    schemaVersion: 1,
    conversationRunId: 'conversation_run_campaign_001',
    conversationId: 'campaign-room',
    jobId: 'job_conversation_run_campaign_001',
    processId: 'process_conversation_run_campaign_001',
    status: 'active',
    currentTurnIndex: 0,
    participants: [
      {
        operationalIdentityId: 'alfred',
        displayName: 'Alfred',
        command: 'ask',
        mode: 'deterministic',
        turnInstruction: 'Open the campaign planning conversation.',
      },
      {
        operationalIdentityId: 'maria',
        displayName: 'Maria',
        command: 'ask',
        mode: 'deterministic',
        turnInstruction: 'Add the community perspective.',
      },
    ],
    turnPolicy: {
      type: 'sequential',
      rounds: 1,
      maxRecentTurns: 6,
    },
    turns: [
      {
        turnIndex: 0,
        round: 1,
        operationalIdentityId: 'alfred',
        status: 'ready',
        childJobId: 'job_conversation_run_campaign_001_turn_001',
        childProcessId: null,
        childThreadId: null,
        conversationTurnId: null,
        invocationId: null,
        startedAt: null,
        completedAt: null,
      },
      {
        turnIndex: 1,
        round: 1,
        operationalIdentityId: 'maria',
        status: 'pending',
        childJobId: null,
        childProcessId: null,
        childThreadId: null,
        conversationTurnId: null,
        invocationId: null,
        startedAt: null,
        completedAt: null,
      },
    ],
    contextRefs: [
      {
        sourceType: 'conversation_session',
        conversationId: 'campaign-room',
        path: 'memory/state/conversations/campaign-room/session.json',
      },
    ],
    createdBy: {
      type: 'human',
      id: 'admin',
    },
    createdAt: NOW,
    updatedAt: NOW,
    completedAt: null,
    ...overrides,
  };
}

test('LocalRuntimeAdapter initializes the JSON persistence layout under instance/os', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const adapter = createLocalRuntimeAdapter({ projectRootPath });

  const layout = await adapter.initialize();

  assert.equal(layout.osRootPath, path.join(projectRootPath, 'instance', 'os'));
  await assertFileExists(path.join(projectRootPath, 'instance', 'os', 'jobs'));
  await assertFileExists(path.join(projectRootPath, 'instance', 'os', 'processes'));
  await assertFileExists(path.join(projectRootPath, 'instance', 'os', 'threads'));
  await assertFileExists(path.join(projectRootPath, 'instance', 'os', 'events'));
  await assertFileExists(path.join(projectRootPath, 'instance', 'os', 'timers'));
  await assertFileExists(path.join(projectRootPath, 'instance', 'os', 'conversation-runs'));
  await assertFileExists(path.join(projectRootPath, 'instance', 'os', 'job-claims'));
  await assertFileExists(path.join(projectRootPath, 'instance', 'os', 'scheduler-queues'));
});

test('LocalRuntimeAdapter persists and loads Job, Process, and Thread snapshots', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const adapter = createLocalRuntimeAdapter({ projectRootPath });

  const job = await adapter.persistJob(createJob());
  const processState = await adapter.persistProcess(createProcess());
  const thread = await adapter.persistThread(createThread());

  assert.deepEqual(await adapter.loadJob(job.jobId), job);
  assert.deepEqual(await adapter.loadProcess(processState.processId), processState);
  assert.deepEqual(await adapter.loadThread(thread.threadId), thread);

  await assertFileExists(path.join(projectRootPath, 'instance', 'os', 'jobs', `${job.jobId}.json`));
  await assertFileExists(path.join(projectRootPath, 'instance', 'os', 'processes', `${processState.processId}.json`));
  await assertFileExists(path.join(projectRootPath, 'instance', 'os', 'threads', `${thread.threadId}.json`));
});

test('LocalRuntimeAdapter retries a briefly missing mutable snapshot before reporting not found', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const adapter = createLocalRuntimeAdapter({ projectRootPath });
  const thread = createThread({
    threadId: 'thread_transient_publication_gap',
  });

  await adapter.initialize();

  const delayedPublication = new Promise((resolve, reject) => {
    setTimeout(() => {
      adapter.persistThread(thread).then(resolve, reject);
    }, 15);
  });
  const [
    loadedThread,
    persistedThread,
  ] = await Promise.all([
    adapter.loadThread(thread.threadId),
    delayedPublication,
  ]);

  assert.deepEqual(loadedThread, persistedThread);
});

test('LocalRuntimeAdapter claims a ready Job atomically across concurrent callers', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const adapter = createLocalRuntimeAdapter({ projectRootPath });
  const jobId = 'job_atomic_claim_race';

  await adapter.persistJob(createJob({ jobId }));

  const claims = await Promise.all(Array.from({ length: 12 }, (_, index) => {
    return adapter.claimReadyJob({
      jobId,
      claimedAt: `2026-05-14T10:00:${String(index).padStart(2, '0')}-05:00`,
      ownerId: `claimant_${index}`,
    });
  }));

  const claimed = claims.filter((claim) => claim.claimed);
  const refused = claims.filter((claim) => !claim.claimed);

  assert.equal(claimed.length, 1);
  assert.equal(refused.length, 11);
  assert.equal(await adapter.loadJob(jobId).then((job) => job.status), 'active');
  assert.equal(refused.every((claim) => {
    return ['job_claim_locked', 'job_not_ready'].includes(claim.reason);
  }), true);
  assert.deepEqual(
    await readdir(path.join(projectRootPath, 'instance', 'os', 'job-claims')),
    [],
  );
});

test('LocalRuntimeAdapter recovers a stale Job claim lock before claiming ready work', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const adapter = createLocalRuntimeAdapter({ projectRootPath });
  const jobId = 'job_stale_claim_recovery';

  await adapter.persistJob(createJob({ jobId }));
  await mkdir(path.join(projectRootPath, 'instance', 'os', 'job-claims'), { recursive: true });
  await writeFile(
    adapter.resolveJobClaimLockPath(jobId),
    `${JSON.stringify(assertJobClaimLock({
      kind: LOCAL_RUNTIME_JOB_CLAIM_LOCK_KIND,
      schemaVersion: 1,
      claimId: 'job_claim_stale_recovery',
      jobId,
      ownerId: 'stale_owner',
      claimedAt: '2026-05-14T10:00:00-05:00',
      staleAfterMs: 1,
    }), null, 2)}\n`,
    'utf8',
  );

  const claim = await adapter.claimReadyJob({
    jobId,
    claimedAt: '2026-05-14T10:00:01-05:00',
    ownerId: 'fresh_owner',
  });

  assert.equal(claim.claimed, true);
  assert.equal(claim.job.status, 'active');
  assert.deepEqual(
    await readdir(path.join(projectRootPath, 'instance', 'os', 'job-claims')),
    [],
  );
});

test('LocalRuntimeAdapter serializes concurrent stale Job claim recovery for one Job', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const adapter = createLocalRuntimeAdapter({ projectRootPath });
  const jobId = 'job_stale_claim_recovery_race';

  await adapter.persistJob(createJob({ jobId }));
  await mkdir(path.join(projectRootPath, 'instance', 'os', 'job-claims'), { recursive: true });
  await writeFile(
    adapter.resolveJobClaimLockPath(jobId),
    `${JSON.stringify(assertJobClaimLock({
      kind: LOCAL_RUNTIME_JOB_CLAIM_LOCK_KIND,
      schemaVersion: 1,
      claimId: 'job_claim_stale_recovery_race',
      jobId,
      ownerId: 'stale_owner',
      claimedAt: '2026-05-14T10:00:00-05:00',
      staleAfterMs: 1,
    }), null, 2)}\n`,
    'utf8',
  );

  const claims = await Promise.all(Array.from({ length: 32 }, (_, index) => {
    return adapter.claimReadyJob({
      jobId,
      claimedAt: `2026-05-14T10:00:01.${String(index).padStart(3, '0')}-05:00`,
      ownerId: `fresh_owner_${index}`,
      staleAfterMs: 1,
    });
  }));

  assert.equal(claims.filter((claim) => claim.claimed).length, 1);
  assert.equal(claims.filter((claim) => !claim.claimed).length, 31);
  assert.equal(await adapter.loadJob(jobId).then((job) => job.status), 'active');
  assert.deepEqual(
    await readdir(path.join(projectRootPath, 'instance', 'os', 'job-claims')),
    [],
  );
});

test('LocalRuntimeAdapter recovers a stale Job claim after an orphaned recovery guard', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const adapter = createLocalRuntimeAdapter({ projectRootPath });
  const jobId = 'job_orphaned_claim_recovery_guard';
  const staleLock = assertJobClaimLock({
    kind: LOCAL_RUNTIME_JOB_CLAIM_LOCK_KIND,
    schemaVersion: 1,
    claimId: 'job_claim_orphaned_recovery_target',
    jobId,
    ownerId: 'stale_owner',
    claimedAt: '2026-05-14T10:00:00-05:00',
    staleAfterMs: 1,
  });
  const orphanedGuard = assertJobClaimLock({
    kind: LOCAL_RUNTIME_JOB_CLAIM_LOCK_KIND,
    schemaVersion: 1,
    claimId: 'job_claim_orphaned_recovery_guard',
    jobId,
    ownerId: 'crashed_recovery_owner',
    claimedAt: '2026-05-14T10:00:00-05:00',
    staleAfterMs: 1,
  });

  await adapter.persistJob(createJob({ jobId }));
  await mkdir(path.join(projectRootPath, 'instance', 'os', 'job-claims'), { recursive: true });
  await writeFile(
    adapter.resolveJobClaimLockPath(jobId),
    `${JSON.stringify(staleLock, null, 2)}\n`,
    'utf8',
  );
  await writeFile(
    `${adapter.resolveJobClaimLockPath(jobId)}.recovery`,
    `${JSON.stringify(orphanedGuard, null, 2)}\n`,
    'utf8',
  );

  const claim = await adapter.claimReadyJob({
    jobId,
    claimedAt: '2026-05-14T10:01:00-05:00',
    ownerId: 'healthy_recovery_owner',
  });

  assert.equal(claim.claimed, true);
  assert.equal(claim.job.status, 'active');
  assert.deepEqual(
    await readdir(path.join(projectRootPath, 'instance', 'os', 'job-claims')),
    [],
  );
});

test('LocalRuntimeAdapter lists snapshots by status and stable id ordering', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const adapter = createLocalRuntimeAdapter({ projectRootPath });

  await adapter.persistJob(createJob({
    jobId: 'job_b_ready',
    status: 'ready',
  }));
  await adapter.persistJob(createJob({
    jobId: 'job_a_scheduled',
    status: 'scheduled',
    trigger: {
      type: 'scheduled_once',
      runAt: '2026-05-18T08:00:00-05:00',
    },
  }));
  await adapter.persistJob(createJob({
    jobId: 'job_c_ready',
    status: 'ready',
  }));

  const readyJobs = await adapter.listJobs({ status: 'ready' });

  assert.deepEqual(
    readyJobs.map((job) => job.jobId),
    [
      'job_b_ready',
      'job_c_ready',
    ],
  );

  const allJobs = await adapter.listJobs();
  assert.deepEqual(
    allJobs.map((job) => job.jobId),
    [
      'job_a_scheduled',
      'job_b_ready',
      'job_c_ready',
    ],
  );
});

test('LocalRuntimeAdapter uses reconciled scheduler queues for actionable reads without scanning history', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const adapter = createLocalRuntimeAdapter({ projectRootPath });

  await adapter.persistJob(createJob({
    jobId: 'job_queue_ready',
    status: 'ready',
  }));
  await adapter.persistProcess(createProcess({
    processId: 'process_queue_running',
    status: 'running',
  }));
  await adapter.persistTimer(createTimer({
    timerId: 'timer_queue_scheduled',
  }));

  const state = await adapter.reconcileSchedulerQueues({ reconciledAt: NOW });

  assert.deepEqual(state.counts, {
    jobs: 1,
    processes: 1,
    timers: 1,
  });

  await writeFile(
    path.join(projectRootPath, 'instance', 'os', 'jobs', 'job_archival_malformed.json'),
    '{',
    'utf8',
  );

  assert.deepEqual(
    (await adapter.listJobs({ status: 'ready' })).map((job) => job.jobId),
    ['job_queue_ready'],
  );
  assert.deepEqual(
    (await adapter.listProcesses({ status: 'running' })).map((processState) => processState.processId),
    ['process_queue_running'],
  );
  assert.deepEqual(
    (await adapter.listTimers({ status: 'scheduled' })).map((timer) => timer.timerId),
    ['timer_queue_scheduled'],
  );
  await assert.rejects(
    () => adapter.listJobs(),
    /could not be parsed as JSON/u,
  );
});

test('LocalRuntimeAdapter removes obsolete scheduler queue references and reconciles missing ones', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const adapter = createLocalRuntimeAdapter({ projectRootPath });
  const initialJob = createJob({ jobId: 'job_queue_transition' });
  const initialProcess = createProcess({
    processId: 'process_queue_transition',
    status: 'ready',
  });
  const initialTimer = createTimer({ timerId: 'timer_queue_transition' });

  await adapter.persistJob(initialJob);
  await adapter.persistProcess(initialProcess);
  await adapter.persistTimer(initialTimer);
  await adapter.reconcileSchedulerQueues({ reconciledAt: NOW });

  await adapter.persistJob({
    ...initialJob,
    status: 'active',
  });
  await adapter.persistProcess({
    ...initialProcess,
    status: 'completed',
    currentThreadId: null,
    completedAt: NOW,
  });
  await adapter.persistTimer({
    ...initialTimer,
    status: 'fired',
  });

  assert.deepEqual(await adapter.listJobs({ status: 'ready' }), []);
  assert.deepEqual(await adapter.listProcesses({ status: 'ready' }), []);
  assert.deepEqual(await adapter.listTimers({ status: 'scheduled' }), []);

  await writeFile(
    adapter.resolveSchedulerQueueReferencePath('jobs', 'ready', initialJob.jobId),
    '',
    'utf8',
  );
  assert.deepEqual(await adapter.listJobs({ status: 'ready' }), []);

  const unindexedReadyJob = createJob({ jobId: 'job_reconcile_missing_reference' });
  await writeFile(
    adapter.resolveJobSnapshotPath(unindexedReadyJob.jobId),
    `${JSON.stringify(unindexedReadyJob, null, 2)}\n`,
    'utf8',
  );

  assert.deepEqual(await adapter.listJobs({ status: 'ready' }), []);
  await adapter.reconcileSchedulerQueues({ reconciledAt: '2026-05-14T10:01:00-05:00' });
  assert.deepEqual(
    (await adapter.listJobs({ status: 'ready' })).map((job) => job.jobId),
    ['job_reconcile_missing_reference'],
  );
});

test('LocalRuntimeAdapter appends and reads safe JSONL Events', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const adapter = createLocalRuntimeAdapter({ projectRootPath });

  const firstAppend = await adapter.appendEvent(createEvent());
  await adapter.appendEvent(createEvent({
    eventId: 'event_process_completed_001',
    eventType: 'process.completed',
    targetRef: {
      type: 'process',
      id: 'process_alfred_health_report_001',
    },
  }));

  const eventLogPath = path.join(projectRootPath, 'instance', 'os', 'events', 'events_2026-05-14.jsonl');

  assert.equal(firstAppend.eventLogPath, eventLogPath);
  assert.equal((await readFile(eventLogPath, 'utf8')).trim().split(/\r?\n/u).length, 2);

  const events = await adapter.readEvents({ date: '2026-05-14' });

  assert.deepEqual(
    events.map((event) => event.eventType),
    [
      'thread.completed',
      'process.completed',
    ],
  );
});

test('LocalRuntimeAdapter persists and lists timer metadata without creating runtime timers', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const adapter = createLocalRuntimeAdapter({ projectRootPath });

  const timer = await adapter.persistTimer(createTimer());

  assert.deepEqual(await adapter.loadTimer(timer.timerId), timer);
  assert.deepEqual(await adapter.listTimers({ status: 'scheduled' }), [timer]);
});

test('LocalRuntimeAdapter persists and lists multi-agent conversation run snapshots', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const adapter = createLocalRuntimeAdapter({ projectRootPath });

  const conversationRun = await adapter.persistConversationRun(createConversationRun());

  assert.deepEqual(await adapter.loadConversationRun(conversationRun.conversationRunId), conversationRun);
  assert.deepEqual(await adapter.listConversationRuns({ status: 'active' }), [conversationRun]);
  await assertFileExists(path.join(
    projectRootPath,
    'instance',
    'os',
    'conversation-runs',
    `${conversationRun.conversationRunId}.json`,
  ));
});

test('LocalRuntimeAdapter rejects persisted conversation participants with Cognitive Identity selectors', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const adapter = createLocalRuntimeAdapter({ projectRootPath });

  await assert.rejects(
    () => adapter.persistConversationRun(createConversationRun({
      participants: [
        {
          operationalIdentityId: 'alfred',
          agentId: 'system-steward',
          displayName: 'Alfred',
          command: 'ask',
          mode: 'deterministic',
        },
      ],
    })),
    /must not include agentId/u,
  );
});

test('LocalRuntimeAdapter rejects unsafe ids before resolving snapshot paths', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const adapter = createLocalRuntimeAdapter({ projectRootPath });

  assert.throws(
    () => adapter.resolveJobSnapshotPath('../unsafe'),
    /unsafe characters/u,
  );

  await assert.rejects(
    () => adapter.loadProcess('..\\unsafe'),
    /unsafe characters/u,
  );
});

test('LocalRuntimeAdapter reports invalid persisted JSON clearly', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const adapter = createLocalRuntimeAdapter({ projectRootPath });

  await mkdir(path.join(projectRootPath, 'instance', 'os', 'jobs'), { recursive: true });
  await writeFile(
    path.join(projectRootPath, 'instance', 'os', 'jobs', 'job_broken.json'),
    '{',
    'utf8',
  );

  await assert.rejects(
    () => adapter.loadJob('job_broken'),
    /could not be parsed as JSON/u,
  );
});

test('LocalRuntimeAdapter rejects raw secrets in snapshots, events, and timers', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const adapter = createLocalRuntimeAdapter({ projectRootPath });

  await assert.rejects(
    () => adapter.persistJob(createJob({
      inputRef: {
        type: 'inline_text',
        text: `Use ${buildFakeOpenRouterSecretProbe('secretvalue')} in this runtime state.`,
      },
    })),
    /secret-like value/u,
  );

  await assert.rejects(
    () => adapter.appendEvent(createEvent({
      payload: {
        accessToken: 'Bearer verysecretaccesstoken',
      },
    })),
    /raw secret-like field/u,
  );

  await assert.rejects(
    () => adapter.persistTimer(createTimer({
      payload: {
        apiKey: buildFakeOpenRouterSecretProbe('secretvalue'),
      },
    })),
    /raw secret-like field/u,
  );

  await assert.rejects(
    () => adapter.persistConversationRun(createConversationRun({
      contextRefs: [
        {
          apiKey: buildFakeOpenRouterSecretProbe('secretvalue'),
        },
      ],
    })),
    /raw secret-like field/u,
  );
});

test('LocalRuntimeAdapter does not leave temporary atomic-write files behind', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const adapter = createLocalRuntimeAdapter({ projectRootPath });

  await adapter.persistJob(createJob());

  const jobDirectoryEntries = await readdir(path.join(projectRootPath, 'instance', 'os', 'jobs'));

  assert.deepEqual(jobDirectoryEntries, ['job_alfred_health_report.json']);
});
