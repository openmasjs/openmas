import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertActionCandidate,
  assertActionClarificationRequest,
  assertActionIntent,
  assertActionRequestUnderstanding,
} from '../../src/contracts/actions/action-intent-contract.js';
import { assertActionResolution } from '../../src/contracts/actions/action-resolution-contract.js';

function buildRequestUnderstanding(overrides = {}) {
  return {
    kind: 'action_request_understanding',
    version: 2,
    originalInput: 'Please inspect the MAS and tell me if anything changed.',
    normalizedGoal: 'Inspect the current MAS state.',
    requestedOutcome: 'Inspect the current MAS state and report whether anything changed.',
    requestType: 'diagnostic',
    temporalFocus: 'current',
    riskLevel: 'low',
    requiresAction: true,
    requiresClarification: false,
    summary: 'The user wants a current MAS diagnostic.',
    requiredEvidence: [
      'tool_observation',
    ],
    knownReferences: [
      {
        kind: 'action_known_reference',
        version: 1,
        referenceType: 'tool',
        referenceId: 'mas.system.inspect',
        label: 'mas.system.inspect',
        source: 'runtime_context',
        confidence: 'high',
        metadata: {},
      },
    ],
    evidence: ['The input asks for a MAS inspection.'],
    missingContext: [],
    ambiguityMarkers: [],
    warnings: [],
    ...overrides,
  };
}

function buildInspectCandidate(overrides = {}) {
  return {
    kind: 'action_candidate',
    version: 1,
    candidateId: 'candidate-mas-inspect-001',
    actionType: 'tool_execution',
    targetType: 'tool',
    targetId: 'mas.system.inspect',
    source: 'semantic_classifier',
    confidence: 'high',
    confidenceScore: 0.92,
    sideEffectLevel: 'read_only',
    requiresApproval: false,
    reason: 'The request maps to a safe MAS inspection tool.',
    matchedSignals: ['MAS inspection request'],
    missingContext: [],
    warnings: [],
    ...overrides,
  };
}

function buildHealthReviewCandidate(overrides = {}) {
  return {
    kind: 'action_candidate',
    version: 1,
    candidateId: 'candidate-mas-health-review-001',
    actionType: 'workflow_execution',
    targetType: 'workflow',
    targetId: 'mas-health-review',
    source: 'semantic_classifier',
    confidence: 'medium',
    confidenceScore: 0.71,
    sideEffectLevel: 'read_only',
    requiresApproval: false,
    reason: 'The request may require a deeper health review workflow.',
    matchedSignals: ['MAS review request'],
    missingContext: [],
    warnings: [],
    ...overrides,
  };
}

function buildPublishCandidate(overrides = {}) {
  return {
    kind: 'action_candidate',
    version: 1,
    candidateId: 'candidate-channel-publish-001',
    actionType: 'channel_delivery',
    targetType: 'channel',
    targetId: 'alfred-whatsapp',
    source: 'semantic_classifier',
    confidence: 'high',
    confidenceScore: 0.88,
    sideEffectLevel: 'publish_external',
    requiresApproval: true,
    reason: 'The request may publish an external message.',
    matchedSignals: ['publish externally'],
    missingContext: [],
    warnings: [],
    ...overrides,
  };
}

function buildClarificationRequest(overrides = {}) {
  return {
    kind: 'action_clarification_request',
    version: 1,
    clarificationId: 'clarification-mas-review-001',
    reasonCategory: 'multiple_candidates',
    question: 'Do you want a quick MAS inspection or a deeper MAS health review?',
    candidateIds: [
      'candidate-mas-inspect-001',
      'candidate-mas-health-review-001',
    ],
    missingContext: [],
    blockingExecution: true,
    warnings: [],
    ...overrides,
  };
}

function buildClassifiedIntent(overrides = {}) {
  const candidate = buildInspectCandidate();

  return {
    kind: 'action_intent',
    version: 1,
    status: 'classified',
    source: 'semantic_classifier',
    intentId: 'admin.mas.inspect',
    intentType: 'administrative_diagnostic',
    confidence: 'high',
    confidenceScore: 0.92,
    understanding: buildRequestUnderstanding(),
    candidates: [candidate],
    selectedCandidateId: candidate.candidateId,
    clarificationRequest: null,
    reason: 'The request clearly maps to MAS inspection.',
    evidence: ['One high-confidence read-only action candidate was found.'],
    warnings: [],
    ...overrides,
  };
}

test('assertActionRequestUnderstanding accepts and normalizes a request understanding record', () => {
  const understanding = assertActionRequestUnderstanding(buildRequestUnderstanding({
    originalInput: '  Please inspect the MAS.  ',
    normalizedGoal: '  Inspect current MAS state.  ',
    requestedOutcome: '  Inspect current MAS state and report what changed.  ',
  }));

  assert.equal(understanding.kind, 'action_request_understanding');
  assert.equal(understanding.version, 2);
  assert.equal(understanding.originalInput, 'Please inspect the MAS.');
  assert.equal(understanding.normalizedGoal, 'Inspect current MAS state.');
  assert.equal(understanding.requestedOutcome, 'Inspect current MAS state and report what changed.');
  assert.equal(understanding.requestType, 'diagnostic');
  assert.equal(understanding.requiresAction, true);
  assert.deepEqual(understanding.requiredEvidence, [
    'tool_observation',
  ]);
  assert.equal(understanding.knownReferences[0].referenceId, 'mas.system.inspect');
  assert.deepEqual(understanding.ambiguityMarkers, []);
});

test('assertActionRequestUnderstanding normalizes legacy v1 understanding records to v2', () => {
  const understanding = assertActionRequestUnderstanding({
    kind: 'action_request_understanding',
    version: 1,
    originalInput: 'Inspect the MAS again.',
    normalizedGoal: 'Inspect the current MAS state.',
    requestType: 'diagnostic',
    temporalFocus: 'current',
    riskLevel: 'low',
    requiresAction: true,
    requiresClarification: false,
    summary: 'The user wants a new MAS inspection.',
    evidence: [],
    missingContext: [],
    warnings: [],
  });

  assert.equal(understanding.version, 2);
  assert.equal(understanding.requestedOutcome, 'Inspect the current MAS state.');
  assert.deepEqual(understanding.requiredEvidence, []);
  assert.deepEqual(understanding.knownReferences, []);
  assert.deepEqual(understanding.ambiguityMarkers, []);
});

test('assertActionCandidate accepts a read-only tool action candidate', () => {
  const candidate = assertActionCandidate(buildInspectCandidate({
    targetId: ' mas.system.inspect ',
  }));

  assert.equal(candidate.kind, 'action_candidate');
  assert.equal(candidate.targetType, 'tool');
  assert.equal(candidate.targetId, 'mas.system.inspect');
  assert.equal(candidate.sideEffectLevel, 'read_only');
  assert.equal(candidate.requiresApproval, false);
});

test('assertActionCandidate rejects risky side effects without approval', () => {
  assert.throws(
    () => assertActionCandidate(buildPublishCandidate({ requiresApproval: false })),
    /must require approval/,
  );
});

test('assertActionClarificationRequest accepts an auditable clarification request', () => {
  const clarificationRequest = assertActionClarificationRequest(buildClarificationRequest());

  assert.equal(clarificationRequest.kind, 'action_clarification_request');
  assert.equal(clarificationRequest.reasonCategory, 'multiple_candidates');
  assert.equal(clarificationRequest.candidateIds.length, 2);
  assert.equal(clarificationRequest.blockingExecution, true);
});

test('assertActionIntent accepts a classified high-confidence action intent', () => {
  const intent = assertActionIntent(buildClassifiedIntent());

  assert.equal(intent.kind, 'action_intent');
  assert.equal(intent.status, 'classified');
  assert.equal(intent.selectedCandidateId, 'candidate-mas-inspect-001');
  assert.equal(intent.candidates[0].targetId, 'mas.system.inspect');
});

test('assertActionIntent accepts no-action answer-only intent without executable data', () => {
  const intent = assertActionIntent({
    kind: 'action_intent',
    version: 1,
    status: 'no_action',
    source: 'none',
    intentId: null,
    intentType: null,
    confidence: null,
    confidenceScore: null,
    understanding: buildRequestUnderstanding({
      originalInput: 'What is an Operational Identity?',
      normalizedGoal: 'Explain Operational Identity.',
      requestType: 'answer',
      temporalFocus: 'unspecified',
      riskLevel: 'none',
      requiresAction: false,
      summary: 'The user asks for an explanation.',
    }),
    candidates: [],
    selectedCandidateId: null,
    clarificationRequest: null,
    reason: 'The request only needs an answer.',
    evidence: ['No runtime action was requested.'],
    warnings: [],
  });

  assert.equal(intent.status, 'no_action');
  assert.equal(intent.candidates.length, 0);
});

test('assertActionIntent accepts governed conversational no-action request types', () => {
  const intent = assertActionIntent({
    kind: 'action_intent',
    version: 1,
    status: 'no_action',
    source: 'semantic_classifier',
    intentId: null,
    intentType: null,
    confidence: null,
    confidenceScore: null,
    understanding: buildRequestUnderstanding({
      originalInput: 'Hola Alfred, muy buenas tardes!',
      normalizedGoal: null,
      requestedOutcome: 'Offer a conversational greeting without runtime execution.',
      requestType: 'greeting',
      temporalFocus: 'current',
      riskLevel: 'none',
      requiresAction: false,
      requiresClarification: false,
      summary: 'The user is greeting the agent conversationally.',
      requiredEvidence: [],
      knownReferences: [],
    }),
    candidates: [],
    selectedCandidateId: null,
    clarificationRequest: null,
    reason: 'The request is a conversational greeting and does not require runtime execution.',
    evidence: ['The user greets the agent.'],
    warnings: [],
  });

  assert.equal(intent.status, 'no_action');
  assert.equal(intent.understanding.requestType, 'greeting');
  assert.equal(intent.understanding.requiresAction, false);
});

test('assertActionIntent accepts an ambiguous intent with clarification request', () => {
  const intent = assertActionIntent({
    kind: 'action_intent',
    version: 1,
    status: 'ambiguous',
    source: 'semantic_classifier',
    intentId: 'admin.mas.review',
    intentType: 'administrative_review',
    confidence: 'medium',
    confidenceScore: 0.66,
    understanding: buildRequestUnderstanding({
      originalInput: 'Can you review the MAS again?',
      normalizedGoal: 'Review MAS state.',
      requiresClarification: true,
    }),
    candidates: [
      buildInspectCandidate(),
      buildHealthReviewCandidate(),
    ],
    selectedCandidateId: null,
    clarificationRequest: buildClarificationRequest(),
    reason: 'The request can mean a quick inspection or a deeper health review.',
    evidence: ['Two plausible read-only candidates were found.'],
    warnings: [],
  });

  assert.equal(intent.status, 'ambiguous');
  assert.equal(intent.candidates.length, 2);
  assert.equal(intent.clarificationRequest.reasonCategory, 'multiple_candidates');
});

test('assertActionIntent accepts needs-clarification intent with missing context', () => {
  const intent = assertActionIntent({
    kind: 'action_intent',
    version: 1,
    status: 'needs_clarification',
    source: 'semantic_classifier',
    intentId: 'admin.targeted.check',
    intentType: 'administrative_diagnostic',
    confidence: 'medium',
    confidenceScore: 0.61,
    understanding: buildRequestUnderstanding({
      originalInput: 'Can you check that again?',
      normalizedGoal: 'Check an unspecified previous subject.',
      requestType: 'diagnostic',
      temporalFocus: 'current',
      riskLevel: 'low',
      requiresAction: true,
      requiresClarification: true,
      summary: 'The request needs a target before execution.',
      missingContext: ['target_to_check'],
    }),
    candidates: [],
    selectedCandidateId: null,
    clarificationRequest: buildClarificationRequest({
      clarificationId: 'clarification-missing-target-001',
      reasonCategory: 'missing_context',
      question: 'What should I check again?',
      candidateIds: [],
      missingContext: ['target_to_check'],
    }),
    reason: 'The request does not identify what should be checked.',
    evidence: ['The phrase "that" has no resolved target.'],
    warnings: [],
  });

  assert.equal(intent.status, 'needs_clarification');
  assert.equal(intent.clarificationRequest.reasonCategory, 'missing_context');
});

test('assertActionIntent rejects classified intents without a selected candidate', () => {
  assert.throws(
    () => assertActionIntent(buildClassifiedIntent({ selectedCandidateId: null })),
    /requires selectedCandidateId/,
  );
});

test('assertActionIntent rejects duplicated candidate ids', () => {
  assert.throws(
    () => assertActionIntent(buildClassifiedIntent({
      candidates: [
        buildInspectCandidate(),
        buildInspectCandidate(),
      ],
    })),
    /duplicated candidateId/,
  );
});

test('assertActionResolution accepts an accepted read-only tool action resolution', () => {
  const intent = assertActionIntent(buildClassifiedIntent());
  const resolution = assertActionResolution({
    kind: 'action_resolution',
    version: 1,
    status: 'accepted',
    source: 'semantic_classifier',
    runtimeAction: 'queue_tool_request',
    actionIntent: intent,
    selectedCandidate: intent.candidates[0],
    clarificationRequest: null,
    executionAllowed: true,
    approvalRequired: false,
    reason: 'The read-only MAS inspection action is ready to execute.',
    evidence: ['High-confidence read-only tool candidate selected.'],
    decisionTrace: [
      'Request understood as diagnostic.',
      'Tool candidate selected.',
      'Runtime action queued for execution.',
    ],
    warnings: [],
  });

  assert.equal(resolution.status, 'accepted');
  assert.equal(resolution.runtimeAction, 'queue_tool_request');
  assert.equal(resolution.executionAllowed, true);
});

test('assertActionResolution accepts no-action answer-only decisions', () => {
  const resolution = assertActionResolution({
    kind: 'action_resolution',
    version: 1,
    status: 'no_action',
    source: 'none',
    runtimeAction: 'answer_only',
    actionIntent: null,
    selectedCandidate: null,
    clarificationRequest: null,
    executionAllowed: false,
    approvalRequired: false,
    reason: 'The user only asked for an explanation.',
    evidence: ['No tool or workflow candidate is required.'],
    decisionTrace: ['Answer-only path selected.'],
    warnings: [],
  });

  assert.equal(resolution.status, 'no_action');
  assert.equal(resolution.runtimeAction, 'answer_only');
});

test('assertActionResolution accepts approval-required risky action decisions', () => {
  const resolution = assertActionResolution({
    kind: 'action_resolution',
    version: 1,
    status: 'approval_required',
    source: 'semantic_classifier',
    runtimeAction: 'request_human_approval',
    actionIntent: null,
    selectedCandidate: buildPublishCandidate(),
    clarificationRequest: null,
    executionAllowed: false,
    approvalRequired: true,
    reason: 'External publishing requires human approval.',
    evidence: ['Candidate sideEffectLevel is publish_external.'],
    decisionTrace: ['Risky candidate found.', 'Approval gate selected.'],
    warnings: [],
  });

  assert.equal(resolution.status, 'approval_required');
  assert.equal(resolution.approvalRequired, true);
});

test('assertActionResolution accepts preview-only plan decisions without execution', () => {
  const intent = assertActionIntent(buildClassifiedIntent({
    understanding: buildRequestUnderstanding({
      requestType: 'plan_request',
      requestedOutcome: 'Present a governed preview plan for inspecting the MAS before execution.',
      summary: 'The user wants to preview the inspection plan before any execution begins.',
    }),
  }));
  const resolution = assertActionResolution({
    kind: 'action_resolution',
    version: 1,
    status: 'plan_only',
    source: 'semantic_classifier',
    runtimeAction: 'answer_only',
    actionIntent: intent,
    selectedCandidate: intent.candidates[0],
    clarificationRequest: null,
    executionAllowed: false,
    approvalRequired: false,
    reason: 'The runtime prepared a preview-only plan for the selected inspection action.',
    evidence: ['A governed plan preview was requested before execution.'],
    decisionTrace: ['Plan-preview request detected.', 'Preview-only path selected.'],
    warnings: [],
    metadata: {
      planMode: 'preview_only',
      previewApprovalRequired: false,
      previewRuntimeAction: 'queue_tool_request',
    },
  });

  assert.equal(resolution.status, 'plan_only');
  assert.equal(resolution.runtimeAction, 'answer_only');
  assert.equal(resolution.executionAllowed, false);
});

test('assertActionResolution accepts ambiguous decisions that ask for clarification', () => {
  const resolution = assertActionResolution({
    kind: 'action_resolution',
    version: 1,
    status: 'ambiguous',
    source: 'semantic_classifier',
    runtimeAction: 'ask_clarification',
    actionIntent: null,
    selectedCandidate: null,
    clarificationRequest: buildClarificationRequest(),
    executionAllowed: false,
    approvalRequired: false,
    reason: 'Two plausible MAS review actions were found.',
    evidence: ['A tool and workflow candidate both matched.'],
    decisionTrace: ['Ambiguity detected.', 'Clarification requested.'],
    warnings: [],
  });

  assert.equal(resolution.status, 'ambiguous');
  assert.equal(resolution.runtimeAction, 'ask_clarification');
});

test('assertActionResolution accepts denied decisions without execution', () => {
  const resolution = assertActionResolution({
    kind: 'action_resolution',
    version: 1,
    status: 'denied',
    source: 'runtime_policy',
    runtimeAction: 'reject',
    actionIntent: null,
    selectedCandidate: buildInspectCandidate({
      source: 'runtime_policy',
      confidence: 'exact',
      confidenceScore: null,
    }),
    clarificationRequest: null,
    executionAllowed: false,
    approvalRequired: false,
    reason: 'The action is denied by runtime policy.',
    evidence: ['Permission gate denied the selected action.'],
    decisionTrace: ['Candidate selected.', 'Runtime gate denied execution.'],
    warnings: [],
  });

  assert.equal(resolution.status, 'denied');
  assert.equal(resolution.runtimeAction, 'reject');
});

test('assertActionResolution rejects accepted tool decisions with the wrong runtime action', () => {
  assert.throws(
    () => assertActionResolution({
      kind: 'action_resolution',
      version: 1,
      status: 'accepted',
      source: 'semantic_classifier',
      runtimeAction: 'queue_workflow_request',
      actionIntent: null,
      selectedCandidate: buildInspectCandidate(),
      clarificationRequest: null,
      executionAllowed: true,
      approvalRequired: false,
      reason: 'Wrong runtime action for a tool.',
      evidence: [],
      decisionTrace: [],
      warnings: [],
    }),
    /tool action resolution must use queue_tool_request/,
  );
});

test('assertActionResolution rejects selected candidate mismatches with action intent', () => {
  const intent = assertActionIntent(buildClassifiedIntent());

  assert.throws(
    () => assertActionResolution({
      kind: 'action_resolution',
      version: 1,
      status: 'accepted',
      source: 'semantic_classifier',
      runtimeAction: 'queue_workflow_request',
      actionIntent: intent,
      selectedCandidate: buildHealthReviewCandidate(),
      clarificationRequest: null,
      executionAllowed: true,
      approvalRequired: false,
      reason: 'The selected candidate does not match the classified intent.',
      evidence: [],
      decisionTrace: [],
      warnings: [],
    }),
    /selectedCandidate must match actionIntent selectedCandidateId/,
  );
});
