import test from 'node:test';
import assert from 'node:assert/strict';
import { assertActionIntentMetadata } from '../../src/contracts/action-intent-metadata-contract.js';
import {
  assertToolDefinition,
  isToolActive,
  toolDefinitionRequiresApproval,
} from '../../src/contracts/tool-definition-contract.js';
import { assertToolResult } from '../../src/contracts/tool-result-contract.js';
import {
  assertWorkflowRuntimeDefinition,
  isWorkflowRuntimeActive,
} from '../../src/contracts/workflow-runtime-contract.js';
import {
  assertWorkflowRunState,
  isWorkflowRunTerminal,
} from '../../src/contracts/workflow-run-state-contract.js';

const VALID_CREATED_AT = '2026-04-16T00:00:00.000Z';
const VALID_UPDATED_AT = '2026-04-16T00:01:00.000Z';
const VALID_SHA_256 = 'f'.repeat(64);

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
      'The user asks for the current MAS state or inventory.',
    ],
    whenNotToUse: [
      'The user asks to mutate the MAS.',
    ],
    exampleRequests: [
      'Inspect the MAS.',
    ],
    classificationGuidance: {
      highConfidenceSignals: [
        'The user asks for a current MAS inspection.',
      ],
      ambiguitySignals: [
        'The user asks for a broad review without specifying depth.',
      ],
      negativeSignals: [
        'The user asks to create or publish something.',
      ],
      requiredContextKeys: [],
    },
    ...overrides,
  };
}

function buildMemorySourceReference(overrides = {}) {
  return {
    kind: 'memory_source_reference',
    version: 1,
    sourceType: 'tool_result',
    sourceId: 'tool-run-001',
    scope: 'operational_identity',
    ownerId: 'alfred',
    path: 'memory/artifacts/tool-result-tool-run-001.json',
    origin: 'runtime_observed',
    sensitivityLevel: 'internal',
    createdAt: VALID_CREATED_AT,
    contentSha256: VALID_SHA_256,
    ...overrides,
  };
}

function buildMemoryWritebackCandidate(overrides = {}) {
  return {
    kind: 'memory_write_candidate',
    writeId: 'write_tool_result_001',
    writeType: 'artifact_reference',
    targetMemoryType: 'artifact_reference',
    scope: 'operational_identity',
    ownerId: 'alfred',
    origin: 'runtime_observed',
    portability: 'mas_bound',
    visibility: 'private_to_owner',
    sensitivityLevel: 'internal',
    authorityLevel: 'runtime_evidence',
    summary: 'MAS inspection tool produced a diagnostic artifact.',
    content: null,
    sourceReferences: [buildMemorySourceReference()],
    subjectReferences: [
      {
        subjectType: 'tool_run',
        subjectId: 'tool-run-001',
        relationship: 'source-tool-run',
      },
    ],
    approvalState: 'pending',
    redactionState: 'not_required',
    sourceGovernance: {
      sourceScopes: ['operational_identity'],
      sourceOwnerIds: ['alfred'],
      mostRestrictiveVisibility: 'private_to_owner',
      highestSensitivityLevel: 'internal',
      requiresHumanApproval: false,
    },
    reason: 'The tool produced useful operational evidence.',
    warnings: [],
    ...overrides,
  };
}

function buildToolResult(overrides = {}) {
  return {
    kind: 'tool_result',
    version: 1,
    toolId: 'mas.system.inspect',
    toolRunId: 'tool-run-001',
    status: 'succeeded',
    summary: 'MAS system inspection completed.',
    data: {
      inspectedComponents: ['agents', 'memory', 'tools'],
    },
    artifacts: [
      {
        artifactId: 'artifact-tool-run-001',
        artifactKind: 'tool_result_snapshot',
        path: 'memory/artifacts/tool-result-tool-run-001.json',
        summary: 'Snapshot of the MAS system inspection result.',
      },
    ],
    warnings: [],
    errors: [],
    memoryWritebackCandidates: [buildMemoryWritebackCandidate()],
    audit: {
      invocationId: 'invocation-001',
      operationalIdentityId: 'alfred',
      requestedBy: 'cli',
      startedAt: VALID_CREATED_AT,
      completedAt: VALID_UPDATED_AT,
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
      'workflow',
    ],
    whenToUse: [
      'The user asks for a deeper MAS health review.',
    ],
    whenNotToUse: [
      'The user only asks for a quick inventory snapshot.',
    ],
    exampleRequests: [
      'Run a full MAS health review.',
    ],
    classificationGuidance: {
      highConfidenceSignals: [
        'The user asks for a comprehensive MAS diagnostic.',
      ],
      ambiguitySignals: [
        'The user asks for a review without clarifying depth.',
      ],
      negativeSignals: [
        'The user only asks for current counts.',
      ],
      requiredContextKeys: [],
    },
    ...overrides,
  };
}

function buildWorkflowRunState(overrides = {}) {
  return {
    kind: 'workflow_run_state',
    version: 1,
    workflowRunId: 'workflow-run-001',
    workflowId: 'mas-health-review',
    status: 'running',
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
    updatedAt: VALID_UPDATED_AT,
    warnings: [],
    ...overrides,
  };
}

test('assertToolDefinition accepts a valid read-only local tool definition', () => {
  const definition = assertToolDefinition(buildToolDefinition());

  assert.equal(definition.toolId, 'mas.system.inspect');
  assert.equal(definition.lifecycleState, 'active');
  assert.equal(definition.toolType, 'local_js_module');
  assert.equal(definition.sideEffectLevel, 'read_only');
  assert.equal(definition.execution.modulePath, 'executor.js');
  assert.equal(definition.memoryPolicy.allowWritebackCandidates, true);
  assert.equal(isToolActive(definition), true);
  assert.equal(toolDefinitionRequiresApproval(definition), false);
});

test('assertActionIntentMetadata accepts bounded non-authoritative action metadata', () => {
  const metadata = assertActionIntentMetadata(buildToolIntentMetadata());

  assert.equal(metadata.kind, 'action_intent_metadata');
  assert.equal(metadata.primaryIntentId, 'admin.mas.inspect');
  assert.equal(metadata.targetActionType, 'tool_execution');
  assert.equal(metadata.targetType, 'tool');
  assert.equal(metadata.targetId, 'mas.system.inspect');
  assert.equal(metadata.expectedSideEffectLevel, 'read_only');
  assert.deepEqual(metadata.requestTypes, ['diagnostic', 'tool_action']);
});

test('assertToolDefinition accepts intent metadata tied to the tool target', () => {
  const definition = assertToolDefinition(buildToolDefinition({
    intentMetadata: buildToolIntentMetadata(),
  }));

  assert.equal(definition.intentMetadata.primaryIntentId, 'admin.mas.inspect');
  assert.equal(definition.intentMetadata.targetType, 'tool');
  assert.equal(definition.intentMetadata.targetId, 'mas.system.inspect');
  assert.equal(definition.intentMetadata.targetActionType, 'tool_execution');
});

test('assertToolDefinition rejects intent metadata targeting a different tool', () => {
  assert.throws(
    () => assertToolDefinition(buildToolDefinition({
      intentMetadata: buildToolIntentMetadata({
        targetId: 'other.tool',
      }),
    })),
    /targetId must match mas\.system\.inspect/,
  );
});

test('assertToolDefinition rejects intent metadata with mismatched side effect level', () => {
  assert.throws(
    () => assertToolDefinition(buildToolDefinition({
      intentMetadata: buildToolIntentMetadata({
        expectedSideEffectLevel: 'write_internal',
      }),
    })),
    /expectedSideEffectLevel must match read_only/,
  );
});

test('assertActionIntentMetadata rejects unsafe semantic tags', () => {
  assert.throws(
    () => assertActionIntentMetadata(buildToolIntentMetadata({
      semanticTags: [
        'mas',
        'Unsafe Tag With Spaces',
      ],
    })),
    /unsafe tag characters/,
  );
});

test('assertToolDefinition rejects risky external tools without required approval', () => {
  assert.throws(
    () => assertToolDefinition(buildToolDefinition({
      toolId: 'meta.reply.publish',
      sideEffectLevel: 'publish_external',
      approvalPolicy: {
        required: false,
      },
    })),
    /must require approval/,
  );
});

test('assertToolDefinition accepts risky tools when approval is explicit', () => {
  const definition = assertToolDefinition(buildToolDefinition({
    toolId: 'meta.reply.publish',
    sideEffectLevel: 'publish_external',
    requiredAccessModes: ['publish'],
    approvalPolicy: {
      required: true,
    },
  }));

  assert.equal(definition.sideEffectLevel, 'publish_external');
  assert.equal(toolDefinitionRequiresApproval(definition), true);
});

test('assertToolDefinition rejects unbounded local module paths', () => {
  assert.throws(
    () => assertToolDefinition(buildToolDefinition({
      execution: {
        modulePath: '../outside.js',
      },
    })),
    /bounded relative path/,
  );

  assert.throws(
    () => assertToolDefinition(buildToolDefinition({
      execution: {
        modulePath: 'C:/outside.js',
      },
    })),
    /bounded relative path/,
  );
});

test('assertToolResult accepts a normalized successful result with artifact and writeback candidate', () => {
  const result = assertToolResult(buildToolResult());

  assert.equal(result.toolId, 'mas.system.inspect');
  assert.equal(result.status, 'succeeded');
  assert.equal(result.artifacts.length, 1);
  assert.equal(result.memoryWritebackCandidates.length, 1);
  assert.equal(result.audit.operationalIdentityId, 'alfred');
});

test('assertToolResult rejects successful results that include errors', () => {
  assert.throws(
    () => assertToolResult(buildToolResult({
      errors: ['unexpected error'],
    })),
    /must not include errors/,
  );
});

test('assertToolResult requires approval request metadata for approval-required results', () => {
  assert.throws(
    () => assertToolResult(buildToolResult({
      status: 'approval_required',
      summary: 'Publishing requires approval.',
      memoryWritebackCandidates: [],
    })),
    /approvalRequestId/,
  );

  const result = assertToolResult(buildToolResult({
    status: 'approval_required',
    summary: 'Publishing requires approval.',
    memoryWritebackCandidates: [],
    audit: {
      invocationId: 'invocation-001',
      operationalIdentityId: 'maria',
      requestedBy: 'cli',
      approvalRequestId: 'approval-001',
      startedAt: VALID_CREATED_AT,
      completedAt: VALID_UPDATED_AT,
    },
  }));

  assert.equal(result.status, 'approval_required');
  assert.equal(result.audit.approvalRequestId, 'approval-001');
});

test('assertWorkflowRuntimeDefinition accepts a valid executable workflow definition', () => {
  const definition = assertWorkflowRuntimeDefinition(buildWorkflowRuntimeDefinition());

  assert.equal(definition.workflowId, 'mas-health-review');
  assert.equal(definition.lifecycleState, 'active');
  assert.equal(definition.executionMode, 'on_demand');
  assert.equal(definition.steps.length, 2);
  assert.equal(definition.steps[1].dependsOn[0], 'inspect-system');
  assert.equal(isWorkflowRuntimeActive(definition), true);
});

test('assertWorkflowRuntimeDefinition accepts intent metadata tied to the workflow target', () => {
  const definition = assertWorkflowRuntimeDefinition(buildWorkflowRuntimeDefinition({
    intentMetadata: buildWorkflowIntentMetadata(),
  }));

  assert.equal(definition.intentMetadata.primaryIntentId, 'admin.mas.health_review');
  assert.equal(definition.intentMetadata.targetType, 'workflow');
  assert.equal(definition.intentMetadata.targetId, 'mas-health-review');
  assert.equal(definition.intentMetadata.targetActionType, 'workflow_execution');
});

test('assertWorkflowRuntimeDefinition rejects intent metadata with the wrong target action type', () => {
  assert.throws(
    () => assertWorkflowRuntimeDefinition(buildWorkflowRuntimeDefinition({
      intentMetadata: buildWorkflowIntentMetadata({
        targetActionType: 'tool_execution',
      }),
    })),
    /targetActionType must match workflow_execution/,
  );
});

test('assertWorkflowRuntimeDefinition rejects intent metadata targeting a different workflow', () => {
  assert.throws(
    () => assertWorkflowRuntimeDefinition(buildWorkflowRuntimeDefinition({
      intentMetadata: buildWorkflowIntentMetadata({
        targetId: 'other-workflow',
      }),
    })),
    /targetId must match mas-health-review/,
  );
});

test('assertWorkflowRuntimeDefinition rejects duplicated step ids', () => {
  assert.throws(
    () => assertWorkflowRuntimeDefinition(buildWorkflowRuntimeDefinition({
      steps: [
        {
          stepId: 'same-step',
          stepType: 'agent_brain',
        },
        {
          stepId: 'same-step',
          stepType: 'agent_brain',
        },
      ],
    })),
    /duplicated stepId/,
  );
});

test('assertWorkflowRuntimeDefinition rejects unknown dependencies and self dependencies', () => {
  assert.throws(
    () => assertWorkflowRuntimeDefinition(buildWorkflowRuntimeDefinition({
      steps: [
        {
          stepId: 'build-report',
          stepType: 'agent_brain',
          dependsOn: ['missing-step'],
        },
      ],
    })),
    /unknown stepId/,
  );

  assert.throws(
    () => assertWorkflowRuntimeDefinition(buildWorkflowRuntimeDefinition({
      steps: [
        {
          stepId: 'loop-step',
          stepType: 'agent_brain',
          dependsOn: ['loop-step'],
        },
      ],
    })),
    /must not depend on itself/,
  );
});

test('assertWorkflowRuntimeDefinition rejects dependency cycles', () => {
  assert.throws(
    () => assertWorkflowRuntimeDefinition(buildWorkflowRuntimeDefinition({
      steps: [
        {
          stepId: 'first-step',
          stepType: 'agent_brain',
          dependsOn: ['second-step'],
        },
        {
          stepId: 'second-step',
          stepType: 'agent_brain',
          dependsOn: ['first-step'],
        },
      ],
    })),
    /dependency cycle/,
  );
});

test('assertWorkflowRuntimeDefinition requires tool_call steps to include toolId', () => {
  assert.throws(
    () => assertWorkflowRuntimeDefinition(buildWorkflowRuntimeDefinition({
      steps: [
        {
          stepId: 'inspect-system',
          stepType: 'tool_call',
        },
      ],
    })),
    /must include a non-empty toolId/,
  );
});

test('assertWorkflowRunState accepts running and terminal workflow state records', () => {
  const runningState = assertWorkflowRunState(buildWorkflowRunState());

  assert.equal(runningState.status, 'running');
  assert.equal(runningState.currentStepId, 'inspect-system');
  assert.equal(isWorkflowRunTerminal(runningState), false);

  const succeededState = assertWorkflowRunState(buildWorkflowRunState({
    status: 'succeeded',
    currentStepId: null,
    completedSteps: ['inspect-system', 'build-report'],
    artifactReferences: [
      {
        artifactId: 'artifact-workflow-report-001',
        artifactKind: 'workflow_report',
        path: 'memory/artifacts/workflow-report-001.md',
      },
    ],
  }));

  assert.equal(succeededState.status, 'succeeded');
  assert.equal(isWorkflowRunTerminal(succeededState), true);
  assert.equal(succeededState.artifactReferences.length, 1);
});

test('assertWorkflowRunState requires approval requests when waiting for approval', () => {
  assert.throws(
    () => assertWorkflowRunState(buildWorkflowRunState({
      status: 'waiting_for_approval',
      currentStepId: 'publish-reply',
    })),
    /must include at least one approval request/,
  );

  const state = assertWorkflowRunState(buildWorkflowRunState({
    status: 'waiting_for_approval',
    currentStepId: 'publish-reply',
    approvalRequests: ['approval-001'],
    blockedSteps: ['publish-reply'],
  }));

  assert.equal(state.status, 'waiting_for_approval');
  assert.deepEqual(state.approvalRequests, ['approval-001']);
});

test('assertWorkflowRunState rejects inconsistent succeeded and terminal state records', () => {
  assert.throws(
    () => assertWorkflowRunState(buildWorkflowRunState({
      status: 'succeeded',
      currentStepId: null,
      failedSteps: ['inspect-system'],
    })),
    /must not include failedSteps/,
  );

  assert.throws(
    () => assertWorkflowRunState(buildWorkflowRunState({
      status: 'failed',
      currentStepId: 'inspect-system',
      failedSteps: ['inspect-system'],
    })),
    /must not include currentStepId/,
  );
});
