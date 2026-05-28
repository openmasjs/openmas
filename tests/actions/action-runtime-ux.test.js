import test from 'node:test';
import assert from 'node:assert/strict';
import { formatActionRuntimeUxForCli } from '../../src/cli/action-runtime-ux.js';

function buildSelectedCandidate(overrides = {}) {
  return {
    kind: 'action_candidate',
    version: 1,
    candidateId: 'candidate-mas-inspect-001',
    actionType: 'tool_execution',
    targetType: 'tool',
    targetId: 'mas.system.inspect',
    source: 'semantic_classifier',
    confidence: 'high',
    confidenceScore: 0.93,
    sideEffectLevel: 'read_only',
    requiresApproval: false,
    reason: 'The request maps to MAS inspection.',
    matchedSignals: [],
    missingContext: [],
    warnings: [],
    metadata: {
      affordanceId: 'tool:mas.system.inspect',
    },
    ...overrides,
  };
}

function buildActionResolution(overrides = {}) {
  return {
    kind: 'action_resolution',
    version: 1,
    status: 'accepted',
    source: 'semantic_classifier',
    runtimeAction: 'queue_tool_request',
    actionIntent: null,
    selectedCandidate: buildSelectedCandidate(),
    clarificationRequest: null,
    executionAllowed: true,
    approvalRequired: false,
    reason: 'The MAS inspection action was accepted.',
    evidence: [],
    decisionTrace: [],
    warnings: [],
    metadata: {},
    ...overrides,
  };
}

function buildActionClaimGuard(overrides = {}) {
  return {
    kind: 'action_claim_guard',
    version: 1,
    status: 'supported',
    claimCount: 1,
    supportedClaimCount: 1,
    unsupportedClaimCount: 0,
    claims: [
      {
        claimId: 'action-claim-001',
        claimType: 'completed_action',
        evidenceStatus: 'supported',
        reason: 'The claim is supported by tool observation evidence.',
      },
    ],
    warnings: [],
    ...overrides,
  };
}

function buildActionResultAssessment(overrides = {}) {
  return {
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
    reason: 'Runtime execution succeeded and no unsupported action claims were detected.',
    evidence: [
      {
        evidenceType: 'action_resolution',
        targetId: 'mas.system.inspect',
        status: 'accepted',
        summary: 'Runtime selected a read-only inspection action.',
      },
      {
        evidenceType: 'tool_observation',
        targetId: 'mas.system.inspect',
        runId: 'tool-run-001',
        status: 'succeeded',
        summary: 'MAS inspection completed.',
      },
    ],
    finalAnswerGuidance: [],
    recommendedNextActions: [
      'Use persisted session and runtime observation as audit evidence.',
    ],
    warnings: [],
    metadata: {},
    ...overrides,
  };
}

test('formatActionRuntimeUxForCli returns no lines when action runtime data is absent', () => {
  assert.deepEqual(formatActionRuntimeUxForCli(null), []);
  assert.deepEqual(formatActionRuntimeUxForCli({ outputText: 'Hello.' }), []);
});

test('formatActionRuntimeUxForCli explains an acted invocation with evidence', () => {
  const lines = formatActionRuntimeUxForCli({
    actionResolution: buildActionResolution(),
    actionClaimGuard: buildActionClaimGuard(),
    actionResultAssessment: buildActionResultAssessment(),
  });
  const output = lines.join('\n');

  assert.match(output, /Action Runtime:/u);
  assert.match(output, /Outcome: acted/u);
  assert.match(output, /Action Resolution: accepted \| runtime=queue_tool_request \| source=semantic_classifier/u);
  assert.match(output, /Selected Target: tool:mas\.system\.inspect/u);
  assert.match(output, /Execution Gate: allowed=yes \| approvalRequired=no/u);
  assert.match(output, /Action Claim Guard: supported/u);
  assert.match(output, /Result Assessment: success \| fulfillment=fulfilled \| executionObserved=yes/u);
  assert.match(output, /tool_observation/u);
});

test('formatActionRuntimeUxForCli explains clarification without execution', () => {
  const lines = formatActionRuntimeUxForCli({
    actionResolution: buildActionResolution({
      status: 'needs_clarification',
      runtimeAction: 'ask_clarification',
      selectedCandidate: null,
      executionAllowed: false,
      clarificationRequest: {
        kind: 'action_clarification_request',
        version: 1,
        clarificationId: 'clarification-001',
        reasonCategory: 'multiple_candidates',
        question: 'Do you want a quick inspection or a full health review?',
        candidateIds: [
          'candidate-mas-inspect-001',
          'candidate-mas-health-review-001',
        ],
        missingContext: [
          'single_action_selection',
        ],
        blockingExecution: true,
        warnings: [],
      },
      reason: 'The request needs clarification before execution.',
    }),
    actionResultAssessment: buildActionResultAssessment({
      status: 'clarification_required',
      requestFulfillment: 'needs_clarification',
      executionObserved: false,
      clarificationRequired: true,
      finalAnswerAssessment: {
        answerGroundedInEvidence: true,
        claimGuardStatus: 'no_claims',
        unsupportedClaimCount: 0,
      },
      reason: 'Ask the clarification question before execution.',
    }),
  });
  const output = lines.join('\n');

  assert.match(output, /Outcome: asked_for_clarification/u);
  assert.match(output, /Clarification Request:/u);
  assert.match(output, /Question: Do you want a quick inspection or a full health review\?/u);
  assert.match(output, /Missing Context: single_action_selection/u);
  assert.match(output, /executionObserved=no/u);
});

test('formatActionRuntimeUxForCli explains approval pauses and unsupported claims', () => {
  const lines = formatActionRuntimeUxForCli({
    actionResolution: buildActionResolution({
      status: 'approval_required',
      runtimeAction: 'request_human_approval',
      selectedCandidate: buildSelectedCandidate({
        targetType: 'channel',
        targetId: 'alfred-whatsapp',
        actionType: 'channel_delivery',
        sideEffectLevel: 'publish_external',
        requiresApproval: true,
      }),
      executionAllowed: false,
      approvalRequired: true,
      reason: 'External publishing requires human approval.',
    }),
    actionClaimGuard: buildActionClaimGuard({
      status: 'unsupported',
      supportedClaimCount: 0,
      unsupportedClaimCount: 1,
      claims: [
        {
          claimId: 'action-claim-001',
          claimType: 'external_delivery',
          evidenceStatus: 'unsupported',
          reason: 'External delivery claims require confirmed channel delivery evidence.',
        },
      ],
      warnings: [
        'Unsupported action claim detected: external delivery was not confirmed.',
      ],
    }),
    actionResultAssessment: buildActionResultAssessment({
      status: 'approval_pause',
      requestFulfillment: 'pending_approval',
      executionObserved: false,
      approvalPaused: true,
      finalAnswerAssessment: {
        answerGroundedInEvidence: false,
        claimGuardStatus: 'unsupported',
        unsupportedClaimCount: 1,
      },
      reason: 'Execution is paused until human approval is decided.',
    }),
    humanApprovalRequest: {
      approvalRequestId: 'approval-001',
    },
    humanApprovalState: {
      status: 'pending',
    },
  });
  const output = lines.join('\n');

  assert.match(output, /Outcome: paused_for_approval/u);
  assert.match(output, /Selected Target: channel:alfred-whatsapp/u);
  assert.match(output, /Execution Gate: allowed=no \| approvalRequired=yes/u);
  assert.match(output, /Claim Warning: Unsupported action claim detected/u);
  assert.match(output, /Human Approval: request=approval-001 \| state=pending/u);
});
