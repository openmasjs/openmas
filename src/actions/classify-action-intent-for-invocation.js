import { assertActionAffordances } from '../contracts/actions/action-affordance-contract.js';
import {
  assertActionCandidate,
  assertActionIntent,
} from '../contracts/actions/action-intent-contract.js';
import {
  buildHighQualityClarificationRequest,
  extractSafeConversationReferencesFromRequest,
} from './build-clarification-request-quality.js';

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isStructuredRoutingHint(value) {
  return typeof value === 'string'
    && /^[a-z0-9][a-z0-9._:-]*$/iu.test(value.trim());
}

function uniqueStrings(values) {
  const seenValues = new Set();
  const normalizedValues = [];

  for (const value of values) {
    if (!isNonEmptyString(value)) {
      continue;
    }

    const normalizedValue = value.trim();

    if (seenValues.has(normalizedValue)) {
      continue;
    }

    seenValues.add(normalizedValue);
    normalizedValues.push(normalizedValue);
  }

  return normalizedValues;
}

function normalizeClassifierFailureKind(error) {
  if (error?.failureKind === 'provider_failure') {
    return 'provider_failure';
  }

  return 'classification_failure';
}

function buildClassifierFailureWarning(error) {
  const failureKind = normalizeClassifierFailureKind(error);

  if (failureKind === 'provider_failure') {
    return `Semantic intent classifier provider failed safely: ${error.message}`;
  }

  return `Semantic intent classifier output failed safely: ${error.message}`;
}

function normalizeSignalText(value) {
  if (!isNonEmptyString(value)) {
    return null;
  }

  return value
    .normalize('NFD')
    .replace(/\p{Mark}+/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, ' ')
    .trim()
    .replace(/\s+/gu, ' ');
}

const CONVERSATIONAL_GREETING_PATTERNS = [
  /\bhello\b/iu,
  /\bhi\b/iu,
  /\bhey\b/iu,
  /\bhola\b/iu,
  /\bol[áa]\b/iu,
  /\bgreetings\b/iu,
  /\bgood\s+(?:morning|afternoon|evening)\b/iu,
  /\bbuen(?:os|as)\s+(?:dias|días|tardes|noches)\b/iu,
  /\bboa\s+(?:tarde|noite)\b/iu,
  /\bbom\s+dia\b/iu,
];

const CONVERSATIONAL_ACKNOWLEDGMENT_PATTERNS = [
  /\bthanks?\b/iu,
  /\bthank\s+you\b/iu,
  /\bgracias\b/iu,
  /\bobrigad[oa]\b/iu,
  /\bvale\b/iu,
  /\bok(?:ay)?\b/iu,
  /\bperfect[oa]\b/iu,
  /\bentendid[oa]\b/iu,
  /\bunderstood\b/iu,
  /\bgot\s+it\b/iu,
];

const CONVERSATIONAL_INTRODUCTION_PATTERNS = [
  /\bmy\s+name\s+is\b/iu,
  /\bi\s+am\s+[a-z]/iu,
  /\bmi\s+nombre\s+es\b/iu,
  /\bme\s+llamo\b/iu,
  /\bsoy\s+[a-z]/iu,
  /\bmeu\s+nome\s+e\b/iu,
  /\beu\s+sou\b/iu,
];

const CONVERSATIONAL_WELCOME_PATTERNS = [
  /\bwelcome\s+to\b/iu,
  /\bi\s+welcome\s+you\b/iu,
  /\bbienvenid[oa]s?\b/iu,
  /\bte\s+doy\s+la\s+bienvenida\b/iu,
  /\bbem[-\s]?vind[oa]s?\b/iu,
  /\bte\s+dou\s+as\s+boas-vindas\b/iu,
];

const CONVERSATIONAL_CAPABILITY_PATTERNS = [
  /\bwhat\s+can\s+you\s+do\b/iu,
  /\bcan\s+you\s+help\b/iu,
  /\bhelp\s+me\s+with\b/iu,
  /\bcapabilit(?:y|ies)\b/iu,
  /\bque\s+puedes\b/iu,
  /\bqué\s+puedes\b/iu,
  /\bpodr(?:ia|ías|ias|ía)\s+ayudar/iu,
  /\bpode\s+ajudar\b/iu,
  /\bpoderia\s+ajudar\b/iu,
  /\bcomo\s+podes\b/iu,
];

const CONVERSATIONAL_EXPLANATION_PATTERNS = [
  /\bexplain\b/iu,
  /\bhow\s+does\b/iu,
  /\bwhat\s+is\b/iu,
  /\bwhy\b/iu,
  /\bexplic(?:a|ame|arme|ar)\b/iu,
  /\bcomo\s+funciona\b/iu,
  /\bqué\s+es\b/iu,
  /\bque\s+es\b/iu,
  /\bpor\s+que\b/iu,
  /\bporque\b/iu,
  /\bexplique\b/iu,
  /\bo\s+que\s+e\b/iu,
  /\bcomo\s+funciona\b/iu,
];

const PLAN_PREVIEW_PATTERNS = [
  /\bplan\b/iu,
  /\bpreview\b/iu,
  /\bbefore\s+(?:acting|execution|executing)\b/iu,
  /\bwithout\s+execut(?:e|ing|ion)\b/iu,
  /\bplan\s+de\b/iu,
  /\bantes\s+de\s+ejecutar\b/iu,
  /\bsin\s+ejecutar\b/iu,
  /\bplano\s+de\b/iu,
  /\bantes\s+de\s+executar\b/iu,
  /\bsem\s+executar\b/iu,
];

function tokenizeNormalizedText(value) {
  const normalizedValue = normalizeSignalText(value);

  if (!normalizedValue) {
    return [];
  }

  return normalizedValue.split(' ').filter(Boolean);
}

function hasSharedSemanticPrefix(leftToken, rightToken) {
  if (!isNonEmptyString(leftToken) || !isNonEmptyString(rightToken)) {
    return false;
  }

  if (leftToken.length < 6 || rightToken.length < 6) {
    return false;
  }

  return leftToken.slice(0, 4) === rightToken.slice(0, 4);
}

function matchesAnyPattern(value, patterns) {
  if (!isNonEmptyString(value)) {
    return false;
  }

  return patterns.some((pattern) => pattern.test(value));
}

function requestLooksLikePlanPreview(request) {
  const originalInput = isNonEmptyString(request?.originalInput)
    ? request.originalInput.trim()
    : null;

  return matchesAnyPattern(originalInput, PLAN_PREVIEW_PATTERNS);
}

function assertRequest(request) {
  if (!isPlainObject(request)) {
    throw new Error('Semantic intent classifier requires request to be an object.');
  }

  const originalInput = [
    request.originalInput,
    request.inputText,
    request.input,
  ].find(isNonEmptyString);

  if (!isNonEmptyString(originalInput)) {
    throw new Error('Semantic intent classifier requires a non-empty request input.');
  }

  return {
    originalInput: originalInput.trim(),
    command: isNonEmptyString(request.command) ? request.command.trim() : null,
    conversationId: isNonEmptyString(request.conversationId) ? request.conversationId.trim() : null,
    metadata: isPlainObject(request.metadata) ? { ...request.metadata } : {},
  };
}

function assertOptionalString(value, description, defaultValue) {
  if (value === undefined || value === null) {
    return defaultValue;
  }

  if (!isNonEmptyString(value)) {
    throw new Error(`${description} must be a non-empty string when provided.`);
  }

  return value.trim();
}

function assertOptionalFunction(value, description) {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== 'function') {
    throw new Error(`${description} must be a function when provided.`);
  }

  return value;
}

function buildAffordanceLookup(actionAffordances) {
  const affordancesByTarget = new Map();
  const affordancesById = new Map();

  for (const affordance of actionAffordances) {
    affordancesByTarget.set(`${affordance.targetType}:${affordance.targetId}`, affordance);
    affordancesById.set(affordance.affordanceId, affordance);
  }

  return {
    affordancesByTarget,
    affordancesById,
  };
}

function buildClassifierRequest({
  request,
  actionAffordances,
}) {
  return {
    kind: 'semantic_intent_classification_request',
    version: 1,
    request,
    actionAffordances,
    constraints: {
      executionAllowed: false,
      classifierAuthority: 'advisory_only',
      candidatesMustReferenceKnownAffordances: true,
      actionAffordanceCount: actionAffordances.length,
    },
  };
}

function toRequestTypeFromAffordance(affordance) {
  if (affordance.targetType === 'tool') {
    return 'tool_action';
  }

  if (affordance.targetType === 'workflow') {
    return 'workflow_action';
  }

  return 'unknown';
}

function toRiskLevelFromSideEffectLevel(sideEffectLevel) {
  if (sideEffectLevel === 'read_only') {
    return 'low';
  }

  if (sideEffectLevel === 'write_internal') {
    return 'medium';
  }

  if (
    sideEffectLevel === 'write_external'
    || sideEffectLevel === 'publish_external'
    || sideEffectLevel === 'financial'
    || sideEffectLevel === 'destructive'
  ) {
    return 'high';
  }

  return 'unknown';
}

function buildRequiredEvidenceForCandidate(candidate) {
  const evidenceKinds = [];

  if (candidate?.targetType === 'tool') {
    evidenceKinds.push('tool_observation');
  } else if (candidate?.targetType === 'workflow') {
    evidenceKinds.push('workflow_observation');
  } else {
    evidenceKinds.push('runtime_observation');
  }

  if (candidate?.requiresApproval) {
    evidenceKinds.push('approval_decision');
  }

  return uniqueStrings(evidenceKinds);
}

function buildKnownReferencesForCandidate(candidate) {
  if (!isPlainObject(candidate)) {
    return [];
  }

  return [
    {
      kind: 'action_known_reference',
      version: 1,
      referenceType: candidate.targetType ?? 'unknown',
      referenceId: candidate.targetId ?? null,
      label: candidate.targetId ?? null,
      source: 'runtime_context',
      confidence: candidate.confidence ?? 'medium',
      metadata: {
        affordanceId: candidate.metadata?.affordanceId ?? null,
      },
    },
  ];
}

function buildAffordanceMatchEvidenceFromAffordance({
  affordance,
  matchedSignals,
}) {
  return {
    kind: 'action_affordance_match_evidence',
    version: 1,
    affordanceId: affordance.affordanceId,
    targetType: affordance.targetType,
    targetId: affordance.targetId,
    matchedSignals: uniqueStrings(matchedSignals),
    readinessStatus: affordance.readinessSummary.status,
    readinessReason: affordance.readinessSummary.reason,
    metadata: {
      readinessSource: affordance.readinessSummary.source,
      approvalRequired: affordance.readinessSummary.approvalRequired,
    },
  };
}

function buildRejectedAlternativeEntry(entry) {
  if (!isPlainObject(entry)) {
    throw new Error('Rejected alternative entry must be an object.');
  }

  const affordance = isPlainObject(entry.affordance)
    ? entry.affordance
    : null;
  const affordanceId = affordance?.affordanceId ?? entry.affordanceId;
  const targetType = affordance?.targetType ?? entry.targetType;
  const targetId = affordance?.targetId ?? entry.targetId;

  if (!isNonEmptyString(entry.reason)) {
    throw new Error('Rejected alternative entry reason must be a non-empty string.');
  }

  return {
    kind: 'action_affordance_rejection',
    version: 1,
    affordanceId,
    targetType,
    targetId,
    reason: entry.reason.trim(),
    matchedSignals: uniqueStrings(Array.isArray(entry.matchedSignals) ? entry.matchedSignals : []),
    metadata: isPlainObject(entry.metadata)
      ? { ...entry.metadata }
      : {},
  };
}

function buildFallbackClarificationIntent({
  request,
  reason,
  warnings = [],
}) {
  return assertActionIntent({
    kind: 'action_intent',
    version: 1,
    status: 'needs_clarification',
    source: 'semantic_classifier',
    intentId: 'runtime.classification.unavailable',
    intentType: 'classification_failure',
    confidence: 'low',
    confidenceScore: 0,
    understanding: {
      kind: 'action_request_understanding',
      version: 2,
      originalInput: request.originalInput,
      normalizedGoal: null,
      requestedOutcome: 'Clarify the intended runtime action before execution.',
      requestType: 'unknown',
      temporalFocus: 'unspecified',
      riskLevel: 'unknown',
      requiresAction: false,
      requiresClarification: true,
      summary: 'The runtime could not classify the request safely.',
      requiredEvidence: [],
      knownReferences: [],
      evidence: [],
      missingContext: [
        'safe_action_classification',
      ],
      ambiguityMarkers: [
        'classification_unavailable',
      ],
      warnings,
    },
    candidates: [],
    selectedCandidateId: null,
    clarificationRequest: buildHighQualityClarificationRequest({
      clarificationId: 'classification-clarification-001',
      reasonCategory: 'unsupported_request',
      existingQuestion: 'I could not classify the requested action safely. Please restate the action or use an explicit tool/workflow request.',
      candidates: [],
      missingContext: [
        'safe_action_classification',
      ],
      warnings,
      request,
    }),
    reason,
    evidence: [],
    warnings,
  });
}

function buildFallbackNoActionIntent({
  request,
  reason,
  requestType = 'conversation',
  warnings = [],
}) {
  const summary = buildFallbackNoActionSummary(requestType);

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
      originalInput: request.originalInput,
      normalizedGoal: null,
      requestedOutcome: summary,
      requestType,
      temporalFocus: 'current',
      riskLevel: 'none',
      requiresAction: false,
      requiresClarification: false,
      summary,
      requiredEvidence: [],
      knownReferences: [],
      evidence: [],
      missingContext: [],
      ambiguityMarkers: [],
      warnings,
    },
    candidates: [],
    selectedCandidateId: null,
    clarificationRequest: null,
    reason,
    evidence: [],
    warnings,
  });
}

function buildDirectNoActionReason(requestType) {
  switch (requestType) {
    case 'greeting':
      return 'The user is greeting the agent without requesting any specific tool, workflow, or runtime action. This is a conversational greeting that does not require execution.';
    case 'acknowledgment':
      return 'The user is acknowledging prior context without requesting any specific tool, workflow, or runtime action. This is a conversational reply that does not require execution.';
    default:
      return 'The user is making a conversational no-action request that does not require runtime execution.';
  }
}

function inferConversationalRequestType(request) {
  const originalInput = isNonEmptyString(request?.originalInput)
    ? request.originalInput.trim()
    : null;
  const tokens = tokenizeNormalizedText(originalInput);
  const tokenCount = tokens.length;
  const hasQuestion = /[?¿]/u.test(originalInput ?? '');
  const hasGreeting = matchesAnyPattern(originalInput, CONVERSATIONAL_GREETING_PATTERNS);
  const hasAcknowledgment = matchesAnyPattern(originalInput, CONVERSATIONAL_ACKNOWLEDGMENT_PATTERNS);
  const hasIntroduction = matchesAnyPattern(originalInput, CONVERSATIONAL_INTRODUCTION_PATTERNS);
  const hasWelcome = matchesAnyPattern(originalInput, CONVERSATIONAL_WELCOME_PATTERNS);
  const hasCapabilityQuestion = matchesAnyPattern(originalInput, CONVERSATIONAL_CAPABILITY_PATTERNS);
  const hasExplanationQuestion = matchesAnyPattern(originalInput, CONVERSATIONAL_EXPLANATION_PATTERNS);

  if (hasQuestion && hasCapabilityQuestion) {
    return 'capability_question';
  }

  if (hasQuestion && hasExplanationQuestion) {
    return 'explanation_request';
  }

  if (
    hasGreeting
    && !hasQuestion
    && !hasCapabilityQuestion
    && !hasExplanationQuestion
    && (
      tokenCount <= 8
      || hasIntroduction
      || hasWelcome
    )
  ) {
    return 'greeting';
  }

  if (hasAcknowledgment && tokenCount <= 10 && !hasQuestion && !hasCapabilityQuestion && !hasExplanationQuestion) {
    return 'acknowledgment';
  }

  return 'conversation';
}

function shouldShortCircuitToConversationalNoAction({
  request,
  actionAffordances,
  requestType,
}) {
  if (request.command && request.command !== 'ask') {
    return false;
  }

  if (requestType !== 'greeting' && requestType !== 'acknowledgment') {
    return false;
  }

  return !hasActionAffordanceSignalMatch({
    request,
    actionAffordances,
  });
}

function buildFallbackNoActionSummary(requestType) {
  switch (requestType) {
    case 'greeting':
      return 'The runtime treated the turn as a conversational greeting because classifier execution failed and no actionable affordance signal was detected.';
    case 'acknowledgment':
      return 'The runtime treated the turn as a conversational acknowledgment because classifier execution failed and no actionable affordance signal was detected.';
    case 'capability_question':
      return 'The runtime treated the turn as a capability question requiring a conversational answer because classifier execution failed and no actionable affordance signal was detected.';
    case 'explanation_request':
      return 'The runtime treated the turn as an explanation request requiring a conversational answer because classifier execution failed and no actionable affordance signal was detected.';
    default:
      return 'The runtime treated the turn as a conversational no-action request because classifier execution failed and no actionable affordance signal was detected.';
  }
}

function buildFallbackNoActionWarnings(requestType, warning) {
  if (requestType === 'conversation'
    || requestType === 'greeting'
    || requestType === 'acknowledgment'
    || requestType === 'capability_question'
    || requestType === 'explanation_request') {
    return [];
  }

  return uniqueStrings([
    warning,
    'Semantic intent runtime degraded safely to answer-only because no actionable affordance signal was detected.',
  ]);
}

function collectMatchedAffordanceSignals({
  request,
  affordance,
}) {
  const normalizedInput = normalizeSignalText(request?.originalInput);
  const inputTokens = tokenizeNormalizedText(request?.originalInput);

  if (!normalizedInput) {
    return [];
  }

  const matchedSignals = [];
  const signals = collectAffordanceSignals(affordance);

  for (const signal of signals) {
    const normalizedSignal = normalizeSignalText(signal);

    if (!normalizedSignal) {
      continue;
    }

    if (!normalizedSignal.includes(' ') && normalizedSignal.length < 5) {
      continue;
    }

    if (normalizedInput.includes(normalizedSignal)) {
      matchedSignals.push(signal);
      continue;
    }

    const signalTokens = tokenizeNormalizedText(normalizedSignal);

    if (signalTokens.some((signalToken) => {
      return inputTokens.some((inputToken) => {
        return hasSharedSemanticPrefix(signalToken, inputToken);
      });
    })) {
      matchedSignals.push(signal);
    }
  }

  return uniqueStrings(matchedSignals);
}

function toPlanPreviewCandidateId(affordance) {
  const rawIdentifier = `${affordance?.targetType ?? 'candidate'}-${affordance?.targetId ?? 'plan-preview'}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '');

  return `candidate-plan-preview-${rawIdentifier || '001'}`;
}

function scorePlanPreviewFallbackAffordance(affordance) {
  if (!isPlainObject(affordance)) {
    return 0;
  }

  let score = 0;

  if (affordance.sideEffectLevel === 'read_only') {
    score += 4;
  }

  if (affordance.targetType === 'tool') {
    score += 3;
  }

  if (affordance.targetId === 'mas.system.inspect') {
    score += 12;
  }

  const semanticFields = [
    affordance.targetId,
    affordance.affordanceId,
    affordance.displayName,
    affordance.description,
    affordance.sourcePath,
    ...(Array.isArray(affordance?.intentMetadata?.semanticTags)
      ? affordance.intentMetadata.semanticTags
      : []),
  ]
    .map((value) => normalizeSignalText(value))
    .filter(Boolean)
    .join(' ');

  if (/\binspect(?:ion)?\b/iu.test(semanticFields)) {
    score += 5;
  }

  if (/\breview\b/iu.test(semanticFields)) {
    score += 3;
  }

  if (/\bdiagnostic\b/iu.test(semanticFields)) {
    score += 3;
  }

  if (/\bhealth\b/iu.test(semanticFields)) {
    score += 2;
  }

  if (/\bmas\b/iu.test(semanticFields)) {
    score += 1;
  }

  return score;
}

function selectPlanPreviewFallbackAffordance({
  request,
  actionAffordances,
}) {
  if (request.command && request.command !== 'ask') {
    return null;
  }

  if (!requestLooksLikePlanPreview(request)) {
    return null;
  }

  const rankedAffordances = actionAffordances
    .map((affordance) => {
      const matchedSignals = collectMatchedAffordanceSignals({
        request,
        affordance,
      });

      return {
        affordance,
        matchedSignals,
        score: matchedSignals.length,
        readOnlyPriority: affordance?.sideEffectLevel === 'read_only' ? 1 : 0,
        toolPriority: affordance?.targetType === 'tool' ? 1 : 0,
        heuristicScore: scorePlanPreviewFallbackAffordance(affordance),
      };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => {
      return right.score - left.score
        || right.readOnlyPriority - left.readOnlyPriority
        || right.toolPriority - left.toolPriority
        || right.heuristicScore - left.heuristicScore
        || String(left.affordance?.affordanceId ?? '').localeCompare(String(right.affordance?.affordanceId ?? ''));
    });

  if (rankedAffordances.length === 0) {
    const heuristicallyRankedAffordances = actionAffordances
      .map((affordance) => {
        return {
          affordance,
          matchedSignals: [],
          score: 0,
          readOnlyPriority: affordance?.sideEffectLevel === 'read_only' ? 1 : 0,
          toolPriority: affordance?.targetType === 'tool' ? 1 : 0,
          heuristicScore: scorePlanPreviewFallbackAffordance(affordance),
        };
      })
      .filter((entry) => entry.heuristicScore > 0)
      .sort((left, right) => {
        return right.heuristicScore - left.heuristicScore
          || right.readOnlyPriority - left.readOnlyPriority
          || right.toolPriority - left.toolPriority
          || String(left.affordance?.affordanceId ?? '').localeCompare(String(right.affordance?.affordanceId ?? ''));
      });

    if (heuristicallyRankedAffordances.length === 0) {
      return null;
    }

    const topHeuristicCandidate = heuristicallyRankedAffordances[0];
    const competingHeuristicCandidate = heuristicallyRankedAffordances[1];

    if (
      competingHeuristicCandidate
      && competingHeuristicCandidate.heuristicScore === topHeuristicCandidate.heuristicScore
      && competingHeuristicCandidate.readOnlyPriority === topHeuristicCandidate.readOnlyPriority
      && competingHeuristicCandidate.toolPriority === topHeuristicCandidate.toolPriority
    ) {
      return null;
    }

    return topHeuristicCandidate;
  }

  const topCandidate = rankedAffordances[0];
  const competingCandidate = rankedAffordances[1];

  if (
    competingCandidate
    && competingCandidate.score === topCandidate.score
    && competingCandidate.readOnlyPriority === topCandidate.readOnlyPriority
    && competingCandidate.toolPriority === topCandidate.toolPriority
    && competingCandidate.heuristicScore === topCandidate.heuristicScore
  ) {
    return null;
  }

  return topCandidate;
}

function buildFallbackPlanPreviewIntent({
  request,
  affordance,
  matchedSignals,
  warnings = [],
}) {
  const normalizedMatchedSignals = uniqueStrings(Array.isArray(matchedSignals) ? matchedSignals : []);
  const candidate = buildSemanticClassifierCandidateFromAffordance({
    affordance,
    candidateId: toPlanPreviewCandidateId(affordance),
    confidence: 'high',
    confidenceScore: 0.9,
    reason: `The user explicitly requested a preview plan before execution for ${affordance.targetId}.`,
    matchedSignals: normalizedMatchedSignals.length > 0
      ? normalizedMatchedSignals
      : [
        affordance.targetId,
      ],
    warnings,
  });

  return buildSemanticClassifiedIntentFromCandidate({
    request,
    candidate,
    intentId: `runtime.plan_preview.${affordance.targetType}.${affordance.targetId}`,
    intentType: 'plan_preview',
    confidence: 'high',
    confidenceScore: 0.9,
    normalizedGoal: `Preview a governed plan for ${affordance.displayName ?? affordance.targetId} before execution.`,
    requestedOutcome: `Provide a governed preview-only plan without executing ${affordance.targetId}.`,
    requestType: 'plan_request',
    reason: `The runtime synthesized a governed preview-only plan for ${affordance.targetId} because the user explicitly asked for a plan before execution and the provider classifier did not close safely.`,
    evidence: [
      `Matched known affordance signals: ${normalizedMatchedSignals.length > 0 ? normalizedMatchedSignals.join(', ') : affordance.targetId}.`,
      'Execution was not performed; this result only selects a preview-capable affordance.',
    ],
    warnings,
  });
}

function collectAffordanceSignals(affordance) {
  if (!isPlainObject(affordance)) {
    return [];
  }

  const intentMetadata = isPlainObject(affordance.intentMetadata)
    ? affordance.intentMetadata
    : null;
  const affordanceMetadata = isPlainObject(affordance.metadata)
    ? affordance.metadata
    : null;

  return uniqueStrings([
    affordance.targetId,
    affordance.affordanceId,
    intentMetadata?.primaryIntentId,
    ...(Array.isArray(intentMetadata?.semanticTags) ? intentMetadata.semanticTags : []),
    ...(Array.isArray(affordanceMetadata?.semanticTags) ? affordanceMetadata.semanticTags : []),
  ].filter(isStructuredRoutingHint));
}

function hasActionAffordanceSignalMatch({
  request,
  actionAffordances,
}) {
  const normalizedInput = normalizeSignalText(request.originalInput);
  const inputTokens = tokenizeNormalizedText(request.originalInput);

  if (!normalizedInput) {
    return false;
  }

  for (const affordance of actionAffordances) {
    const signals = collectAffordanceSignals(affordance);

    for (const signal of signals) {
      const normalizedSignal = normalizeSignalText(signal);

      if (!normalizedSignal) {
        continue;
      }

      if (!normalizedSignal.includes(' ') && normalizedSignal.length < 5) {
        continue;
      }

      if (normalizedInput.includes(normalizedSignal)) {
        return true;
      }

      const signalTokens = tokenizeNormalizedText(normalizedSignal);

      if (signalTokens.some((signalToken) => {
        return inputTokens.some((inputToken) => {
          return hasSharedSemanticPrefix(signalToken, inputToken);
        });
      })) {
        return true;
      }
    }
  }

  return false;
}

function shouldGracefullyFallbackToNoAction({
  request,
  actionAffordances,
}) {
  if (request.command && request.command !== 'ask') {
    return false;
  }

  if (!Array.isArray(actionAffordances) || actionAffordances.length === 0) {
    return false;
  }

  if (requestLooksLikePlanPreview(request)) {
    return false;
  }

  if (extractSafeConversationReferencesFromRequest(request).length > 0) {
    return false;
  }

  return !hasActionAffordanceSignalMatch({
    request,
    actionAffordances,
  });
}

function validateCandidateAgainstAffordance({
  candidate,
  affordancesByTarget,
  affordancesById,
}) {
  const affordance = affordancesByTarget.get(`${candidate.targetType}:${candidate.targetId}`);

  if (!affordance) {
    throw new Error(`Semantic classifier returned candidate for unknown affordance: ${candidate.targetType}:${candidate.targetId}`);
  }

  if (candidate.actionType !== affordance.targetActionType) {
    throw new Error(`Semantic classifier candidate actionType "${candidate.actionType}" does not match affordance targetActionType "${affordance.targetActionType}".`);
  }

  if (affordance.sideEffectLevel && candidate.sideEffectLevel !== affordance.sideEffectLevel) {
    throw new Error(`Semantic classifier candidate sideEffectLevel "${candidate.sideEffectLevel}" does not match affordance sideEffectLevel "${affordance.sideEffectLevel}".`);
  }

  if (
    candidate.metadata.affordanceId
    && candidate.metadata.affordanceId !== affordance.affordanceId
  ) {
    throw new Error(`Semantic classifier candidate metadata.affordanceId "${candidate.metadata.affordanceId}" does not match "${affordance.affordanceId}".`);
  }

  if (candidate.matchedSignals.length === 0) {
    throw new Error(`Semantic classifier candidate ${candidate.candidateId} must include matchedSignals.`);
  }

  const candidateReadinessStatus = isNonEmptyString(candidate.metadata.readinessStatus)
    ? candidate.metadata.readinessStatus.trim()
    : affordance.readinessSummary.status;

  if (candidateReadinessStatus !== affordance.readinessSummary.status) {
    throw new Error(`Semantic classifier candidate ${candidate.candidateId} readinessStatus "${candidateReadinessStatus}" does not match affordance readiness status "${affordance.readinessSummary.status}".`);
  }

  const normalizedMetadata = {
    ...candidate.metadata,
    affordanceId: affordance.affordanceId,
    displayName: affordance.displayName,
    description: affordance.description,
    readinessStatus: affordance.readinessSummary.status,
  };

  if (!isPlainObject(normalizedMetadata.affordanceMatchEvidence)) {
    normalizedMetadata.affordanceMatchEvidence = buildAffordanceMatchEvidenceFromAffordance({
      affordance,
      matchedSignals: candidate.matchedSignals,
    });
  } else {
    const matchEvidence = normalizedMetadata.affordanceMatchEvidence;

    if (matchEvidence.affordanceId !== affordance.affordanceId) {
      throw new Error(`Semantic classifier candidate ${candidate.candidateId} affordanceMatchEvidence.affordanceId "${matchEvidence.affordanceId}" does not match "${affordance.affordanceId}".`);
    }

    if (matchEvidence.targetType !== affordance.targetType || matchEvidence.targetId !== affordance.targetId) {
      throw new Error(`Semantic classifier candidate ${candidate.candidateId} affordanceMatchEvidence target does not match the selected affordance.`);
    }

    if (!Array.isArray(matchEvidence.matchedSignals) || matchEvidence.matchedSignals.length === 0) {
      throw new Error(`Semantic classifier candidate ${candidate.candidateId} affordanceMatchEvidence must include matchedSignals.`);
    }

    if (!isNonEmptyString(matchEvidence.readinessStatus)) {
      throw new Error(`Semantic classifier candidate ${candidate.candidateId} affordanceMatchEvidence must include readinessStatus.`);
    }

    if (matchEvidence.readinessStatus !== affordance.readinessSummary.status) {
      throw new Error(`Semantic classifier candidate ${candidate.candidateId} affordanceMatchEvidence readinessStatus "${matchEvidence.readinessStatus}" does not match affordance readiness status "${affordance.readinessSummary.status}".`);
    }

    if (!isNonEmptyString(matchEvidence.readinessReason)) {
      throw new Error(`Semantic classifier candidate ${candidate.candidateId} affordanceMatchEvidence must include readinessReason.`);
    }
  }

  if (Array.isArray(normalizedMetadata.rejectedAlternatives)) {
    for (const rejection of normalizedMetadata.rejectedAlternatives) {
      const knownAlternative = affordancesById.get(rejection.affordanceId)
        ?? affordancesByTarget.get(`${rejection.targetType}:${rejection.targetId}`);

      if (!knownAlternative) {
        throw new Error(`Semantic classifier candidate ${candidate.candidateId} references an unknown rejected alternative affordance: ${rejection.affordanceId}.`);
      }

      if (knownAlternative.affordanceId === affordance.affordanceId) {
        throw new Error(`Semantic classifier candidate ${candidate.candidateId} cannot reject the same affordance it selected.`);
      }
    }
  }

  return {
    ...candidate,
    metadata: normalizedMetadata,
  };
}

function validateIntentAgainstAffordances({
  actionIntent,
  request,
  actionAffordances,
}) {
  if (actionIntent.source !== 'semantic_classifier') {
    throw new Error(`Semantic classifier output must use source "semantic_classifier", received "${actionIntent.source}".`);
  }

  if (actionIntent.understanding.originalInput !== request.originalInput) {
    throw new Error('Semantic classifier output must preserve the original request input.');
  }

  const {
    affordancesByTarget,
    affordancesById,
  } = buildAffordanceLookup(actionAffordances);
  const normalizedCandidates = [];

  for (const candidate of actionIntent.candidates) {
    normalizedCandidates.push(validateCandidateAgainstAffordance({
      candidate,
      affordancesByTarget,
      affordancesById,
    }));
  }

  actionIntent.candidates = normalizedCandidates;

  if (
    (actionIntent.status === 'ambiguous' || actionIntent.status === 'needs_clarification')
    && actionIntent.clarificationRequest
  ) {
    const clarificationCandidates = actionIntent.clarificationRequest.candidateIds.length > 0
      ? normalizedCandidates.filter((candidate) => {
        return actionIntent.clarificationRequest.candidateIds.includes(candidate.candidateId);
      })
      : normalizedCandidates;

    actionIntent.clarificationRequest = buildHighQualityClarificationRequest({
      clarificationId: actionIntent.clarificationRequest.clarificationId,
      reasonCategory: actionIntent.clarificationRequest.reasonCategory,
      existingQuestion: actionIntent.clarificationRequest.question,
      candidates: clarificationCandidates,
      missingContext: actionIntent.clarificationRequest.missingContext,
      warnings: actionIntent.clarificationRequest.warnings,
      request,
      metadata: actionIntent.clarificationRequest.metadata,
    });
  }

  return actionIntent;
}

export function buildSemanticClassifierCandidateFromAffordance({
  affordance,
  candidateId,
  confidence,
  confidenceScore = null,
  reason,
  matchedSignals = [],
  rejectedAlternatives = [],
  missingContext = [],
  warnings = [],
  metadata = {},
}) {
  if (!isPlainObject(affordance)) {
    throw new Error('Semantic classifier candidate builder requires an affordance object.');
  }

  if (!isNonEmptyString(candidateId)) {
    throw new Error('Semantic classifier candidate builder requires a non-empty candidateId.');
  }

  if (!isNonEmptyString(confidence)) {
    throw new Error('Semantic classifier candidate builder requires a non-empty confidence.');
  }

  if (!isNonEmptyString(reason)) {
    throw new Error('Semantic classifier candidate builder requires a non-empty reason.');
  }

  if (!affordance.sideEffectLevel) {
    throw new Error(`Cannot build semantic classifier candidate for affordance without sideEffectLevel: ${affordance.affordanceId}`);
  }

  const normalizedRejectedAlternatives = Array.isArray(rejectedAlternatives)
    ? rejectedAlternatives.map(buildRejectedAlternativeEntry)
    : (() => {
      throw new Error('Semantic classifier candidate builder rejectedAlternatives must be an array when provided.');
    })();

  return assertActionCandidate({
    kind: 'action_candidate',
    version: 1,
    candidateId,
    actionType: affordance.targetActionType,
    targetType: affordance.targetType,
    targetId: affordance.targetId,
    source: 'semantic_classifier',
    confidence,
    confidenceScore,
    sideEffectLevel: affordance.sideEffectLevel,
    requiresApproval: affordance.readinessSummary.approvalRequired,
    reason,
    matchedSignals,
    missingContext,
    warnings,
    metadata: {
      ...metadata,
      affordanceId: affordance.affordanceId,
      sourcePath: affordance.sourcePath,
      displayName: affordance.displayName,
      description: affordance.description,
      readinessStatus: affordance.readinessSummary.status,
      affordanceMatchEvidence: buildAffordanceMatchEvidenceFromAffordance({
        affordance,
        matchedSignals,
      }),
      rejectedAlternatives: normalizedRejectedAlternatives,
    },
  });
}

export function buildSemanticNoActionIntent({
  request,
  reason,
  summary,
  requestType = 'answer',
  evidence = [],
  warnings = [],
}) {
  const normalizedRequest = assertRequest(request);

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
      originalInput: normalizedRequest.originalInput,
      normalizedGoal: null,
      requestedOutcome: summary,
      requestType,
      temporalFocus: 'unspecified',
      riskLevel: 'none',
      requiresAction: false,
      requiresClarification: false,
      summary,
      requiredEvidence: [],
      knownReferences: [],
      evidence,
      missingContext: [],
      ambiguityMarkers: [],
      warnings,
    },
    candidates: [],
    selectedCandidateId: null,
    clarificationRequest: null,
    reason,
    evidence,
    warnings,
  });
}

export function buildSemanticClassifiedIntentFromCandidate({
  request,
  candidate,
  intentId,
  intentType,
  confidence,
  confidenceScore = null,
  normalizedGoal = null,
  requestedOutcome = null,
  requestType = null,
  reason,
  evidence = [],
  warnings = [],
}) {
  const normalizedRequest = assertRequest(request);
  const normalizedCandidate = assertActionCandidate(candidate);
  const normalizedRequestType = isNonEmptyString(requestType)
    ? requestType.trim()
    : toRequestTypeFromAffordance({
      targetType: normalizedCandidate.targetType,
    });
  const normalizedRequestedOutcome = isNonEmptyString(requestedOutcome)
    ? requestedOutcome.trim()
    : (normalizedGoal ?? reason);

  return assertActionIntent({
    kind: 'action_intent',
    version: 1,
    status: 'classified',
    source: 'semantic_classifier',
    intentId,
    intentType,
    confidence,
    confidenceScore,
    understanding: {
      kind: 'action_request_understanding',
      version: 2,
      originalInput: normalizedRequest.originalInput,
      normalizedGoal,
      requestedOutcome: normalizedRequestedOutcome,
      requestType: normalizedRequestType,
      temporalFocus: 'current',
      riskLevel: toRiskLevelFromSideEffectLevel(normalizedCandidate.sideEffectLevel),
      requiresAction: true,
      requiresClarification: false,
      summary: reason,
      requiredEvidence: buildRequiredEvidenceForCandidate(normalizedCandidate),
      knownReferences: buildKnownReferencesForCandidate(normalizedCandidate),
      evidence,
      missingContext: [],
      ambiguityMarkers: [],
      warnings,
    },
    candidates: [
      normalizedCandidate,
    ],
    selectedCandidateId: normalizedCandidate.candidateId,
    clarificationRequest: null,
    reason,
    evidence,
    warnings,
  });
}

export async function classifyActionIntentForInvocation({
  request,
  actionAffordances,
  classifierAdapter = null,
  classifierId = 'semantic-classifier',
} = {}) {
  const normalizedRequest = assertRequest(request);
  const normalizedActionAffordances = assertActionAffordances(actionAffordances ?? []);
  const normalizedClassifierAdapter = assertOptionalFunction(
    classifierAdapter,
    'Semantic intent classifier classifierAdapter',
  );
  const normalizedClassifierId = assertOptionalString(
    classifierId,
    'Semantic intent classifier classifierId',
    'semantic-classifier',
  );

  const classifierRequest = buildClassifierRequest({
    request: normalizedRequest,
    actionAffordances: normalizedActionAffordances,
  });
  const conversationalRequestType = inferConversationalRequestType(normalizedRequest);

  if (shouldShortCircuitToConversationalNoAction({
    request: normalizedRequest,
    actionAffordances: normalizedActionAffordances,
    requestType: conversationalRequestType,
  })) {
    const actionIntent = buildFallbackNoActionIntent({
      request: normalizedRequest,
      reason: buildDirectNoActionReason(conversationalRequestType),
      requestType: conversationalRequestType,
      warnings: [],
    });

    return {
      kind: 'semantic_intent_classification_result',
      version: 1,
      status: 'completed',
      classifierId: normalizedClassifierId,
      classifierRequest,
      actionIntent,
      warnings: actionIntent.warnings,
    };
  }

  if (!normalizedClassifierAdapter) {
    const actionIntent = buildFallbackClarificationIntent({
      request: normalizedRequest,
      reason: 'No semantic classifier adapter was configured.',
      warnings: [
        'Semantic intent classifier skipped because no classifier adapter was configured.',
      ],
    });

    return {
      kind: 'semantic_intent_classification_result',
      version: 1,
      status: 'failed',
      classifierId: normalizedClassifierId,
      classifierRequest,
      actionIntent,
      warnings: actionIntent.warnings,
    };
  }

  try {
    const rawActionIntent = await normalizedClassifierAdapter(classifierRequest);
    const actionIntent = assertActionIntent(rawActionIntent);

    const normalizedActionIntent = validateIntentAgainstAffordances({
      actionIntent,
      request: normalizedRequest,
      actionAffordances: normalizedActionAffordances,
    });

    return {
      kind: 'semantic_intent_classification_result',
      version: 1,
      status: 'completed',
      classifierId: normalizedClassifierId,
      classifierRequest,
      actionIntent: normalizedActionIntent,
      warnings: normalizedActionIntent.warnings,
    };
  } catch (error) {
    const failureKind = normalizeClassifierFailureKind(error);
    const providerFailureCategory = isNonEmptyString(error?.providerFailure?.category)
      ? error.providerFailure.category.trim()
      : null;
    const providerId = isNonEmptyString(error?.providerId)
      ? error.providerId.trim()
      : null;
    const warning = buildClassifierFailureWarning(error);
    const shouldFallbackToNoAction = shouldGracefullyFallbackToNoAction({
      request: normalizedRequest,
      actionAffordances: normalizedActionAffordances,
    });
    const fallbackRequestType = shouldFallbackToNoAction
      ? conversationalRequestType
      : null;
    const fallbackWarnings = shouldFallbackToNoAction
      ? buildFallbackNoActionWarnings(fallbackRequestType, warning)
      : [warning];
    const fallbackPlanPreview = !shouldFallbackToNoAction
      ? selectPlanPreviewFallbackAffordance({
        request: normalizedRequest,
        actionAffordances: normalizedActionAffordances,
      })
      : null;
    const actionIntent = shouldFallbackToNoAction
      ? buildFallbackNoActionIntent({
        request: normalizedRequest,
        reason: failureKind === 'provider_failure'
          ? 'Semantic intent provider classification failed, but the request was treated as answer-only because no executable action signal was detected.'
          : 'Semantic intent classification output failed, but the request was treated as answer-only because no executable action signal was detected.',
        requestType: fallbackRequestType,
        warnings: fallbackWarnings,
      })
      : fallbackPlanPreview
        ? buildFallbackPlanPreviewIntent({
          request: normalizedRequest,
          affordance: fallbackPlanPreview.affordance,
          matchedSignals: fallbackPlanPreview.matchedSignals,
          warnings: [],
        })
        : buildFallbackClarificationIntent({
        request: normalizedRequest,
        reason: failureKind === 'provider_failure'
          ? 'Semantic intent provider classification failed and no action can be selected safely.'
          : 'Semantic intent classification failed validation and no action can be selected safely.',
        warnings: fallbackWarnings,
      });

    return {
      kind: 'semantic_intent_classification_result',
      version: 1,
      status: fallbackPlanPreview ? 'completed' : 'failed',
      failureKind,
      providerFailureCategory,
      providerId,
      classifierId: normalizedClassifierId,
      classifierRequest,
      actionIntent,
      warnings: actionIntent.warnings,
    };
  }
}
