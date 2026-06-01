import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSemanticClassifiedIntentFromCandidate,
  buildSemanticClassifierCandidateFromAffordance,
  classifyActionIntentForInvocation,
} from '../../src/actions/classify-action-intent-for-invocation.js';
import { assertActionIntent } from '../../src/contracts/actions/action-intent-contract.js';

function buildReadinessSummary(overrides = {}) {
  return {
    kind: 'action_affordance_readiness_summary',
    version: 1,
    status: 'ready',
    source: 'tool_readiness_evaluation',
    approvalRequired: false,
    reason: 'Affordance is ready for classification tests.',
    matchedBindingCount: 1,
    missingRequirementCount: 0,
    warnings: [],
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
    intentMetadata: null,
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
    intentMetadata: null,
    readinessSummary: buildReadinessSummary({
      source: 'workflow_lifecycle',
      matchedBindingCount: 0,
      reason: 'Workflow is active but not executed by classification.',
    }),
    warnings: [],
    metadata: {
      stepCount: 1,
    },
    ...overrides,
  };
}

function buildStructuredToolIntentMetadata(overrides = {}) {
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
      'mas.inspect',
      'revisar.mas',
      'estado.actual',
    ],
    whenToUse: [
      'Use this when the user asks for a current MAS inspection.',
    ],
    whenNotToUse: [
      'Do not use this for conceptual questions.',
    ],
    exampleRequests: [
      'Please inspect the MAS.',
      'Podrias revisar el MAS?',
    ],
    classificationGuidance: {
      highConfidenceSignals: [
        'inspect the mas',
        'revisar el mas',
      ],
      ambiguitySignals: [],
      negativeSignals: [],
      requiredContextKeys: [],
    },
    metadata: {},
    ...overrides,
  };
}

function buildProseOnlyIntentMetadata(overrides = {}) {
  return {
    kind: 'action_intent_metadata',
    version: 1,
    primaryIntentId: 'admin.alpha.snapshot',
    targetActionType: 'tool_execution',
    targetType: 'tool',
    targetId: 'alpha.snapshot',
    expectedSideEffectLevel: 'read_only',
    requestTypes: [
      'diagnostic',
      'tool_action',
    ],
    semanticTags: [
      'alpha.snapshot',
    ],
    whenToUse: [
      'Use this when the user asks to review the current system state without changing anything.',
    ],
    whenNotToUse: [
      'Do not use this for mutations.',
    ],
    exampleRequests: [
      'Please review the current system state without changing anything.',
    ],
    classificationGuidance: {
      highConfidenceSignals: [
        'review the current system state without changing anything',
      ],
      ambiguitySignals: [],
      negativeSignals: [],
      requiredContextKeys: [],
    },
    metadata: {},
    ...overrides,
  };
}

function buildInspectClassifierAdapter() {
  return async (classifierRequest) => {
    assert.equal(classifierRequest.kind, 'semantic_intent_classification_request');
    assert.equal(classifierRequest.constraints.executionAllowed, false);
    assert.equal(classifierRequest.constraints.classifierAuthority, 'advisory_only');

    const inspectAffordance = classifierRequest.actionAffordances.find((affordance) => {
      return affordance.targetId === 'mas.system.inspect';
    });
    const candidate = buildSemanticClassifierCandidateFromAffordance({
      affordance: inspectAffordance,
      candidateId: 'candidate-mas-inspect-001',
      confidence: 'high',
      confidenceScore: 0.91,
      reason: 'The request semantically asks for a current MAS inspection.',
      matchedSignals: [
        'semantic-current-system-inspection',
      ],
    });

    return buildSemanticClassifiedIntentFromCandidate({
      request: classifierRequest.request,
      candidate,
      intentId: 'admin.mas.inspect',
      intentType: 'administrative_diagnostic',
      confidence: 'high',
      confidenceScore: 0.91,
      normalizedGoal: 'Inspect the current MAS state.',
      reason: 'The request maps to the MAS inspection affordance.',
      evidence: [
        'The classifier selected one read-only inspection affordance.',
      ],
    });
  };
}

test('classifyActionIntentForInvocation classifies a Spanish paraphrase through a deterministic semantic fixture', async () => {
  const result = await classifyActionIntentForInvocation({
    request: {
      command: 'ask',
      inputText: 'Hola Alfred, podrias hacer nuevamente una inspeccion al MAS?',
      metadata: {
        fixtureIntent: 'admin.mas.inspect',
      },
    },
    actionAffordances: [
      buildToolAffordance(),
    ],
    classifierAdapter: buildInspectClassifierAdapter(),
    classifierId: 'deterministic-fixture-classifier',
  });

  assert.equal(result.kind, 'semantic_intent_classification_result');
  assert.equal(result.status, 'completed');
  assert.equal(result.actionIntent.status, 'classified');
  assert.equal(result.actionIntent.selectedCandidateId, 'candidate-mas-inspect-001');
  assert.equal(result.actionIntent.candidates[0].targetId, 'mas.system.inspect');
  assert.equal(result.actionIntent.candidates[0].metadata.affordanceId, 'tool:mas.system.inspect');
  assert.equal(
    result.actionIntent.candidates[0].metadata.affordanceMatchEvidence.affordanceId,
    'tool:mas.system.inspect',
  );
  assert.deepEqual(
    result.actionIntent.candidates[0].metadata.affordanceMatchEvidence.matchedSignals,
    [
      'semantic-current-system-inspection',
    ],
  );
  assert.equal(
    result.actionIntent.candidates[0].metadata.affordanceMatchEvidence.readinessStatus,
    'ready',
  );
  assert.equal(result.classifierRequest.constraints.executionAllowed, false);
});

test('classifyActionIntentForInvocation preserves multilingual input without runtime phrase matching', async () => {
  const result = await classifyActionIntentForInvocation({
    request: {
      command: 'ask',
      inputText: 'Por favor, voce pode revisar o estado atual do MAS?',
      metadata: {
        fixtureIntent: 'admin.mas.inspect',
      },
    },
    actionAffordances: [
      buildToolAffordance(),
    ],
    classifierAdapter: buildInspectClassifierAdapter(),
    classifierId: 'deterministic-fixture-classifier',
  });

  assert.equal(result.status, 'completed');
  assert.equal(
    result.actionIntent.understanding.originalInput,
    'Por favor, voce pode revisar o estado atual do MAS?',
  );
  assert.equal(result.actionIntent.candidates[0].targetType, 'tool');
});

test('classifyActionIntentForInvocation short-circuits simple greetings as governed no_action turns', async () => {
  let classifierCallCount = 0;

  const result = await classifyActionIntentForInvocation({
    request: {
      command: 'ask',
      inputText: 'Hola de nuevo Bruce!',
      metadata: {},
    },
    actionAffordances: [
      buildToolAffordance(),
    ],
    classifierAdapter: async () => {
      classifierCallCount += 1;
      throw new Error('Classifier adapter should not run for simple greetings.');
    },
    classifierId: 'deterministic-fixture-classifier',
  });

  assert.equal(classifierCallCount, 0);
  assert.equal(result.status, 'completed');
  assert.equal(result.actionIntent.status, 'no_action');
  assert.equal(result.actionIntent.understanding.requestType, 'greeting');
  assert.match(result.actionIntent.reason, /conversational greeting/i);
  assert.deepEqual(result.warnings, []);
});

test('classifyActionIntentForInvocation short-circuits longer greeting and welcome introductions as governed no_action turns', async () => {
  let classifierCallCount = 0;

  const result = await classifyActionIntentForInvocation({
    request: {
      command: 'ask',
      inputText: 'Hola Bruce, muy buenas tardes! Mi nombre es Miguel, y te doy la Bienvenida al Equipo de OpenMAS!',
      metadata: {},
    },
    actionAffordances: [
      buildToolAffordance(),
    ],
    classifierAdapter: async () => {
      classifierCallCount += 1;
      throw new Error('Classifier adapter should not run for conversational greeting/welcome turns.');
    },
    classifierId: 'deterministic-fixture-classifier',
  });

  assert.equal(classifierCallCount, 0);
  assert.equal(result.status, 'completed');
  assert.equal(result.actionIntent.status, 'no_action');
  assert.equal(result.actionIntent.understanding.requestType, 'greeting');
  assert.match(result.actionIntent.reason, /conversational greeting/i);
  assert.deepEqual(result.warnings, []);
});

test('classifyActionIntentForInvocation does not use prose guidance as a primary lexical routing signal', async () => {
  const result = await classifyActionIntentForInvocation({
    request: {
      command: 'ask',
      inputText: 'Please review the current system state without changing anything.',
    },
    actionAffordances: [
      buildToolAffordance({
        targetId: 'alpha.snapshot',
        affordanceId: 'tool:alpha.snapshot',
        displayName: 'Alpha Snapshot',
        description: 'Captures a bounded alpha snapshot.',
        intentMetadata: buildProseOnlyIntentMetadata(),
      }),
    ],
    classifierAdapter: async () => {
      throw new Error('Classifier output was unavailable.');
    },
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.actionIntent.status, 'no_action');
  assert.match(result.actionIntent.reason, /answer-only/i);
});

test('classifyActionIntentForInvocation degrades greetings to low-noise conversational no_action when the classifier fails', async () => {
  const result = await classifyActionIntentForInvocation({
    request: {
      command: 'ask',
      inputText: 'Hola Alfred, muy buenas tardes! Como has estado? Que tal todo?',
    },
    actionAffordances: [
      buildToolAffordance({
        targetId: 'alpha.snapshot',
        affordanceId: 'tool:alpha.snapshot',
        displayName: 'Alpha Snapshot',
      }),
    ],
    classifierAdapter: async () => {
      throw new Error('Action intent candidates must be an array.');
    },
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.actionIntent.status, 'no_action');
  assert.equal(result.actionIntent.understanding.requestType, 'conversation');
  assert.deepEqual(result.actionIntent.warnings, []);
  assert.deepEqual(result.warnings, []);
});

test('classifyActionIntentForInvocation synthesizes a governed preview-only plan when classifier output fails for a clear plan request', async () => {
  const result = await classifyActionIntentForInvocation({
    request: {
      command: 'ask',
      inputText: 'Alfred, podrias ayudarme con un plan de inspeccion del MAS sin ejecutar nada todavia?',
      metadata: {},
    },
    actionAffordances: [
      buildToolAffordance({
        intentMetadata: buildStructuredToolIntentMetadata(),
      }),
      buildWorkflowAffordance(),
    ],
    classifierAdapter: async () => {
      throw new Error('Provider intent classifier output was not strict JSON: Unterminated string in JSON at position 250.');
    },
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.failureKind, 'classification_failure');
  assert.equal(result.actionIntent.status, 'classified');
  assert.equal(result.actionIntent.intentType, 'plan_preview');
  assert.equal(result.actionIntent.understanding.requestType, 'plan_request');
  assert.equal(result.actionIntent.selectedCandidateId, 'candidate-plan-preview-tool-mas-system-inspect');
  assert.equal(result.actionIntent.candidates[0].targetId, 'mas.system.inspect');
  assert.equal(result.actionIntent.candidates[0].metadata.affordanceId, 'tool:mas.system.inspect');
  assert.deepEqual(result.warnings, []);
});

test('classifyActionIntentForInvocation synthesizes a governed preview-only plan for broader Bruce-style audit wording when classifier output fails', async () => {
  const result = await classifyActionIntentForInvocation({
    request: {
      command: 'ask',
      inputText: 'Bruce, podrias ayudarme con un plan de evaluacion y diagnostico del MAS sin ejecutar nada todavia?',
      metadata: {},
    },
    actionAffordances: [
      buildToolAffordance({
        intentMetadata: buildStructuredToolIntentMetadata(),
      }),
      buildWorkflowAffordance(),
    ],
    classifierAdapter: async () => {
      throw new Error('Provider intent classifier output was not strict JSON: Unterminated string in JSON at position 2415 (line 52 column 194).');
    },
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.failureKind, 'classification_failure');
  assert.equal(result.actionIntent.status, 'classified');
  assert.equal(result.actionIntent.intentType, 'plan_preview');
  assert.equal(result.actionIntent.understanding.requestType, 'plan_request');
  assert.equal(result.actionIntent.selectedCandidateId, 'candidate-plan-preview-tool-mas-system-inspect');
  assert.equal(result.actionIntent.candidates[0].targetId, 'mas.system.inspect');
  assert.deepEqual(result.warnings, []);
});

test('classifyActionIntentForInvocation prefers mas.system.inspect for broader Bruce-style plan previews even with multiple read-only MAS tools', async () => {
  const result = await classifyActionIntentForInvocation({
    request: {
      command: 'ask',
      inputText: 'Bruce, me gustaria que me ayudaras nuevamente con el Plan de Evaluacion y Diagnostico del MAS!',
      metadata: {},
    },
    actionAffordances: [
      buildToolAffordance({
        intentMetadata: buildStructuredToolIntentMetadata(),
      }),
      buildToolAffordance({
        affordanceId: 'tool:mas.permissions.inspect',
        sourcePath: 'instance/tools/mas.permissions.inspect/tool.json',
        targetId: 'mas.permissions.inspect',
        displayName: 'MAS Permissions Inspect',
        description: 'Reads MAS permission and access state.',
        intentMetadata: buildStructuredToolIntentMetadata({
          primaryIntentId: 'admin.mas.permissions.inspect',
          targetId: 'mas.permissions.inspect',
          semanticTags: [
            'mas.permissions.inspect',
            'permisos.mas',
            'revisar.mas',
          ],
        }),
      }),
      buildToolAffordance({
        affordanceId: 'tool:mas.tools.inspect',
        sourcePath: 'instance/tools/mas.tools.inspect/tool.json',
        targetId: 'mas.tools.inspect',
        displayName: 'MAS Tools Inspect',
        description: 'Reads MAS tool inventory and readiness state.',
        intentMetadata: buildStructuredToolIntentMetadata({
          primaryIntentId: 'admin.mas.tools.inspect',
          targetId: 'mas.tools.inspect',
          semanticTags: [
            'mas.tools.inspect',
            'herramientas.mas',
            'revisar.mas',
          ],
        }),
      }),
      buildToolAffordance({
        affordanceId: 'tool:mas.workflows.inspect',
        sourcePath: 'instance/tools/mas.workflows.inspect/tool.json',
        targetId: 'mas.workflows.inspect',
        displayName: 'MAS Workflows Inspect',
        description: 'Reads MAS workflow inventory and readiness state.',
        intentMetadata: buildStructuredToolIntentMetadata({
          primaryIntentId: 'admin.mas.workflows.inspect',
          targetId: 'mas.workflows.inspect',
          semanticTags: [
            'mas.workflows.inspect',
            'flujos.mas',
            'revisar.mas',
          ],
        }),
      }),
      buildWorkflowAffordance(),
    ],
    classifierAdapter: async () => {
      throw new Error('Provider intent classifier output was not strict JSON: Expected double-quoted property name in JSON at position 2683 (line 58 column 33).');
    },
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.failureKind, 'classification_failure');
  assert.equal(result.actionIntent.status, 'classified');
  assert.equal(result.actionIntent.intentType, 'plan_preview');
  assert.equal(result.actionIntent.understanding.requestType, 'plan_request');
  assert.equal(result.actionIntent.selectedCandidateId, 'candidate-plan-preview-tool-mas-system-inspect');
  assert.equal(result.actionIntent.candidates[0].targetId, 'mas.system.inspect');
  assert.deepEqual(result.warnings, []);
});

test('classifyActionIntentForInvocation still treats structured routing hints as actionable when classifier fails', async () => {
  const result = await classifyActionIntentForInvocation({
    request: {
      command: 'ask',
      inputText: 'Podrias revisar el MAS ahora mismo?',
    },
    actionAffordances: [
      buildToolAffordance({
        intentMetadata: buildStructuredToolIntentMetadata(),
      }),
    ],
    classifierAdapter: async () => {
      throw new Error('Classifier output was unavailable.');
    },
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.actionIntent.status, 'needs_clarification');
  assert.match(result.actionIntent.reason, /no action can be selected safely/i);
});

test('classifyActionIntentForInvocation supports ambiguous classifier output with clarification', async () => {
  const result = await classifyActionIntentForInvocation({
    request: {
      command: 'ask',
      inputText: 'Can you review the MAS again?',
    },
    actionAffordances: [
      buildToolAffordance(),
      buildWorkflowAffordance(),
    ],
    classifierAdapter: async (classifierRequest) => {
      const inspectCandidate = buildSemanticClassifierCandidateFromAffordance({
        affordance: classifierRequest.actionAffordances[0],
        candidateId: 'candidate-mas-inspect-001',
        confidence: 'medium',
        confidenceScore: 0.72,
        reason: 'The request may mean a quick MAS inspection.',
        matchedSignals: [
          'quick-review-possible',
        ],
      });
      const workflowCandidate = buildSemanticClassifierCandidateFromAffordance({
        affordance: classifierRequest.actionAffordances[1],
        candidateId: 'candidate-mas-health-review-001',
        confidence: 'medium',
        confidenceScore: 0.7,
        reason: 'The request may mean a deeper MAS health review.',
        matchedSignals: [
          'deep-review-possible',
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
        confidenceScore: 0.71,
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
          summary: 'The request could map to a quick inspection or a deeper workflow.',
          evidence: [
            'Two read-only affordances are plausible.',
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
          clarificationId: 'clarification-mas-review-001',
          reasonCategory: 'multiple_candidates',
          question: 'Do you want a quick MAS inspection or a full MAS health review?',
          candidateIds: [
            inspectCandidate.candidateId,
            workflowCandidate.candidateId,
          ],
          missingContext: [],
          blockingExecution: true,
          warnings: [],
        },
        reason: 'The classifier found multiple plausible action affordances.',
        evidence: [
          'Two candidates were returned.',
        ],
        warnings: [],
      });
    },
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.actionIntent.status, 'ambiguous');
  assert.equal(result.actionIntent.candidates.length, 2);
  assert.equal(result.actionIntent.clarificationRequest.reasonCategory, 'multiple_candidates');
});

test('buildSemanticClassifierCandidateFromAffordance includes rejected alternatives when provided', () => {
  const inspectAffordance = buildToolAffordance();
  const workflowAffordance = buildWorkflowAffordance();
  const candidate = buildSemanticClassifierCandidateFromAffordance({
    affordance: inspectAffordance,
    candidateId: 'candidate-mas-inspect-001',
    confidence: 'high',
    reason: 'The request clearly asks for a quick MAS inspection.',
    matchedSignals: [
      'quick-inspection-request',
    ],
    rejectedAlternatives: [
      {
        affordance: workflowAffordance,
        reason: 'The request did not ask for a broader health review.',
        matchedSignals: [
          'review',
        ],
      },
    ],
  });

  assert.equal(candidate.metadata.rejectedAlternatives.length, 1);
  assert.equal(candidate.metadata.rejectedAlternatives[0].affordanceId, 'workflow:mas-health-review');
  assert.equal(candidate.metadata.rejectedAlternatives[0].targetId, 'mas-health-review');
});

test('classifyActionIntentForInvocation fails safely when classifier invents an affordance', async () => {
  const result = await classifyActionIntentForInvocation({
    request: {
      command: 'ask',
      inputText: 'Inspect the MAS.',
    },
    actionAffordances: [
      buildToolAffordance(),
    ],
    classifierAdapter: async (classifierRequest) => {
      const unknownCandidate = buildSemanticClassifierCandidateFromAffordance({
        affordance: {
          ...classifierRequest.actionAffordances[0],
          affordanceId: 'tool:unknown.tool',
          targetId: 'unknown.tool',
        },
      candidateId: 'candidate-unknown-tool-001',
      confidence: 'high',
      confidenceScore: 0.95,
      reason: 'This candidate should be rejected because it is unknown to the runtime.',
      matchedSignals: [
        'invented-unknown-affordance',
      ],
    });

      return buildSemanticClassifiedIntentFromCandidate({
        request: classifierRequest.request,
        candidate: unknownCandidate,
        intentId: 'admin.unknown.inspect',
        intentType: 'administrative_diagnostic',
        confidence: 'high',
        confidenceScore: 0.95,
        reason: 'Classifier invented a capability.',
      });
    },
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.actionIntent.status, 'needs_clarification');
  assert.equal(result.actionIntent.candidates.length, 0);
  assert.ok(result.warnings.some((warning) => warning.includes('unknown affordance')));
});

test('classifyActionIntentForInvocation repairs missing readiness evidence from the validated affordance', async () => {
  const result = await classifyActionIntentForInvocation({
    request: {
      command: 'ask',
      inputText: 'Inspect the MAS.',
    },
    actionAffordances: [
      buildToolAffordance(),
    ],
    classifierAdapter: async (classifierRequest) => {
      const candidate = buildSemanticClassifierCandidateFromAffordance({
        affordance: classifierRequest.actionAffordances[0],
        candidateId: 'candidate-mas-inspect-001',
        confidence: 'high',
        confidenceScore: 0.95,
        reason: 'The request maps to the MAS inspection tool.',
        matchedSignals: [
          'inspect-the-mas',
        ],
      });

      delete candidate.metadata.readinessStatus;
      delete candidate.metadata.affordanceMatchEvidence;

      return buildSemanticClassifiedIntentFromCandidate({
        request: classifierRequest.request,
        candidate,
        intentId: 'admin.mas.inspect',
        intentType: 'administrative_diagnostic',
        confidence: 'high',
        confidenceScore: 0.95,
        reason: 'The request maps to the MAS inspection affordance.',
      });
    },
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.actionIntent.status, 'classified');
  assert.equal(result.actionIntent.candidates[0].metadata.readinessStatus, 'ready');
  assert.equal(
    result.actionIntent.candidates[0].metadata.affordanceMatchEvidence.readinessStatus,
    'ready',
  );
  assert.equal(result.warnings.length, 0);
});

test('classifyActionIntentForInvocation fails safely when classifier output is malformed', async () => {
  const result = await classifyActionIntentForInvocation({
    request: {
      command: 'ask',
      inputText: 'Inspect the MAS.',
    },
    actionAffordances: [
      buildToolAffordance(),
    ],
    classifierAdapter: async () => {
      return {
        kind: 'not_action_intent',
      };
    },
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.actionIntent.status, 'needs_clarification');
  assert.match(result.warnings[0], /must include kind "action_intent"/);
});

test('classifyActionIntentForInvocation fails safely when no adapter is configured', async () => {
  const result = await classifyActionIntentForInvocation({
    request: {
      command: 'ask',
      inputText: 'Inspect the MAS.',
    },
    actionAffordances: [
      buildToolAffordance(),
    ],
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.actionIntent.status, 'needs_clarification');
  assert.match(result.warnings[0], /no classifier adapter was configured/);
});

test('classifyActionIntentForInvocation uses safe conversation context for clarification when a vague follow-up cannot be classified', async () => {
  const result = await classifyActionIntentForInvocation({
    request: {
      command: 'ask',
      inputText: 'Can you do that again?',
      metadata: {
        conversationContext: {
          conversationId: 'alfred-admin',
          recentTurns: [
            {
              sequenceNumber: 14,
              role: 'assistant',
              text: 'I can inspect the MAS again if you want.',
              runtimeReferences: [
                {
                  referenceType: 'tool',
                  referenceId: 'mas.system.inspect',
                },
              ],
            },
          ],
        },
      },
    },
    actionAffordances: [
      buildToolAffordance(),
    ],
    classifierAdapter: async () => {
      throw new Error('Classifier output was unavailable.');
    },
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.actionIntent.status, 'needs_clarification');
  assert.equal(result.actionIntent.clarificationRequest.reasonCategory, 'unsupported_request');
  assert.match(result.actionIntent.clarificationRequest.question, /mas\.system\.inspect/iu);
  assert.equal(result.actionIntent.clarificationRequest.metadata.contextReferences.length, 1);
});

test('buildSemanticClassifierCandidateFromAffordance refuses affordances without known side effects', () => {
  assert.throws(
    () => buildSemanticClassifierCandidateFromAffordance({
      affordance: buildWorkflowAffordance({
        sideEffectLevel: null,
      }),
      candidateId: 'candidate-workflow-001',
      confidence: 'high',
      reason: 'Cannot classify without known side-effect level.',
    }),
    /without sideEffectLevel/,
  );
});

test('classifyActionIntentForInvocation requires valid inputs', async () => {
  await assert.rejects(
    () => classifyActionIntentForInvocation({
      request: {
        inputText: '',
      },
      actionAffordances: [],
      classifierAdapter: async () => null,
    }),
    /non-empty request input/,
  );

  await assert.rejects(
    () => classifyActionIntentForInvocation({
      request: {
        inputText: 'Inspect the MAS.',
      },
      actionAffordances: [],
      classifierAdapter: 'not-a-function',
    }),
    /classifierAdapter must be a function/,
  );
});
