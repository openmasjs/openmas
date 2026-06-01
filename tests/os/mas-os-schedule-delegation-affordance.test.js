import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { OPENMAS_OS_KINDS } from '../../src/contracts/os/openmas-os-runtime-contract.js';
import { createLocalRuntimeAdapter } from '../../src/os/adapters/local-runtime-adapter.js';
import { executeMasOsScheduleDelegation } from '../../src/os/actions/mas-os-schedule-delegation-runtime.js';
import { createLocalSystemCallInbox } from '../../src/os/system-calls/local-system-call-inbox.js';
import { createKernelSystemCallProcessor } from '../../src/os/system-calls/system-call-processor.js';
import { releaseDueOneShotJobs } from '../../src/os/scheduler/one-shot-scheduled-jobs.js';
import { readToolDefinitions } from '../../src/tools/read-tool-definitions.js';
import { evaluateToolReadinessForInvocation } from '../../src/tools/evaluate-tool-readiness-for-invocation.js';
import { executeAcceptedBrainToolRequest } from '../../src/tools/execute-accepted-brain-tool-request.js';
import { buildAgentExecutionPlanForInvocation } from '../../src/plans/build-agent-execution-plan-for-invocation.js';
import { coordinatePlanExecutionForInvocation } from '../../src/plans/coordinate-plan-execution-for-invocation.js';

const CREATED_AT = '2026-05-15T09:00:00-05:00';
const SCHEDULED_AT = '2026-05-15T09:05:00-05:00';
const RUN_AT = '2026-05-15T18:00:00-05:00';
const FUTURE_RUN_AT = '2099-05-16T18:00:00-05:00';

function createDelegationPolicy() {
  return {
    kind: 'openmas_delegation_policy',
    version: 1,
    defaultEffect: 'deny',
    rules: [
      {
        ruleId: 'allow-alfred-to-bruce-probabilistic-ask',
        effect: 'allow',
        fromOperationalIdentityId: 'alfred',
        toOperationalIdentityId: 'bruce',
        actionTypes: ['delegate', 'schedule_delegation'],
        commands: ['ask'],
        modes: ['probabilistic'],
      },
    ],
  };
}

function createMasOsScheduleDelegationToolDefinition() {
  return {
    kind: 'tool_definition',
    version: 1,
    toolId: 'mas.os.schedule_delegation',
    displayName: 'MAS OS Schedule Delegation',
    description: 'Submits a future delegation System Call to the OpenMAS OS.',
    lifecycleState: 'active',
    owner: 'mas',
    toolType: 'local_js_module',
    sideEffectLevel: 'write_internal',
    inputSchema: {
      type: 'object',
      properties: {
        targetOperationalIdentityId: {
          type: 'string',
        },
        task: {
          type: 'string',
        },
        runAt: {
          type: 'string',
        },
        parentContext: {
          type: 'object',
        },
      },
      required: [
        'targetOperationalIdentityId',
        'task',
        'runAt',
        'parentContext',
      ],
      additionalProperties: true,
    },
    outputSchema: {
      type: 'object',
    },
    requiredResourceTypes: [],
    requiredAccessModes: [],
    requiredPermissionModes: [
      'tool.execute',
    ],
    approvalPolicy: {
      required: false,
    },
    execution: {
      modulePath: 'executor.js',
      timeoutMs: 10000,
      retryPolicy: {
        enabled: false,
      },
    },
    artifactPolicy: {
      persistResult: false,
    },
    memoryPolicy: {
      allowWritebackCandidates: false,
    },
    intentMetadata: {
      kind: 'action_intent_metadata',
      version: 1,
      primaryIntentId: 'mas.os.schedule_delegation',
      targetActionType: 'tool_execution',
      targetType: 'tool',
      targetId: 'mas.os.schedule_delegation',
      expectedSideEffectLevel: 'write_internal',
      requestTypes: [
        'tool_action',
        'handoff',
        'conversation',
        'mutation',
      ],
      semanticTags: [
        'mas',
        'os',
        'schedule',
        'scheduled-delegation',
        'operational-identity',
      ],
      whenToUse: [
        'Use when an Operational Identity needs another Operational Identity to perform a bounded child task at a future explicit time.',
      ],
      whenNotToUse: [
        'Do not use for immediate delegation or direct answers.',
      ],
      exampleRequests: [
        'Ask Bruce to inspect the MAS at 2026-05-15T18:00:00-05:00.',
      ],
      classificationGuidance: {
        highConfidenceSignals: [
          'The request names a target Operational Identity, bounded child task, and explicit future time.',
        ],
        ambiguitySignals: [],
        negativeSignals: [],
        requiredContextKeys: [
          'target-operational-identity-id',
          'task',
          'run-at',
          'parent-context.process-id',
          'parent-context.thread-id',
        ],
      },
    },
  };
}

function createParentJob(overrides = {}) {
  return {
    kind: OPENMAS_OS_KINDS.job,
    schemaVersion: 1,
    jobId: 'job_parent_alfred',
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
      text: 'Schedule work with Bruce.',
    },
    conversationId: 'os-m2-scheduled-delegation-smoke',
    trigger: {
      type: 'manual',
    },
    priority: 40,
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
    processId: 'process_parent_alfred',
    jobId: 'job_parent_alfred',
    status: 'running',
    operationalIdentityId: 'alfred',
    activeCognitiveIdentityId: 'system-steward',
    currentThreadId: 'thread_parent_alfred',
    parentProcessId: null,
    childProcessIds: [],
    conversationId: 'os-m2-scheduled-delegation-smoke',
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
    threadId: 'thread_parent_alfred',
    processId: 'process_parent_alfred',
    jobId: 'job_parent_alfred',
    status: 'running',
    threadType: 'agent_invocation',
    priority: 40,
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
    task: 'Inspect the MAS and report findings.',
    runAt: RUN_AT,
    missedRunPolicy: 'delay',
    command: 'ask',
    mode: 'probabilistic',
    conversationId: 'os-m2-scheduled-delegation-smoke',
    parentContext: {
      jobId: 'job_parent_alfred',
      processId: 'process_parent_alfred',
      threadId: 'thread_parent_alfred',
    },
    contextRefs: [
      {
        sourceType: 'conversation_session',
        conversationId: 'os-m2-scheduled-delegation-smoke',
        path: 'memory/state/conversations/os-m2-scheduled-delegation-smoke/session.json',
      },
    ],
    ...overrides,
  };
}

async function createProjectFixture() {
  const projectRootPath = await mkdtemp(path.join(os.tmpdir(), 'openmas-os-schedule-delegation-'));
  const masRootPath = path.join(projectRootPath, 'instance');
  const toolRootPath = path.join(masRootPath, 'tools', 'mas.os.schedule_delegation');
  const policyRootPath = path.join(masRootPath, 'registries');
  const adapter = createLocalRuntimeAdapter({ projectRootPath });
  const inbox = createLocalSystemCallInbox({ projectRootPath });

  await mkdir(toolRootPath, { recursive: true });
  await mkdir(policyRootPath, { recursive: true });
  await writeFile(
    path.join(policyRootPath, 'delegation-policy.json'),
    JSON.stringify(createDelegationPolicy(), null, 2),
    'utf8',
  );
  await writeFile(
    path.join(toolRootPath, 'tool.json'),
    JSON.stringify(createMasOsScheduleDelegationToolDefinition(), null, 2),
    'utf8',
  );

  const runtimeModuleUrl = pathToFileURL(
    path.join(process.cwd(), 'src', 'os', 'actions', 'mas-os-schedule-delegation-runtime.js'),
  ).href;

  await writeFile(
    path.join(toolRootPath, 'executor.js'),
    [
      `import { executeMasOsScheduleDelegation } from ${JSON.stringify(runtimeModuleUrl)};`,
      'export async function executeTool(options) {',
      '  return executeMasOsScheduleDelegation(options);',
      '}',
    ].join('\n'),
    'utf8',
  );

  await adapter.persistJob(createParentJob());
  await adapter.persistProcess(createParentProcess());
  await adapter.persistThread(createParentThread());

  return {
    projectRootPath,
    masRootPath,
    adapter,
    inbox,
  };
}

function createSystemCallProcessor({
  projectRootPath,
  adapter,
  inbox,
  now = () => SCHEDULED_AT,
} = {}) {
  return createKernelSystemCallProcessor({
    projectRootPath,
    adapter,
    inbox,
    delegationPolicy: createDelegationPolicy(),
    now,
    serviceId: 'openmas_os_service_schedule_delegation_affordance_test',
    tickId: 'os_service_tick_schedule_delegation_affordance_test',
  });
}

async function readMasOsScheduleDelegationToolDefinition() {
  return createMasOsScheduleDelegationToolDefinition();
}

function buildReadyVerdict() {
  return {
    kind: 'tool_readiness_verdict',
    version: 1,
    toolId: 'mas.os.schedule_delegation',
    status: 'ready',
    approvalRequired: false,
    reason: 'Tool mas.os.schedule_delegation passed readiness gates and can be requested for execution.',
    matchedBindings: [],
    missingRequirements: [],
    warnings: [],
  };
}

function buildAcceptedToolResolution(input = createScheduleDelegationInput()) {
  const toolRequest = {
    kind: 'brain_tool_request',
    version: 1,
    toolRequestId: 'tool-request-mas-os-schedule-delegation-001',
    toolId: 'mas.os.schedule_delegation',
    input,
    purpose: 'Schedule a child MAS task for Bruce through the OpenMAS OS.',
    expectedSideEffectLevel: 'write_internal',
  };

  return {
    kind: 'brain_tool_request_resolution',
    version: 1,
    status: 'accepted',
    requestedToolId: 'mas.os.schedule_delegation',
    toolRequest,
    toolReadinessVerdict: buildReadyVerdict(),
    executionAllowed: true,
    approvalRequired: false,
    autoExecutionPerformed: false,
    runtimeAction: 'queue_for_execution',
    reason: 'Brain tool request for mas.os.schedule_delegation was accepted for runtime execution.',
    warnings: [],
  };
}

test('mas.os.schedule_delegation is exposed as an active write_internal affordance with ready local readiness', async () => {
  const { masRootPath } = await createProjectFixture();
  const { toolDefinitions } = await readToolDefinitions({ masRootPath });
  const toolDefinition = toolDefinitions.find((definition) => definition.toolId === 'mas.os.schedule_delegation');
  const readiness = evaluateToolReadinessForInvocation({
    toolDefinitions: [toolDefinition],
    resolvedBindings: [],
    usableBindings: [],
    permissionEvaluation: null,
    secretResolution: null,
  });

  assert.ok(toolDefinition);
  assert.equal(toolDefinition.lifecycleState, 'active');
  assert.equal(toolDefinition.sideEffectLevel, 'write_internal');
  assert.equal(toolDefinition.intentMetadata.targetId, 'mas.os.schedule_delegation');
  assert.equal(readiness.evaluatedTools[0].status, 'ready');
});

test('coordinatePlanExecutionForInvocation allows governed mas.os.schedule_delegation write_internal execution', () => {
  const actionResolution = {
    status: 'accepted',
    source: 'semantic_classifier',
    executionAllowed: true,
    approvalRequired: false,
    reason: 'The runtime selected mas.os.schedule_delegation for governed scheduled delegation.',
    selectedCandidate: {
      targetType: 'tool',
      targetId: 'mas.os.schedule_delegation',
      sideEffectLevel: 'write_internal',
      reason: 'Schedule a bounded child task for Bruce.',
    },
  };
  const toolRequestResolution = buildAcceptedToolResolution();
  const executionPlan = buildAgentExecutionPlanForInvocation({
    invocationId: 'invocation-mas-os-schedule-delegation-plan-001',
    request: {
      command: 'ask',
      invocationMode: 'probabilistic',
      requestedBy: 'cli',
      inputText: 'Ask Bruce to inspect the MAS at 2026-05-15T18:00:00-05:00.',
      conversationId: 'os-m2-scheduled-delegation-smoke',
    },
    actionResolution,
    toolRequestResolution,
    semanticIntentRuntime: {
      status: 'completed',
      semanticIntentClassification: {
        actionIntent: {
          understanding: {
            requestedOutcome: 'Schedule MAS inspection for Bruce.',
            summary: 'Use the OpenMAS OS scheduled delegation affordance.',
          },
        },
      },
    },
    knownToolIds: ['mas.os.schedule_delegation'],
    knownWorkflowIds: [],
  });
  const coordination = coordinatePlanExecutionForInvocation({
    executionPlan,
    actionResolution,
    toolRequestResolution,
  });

  assert.equal(coordination.status, 'ready');
  assert.equal(coordination.runtimeAction, 'queue_tool_request');
  assert.equal(coordination.selectedTargetId, 'mas.os.schedule_delegation');
});

test('executeMasOsScheduleDelegation submits a scheduled delegation System Call without direct kernel materialization', async () => {
  const {
    projectRootPath,
    adapter,
    inbox,
  } = await createProjectFixture();
  const outcome = await executeMasOsScheduleDelegation({
    input: createScheduleDelegationInput({
      systemCallId: 'syscall_schedule_delegation_affordance_pending_001',
    }),
    projectRootPath,
    operationalIdentityId: 'alfred',
    invocationId: 'invocation-mas-os-schedule-delegation-runtime-001',
    now: () => SCHEDULED_AT,
  });
  const systemCall = await inbox.loadPendingSystemCall('syscall_schedule_delegation_affordance_pending_001');

  assert.equal(outcome.status, 'succeeded');
  assert.equal(outcome.data.scheduled, false);
  assert.equal(outcome.data.osAction.status, 'submitted');
  assert.equal(outcome.data.systemCall.systemCallId, 'syscall_schedule_delegation_affordance_pending_001');
  assert.equal(outcome.data.systemCall.operation, 'schedule_delegation');
  assert.equal(outcome.data.systemCall.status, 'pending');
  assert.equal(outcome.data.systemCall.wait.status, 'not_requested');
  assert.equal(systemCall.payload.requesterOperationalIdentityId, 'alfred');
  assert.equal(systemCall.payload.targetOperationalIdentityId, 'bruce');
  assert.equal(systemCall.payload.child.input, 'Inspect the MAS and report findings.');
  assert.equal(systemCall.payload.runAt, RUN_AT);
  assert.equal(systemCall.payload.missedRunPolicy, 'delay');
  assert.equal(systemCall.correlation.invocationId, 'invocation-mas-os-schedule-delegation-runtime-001');

  const parentProcess = await adapter.loadProcess('process_parent_alfred');
  const parentThread = await adapter.loadThread('thread_parent_alfred');
  const events = await adapter.readEvents({ date: '2026-05-15' });

  await assert.rejects(
    () => adapter.loadJob('job_syscall_schedule_delegation_affordance_pending_001'),
    /was not found/u,
  );
  await assert.rejects(
    () => adapter.loadTimer('timer_job_syscall_schedule_delegation_affordance_pending_001'),
    /was not found/u,
  );
  assert.equal(parentProcess.status, 'running');
  assert.equal(parentThread.status, 'running');
  assert.equal(parentThread.waitReason, null);
  assert.deepEqual(events, []);
});

test('executeMasOsScheduleDelegation rejects a Cognitive Identity selector before submitting a System Call', async () => {
  const { projectRootPath, inbox } = await createProjectFixture();

  await assert.rejects(
    () => executeMasOsScheduleDelegation({
      input: createScheduleDelegationInput({
        agentId: 'evaluation-audit-steward',
        systemCallId: 'syscall_schedule_delegation_invalid_cognition_selector_001',
      }),
      projectRootPath,
      operationalIdentityId: 'alfred',
      invocationId: 'invocation-mas-os-schedule-delegation-invalid-selector-001',
      now: () => SCHEDULED_AT,
    }),
    /must not include agentId/u,
  );

  await assert.rejects(
    () => inbox.loadPendingSystemCall('syscall_schedule_delegation_invalid_cognition_selector_001'),
    /was not found/u,
  );
});

test('executeMasOsScheduleDelegation rejects missing parent lineage before submitting a System Call', async () => {
  const { projectRootPath, inbox } = await createProjectFixture();

  await assert.rejects(
    () => executeMasOsScheduleDelegation({
      input: createScheduleDelegationInput({
        parentContext: {
          jobId: null,
          processId: null,
          threadId: null,
        },
        systemCallId: 'syscall_schedule_delegation_missing_parent_lineage_001',
      }),
      projectRootPath,
      operationalIdentityId: 'alfred',
      invocationId: 'invocation-mas-os-schedule-delegation-missing-parent-lineage-001',
      now: () => SCHEDULED_AT,
    }),
    /requires parentContext\.processId and parentContext\.threadId/u,
  );

  await assert.rejects(
    () => inbox.loadPendingSystemCall('syscall_schedule_delegation_missing_parent_lineage_001'),
    /was not found/u,
  );
});

test('OpenMAS OS service processes mas.os.schedule_delegation System Call into child Job and Timer', async () => {
  const {
    projectRootPath,
    adapter,
    inbox,
  } = await createProjectFixture();

  await executeMasOsScheduleDelegation({
    input: createScheduleDelegationInput({
      systemCallId: 'syscall_schedule_delegation_affordance_service_001',
    }),
    projectRootPath,
    operationalIdentityId: 'alfred',
    invocationId: 'invocation-mas-os-schedule-delegation-service-001',
    now: () => SCHEDULED_AT,
  });

  const processor = createSystemCallProcessor({
    projectRootPath,
    adapter,
    inbox,
  });
  const processorResult = await processor.processPendingSystemCalls();
  const result = await inbox.loadSystemCallResult('syscall_schedule_delegation_affordance_service_001');
  const childJob = await adapter.loadJob('job_syscall_schedule_delegation_affordance_service_001');
  const timer = await adapter.loadTimer('timer_job_syscall_schedule_delegation_affordance_service_001');
  const parentProcess = await adapter.loadProcess('process_parent_alfred');
  const parentThread = await adapter.loadThread('thread_parent_alfred');
  const events = await adapter.readEvents({ date: '2026-05-15' });

  assert.equal(processorResult.completedCount, 1);
  assert.equal(result.status, 'completed');
  assert.equal(result.decision.allowed, true);
  assert.deepEqual(result.effects.createdJobIds, ['job_syscall_schedule_delegation_affordance_service_001']);
  assert.deepEqual(result.effects.createdTimerIds, ['timer_job_syscall_schedule_delegation_affordance_service_001']);
  assert.equal(result.details.authorizationRuleId, 'allow-alfred-to-bruce-probabilistic-ask');
  assert.equal(result.details.targetOperationalIdentityId, 'bruce');
  assert.equal(result.details.runAt, RUN_AT);
  assert.equal(result.details.missedRunPolicy, 'delay');
  assert.equal(childJob.assignedOperationalIdentityId, 'bruce');
  assert.equal(childJob.status, 'scheduled');
  assert.equal(childJob.trigger.type, 'scheduled_once');
  assert.equal(childJob.trigger.runAt, RUN_AT);
  assert.equal(childJob.inputRef.text, 'Inspect the MAS and report findings.');
  assert.equal(timer.status, 'scheduled');
  assert.equal(timer.runAt, RUN_AT);
  assert.equal(timer.payload.actionType, 'schedule_delegation');
  assert.equal(timer.payload.delegationId, result.details.delegationId);
  assert.equal(timer.payload.parentProcessId, 'process_parent_alfred');
  assert.equal(timer.payload.parentThreadId, 'thread_parent_alfred');
  assert.equal(timer.payload.deliveryMode, 'persist_only');
  assert.equal(timer.payload.sourceSystemCallId, 'syscall_schedule_delegation_affordance_service_001');
  assert.equal(parentProcess.status, 'running');
  assert.equal(parentThread.status, 'running');
  assert.equal(parentThread.waitReason, null);
  assert.deepEqual(
    events.map((event) => event.eventType),
    [
      'job.scheduled',
      'timer.scheduled',
      'delegation.scheduled',
    ],
  );
});

test('executeMasOsScheduleDelegation normalizes AI-native child command and default missed-run policy', async () => {
  const {
    projectRootPath,
    adapter,
    inbox,
  } = await createProjectFixture();
  const outcome = await executeMasOsScheduleDelegation({
    input: createScheduleDelegationInput({
      command: 'mas.os.schedule_delegation',
      missedRunPolicy: undefined,
      systemCallId: 'syscall_schedule_delegation_normalized_command_001',
    }),
    projectRootPath,
    operationalIdentityId: 'alfred',
    invocationId: 'invocation-mas-os-schedule-delegation-normalized-command-001',
    now: () => SCHEDULED_AT,
  });
  const pendingSystemCall = await inbox.loadPendingSystemCall('syscall_schedule_delegation_normalized_command_001');
  const processor = createSystemCallProcessor({
    projectRootPath,
    adapter,
    inbox,
  });

  await processor.processPendingSystemCalls();

  const result = await inbox.loadSystemCallResult('syscall_schedule_delegation_normalized_command_001');
  const childJob = await adapter.loadJob(result.details.childJobId);
  const timer = await adapter.loadTimer(result.details.timerId);

  assert.equal(outcome.status, 'succeeded');
  assert.equal(outcome.data.scheduled, false);
  assert.equal(pendingSystemCall.payload.child.command, 'ask');
  assert.equal(pendingSystemCall.payload.missedRunPolicy, 'delay');
  assert.equal(result.details.missedRunPolicy, 'delay');
  assert.equal(childJob.program.command, 'ask');
  assert.equal(timer.payload.missedRunPolicy, 'delay');
});

test('executeMasOsScheduleDelegation accepts barely due schedules with delay policy for AI latency', async () => {
  const {
    projectRootPath,
    adapter,
    inbox,
  } = await createProjectFixture();
  const outcome = await executeMasOsScheduleDelegation({
    input: createScheduleDelegationInput({
      runAt: '2026-05-15T09:04:30-05:00',
      missedRunPolicy: 'delay',
      systemCallId: 'syscall_schedule_delegation_latency_grace_001',
    }),
    projectRootPath,
    operationalIdentityId: 'alfred',
    invocationId: 'invocation-mas-os-schedule-delegation-latency-grace-001',
    now: () => SCHEDULED_AT,
  });
  const processor = createSystemCallProcessor({
    projectRootPath,
    adapter,
    inbox,
  });

  await processor.processPendingSystemCalls();

  const result = await inbox.loadSystemCallResult('syscall_schedule_delegation_latency_grace_001');
  const releaseResult = await releaseDueOneShotJobs({
    adapter,
    now: () => SCHEDULED_AT,
  });

  assert.equal(outcome.status, 'succeeded');
  assert.equal(outcome.data.scheduled, false);
  assert.equal(result.details.runAt, '2026-05-15T09:04:30-05:00');
  assert.equal(result.details.missedRunPolicy, 'delay');
  assert.equal(releaseResult.released.length, 1);
  assert.equal(releaseResult.released[0].job.jobId, result.details.childJobId);
  assert.equal(releaseResult.released[0].releaseResultRecord.resultKind, 'scheduled_release_result');
  assert.equal(releaseResult.released[0].releaseResultRecord.metadata.schedule.latenessMs, 30000);
  assert.equal(
    releaseResult.released[0].releaseResultRecord.metadata.schedule.missedRunOutcome,
    'released_late_under_delay_policy',
  );
});

test('scheduled delegation due work can be released by the existing one-shot scheduler', async () => {
  const {
    projectRootPath,
    adapter,
    inbox,
  } = await createProjectFixture();
  const outcome = await executeMasOsScheduleDelegation({
    input: createScheduleDelegationInput({
      systemCallId: 'syscall_schedule_delegation_release_001',
    }),
    projectRootPath,
    operationalIdentityId: 'alfred',
    invocationId: 'invocation-mas-os-schedule-delegation-release-001',
    now: () => SCHEDULED_AT,
  });
  const processor = createSystemCallProcessor({
    projectRootPath,
    adapter,
    inbox,
  });

  await processor.processPendingSystemCalls();

  const result = await inbox.loadSystemCallResult('syscall_schedule_delegation_release_001');
  const releaseResult = await releaseDueOneShotJobs({
    adapter,
    now: () => RUN_AT,
  });

  assert.equal(outcome.status, 'succeeded');
  assert.equal(outcome.data.scheduled, false);
  assert.equal(releaseResult.released.length, 1);
  assert.equal(releaseResult.released[0].job.jobId, result.details.childJobId);
  assert.equal(releaseResult.released[0].job.status, 'ready');
  assert.equal(releaseResult.released[0].timer.status, 'fired');
  assert.equal((await adapter.loadJob(result.details.childJobId)).status, 'ready');
});

test('OpenMAS OS service blocks past schedules and denies unknown scheduled delegation without scheduled state', async () => {
  const {
    projectRootPath,
    adapter,
    inbox,
  } = await createProjectFixture();
  const pastOutcome = await executeMasOsScheduleDelegation({
    input: createScheduleDelegationInput({
      runAt: '2026-05-15T09:00:00-05:00',
      systemCallId: 'syscall_schedule_delegation_past_001',
    }),
    projectRootPath,
    operationalIdentityId: 'alfred',
    invocationId: 'invocation-mas-os-schedule-delegation-past-001',
    now: () => SCHEDULED_AT,
  });
  const deniedOutcome = await executeMasOsScheduleDelegation({
    input: createScheduleDelegationInput({
      targetOperationalIdentityId: 'maria',
      systemCallId: 'syscall_schedule_delegation_denied_001',
    }),
    projectRootPath,
    operationalIdentityId: 'alfred',
    invocationId: 'invocation-mas-os-schedule-delegation-denied-001',
    now: () => SCHEDULED_AT,
  });
  const processor = createSystemCallProcessor({
    projectRootPath,
    adapter,
    inbox,
  });
  const processorResult = await processor.processPendingSystemCalls();
  const pastResult = await inbox.loadSystemCallResult('syscall_schedule_delegation_past_001');
  const deniedResult = await inbox.loadSystemCallResult('syscall_schedule_delegation_denied_001');

  assert.equal(pastOutcome.status, 'succeeded');
  assert.equal(pastOutcome.data.scheduled, false);
  assert.equal(pastOutcome.data.systemCall.status, 'pending');
  assert.equal(deniedOutcome.status, 'succeeded');
  assert.equal(deniedOutcome.data.scheduled, false);
  assert.equal(deniedOutcome.data.systemCall.status, 'pending');
  assert.equal(processorResult.deniedCount, 2);
  assert.equal(pastResult.status, 'denied');
  assert.equal(pastResult.details.reasonCode, 'scheduled_time_not_future');
  assert.equal(deniedResult.status, 'denied');
  assert.equal(deniedResult.details.reasonCode, 'no_matching_delegation_policy_rule');
  assert.equal((await adapter.loadProcess('process_parent_alfred')).status, 'running');
  assert.equal((await adapter.loadThread('thread_parent_alfred')).status, 'running');
  assert.deepEqual(await adapter.listTimers(), []);
});

test('executeAcceptedBrainToolRequest runs mas.os.schedule_delegation through the governed internal tool bridge', async () => {
  const {
    masRootPath,
    adapter,
    inbox,
  } = await createProjectFixture();
  const execution = await executeAcceptedBrainToolRequest({
    masRootPath,
    invocationId: 'invocation-mas-os-schedule-delegation-tool-001',
    operationalIdentityId: 'alfred',
    requestedBy: 'test-suite',
    osRuntimeContext: {
      jobId: 'job_parent_alfred',
      processId: 'process_parent_alfred',
      threadId: 'thread_parent_alfred',
    },
    toolRequestResolution: buildAcceptedToolResolution(createScheduleDelegationInput({
      runAt: FUTURE_RUN_AT,
      parentContext: {
        jobId: 'job_untrusted',
        processId: 'process_untrusted',
        threadId: 'thread_untrusted',
      },
    })),
    toolDefinitions: [await readMasOsScheduleDelegationToolDefinition()],
  });

  assert.equal(execution.status, 'executed');
  assert.equal(execution.executionPerformed, true);
  assert.equal(execution.requestedToolId, 'mas.os.schedule_delegation');
  assert.equal(execution.toolResultStatus, 'succeeded');
  assert.equal(execution.continuationPolicy, 'return_kernel_acknowledgement');
  assert.equal(execution.observation.status, 'succeeded');
  assert.equal(execution.observation.dataPreview.scheduled, false);
  assert.equal(execution.observation.dataPreview.systemCall.operation, 'schedule_delegation');
  assert.equal(execution.observation.dataPreview.systemCall.status, 'pending');
  assert.equal(execution.observation.dataPreview.systemCall.wait.status, 'not_requested');

  const pendingSystemCallId = execution.observation.dataPreview.systemCall.systemCallId;
  const pendingSystemCall = await inbox.loadPendingSystemCall(pendingSystemCallId);

  assert.equal(pendingSystemCall.payload.requesterOperationalIdentityId, 'alfred');
  assert.equal(pendingSystemCall.payload.targetOperationalIdentityId, 'bruce');
  assert.deepEqual(pendingSystemCall.payload.parentContext, {
    jobId: 'job_parent_alfred',
    processId: 'process_parent_alfred',
    threadId: 'thread_parent_alfred',
  });
  await assert.rejects(
    () => adapter.loadJob(`job_${pendingSystemCallId}`),
    /was not found/u,
  );
  await assert.rejects(
    () => adapter.loadTimer(`timer_job_${pendingSystemCallId}`),
    /was not found/u,
  );
});
