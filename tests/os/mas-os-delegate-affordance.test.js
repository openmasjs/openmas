import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { OPENMAS_OS_KINDS } from '../../src/contracts/os/openmas-os-runtime-contract.js';
import { createLocalRuntimeAdapter } from '../../src/os/adapters/local-runtime-adapter.js';
import { executeMasOsDelegate } from '../../src/os/actions/mas-os-delegate-runtime.js';
import { createLocalSystemCallInbox } from '../../src/os/system-calls/local-system-call-inbox.js';
import { createKernelSystemCallProcessor } from '../../src/os/system-calls/system-call-processor.js';
import { readToolDefinitions } from '../../src/tools/read-tool-definitions.js';
import { evaluateToolReadinessForInvocation } from '../../src/tools/evaluate-tool-readiness-for-invocation.js';
import { executeAcceptedBrainToolRequest } from '../../src/tools/execute-accepted-brain-tool-request.js';
import { buildAgentExecutionPlanForInvocation } from '../../src/plans/build-agent-execution-plan-for-invocation.js';
import { coordinatePlanExecutionForInvocation } from '../../src/plans/coordinate-plan-execution-for-invocation.js';

const CREATED_AT = '2026-05-15T09:00:00-05:00';
const DELEGATED_AT = '2026-05-15T09:05:00-05:00';

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
        actionTypes: ['delegate'],
        commands: ['ask'],
        modes: ['probabilistic'],
      },
    ],
  };
}

function createMasOsDelegateToolDefinition() {
  return {
    kind: 'tool_definition',
    version: 1,
    toolId: 'mas.os.delegate',
    displayName: 'MAS OS Delegate',
    description: 'Submits an immediate delegation System Call to the OpenMAS OS.',
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
        parentContext: {
          type: 'object',
        },
      },
      required: [
        'targetOperationalIdentityId',
        'task',
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
      primaryIntentId: 'mas.os.delegate',
      targetActionType: 'tool_execution',
      targetType: 'tool',
      targetId: 'mas.os.delegate',
      expectedSideEffectLevel: 'write_internal',
      requestTypes: [
        'tool_action',
        'handoff',
        'conversation',
      ],
      semanticTags: [
        'mas',
        'os',
        'delegate',
        'operational-identity',
      ],
      whenToUse: [
        'Use when an Operational Identity needs another Operational Identity to perform a bounded child task now.',
      ],
      whenNotToUse: [
        'Do not use for scheduled delegation or direct answers.',
      ],
      exampleRequests: [
        'Ask Bruce to inspect the MAS.',
      ],
      classificationGuidance: {
        highConfidenceSignals: [
          'The request names a target Operational Identity and bounded child task.',
        ],
        ambiguitySignals: [],
        negativeSignals: [],
        requiredContextKeys: [
          'target-operational-identity-id',
          'task',
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
      text: 'Coordinate with Bruce.',
    },
    conversationId: 'os-m2-delegation-smoke',
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
    conversationId: 'os-m2-delegation-smoke',
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

function createDelegateInput(overrides = {}) {
  return {
    targetOperationalIdentityId: 'bruce',
    task: 'Inspect the MAS and report findings.',
    command: 'ask',
    mode: 'probabilistic',
    conversationId: 'os-m2-delegation-smoke',
    parentContext: {
      jobId: 'job_parent_alfred',
      processId: 'process_parent_alfred',
      threadId: 'thread_parent_alfred',
    },
    contextRefs: [
      {
        sourceType: 'conversation_session',
        conversationId: 'os-m2-delegation-smoke',
        path: 'memory/state/conversations/os-m2-delegation-smoke/session.json',
      },
    ],
    ...overrides,
  };
}

async function createProjectFixture() {
  const projectRootPath = await mkdtemp(path.join(os.tmpdir(), 'openmas-os-delegate-'));
  const masRootPath = path.join(projectRootPath, 'instance');
  const toolRootPath = path.join(masRootPath, 'tools', 'mas.os.delegate');
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
    JSON.stringify(createMasOsDelegateToolDefinition(), null, 2),
    'utf8',
  );

  const runtimeModuleUrl = pathToFileURL(
    path.join(process.cwd(), 'src', 'os', 'actions', 'mas-os-delegate-runtime.js'),
  ).href;

  await writeFile(
    path.join(toolRootPath, 'executor.js'),
    [
      `import { executeMasOsDelegate } from ${JSON.stringify(runtimeModuleUrl)};`,
      'export async function executeTool(options) {',
      '  return executeMasOsDelegate(options);',
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
  now = () => DELEGATED_AT,
} = {}) {
  return createKernelSystemCallProcessor({
    projectRootPath,
    adapter,
    inbox,
    delegationPolicy: createDelegationPolicy(),
    now,
    serviceId: 'openmas_os_service_delegate_affordance_test',
    tickId: 'os_service_tick_delegate_affordance_test',
  });
}

async function readMasOsDelegateToolDefinition() {
  return createMasOsDelegateToolDefinition();
}

function buildReadyVerdict() {
  return {
    kind: 'tool_readiness_verdict',
    version: 1,
    toolId: 'mas.os.delegate',
    status: 'ready',
    approvalRequired: false,
    reason: 'Tool mas.os.delegate passed readiness gates and can be requested for execution.',
    matchedBindings: [],
    missingRequirements: [],
    warnings: [],
  };
}

function buildAcceptedToolResolution(input = createDelegateInput()) {
  const toolRequest = {
    kind: 'brain_tool_request',
    version: 1,
    toolRequestId: 'tool-request-mas-os-delegate-001',
    toolId: 'mas.os.delegate',
    input,
    purpose: 'Delegate a child MAS task to Bruce through the OpenMAS OS.',
    expectedSideEffectLevel: 'write_internal',
  };

  return {
    kind: 'brain_tool_request_resolution',
    version: 1,
    status: 'accepted',
    requestedToolId: 'mas.os.delegate',
    toolRequest,
    toolReadinessVerdict: buildReadyVerdict(),
    executionAllowed: true,
    approvalRequired: false,
    autoExecutionPerformed: false,
    runtimeAction: 'queue_for_execution',
    reason: 'Brain tool request for mas.os.delegate was accepted for runtime execution.',
    warnings: [],
  };
}

test('mas.os.delegate is exposed as an active write_internal affordance with ready local readiness', async () => {
  const { masRootPath } = await createProjectFixture();
  const { toolDefinitions } = await readToolDefinitions({ masRootPath });
  const toolDefinition = toolDefinitions.find((definition) => definition.toolId === 'mas.os.delegate');
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
  assert.equal(toolDefinition.intentMetadata.targetId, 'mas.os.delegate');
  assert.equal(readiness.evaluatedTools[0].status, 'ready');
});

test('coordinatePlanExecutionForInvocation allows governed mas.os.delegate write_internal execution', () => {
  const actionResolution = {
    status: 'accepted',
    source: 'semantic_classifier',
    executionAllowed: true,
    approvalRequired: false,
    reason: 'The runtime selected mas.os.delegate for governed delegation.',
    selectedCandidate: {
      targetType: 'tool',
      targetId: 'mas.os.delegate',
      sideEffectLevel: 'write_internal',
      reason: 'Delegate a bounded child task to Bruce.',
    },
  };
  const toolRequestResolution = buildAcceptedToolResolution();
  const executionPlan = buildAgentExecutionPlanForInvocation({
    invocationId: 'invocation-mas-os-delegate-plan-001',
    request: {
      command: 'ask',
      invocationMode: 'probabilistic',
      requestedBy: 'cli',
      inputText: 'Ask Bruce to inspect the MAS.',
      conversationId: 'os-m2-delegation-smoke',
    },
    actionResolution,
    toolRequestResolution,
    semanticIntentRuntime: {
      status: 'completed',
      semanticIntentClassification: {
        actionIntent: {
          understanding: {
            requestedOutcome: 'Delegate MAS inspection to Bruce.',
            summary: 'Use the OpenMAS OS delegation affordance.',
          },
        },
      },
    },
    knownToolIds: ['mas.os.delegate'],
    knownWorkflowIds: [],
  });
  const coordination = coordinatePlanExecutionForInvocation({
    executionPlan,
    actionResolution,
    toolRequestResolution,
  });

  assert.equal(coordination.status, 'ready');
  assert.equal(coordination.runtimeAction, 'queue_tool_request');
  assert.equal(coordination.selectedTargetId, 'mas.os.delegate');
});

test('executeMasOsDelegate submits a delegate System Call without direct kernel materialization', async () => {
  const {
    projectRootPath,
    adapter,
    inbox,
  } = await createProjectFixture();
  const outcome = await executeMasOsDelegate({
    input: createDelegateInput({
      systemCallId: 'syscall_delegate_affordance_pending_001',
    }),
    projectRootPath,
    operationalIdentityId: 'alfred',
    invocationId: 'invocation-mas-os-delegate-runtime-001',
    now: () => DELEGATED_AT,
  });
  const systemCall = await inbox.loadPendingSystemCall('syscall_delegate_affordance_pending_001');

  assert.equal(outcome.status, 'succeeded');
  assert.equal(outcome.data.delegated, false);
  assert.equal(outcome.data.osAction.status, 'submitted');
  assert.equal(outcome.data.systemCall.systemCallId, 'syscall_delegate_affordance_pending_001');
  assert.equal(outcome.data.systemCall.operation, 'delegate');
  assert.equal(outcome.data.systemCall.status, 'pending');
  assert.equal(outcome.data.systemCall.wait.status, 'not_requested');
  assert.equal(systemCall.payload.requesterOperationalIdentityId, 'alfred');
  assert.equal(systemCall.payload.targetOperationalIdentityId, 'bruce');
  assert.equal(systemCall.payload.child.input, 'Inspect the MAS and report findings.');
  assert.equal(systemCall.correlation.invocationId, 'invocation-mas-os-delegate-runtime-001');

  const parentProcess = await adapter.loadProcess('process_parent_alfred');
  const parentThread = await adapter.loadThread('thread_parent_alfred');
  const events = await adapter.readEvents({ date: '2026-05-15' });

  await assert.rejects(
    () => adapter.loadJob('job_syscall_delegate_affordance_pending_001'),
    /was not found/u,
  );
  assert.equal(parentProcess.status, 'running');
  assert.equal(parentThread.status, 'running');
  assert.deepEqual(events, []);
});

test('executeMasOsDelegate rejects a Cognitive Identity selector before submitting a System Call', async () => {
  const { projectRootPath, inbox } = await createProjectFixture();

  await assert.rejects(
    () => executeMasOsDelegate({
      input: createDelegateInput({
        agentId: 'evaluation-audit-steward',
        systemCallId: 'syscall_delegate_invalid_cognition_selector_001',
      }),
      projectRootPath,
      operationalIdentityId: 'alfred',
      invocationId: 'invocation-mas-os-delegate-invalid-selector-001',
      now: () => DELEGATED_AT,
    }),
    /must not include agentId/u,
  );

  await assert.rejects(
    () => inbox.loadPendingSystemCall('syscall_delegate_invalid_cognition_selector_001'),
    /was not found/u,
  );
});

test('executeMasOsDelegate rejects missing parent lineage before submitting a System Call', async () => {
  const { projectRootPath, inbox } = await createProjectFixture();

  await assert.rejects(
    () => executeMasOsDelegate({
      input: createDelegateInput({
        parentContext: {
          jobId: null,
          processId: null,
          threadId: null,
        },
        systemCallId: 'syscall_delegate_missing_parent_lineage_001',
      }),
      projectRootPath,
      operationalIdentityId: 'alfred',
      invocationId: 'invocation-mas-os-delegate-missing-parent-lineage-001',
      now: () => DELEGATED_AT,
    }),
    /requires parentContext\.processId and parentContext\.threadId/u,
  );

  await assert.rejects(
    () => inbox.loadPendingSystemCall('syscall_delegate_missing_parent_lineage_001'),
    /was not found/u,
  );
});

test('OpenMAS OS service processes mas.os.delegate System Call into child Job and parent wait state', async () => {
  const {
    projectRootPath,
    adapter,
    inbox,
  } = await createProjectFixture();

  await executeMasOsDelegate({
    input: createDelegateInput({
      systemCallId: 'syscall_delegate_affordance_service_001',
    }),
    projectRootPath,
    operationalIdentityId: 'alfred',
    invocationId: 'invocation-mas-os-delegate-service-001',
    now: () => DELEGATED_AT,
  });

  const processor = createSystemCallProcessor({
    projectRootPath,
    adapter,
    inbox,
  });
  const processorResult = await processor.processPendingSystemCalls();
  const result = await inbox.loadSystemCallResult('syscall_delegate_affordance_service_001');
  const childJob = await adapter.loadJob('job_syscall_delegate_affordance_service_001');
  const parentProcess = await adapter.loadProcess('process_parent_alfred');
  const parentThread = await adapter.loadThread('thread_parent_alfred');
  const submissionResult = await adapter.loadResultRecord(
    'result_delegation_submission_syscall_delegate_affordance_service_001',
  );
  const events = await adapter.readEvents({ date: '2026-05-15' });

  assert.equal(processorResult.completedCount, 1);
  assert.equal(result.status, 'completed');
  assert.equal(result.decision.allowed, true);
  assert.deepEqual(result.effects.createdJobIds, ['job_syscall_delegate_affordance_service_001']);
  assert.equal(result.details.authorizationRuleId, 'allow-alfred-to-bruce-probabilistic-ask');
  assert.equal(childJob.status, 'ready');
  assert.equal(childJob.assignedOperationalIdentityId, 'bruce');
  assert.equal(childJob.inputRef.text, 'Inspect the MAS and report findings.');
  assert.equal(parentProcess.status, 'blocked');
  assert.equal(parentThread.status, 'blocked');
  assert.equal(parentThread.waitReason, 'waiting_for_child_process');
  assert.equal(submissionResult.resultKind, 'delegation_submission_result');
  assert.equal(submissionResult.status, 'accepted');
  assert.equal(submissionResult.metadata.delegation.childJobId, 'job_syscall_delegate_affordance_service_001');
  assert.equal(submissionResult.metadata.delivery.childCompletionProven, false);
  assert.deepEqual(
    events.map((event) => event.eventType),
    [
      'delegation.requested',
      'job.created',
      'thread.blocked',
      'process.blocked',
    ],
  );
});

test('OpenMAS OS service denies unauthorized mas.os.delegate System Call without creating a child Job', async () => {
  const {
    projectRootPath,
    adapter,
    inbox,
  } = await createProjectFixture();
  const outcome = await executeMasOsDelegate({
    input: createDelegateInput({
      targetOperationalIdentityId: 'maria',
      systemCallId: 'syscall_delegate_affordance_denied_001',
    }),
    projectRootPath,
    operationalIdentityId: 'alfred',
    invocationId: 'invocation-mas-os-delegate-denied-001',
    now: () => DELEGATED_AT,
  });
  const processor = createSystemCallProcessor({
    projectRootPath,
    adapter,
    inbox,
  });
  const processorResult = await processor.processPendingSystemCalls();
  const result = await inbox.loadSystemCallResult('syscall_delegate_affordance_denied_001');
  const submissionResult = await adapter.loadResultRecord(
    'result_delegation_submission_syscall_delegate_affordance_denied_001',
  );

  assert.equal(outcome.status, 'succeeded');
  assert.equal(outcome.data.delegated, false);
  assert.equal(outcome.data.systemCall.status, 'pending');
  assert.equal(processorResult.deniedCount, 1);
  assert.equal(result.status, 'denied');
  assert.equal(result.decision.allowed, false);
  assert.equal(result.details.reasonCode, 'no_matching_delegation_policy_rule');
  assert.equal(submissionResult.resultKind, 'delegation_submission_result');
  assert.equal(submissionResult.status, 'denied');
  assert.equal(submissionResult.metadata.policy.reasonCode, 'no_matching_delegation_policy_rule');
  assert.equal(submissionResult.metadata.delegation.childJobId, null);
  assert.equal((await adapter.loadProcess('process_parent_alfred')).status, 'running');
  assert.equal((await adapter.loadThread('thread_parent_alfred')).status, 'running');
  await assert.rejects(
    () => adapter.loadJob('job_syscall_delegate_affordance_denied_001'),
    /was not found/u,
  );
  assert.deepEqual(await adapter.readEvents({ date: '2026-05-15' }), []);
});

test('executeAcceptedBrainToolRequest runs mas.os.delegate through the governed internal tool bridge', async () => {
  const {
    masRootPath,
    adapter,
    inbox,
  } = await createProjectFixture();
  const execution = await executeAcceptedBrainToolRequest({
    masRootPath,
    invocationId: 'invocation-mas-os-delegate-tool-001',
    operationalIdentityId: 'alfred',
    requestedBy: 'test-suite',
    osRuntimeContext: {
      jobId: 'job_parent_alfred',
      processId: 'process_parent_alfred',
      threadId: 'thread_parent_alfred',
    },
    toolRequestResolution: buildAcceptedToolResolution(createDelegateInput({
      parentContext: {
        jobId: 'job_untrusted',
        processId: 'process_untrusted',
        threadId: 'thread_untrusted',
      },
    })),
    toolDefinitions: [await readMasOsDelegateToolDefinition()],
  });

  assert.equal(execution.status, 'executed');
  assert.equal(execution.executionPerformed, true);
  assert.equal(execution.requestedToolId, 'mas.os.delegate');
  assert.equal(execution.toolResultStatus, 'succeeded');
  assert.equal(execution.continuationPolicy, 'yield_to_kernel');
  assert.equal(execution.observation.status, 'succeeded');
  assert.equal(execution.observation.dataPreview.delegated, false);
  assert.equal(execution.observation.dataPreview.systemCall.operation, 'delegate');
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
});
