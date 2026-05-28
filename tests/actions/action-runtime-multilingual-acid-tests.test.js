import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSemanticClassifiedIntentFromCandidate,
  buildSemanticClassifierCandidateFromAffordance,
  buildSemanticNoActionIntent,
  classifyActionIntentForInvocation,
} from '../../src/actions/classify-action-intent-for-invocation.js';
import { resolveActionForInvocation } from '../../src/actions/resolve-action-for-invocation.js';
import { assertActionIntent } from '../../src/contracts/action-intent-contract.js';

function buildReadinessSummary({
  status = 'ready',
  source = 'tool_readiness_evaluation',
  approvalRequired = false,
  reason = 'Affordance is ready for multilingual acid tests.',
  matchedBindingCount = 1,
  missingRequirementCount = 0,
} = {}) {
  return {
    kind: 'action_affordance_readiness_summary',
    version: 1,
    status,
    source,
    approvalRequired,
    reason,
    matchedBindingCount,
    missingRequirementCount,
    warnings: [],
  };
}

function buildToolAffordance({
  targetId,
  displayName,
  description,
  sideEffectLevel = 'read_only',
  readinessSummary = buildReadinessSummary(),
  semanticTags = [],
}) {
  return {
    kind: 'action_affordance',
    version: 1,
    affordanceId: `tool:${targetId}`,
    sourceType: 'tool_definition',
    sourcePath: `instance/tools/${targetId}/tool.json`,
    targetActionType: 'tool_execution',
    targetType: 'tool',
    targetId,
    displayName,
    description,
    owner: 'mas',
    lifecycleState: 'active',
    sideEffectLevel,
    executionMode: null,
    intentMetadata: null,
    readinessSummary,
    warnings: [],
    metadata: {
      semanticTags,
    },
  };
}

function buildMasInspectAffordance() {
  return buildToolAffordance({
    targetId: 'mas.system.inspect',
    displayName: 'MAS System Inspect',
    description: 'Read the current MAS inventory and diagnostic state without mutating the instance.',
    semanticTags: [
      'mas',
      'inspection',
      'diagnostic',
      'current-state',
    ],
  });
}

function buildMasHealthReviewAffordance() {
  return buildToolAffordance({
    targetId: 'mas.health.review',
    displayName: 'MAS Health Review',
    description: 'Run a broader read-only MAS health review.',
    semanticTags: [
      'mas',
      'health',
      'review',
      'diagnostic',
    ],
  });
}

function buildPublishAffordance() {
  return buildToolAffordance({
    targetId: 'meta.campaign.publish',
    displayName: 'Meta Campaign Publish',
    description: 'Publish a campaign update to an external Meta channel.',
    sideEffectLevel: 'publish_external',
    readinessSummary: buildReadinessSummary({
      status: 'approval_required',
      approvalRequired: true,
      reason: 'External publishing requires human approval.',
      matchedBindingCount: 1,
    }),
    semanticTags: [
      'meta',
      'publish',
      'external-channel',
    ],
  });
}

function buildDomainInboxAffordance() {
  return buildToolAffordance({
    targetId: 'sin-cuchillo.community.inbox.inspect',
    displayName: 'Sin Cuchillo Community Inbox Inspect',
    description: 'Read current Sin Cuchillo community inbox state without posting replies.',
    semanticTags: [
      'sin-cuchillo',
      'community',
      'inbox',
      'read-only',
    ],
  });
}

function candidateIdForTarget(targetId) {
  return `candidate-${targetId.replaceAll('.', '-')}`;
}

function findAffordance(classifierRequest, targetId) {
  return classifierRequest.actionAffordances.find((affordance) => {
    return affordance.targetId === targetId;
  }) ?? null;
}

function buildCandidate({
  classifierRequest,
  targetId,
  confidence = 'high',
  confidenceScore = 0.92,
  reason = 'The request semantically maps to this action affordance.',
  matchedSignals = ['semantic-fixture-match'],
}) {
  const affordance = findAffordance(classifierRequest, targetId);

  assert.ok(affordance, `Missing test affordance: ${targetId}`);

  return buildSemanticClassifierCandidateFromAffordance({
    affordance,
    candidateId: candidateIdForTarget(targetId),
    confidence,
    confidenceScore,
    reason,
    matchedSignals,
  });
}

function buildClassifiedIntent({
  classifierRequest,
  targetId,
  intentId,
  intentType,
  normalizedGoal,
  confidence = 'high',
  confidenceScore = 0.92,
}) {
  const candidate = buildCandidate({
    classifierRequest,
    targetId,
    confidence,
    confidenceScore,
  });

  return buildSemanticClassifiedIntentFromCandidate({
    request: classifierRequest.request,
    candidate,
    intentId,
    intentType,
    confidence,
    confidenceScore,
    normalizedGoal,
    reason: `Semantic classifier fixture selected ${targetId}.`,
    evidence: [
      'The classifier selected one known action affordance.',
    ],
  });
}

function buildAmbiguousIntent({
  classifierRequest,
  candidateTargets,
  intentId = 'runtime.multiple_actions',
  reason = 'Multiple action affordances are plausible for this request.',
}) {
  const candidates = candidateTargets.map((targetId) => {
    return buildCandidate({
      classifierRequest,
      targetId,
      confidence: 'medium',
      confidenceScore: 0.72,
      reason: `The request could map to ${targetId}.`,
      matchedSignals: [
        `possible:${targetId}`,
      ],
    });
  });

  return assertActionIntent({
    kind: 'action_intent',
    version: 1,
    status: 'ambiguous',
    source: 'semantic_classifier',
    intentId,
    intentType: 'multi_action_or_ambiguous_request',
    confidence: 'medium',
    confidenceScore: 0.72,
    understanding: {
      kind: 'action_request_understanding',
      version: 1,
      originalInput: classifierRequest.request.originalInput,
      normalizedGoal: null,
      requestType: 'unknown',
      temporalFocus: 'current',
      riskLevel: candidates.some((candidate) => candidate.sideEffectLevel !== 'read_only') ? 'high' : 'low',
      requiresAction: true,
      requiresClarification: true,
      summary: reason,
      evidence: [
        'The request maps to more than one action affordance.',
      ],
      missingContext: [
        'single_action_selection',
      ],
      warnings: [],
    },
    candidates,
    selectedCandidateId: null,
    clarificationRequest: {
      kind: 'action_clarification_request',
      version: 1,
      clarificationId: 'clarification-multilingual-acid-001',
      reasonCategory: 'multiple_candidates',
      question: 'Please choose one action to execute first.',
      candidateIds: candidates.map((candidate) => candidate.candidateId),
      missingContext: [
        'single_action_selection',
      ],
      blockingExecution: true,
      warnings: [],
    },
    reason,
    evidence: [
      'Multiple candidates were returned by the semantic classifier fixture.',
    ],
    warnings: [],
  });
}

function buildScenarioClassifierAdapter() {
  return async (classifierRequest) => {
    assert.equal(classifierRequest.constraints.executionAllowed, false);
    assert.equal(classifierRequest.constraints.classifierAuthority, 'advisory_only');

    const scenario = classifierRequest.request.metadata.acidScenario;

    if (scenario === 'mas_inspect') {
      return buildClassifiedIntent({
        classifierRequest,
        targetId: 'mas.system.inspect',
        intentId: 'admin.mas.inspect',
        intentType: 'administrative_diagnostic',
        normalizedGoal: 'Inspect the current MAS state.',
      });
    }

    if (scenario === 'mas_inspect_medium_confidence') {
      return buildClassifiedIntent({
        classifierRequest,
        targetId: 'mas.system.inspect',
        intentId: 'admin.mas.inspect',
        intentType: 'administrative_diagnostic',
        normalizedGoal: 'Possibly inspect the current MAS state.',
        confidence: 'medium',
        confidenceScore: 0.71,
      });
    }

    if (scenario === 'ambiguous_review') {
      return buildAmbiguousIntent({
        classifierRequest,
        candidateTargets: [
          'mas.system.inspect',
          'mas.health.review',
        ],
        intentId: 'admin.mas.review',
        reason: 'The request could mean a quick inspection or a broader health review.',
      });
    }

    if (scenario === 'retrospective_question') {
      return buildSemanticNoActionIntent({
        request: classifierRequest.request,
        reason: 'The user asked about prior evidence instead of requesting a new action.',
        summary: 'Answer from available history without executing a new runtime action.',
        evidence: [
          'The request asks whether an action already happened.',
        ],
      });
    }

    if (scenario === 'publish_external') {
      return buildClassifiedIntent({
        classifierRequest,
        targetId: 'meta.campaign.publish',
        intentId: 'marketing.meta.publish',
        intentType: 'external_publish',
        normalizedGoal: 'Publish a Meta campaign update.',
      });
    }

    if (scenario === 'multi_action') {
      return buildAmbiguousIntent({
        classifierRequest,
        candidateTargets: [
          'mas.system.inspect',
          'meta.campaign.publish',
        ],
        reason: 'The request asks for both a read-only diagnostic and an external publish action.',
      });
    }

    if (scenario === 'domain_inbox_inspect') {
      return buildClassifiedIntent({
        classifierRequest,
        targetId: 'sin-cuchillo.community.inbox.inspect',
        intentId: 'sin_cuchillo.community.inbox.inspect',
        intentType: 'domain_community_diagnostic',
        normalizedGoal: 'Inspect Sin Cuchillo community inbox state.',
      });
    }

    return buildSemanticNoActionIntent({
      request: classifierRequest.request,
      reason: 'No scenario was selected by the deterministic semantic fixture.',
      summary: 'No action should be executed.',
    });
  };
}

async function classifyAndResolve({
  inputText,
  acidScenario,
  actionAffordances,
}) {
  const request = {
    command: 'ask',
    inputText,
    metadata: {
      acidScenario,
    },
  };
  const semanticIntentClassification = await classifyActionIntentForInvocation({
    request,
    actionAffordances,
    classifierAdapter: buildScenarioClassifierAdapter(),
    classifierId: 'ar-slice-10-deterministic-semantic-fixture',
  });
  const actionResolution = resolveActionForInvocation({
    request,
    semanticIntentClassification,
  });

  return {
    semanticIntentClassification,
    actionResolution,
  };
}

test('AR acid: English direct request resolves to a ready read-only MAS inspection action', async () => {
  const { semanticIntentClassification, actionResolution } = await classifyAndResolve({
    inputText: 'Please inspect the current MAS before answering.',
    acidScenario: 'mas_inspect',
    actionAffordances: [
      buildMasInspectAffordance(),
    ],
  });

  assert.equal(semanticIntentClassification.status, 'completed');
  assert.equal(semanticIntentClassification.actionIntent.understanding.originalInput, 'Please inspect the current MAS before answering.');
  assert.equal(actionResolution.status, 'accepted');
  assert.equal(actionResolution.source, 'semantic_classifier');
  assert.equal(actionResolution.runtimeAction, 'queue_tool_request');
  assert.equal(actionResolution.selectedCandidate.targetId, 'mas.system.inspect');
  assert.equal(actionResolution.executionAllowed, true);
});

test('AR acid: Spanish paraphrase resolves semantically without adding phrase-list coverage', async () => {
  const inputText = 'Hola Alfred, puedes mirar como esta el ecosistema MAS ahora mismo y traer evidencia actual?';
  const { semanticIntentClassification, actionResolution } = await classifyAndResolve({
    inputText,
    acidScenario: 'mas_inspect',
    actionAffordances: [
      buildMasInspectAffordance(),
    ],
  });

  assert.equal(semanticIntentClassification.actionIntent.understanding.originalInput, inputText);
  assert.equal(semanticIntentClassification.actionIntent.candidates[0].matchedSignals.includes('semantic-fixture-match'), true);
  assert.equal(actionResolution.status, 'accepted');
  assert.equal(actionResolution.selectedCandidate.targetId, 'mas.system.inspect');
});

test('AR acid: Portuguese paraphrase resolves through the same semantic action path', async () => {
  const inputText = 'Alfred, voce pode olhar o estado atual do MAS e me trazer evidencias seguras?';
  const { semanticIntentClassification, actionResolution } = await classifyAndResolve({
    inputText,
    acidScenario: 'mas_inspect',
    actionAffordances: [
      buildMasInspectAffordance(),
    ],
  });

  assert.equal(semanticIntentClassification.actionIntent.understanding.originalInput, inputText);
  assert.equal(actionResolution.status, 'accepted');
  assert.equal(actionResolution.runtimeAction, 'queue_tool_request');
});

test('AR acid: Italian paraphrase resolves through the same semantic action path', async () => {
  const inputText = 'Alfred, puoi controllare lo stato attuale del MAS e portarmi evidenze sicure?';
  const { semanticIntentClassification, actionResolution } = await classifyAndResolve({
    inputText,
    acidScenario: 'mas_inspect',
    actionAffordances: [
      buildMasInspectAffordance(),
    ],
  });

  assert.equal(semanticIntentClassification.actionIntent.understanding.originalInput, inputText);
  assert.equal(actionResolution.status, 'accepted');
  assert.equal(actionResolution.runtimeAction, 'queue_tool_request');
  assert.equal(actionResolution.selectedCandidate.targetId, 'mas.system.inspect');
});

test('AR acid: French paraphrase resolves through the same semantic action path', async () => {
  const inputText = 'Alfred, peux-tu verifier l etat actuel du MAS et me donner des preuves sures ?';
  const { semanticIntentClassification, actionResolution } = await classifyAndResolve({
    inputText,
    acidScenario: 'mas_inspect',
    actionAffordances: [
      buildMasInspectAffordance(),
    ],
  });

  assert.equal(semanticIntentClassification.actionIntent.understanding.originalInput, inputText);
  assert.equal(actionResolution.status, 'accepted');
  assert.equal(actionResolution.runtimeAction, 'queue_tool_request');
  assert.equal(actionResolution.selectedCandidate.targetId, 'mas.system.inspect');
});

test('AR acid: medium-confidence multilingual request asks clarification instead of executing', async () => {
  const { actionResolution } = await classifyAndResolve({
    inputText: 'Alfred, mira algo raro del sistema si te parece.',
    acidScenario: 'mas_inspect_medium_confidence',
    actionAffordances: [
      buildMasInspectAffordance(),
    ],
  });

  assert.equal(actionResolution.status, 'needs_clarification');
  assert.equal(actionResolution.runtimeAction, 'ask_clarification');
  assert.equal(actionResolution.executionAllowed, false);
  assert.equal(actionResolution.clarificationRequest.reasonCategory, 'low_confidence');
});

test('AR acid: ambiguous review request asks clarification between inspection and health review', async () => {
  const { semanticIntentClassification, actionResolution } = await classifyAndResolve({
    inputText: 'Can you review the MAS again?',
    acidScenario: 'ambiguous_review',
    actionAffordances: [
      buildMasInspectAffordance(),
      buildMasHealthReviewAffordance(),
    ],
  });

  assert.equal(semanticIntentClassification.actionIntent.status, 'ambiguous');
  assert.equal(actionResolution.status, 'ambiguous');
  assert.equal(actionResolution.runtimeAction, 'ask_clarification');
  assert.deepEqual(actionResolution.clarificationRequest.candidateIds, [
    'candidate-mas-system-inspect',
    'candidate-mas-health-review',
  ]);
});

test('AR acid: French ambiguous review request still asks clarification instead of guessing a workflow', async () => {
  const { semanticIntentClassification, actionResolution } = await classifyAndResolve({
    inputText: 'Peux-tu refaire une revue du MAS ?',
    acidScenario: 'ambiguous_review',
    actionAffordances: [
      buildMasInspectAffordance(),
      buildMasHealthReviewAffordance(),
    ],
  });

  assert.equal(semanticIntentClassification.actionIntent.status, 'ambiguous');
  assert.equal(actionResolution.status, 'ambiguous');
  assert.equal(actionResolution.runtimeAction, 'ask_clarification');
  assert.deepEqual(actionResolution.clarificationRequest.candidateIds, [
    'candidate-mas-system-inspect',
    'candidate-mas-health-review',
  ]);
});

test('AR acid: retrospective question does not execute a new inspection', async () => {
  const { semanticIntentClassification, actionResolution } = await classifyAndResolve({
    inputText: 'Alfred, ya revisaste el MAS antes o solo lo mencionaste?',
    acidScenario: 'retrospective_question',
    actionAffordances: [
      buildMasInspectAffordance(),
    ],
  });

  assert.equal(semanticIntentClassification.actionIntent.status, 'no_action');
  assert.equal(actionResolution.status, 'no_action');
  assert.equal(actionResolution.runtimeAction, 'answer_only');
  assert.equal(actionResolution.executionAllowed, false);
});

test('AR acid: risky external publish request requires approval even when classified with high confidence', async () => {
  const { actionResolution } = await classifyAndResolve({
    inputText: 'Publica este cambio de campana en Meta ahora mismo.',
    acidScenario: 'publish_external',
    actionAffordances: [
      buildPublishAffordance(),
    ],
  });

  assert.equal(actionResolution.status, 'approval_required');
  assert.equal(actionResolution.runtimeAction, 'request_human_approval');
  assert.equal(actionResolution.executionAllowed, false);
  assert.equal(actionResolution.approvalRequired, true);
  assert.equal(actionResolution.selectedCandidate.targetId, 'meta.campaign.publish');
});

test('AR acid: multi-action request asks clarification instead of mixing read-only and publish actions', async () => {
  const { actionResolution } = await classifyAndResolve({
    inputText: 'Revisa el MAS y despues publica el resumen en Meta.',
    acidScenario: 'multi_action',
    actionAffordances: [
      buildMasInspectAffordance(),
      buildPublishAffordance(),
    ],
  });

  assert.equal(actionResolution.status, 'ambiguous');
  assert.equal(actionResolution.runtimeAction, 'ask_clarification');
  assert.equal(actionResolution.executionAllowed, false);
  assert.equal(actionResolution.clarificationRequest.blockingExecution, true);
});

test('AR acid: domain-specific request resolves to a custom MAS-owned affordance, not a System Steward shortcut', async () => {
  const { semanticIntentClassification, actionResolution } = await classifyAndResolve({
    inputText: 'Maria necesita revisar el inbox de Sin Cuchillo sin responder todavia.',
    acidScenario: 'domain_inbox_inspect',
    actionAffordances: [
      buildMasInspectAffordance(),
      buildDomainInboxAffordance(),
    ],
  });

  assert.equal(semanticIntentClassification.actionIntent.intentId, 'sin_cuchillo.community.inbox.inspect');
  assert.equal(actionResolution.status, 'accepted');
  assert.equal(actionResolution.runtimeAction, 'queue_tool_request');
  assert.equal(actionResolution.selectedCandidate.targetId, 'sin-cuchillo.community.inbox.inspect');
});

test('AR acid: Italian domain-specific request resolves to a MAS-owned domain affordance without steward shortcuts', async () => {
  const inputText = 'Maria deve controllare la inbox di Sin Cuchillo senza rispondere ancora.';
  const { semanticIntentClassification, actionResolution } = await classifyAndResolve({
    inputText,
    acidScenario: 'domain_inbox_inspect',
    actionAffordances: [
      buildMasInspectAffordance(),
      buildDomainInboxAffordance(),
    ],
  });

  assert.equal(semanticIntentClassification.actionIntent.understanding.originalInput, inputText);
  assert.equal(semanticIntentClassification.actionIntent.intentId, 'sin_cuchillo.community.inbox.inspect');
  assert.equal(actionResolution.status, 'accepted');
  assert.equal(actionResolution.runtimeAction, 'queue_tool_request');
  assert.equal(actionResolution.selectedCandidate.targetId, 'sin-cuchillo.community.inbox.inspect');
});
