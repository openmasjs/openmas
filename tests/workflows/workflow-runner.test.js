import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { runWorkflow } from '../../src/workflows/run-workflow.js';

async function createDirectoryTree(rootPath, relativePaths) {
  for (const relativePath of relativePaths) {
    await mkdir(path.join(rootPath, relativePath), { recursive: true });
  }
}

async function writeJsonFile(filePath, payload) {
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function buildReadOnlyToolDefinition(overrides = {}) {
  return {
    kind: 'tool_definition',
    version: 1,
    toolId: 'mas.system.inspect',
    displayName: 'MAS System Inspect',
    description: 'Inspects safe MAS system state.',
    lifecycleState: 'active',
    owner: 'mas',
    toolType: 'local_js_module',
    sideEffectLevel: 'read_only',
    inputSchema: {
      type: 'object',
    },
    outputSchema: {
      type: 'object',
    },
    requiredResourceTypes: ['storage'],
    requiredAccessModes: ['read'],
    requiredPermissionModes: ['tool.execute'],
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
    ...overrides,
  };
}

function buildWorkflowRuntimeDefinition(overrides = {}) {
  return {
    kind: 'workflow_runtime_definition',
    version: 1,
    workflowId: 'mas-health-review',
    lifecycleState: 'active',
    executionMode: 'on_demand',
    statePolicy: {
      persistState: true,
      resumeAllowed: true,
    },
    steps: [
      {
        stepId: 'inspect-system',
        stepType: 'tool_call',
        toolId: 'mas.system.inspect',
        input: {
          includeCounts: true,
        },
        onFailure: 'fail_workflow',
      },
    ],
    approvalPolicy: {
      defaultRequiredForSideEffectLevels: [
        'write_external',
        'publish_external',
        'financial',
        'destructive',
      ],
    },
    artifactPolicy: {
      persistFinalReport: true,
    },
    memoryPolicy: {
      allowWritebackCandidates: false,
    },
    ...overrides,
  };
}

function buildResources({ includeMetaChannel = false } = {}) {
  return [
    {
      kind: 'resource_definition',
      version: 1,
      resourceId: 'mas-filesystem',
      resourceType: 'storage',
      displayName: 'MAS Filesystem',
      ownershipScope: 'shared',
      lifecycleState: 'active',
    },
    ...(includeMetaChannel
      ? [
        {
          kind: 'resource_definition',
          version: 1,
          resourceId: 'meta-channel',
          resourceType: 'channel',
          displayName: 'Meta Channel',
          ownershipScope: 'shared',
          lifecycleState: 'active',
        },
      ]
      : []),
  ];
}

function buildBindings({ includeMetaChannel = false } = {}) {
  return [
    {
      resourceId: 'mas-filesystem',
      accessMode: 'read',
      bindingState: 'active',
      secretReferenceId: null,
    },
    ...(includeMetaChannel
      ? [
        {
          resourceId: 'meta-channel',
          accessMode: 'publish',
          bindingState: 'active',
          secretReferenceId: null,
        },
      ]
      : []),
  ];
}

function buildPermissionRules({ allowFilesystemRead = true, allowMetaPublish = false } = {}) {
  return [
    ...(allowFilesystemRead
      ? [
        {
          ruleId: 'allow-mas-filesystem-read',
          effect: 'allow',
          resourceId: 'mas-filesystem',
          accessModes: ['read'],
        },
      ]
      : []),
    ...(allowMetaPublish
      ? [
        {
          ruleId: 'allow-meta-channel-publish',
          effect: 'allow',
          resourceId: 'meta-channel',
          accessModes: ['publish'],
        },
      ]
      : []),
  ];
}

async function createWorkflowRunnerFixture({
  executorSource = null,
  toolDefinition = buildReadOnlyToolDefinition(),
  workflowRuntimeDefinition = buildWorkflowRuntimeDefinition(),
  includeMetaChannel = false,
  allowFilesystemRead = true,
  allowMetaPublish = false,
} = {}) {
  const temporaryRootPath = await mkdtemp(path.join(os.tmpdir(), 'openmas-workflow-runner-'));
  const masRootPath = path.join(temporaryRootPath, 'instance');

  await createDirectoryTree(masRootPath, [
    'memory',
    'memory/state',
    'memory/artifacts',
    'operational-identities',
    'operational-identities/alfred',
    'registries',
    'tools',
    `tools/${toolDefinition.toolId}`,
    'workflows',
    `workflows/${workflowRuntimeDefinition.workflowId}`,
  ]);
  await writeJsonFile(
    path.join(masRootPath, 'registries', 'operational-identities.json'),
    {
      kind: 'operational_identities_registry',
      version: 1,
      operationalIdentities: [
        {
          operationalIdentityId: 'alfred',
          rootPath: 'alfred',
          category: 'platform',
        },
      ],
    },
  );
  await writeJsonFile(
    path.join(masRootPath, 'registries', 'resources.json'),
    {
      kind: 'resource_registry',
      version: 1,
      resources: buildResources({ includeMetaChannel }),
    },
  );
  await writeJsonFile(
    path.join(masRootPath, 'operational-identities', 'alfred', 'bindings.json'),
    {
      kind: 'operational_identity_bindings',
      version: 1,
      operationalIdentityId: 'alfred',
      bindings: buildBindings({ includeMetaChannel }),
    },
  );
  await writeJsonFile(
    path.join(masRootPath, 'operational-identities', 'alfred', 'permissions.json'),
    {
      kind: 'operational_identity_permissions',
      version: 1,
      operationalIdentityId: 'alfred',
      defaultEffect: 'deny',
      rules: buildPermissionRules({
        allowFilesystemRead,
        allowMetaPublish,
      }),
    },
  );
  await writeJsonFile(
    path.join(masRootPath, 'tools', toolDefinition.toolId, 'tool.json'),
    toolDefinition,
  );
  await writeFile(
    path.join(masRootPath, 'tools', toolDefinition.toolId, 'executor.js'),
    executorSource ?? [
      'export async function executeTool({ input, masRootPath, toolRunId }) {',
      '  return {',
      '    status: "succeeded",',
      '    summary: "Workflow fixture inspection completed.",',
      '    data: {',
      '      inputEcho: input,',
      '      masRootPathEndsWithInstance: masRootPath.endsWith("instance"),',
      '      toolRunIdPrefix: toolRunId.slice(0, 9)',
      '    },',
      '    warnings: [],',
      '    errors: []',
      '  };',
      '}',
    ].join('\n'),
    'utf8',
  );
  await writeJsonFile(
    path.join(masRootPath, 'workflows', workflowRuntimeDefinition.workflowId, 'runtime.json'),
    workflowRuntimeDefinition,
  );

  return {
    masRootPath,
  };
}

test('runWorkflow executes a safe read-only tool workflow and persists state transitions', async () => {
  const {
    masRootPath,
  } = await createWorkflowRunnerFixture();
  const result = await runWorkflow({
    masRootPath,
    workflowId: 'mas-health-review',
    workflowRunId: 'workflow-run-success-001',
    operationalIdentityId: 'alfred',
    invocationId: 'invocation-workflow-success-001',
    requestedBy: 'test-suite',
  });
  const persistedState = JSON.parse(await readFile(result.persistence.workflowRunStateRecordPath, 'utf8'));
  const toolAuditRecord = JSON.parse(await readFile(result.stepResults[0].toolPersistence.auditRecordPath, 'utf8'));

  assert.equal(result.kind, 'workflow_run_result');
  assert.equal(result.status, 'succeeded');
  assert.equal(result.workflowRunState.status, 'succeeded');
  assert.equal(result.workflowRunState.currentStepId, null);
  assert.deepEqual(result.workflowRunState.completedSteps, ['inspect-system']);
  assert.equal(result.workflowRunState.toolRunIds.length, 1);
  assert.equal(result.stepResults[0].status, 'succeeded');
  assert.equal(result.stepResults[0].toolResult.status, 'succeeded');
  assert.equal(result.stepResults[0].toolResult.data.inputEcho.includeCounts, true);
  assert.equal(toolAuditRecord.kind, 'tool_run_audit_record');
  assert.equal(persistedState.status, 'succeeded');
  assert.equal(result.statePersistenceRecords.at(0).status, 'created');
  assert.equal(result.statePersistenceRecords.at(-1).status, 'succeeded');
});

test('runWorkflow fails safely when a tool step is denied by Operational Identity permissions', async () => {
  const {
    masRootPath,
  } = await createWorkflowRunnerFixture({
    allowFilesystemRead: false,
    executorSource: [
      'export async function executeTool() {',
      '  throw new Error("executor should not load when readiness is denied");',
      '}',
    ].join('\n'),
  });
  const result = await runWorkflow({
    masRootPath,
    workflowId: 'mas-health-review',
    workflowRunId: 'workflow-run-denied-001',
    operationalIdentityId: 'alfred',
    invocationId: 'invocation-workflow-denied-001',
    requestedBy: 'test-suite',
  });
  const persistedState = JSON.parse(await readFile(result.persistence.workflowRunStateRecordPath, 'utf8'));

  assert.equal(result.status, 'failed');
  assert.equal(result.workflowRunState.status, 'failed');
  assert.deepEqual(result.workflowRunState.failedSteps, ['inspect-system']);
  assert.deepEqual(result.workflowRunState.toolRunIds, []);
  assert.equal(result.stepResults[0].status, 'failed');
  assert.match(result.stepResults[0].reason, /denied/u);
  assert.doesNotMatch(result.stepResults[0].reason, /executor should not load/u);
  assert.equal(persistedState.status, 'failed');
});

test('runWorkflow pauses for human approval when a risky tool is ready but approval-required', async () => {
  const publishToolDefinition = buildReadOnlyToolDefinition({
    toolId: 'meta.reply.publish',
    displayName: 'Meta Reply Publish',
    description: 'Publishes an external Meta reply after explicit approval.',
    sideEffectLevel: 'publish_external',
    requiredResourceTypes: ['channel'],
    requiredAccessModes: ['publish'],
    requiredPermissionModes: ['tool.publish'],
    approvalPolicy: {
      required: true,
    },
  });
  const {
    masRootPath,
  } = await createWorkflowRunnerFixture({
    toolDefinition: publishToolDefinition,
    workflowRuntimeDefinition: buildWorkflowRuntimeDefinition({
      workflowId: 'meta-reply-publish-review',
      steps: [
        {
          stepId: 'publish-reply',
          stepType: 'tool_call',
          toolId: 'meta.reply.publish',
          input: {
            conversationId: 'conversation-123',
            replyText: 'This must not be auto-published.',
          },
          onFailure: 'fail_workflow',
        },
      ],
    }),
    includeMetaChannel: true,
    allowFilesystemRead: false,
    allowMetaPublish: true,
    executorSource: [
      'export async function executeTool() {',
      '  throw new Error("risky executor should not load before approval");',
      '}',
    ].join('\n'),
  });
  const result = await runWorkflow({
    masRootPath,
    workflowId: 'meta-reply-publish-review',
    workflowRunId: 'workflow-run-approval-001',
    operationalIdentityId: 'alfred',
    invocationId: 'invocation-workflow-approval-001',
    requestedBy: 'test-suite',
  });
  const persistedState = JSON.parse(await readFile(result.persistence.workflowRunStateRecordPath, 'utf8'));

  assert.equal(result.status, 'waiting_for_approval');
  assert.equal(result.workflowRunState.status, 'waiting_for_approval');
  assert.deepEqual(result.workflowRunState.blockedSteps, ['publish-reply']);
  assert.deepEqual(result.workflowRunState.toolRunIds, []);
  assert.equal(result.workflowRunState.approvalRequests[0], 'workflow-approval-workflow-run-approval-001-publish-reply');
  assert.equal(result.stepResults[0].status, 'approval_required');
  assert.match(result.stepResults[0].reason, /requires approval/u);
  assert.doesNotMatch(JSON.stringify(result), /risky executor should not load/u);
  assert.equal(persistedState.status, 'waiting_for_approval');
});

test('runWorkflow can pause on unsupported steps through the pause_workflow failure policy', async () => {
  const {
    masRootPath,
  } = await createWorkflowRunnerFixture({
    workflowRuntimeDefinition: buildWorkflowRuntimeDefinition({
      workflowId: 'manual-review-workflow',
      steps: [
        {
          stepId: 'brain-summary',
          stepType: 'agent_brain',
          input: {},
          onFailure: 'pause_workflow',
        },
      ],
    }),
  });
  const result = await runWorkflow({
    masRootPath,
    workflowId: 'manual-review-workflow',
    workflowRunId: 'workflow-run-paused-001',
    operationalIdentityId: 'alfred',
    invocationId: 'invocation-workflow-paused-001',
    requestedBy: 'test-suite',
  });

  assert.equal(result.status, 'waiting_for_external_event');
  assert.equal(result.workflowRunState.currentStepId, 'brain-summary');
  assert.deepEqual(result.workflowRunState.blockedSteps, ['brain-summary']);
  assert.equal(result.stepResults[0].status, 'failed');
  assert.match(result.warnings.join('\n'), /Workflow paused at step brain-summary/u);
});
