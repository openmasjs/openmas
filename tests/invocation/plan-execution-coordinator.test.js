import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAgentExecutionPlanForInvocation } from '../../src/plans/build-agent-execution-plan-for-invocation.js';
import { coordinatePlanExecutionForInvocation } from '../../src/plans/coordinate-plan-execution-for-invocation.js';

function createRequest(overrides = {}) {
  return {
    command: 'ask',
    invocationMode: 'probabilistic',
    requestedBy: 'cli',
    inputText: 'Please inspect the MAS.',
    conversationId: 'alfred-admin',
    ...overrides,
  };
}

function createSemanticIntentRuntime(overrides = {}) {
  return {
    status: 'completed',
    semanticIntentClassification: {
      actionIntent: {
        understanding: {
          requestedOutcome: 'Inspect the MAS and report the current runtime state.',
          summary: 'Inspect the MAS safely before answering.',
        },
      },
    },
    ...overrides,
  };
}

function createActionResolution(overrides = {}) {
  return {
    status: 'accepted',
    source: 'semantic_classifier',
    executionAllowed: true,
    approvalRequired: false,
    reason: 'The runtime selected the safest matching capability for this request.',
    selectedCandidate: {
      targetType: 'tool',
      targetId: 'mas.system.inspect',
      sideEffectLevel: 'read_only',
      reason: 'Inspect the MAS safely before answering.',
    },
    ...overrides,
  };
}

function buildReadyVerdict(overrides = {}) {
  return {
    kind: 'tool_readiness_verdict',
    version: 1,
    toolId: 'mas.system.inspect',
    status: 'ready',
    approvalRequired: false,
    reason: 'Tool mas.system.inspect passed readiness gates and can be requested for execution.',
    matchedBindings: [
      {
        resourceId: 'mas-filesystem',
        resourceType: 'storage',
        accessMode: 'read',
        credentialReferenceId: null,
        secretResolutionStatus: null,
      },
    ],
    missingRequirements: [],
    warnings: [],
    ...overrides,
  };
}

function buildToolRequest(overrides = {}) {
  return {
    kind: 'brain_tool_request',
    version: 1,
    toolRequestId: 'tool-request-001',
    toolId: 'mas.system.inspect',
    input: {
      includeCounts: true,
    },
    purpose: 'Inspect the MAS before answering.',
    expectedSideEffectLevel: 'read_only',
    ...overrides,
  };
}

function buildAcceptedToolResolution(overrides = {}) {
  const toolRequest = buildToolRequest(overrides.toolRequest ?? {});

  return {
    kind: 'brain_tool_request_resolution',
    version: 1,
    status: 'accepted',
    requestedToolId: toolRequest.toolId,
    toolRequest,
    toolReadinessVerdict: buildReadyVerdict(overrides.toolReadinessVerdict ?? {}),
    executionAllowed: true,
    approvalRequired: false,
    autoExecutionPerformed: false,
    runtimeAction: 'queue_for_execution',
    reason: `Brain tool request for ${toolRequest.toolId} was accepted for runtime execution.`,
    warnings: [],
  };
}

function buildApprovalRequiredToolResolution() {
  const toolRequest = buildToolRequest({
    toolRequestId: 'tool-request-approval-001',
    expectedSideEffectLevel: 'publish_external',
  });

  return {
    kind: 'brain_tool_request_resolution',
    version: 1,
    status: 'approval_required',
    requestedToolId: toolRequest.toolId,
    toolRequest,
    toolReadinessVerdict: buildReadyVerdict({
      status: 'approval_required',
      approvalRequired: true,
      reason: 'Tool requires human approval before execution.',
    }),
    executionAllowed: false,
    approvalRequired: true,
    autoExecutionPerformed: false,
    runtimeAction: 'request_human_approval',
    reason: `Brain tool request for ${toolRequest.toolId} requires human approval before execution.`,
    warnings: [],
  };
}

function buildWorkflowRequest(overrides = {}) {
  return {
    kind: 'brain_workflow_request',
    version: 1,
    workflowRequestId: 'workflow-request-001',
    workflowId: 'mas-health-review',
    input: {
      includeCounts: true,
    },
    purpose: 'Run the MAS health review before answering.',
    expectedSideEffectLevel: 'read_only',
    ...overrides,
  };
}

function buildWorkflowRuntimeDefinition() {
  return {
    kind: 'workflow_runtime_definition',
    version: 1,
    workflowId: 'mas-health-review',
    lifecycleState: 'active',
    executionMode: 'on_demand',
    statePolicy: {
      persistState: true,
      resumeAllowed: false,
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
  };
}

function buildAcceptedWorkflowResolution(overrides = {}) {
  const workflowRequest = buildWorkflowRequest(overrides.workflowRequest ?? {});

  return {
    kind: 'brain_workflow_request_resolution',
    version: 1,
    status: 'accepted',
    requestedWorkflowId: workflowRequest.workflowId,
    workflowRequest,
    workflowRuntimeDefinition: buildWorkflowRuntimeDefinition(),
    executionAllowed: true,
    autoExecutionPerformed: false,
    runtimeAction: 'queue_for_execution',
    reason: `Brain workflow request for ${workflowRequest.workflowId} was accepted for runtime execution.`,
    warnings: [],
  };
}

test('coordinatePlanExecutionForInvocation returns null when no plan is present', () => {
  const coordination = coordinatePlanExecutionForInvocation({
    executionPlan: null,
  });

  assert.equal(coordination, null);
});

test('coordinatePlanExecutionForInvocation returns no_execution for clarification-only plans', () => {
  const executionPlan = buildAgentExecutionPlanForInvocation({
    invocationId: 'invocation-clarification-plan-001',
    request: createRequest(),
    actionResolution: {
      status: 'needs_clarification',
      source: 'semantic_classifier',
      reason: 'The runtime needs more detail before execution.',
      clarificationRequest: {
        kind: 'action_clarification_request',
        version: 1,
        clarificationId: 'clarification-001',
        reasonCategory: 'missing_context',
        question: 'Which MAS area should be inspected?',
        blockingExecution: true,
        candidates: [],
        missingContext: [
          'inspection_scope',
        ],
        warnings: [],
      },
    },
    semanticIntentRuntime: createSemanticIntentRuntime(),
    knownToolIds: [
      'mas.system.inspect',
    ],
    knownWorkflowIds: [
      'mas-health-review',
    ],
  });
  const coordination = coordinatePlanExecutionForInvocation({
    executionPlan,
  });

  assert.equal(coordination.status, 'no_execution');
  assert.equal(coordination.runtimeAction, 'none');
  assert.equal(coordination.selectedStepType, 'clarification');
});

test('coordinatePlanExecutionForInvocation keeps preview-only plans non-executable while preserving the selected target', () => {
  const actionResolution = createActionResolution({
    status: 'plan_only',
    executionAllowed: false,
    reason: 'Preview the governed inspection plan before execution.',
    metadata: {
      planMode: 'preview_only',
      previewApprovalRequired: false,
      previewRuntimeAction: 'queue_tool_request',
    },
  });
  const executionPlan = buildAgentExecutionPlanForInvocation({
    invocationId: 'invocation-preview-plan-001',
    request: createRequest(),
    actionResolution,
    semanticIntentRuntime: createSemanticIntentRuntime(),
    knownToolIds: [
      'mas.system.inspect',
    ],
    knownWorkflowIds: [
      'mas-health-review',
    ],
  });
  const coordination = coordinatePlanExecutionForInvocation({
    executionPlan,
    actionResolution,
    toolRequestResolution: buildAcceptedToolResolution(),
  });

  assert.equal(coordination.status, 'no_execution');
  assert.equal(coordination.runtimeAction, 'none');
  assert.equal(coordination.selectedStepType, 'tool_execution');
  assert.equal(coordination.selectedTargetId, 'mas.system.inspect');
  assert.equal(coordination.metadata.previewOnly, true);
});

test('coordinatePlanExecutionForInvocation returns ready for an accepted read-only tool plan', () => {
  const actionResolution = createActionResolution();
  const toolRequestResolution = buildAcceptedToolResolution();
  const executionPlan = buildAgentExecutionPlanForInvocation({
    invocationId: 'invocation-tool-plan-001',
    request: createRequest(),
    actionResolution,
    toolRequestResolution,
    semanticIntentRuntime: createSemanticIntentRuntime(),
    knownToolIds: [
      'mas.system.inspect',
    ],
    knownWorkflowIds: [
      'mas-health-review',
    ],
  });
  const coordination = coordinatePlanExecutionForInvocation({
    executionPlan,
    actionResolution,
    toolRequestResolution,
  });

  assert.equal(coordination.status, 'ready');
  assert.equal(coordination.runtimeAction, 'queue_tool_request');
  assert.equal(coordination.selectedTargetType, 'tool');
  assert.equal(coordination.selectedTargetId, 'mas.system.inspect');
  assert.equal(coordination.toolRequestResolution.status, 'accepted');
});

test('coordinatePlanExecutionForInvocation pauses risky tool plans for approval', () => {
  const actionResolution = createActionResolution({
    status: 'approval_required',
    executionAllowed: false,
    approvalRequired: true,
    selectedCandidate: {
      targetType: 'tool',
      targetId: 'mas.system.inspect',
      sideEffectLevel: 'publish_external',
      reason: 'The tool is risky and requires approval.',
    },
  });
  const toolRequestResolution = buildApprovalRequiredToolResolution();
  const executionPlan = buildAgentExecutionPlanForInvocation({
    invocationId: 'invocation-tool-approval-plan-001',
    request: createRequest(),
    actionResolution,
    toolRequestResolution,
    semanticIntentRuntime: createSemanticIntentRuntime(),
    knownToolIds: [
      'mas.system.inspect',
    ],
    knownWorkflowIds: [
      'mas-health-review',
    ],
  });
  const coordination = coordinatePlanExecutionForInvocation({
    executionPlan,
    actionResolution,
    toolRequestResolution,
    humanApprovalRuntime: {
      approvalRequest: {
        approvalRequestId: 'approval-invocation-tool-approval-plan-001',
      },
      approvalState: {
        status: 'pending',
      },
      executionAuthorized: false,
    },
  });

  assert.equal(coordination.status, 'approval_required');
  assert.equal(coordination.runtimeAction, 'pause_for_approval');
  assert.equal(coordination.approvalRequired, true);
  assert.equal(coordination.approvalRequestId, 'approval-invocation-tool-approval-plan-001');
});

test('coordinatePlanExecutionForInvocation returns ready for an accepted read-only workflow plan', () => {
  const actionResolution = createActionResolution({
    selectedCandidate: {
      targetType: 'workflow',
      targetId: 'mas-health-review',
      sideEffectLevel: 'read_only',
      reason: 'Run the governed MAS health review workflow.',
    },
  });
  const workflowRequestResolution = buildAcceptedWorkflowResolution();
  const executionPlan = buildAgentExecutionPlanForInvocation({
    invocationId: 'invocation-workflow-plan-001',
    request: createRequest({
      inputText: 'Run the MAS health review.',
    }),
    actionResolution,
    workflowRequestResolution,
    semanticIntentRuntime: createSemanticIntentRuntime({
      semanticIntentClassification: {
        actionIntent: {
          understanding: {
            requestedOutcome: 'Run the MAS health review workflow.',
            summary: 'Use the workflow that inspects MAS health before answering.',
          },
        },
      },
    }),
    knownToolIds: [
      'mas.system.inspect',
    ],
    knownWorkflowIds: [
      'mas-health-review',
    ],
  });
  const coordination = coordinatePlanExecutionForInvocation({
    executionPlan,
    actionResolution,
    workflowRequestResolution,
  });

  assert.equal(coordination.status, 'ready');
  assert.equal(coordination.runtimeAction, 'queue_workflow_request');
  assert.equal(coordination.selectedTargetType, 'workflow');
  assert.equal(coordination.selectedTargetId, 'mas-health-review');
  assert.equal(coordination.workflowRequestResolution.status, 'accepted');
});

test('coordinatePlanExecutionForInvocation fails closed when the selected plan target and runtime request diverge', () => {
  const actionResolution = createActionResolution();
  const toolRequestResolution = buildAcceptedToolResolution({
    toolRequest: {
      toolId: 'mas.permissions.inspect',
    },
  });
  const executionPlan = buildAgentExecutionPlanForInvocation({
    invocationId: 'invocation-mismatch-plan-001',
    request: createRequest(),
    actionResolution,
    toolRequestResolution: buildAcceptedToolResolution(),
    semanticIntentRuntime: createSemanticIntentRuntime(),
    knownToolIds: [
      'mas.system.inspect',
      'mas.permissions.inspect',
    ],
    knownWorkflowIds: [
      'mas-health-review',
    ],
  });
  const coordination = coordinatePlanExecutionForInvocation({
    executionPlan,
    actionResolution,
    toolRequestResolution,
  });

  assert.equal(coordination.status, 'failed');
  assert.equal(coordination.runtimeAction, 'stop');
});
