import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { assertWorkflowRuntimeDefinition } from '../../src/contracts/workflow-runtime-contract.js';
import { assertWorkflowRunState } from '../../src/contracts/workflow-run-state-contract.js';
import { createWorkflowRunState } from '../../src/workflows/create-workflow-run-state.js';
import {
  readWorkflowRuntimeDefinition,
  readWorkflowRuntimeDefinitions,
} from '../../src/workflows/read-workflow-runtime-definitions.js';
import { writeWorkflowRunState } from '../../src/workflows/write-workflow-run-state.js';

const VALID_CREATED_AT = '2026-04-16T00:00:00.000Z';

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
        input: {},
        onFailure: 'fail_workflow',
      },
      {
        stepId: 'build-report',
        stepType: 'agent_brain',
        dependsOn: ['inspect-system'],
        input: {},
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

async function writeJsonFile(filePath, payload) {
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

async function createWorkflowRuntimeFixture() {
  const projectRootPath = await mkdtemp(path.join(os.tmpdir(), 'openmas-workflow-runtime-'));
  const masRootPath = path.join(projectRootPath, 'instance');
  const workflowsRootPath = path.join(masRootPath, 'workflows');

  await mkdir(path.join(workflowsRootPath, 'mas-health-review'), { recursive: true });
  await mkdir(path.join(workflowsRootPath, 'archived-review'), { recursive: true });
  await mkdir(path.join(workflowsRootPath, 'guidance-only'), { recursive: true });
  await mkdir(path.join(workflowsRootPath, 'invalid-runtime'), { recursive: true });
  await mkdir(path.join(masRootPath, 'memory', 'state'), { recursive: true });

  await writeJsonFile(
    path.join(workflowsRootPath, 'mas-health-review', 'runtime.json'),
    buildWorkflowRuntimeDefinition(),
  );
  await writeJsonFile(
    path.join(workflowsRootPath, 'archived-review', 'runtime.json'),
    buildWorkflowRuntimeDefinition({
      workflowId: 'archived-review',
      lifecycleState: 'archived',
    }),
  );
  await writeJsonFile(
    path.join(workflowsRootPath, 'guidance-only', 'workflow.json'),
    {
      kind: 'workflow_instruction_definition',
      version: 1,
      workflowId: 'guidance-only',
      lifecycleState: 'active',
      commandTriggers: ['ask'],
    },
  );
  await writeFile(
    path.join(workflowsRootPath, 'guidance-only', 'workflow.md'),
    '# Guidance Only\n',
    'utf8',
  );
  await writeJsonFile(
    path.join(workflowsRootPath, 'invalid-runtime', 'runtime.json'),
    buildWorkflowRuntimeDefinition({
      workflowId: 'wrong-id',
    }),
  );
  await writeFile(path.join(workflowsRootPath, 'README.md'), '# Workflows\n', 'utf8');

  return {
    projectRootPath,
    masRootPath,
    workflowsRootPath,
  };
}

test('assertWorkflowRuntimeDefinition and assertWorkflowRunState reject unsafe runtime identifiers', () => {
  assert.throws(
    () => assertWorkflowRuntimeDefinition(buildWorkflowRuntimeDefinition({
      workflowId: '../outside',
    })),
    /unsafe characters/u,
  );

  assert.throws(
    () => assertWorkflowRuntimeDefinition(buildWorkflowRuntimeDefinition({
      steps: [
        {
          stepId: '../outside',
          stepType: 'agent_brain',
        },
      ],
    })),
    /unsafe characters/u,
  );

  assert.throws(
    () => assertWorkflowRunState({
      kind: 'workflow_run_state',
      version: 1,
      workflowRunId: '../outside',
      workflowId: 'mas-health-review',
      status: 'created',
      operationalIdentityId: 'alfred',
      invocationId: 'invocation-001',
      currentStepId: 'inspect-system',
      completedSteps: [],
      blockedSteps: [],
      failedSteps: [],
      approvalRequests: [],
      toolRunIds: [],
      artifactReferences: [],
      memoryWritebackCandidateIds: [],
      createdAt: VALID_CREATED_AT,
      updatedAt: VALID_CREATED_AT,
      warnings: [],
    }),
    /unsafe characters/u,
  );
});

test('readWorkflowRuntimeDefinitions reads executable runtime.json files without requiring read-only workflow guidance', async () => {
  const {
    masRootPath,
  } = await createWorkflowRuntimeFixture();
  const activeResult = await readWorkflowRuntimeDefinitions({
    masRootPath,
  });
  const allResult = await readWorkflowRuntimeDefinitions({
    masRootPath,
    includeInactive: true,
  });

  assert.deepEqual(
    activeResult.workflowRuntimeDefinitions.map((definition) => definition.workflowId),
    ['mas-health-review'],
  );
  assert.equal(activeResult.workflowRuntimeDefinitions[0].sourcePath, 'instance/workflows/mas-health-review/runtime.json');
  assert.equal(activeResult.workflowRuntimeDefinitions[0].steps[0].stepId, 'inspect-system');
  assert.match(activeResult.warnings.join('\n'), /non-directory entry: README\.md/u);
  assert.match(activeResult.warnings.join('\n'), /workflowId "wrong-id" must match/u);
  assert.doesNotMatch(activeResult.warnings.join('\n'), /guidance-only/u);
  assert.deepEqual(
    allResult.workflowRuntimeDefinitions.map((definition) => definition.workflowId),
    ['archived-review', 'mas-health-review'],
  );
});

test('readWorkflowRuntimeDefinition resolves a specific workflow runtime or degrades when runtime.json is absent', async () => {
  const {
    masRootPath,
  } = await createWorkflowRuntimeFixture();
  const foundResult = await readWorkflowRuntimeDefinition({
    masRootPath,
    workflowId: 'mas-health-review',
  });
  const missingResult = await readWorkflowRuntimeDefinition({
    masRootPath,
    workflowId: 'guidance-only',
  });

  assert.equal(foundResult.workflowRuntimeDefinition.workflowId, 'mas-health-review');
  assert.equal(foundResult.workflowRuntimeDefinition.runtimeDefinitionPath.endsWith(path.join('mas-health-review', 'runtime.json')), true);
  assert.equal(missingResult.workflowRuntimeDefinition, null);
  assert.match(missingResult.warnings[0], /does not exist/u);

  await assert.rejects(
    () => readWorkflowRuntimeDefinition({
      masRootPath,
      workflowId: '../outside',
    }),
    /unsafe characters/u,
  );
});

test('createWorkflowRunState initializes a created workflow state without executing any step', () => {
  const state = createWorkflowRunState({
    workflowRuntimeDefinition: buildWorkflowRuntimeDefinition(),
    workflowRunId: 'workflow-run-001',
    operationalIdentityId: 'alfred',
    invocationId: 'invocation-001',
    createdAt: VALID_CREATED_AT,
  });

  assert.equal(state.kind, 'workflow_run_state');
  assert.equal(state.status, 'created');
  assert.equal(state.workflowId, 'mas-health-review');
  assert.equal(state.currentStepId, 'inspect-system');
  assert.deepEqual(state.completedSteps, []);
  assert.deepEqual(state.toolRunIds, []);
  assert.deepEqual(state.approvalRequests, []);
});

test('writeWorkflowRunState persists workflow state under MAS memory state workflows', async () => {
  const {
    masRootPath,
  } = await createWorkflowRuntimeFixture();
  const workflowRunState = createWorkflowRunState({
    workflowRuntimeDefinition: buildWorkflowRuntimeDefinition(),
    workflowRunId: 'workflow-run-001',
    operationalIdentityId: 'alfred',
    invocationId: 'invocation-001',
    createdAt: VALID_CREATED_AT,
  });
  const persistence = await writeWorkflowRunState({
    masRootPath,
    workflowRunState,
  });
  const persistedState = JSON.parse(await readFile(persistence.workflowRunStateRecordPath, 'utf8'));

  assert.equal(persistence.targetType, 'mas-memory');
  assert.equal(persistence.workflowRunId, 'workflow-run-001');
  assert.equal(persistence.relativePath, 'memory/state/workflows/workflow-run-001.json');
  assert.equal(persistedState.status, 'created');
  assert.equal(persistedState.currentStepId, 'inspect-system');
});
