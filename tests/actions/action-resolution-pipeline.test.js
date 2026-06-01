import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveActionForInvocation } from '../../src/actions/resolve-action-for-invocation.js';
import { assertActionIntent } from '../../src/contracts/action-intent-contract.js';

function buildRequestUnderstanding(overrides = {}) {
  return {
    kind: 'action_request_understanding',
    version: 1,
    originalInput: 'Please inspect the MAS before answering.',
    normalizedGoal: 'Inspect the current MAS state.',
    requestType: 'diagnostic',
    temporalFocus: 'current',
    riskLevel: 'low',
    requiresAction: true,
    requiresClarification: false,
    summary: 'The user wants a current MAS diagnostic.',
    evidence: [
      'The request asks for a MAS inspection.',
    ],
    missingContext: [],
    warnings: [],
    ...overrides,
  };
}

function buildToolCandidate(overrides = {}) {
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
    reason: 'The request maps to the MAS inspection tool.',
    matchedSignals: [
      'semantic-mas-inspection',
    ],
    missingContext: [],
    warnings: [],
    metadata: {
      affordanceId: 'tool:mas.system.inspect',
      readinessStatus: 'ready',
    },
    ...overrides,
  };
}

function buildWorkflowCandidate(overrides = {}) {
  return {
    kind: 'action_candidate',
    version: 1,
    candidateId: 'candidate-mas-health-review-001',
    actionType: 'workflow_execution',
    targetType: 'workflow',
    targetId: 'mas-health-review',
    source: 'semantic_classifier',
    confidence: 'high',
    confidenceScore: 0.88,
    sideEffectLevel: 'read_only',
    requiresApproval: false,
    reason: 'The request maps to a MAS health review workflow.',
    matchedSignals: [
      'semantic-mas-health-review',
    ],
    missingContext: [],
    warnings: [],
    metadata: {
      affordanceId: 'workflow:mas-health-review',
      readinessStatus: 'not_evaluated',
    },
    ...overrides,
  };
}

function buildSemanticClassifiedResult(candidate = buildToolCandidate()) {
  const actionIntent = assertActionIntent({
    kind: 'action_intent',
    version: 1,
    status: 'classified',
    source: 'semantic_classifier',
    intentId: candidate.targetType === 'workflow' ? 'admin.mas.health_review' : 'admin.mas.inspect',
    intentType: 'administrative_diagnostic',
    confidence: candidate.confidence,
    confidenceScore: candidate.confidenceScore,
    understanding: buildRequestUnderstanding(),
    candidates: [
      candidate,
    ],
    selectedCandidateId: candidate.candidateId,
    clarificationRequest: null,
    reason: candidate.reason,
    evidence: [
      'Semantic classifier selected one action candidate.',
    ],
    warnings: [],
  });

  return {
    kind: 'semantic_intent_classification_result',
    version: 1,
    status: 'completed',
    classifierId: 'deterministic-test-classifier',
    classifierRequest: {},
    actionIntent,
    warnings: [],
  };
}

function buildSemanticPlanPreviewResult(candidate = buildToolCandidate()) {
  const actionIntent = assertActionIntent({
    kind: 'action_intent',
    version: 1,
    status: 'classified',
    source: 'semantic_classifier',
    intentId: 'admin.mas.inspect.plan',
    intentType: 'administrative_plan_preview',
    confidence: candidate.confidence,
    confidenceScore: candidate.confidenceScore,
    understanding: buildRequestUnderstanding({
      originalInput: 'Please show me an inspection plan before executing anything.',
      normalizedGoal: 'Preview the MAS inspection plan before execution.',
      requestType: 'plan_request',
      temporalFocus: 'future',
      summary: 'The user wants a governed inspection preview before execution.',
    }),
    candidates: [
      candidate,
    ],
    selectedCandidateId: candidate.candidateId,
    clarificationRequest: null,
    reason: candidate.reason,
    evidence: [
      'Semantic classifier selected one preview candidate.',
    ],
    warnings: [],
  });

  return {
    kind: 'semantic_intent_classification_result',
    version: 1,
    status: 'completed',
    classifierId: 'deterministic-test-classifier',
    classifierRequest: {},
    actionIntent,
    warnings: [],
  };
}

function buildSemanticAmbiguousResult() {
  const toolCandidate = buildToolCandidate({
    confidence: 'medium',
    confidenceScore: 0.7,
  });
  const workflowCandidate = buildWorkflowCandidate({
    confidence: 'medium',
    confidenceScore: 0.69,
  });

  return {
    kind: 'semantic_intent_classification_result',
    version: 1,
    status: 'completed',
    classifierId: 'deterministic-test-classifier',
    classifierRequest: {},
    actionIntent: assertActionIntent({
      kind: 'action_intent',
      version: 1,
      status: 'ambiguous',
      source: 'semantic_classifier',
      intentId: 'admin.mas.review',
      intentType: 'administrative_review',
      confidence: 'medium',
      confidenceScore: 0.7,
      understanding: buildRequestUnderstanding({
        normalizedGoal: 'Review the MAS state.',
        requiresClarification: true,
        summary: 'The request could mean a quick inspection or a deeper review.',
      }),
      candidates: [
        toolCandidate,
        workflowCandidate,
      ],
      selectedCandidateId: null,
      clarificationRequest: {
        kind: 'action_clarification_request',
        version: 1,
        clarificationId: 'clarification-mas-review-001',
        reasonCategory: 'multiple_candidates',
        question: 'Do you want a quick MAS inspection or a deeper MAS health review?',
        candidateIds: [
          toolCandidate.candidateId,
          workflowCandidate.candidateId,
        ],
        missingContext: [],
        blockingExecution: true,
        warnings: [],
      },
      reason: 'Two action candidates are plausible.',
      evidence: [
        'The classifier returned two candidates.',
      ],
      warnings: [],
    }),
    warnings: [],
  };
}

function buildReadyToolVerdict() {
  return {
    kind: 'tool_readiness_verdict',
    version: 1,
    toolId: 'mas.system.inspect',
    status: 'ready',
    approvalRequired: false,
    reason: 'Tool is ready.',
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
  };
}

function buildAcceptedToolRequestResolution() {
  return {
    kind: 'brain_tool_request_resolution',
    version: 1,
    status: 'accepted',
    requestedToolId: 'mas.system.inspect',
    toolRequest: {
      kind: 'brain_tool_request',
      version: 1,
      toolRequestId: 'brain-tool-request-001',
      toolId: 'mas.system.inspect',
      input: {
        includeCounts: true,
      },
      purpose: 'Inspect the MAS before answering.',
      expectedSideEffectLevel: 'read_only',
    },
    toolReadinessVerdict: buildReadyToolVerdict(),
    executionAllowed: true,
    approvalRequired: false,
    autoExecutionPerformed: false,
    runtimeAction: 'queue_for_execution',
    reason: 'Brain tool request is ready for execution.',
    warnings: [],
  };
}

function buildInvalidToolRequestResolution() {
  return {
    kind: 'brain_tool_request_resolution',
    version: 1,
    status: 'invalid',
    requestedToolId: null,
    toolRequest: null,
    toolReadinessVerdict: null,
    executionAllowed: false,
    approvalRequired: false,
    autoExecutionPerformed: false,
    runtimeAction: 'reject',
    reason: 'Brain tool request envelope was malformed.',
    warnings: [
      'The brain output mentioned a tool request but did not provide a valid envelope.',
    ],
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
      allowWritebackCandidates: false,
    },
  };
}

function buildAcceptedWorkflowRequestResolution() {
  return {
    kind: 'brain_workflow_request_resolution',
    version: 1,
    status: 'accepted',
    requestedWorkflowId: 'mas-health-review',
    workflowRequest: {
      kind: 'brain_workflow_request',
      version: 1,
      workflowRequestId: 'brain-workflow-request-001',
      workflowId: 'mas-health-review',
      input: {
        includeCounts: true,
      },
      purpose: 'Run a MAS health review.',
      expectedSideEffectLevel: 'read_only',
    },
    workflowRuntimeDefinition: buildWorkflowRuntimeDefinition(),
    executionAllowed: true,
    autoExecutionPerformed: false,
    runtimeAction: 'queue_for_execution',
    reason: 'Brain workflow request is ready for execution.',
    warnings: [],
  };
}

test('resolveActionForInvocation lets an accepted explicit tool envelope win over semantic classification', () => {
  const resolution = resolveActionForInvocation({
    request: {
      command: 'ask',
      inputText: 'Inspect the MAS.',
    },
    toolRequestResolution: buildAcceptedToolRequestResolution(),
    semanticIntentClassification: buildSemanticClassifiedResult(buildWorkflowCandidate()),
  });

  assert.equal(resolution.status, 'accepted');
  assert.equal(resolution.source, 'explicit_envelope');
  assert.equal(resolution.runtimeAction, 'queue_tool_request');
  assert.equal(resolution.selectedCandidate.targetId, 'mas.system.inspect');
  assert.match(resolution.decisionTrace.join('\n'), /Explicit brain tool envelope/u);
});

test('resolveActionForInvocation keeps explicit tool envelopes as preview-only when the request asks for a plan', () => {
  const resolution = resolveActionForInvocation({
    request: {
      command: 'ask',
      inputText: 'Please show me an inspection plan before executing anything.',
    },
    toolRequestResolution: buildAcceptedToolRequestResolution(),
  });

  assert.equal(resolution.status, 'plan_only');
  assert.equal(resolution.source, 'explicit_envelope');
  assert.equal(resolution.runtimeAction, 'answer_only');
  assert.equal(resolution.executionAllowed, false);
  assert.equal(resolution.selectedCandidate.targetId, 'mas.system.inspect');
  assert.equal(resolution.metadata.planMode, 'preview_only');
  assert.equal(resolution.metadata.previewRuntimeAction, 'queue_tool_request');
  assert.equal(resolution.metadata.previewOnlyRequest, true);
  assert.match(resolution.reason, /governed plan preview/i);
});

test('resolveActionForInvocation keeps semantic preview plans as plan_only even when execution readiness is currently denied', () => {
  const resolution = resolveActionForInvocation({
    request: {
      command: 'ask',
      inputText: 'Please show me an inspection plan before executing anything.',
    },
    semanticIntentClassification: buildSemanticPlanPreviewResult(buildToolCandidate({
      metadata: {
        affordanceId: 'tool:mas.system.inspect',
        readinessStatus: 'denied',
      },
    })),
  });

  assert.equal(resolution.status, 'plan_only');
  assert.equal(resolution.source, 'semantic_classifier');
  assert.equal(resolution.runtimeAction, 'answer_only');
  assert.equal(resolution.executionAllowed, false);
  assert.equal(resolution.selectedCandidate.targetId, 'mas.system.inspect');
  assert.equal(resolution.metadata.planMode, 'preview_only');
  assert.equal(resolution.metadata.previewRuntimeAction, 'queue_tool_request');
  assert.equal(resolution.metadata.previewExecutionReadinessStatus, 'denied');
  assert.equal(resolution.metadata.previewExecutionReasonCategory, 'readiness_denied');
  assert.match(resolution.decisionTrace.join('\n'), /preview-only plan can still be provided/i);
});

test('resolveActionForInvocation does not let semantic classification rescue an invalid explicit envelope', () => {
  const resolution = resolveActionForInvocation({
    request: {
      command: 'ask',
      inputText: 'Inspect the MAS.',
    },
    toolRequestResolution: buildInvalidToolRequestResolution(),
    semanticIntentClassification: buildSemanticClassifiedResult(),
  });

  assert.equal(resolution.status, 'denied');
  assert.equal(resolution.runtimeAction, 'reject');
  assert.equal(resolution.source, 'explicit_envelope');
  assert.equal(resolution.selectedCandidate, null);
  assert.match(resolution.reason, /malformed/u);
});

test('resolveActionForInvocation bridges accepted workflow envelopes to workflow runtime actions', () => {
  const resolution = resolveActionForInvocation({
    workflowRequestResolution: buildAcceptedWorkflowRequestResolution(),
  });

  assert.equal(resolution.status, 'accepted');
  assert.equal(resolution.runtimeAction, 'queue_workflow_request');
  assert.equal(resolution.selectedCandidate.targetType, 'workflow');
  assert.equal(resolution.selectedCandidate.targetId, 'mas-health-review');
});

test('resolveActionForInvocation can accept semantic workflow candidates and defer readiness to workflow gating', () => {
  const resolution = resolveActionForInvocation({
    semanticIntentClassification: buildSemanticClassifiedResult(buildWorkflowCandidate()),
  });

  assert.equal(resolution.status, 'accepted');
  assert.equal(resolution.source, 'semantic_classifier');
  assert.equal(resolution.runtimeAction, 'queue_workflow_request');
  assert.equal(resolution.selectedCandidate.targetType, 'workflow');
  assert.equal(resolution.selectedCandidate.targetId, 'mas-health-review');
  assert.equal(resolution.metadata.actionPolicy.readinessDeferredToWorkflowRuntime, true);
});

test('resolveActionForInvocation stops safely when multiple explicit envelopes are present', () => {
  const resolution = resolveActionForInvocation({
    request: {
      command: 'ask',
      inputText: 'Hola Alfred, podrias elegir una sola accion?',
    },
    toolRequestResolution: buildAcceptedToolRequestResolution(),
    workflowRequestResolution: buildAcceptedWorkflowRequestResolution(),
  });

  assert.equal(resolution.status, 'ambiguous');
  assert.equal(resolution.runtimeAction, 'ask_clarification');
  assert.equal(resolution.selectedCandidate, null);
  assert.equal(resolution.clarificationRequest.reasonCategory, 'multiple_candidates');
  assert.equal(resolution.clarificationRequest.metadata.locale, 'es');
  assert.match(resolution.reason, /Multiple explicit/u);
});

test('resolveActionForInvocation evaluates deterministic commands before semantic classification', () => {
  const resolution = resolveActionForInvocation({
    deterministicCommandResolution: {
      kind: 'deterministic_command_resolution',
      version: 1,
      status: 'accepted',
      command: 'help',
      sideEffectLevel: 'read_only',
      reason: 'The direct help command is available.',
      warnings: [],
    },
    semanticIntentClassification: buildSemanticClassifiedResult(),
  });

  assert.equal(resolution.status, 'accepted');
  assert.equal(resolution.source, 'explicit_command');
  assert.equal(resolution.runtimeAction, 'execute_command');
  assert.equal(resolution.selectedCandidate.targetId, 'help');
});

test('resolveActionForInvocation accepts ready semantic tool candidates when no stronger source exists', () => {
  const resolution = resolveActionForInvocation({
    semanticIntentClassification: buildSemanticClassifiedResult(),
  });

  assert.equal(resolution.status, 'accepted');
  assert.equal(resolution.source, 'semantic_classifier');
  assert.equal(resolution.runtimeAction, 'queue_tool_request');
  assert.equal(resolution.selectedCandidate.targetId, 'mas.system.inspect');
});

test('resolveActionForInvocation asks clarification for medium-confidence semantic candidates', () => {
  const resolution = resolveActionForInvocation({
    request: {
      command: 'ask',
      inputText: 'Hola Alfred, podrias revisar el MAS por favor?',
    },
    semanticIntentClassification: buildSemanticClassifiedResult(buildToolCandidate({
      confidence: 'medium',
      confidenceScore: 0.74,
    })),
  });

  assert.equal(resolution.status, 'needs_clarification');
  assert.equal(resolution.runtimeAction, 'ask_clarification');
  assert.equal(resolution.executionAllowed, false);
  assert.equal(resolution.clarificationRequest.reasonCategory, 'low_confidence');
  assert.equal(resolution.clarificationRequest.metadata.locale, 'es');
});

test('resolveActionForInvocation asks clarification for semantic candidates without verified readiness', () => {
  const resolution = resolveActionForInvocation({
    semanticIntentClassification: buildSemanticClassifiedResult(buildToolCandidate({
      metadata: {
        affordanceId: 'tool:mas.system.inspect',
        readinessStatus: 'not_evaluated',
      },
    })),
  });

  assert.equal(resolution.status, 'needs_clarification');
  assert.equal(resolution.runtimeAction, 'ask_clarification');
  assert.equal(resolution.clarificationRequest.reasonCategory, 'permission_unclear');
  assert.equal(resolution.metadata.actionPolicy.reasonCategory, 'readiness_unverified');
});

test('resolveActionForInvocation requires approval for risky semantic candidates', () => {
  const resolution = resolveActionForInvocation({
    semanticIntentClassification: buildSemanticClassifiedResult(buildToolCandidate({
      candidateId: 'candidate-publish-message-001',
      actionType: 'channel_delivery',
      targetType: 'channel',
      targetId: 'alfred-whatsapp',
      sideEffectLevel: 'publish_external',
      requiresApproval: true,
      reason: 'The request would publish externally.',
      metadata: {
        affordanceId: 'channel:alfred-whatsapp',
        readinessStatus: 'approval_required',
      },
    })),
  });

  assert.equal(resolution.status, 'approval_required');
  assert.equal(resolution.runtimeAction, 'request_human_approval');
  assert.equal(resolution.executionAllowed, false);
});

test('resolveActionForInvocation upgrades accepted risky deterministic commands to approval-required', () => {
  const resolution = resolveActionForInvocation({
    deterministicCommandResolution: {
      kind: 'deterministic_command_resolution',
      version: 1,
      status: 'accepted',
      command: 'publish-announcement',
      sideEffectLevel: 'publish_external',
      reason: 'The deterministic command was selected by the CLI.',
      warnings: [],
    },
  });

  assert.equal(resolution.status, 'approval_required');
  assert.equal(resolution.source, 'explicit_command');
  assert.equal(resolution.runtimeAction, 'request_human_approval');
  assert.equal(resolution.executionAllowed, false);
});

test('resolveActionForInvocation denies semantic candidates with denied readiness', () => {
  const resolution = resolveActionForInvocation({
    semanticIntentClassification: buildSemanticClassifiedResult(buildToolCandidate({
      metadata: {
        affordanceId: 'tool:mas.system.inspect',
        readinessStatus: 'denied',
      },
    })),
  });

  assert.equal(resolution.status, 'denied');
  assert.equal(resolution.runtimeAction, 'reject');
  assert.match(resolution.reason, /readiness status is denied/u);
});

test('resolveActionForInvocation preserves semantic ambiguity as a clarification decision', () => {
  const resolution = resolveActionForInvocation({
    semanticIntentClassification: buildSemanticAmbiguousResult(),
  });

  assert.equal(resolution.status, 'ambiguous');
  assert.equal(resolution.runtimeAction, 'ask_clarification');
  assert.equal(resolution.clarificationRequest.candidateIds.length, 2);
});

test('resolveActionForInvocation returns no-action fallback when no source consumes the invocation', () => {
  const resolution = resolveActionForInvocation({
    request: {
      command: 'ask',
      inputText: 'Thanks Alfred.',
    },
  });

  assert.equal(resolution.status, 'no_action');
  assert.equal(resolution.source, 'none');
  assert.equal(resolution.runtimeAction, 'answer_only');
  assert.equal(resolution.executionAllowed, false);
});
