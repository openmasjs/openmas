import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { writeMemoryWritebackRequest } from '../../src/context/write-memory-writeback-request.js';
import { proposeMemoryWritebackForToolResult } from '../../src/tools/propose-memory-writeback-for-tool-result.js';
import { runWorkflow } from '../../src/workflows/run-workflow.js';

const VALID_STARTED_AT = '2026-04-16T10:00:00.000Z';
const VALID_COMPLETED_AT = '2026-04-16T10:00:01.000Z';

async function createDirectoryTree(rootPath, relativePaths) {
  for (const relativePath of relativePaths) {
    await mkdir(path.join(rootPath, relativePath), { recursive: true });
  }
}

async function writeJsonFile(filePath, payload) {
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function buildToolDefinition(overrides = {}) {
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
      allowWritebackCandidates: true,
    },
    ...overrides,
  };
}

function buildToolResult(overrides = {}) {
  return {
    kind: 'tool_result',
    version: 1,
    toolId: 'mas.system.inspect',
    toolRunId: 'tool-run-writeback-001',
    status: 'succeeded',
    summary: 'MAS inspection completed with SECRET_VALUE_SHOULD_NOT_BE_COPIED in raw data.',
    data: {
      secretProbe: 'SECRET_VALUE_SHOULD_NOT_BE_COPIED',
      registeredCognitiveIdentityCount: 3,
    },
    artifacts: [],
    warnings: [],
    errors: [],
    memoryWritebackCandidates: [],
    audit: {
      invocationId: 'invocation-writeback-001',
      operationalIdentityId: 'alfred',
      requestedBy: 'test-suite',
      startedAt: VALID_STARTED_AT,
      completedAt: VALID_COMPLETED_AT,
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
      allowWritebackCandidates: true,
    },
    ...overrides,
  };
}

async function createWorkflowWritebackFixture({
  workflowRuntimeDefinition = buildWorkflowRuntimeDefinition(),
  toolDefinition = buildToolDefinition(),
} = {}) {
  const temporaryRootPath = await mkdtemp(path.join(os.tmpdir(), 'openmas-workflow-writeback-'));
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
      resources: [
        {
          kind: 'resource_definition',
          version: 1,
          resourceId: 'mas-filesystem',
          resourceType: 'storage',
          displayName: 'MAS Filesystem',
          ownershipScope: 'shared',
          lifecycleState: 'active',
        },
      ],
    },
  );
  await writeJsonFile(
    path.join(masRootPath, 'operational-identities', 'alfred', 'bindings.json'),
    {
      kind: 'operational_identity_bindings',
      version: 1,
      operationalIdentityId: 'alfred',
      bindings: [
        {
          resourceId: 'mas-filesystem',
          accessMode: 'read',
          bindingState: 'active',
          credentialReferenceId: null,
        },
      ],
    },
  );
  await writeJsonFile(
    path.join(masRootPath, 'operational-identities', 'alfred', 'permissions.json'),
    {
      kind: 'operational_identity_permissions',
      version: 1,
      operationalIdentityId: 'alfred',
      defaultEffect: 'deny',
      rules: [
        {
          ruleId: 'allow-mas-filesystem-read',
          effect: 'allow',
          resourceId: 'mas-filesystem',
          accessModes: ['read'],
        },
      ],
    },
  );
  await writeJsonFile(
    path.join(masRootPath, 'tools', toolDefinition.toolId, 'tool.json'),
    toolDefinition,
  );
  await writeFile(
    path.join(masRootPath, 'tools', toolDefinition.toolId, 'executor.js'),
    [
      'export async function executeTool({ input }) {',
      '  return {',
      '    status: "succeeded",',
      '    summary: "Workflow writeback fixture inspection completed.",',
      '    data: {',
      '      inputEcho: input,',
      '      secretProbe: "SECRET_VALUE_SHOULD_NOT_BE_COPIED"',
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

test('proposeMemoryWritebackForToolResult creates a pending artifact-reference candidate without copying raw tool data', () => {
  const writebackRequest = proposeMemoryWritebackForToolResult({
    toolDefinition: buildToolDefinition(),
    toolResult: buildToolResult(),
    requestedBy: 'test-suite',
  });
  const serializedRequest = JSON.stringify(writebackRequest);

  assert.equal(writebackRequest.kind, 'memory_writeback_request');
  assert.equal(writebackRequest.requiresHumanApproval, true);
  assert.equal(writebackRequest.memoryWrites.length, 1);
  assert.equal(writebackRequest.memoryWrites[0].writeType, 'artifact_reference');
  assert.equal(writebackRequest.memoryWrites[0].approvalState, 'pending');
  assert.equal(writebackRequest.memoryWrites[0].content, null);
  assert.equal(writebackRequest.memoryWrites[0].sourceReferences[0].sourceType, 'tool_result');
  assert.equal(writebackRequest.memoryWrites[0].subjectReferences[0].subjectType, 'tool_run');
  assert.doesNotMatch(serializedRequest, /SECRET_VALUE_SHOULD_NOT_BE_COPIED/u);
});

test('proposeMemoryWritebackForToolResult respects tool memoryPolicy', () => {
  const writebackRequest = proposeMemoryWritebackForToolResult({
    toolDefinition: buildToolDefinition({
      memoryPolicy: {
        allowWritebackCandidates: false,
      },
    }),
    toolResult: buildToolResult(),
    requestedBy: 'test-suite',
  });

  assert.equal(writebackRequest.requiresHumanApproval, false);
  assert.equal(writebackRequest.memoryWrites.length, 0);
  assert.match(writebackRequest.warnings[0], /disabled by tool policy/u);
});

test('runWorkflow links tool and workflow writeback candidates into final workflow state and persists the request', async () => {
  const {
    masRootPath,
  } = await createWorkflowWritebackFixture();
  const result = await runWorkflow({
    masRootPath,
    workflowId: 'mas-health-review',
    workflowRunId: 'workflow-run-writeback-001',
    operationalIdentityId: 'alfred',
    invocationId: 'invocation-workflow-writeback-001',
    requestedBy: 'test-suite',
  });
  const persistedState = JSON.parse(await readFile(result.persistence.workflowRunStateRecordPath, 'utf8'));
  const persistedWritebackRequest = JSON.parse(await readFile(result.memoryWritebackPersistence.recordPath, 'utf8'));
  const serializedResult = JSON.stringify({
    memoryWritebackRequest: result.memoryWritebackRequest,
    persistedWritebackRequest,
  });

  assert.equal(result.status, 'succeeded');
  assert.equal(result.memoryWritebackRequest.requiresHumanApproval, true);
  assert.equal(result.memoryWritebackRequest.memoryWrites.length, 3);
  assert.equal(result.memoryWritebackPersistence.relativePath, 'memory/state/memory-writeback-workflow-run-writeback-001.json');
  assert.deepEqual(
    result.memoryWritebackRequest.memoryWrites.map((candidate) => candidate.writeType).toSorted(),
    ['artifact_reference', 'artifact_reference', 'task_state_update'],
  );
  assert.equal(
    persistedState.memoryWritebackCandidateIds.length,
    result.memoryWritebackRequest.memoryWrites.length,
  );
  assert.deepEqual(
    persistedWritebackRequest.memoryWrites.map((candidate) => candidate.writeId).toSorted(),
    persistedState.memoryWritebackCandidateIds.toSorted(),
  );
  assert.equal(
    result.workflowRunState.memoryWritebackCandidateIds.length,
    result.memoryWritebackRequest.memoryWrites.length,
  );
  assert.doesNotMatch(serializedResult, /SECRET_VALUE_SHOULD_NOT_BE_COPIED/u);
});

test('writeMemoryWritebackRequest persists a validated request and rejects unsafe record ids', async () => {
  const temporaryRootPath = await mkdtemp(path.join(os.tmpdir(), 'openmas-writeback-persistence-'));
  const masRootPath = path.join(temporaryRootPath, 'instance');
  const writebackRequest = proposeMemoryWritebackForToolResult({
    toolDefinition: buildToolDefinition(),
    toolResult: buildToolResult({
      audit: {
        invocationId: 'invocation-writeback-persist-001',
        operationalIdentityId: 'alfred',
        requestedBy: 'test-suite',
        startedAt: VALID_STARTED_AT,
        completedAt: VALID_COMPLETED_AT,
      },
    }),
    requestedBy: 'test-suite',
  });
  const persistence = await writeMemoryWritebackRequest({
    masRootPath,
    memoryWritebackRequest: writebackRequest,
    recordId: 'workflow-run-writeback-persist-001',
  });
  const persistedRequest = JSON.parse(await readFile(persistence.recordPath, 'utf8'));

  assert.equal(persistence.targetType, 'mas-memory');
  assert.equal(persistence.writeCount, 1);
  assert.equal(persistedRequest.kind, 'memory_writeback_request');
  assert.equal(persistedRequest.memoryWrites[0].approvalState, 'pending');

  await assert.rejects(
    () => writeMemoryWritebackRequest({
      masRootPath,
      memoryWritebackRequest: writebackRequest,
      recordId: '../unsafe',
    }),
    /unsafe filesystem characters/u,
  );
});
