import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  mkdir,
  readFile,
  readdir,
  writeFile,
} from 'node:fs/promises';
import { OPENMAS_OS_KINDS } from '../../src/contracts/openmas-os-runtime-contract.js';
import { createLocalRuntimeAdapter } from '../../src/os/adapters/local-runtime-adapter.js';
import { executeMasOsScheduleDelegation } from '../../src/os/actions/mas-os-schedule-delegation-runtime.js';
import { runOpenMasOsServiceTick } from '../../src/os/service/local-os-service.js';
import { createAlfredProbabilisticProjectFixture } from '../helpers/create-alfred-probabilistic-fixture.js';

const CREATED_AT = '2026-05-15T09:00:00-05:00';
const SCHEDULED_AT = '2026-05-15T09:05:00-05:00';
const RUN_AT = '2026-05-15T18:00:00-05:00';
const FIRST_TICK_AT = '2026-05-15T18:01:00-05:00';
const SECOND_TICK_AT = '2026-05-15T18:02:00-05:00';
const CONVERSATION_ID = 'os-m2-scheduled-delegation-service-integration';

function createDelegationPolicy() {
  return {
    kind: 'openmas_delegation_policy',
    version: 1,
    defaultEffect: 'deny',
    rules: [
      {
        ruleId: 'allow-alfred-to-bruce-deterministic-scheduled-inspect',
        effect: 'allow',
        fromOperationalIdentityId: 'alfred',
        toOperationalIdentityId: 'bruce',
        actionTypes: ['delegate', 'schedule_delegation'],
        commands: ['inspect'],
        modes: ['deterministic'],
      },
    ],
  };
}

function createParentJob(overrides = {}) {
  return {
    kind: OPENMAS_OS_KINDS.job,
    schemaVersion: 1,
    jobId: 'job_parent_alfred_scheduled_smoke',
    projectId: 'project_openmas',
    status: 'active',
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
      text: 'Schedule Bruce to inspect the MAS.',
    },
    conversationId: CONVERSATION_ID,
    trigger: {
      type: 'manual',
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

function createParentProcess(overrides = {}) {
  return {
    kind: OPENMAS_OS_KINDS.process,
    schemaVersion: 1,
    processId: 'process_parent_alfred_scheduled_smoke',
    jobId: 'job_parent_alfred_scheduled_smoke',
    status: 'running',
    operationalIdentityId: 'alfred',
    activeCognitiveIdentityId: 'system-steward',
    currentThreadId: 'thread_parent_alfred_scheduled_smoke',
    parentProcessId: null,
    childProcessIds: [],
    conversationId: CONVERSATION_ID,
    memoryContextRefs: [],
    artifactRefs: [],
    credentialReferenceIds: [],
    pendingApprovalRefs: [],
    warnings: [],
    createdAt: CREATED_AT,
    startedAt: CREATED_AT,
    updatedAt: CREATED_AT,
    completedAt: null,
    ...overrides,
  };
}

function createParentThread(overrides = {}) {
  return {
    kind: OPENMAS_OS_KINDS.thread,
    schemaVersion: 1,
    threadId: 'thread_parent_alfred_scheduled_smoke',
    processId: 'process_parent_alfred_scheduled_smoke',
    jobId: 'job_parent_alfred_scheduled_smoke',
    status: 'running',
    threadType: 'agent_invocation',
    priority: 50,
    attempt: 1,
    waitReason: null,
    dueAt: null,
    createdAt: CREATED_AT,
    startedAt: CREATED_AT,
    updatedAt: CREATED_AT,
    completedAt: null,
    ...overrides,
  };
}

function createScheduleDelegationInput(overrides = {}) {
  return {
    targetOperationalIdentityId: 'bruce',
    task: 'Bruce, run a deterministic MAS inspection and report findings.',
    runAt: RUN_AT,
    missedRunPolicy: 'delay',
    command: 'inspect',
    mode: 'deterministic',
    conversationId: CONVERSATION_ID,
    parentContext: {
      jobId: 'job_parent_alfred_scheduled_smoke',
      processId: 'process_parent_alfred_scheduled_smoke',
      threadId: 'thread_parent_alfred_scheduled_smoke',
    },
    contextRefs: [
      {
        sourceType: 'conversation_session',
        conversationId: CONVERSATION_ID,
        path: `memory/state/conversations/${CONVERSATION_ID}/session.json`,
      },
    ],
    ...overrides,
  };
}

async function writeBruceOperationalIdentity(projectRootPath) {
  const registryPath = path.join(projectRootPath, 'instance', 'registries', 'operational-identities.json');
  const registry = JSON.parse(await readFile(registryPath, 'utf8'));

  registry.operationalIdentities.push({
    operationalIdentityId: 'bruce',
    rootPath: 'bruce',
    category: 'platform',
  });

  await writeFile(registryPath, `${JSON.stringify(registry, null, 2)}\n`, 'utf8');

  const bruceRootPath = path.join(projectRootPath, 'instance', 'operational-identities', 'bruce');

  await mkdir(bruceRootPath, { recursive: true });
  await writeFile(
    path.join(bruceRootPath, 'identity.json'),
    `${JSON.stringify({
      kind: 'operational_identity_definition',
      version: 1,
      operationalIdentityId: 'bruce',
      displayName: 'Bruce',
      lifecycleState: 'active',
      auditActorId: 'system-steward.ops.bruce.v1',
      attachedCognitiveIdentities: [
        {
          cognitiveIdentityId: 'system-steward',
        },
      ],
      executionProfileId: 'bruce-default',
      persona: {
        tone: 'precise',
        presentationStyle: 'direct and evidence-first',
      },
    }, null, 2)}\n`,
    'utf8',
  );
  await writeFile(
    path.join(bruceRootPath, 'execution-profile.json'),
    `${JSON.stringify({
      kind: 'execution_profile_definition',
      version: 1,
      executionProfileId: 'bruce-default',
      executionMode: 'deterministic',
      primaryBrain: {
        brainId: 'openrouter-primary',
        providerId: 'openrouter-api',
        modelId: 'openrouter/free',
      },
      fallbackBrain: {
        brainId: 'gemini-fallback',
        providerId: 'gemini-api',
        modelId: 'gemini-flash-latest',
      },
      enabledCommands: [
        'hello',
        'inspect',
        'status',
      ],
    }, null, 2)}\n`,
    'utf8',
  );
}

async function writeDelegationPolicy(projectRootPath) {
  const policyRootPath = path.join(projectRootPath, 'instance', 'registries');

  await mkdir(policyRootPath, { recursive: true });
  await writeFile(
    path.join(policyRootPath, 'delegation-policy.json'),
    `${JSON.stringify(createDelegationPolicy(), null, 2)}\n`,
    'utf8',
  );
}

async function createScheduledDelegationSmokeFixture() {
  const projectRootPath = await createAlfredProbabilisticProjectFixture({
    executionMode: 'deterministic',
  });
  const adapter = createLocalRuntimeAdapter({ projectRootPath });

  await writeBruceOperationalIdentity(projectRootPath);
  await writeDelegationPolicy(projectRootPath);
  await adapter.persistJob(createParentJob());
  await adapter.persistProcess(createParentProcess());
  await adapter.persistThread(createParentThread());

  return {
    projectRootPath,
    adapter,
  };
}

async function scheduleBruceInspection({
  projectRootPath,
  invocationId = 'invocation_schedule_bruce_inspection_smoke_001',
  inputOverrides = {},
  now = () => SCHEDULED_AT,
}) {
  const systemCallId = inputOverrides.systemCallId ?? `syscall_${invocationId}`;
  const requestedAt = now();
  const outcome = await executeMasOsScheduleDelegation({
    input: createScheduleDelegationInput({
      expiresAt: createDefaultSystemCallExpiresAt(requestedAt),
      ...inputOverrides,
      systemCallId,
    }),
    projectRootPath,
    operationalIdentityId: 'alfred',
    invocationId,
    now: () => requestedAt,
  });

  assert.equal(outcome.status, 'succeeded');
  assert.equal(outcome.data.scheduled, false);
  return outcome;
}

function createCliDueScheduleTiming() {
  const nowMs = Date.now();

  return {
    requestedAt: new Date(nowMs - 10_000).toISOString(),
    runAt: new Date(nowMs - 5_000).toISOString(),
  };
}

function createDefaultSystemCallExpiresAt(requestedAt) {
  const requestedAtMs = Date.parse(requestedAt);
  const deterministicSmokeExpiryMs = Date.parse('2026-05-16T00:00:00-05:00');

  return new Date(Math.max(
    requestedAtMs + 30 * 60 * 1000,
    deterministicSmokeExpiryMs,
  )).toISOString();
}

function runServiceTickCli(projectRootPath) {
  const cliResult = spawnSync(
    process.execPath,
    [
      path.join(process.cwd(), 'bin', 'openmas-os-service.js'),
      '--tick',
      '--project-root',
      projectRootPath,
      '--json',
    ],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: {
        ...process.env,
        OPENMAS_ENV: 'development',
      },
    },
  );

  assert.equal(
    cliResult.status,
    0,
    `OS service CLI failed.\nstdout:\n${cliResult.stdout}\nstderr:\n${cliResult.stderr}`,
  );

  return JSON.parse(cliResult.stdout);
}

async function readAllTextUnder(directoryPath) {
  let entries;

  try {
    entries = await readdir(directoryPath, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') {
      return '';
    }

    throw error;
  }

  const parts = [];

  for (const entry of entries) {
    const entryPath = path.join(directoryPath, entry.name);

    if (entry.isDirectory()) {
      parts.push(await readAllTextUnder(entryPath));
    } else if (entry.isFile()) {
      parts.push(await readFile(entryPath, 'utf8'));
    }
  }

  return parts.join('\n');
}

test('Slice 2.9 integration: scheduled delegation runs end-to-end through the real OS service CLI tick', async () => {
  const {
    projectRootPath,
    adapter,
  } = await createScheduledDelegationSmokeFixture();
  const timing = createCliDueScheduleTiming();
  const scheduled = await scheduleBruceInspection({
    projectRootPath,
    inputOverrides: {
      runAt: timing.runAt,
    },
    now: () => timing.requestedAt,
  });
  const childJobId = `job_${scheduled.data.systemCall.systemCallId}`;
  const timerId = `timer_${childJobId}`;
  const tickResult = runServiceTickCli(projectRootPath);

  assert.equal(tickResult.status, 'completed');
  assert.equal(tickResult.systemCalls.completedCount, 1);
  assert.equal(tickResult.release.releasedCount, 1);
  assert.equal(tickResult.readyWork.candidateCount, 1);
  assert.equal(tickResult.dispatches.length, 1);
  assert.equal(tickResult.dispatches[0].dispatchType, 'scheduled_delegation');
  assert.equal(tickResult.dispatches[0].jobId, childJobId);
  assert.equal(tickResult.dispatches[0].jobStatus, 'completed');
  assert.equal(tickResult.dispatches[0].processStatus, 'completed');
  assert.equal(tickResult.dispatches[0].threadStatus, 'completed');
  assert.equal(tickResult.dispatches[0].timerId, timerId);
  assert.equal(tickResult.dispatches[0].parentNotification, null);
  assert.equal(tickResult.dispatches[0].parentCompletion.mode, 'scheduled_delegation_async');
  assert.equal(tickResult.dispatches[0].parentCompletion.status, 'not_expected');

  const childJob = await adapter.loadJob(childJobId);
  const childProcess = await adapter.loadProcess(tickResult.dispatches[0].processId);
  const childThread = await adapter.loadThread(tickResult.dispatches[0].threadId);
  const timer = await adapter.loadTimer(timerId);

  assert.equal(childJob.assignedOperationalIdentityId, 'bruce');
  assert.equal(childJob.status, 'completed');
  assert.equal(childProcess.operationalIdentityId, 'bruce');
  assert.equal(childProcess.parentProcessId, 'process_parent_alfred_scheduled_smoke');
  assert.equal(childProcess.status, 'completed');
  assert.equal(childThread.status, 'completed');
  assert.equal(timer.status, 'fired');
  assert.ok(childProcess.artifactRefs.some((artifactRef) => artifactRef.artifactKind === 'invocation_session'));
  assert.ok(childProcess.artifactRefs.some((artifactRef) => artifactRef.artifactKind === 'invocation_report'));

  const eventTypes = (await adapter.readEvents())
    .map((event) => event.eventType);

  assert.ok(eventTypes.includes('delegation.scheduled'));
  assert.ok(eventTypes.includes('os.service.tick.started'));
  assert.ok(eventTypes.includes('timer.fired'));
  assert.ok(eventTypes.includes('job.due'));
  assert.ok(eventTypes.includes('job.completed'));
  assert.equal(eventTypes.includes('signal.ignored'), false);
  assert.ok(eventTypes.includes('os.service.tick.completed'));
});

test('Slice 2.9 integration: repeated service CLI ticks are idempotent after scheduled delegation completes', async () => {
  const {
    projectRootPath,
    adapter,
  } = await createScheduledDelegationSmokeFixture();
  const timing = createCliDueScheduleTiming();
  const scheduled = await scheduleBruceInspection({
    projectRootPath,
    invocationId: 'invocation_schedule_bruce_inspection_idempotent_001',
    inputOverrides: {
      runAt: timing.runAt,
    },
    now: () => timing.requestedAt,
  });

  const firstTickResult = runServiceTickCli(projectRootPath);
  const secondTickResult = runServiceTickCli(projectRootPath);
  const childProcesses = await adapter.listProcesses({
    parentProcessId: 'process_parent_alfred_scheduled_smoke',
  });
  const childJobId = `job_${scheduled.data.systemCall.systemCallId}`;

  assert.equal(firstTickResult.status, 'completed');
  assert.equal(firstTickResult.dispatches.length, 1);
  assert.equal(secondTickResult.status, 'idle');
  assert.equal(secondTickResult.release.releasedCount, 0);
  assert.equal(secondTickResult.readyWork.candidateCount, 0);
  assert.equal(secondTickResult.dispatches.length, 0);
  assert.equal((await adapter.loadJob(childJobId)).status, 'completed');
  assert.equal(childProcesses.length, 1);
});

test('Slice 2.9 stress: many due scheduled delegations drain across multiple deterministic OS ticks', async () => {
  const {
    projectRootPath,
    adapter,
  } = await createScheduledDelegationSmokeFixture();
  const scheduledOutcomes = [];
  const invocationRequests = [];

  for (let index = 0; index < 8; index += 1) {
    scheduledOutcomes.push(await scheduleBruceInspection({
      projectRootPath,
      invocationId: `invocation_schedule_bruce_inspection_stress_${index + 1}`,
      inputOverrides: {
        task: `Bruce, run deterministic MAS inspection stress item ${index + 1}.`,
      },
    }));
  }

  const firstTickResult = await runOpenMasOsServiceTick({
    adapter,
    projectRootPath,
    now: () => FIRST_TICK_AT,
    maxDispatchedJobs: 3,
    invocationRunner: async (request) => {
      invocationRequests.push(request);

      return {
        invocationId: `invocation_bruce_stress_${invocationRequests.length}`,
        status: 'completed',
        message: `Bruce completed stress item ${invocationRequests.length}.`,
        warnings: [],
        errors: [],
        persistence: null,
      };
    },
  });

  assert.equal(firstTickResult.status, 'completed');
  assert.equal(firstTickResult.release.releasedCount, 8);
  assert.equal(firstTickResult.readyWork.candidateCount, 8);
  assert.equal(firstTickResult.readyWork.dispatchedCount, 3);
  assert.equal(firstTickResult.readyWork.deferredCount, 5);
  assert.equal(firstTickResult.dispatches.length, 3);

  const secondTickResult = await runOpenMasOsServiceTick({
    adapter,
    projectRootPath,
    now: () => SECOND_TICK_AT,
    maxDispatchedJobs: 10,
    invocationRunner: async (request) => {
      invocationRequests.push(request);

      return {
        invocationId: `invocation_bruce_stress_${invocationRequests.length}`,
        status: 'completed',
        message: `Bruce completed stress item ${invocationRequests.length}.`,
        warnings: [],
        errors: [],
        persistence: null,
      };
    },
  });

  assert.equal(secondTickResult.status, 'completed');
  assert.equal(secondTickResult.release.releasedCount, 0);
  assert.equal(secondTickResult.readyWork.candidateCount, 5);
  assert.equal(secondTickResult.readyWork.dispatchedCount, 5);
  assert.equal(secondTickResult.readyWork.deferredCount, 0);
  assert.equal(secondTickResult.dispatches.length, 5);
  assert.equal(invocationRequests.length, 8);
  assert.ok(invocationRequests.every((request) => request.operationalIdentityId === 'bruce'));

  for (const outcome of scheduledOutcomes) {
    const childJobId = `job_${outcome.data.systemCall.systemCallId}`;
    const timerId = `timer_${childJobId}`;

    assert.equal((await adapter.loadJob(childJobId)).status, 'completed');
    assert.equal((await adapter.loadTimer(timerId)).status, 'fired');
  }
});

test('Slice 2.9 integration: scheduled delegation OS state does not persist raw Credential Vault secret values', async () => {
  const {
    projectRootPath,
    adapter,
  } = await createScheduledDelegationSmokeFixture();
  const timing = createCliDueScheduleTiming();

  await scheduleBruceInspection({
    projectRootPath,
    invocationId: 'invocation_schedule_bruce_inspection_secret_safe_001',
    inputOverrides: {
      runAt: timing.runAt,
    },
    now: () => timing.requestedAt,
  });
  runServiceTickCli(projectRootPath);

  const serializedOsState = await readAllTextUnder(path.join(projectRootPath, 'instance', 'os'));

  assert.doesNotMatch(serializedOsState, /openrouter-secret/u);
  assert.doesNotMatch(serializedOsState, /gemini-secret/u);
  assert.doesNotMatch(serializedOsState, /secretValue/u);
  assert.equal((await adapter.listJobs({ status: 'scheduled' })).length, 0);
  assert.equal((await adapter.listTimers({ status: 'scheduled' })).length, 0);
});
