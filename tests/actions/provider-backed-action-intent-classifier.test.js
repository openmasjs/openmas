import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSemanticClassifiedIntentFromCandidate,
  buildSemanticClassifierCandidateFromAffordance,
} from '../../src/actions/classify-action-intent-for-invocation.js';
import {
  buildProviderIntentClassificationRequest,
  classifyActionIntentWithProvider,
  parseProviderIntentClassificationOutput,
} from '../../src/actions/provider-backed-action-intent-classifier.js';
import { assertActionIntent } from '../../src/contracts/action-intent-contract.js';

function buildPreparedProvider(overrides = {}) {
  return {
    brainId: 'openrouter-primary',
    providerId: 'openrouter-api',
    modelId: 'openrouter/free',
    resourceId: 'openrouter-api',
    secretReferenceId: 'openrouter-api-key',
    secretResolutionStatus: 'resolved',
    status: 'ready',
    reason: 'Provider is ready for intent classification tests.',
    ...overrides,
  };
}

function buildReadinessSummary(overrides = {}) {
  return {
    kind: 'action_affordance_readiness_summary',
    version: 1,
    status: 'ready',
    source: 'tool_readiness_evaluation',
    approvalRequired: false,
    reason: 'Affordance is ready for provider-backed classification tests.',
    matchedBindingCount: 1,
    missingRequirementCount: 0,
    warnings: [],
    ...overrides,
  };
}

function buildMasInspectAffordance(overrides = {}) {
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
    description: 'Reads safe MAS system state without mutating the instance.',
    owner: 'mas',
    lifecycleState: 'active',
    sideEffectLevel: 'read_only',
    executionMode: null,
    intentMetadata: {
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
        'system.review',
        'inspeccionar.mas',
      ],
      whenToUse: [
        'Use this when the user asks to inspect the MAS or review the current system state.',
      ],
      whenNotToUse: [
        'Do not use this when the user only wants a conceptual explanation.',
      ],
      exampleRequests: [
        'Hola Alfred, puedes inspeccionar el MAS?',
        'Please inspect the MAS now.',
      ],
      classificationGuidance: {
        highConfidenceSignals: [
          'inspeccionar el mas',
          'inspect the mas',
          'review the current system state',
        ],
        ambiguitySignals: [],
        negativeSignals: [],
        requiredContextKeys: [],
      },
      metadata: {},
    },
    readinessSummary: buildReadinessSummary(),
    warnings: [],
    metadata: {
      semanticTags: [
        'mas',
        'inspection',
        'diagnostic',
      ],
    },
    ...overrides,
  };
}

function buildClassifierRequest(overrides = {}) {
  return {
    kind: 'semantic_intent_classification_request',
    version: 1,
    request: {
      originalInput: 'Hola Alfred, puedes inspeccionar el MAS?',
      command: 'ask',
      conversationId: 'alfred-admin',
      metadata: {},
    },
    actionAffordances: [
      buildMasInspectAffordance(),
    ],
    constraints: {
      executionAllowed: false,
      classifierAuthority: 'advisory_only',
      candidatesMustReferenceKnownAffordances: true,
      actionAffordanceCount: 1,
    },
    ...overrides,
  };
}

function buildClassifiedInspectIntent({
  classifierRequest = buildClassifierRequest(),
  affordance = classifierRequest.actionAffordances[0],
  source = 'semantic_classifier',
  targetId = affordance.targetId,
  metadataAffordanceId = affordance.affordanceId,
} = {}) {
  const candidate = buildSemanticClassifierCandidateFromAffordance({
    affordance: {
      ...affordance,
      targetId,
    },
    candidateId: 'candidate-mas-inspect-001',
    confidence: 'high',
    confidenceScore: 0.94,
    reason: 'The user is asking for a current read-only MAS inspection.',
    matchedSignals: [
      'current-mas-inspection',
    ],
    metadata: {
      affordanceId: metadataAffordanceId,
    },
  });

  const actionIntent = buildSemanticClassifiedIntentFromCandidate({
    request: classifierRequest.request,
    candidate,
    intentId: 'admin.mas.inspect',
    intentType: 'administrative_diagnostic',
    confidence: 'high',
    confidenceScore: 0.94,
    normalizedGoal: 'Inspect the current MAS state.',
    reason: 'The provider-backed classifier selected the MAS inspection affordance.',
    evidence: [
      'The request asks to inspect the MAS.',
    ],
  });

  return assertActionIntent({
    ...actionIntent,
    source,
    candidates: actionIntent.candidates.map((entry) => {
      return {
        ...entry,
        source,
      };
    }),
  });
}

function buildNoActionIntent(classifierRequest = buildClassifierRequest()) {
  return assertActionIntent({
    kind: 'action_intent',
    version: 1,
    status: 'no_action',
    source: 'semantic_classifier',
    intentId: null,
    intentType: null,
    confidence: null,
    confidenceScore: null,
    understanding: {
      kind: 'action_request_understanding',
      version: 2,
      originalInput: classifierRequest.request.originalInput,
      normalizedGoal: null,
      requestedOutcome: 'Provide an answer without runtime execution.',
      requestType: 'answer',
      temporalFocus: 'current',
      riskLevel: 'none',
      requiresAction: false,
      requiresClarification: false,
      summary: 'The user asked a question that does not require runtime action.',
      requiredEvidence: [],
      knownReferences: [],
      evidence: [],
      missingContext: [],
      ambiguityMarkers: [],
      warnings: [],
    },
    candidates: [],
    selectedCandidateId: null,
    clarificationRequest: null,
    reason: 'No runtime action is needed.',
    evidence: [],
    warnings: [],
  });
}

function buildProviderResponse({
  outputText,
  status = 'completed',
  errorMessage = null,
  errorCode = null,
  providerFailure = null,
} = {}) {
  return {
    kind: 'provider_response',
    providerId: 'openrouter-api',
    modelId: 'openrouter/free',
    requestType: 'classify_intent',
    status,
    outputText,
    finishReason: status === 'completed' ? 'stop' : null,
    providerResponseId: 'provider-response-001',
    usage: {
      inputTokens: 100,
      outputTokens: 40,
      totalTokens: 140,
    },
    warnings: [],
    errorCode: status === 'failed' ? (errorCode ?? 'provider_failed') : null,
    errorMessage,
    providerFailure,
  };
}

test('buildProviderIntentClassificationRequest creates a strict classify_intent provider request', () => {
  const providerRequest = buildProviderIntentClassificationRequest({
    classifierRequest: buildClassifierRequest(),
    preparedProvider: buildPreparedProvider(),
  });

  assert.equal(providerRequest.kind, 'provider_request');
  assert.equal(providerRequest.requestType, 'classify_intent');
  assert.equal(providerRequest.providerId, 'openrouter-api');
  assert.equal(providerRequest.modelId, 'openrouter/free');
  assert.equal(providerRequest.temperature, 0);
  assert.equal(providerRequest.maxOutputTokens, 1600);
  assert.equal(providerRequest.messages.length, 2);
  assert.match(providerRequest.messages[0].content, /advisory action-intent classifier/);
  assert.match(providerRequest.messages[0].content, /must not execute/);
  assert.match(providerRequest.messages[0].content, /action_request_understanding/);
  assert.match(providerRequest.messages[0].content, /requestedOutcome/);
  assert.match(providerRequest.messages[0].content, /knownReferences/);
  assert.match(providerRequest.messages[0].content, /action_candidate/);
  assert.match(providerRequest.messages[0].content, /affordanceMatchEvidence/);
  assert.match(providerRequest.messages[0].content, /rejectedAlternatives/);
  assert.match(providerRequest.messages[0].content, /specific, actionable, and free of internal implementation noise/);
  assert.match(providerRequest.messages[0].content, /bounded conversation context contains one clear recent referent/);
  assert.match(providerRequest.messages[0].content, /keep the plan bounded to known affordances, known runtime evidence, and explicit request context/i);
  assert.match(providerRequest.messages[1].content, /provider_intent_classification_payload/);
  assert.match(providerRequest.messages[1].content, /mas\.system\.inspect/);
  assert.match(providerRequest.messages[1].content, /outputMustBeStrictJson/);
  assert.match(providerRequest.messages[1].content, /understandingContract/);
  assert.match(providerRequest.messages[1].content, /candidateContract/);
  assert.match(providerRequest.messages[1].content, /affordanceMatchEvidenceContract/);
  assert.match(providerRequest.messages[1].content, /rejectedAlternativeContract/);
});

test('parseProviderIntentClassificationOutput accepts strict JSON and exact JSON fences', () => {
  const actionIntent = buildNoActionIntent();
  const parsedJson = parseProviderIntentClassificationOutput({
    outputText: JSON.stringify(actionIntent),
  });
  const parsedFence = parseProviderIntentClassificationOutput({
    outputText: `\`\`\`json\n${JSON.stringify(actionIntent)}\n\`\`\``,
  });

  assert.equal(parsedJson.kind, 'action_intent');
  assert.equal(parsedFence.status, 'no_action');
});

test('parseProviderIntentClassificationOutput accepts practical fenced JSON variants from providers', () => {
  const actionIntent = buildNoActionIntent();
  const upperCaseFence = parseProviderIntentClassificationOutput({
    outputText: `\`\`\`JSON\n${JSON.stringify(actionIntent)}\n\`\`\``,
  });
  const missingClosingFence = parseProviderIntentClassificationOutput({
    outputText: `\`\`\`json\n${JSON.stringify(actionIntent)}`,
  });

  assert.equal(upperCaseFence.status, 'no_action');
  assert.equal(missingClosingFence.status, 'no_action');
});

test('parseProviderIntentClassificationOutput accepts and normalizes conversational no-action request types', () => {
  const greetingIntent = buildNoActionIntent();
  greetingIntent.understanding.requestType = 'greeting';

  const repairedIntent = buildNoActionIntent();
  repairedIntent.understanding.requestType = 'capabilities';

  const parsedGreetingIntent = parseProviderIntentClassificationOutput({
    outputText: JSON.stringify(greetingIntent),
  });
  const parsedRepairedIntent = parseProviderIntentClassificationOutput({
    outputText: JSON.stringify(repairedIntent),
  });

  assert.equal(parsedGreetingIntent.status, 'no_action');
  assert.equal(parsedGreetingIntent.understanding.requestType, 'greeting');
  assert.equal(parsedRepairedIntent.understanding.requestType, 'capability_question');
  assert.deepEqual(parsedRepairedIntent.metadata.providerOutputRepairs, [
    'understanding.requestType',
  ]);
});

test('parseProviderIntentClassificationOutput infers no_action status and repairs conversational temporal focus aliases', () => {
  const conversationalIntent = buildNoActionIntent();

  delete conversationalIntent.status;
  conversationalIntent.understanding.requestType = 'greeting';
  conversationalIntent.understanding.temporalFocus = 'present';

  const parsedIntent = parseProviderIntentClassificationOutput({
    outputText: JSON.stringify(conversationalIntent),
  });

  assert.equal(parsedIntent.status, 'no_action');
  assert.equal(parsedIntent.understanding.requestType, 'greeting');
  assert.equal(parsedIntent.understanding.temporalFocus, 'current');
  assert.deepEqual(parsedIntent.metadata.providerOutputRepairs, [
    'status',
    'understanding.temporalFocus',
  ]);
});

test('parseProviderIntentClassificationOutput repairs multilingual temporal focus aliases for governed plan previews', () => {
  const classifierRequest = buildClassifierRequest();
  const baseIntent = buildClassifiedInspectIntent({
    classifierRequest,
  });

  baseIntent.understanding.requestType = 'plan_request';
  baseIntent.understanding.temporalFocus = 'inmediato';

  const parsedIntent = parseProviderIntentClassificationOutput({
    outputText: JSON.stringify(baseIntent),
    requestOriginalInput: 'Bruce, ayudame con un plan de evaluacion del MAS sin ejecutar nada todavia.',
  });

  assert.equal(parsedIntent.status, 'classified');
  assert.equal(parsedIntent.understanding.requestType, 'plan_request');
  assert.equal(parsedIntent.understanding.temporalFocus, 'current');
  assert.match(parsedIntent.intentId, /^runtime\.plan_preview\./u);
  assert.deepEqual(parsedIntent.metadata.providerOutputRepairs, [
    'understanding.temporalFocus',
    'intentType',
    'intentId',
  ]);
});

test('parseProviderIntentClassificationOutput repairs compound temporal focus aliases for governed plan previews', () => {
  const classifierRequest = buildClassifierRequest();
  const baseIntent = buildClassifiedInspectIntent({
    classifierRequest,
  });

  baseIntent.understanding.requestType = 'plan_request';
  baseIntent.understanding.temporalFocus = 'present/future';

  const parsedIntent = parseProviderIntentClassificationOutput({
    outputText: JSON.stringify(baseIntent),
    requestOriginalInput: 'Bruce, ayudame con un plan de evaluacion del MAS antes de ejecutar nada.',
  });

  assert.equal(parsedIntent.status, 'classified');
  assert.equal(parsedIntent.understanding.requestType, 'plan_request');
  assert.equal(parsedIntent.understanding.temporalFocus, 'current');
  assert.match(parsedIntent.intentId, /^runtime\.plan_preview\./u);
  assert.deepEqual(parsedIntent.metadata.providerOutputRepairs, [
    'understanding.temporalFocus',
    'intentType',
    'intentId',
  ]);
});

test('parseProviderIntentClassificationOutput repairs preview-plan request types and unsafe candidate identifiers', () => {
  const classifierRequest = buildClassifierRequest();
  const baseIntent = buildClassifiedInspectIntent({
    classifierRequest,
  });
  const parsedIntent = parseProviderIntentClassificationOutput({
    outputText: JSON.stringify({
      ...baseIntent,
      understanding: {
        ...baseIntent.understanding,
        requestType: 'plan',
      },
      candidates: [
        {
          ...baseIntent.candidates[0],
          candidateId: 'plan:mas-inspection',
        },
      ],
      selectedCandidateId: 'plan:mas-inspection',
    }),
    requestOriginalInput: classifierRequest.request.originalInput,
  });

  assert.equal(parsedIntent.understanding.requestType, 'plan_request');
  assert.equal(parsedIntent.candidates[0].candidateId, 'plan-mas-inspection');
  assert.equal(parsedIntent.selectedCandidateId, 'plan-mas-inspection');
  assert.deepEqual(parsedIntent.metadata.providerOutputRepairs, [
    'candidates[0].candidateId',
    'understanding.requestType',
    'intentType',
    'intentId',
    'selectedCandidateId',
  ]);
});

test('parseProviderIntentClassificationOutput repairs plan-preview classifier fields and known reference source aliases', () => {
  const classifierRequest = buildClassifierRequest();
  const baseIntent = buildClassifiedInspectIntent({
    classifierRequest,
  });

  delete baseIntent.intentId;
  delete baseIntent.intentType;
  delete baseIntent.confidence;
  delete baseIntent.confidenceScore;
  delete baseIntent.selectedCandidateId;
  baseIntent.understanding.requestType = 'plan_request';
  baseIntent.understanding.knownReferences = [
    {
      kind: 'action_known_reference',
      version: 1,
      referenceType: 'tool',
      referenceId: 'mas.system.inspect',
      source: 'request',
      confidence: 'high',
    },
  ];

  const parsedIntent = parseProviderIntentClassificationOutput({
    outputText: JSON.stringify(baseIntent),
    requestOriginalInput: classifierRequest.request.originalInput,
  });

  assert.equal(parsedIntent.status, 'classified');
  assert.equal(parsedIntent.understanding.requestType, 'plan_request');
  assert.equal(parsedIntent.understanding.knownReferences[0].source, 'explicit_input');
  assert.equal(parsedIntent.selectedCandidateId, 'candidate-mas-inspect-001');
  assert.equal(parsedIntent.intentType, 'plan_preview');
  assert.equal(parsedIntent.intentId, 'runtime.plan_preview.tool.mas.system.inspect');
  assert.equal(parsedIntent.confidence, 'high');
  assert.equal(parsedIntent.confidenceScore, 0.94);
  assert.deepEqual(parsedIntent.metadata.providerOutputRepairs, [
    'understanding.knownReferences',
    'selectedCandidateId',
    'intentType',
    'intentId',
    'confidence',
    'confidenceScore',
  ]);
});

test('parseProviderIntentClassificationOutput repairs semantic-classifier known reference aliases for governed plans', () => {
  const classifierRequest = buildClassifierRequest();
  const baseIntent = buildClassifiedInspectIntent({
    classifierRequest,
  });

  baseIntent.understanding.requestType = 'plan_request';
  baseIntent.understanding.knownReferences = [
    {
      kind: 'action_known_reference',
      version: 1,
      referenceType: 'tool',
      referenceId: 'mas.system.inspect',
      source: 'semantic_classifier',
      confidence: 'high',
    },
  ];

  const parsedIntent = parseProviderIntentClassificationOutput({
    outputText: JSON.stringify(baseIntent),
    requestOriginalInput: classifierRequest.request.originalInput,
  });

  assert.equal(parsedIntent.understanding.knownReferences[0].source, 'provider_inference');
  assert.equal(parsedIntent.understanding.requestType, 'plan_request');
  assert.deepEqual(parsedIntent.metadata.providerOutputRepairs, [
    'understanding.knownReferences',
    'intentType',
    'intentId',
  ]);
});

test('parseProviderIntentClassificationOutput accepts invocation known references for governed plans', () => {
  const classifierRequest = buildClassifierRequest();
  const baseIntent = buildClassifiedInspectIntent({
    classifierRequest,
  });

  baseIntent.understanding.requestType = 'plan_request';
  baseIntent.understanding.knownReferences = [
    {
      kind: 'action_known_reference',
      version: 1,
      referenceType: 'invocation',
      referenceId: 'agent-invocation-001',
      source: 'runtime_context',
      confidence: 'high',
    },
  ];

  const parsedIntent = parseProviderIntentClassificationOutput({
    outputText: JSON.stringify(baseIntent),
    requestOriginalInput: classifierRequest.request.originalInput,
  });

  assert.equal(parsedIntent.status, 'classified');
  assert.equal(parsedIntent.understanding.requestType, 'plan_request');
  assert.equal(parsedIntent.understanding.knownReferences[0].referenceType, 'invocation');
  assert.equal(parsedIntent.understanding.knownReferences[0].referenceId, 'agent-invocation-001');
});

test('parseProviderIntentClassificationOutput repairs conversation_turn known-reference aliases to governed conversation references', () => {
  const classifierRequest = buildClassifierRequest();
  const baseIntent = buildClassifiedInspectIntent({
    classifierRequest,
  });

  baseIntent.understanding.requestType = 'plan_request';
  baseIntent.understanding.knownReferences = [
    {
      kind: 'action_known_reference',
      version: 1,
      referenceType: 'conversation_turn',
      referenceId: 'turn-001',
      source: 'conversation_context',
      confidence: 'medium',
    },
  ];

  const parsedIntent = parseProviderIntentClassificationOutput({
    outputText: JSON.stringify(baseIntent),
    requestOriginalInput: classifierRequest.request.originalInput,
  });

  assert.equal(parsedIntent.status, 'classified');
  assert.equal(parsedIntent.understanding.knownReferences[0].referenceType, 'conversation');
  assert.equal(parsedIntent.understanding.knownReferences[0].referenceId, 'turn-001');
  assert.ok(parsedIntent.metadata.providerOutputRepairs.includes('understanding.knownReferences'));
});

test('parseProviderIntentClassificationOutput repairs identity known-reference aliases to governed cognitive identity references', () => {
  const classifierRequest = buildClassifierRequest();
  const baseIntent = buildClassifiedInspectIntent({
    classifierRequest,
  });

  baseIntent.understanding.requestType = 'plan_request';
  baseIntent.understanding.knownReferences = [
    {
      kind: 'action_known_reference',
      version: 1,
      referenceType: 'identity',
      referenceId: 'evaluation-audit-steward',
      source: 'provider_inference',
      confidence: 'medium',
    },
  ];

  const parsedIntent = parseProviderIntentClassificationOutput({
    outputText: JSON.stringify(baseIntent),
    requestOriginalInput: 'Bruce, ayudame con un plan de evaluacion y diagnostico del MAS antes de ejecutar nada.',
  });

  assert.equal(parsedIntent.status, 'classified');
  assert.equal(parsedIntent.understanding.requestType, 'plan_request');
  assert.equal(parsedIntent.understanding.knownReferences[0].referenceType, 'cognitive_identity');
  assert.equal(parsedIntent.understanding.knownReferences[0].referenceId, 'evaluation-audit-steward');
  assert.ok(parsedIntent.metadata.providerOutputRepairs.includes('understanding.knownReferences'));
});

test('parseProviderIntentClassificationOutput repairs action_candidate requestType aliases for plan previews', () => {
  const classifierRequest = buildClassifierRequest();
  const baseIntent = buildClassifiedInspectIntent({
    classifierRequest,
  });

  baseIntent.understanding.requestType = 'action_candidate';

  const parsedIntent = parseProviderIntentClassificationOutput({
    outputText: JSON.stringify(baseIntent),
    requestOriginalInput: 'Bruce, podrias ayudarme con un plan de evaluacion del MAS sin ejecutar nada todavia?',
  });

  assert.equal(parsedIntent.status, 'classified');
  assert.equal(parsedIntent.understanding.requestType, 'plan_request');
  assert.match(parsedIntent.intentId, /^runtime\.plan_preview\./u);
  assert.deepEqual(parsedIntent.metadata.providerOutputRepairs, [
    'understanding.requestType',
    'intentType',
    'intentId',
  ]);
});

test('parseProviderIntentClassificationOutput repairs clarification reason aliases for governed plan clarifications', () => {
  const classifierRequest = buildClassifierRequest();
  const baseIntent = buildClassifiedInspectIntent({
    classifierRequest,
  });

  baseIntent.status = 'needs_clarification';
  baseIntent.intentId = 'admin.mas.evaluation.plan';
  baseIntent.intentType = 'administrative_review';
  baseIntent.confidence = 'medium';
  baseIntent.confidenceScore = 0.61;
  baseIntent.selectedCandidateId = null;
  baseIntent.understanding.requestType = 'plan_request';
  baseIntent.understanding.requiresClarification = true;
  baseIntent.understanding.summary = 'The user wants a governed evaluation plan before any execution.';
  baseIntent.clarificationRequest = {
    kind: 'action_clarification_request',
    version: 1,
    clarificationId: 'clarification-plan-preview-001',
    reasonCategory: 'ambiguity',
    question: 'Please clarify the exact evaluation path you want.',
    candidateIds: [],
    missingContext: [
      'safe_action_classification',
    ],
    blockingExecution: true,
    warnings: [],
  };

  const parsedIntent = parseProviderIntentClassificationOutput({
    outputText: JSON.stringify(baseIntent),
    requestOriginalInput: 'Bruce, ayudame con un plan de evaluacion y diagnostico del MAS.',
  });

  assert.equal(parsedIntent.status, 'needs_clarification');
  assert.equal(parsedIntent.clarificationRequest.reasonCategory, 'ambiguous_intent');
  assert.ok(parsedIntent.metadata.providerOutputRepairs.includes('clarificationRequest.reasonCategory'));
});

test('parseProviderIntentClassificationOutput repairs missing no_action candidates arrays to a safe empty list', () => {
  const noActionIntent = buildNoActionIntent();

  delete noActionIntent.candidates;
  delete noActionIntent.status;
  noActionIntent.understanding.requestType = 'greeting';

  const parsedIntent = parseProviderIntentClassificationOutput({
    outputText: JSON.stringify(noActionIntent),
  });

  assert.equal(parsedIntent.status, 'no_action');
  assert.deepEqual(parsedIntent.candidates, []);
  assert.deepEqual(parsedIntent.metadata.providerOutputRepairs, [
    'status',
    'candidates',
  ]);
});

test('parseProviderIntentClassificationOutput repairs harmless missing descriptive reasons', () => {
  const classifierRequest = buildClassifierRequest();
  const incompleteIntent = buildClassifiedInspectIntent({
    classifierRequest,
  });

  delete incompleteIntent.reason;
  delete incompleteIntent.candidates[0].reason;

  const parsedIntent = parseProviderIntentClassificationOutput({
    outputText: JSON.stringify(incompleteIntent),
  });

  assert.equal(parsedIntent.status, 'classified');
  assert.equal(parsedIntent.reason, incompleteIntent.understanding.summary);
  assert.equal(parsedIntent.candidates[0].reason, 'Provider selected action target mas.system.inspect.');
  assert.deepEqual(parsedIntent.metadata.providerOutputRepairs, [
    'candidates[0].reason',
    'reason',
  ]);
});

test('parseProviderIntentClassificationOutput repairs harmless missing structural contract fields', () => {
  const classifierRequest = buildClassifierRequest();
  const incompleteIntent = buildClassifiedInspectIntent({
    classifierRequest,
  });

  delete incompleteIntent.kind;
  delete incompleteIntent.version;
  delete incompleteIntent.source;
  delete incompleteIntent.understanding.kind;
  delete incompleteIntent.understanding.version;
  delete incompleteIntent.understanding.originalInput;
  delete incompleteIntent.understanding.requestedOutcome;
  delete incompleteIntent.understanding.requiredEvidence;
  delete incompleteIntent.understanding.knownReferences;
  delete incompleteIntent.understanding.ambiguityMarkers;
  delete incompleteIntent.candidates[0].kind;
  delete incompleteIntent.candidates[0].version;
  delete incompleteIntent.candidates[0].source;

  const parsedIntent = parseProviderIntentClassificationOutput({
    outputText: JSON.stringify(incompleteIntent),
    requestOriginalInput: classifierRequest.request.originalInput,
  });

  assert.equal(parsedIntent.kind, 'action_intent');
  assert.equal(parsedIntent.version, 1);
  assert.equal(parsedIntent.source, 'semantic_classifier');
  assert.equal(parsedIntent.understanding.kind, 'action_request_understanding');
  assert.equal(parsedIntent.understanding.version, 2);
  assert.equal(parsedIntent.understanding.originalInput, classifierRequest.request.originalInput);
  assert.equal(parsedIntent.understanding.requestedOutcome, 'Inspect the current MAS state.');
  assert.deepEqual(parsedIntent.understanding.requiredEvidence, [
    'tool_observation',
  ]);
  assert.equal(parsedIntent.understanding.knownReferences[0].referenceId, 'mas.system.inspect');
  assert.deepEqual(parsedIntent.understanding.ambiguityMarkers, []);
  assert.equal(parsedIntent.candidates[0].kind, 'action_candidate');
  assert.equal(parsedIntent.candidates[0].version, 1);
  assert.equal(parsedIntent.candidates[0].source, 'semantic_classifier');
  assert.deepEqual(parsedIntent.metadata.providerOutputRepairs, [
    'candidates[0].kind',
    'candidates[0].version',
    'candidates[0].source',
    'kind',
    'version',
    'source',
    'understanding.kind',
    'understanding.version',
    'understanding.originalInput',
    'understanding.requestedOutcome',
    'understanding.requiredEvidence',
    'understanding.knownReferences',
    'understanding.ambiguityMarkers',
  ]);
});

test('parseProviderIntentClassificationOutput repairs harmless nested classifier metadata fields', () => {
  const classifierRequest = buildClassifierRequest();
  const incompleteIntent = buildClassifiedInspectIntent({
    classifierRequest,
  });

  incompleteIntent.understanding.knownReferences = [
    {
      referenceType: 'tool',
      referenceId: 'mas.system.inspect',
    },
  ];
  delete incompleteIntent.candidates[0].metadata.affordanceMatchEvidence.kind;
  delete incompleteIntent.candidates[0].metadata.affordanceMatchEvidence.version;
  delete incompleteIntent.candidates[0].metadata.affordanceMatchEvidence.readinessReason;
  incompleteIntent.candidates[0].metadata.rejectedAlternatives = [
    {
      affordanceId: 'workflow:mas-health-review',
      targetType: 'workflow',
      targetId: 'mas-health-review',
      reason: 'A deeper review was not requested.',
    },
  ];

  const parsedIntent = parseProviderIntentClassificationOutput({
    outputText: JSON.stringify(incompleteIntent),
    requestOriginalInput: classifierRequest.request.originalInput,
  });

  assert.equal(parsedIntent.understanding.knownReferences[0].kind, 'action_known_reference');
  assert.equal(parsedIntent.understanding.knownReferences[0].version, 1);
  assert.equal(parsedIntent.understanding.knownReferences[0].source, 'provider_inference');
  assert.equal(parsedIntent.understanding.knownReferences[0].confidence, 'medium');
  assert.equal(parsedIntent.candidates[0].metadata.affordanceMatchEvidence.kind, 'action_affordance_match_evidence');
  assert.equal(parsedIntent.candidates[0].metadata.affordanceMatchEvidence.version, 1);
  assert.equal(
    parsedIntent.candidates[0].metadata.affordanceMatchEvidence.readinessReason,
    'The user is asking for a current read-only MAS inspection.',
  );
  assert.equal(parsedIntent.candidates[0].metadata.rejectedAlternatives[0].kind, 'action_affordance_rejection');
  assert.equal(parsedIntent.candidates[0].metadata.rejectedAlternatives[0].version, 1);
  assert.deepEqual(parsedIntent.candidates[0].metadata.rejectedAlternatives[0].matchedSignals, []);
  assert.deepEqual(parsedIntent.metadata.providerOutputRepairs, [
    'candidates[0].metadata.affordanceMatchEvidence.kind',
    'candidates[0].metadata.affordanceMatchEvidence.version',
    'candidates[0].metadata.affordanceMatchEvidence.readinessReason',
    'candidates[0].metadata.rejectedAlternatives[0].kind',
    'candidates[0].metadata.rejectedAlternatives[0].version',
    'candidates[0].metadata.rejectedAlternatives[0].matchedSignals',
    'understanding.knownReferences',
  ]);
});

test('parseProviderIntentClassificationOutput rejects prose, arrays, and malformed JSON', () => {
  assert.throws(
    () => parseProviderIntentClassificationOutput({
      outputText: `Here is JSON: ${JSON.stringify(buildNoActionIntent())}`,
    }),
    /strict JSON/,
  );

  assert.throws(
    () => parseProviderIntentClassificationOutput({
      outputText: JSON.stringify([
        buildNoActionIntent(),
      ]),
    }),
    /one JSON object/,
  );

  assert.throws(
    () => parseProviderIntentClassificationOutput({
      outputText: '{"kind": "action_intent"',
    }),
    /strict JSON/,
  );
});

test('classifyActionIntentWithProvider classifies through a mocked provider and records an audit trail', async () => {
  const classifierRequest = buildClassifierRequest();
  const providerIntent = buildClassifiedInspectIntent({
    classifierRequest,
  });
  const seenProviderRequests = [];
  const result = await classifyActionIntentWithProvider({
    request: classifierRequest.request,
    actionAffordances: classifierRequest.actionAffordances,
    preparedProvider: buildPreparedProvider(),
    classifierId: 'provider-backed-test-classifier',
    secretResolution: {
      secretValueByReferenceId: new Map([
        [
          'openrouter-api-key',
          'should-not-appear-in-audit',
        ],
      ]),
    },
    executeProviderRequestImplementation: async ({ providerRequest }) => {
      seenProviderRequests.push(providerRequest);
      return buildProviderResponse({
        outputText: JSON.stringify(providerIntent),
      });
    },
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.actionIntent.status, 'classified');
  assert.equal(result.actionIntent.selectedCandidateId, 'candidate-mas-inspect-001');
  assert.equal(result.providerClassifierAudit.status, 'completed');
  assert.equal(result.providerClassifierAudit.requestType, 'classify_intent');
  assert.equal(result.providerClassifierAudit.candidateCount, 1);
  assert.equal(result.providerClassifierAudit.providerRequest.messageCount, 2);
  assert.equal(result.providerClassifierAudit.providerResponse.usage.totalTokens, 140);
  assert.equal(seenProviderRequests.length, 1);
  assert.equal(JSON.stringify(result.providerClassifierAudit).includes('should-not-appear-in-audit'), false);
});

test('classifyActionIntentWithProvider fails safely when provider returns failed response', async () => {
  const classifierRequest = buildClassifierRequest();
  const result = await classifyActionIntentWithProvider({
    request: classifierRequest.request,
    actionAffordances: classifierRequest.actionAffordances,
    preparedProvider: buildPreparedProvider(),
    classifierId: 'provider-backed-test-classifier',
    executeProviderRequestImplementation: async () => {
      return buildProviderResponse({
        status: 'failed',
        outputText: null,
        errorMessage: 'Provider unavailable.',
      });
    },
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.failureKind, 'provider_failure');
  assert.equal(result.providerFailureCategory, null);
  assert.equal(result.actionIntent.status, 'needs_clarification');
  assert.equal(result.providerClassifierAudit.status, 'failed');
  assert.equal(result.providerClassifierAudit.failureKind, 'provider_failure');
  assert.equal(result.providerClassifierAudit.fallbackModeUsed, 'safe_clarification');
  assert.equal(result.providerClassifierAudit.attempts.length, 1);
  assert.match(result.warnings.join('\n'), /classifier provider failed safely/i);
  assert.match(result.providerClassifierAudit.warnings.join('\n'), /classifier provider failed safely/i);
});

test('classifyActionIntentWithProvider does not retry non-retryable provider failures even when maxAttempts is higher', async () => {
  const classifierRequest = buildClassifierRequest();
  let attemptCount = 0;

  const result = await classifyActionIntentWithProvider({
    request: classifierRequest.request,
    actionAffordances: classifierRequest.actionAffordances,
    preparedProvider: buildPreparedProvider(),
    retryPolicy: {
      kind: 'provider_retry_policy',
      version: 1,
      maxAttempts: 3,
      retryableFailureCategories: [
        'transient_unavailable',
      ],
      backoffStrategy: {
        kind: 'fixed',
        baseDelayMs: 100,
        maxDelayMs: 100,
      },
      maxElapsedMs: 5000,
      allowFallbackProvider: false,
      appliesToRequestTypes: [
        'classify_intent',
      ],
    },
    executeProviderRequestImplementation: async () => {
      attemptCount += 1;

      return buildProviderResponse({
        status: 'failed',
        outputText: null,
        errorCode: 'http_401',
        errorMessage: 'Invalid API key.',
        providerFailure: {
          kind: 'provider_failure',
          version: 1,
          category: 'authentication_failed',
          retryable: false,
          httpStatusCode: 401,
          providerErrorCode: 'invalid_api_key',
          providerErrorStatus: null,
          providerErrorType: null,
          adapterErrorName: null,
          safeMessage: 'Invalid API key.',
          diagnosticSummary: 'category=authentication_failed http=401 providerCode=invalid_api_key',
          originalErrorShape: {
            topLevelKeys: [],
            errorKeys: [],
            detailTypes: [],
          },
          metadata: {},
        },
      });
    },
  });

  assert.equal(result.status, 'failed');
  assert.equal(attemptCount, 1);
  assert.equal(result.providerClassifierAudit.attempts.length, 1);
  assert.equal(result.providerClassifierAudit.attempts[0].failureCategory, 'authentication_failed');
  assert.equal(result.providerClassifierAudit.attempts[0].retryDecision.shouldRetry, false);
});

test('classifyActionIntentWithProvider retries retryable provider failures before succeeding', async () => {
  const classifierRequest = buildClassifierRequest();
  const providerIntent = buildClassifiedInspectIntent({
    classifierRequest,
  });
  let attemptCount = 0;

  const result = await classifyActionIntentWithProvider({
    request: classifierRequest.request,
    actionAffordances: classifierRequest.actionAffordances,
    preparedProvider: buildPreparedProvider(),
    retryPolicy: {
      kind: 'provider_retry_policy',
      version: 1,
      maxAttempts: 2,
      retryableFailureCategories: [
        'transient_unavailable',
      ],
      backoffStrategy: {
        kind: 'fixed',
        baseDelayMs: 100,
        maxDelayMs: 100,
      },
      maxElapsedMs: 5000,
      allowFallbackProvider: false,
      appliesToRequestTypes: [
        'classify_intent',
      ],
    },
    executeProviderRequestImplementation: async () => {
      attemptCount += 1;

      if (attemptCount === 1) {
        return buildProviderResponse({
          status: 'failed',
          outputText: null,
          errorCode: 'http_503',
          errorMessage: 'Provider unavailable.',
          providerFailure: {
            kind: 'provider_failure',
            version: 1,
            category: 'transient_unavailable',
            retryable: true,
            httpStatusCode: 503,
            providerErrorCode: null,
            providerErrorStatus: 'UNAVAILABLE',
            providerErrorType: null,
            adapterErrorName: null,
            safeMessage: 'Provider unavailable.',
            diagnosticSummary: 'category=transient_unavailable http=503 providerStatus=UNAVAILABLE',
            originalErrorShape: {
              topLevelKeys: [],
              errorKeys: [],
              detailTypes: [],
            },
            metadata: {},
          },
        });
      }

      return buildProviderResponse({
        outputText: JSON.stringify(providerIntent),
      });
    },
  });

  assert.equal(result.status, 'completed');
  assert.equal(attemptCount, 2);
  assert.equal(result.providerClassifierAudit.attempts.length, 2);
  assert.equal(result.providerClassifierAudit.attempts[0].failureCategory, 'transient_unavailable');
  assert.equal(result.providerClassifierAudit.attempts[0].retryDecision.shouldRetry, true);
  assert.equal(result.providerClassifierAudit.attempts[1].status, 'completed');
});

test('classifyActionIntentWithProvider fails safely when provider invents an unknown affordance', async () => {
  const classifierRequest = buildClassifierRequest();
  const invalidIntent = buildClassifiedInspectIntent({
    classifierRequest,
    targetId: 'unknown.system.inspect',
  });
  const result = await classifyActionIntentWithProvider({
    request: classifierRequest.request,
    actionAffordances: classifierRequest.actionAffordances,
    preparedProvider: buildPreparedProvider(),
    executeProviderRequestImplementation: async () => {
      return buildProviderResponse({
        outputText: JSON.stringify(invalidIntent),
      });
    },
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.actionIntent.status, 'needs_clarification');
  assert.match(result.warnings[0], /unknown affordance/);
  assert.equal(result.providerClassifierAudit.providerResponse.status, 'completed');
});

test('classifyActionIntentWithProvider fails safely when provider uses the wrong source', async () => {
  const classifierRequest = buildClassifierRequest();
  const wrongSourceIntent = buildClassifiedInspectIntent({
    classifierRequest,
    source: 'brain_proposal',
  });
  const result = await classifyActionIntentWithProvider({
    request: classifierRequest.request,
    actionAffordances: classifierRequest.actionAffordances,
    preparedProvider: buildPreparedProvider(),
    executeProviderRequestImplementation: async () => {
      return buildProviderResponse({
        outputText: JSON.stringify(wrongSourceIntent),
      });
    },
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.actionIntent.status, 'needs_clarification');
  assert.match(result.warnings[0], /source "semantic_classifier"/);
});

test('classifyActionIntentWithProvider can retry parser failures before safe fallback', async () => {
  const classifierRequest = buildClassifierRequest();
  const providerIntent = buildClassifiedInspectIntent({
    classifierRequest,
  });
  let attemptCount = 0;
  const result = await classifyActionIntentWithProvider({
    request: classifierRequest.request,
    actionAffordances: classifierRequest.actionAffordances,
    preparedProvider: buildPreparedProvider(),
    retryPolicy: {
      maxAttempts: 2,
    },
    executeProviderRequestImplementation: async () => {
      attemptCount += 1;

      if (attemptCount === 1) {
        return buildProviderResponse({
          outputText: 'Not JSON.',
        });
      }

      return buildProviderResponse({
        outputText: JSON.stringify(providerIntent),
      });
    },
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.providerClassifierAudit.attempts.length, 2);
  assert.equal(result.providerClassifierAudit.attempts[0].status, 'failed');
  assert.equal(result.providerClassifierAudit.attempts[1].status, 'completed');
});

test('classifyActionIntentWithProvider keeps classification failure separate from provider failure when provider output is malformed', async () => {
  const classifierRequest = buildClassifierRequest();
  const malformedIntent = buildClassifiedInspectIntent({
    classifierRequest,
  });
  malformedIntent.candidates[0].matchedSignals = [];

  const result = await classifyActionIntentWithProvider({
    request: classifierRequest.request,
    actionAffordances: classifierRequest.actionAffordances,
    preparedProvider: buildPreparedProvider(),
    executeProviderRequestImplementation: async () => {
      return buildProviderResponse({
        outputText: JSON.stringify(malformedIntent),
      });
    },
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.failureKind, 'classification_failure');
  assert.equal(result.providerFailureCategory, null);
  assert.equal(result.actionIntent.status, 'needs_clarification');
  assert.match(result.warnings.join('\n'), /classifier output failed safely/i);
  assert.doesNotMatch(result.warnings.join('\n'), /classifier provider failed safely/i);
  assert.equal(result.providerClassifierAudit.status, 'failed');
  assert.equal(result.providerClassifierAudit.failureKind, 'classification_failure');
  assert.equal(result.providerClassifierAudit.providerResponse.status, 'completed');
  assert.equal(result.providerClassifierAudit.providerFailureCategory, null);
  assert.match(result.providerClassifierAudit.warnings.join('\n'), /classifier output failed safely/i);
});

test('classifyActionIntentWithProvider deduplicates repeated classification warnings across retry attempts', async () => {
  const classifierRequest = buildClassifierRequest();
  let attemptCount = 0;

  const result = await classifyActionIntentWithProvider({
    request: classifierRequest.request,
    actionAffordances: classifierRequest.actionAffordances,
    preparedProvider: buildPreparedProvider(),
    retryPolicy: {
      maxAttempts: 2,
    },
    executeProviderRequestImplementation: async () => {
      attemptCount += 1;

      return buildProviderResponse({
        outputText: 'Not JSON.',
      });
    },
  });

  assert.equal(result.status, 'failed');
  assert.equal(attemptCount, 2);
  assert.equal(result.failureKind, 'classification_failure');
  assert.equal(
    result.warnings.filter((warning) => warning.includes('strict JSON')).length,
    1,
  );
  assert.equal(
    result.providerClassifierAudit.warnings.filter((warning) => warning.includes('strict JSON')).length,
    1,
  );
});
