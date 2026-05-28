import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSemanticNoActionIntent,
  buildSemanticClassifiedIntentFromCandidate,
  buildSemanticClassifierCandidateFromAffordance,
} from '../../src/actions/classify-action-intent-for-invocation.js';
import { runSemanticIntentRuntimeForInvocation } from '../../src/actions/run-semantic-intent-runtime-for-invocation.js';
import { assertActionIntent } from '../../src/contracts/action-intent-contract.js';

function buildReadinessSummary(overrides = {}) {
  return {
    kind: 'action_affordance_readiness_summary',
    version: 1,
    status: 'ready',
    source: 'tool_readiness_evaluation',
    approvalRequired: false,
    reason: 'The affordance is ready for semantic runtime tests.',
    matchedBindingCount: 1,
    missingRequirementCount: 0,
    warnings: [],
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
      'answer',
    ],
    semanticTags: [
      'mas.inspect',
      'system.review',
      'health.check',
      'inspeccionar.mas',
      'revisar.mas',
    ],
    whenToUse: [
      'Use this when the user asks to inspect the MAS, review the current system state, or check runtime health without mutating anything.',
    ],
    whenNotToUse: [
      'Do not use this when the user only wants a conceptual explanation without runtime evidence.',
    ],
    exampleRequests: [
      'Please inspect the MAS.',
      'Can you review the current system state?',
      'How is the MAS doing right now?',
      'Puedes inspeccionar el MAS?',
      'Voce pode revisar o estado atual do MAS?',
    ],
    classificationGuidance: {
      highConfidenceSignals: [
        'inspect the mas',
        'review the current system state',
        'check runtime health',
        'inspeccionar el mas',
        'revisar o estado atual do mas',
      ],
      ambiguitySignals: [],
      negativeSignals: [
        'explain how inspection works',
      ],
      requiredContextKeys: [],
    },
    metadata: {},
    ...overrides,
  };
}

function buildWorkflowIntentMetadata(overrides = {}) {
  return {
    kind: 'action_intent_metadata',
    version: 1,
    primaryIntentId: 'admin.mas.health.review',
    targetActionType: 'workflow_execution',
    targetType: 'workflow',
    targetId: 'mas-health-review',
    expectedSideEffectLevel: 'read_only',
    requestTypes: [
      'diagnostic',
      'workflow_action',
    ],
    semanticTags: [
      'mas.health.review',
      'deep.health.check',
    ],
    whenToUse: [
      'Use this when the user asks for a deeper MAS health review rather than a quick inspection.',
    ],
    whenNotToUse: [
      'Do not use this for casual conversation or simple explanatory questions.',
    ],
    exampleRequests: [
      'Run a deeper MAS health review.',
      'Please do a full health review of the MAS.',
    ],
    classificationGuidance: {
      highConfidenceSignals: [
        'full health review',
        'deeper mas health review',
      ],
      ambiguitySignals: [],
      negativeSignals: [],
      requiredContextKeys: [],
    },
    metadata: {},
    ...overrides,
  };
}

function buildToolAffordance(overrides = {}) {
  return {
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
    readinessSummary: buildReadinessSummary(),
    warnings: [],
    metadata: {},
    ...overrides,
  };
}

function buildWorkflowAffordance(overrides = {}) {
  return {
    kind: 'action_affordance',
    version: 1,
    affordanceId: 'workflow:mas-health-review',
    sourceType: 'workflow_runtime_definition',
    sourcePath: 'instance/workflows/mas-health-review/runtime.json',
    targetActionType: 'workflow_execution',
    targetType: 'workflow',
    targetId: 'mas-health-review',
    displayName: 'MAS Health Review',
    description: null,
    owner: 'mas',
    lifecycleState: 'active',
    sideEffectLevel: 'read_only',
    executionMode: 'on_demand',
    intentMetadata: buildWorkflowIntentMetadata(),
    readinessSummary: buildReadinessSummary({
      source: 'workflow_lifecycle',
      matchedBindingCount: 0,
    }),
    warnings: [],
    metadata: {
      stepCount: 1,
    },
    ...overrides,
  };
}

function buildToolReadinessEvaluation() {
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
        reason: 'The MAS inspection tool is ready.',
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

function buildBaseRuntimeInput({
  actionAffordances,
  classifierAdapter,
  inputText = 'Voce pode revisar o estado atual do MAS sem modificar nada?',
}) {
  return {
    invocationId: 'sir-test-001',
    request: {
      command: 'ask',
      inputText,
      conversationId: null,
    },
    readiness: {
      operationalIdentityDefinition: {
        operationalIdentityId: 'alfred',
        displayName: 'Alfred',
      },
      activeCognitiveSet: {
        primaryCognitiveIdentityId: 'system-steward',
        secondaryCognitiveIdentityIds: [],
      },
      toolReadiness: buildToolReadinessEvaluation(),
      conversationContext: null,
    },
    mode: 'adapter',
    classifierId: 'sir-test-classifier',
    classifierAdapter,
    actionAffordanceReadResult: {
      kind: 'action_affordance_read_result',
      version: 1,
      actionAffordances,
      summary: {
        total: actionAffordances.length,
        tools: actionAffordances.filter((affordance) => affordance.targetType === 'tool').length,
        workflows: actionAffordances.filter((affordance) => affordance.targetType === 'workflow').length,
        withIntentMetadata: actionAffordances.filter((affordance) => affordance.intentMetadata !== null).length,
        ready: actionAffordances.length,
        approvalRequired: 0,
        unavailable: 0,
        notEvaluated: 0,
      },
      warnings: [],
    },
  };
}

test('runSemanticIntentRuntimeForInvocation classifies and synthesizes a ready tool request', async () => {
  const inspectAffordance = buildToolAffordance();
  const classifierAdapter = async (classifierRequest) => {
    assert.equal(classifierRequest.request.originalInput, 'Voce pode revisar o estado atual do MAS sem modificar nada?');
    assert.equal(classifierRequest.constraints.executionAllowed, false);
    assert.equal(classifierRequest.constraints.classifierAuthority, 'advisory_only');

    const candidate = buildSemanticClassifierCandidateFromAffordance({
      affordance: classifierRequest.actionAffordances[0],
      candidateId: 'candidate-semantic-mas-inspect-001',
      confidence: 'high',
      confidenceScore: 0.93,
      reason: 'The request semantically asks for a read-only MAS inspection.',
      matchedSignals: [
        'semantic-read-only-system-review',
      ],
      metadata: {
        runtimeInput: {
          includeCounts: true,
        },
      },
    });

    return buildSemanticClassifiedIntentFromCandidate({
      request: classifierRequest.request,
      candidate,
      intentId: 'admin.mas.inspect',
      intentType: 'administrative_diagnostic',
      confidence: 'high',
      confidenceScore: 0.93,
      normalizedGoal: 'Inspect the current MAS state without mutating it.',
      reason: 'The classifier selected the MAS System Inspect affordance.',
      evidence: [
        'The selected candidate references a known action affordance.',
      ],
    });
  };

  const result = await runSemanticIntentRuntimeForInvocation(buildBaseRuntimeInput({
    actionAffordances: [
      inspectAffordance,
    ],
    classifierAdapter,
  }));

  assert.equal(result.kind, 'semantic_intent_runtime');
  assert.equal(result.status, 'completed');
  assert.equal(result.mode, 'adapter');
  assert.equal(result.semanticIntentClassification.actionIntent.status, 'classified');
  assert.equal(result.semanticIntentClassification.actionIntent.understanding.version, 2);
  assert.equal(
    result.semanticIntentClassification.actionIntent.understanding.requestedOutcome,
    'Inspect the current MAS state without mutating it.',
  );
  assert.deepEqual(
    result.semanticIntentClassification.actionIntent.understanding.requiredEvidence,
    [
      'tool_observation',
    ],
  );
  assert.equal(
    result.semanticIntentClassification.actionIntent.understanding.knownReferences[0].referenceId,
    'mas.system.inspect',
  );
  assert.equal(result.actionResolution.status, 'accepted');
  assert.equal(result.actionResolution.source, 'semantic_classifier');
  assert.equal(result.intentResolution.status, 'resolved');
  assert.equal(result.intentResolution.source, 'semantic_classifier');
  assert.equal(result.intentResolution.target.targetId, 'mas.system.inspect');
  assert.equal(result.toolRequestResolution.status, 'accepted');
  assert.equal(result.toolRequestResolution.requestedToolId, 'mas.system.inspect');
  assert.deepEqual(result.toolRequestResolution.toolRequest.input, {
    includeCounts: true,
  });
  assert.equal(result.workflowRequestResolution, null);
});

test('runSemanticIntentRuntimeForInvocation refuses to synthesize write_internal tool requests without runtime input', async () => {
  const scheduleAffordance = buildToolAffordance({
    affordanceId: 'tool:mas.os.schedule_delegation',
    sourcePath: 'instance/tools/mas.os.schedule_delegation/tool.json',
    targetId: 'mas.os.schedule_delegation',
    displayName: 'MAS OS Schedule Delegation',
    description: 'Requests a future OpenMAS OS delegation.',
    sideEffectLevel: 'write_internal',
    intentMetadata: buildToolIntentMetadata({
      primaryIntentId: 'mas.os.schedule_delegation',
      targetId: 'mas.os.schedule_delegation',
      expectedSideEffectLevel: 'write_internal',
      semanticTags: [
        'scheduled-delegation',
        'delegate-later',
      ],
    }),
  });
  const classifierAdapter = async (classifierRequest) => {
    const candidate = buildSemanticClassifierCandidateFromAffordance({
      affordance: classifierRequest.actionAffordances[0],
      candidateId: 'candidate-semantic-schedule-delegation-001',
      confidence: 'high',
      confidenceScore: 0.94,
      reason: 'The request semantically asks for scheduled delegation.',
      matchedSignals: [
        'scheduled-delegation',
      ],
    });

    return buildSemanticClassifiedIntentFromCandidate({
      request: classifierRequest.request,
      candidate,
      intentId: 'mas.os.schedule_delegation',
      intentType: 'scheduled_delegation',
      confidence: 'high',
      confidenceScore: 0.94,
      normalizedGoal: 'Schedule Bruce to inspect the MAS later.',
      reason: 'The classifier selected scheduled delegation but did not provide structured runtime input.',
    });
  };

  const result = await runSemanticIntentRuntimeForInvocation(buildBaseRuntimeInput({
    actionAffordances: [
      scheduleAffordance,
    ],
    classifierAdapter,
    inputText: 'Please ask Bruce to inspect the MAS at 2026-05-21T18:00:00-05:00.',
  }));

  assert.equal(result.status, 'completed');
  assert.equal(result.actionResolution.status, 'needs_clarification');
  assert.equal(result.actionResolution.runtimeAction, 'ask_clarification');
  assert.match(result.actionResolution.reason, /semantic write_internal actions need explicit structured runtime input/u);
  assert.equal(result.toolRequestResolution, null);
});

test('runSemanticIntentRuntimeForInvocation keeps ambiguous semantic decisions non-executable', async () => {
  const inspectAffordance = buildToolAffordance();
  const workflowAffordance = buildWorkflowAffordance();
  const classifierAdapter = async (classifierRequest) => {
    const inspectCandidate = buildSemanticClassifierCandidateFromAffordance({
      affordance: classifierRequest.actionAffordances[0],
      candidateId: 'candidate-semantic-mas-inspect-001',
      confidence: 'medium',
      confidenceScore: 0.7,
      reason: 'The request could mean a quick MAS inspection.',
      matchedSignals: [
        'quick-mas-inspection',
      ],
    });
    const workflowCandidate = buildSemanticClassifierCandidateFromAffordance({
      affordance: classifierRequest.actionAffordances[1],
      candidateId: 'candidate-semantic-health-review-001',
      confidence: 'medium',
      confidenceScore: 0.69,
      reason: 'The request could mean a deeper MAS health review.',
      matchedSignals: [
        'deeper-mas-health-review',
      ],
    });

    return assertActionIntent({
      kind: 'action_intent',
      version: 1,
      status: 'ambiguous',
      source: 'semantic_classifier',
      intentId: 'admin.mas.review',
      intentType: 'administrative_review',
      confidence: 'medium',
      confidenceScore: 0.7,
      understanding: {
        kind: 'action_request_understanding',
        version: 1,
        originalInput: classifierRequest.request.originalInput,
        normalizedGoal: 'Review MAS state.',
        requestType: 'diagnostic',
        temporalFocus: 'current',
        riskLevel: 'low',
        requiresAction: true,
        requiresClarification: true,
        summary: 'The request could map to more than one read-only administrative action.',
        evidence: [
          'Two known affordances are plausible.',
        ],
        missingContext: [],
        warnings: [],
      },
      candidates: [
        inspectCandidate,
        workflowCandidate,
      ],
      selectedCandidateId: null,
      clarificationRequest: {
        kind: 'action_clarification_request',
        version: 1,
        clarificationId: 'clarification-semantic-review-001',
        reasonCategory: 'multiple_candidates',
        question: 'Should I run a quick MAS inspection or a deeper MAS health review?',
        candidateIds: [
          inspectCandidate.candidateId,
          workflowCandidate.candidateId,
        ],
        missingContext: [
          'specific_review_depth',
        ],
        blockingExecution: true,
        warnings: [],
      },
      reason: 'The classifier found multiple plausible read-only actions.',
      evidence: [
        'Ambiguous action selection was preserved.',
      ],
      warnings: [],
    });
  };

  const result = await runSemanticIntentRuntimeForInvocation(buildBaseRuntimeInput({
    actionAffordances: [
      inspectAffordance,
      workflowAffordance,
    ],
    classifierAdapter,
    inputText: 'Please review the MAS again.',
  }));

  assert.equal(result.status, 'completed');
  assert.equal(result.actionResolution.status, 'ambiguous');
  assert.equal(result.actionResolution.runtimeAction, 'ask_clarification');
  assert.equal(result.intentResolution.status, 'ambiguous');
  assert.equal(result.toolRequestResolution, null);
  assert.equal(result.workflowRequestResolution, null);
  assert.doesNotMatch(
    result.actionResolution.clarificationRequest.question,
    /confidence|runtime|readiness|policy/iu,
  );
  assert.equal(
    result.actionResolution.clarificationRequest.metadata.optionHints.length,
    2,
  );
});

test('runSemanticIntentRuntimeForInvocation skips classification when a runtime skip reason is provided', async () => {
  const result = await runSemanticIntentRuntimeForInvocation({
    ...buildBaseRuntimeInput({
      actionAffordances: [
        buildToolAffordance(),
      ],
      classifierAdapter: async () => {
        throw new Error('Classifier adapter should not run after skip reason.');
      },
    }),
    skipReason: 'Semantic intent runtime skipped because the final brain provider attempt did not complete.',
  });

  assert.equal(result.status, 'skipped');
  assert.equal(result.mode, 'adapter');
  assert.equal(result.reason, 'Semantic intent runtime skipped because the final brain provider attempt did not complete.');
  assert.equal(result.semanticIntentClassification, null);
  assert.equal(result.actionResolution.status, 'no_action');
  assert.equal(result.intentResolution.status, 'skipped');
  assert.deepEqual(result.warnings, []);
});

test('runSemanticIntentRuntimeForInvocation deduplicates classifier failure warnings', async () => {
  const result = await runSemanticIntentRuntimeForInvocation(buildBaseRuntimeInput({
    actionAffordances: [
      buildToolAffordance(),
    ],
    classifierAdapter: async () => {
      throw new Error('Classifier service returned incomplete output.');
    },
  }));

  const runtimeWarningMatches = result.warnings.filter((warning) => {
    return warning.includes('Classifier service returned incomplete output.');
  });
  const actionWarningMatches = result.actionResolution.warnings.filter((warning) => {
    return warning.includes('Classifier service returned incomplete output.');
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.actionResolution.status, 'needs_clarification');
  assert.equal(runtimeWarningMatches.length, 1);
  assert.equal(actionWarningMatches.length, 1);
});

test('runSemanticIntentRuntimeForInvocation degrades classifier failure to no_action for conversational answer-only turns', async () => {
  const result = await runSemanticIntentRuntimeForInvocation(buildBaseRuntimeInput({
    actionAffordances: [
      buildToolAffordance(),
    ],
    classifierAdapter: async () => {
      throw new Error('Classifier service returned empty output.');
    },
    inputText: 'Hola Alfred, como estas hoy?',
  }));

  assert.equal(result.status, 'failed');
  assert.equal(result.semanticIntentClassification.actionIntent.status, 'no_action');
  assert.equal(result.semanticIntentClassification.actionIntent.understanding.version, 2);
  assert.match(
    result.semanticIntentClassification.actionIntent.understanding.requestedOutcome,
    /conversational no-action request/i,
  );
  assert.equal(result.actionResolution.status, 'no_action');
  assert.equal(result.actionResolution.runtimeAction, 'answer_only');
  assert.match(result.actionResolution.reason, /treated as answer-only/i);
  assert.equal(result.warnings.length, 0);
});

test('runSemanticIntentRuntimeForInvocation accepts first-class conversational no-action intents without classifier failure noise', async () => {
  const result = await runSemanticIntentRuntimeForInvocation(buildBaseRuntimeInput({
    actionAffordances: [
      buildToolAffordance(),
    ],
    classifierAdapter: async (classifierRequest) => {
      return buildSemanticNoActionIntent({
        request: classifierRequest.request,
        requestType: 'greeting',
        reason: 'The user is greeting the agent and no runtime action is needed.',
        summary: 'Offer a conversational greeting without runtime execution.',
        evidence: [
          'The user greets the agent conversationally.',
        ],
      });
    },
    inputText: 'Hola Alfred, muy buenas tardes!',
  }));

  assert.equal(result.status, 'completed');
  assert.equal(result.semanticIntentClassification.actionIntent.status, 'no_action');
  assert.equal(result.semanticIntentClassification.actionIntent.understanding.requestType, 'greeting');
  assert.equal(result.actionResolution.status, 'no_action');
  assert.equal(result.warnings.length, 0);
});

test('runSemanticIntentRuntimeForInvocation resolves preview-only planning requests without synthesizing execution', async () => {
  const inspectAffordance = buildToolAffordance();
  const classifierAdapter = async (classifierRequest) => {
    const candidate = buildSemanticClassifierCandidateFromAffordance({
      affordance: classifierRequest.actionAffordances[0],
      candidateId: 'candidate-semantic-mas-inspect-plan-001',
      confidence: 'high',
      confidenceScore: 0.9,
      reason: 'The user wants a governed preview of the MAS inspection path before execution.',
      matchedSignals: [
        'inspection-plan-preview',
      ],
    });

    return buildSemanticClassifiedIntentFromCandidate({
      request: classifierRequest.request,
      candidate,
      intentId: 'admin.mas.inspect.plan',
      intentType: 'administrative_plan_preview',
      confidence: 'high',
      confidenceScore: 0.9,
      normalizedGoal: 'Preview the MAS inspection plan before execution.',
      requestedOutcome: 'Present the governed inspection plan before executing the selected capability.',
      requestType: 'plan_request',
      reason: 'The classifier selected the MAS System Inspect affordance for a preview-only planning request.',
      evidence: [
        'The request asks for a plan before execution.',
      ],
    });
  };

  const result = await runSemanticIntentRuntimeForInvocation(buildBaseRuntimeInput({
    actionAffordances: [
      inspectAffordance,
    ],
    classifierAdapter,
    inputText: 'Please show me the MAS inspection plan before executing anything.',
  }));

  assert.equal(result.status, 'completed');
  assert.equal(result.semanticIntentClassification.actionIntent.understanding.requestType, 'plan_request');
  assert.equal(result.actionResolution.status, 'plan_only');
  assert.equal(result.actionResolution.metadata.planMode, 'preview_only');
  assert.equal(result.intentResolution.status, 'resolved');
  assert.equal(result.intentResolution.target.targetId, 'mas.system.inspect');
  assert.equal(result.toolRequestResolution, null);
  assert.equal(result.workflowRequestResolution, null);
});

test('runSemanticIntentRuntimeForInvocation keeps clarification fallback for action-like turns when classifier fails', async () => {
  const result = await runSemanticIntentRuntimeForInvocation(buildBaseRuntimeInput({
    actionAffordances: [
      buildToolAffordance(),
    ],
    classifierAdapter: async () => {
      throw new Error('Classifier service returned empty output.');
    },
    inputText: 'Please inspect the MAS right now.',
  }));

  assert.equal(result.status, 'failed');
  assert.equal(result.semanticIntentClassification.actionIntent.status, 'needs_clarification');
  assert.equal(result.actionResolution.status, 'needs_clarification');
  assert.equal(result.actionResolution.runtimeAction, 'ask_clarification');
});
