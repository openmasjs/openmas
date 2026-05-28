import test from 'node:test';
import assert from 'node:assert/strict';
import { assertActionResultAssessment } from '../../src/contracts/action-result-assessment-contract.js';
import { evaluateActionResultAssessmentForInvocation } from '../../src/actions/evaluate-action-result-assessment-for-invocation.js';

function buildBrainOutput(overrides = {}) {
  return {
    kind: 'brain_output',
    version: 1,
    executionType: 'probabilistic_brain',
    status: 'completed',
    providerId: 'openrouter-api',
    modelId: 'openrouter/free',
    requestType: 'chat_completion',
    outputText: 'Done.',
    warnings: [],
    ...overrides,
  };
}

function buildAcceptedToolActionResolution() {
  return {
    kind: 'action_resolution',
    version: 1,
    status: 'accepted',
    runtimeAction: 'queue_tool_request',
    selectedCandidate: {
      actionType: 'tool_execution',
      targetType: 'tool',
      targetId: 'mas.system.inspect',
      sideEffectLevel: 'read_only',
    },
    reason: 'Tool action accepted.',
  };
}

function buildClarificationActionResolution() {
  return {
    kind: 'action_resolution',
    version: 1,
    status: 'needs_clarification',
    runtimeAction: 'ask_clarification',
    selectedCandidate: null,
    clarificationRequest: {
      question: 'Do you want a quick inspection or a full health review?',
    },
    reason: 'The requested action needs clarification.',
  };
}

function buildDeniedActionResolution() {
  return {
    kind: 'action_resolution',
    version: 1,
    status: 'denied',
    runtimeAction: 'reject',
    selectedCandidate: {
      actionType: 'tool_execution',
      targetType: 'tool',
      targetId: 'mas.secret.delete',
      sideEffectLevel: 'destructive',
    },
    reason: 'The requested action was denied.',
  };
}

function buildToolRequestResolution(overrides = {}) {
  return {
    kind: 'brain_tool_request_resolution',
    version: 1,
    status: 'accepted',
    requestedToolId: 'mas.system.inspect',
    runtimeAction: 'queue_for_execution',
    reason: 'Tool request accepted.',
    ...overrides,
  };
}

function buildSuccessfulToolExecution() {
  return {
    kind: 'brain_tool_execution_result',
    version: 1,
    status: 'executed',
    executionPerformed: true,
    requestedToolId: 'mas.system.inspect',
    toolRunId: 'tool-run-001',
    toolResultStatus: 'succeeded',
    reason: 'Tool executed.',
    observation: {
      kind: 'brain_tool_observation',
      version: 1,
      toolId: 'mas.system.inspect',
      toolRunId: 'tool-run-001',
      status: 'succeeded',
      summary: 'MAS inspection succeeded.',
    },
  };
}

function buildFailedToolExecution() {
  return {
    ...buildSuccessfulToolExecution(),
    toolResultStatus: 'failed',
    reason: 'Tool execution failed.',
    observation: {
      ...buildSuccessfulToolExecution().observation,
      status: 'failed',
      summary: 'MAS inspection failed.',
    },
  };
}

function buildWorkflowExecution(overrides = {}) {
  return {
    kind: 'brain_workflow_execution_result',
    version: 1,
    status: 'executed',
    executionPerformed: true,
    requestedWorkflowId: 'mas-health-review',
    workflowRunId: 'workflow-run-001',
    workflowRunStatus: 'succeeded',
    reason: 'Workflow executed.',
    observation: {
      kind: 'brain_workflow_observation',
      version: 1,
      workflowId: 'mas-health-review',
      workflowRunId: 'workflow-run-001',
      status: 'succeeded',
      summary: 'MAS health review succeeded.',
    },
    ...overrides,
  };
}

function buildActionClaimGuard(overrides = {}) {
  return {
    kind: 'action_claim_guard',
    version: 1,
    status: 'no_claims',
    claimCount: 0,
    supportedClaimCount: 0,
    unsupportedClaimCount: 0,
    warnings: [],
    ...overrides,
  };
}

function buildVerificationGate(overrides = {}) {
  return {
    kind: 'verification_gate',
    version: 1,
    status: 'passed',
    verificationOutcome: 'verified',
    requestedAction: {
      actionType: 'tool_execution',
      targetType: 'tool',
      targetId: 'mas.system.inspect',
      runtimeAction: 'queue_tool_request',
      sideEffectLevel: 'read_only',
    },
    executionObserved: true,
    evidenceRequirements: [],
    claimSupportSummary: {
      totalClaims: 0,
      relevantClaims: 0,
      supportedClaims: 0,
      unsupportedClaims: 0,
    },
    reason: 'Runtime verification requirements were satisfied by persisted execution evidence.',
    recommendedNextActions: [
      'Use persisted evidence.',
    ],
    warnings: [],
    ...overrides,
  };
}

test('assertActionResultAssessment accepts a valid success assessment', () => {
  const assessment = assertActionResultAssessment({
    kind: 'action_result_assessment',
    version: 1,
    status: 'success',
    requestFulfillment: 'fulfilled',
    requestedAction: {
      actionType: 'tool_execution',
      targetType: 'tool',
      targetId: 'mas.system.inspect',
      runtimeAction: 'queue_tool_request',
      sideEffectLevel: 'read_only',
    },
    executionObserved: true,
    approvalPaused: false,
    clarificationRequired: false,
    finalAnswerAssessment: {
      answerGroundedInEvidence: true,
      claimGuardStatus: 'supported',
      unsupportedClaimCount: 0,
    },
    reason: 'Runtime execution succeeded.',
    evidence: [
      {
        evidenceType: 'tool_observation',
        targetId: 'mas.system.inspect',
        runId: 'tool-run-001',
        status: 'succeeded',
        summary: 'Tool observation succeeded.',
      },
    ],
    finalAnswerGuidance: [
      'Use runtime evidence.',
    ],
    recommendedNextActions: [
      'Review persisted evidence.',
    ],
    warnings: [],
  });

  assert.equal(assessment.status, 'success');
  assert.equal(assessment.requestFulfillment, 'fulfilled');
});

test('assertActionResultAssessment rejects inconsistent success fulfillment', () => {
  assert.throws(() => {
    assertActionResultAssessment({
      kind: 'action_result_assessment',
      version: 1,
      status: 'success',
      requestFulfillment: 'not_fulfilled',
      requestedAction: null,
      executionObserved: true,
      approvalPaused: false,
      clarificationRequired: false,
      finalAnswerAssessment: {
        answerGroundedInEvidence: true,
        claimGuardStatus: 'supported',
        unsupportedClaimCount: 0,
      },
      reason: 'Invalid.',
      evidence: [],
      finalAnswerGuidance: [],
      recommendedNextActions: [],
      warnings: [],
    });
  }, /Successful action result assessment must be fulfilled/u);
});

test('evaluateActionResultAssessmentForInvocation marks successful tool execution as fulfilled', () => {
  const assessment = evaluateActionResultAssessmentForInvocation({
    brainOutput: buildBrainOutput(),
    actionResolution: buildAcceptedToolActionResolution(),
    toolRequestResolution: buildToolRequestResolution(),
    brainToolExecution: buildSuccessfulToolExecution(),
    actionClaimGuard: buildActionClaimGuard({
      status: 'supported',
    }),
  });

  assert.equal(assessment.status, 'success');
  assert.equal(assessment.requestFulfillment, 'fulfilled');
  assert.equal(assessment.executionObserved, true);
  assert.equal(assessment.finalAnswerAssessment.answerGroundedInEvidence, true);
  assert.equal(assessment.evidence.some((item) => item.evidenceType === 'tool_observation'), true);
});

test('evaluateActionResultAssessmentForInvocation marks failed tool execution as failure', () => {
  const assessment = evaluateActionResultAssessmentForInvocation({
    brainOutput: buildBrainOutput(),
    actionResolution: buildAcceptedToolActionResolution(),
    toolRequestResolution: buildToolRequestResolution(),
    brainToolExecution: buildFailedToolExecution(),
    actionClaimGuard: buildActionClaimGuard(),
  });

  assert.equal(assessment.status, 'failure');
  assert.equal(assessment.requestFulfillment, 'not_fulfilled');
  assert.equal(assessment.executionObserved, true);
  assert.match(assessment.reason, /failed/u);
});

test('evaluateActionResultAssessmentForInvocation separates approval pauses from no-execution failures', () => {
  const assessment = evaluateActionResultAssessmentForInvocation({
    brainOutput: buildBrainOutput(),
    actionResolution: {
      ...buildAcceptedToolActionResolution(),
      status: 'approval_required',
      runtimeAction: 'request_human_approval',
      reason: 'Approval is required.',
    },
    toolRequestResolution: buildToolRequestResolution({
      status: 'approval_required',
      runtimeAction: 'request_human_approval',
      reason: 'Human approval required.',
    }),
    humanApprovalRuntime: {
      approvalState: {
        status: 'pending',
        approvalRequestId: 'approval-001',
        reason: 'Pending approval.',
      },
    },
    actionClaimGuard: buildActionClaimGuard(),
  });

  assert.equal(assessment.status, 'approval_pause');
  assert.equal(assessment.requestFulfillment, 'pending_approval');
  assert.equal(assessment.approvalPaused, true);
  assert.equal(assessment.executionObserved, false);
});

test('evaluateActionResultAssessmentForInvocation separates clarification from execution failure', () => {
  const assessment = evaluateActionResultAssessmentForInvocation({
    brainOutput: buildBrainOutput(),
    actionResolution: buildClarificationActionResolution(),
    actionClaimGuard: buildActionClaimGuard(),
  });

  assert.equal(assessment.status, 'clarification_required');
  assert.equal(assessment.requestFulfillment, 'needs_clarification');
  assert.equal(assessment.clarificationRequired, true);
  assert.match(assessment.recommendedNextActions[0], /quick inspection/u);
});

test('evaluateActionResultAssessmentForInvocation marks denied actions as no execution', () => {
  const assessment = evaluateActionResultAssessmentForInvocation({
    brainOutput: buildBrainOutput(),
    actionResolution: buildDeniedActionResolution(),
    actionClaimGuard: buildActionClaimGuard(),
  });

  assert.equal(assessment.status, 'no_execution');
  assert.equal(assessment.requestFulfillment, 'not_fulfilled');
  assert.equal(assessment.executionObserved, false);
});

test('evaluateActionResultAssessmentForInvocation marks successful execution plus unsupported answer claims as partial', () => {
  const assessment = evaluateActionResultAssessmentForInvocation({
    brainOutput: buildBrainOutput(),
    actionResolution: buildAcceptedToolActionResolution(),
    toolRequestResolution: buildToolRequestResolution(),
    brainToolExecution: buildSuccessfulToolExecution(),
    actionClaimGuard: buildActionClaimGuard({
      status: 'unsupported',
      claimCount: 1,
      unsupportedClaimCount: 1,
      warnings: [
        'Unsupported action claim detected.',
      ],
    }),
  });

  assert.equal(assessment.status, 'partial_success');
  assert.equal(assessment.requestFulfillment, 'partially_fulfilled');
  assert.equal(assessment.finalAnswerAssessment.answerGroundedInEvidence, false);
  assert.match(assessment.warnings[0], /unsupported action claim/u);
});

test('evaluateActionResultAssessmentForInvocation marks workflow external waits as partial success', () => {
  const assessment = evaluateActionResultAssessmentForInvocation({
    brainOutput: buildBrainOutput(),
    actionResolution: {
      ...buildAcceptedToolActionResolution(),
      selectedCandidate: {
        actionType: 'workflow_execution',
        targetType: 'workflow',
        targetId: 'mas-health-review',
        sideEffectLevel: 'read_only',
      },
      runtimeAction: 'queue_workflow_request',
    },
    brainWorkflowExecution: buildWorkflowExecution({
      workflowRunStatus: 'waiting_for_external_event',
      observation: {
        kind: 'brain_workflow_observation',
        version: 1,
        workflowId: 'mas-health-review',
        workflowRunId: 'workflow-run-001',
        status: 'waiting_for_external_event',
        summary: 'Workflow is waiting for an external event.',
      },
    }),
    actionClaimGuard: buildActionClaimGuard(),
  });

  assert.equal(assessment.status, 'partial_success');
  assert.equal(assessment.requestFulfillment, 'partially_fulfilled');
});

test('evaluateActionResultAssessmentForInvocation leaves answer-only invocations as not applicable', () => {
  const assessment = evaluateActionResultAssessmentForInvocation({
    brainOutput: buildBrainOutput(),
    actionResolution: {
      kind: 'action_resolution',
      version: 1,
      status: 'no_action',
      runtimeAction: 'answer_only',
      selectedCandidate: null,
      reason: 'No executable action source was available.',
    },
    actionClaimGuard: buildActionClaimGuard(),
  });

  assert.equal(assessment.status, 'not_applicable');
  assert.equal(assessment.requestFulfillment, 'not_applicable');
  assert.equal(assessment.executionObserved, false);
});

test('evaluateActionResultAssessmentForInvocation downgrades successful execution when verification gate fails', () => {
  const assessment = evaluateActionResultAssessmentForInvocation({
    brainOutput: buildBrainOutput(),
    actionResolution: buildAcceptedToolActionResolution(),
    toolRequestResolution: buildToolRequestResolution(),
    brainToolExecution: buildSuccessfulToolExecution(),
    actionClaimGuard: buildActionClaimGuard({
      status: 'supported',
    }),
    verificationGate: buildVerificationGate({
      status: 'failed',
      verificationOutcome: 'not_verified',
      reason: 'Verification requirements were not fully satisfied by runtime evidence.',
      warnings: [
        'Verification gate requirement tool-observation-record is not satisfied: Successful tool execution requires a matching runtime observation record.',
      ],
    }),
  });

  assert.equal(assessment.status, 'partial_success');
  assert.equal(assessment.requestFulfillment, 'partially_fulfilled');
  assert.equal(assessment.finalAnswerAssessment.answerGroundedInEvidence, false);
  assert.match(assessment.reason, /verification requirements/i);
});

test('evaluateActionResultAssessmentForInvocation downgrades successful execution when verification gate is degraded', () => {
  const assessment = evaluateActionResultAssessmentForInvocation({
    brainOutput: buildBrainOutput(),
    actionResolution: buildAcceptedToolActionResolution(),
    toolRequestResolution: buildToolRequestResolution(),
    brainToolExecution: buildSuccessfulToolExecution(),
    actionClaimGuard: buildActionClaimGuard({
      status: 'supported',
    }),
    verificationGate: buildVerificationGate({
      status: 'degraded',
      verificationOutcome: 'partially_verified',
      reason: 'Runtime execution was observed, but bounded inline verification evidence is incomplete.',
      warnings: [
        'Verification gate requirement tool-observation-preview is not satisfied: Tool observation references a persisted full result artifact, but no bounded inline preview evidence is available for verification.',
      ],
    }),
  });

  assert.equal(assessment.status, 'partial_success');
  assert.equal(assessment.requestFulfillment, 'partially_fulfilled');
  assert.equal(assessment.finalAnswerAssessment.answerGroundedInEvidence, false);
  assert.match(assessment.reason, /verification evidence was only partially available inline/i);
});
