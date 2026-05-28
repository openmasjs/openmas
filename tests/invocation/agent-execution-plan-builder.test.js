import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAgentExecutionPlanForInvocation } from '../../src/plans/build-agent-execution-plan-for-invocation.js';

function createRequest(overrides = {}) {
  return {
    command: 'ask',
    invocationMode: 'probabilistic',
    requestedBy: 'cli',
    inputText: 'Please inspect the MAS.',
    conversationId: null,
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

test('buildAgentExecutionPlanForInvocation returns null for answer-only action resolution', () => {
  const executionPlan = buildAgentExecutionPlanForInvocation({
    invocationId: 'invocation-answer-only-001',
    request: createRequest({
      inputText: 'Hola Alfred, solo quería saludarte.',
    }),
    actionResolution: {
      status: 'no_action',
      source: 'semantic_classifier',
      reason: 'The turn is conversational and does not require runtime execution.',
    },
    semanticIntentRuntime: createSemanticIntentRuntime({
      status: 'failed',
    }),
    knownToolIds: [
      'mas.system.inspect',
    ],
    knownWorkflowIds: [
      'mas-health-review',
    ],
  });

  assert.equal(executionPlan, null);
});

test('buildAgentExecutionPlanForInvocation builds a validated minimal tool-execution plan', () => {
  const executionPlan = buildAgentExecutionPlanForInvocation({
    invocationId: 'invocation-tool-plan-001',
    request: createRequest({
      conversationId: 'alfred-admin',
    }),
    actionResolution: createActionResolution(),
    toolRequestResolution: {
      status: 'accepted',
    },
    semanticIntentRuntime: createSemanticIntentRuntime(),
    knownToolIds: [
      'mas.system.inspect',
    ],
    knownWorkflowIds: [
      'mas-health-review',
    ],
  });

  assert.equal(executionPlan.kind, 'agent_execution_plan');
  assert.equal(executionPlan.requiredTools[0], 'mas.system.inspect');
  assert.equal(executionPlan.requiredWorkflows.length, 0);
  assert.equal(executionPlan.steps[1].stepType, 'tool_execution');
  assert.equal(executionPlan.steps[1].targetId, 'mas.system.inspect');
  assert.equal(executionPlan.verificationCriteria[0].evidenceTypes[0], 'tool_observation');
  assert.equal(executionPlan.requiredMemory.some((entry) => entry.sourceType === 'conversation_context'), true);
});

test('buildAgentExecutionPlanForInvocation builds a validated minimal workflow-execution plan', () => {
  const executionPlan = buildAgentExecutionPlanForInvocation({
    invocationId: 'invocation-workflow-plan-001',
    request: createRequest({
      inputText: 'Please run the MAS health review.',
    }),
    actionResolution: createActionResolution({
      selectedCandidate: {
        targetType: 'workflow',
        targetId: 'mas-health-review',
        sideEffectLevel: 'read_only',
        reason: 'Run the workflow that reviews MAS health safely.',
      },
    }),
    workflowRequestResolution: {
      status: 'accepted',
    },
    semanticIntentRuntime: createSemanticIntentRuntime({
      semanticIntentClassification: {
        actionIntent: {
          understanding: {
            requestedOutcome: 'Run the MAS health review workflow and summarize the result.',
            summary: 'Use the workflow that inspects the MAS before answering.',
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

  assert.equal(executionPlan.kind, 'agent_execution_plan');
  assert.equal(executionPlan.requiredTools.length, 0);
  assert.equal(executionPlan.requiredWorkflows[0], 'mas-health-review');
  assert.equal(executionPlan.steps[1].stepType, 'workflow_execution');
  assert.equal(executionPlan.steps[1].targetId, 'mas-health-review');
  assert.equal(executionPlan.verificationCriteria[0].evidenceTypes[0], 'workflow_observation');
});

test('buildAgentExecutionPlanForInvocation builds a preview-only plan without authorizing execution', () => {
  const executionPlan = buildAgentExecutionPlanForInvocation({
    invocationId: 'invocation-preview-plan-001',
    request: createRequest({
      inputText: 'Podrias presentarme el plan de inspeccion del MAS antes de ejecutar nada?',
    }),
    actionResolution: createActionResolution({
      status: 'plan_only',
      executionAllowed: false,
      reason: 'The runtime selected a governed inspection target and is previewing the plan only.',
      metadata: {
        planMode: 'preview_only',
        previewApprovalRequired: false,
        previewRuntimeAction: 'queue_tool_request',
      },
    }),
    semanticIntentRuntime: createSemanticIntentRuntime({
      semanticIntentClassification: {
        actionIntent: {
          understanding: {
            requestedOutcome: 'Preview the governed inspection plan before any execution begins.',
            summary: 'Show the inspection plan before running the selected tool.',
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

  assert.equal(executionPlan.metadata.planMode, 'preview_only');
  assert.equal(executionPlan.metadata.locale, 'es');
  assert.equal(executionPlan.metadata.localizationMode, 'runtime_localized');
  assert.equal(executionPlan.riskAssessment.metadata.locale, 'es');
  assert.equal(executionPlan.requiredTools[0], 'mas.system.inspect');
  assert.equal(executionPlan.requiredApprovals.length, 0);
  assert.match(executionPlan.assumptions.join('\n'), /previews the governed execution plan/i);
  assert.match(executionPlan.steps[1].description, /When approved to proceed, run tool mas\.system\.inspect/i);
});

test('buildAgentExecutionPlanForInvocation preserves locale on clarification plans', () => {
  const executionPlan = buildAgentExecutionPlanForInvocation({
    invocationId: 'invocation-clarification-plan-001',
    request: createRequest({
      inputText: 'Hola Alfred, podrias aclarar cual herramienta debo usar?',
    }),
    actionResolution: {
      status: 'needs_clarification',
      source: 'semantic_classifier',
      reason: 'The runtime requires clarification before selecting the safest action.',
      clarificationRequest: {
        kind: 'action_clarification_request',
        version: 1,
        clarificationId: 'clarification-locale-001',
        reasonCategory: 'multiple_candidates',
        question: 'Quieres que use herramienta "MAS System Inspect", o flujo "MAS Health Review"?',
        candidateIds: [],
        missingContext: [],
        blockingExecution: true,
        warnings: [],
        metadata: {
          kind: 'action_clarification_metadata',
          version: 1,
          locale: 'es',
          localizationMode: 'runtime_localized',
        },
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

  assert.equal(executionPlan.metadata.locale, 'es');
  assert.equal(executionPlan.metadata.localizationMode, 'runtime_localized');
  assert.equal(executionPlan.riskAssessment.metadata.locale, 'es');
  assert.equal(executionPlan.clarificationRequest.metadata.locale, 'es');
});

test('buildAgentExecutionPlanForInvocation fails closed when the selected affordance is unknown', () => {
  assert.throws(() => {
    buildAgentExecutionPlanForInvocation({
      invocationId: 'invocation-invalid-plan-001',
      request: createRequest(),
      actionResolution: createActionResolution({
        selectedCandidate: {
          targetType: 'tool',
          targetId: 'mas.unknown.inspect',
          sideEffectLevel: 'read_only',
          reason: 'Inspect an unknown target.',
        },
      }),
      toolRequestResolution: {
        status: 'accepted',
      },
      semanticIntentRuntime: createSemanticIntentRuntime(),
      knownToolIds: [
        'mas.system.inspect',
      ],
      knownWorkflowIds: [],
    });
  }, /unknown affordance identifier/u);
});
