import test from 'node:test';
import assert from 'node:assert/strict';
import { assertAgentExecutionPlan } from '../../src/contracts/identity/agent-execution-plan-contract.js';

function createClarificationRequest(overrides = {}) {
  return {
    kind: 'action_clarification_request',
    version: 1,
    clarificationId: 'clarification-plan-001',
    question: 'Do you want the runtime to inspect the MAS or review workflow readiness?',
    reasonCategory: 'multiple_candidates',
    candidateIds: [
      'candidate-tool-inspect',
      'candidate-workflow-health',
    ],
    missingContext: [],
    warnings: [],
    blockingExecution: true,
    metadata: {
      locale: 'en',
    },
    ...overrides,
  };
}

function createValidPlan(overrides = {}) {
  return {
    kind: 'agent_execution_plan',
    version: 1,
    planId: 'plan-mas-inspect-001',
    goal: 'Inspect the MAS and report the current safe runtime state.',
    assumptions: [
      'The MAS root has already booted successfully.',
      'The request is read-only.',
    ],
    steps: [
      {
        kind: 'agent_execution_plan_step',
        version: 1,
        stepId: 'step-analysis-001',
        title: 'Review request and current runtime context',
        description: 'Confirm the request and make sure the selected action stays read-only.',
        stepType: 'analysis',
        targetType: null,
        targetId: null,
        dependsOnStepIds: [],
        completionCriteria: [
          'The request is understood as a read-only MAS inspection.',
        ],
        reason: 'A bounded understanding pass is required before selecting affordances.',
      },
      {
        kind: 'agent_execution_plan_step',
        version: 1,
        stepId: 'step-tool-001',
        title: 'Inspect MAS safely',
        description: 'Use the MAS inspection tool to gather bounded runtime evidence.',
        stepType: 'tool_execution',
        targetType: 'tool',
        targetId: 'mas.system.inspect',
        dependsOnStepIds: [
          'step-analysis-001',
        ],
        completionCriteria: [
          'A successful tool observation is captured for mas.system.inspect.',
        ],
        reason: 'The selected tool provides the required bounded read-only evidence.',
      },
      {
        kind: 'agent_execution_plan_step',
        version: 1,
        stepId: 'step-verify-001',
        title: 'Verify evidence before summarizing',
        description: 'Compare the tool observation with the intended request before final reporting.',
        stepType: 'verification',
        targetType: 'tool',
        targetId: 'mas.system.inspect',
        dependsOnStepIds: [
          'step-tool-001',
        ],
        completionCriteria: [
          'The tool observation is present and consistent with the request.',
        ],
        reason: 'The final answer must stay bounded to observed runtime evidence.',
      },
    ],
    requiredTools: [
      'mas.system.inspect',
    ],
    requiredWorkflows: [],
    requiredMemory: [
      {
        kind: 'agent_execution_plan_memory_requirement',
        version: 1,
        requirementId: 'memory-runtime-state-001',
        sourceType: 'runtime_state',
        sourceId: 'current-invocation-session',
        scope: 'mas_instance',
        requirementLevel: 'required',
        reason: 'The runtime plan needs bounded current-state context only.',
      },
    ],
    requiredApprovals: [],
    riskAssessment: {
      kind: 'agent_execution_plan_risk_assessment',
      version: 1,
      overallRiskLevel: 'low',
      summary: 'The plan is read-only and remains within known MAS affordances.',
      riskItems: [
        'The final answer must not overstate tool evidence.',
      ],
    },
    verificationCriteria: [
      {
        kind: 'agent_execution_plan_verification_criterion',
        version: 1,
        criterionId: 'verification-tool-observation-001',
        description: 'A successful tool observation exists for mas.system.inspect before the final summary.',
        evidenceTypes: [
          'tool_observation',
        ],
        targetType: 'tool',
        targetId: 'mas.system.inspect',
      },
    ],
    clarificationRequest: null,
    directExecutionAllowed: false,
    ...overrides,
  };
}

test('assertAgentExecutionPlan accepts a valid persistable read-only plan that references known affordances', () => {
  const plan = assertAgentExecutionPlan(createValidPlan(), {
    knownToolIds: [
      'mas.system.inspect',
      'mas.tools.inspect',
    ],
    knownWorkflowIds: [
      'mas-health-review',
    ],
  });

  assert.equal(plan.kind, 'agent_execution_plan');
  assert.equal(plan.directExecutionAllowed, false);
  assert.equal(plan.requiredTools[0], 'mas.system.inspect');
  assert.equal(plan.steps[1].stepType, 'tool_execution');
});

test('assertAgentExecutionPlan rejects direct execution and unknown affordance references', () => {
  assert.throws(() => {
    return assertAgentExecutionPlan(createValidPlan({
      directExecutionAllowed: true,
    }), {
      knownToolIds: [
        'mas.system.inspect',
      ],
    });
  }, /cannot directly execute/u);

  assert.throws(() => {
    return assertAgentExecutionPlan(createValidPlan({
      requiredTools: [
        'mas.unknown.inspect',
      ],
      steps: [
        {
          kind: 'agent_execution_plan_step',
          version: 1,
          stepId: 'step-tool-001',
          title: 'Unknown tool',
          description: 'Try to use an unknown tool.',
          stepType: 'tool_execution',
          targetType: 'tool',
          targetId: 'mas.unknown.inspect',
          dependsOnStepIds: [],
          completionCriteria: [
            'Impossible criterion',
          ],
          reason: 'This should fail validation.',
        },
      ],
    }), {
      knownToolIds: [
        'mas.system.inspect',
      ],
    });
  }, /unknown affordance identifier/u);
});

test('assertAgentExecutionPlan accepts a clarification-oriented plan and rejects secret-like unsupported fields', () => {
  const clarificationPlan = assertAgentExecutionPlan(createValidPlan({
    planId: 'plan-clarification-001',
    goal: 'Clarify whether the user wants inspection or workflow review.',
    steps: [
      {
        kind: 'agent_execution_plan_step',
        version: 1,
        stepId: 'step-clarify-001',
        title: 'Ask for clarification',
        description: 'Request one safe clarification before any affordance is selected.',
        stepType: 'clarification',
        targetType: null,
        targetId: null,
        dependsOnStepIds: [],
        completionCriteria: [
          'A clarification question is prepared for the user.',
        ],
        reason: 'The request is still ambiguous.',
      },
    ],
    requiredTools: [],
    requiredMemory: [],
    requiredApprovals: [],
    verificationCriteria: [
      {
        kind: 'agent_execution_plan_verification_criterion',
        version: 1,
        criterionId: 'verification-clarification-001',
        description: 'The plan emits one auditable clarification request.',
        evidenceTypes: [
          'brain_output',
        ],
        targetType: null,
        targetId: null,
      },
    ],
    clarificationRequest: createClarificationRequest(),
  }));

  assert.equal(clarificationPlan.clarificationRequest.kind, 'action_clarification_request');
  assert.equal(clarificationPlan.steps[0].stepType, 'clarification');

  assert.throws(() => {
    return assertAgentExecutionPlan(createValidPlan({
      requiredMemory: [
        {
          kind: 'agent_execution_plan_memory_requirement',
          version: 1,
          requirementId: 'memory-secret-001',
          sourceType: 'runtime_state',
          sourceId: 'current-invocation-session',
          scope: 'mas_instance',
          requirementLevel: 'required',
          reason: 'This should fail because secret payloads are not persistable here.',
          secretValue: 'sk-live-123',
        },
      ],
    }));
  }, /unsupported key: secretValue/u);
});
