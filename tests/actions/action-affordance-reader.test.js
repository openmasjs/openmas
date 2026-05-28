import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import {
  assertActionAffordance,
  assertActionAffordanceReadinessSummary,
  assertActionAffordances,
} from '../../src/contracts/action-affordance-contract.js';
import { readActionAffordancesForInvocation } from '../../src/actions/read-action-affordances-for-invocation.js';

async function writeJsonFile(filePath, payload) {
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

async function createMasFixture() {
  const projectRootPath = await mkdtemp(path.join(os.tmpdir(), 'openmas-action-affordance-'));
  const masRootPath = path.join(projectRootPath, 'instance');

  await mkdir(path.join(masRootPath, 'tools'), { recursive: true });
  await mkdir(path.join(masRootPath, 'workflows'), { recursive: true });

  return {
    projectRootPath,
    masRootPath,
  };
}

function buildToolIntentMetadata(overrides = {}) {
  return {
    kind: 'action_intent_metadata',
    version: 1,
    primaryIntentId: 'admin.mas.inspect',
    targetActionType: 'tool_execution',
    targetType: 'tool',
    targetId: 'mas.system.inspect',
    expectedSideEffectLevel: 'read_only',
    requestTypes: [
      'diagnostic',
      'tool_action',
    ],
    semanticTags: [
      'mas',
      'system',
      'inspect',
      'diagnostic',
    ],
    whenToUse: [
      'The user asks for a current MAS inspection.',
    ],
    whenNotToUse: [
      'The user asks to mutate the MAS.',
    ],
    exampleRequests: [
      'Inspect the MAS.',
    ],
    classificationGuidance: {
      highConfidenceSignals: [
        'The request asks for current MAS status.',
      ],
      ambiguitySignals: [],
      negativeSignals: [],
      requiredContextKeys: [],
    },
    ...overrides,
  };
}

function buildWorkflowIntentMetadata(overrides = {}) {
  return {
    kind: 'action_intent_metadata',
    version: 1,
    primaryIntentId: 'admin.mas.health_review',
    targetActionType: 'workflow_execution',
    targetType: 'workflow',
    targetId: 'mas-health-review',
    expectedSideEffectLevel: 'read_only',
    requestTypes: [
      'diagnostic',
      'workflow_action',
    ],
    semanticTags: [
      'mas',
      'health',
      'review',
    ],
    whenToUse: [
      'The user asks for a deeper MAS health review.',
    ],
    whenNotToUse: [
      'The user only asks for a quick inspection.',
    ],
    exampleRequests: [
      'Run a full MAS health review.',
    ],
    classificationGuidance: {
      highConfidenceSignals: [
        'The request asks for a comprehensive MAS diagnostic.',
      ],
      ambiguitySignals: [],
      negativeSignals: [],
      requiredContextKeys: [],
    },
    ...overrides,
  };
}

function buildToolDefinition(overrides = {}) {
  return {
    kind: 'tool_definition',
    version: 1,
    toolId: 'mas.system.inspect',
    displayName: 'MAS System Inspect',
    description: 'Reads safe MAS system state.',
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
    requiredResourceTypes: [
      'storage',
    ],
    requiredAccessModes: [
      'read',
    ],
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
    intentMetadata: buildToolIntentMetadata(),
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
    intentMetadata: buildWorkflowIntentMetadata(),
    ...overrides,
  };
}

function buildReadyToolReadinessEvaluation() {
  return {
    kind: 'tool_readiness_evaluation',
    version: 1,
    evaluatedTools: [
      {
        kind: 'tool_readiness_verdict',
        version: 1,
        toolId: 'mas.system.inspect',
        status: 'ready',
        approvalRequired: false,
        reason: 'Tool is ready for read-only execution.',
        matchedBindings: [
          {
            resourceId: 'mas-filesystem',
            resourceType: 'storage',
            accessMode: 'read',
            secretReferenceId: null,
            secretResolutionStatus: null,
          },
        ],
        missingRequirements: [],
        warnings: [],
      },
    ],
    summary: {
      totalEvaluated: 1,
      ready: 1,
      approvalRequired: 0,
      denied: 0,
      unavailable: 0,
    },
    warnings: [],
  };
}

async function writeToolDefinition({
  masRootPath,
  toolDirectoryName = 'mas.system.inspect',
  definition = buildToolDefinition({ toolId: toolDirectoryName }),
}) {
  await mkdir(path.join(masRootPath, 'tools', toolDirectoryName), { recursive: true });
  await writeJsonFile(path.join(masRootPath, 'tools', toolDirectoryName, 'tool.json'), definition);
}

async function writeWorkflowRuntimeDefinition({
  masRootPath,
  workflowDirectoryName = 'mas-health-review',
  definition = buildWorkflowRuntimeDefinition({ workflowId: workflowDirectoryName }),
}) {
  await mkdir(path.join(masRootPath, 'workflows', workflowDirectoryName), { recursive: true });
  await writeJsonFile(path.join(masRootPath, 'workflows', workflowDirectoryName, 'runtime.json'), definition);
}

test('assertActionAffordance accepts a normalized tool affordance with readiness summary', () => {
  const affordance = assertActionAffordance({
    kind: 'action_affordance',
    version: 1,
    affordanceId: 'tool:mas.system.inspect',
    sourceType: 'tool_definition',
    sourcePath: 'instance/tools/mas.system.inspect/tool.json',
    targetActionType: 'tool_execution',
    targetType: 'tool',
    targetId: 'mas.system.inspect',
    displayName: 'MAS System Inspect',
    description: 'Reads safe MAS system state.',
    owner: 'mas',
    lifecycleState: 'active',
    sideEffectLevel: 'read_only',
    executionMode: null,
    intentMetadata: buildToolIntentMetadata(),
    readinessSummary: {
      kind: 'action_affordance_readiness_summary',
      version: 1,
      status: 'ready',
      source: 'tool_readiness_evaluation',
      approvalRequired: false,
      reason: 'Tool is ready.',
      matchedBindingCount: 1,
      missingRequirementCount: 0,
      warnings: [],
    },
    warnings: [],
    metadata: {
      toolType: 'local_js_module',
    },
  });

  assert.equal(affordance.affordanceId, 'tool:mas.system.inspect');
  assert.equal(affordance.intentMetadata.primaryIntentId, 'admin.mas.inspect');
  assert.equal(affordance.readinessSummary.status, 'ready');
});

test('assertActionAffordance rejects unsafe source paths and duplicate affordances', () => {
  assert.throws(
    () => assertActionAffordance({
      kind: 'action_affordance',
      version: 1,
      affordanceId: 'tool:mas.system.inspect',
      sourceType: 'tool_definition',
      sourcePath: '../outside/tool.json',
      targetActionType: 'tool_execution',
      targetType: 'tool',
      targetId: 'mas.system.inspect',
      displayName: 'MAS System Inspect',
      description: null,
      owner: 'mas',
      lifecycleState: 'active',
      sideEffectLevel: 'read_only',
      executionMode: null,
      intentMetadata: null,
      readinessSummary: {
        kind: 'action_affordance_readiness_summary',
        version: 1,
        status: 'not_evaluated',
        source: 'none',
        approvalRequired: false,
        reason: 'Not evaluated.',
        matchedBindingCount: 0,
        missingRequirementCount: 0,
        warnings: [],
      },
      warnings: [],
    }),
    /bounded instance-relative source path/,
  );

  assert.throws(
    () => assertActionAffordances([
      {
        kind: 'action_affordance',
        version: 1,
        affordanceId: 'tool:mas.system.inspect',
        sourceType: 'tool_definition',
        sourcePath: 'instance/tools/mas.system.inspect/tool.json',
        targetActionType: 'tool_execution',
        targetType: 'tool',
        targetId: 'mas.system.inspect',
        displayName: 'MAS System Inspect',
        description: null,
        owner: 'mas',
        lifecycleState: 'active',
        sideEffectLevel: 'read_only',
        executionMode: null,
        intentMetadata: null,
        readinessSummary: {
          kind: 'action_affordance_readiness_summary',
          version: 1,
          status: 'not_evaluated',
          source: 'none',
          approvalRequired: false,
          reason: 'Not evaluated.',
          matchedBindingCount: 0,
          missingRequirementCount: 0,
          warnings: [],
        },
        warnings: [],
      },
      {
        kind: 'action_affordance',
        version: 1,
        affordanceId: 'tool:mas.system.inspect',
        sourceType: 'tool_definition',
        sourcePath: 'instance/tools/mas.system.inspect/tool.json',
        targetActionType: 'tool_execution',
        targetType: 'tool',
        targetId: 'mas.system.inspect',
        displayName: 'MAS System Inspect',
        description: null,
        owner: 'mas',
        lifecycleState: 'active',
        sideEffectLevel: 'read_only',
        executionMode: null,
        intentMetadata: null,
        readinessSummary: {
          kind: 'action_affordance_readiness_summary',
          version: 1,
          status: 'not_evaluated',
          source: 'none',
          approvalRequired: false,
          reason: 'Not evaluated.',
          matchedBindingCount: 0,
          missingRequirementCount: 0,
          warnings: [],
        },
        warnings: [],
      },
    ]),
    /duplicated affordanceId/,
  );
});

test('assertActionAffordanceReadinessSummary rejects inconsistent approval status', () => {
  assert.throws(
    () => assertActionAffordanceReadinessSummary({
      kind: 'action_affordance_readiness_summary',
      version: 1,
      status: 'approval_required',
      source: 'tool_readiness_evaluation',
      approvalRequired: false,
      reason: 'Approval is needed.',
      matchedBindingCount: 1,
      missingRequirementCount: 0,
      warnings: [],
    }),
    /must require approval/,
  );
});

test('readActionAffordancesForInvocation reads tool and workflow affordances with metadata', async () => {
  const { masRootPath } = await createMasFixture();

  await writeToolDefinition({ masRootPath });
  await writeWorkflowRuntimeDefinition({ masRootPath });

  const result = await readActionAffordancesForInvocation({
    masRootPath,
    toolReadinessEvaluation: buildReadyToolReadinessEvaluation(),
  });

  assert.equal(result.kind, 'action_affordance_read_result');
  assert.deepEqual(
    result.actionAffordances.map((affordance) => affordance.affordanceId),
    [
      'tool:mas.system.inspect',
      'workflow:mas-health-review',
    ],
  );
  assert.equal(result.summary.total, 2);
  assert.equal(result.summary.tools, 1);
  assert.equal(result.summary.workflows, 1);
  assert.equal(result.summary.withIntentMetadata, 2);
  assert.equal(result.summary.ready, 1);
  assert.equal(result.summary.notEvaluated, 1);
  assert.equal(result.actionAffordances[0].readinessSummary.status, 'ready');
  assert.equal(result.actionAffordances[0].readinessSummary.matchedBindingCount, 1);
  assert.equal(result.actionAffordances[1].intentMetadata.primaryIntentId, 'admin.mas.health_review');
  assert.deepEqual(result.warnings, []);
});

test('readActionAffordancesForInvocation filters inactive affordances by default', async () => {
  const { masRootPath } = await createMasFixture();

  await writeToolDefinition({ masRootPath });
  await writeToolDefinition({
    masRootPath,
    toolDirectoryName: 'meta.reply.publish',
    definition: buildToolDefinition({
      toolId: 'meta.reply.publish',
      displayName: 'Meta Reply Publish',
      lifecycleState: 'disabled',
      sideEffectLevel: 'publish_external',
      requiredAccessModes: [
        'publish',
      ],
      approvalPolicy: {
        required: true,
      },
      intentMetadata: null,
    }),
  });
  await writeWorkflowRuntimeDefinition({
    masRootPath,
    workflowDirectoryName: 'archived-review',
    definition: buildWorkflowRuntimeDefinition({
      workflowId: 'archived-review',
      lifecycleState: 'archived',
      intentMetadata: null,
    }),
  });

  const activeOnlyResult = await readActionAffordancesForInvocation({ masRootPath });
  const includeInactiveResult = await readActionAffordancesForInvocation({
    masRootPath,
    includeInactive: true,
  });

  assert.deepEqual(
    activeOnlyResult.actionAffordances.map((affordance) => affordance.affordanceId),
    ['tool:mas.system.inspect'],
  );
  assert.deepEqual(
    includeInactiveResult.actionAffordances.map((affordance) => affordance.affordanceId),
    [
      'tool:mas.system.inspect',
      'tool:meta.reply.publish',
      'workflow:archived-review',
    ],
  );
  assert.equal(
    includeInactiveResult.actionAffordances.find((affordance) => {
      return affordance.affordanceId === 'workflow:archived-review';
    }).readinessSummary.status,
    'unavailable',
  );
});

test('readActionAffordancesForInvocation degrades safely when metadata is malformed', async () => {
  const { masRootPath } = await createMasFixture();

  await writeToolDefinition({
    masRootPath,
    definition: buildToolDefinition({
      intentMetadata: buildToolIntentMetadata({
        targetId: 'other.tool',
      }),
    }),
  });
  await writeWorkflowRuntimeDefinition({ masRootPath });

  const result = await readActionAffordancesForInvocation({ masRootPath });

  assert.deepEqual(
    result.actionAffordances.map((affordance) => affordance.affordanceId),
    ['workflow:mas-health-review'],
  );
  assert.equal(result.summary.total, 1);
  assert.ok(result.warnings.some((warning) => warning.includes('skipped mas.system.inspect')));
  assert.ok(result.warnings.some((warning) => warning.includes('targetId must match mas.system.inspect')));
});

test('readActionAffordancesForInvocation reports malformed readiness without failing affordance discovery', async () => {
  const { masRootPath } = await createMasFixture();

  await writeToolDefinition({ masRootPath });

  const result = await readActionAffordancesForInvocation({
    masRootPath,
    toolReadinessEvaluation: {
      evaluatedTools: [
        {
          kind: 'tool_readiness_verdict',
          version: 1,
          toolId: 'mas.system.inspect',
          status: 'denied',
          approvalRequired: false,
          reason: 'Denied but missing requirements are malformed for this test.',
          matchedBindings: [],
          missingRequirements: [],
          warnings: [],
        },
      ],
    },
  });

  assert.equal(result.actionAffordances.length, 1);
  assert.equal(result.actionAffordances[0].readinessSummary.status, 'not_evaluated');
  assert.ok(result.warnings.some((warning) => warning.includes('malformed readiness verdict')));
});

test('readActionAffordancesForInvocation requires valid reader inputs', async () => {
  await assert.rejects(
    () => readActionAffordancesForInvocation({ masRootPath: '' }),
    /requires a non-empty masRootPath/,
  );

  await assert.rejects(
    () => readActionAffordancesForInvocation({
      masRootPath: 'instance',
      includeInactive: 'yes',
    }),
    /includeInactive must be a boolean/,
  );
});
