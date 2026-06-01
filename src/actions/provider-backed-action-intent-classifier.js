import { assertActionAffordances } from '../contracts/actions/action-affordance-contract.js';
import { assertActionIntent } from '../contracts/actions/action-intent-contract.js';
import { assertBrainProviderPreparation } from '../contracts/providers/provider-integration-contract.js';
import {
  assertProviderRetryPolicy,
  createProviderRetryPolicy,
} from '../contracts/providers/provider-retry-policy-contract.js';
import { assertProviderRequest } from '../contracts/providers/provider-request-contract.js';
import { assertProviderResponse } from '../contracts/providers/provider-response-contract.js';
import { createProviderExecutionFailureResponse } from '../providers/create-provider-execution-failure-response.js';
import { executeProviderRequest } from '../providers/execute-provider-request.js';
import { resolveProviderRetryDecision } from '../providers/resolve-provider-retry-decision.js';
import { normalizeClarificationReasonCategoryValue } from './build-clarification-request-quality.js';
import { classifyActionIntentForInvocation } from './classify-action-intent-for-invocation.js';

const PROVIDER_INTENT_CLASSIFIER_REQUEST_TYPE = 'classify_intent';
const MAX_CLASSIFIER_ATTEMPTS = 3;
const CLASSIFIER_FAILURE_FALLBACK_MODE = 'safe_clarification';
const NORMALIZED_NO_ACTION_REQUEST_TYPES = new Map([
  ['answer_only', 'answer'],
  ['greeting', 'greeting'],
  ['salutation', 'greeting'],
  ['hello', 'greeting'],
  ['capability_question', 'capability_question'],
  ['capabilities', 'capability_question'],
  ['capability_inquiry', 'capability_question'],
  ['conversation', 'conversation'],
  ['conversational', 'conversation'],
  ['small_talk', 'conversation'],
  ['social_reply', 'conversation'],
  ['explanation', 'explanation_request'],
  ['explanation_request', 'explanation_request'],
  ['conceptual_explanation', 'explanation_request'],
  ['acknowledgment', 'acknowledgment'],
  ['acknowledgement', 'acknowledgment'],
  ['gratitude', 'acknowledgment'],
  ['thanks', 'acknowledgment'],
]);
const NORMALIZED_INTENT_STATUSES = new Map([
  ['no_action', 'no_action'],
  ['no-action', 'no_action'],
  ['answer', 'no_action'],
  ['answer_only', 'no_action'],
  ['conversation', 'no_action'],
  ['conversational', 'no_action'],
  ['classified', 'classified'],
  ['resolved', 'classified'],
  ['selected', 'classified'],
  ['plan_only', 'classified'],
  ['ambiguous', 'ambiguous'],
  ['needs_clarification', 'needs_clarification'],
  ['clarification', 'needs_clarification'],
  ['clarify', 'needs_clarification'],
  ['clarification_required', 'needs_clarification'],
  ['ask_clarification', 'needs_clarification'],
]);
const NORMALIZED_CLASSIFIED_REQUEST_TYPES = new Map([
  ['plan_request', 'plan_request'],
  ['plan', 'plan_request'],
  ['planning', 'plan_request'],
  ['execution_plan', 'plan_request'],
  ['preview_plan', 'plan_request'],
  ['plan_only', 'plan_request'],
]);
const NORMALIZED_TEMPORAL_FOCUS = new Map([
  ['past', 'past'],
  ['previous', 'past'],
  ['prior', 'past'],
  ['earlier', 'past'],
  ['recent', 'past'],
  ['recently', 'past'],
  ['before', 'past'],
  ['current', 'current'],
  ['present', 'current'],
  ['now', 'current'],
  ['today', 'current'],
  ['immediate', 'current'],
  ['inmediato', 'current'],
  ['ongoing', 'ongoing'],
  ['in_progress', 'ongoing'],
  ['active', 'ongoing'],
  ['future', 'future'],
  ['later', 'future'],
  ['next', 'future'],
  ['upcoming', 'future'],
  ['planned', 'future'],
  ['unspecified', 'unspecified'],
  ['unknown', 'unspecified'],
  ['none', 'unspecified'],
]);
const NORMALIZED_RISK_LEVEL = new Map([
  ['none', 'none'],
  ['low', 'low'],
  ['medium', 'medium'],
  ['moderate', 'medium'],
  ['high', 'high'],
  ['critical', 'critical'],
  ['severe', 'critical'],
  ['unknown', 'unknown'],
  ['unspecified', 'unknown'],
  ['not_applicable', 'none'],
  ['n/a', 'none'],
]);
const NORMALIZED_KNOWN_REFERENCE_SOURCES = new Map([
  ['explicit_input', 'explicit_input'],
  ['request', 'explicit_input'],
  ['input', 'explicit_input'],
  ['user_input', 'explicit_input'],
  ['user_message', 'explicit_input'],
  ['semantic_classifier', 'provider_inference'],
  ['semantic-intent-classifier', 'provider_inference'],
  ['conversation_context', 'conversation_context'],
  ['conversation', 'conversation_context'],
  ['recent_turn', 'conversation_context'],
  ['runtime_context', 'runtime_context'],
  ['request_metadata', 'runtime_context'],
  ['request.metadata.operationalidentityid', 'runtime_context'],
  ['runtime', 'runtime_context'],
  ['context', 'runtime_context'],
  ['memory_context', 'memory_context'],
  ['memory', 'memory_context'],
  ['provider_inference', 'provider_inference'],
  ['provider', 'provider_inference'],
  ['model_inference', 'provider_inference'],
  ['human_clarification', 'human_clarification'],
  ['human', 'human_clarification'],
  ['unknown', 'unknown'],
]);

const PLAN_PREVIEW_SIGNAL_PATTERNS = [
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
const NORMALIZED_KNOWN_REFERENCE_TYPES = new Map([
  ['tool', 'tool'],
  ['workflow', 'workflow'],
  ['invocation', 'invocation'],
  ['agent_invocation', 'invocation'],
  ['invocation_artifact', 'invocation'],
  ['runtime_invocation', 'invocation'],
  ['resource', 'resource'],
  ['memory', 'memory'],
  ['conversation', 'conversation'],
  ['conversation_turn', 'conversation'],
  ['recent_turn', 'conversation'],
  ['turn', 'conversation'],
  ['identity', 'cognitive_identity'],
  ['operational_identity', 'operational_identity'],
  ['cognitive_identity', 'cognitive_identity'],
  ['provider', 'provider'],
  ['policy', 'policy'],
  ['document', 'document'],
  ['artifact', 'document'],
  ['channel', 'channel'],
  ['unknown', 'unknown'],
]);

const DEFAULT_RETRY_POLICY = Object.freeze(createProviderRetryPolicy({
  maxAttempts: 1,
  allowFallbackProvider: false,
  appliesToRequestTypes: [
    PROVIDER_INTENT_CLASSIFIER_REQUEST_TYPE,
  ],
}));

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
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

function matchesAnyPattern(value, patterns) {
  if (!isNonEmptyString(value)) {
    return false;
  }

  return patterns.some((pattern) => pattern.test(value));
}

function requestLooksLikePlanPreview(requestOriginalInput) {
  return matchesAnyPattern(requestOriginalInput, PLAN_PREVIEW_SIGNAL_PATTERNS);
}

function normalizeNoActionRequestTypeValue(requestType) {
  if (!isNonEmptyString(requestType)) {
    return {
      normalizedRequestType: 'answer',
      repaired: true,
    };
  }

  const normalizedKey = requestType.trim().toLowerCase();
  const normalizedRequestType = NORMALIZED_NO_ACTION_REQUEST_TYPES.get(normalizedKey);

  if (!normalizedRequestType) {
    return {
      normalizedRequestType: requestType,
      repaired: false,
    };
  }

  return {
    normalizedRequestType,
    repaired: normalizedRequestType !== requestType,
  };
}

function normalizeClassifiedRequestTypeValue(requestType, {
  requestOriginalInput = null,
} = {}) {
  const shouldRepairToPlanRequest = requestLooksLikePlanPreview(requestOriginalInput);

  if (!isNonEmptyString(requestType)) {
    return {
      normalizedRequestType: shouldRepairToPlanRequest ? 'plan_request' : requestType,
      repaired: shouldRepairToPlanRequest,
    };
  }

  const normalizedKey = requestType.trim().toLowerCase();
  const normalizedRequestType = NORMALIZED_CLASSIFIED_REQUEST_TYPES.get(normalizedKey);

  if (!normalizedRequestType) {
    if (normalizedKey === 'action_candidate' && shouldRepairToPlanRequest) {
      return {
        normalizedRequestType: 'plan_request',
        repaired: true,
      };
    }

    return {
      normalizedRequestType: requestType.trim(),
      repaired: false,
    };
  }

  return {
    normalizedRequestType,
    repaired: normalizedRequestType !== requestType,
  };
}

function normalizeIntentStatusValue(status, parsedOutput) {
  if (isNonEmptyString(status)) {
    const normalizedStatusKey = status.trim().toLowerCase();
    const normalizedStatus = NORMALIZED_INTENT_STATUSES.get(normalizedStatusKey);

    if (normalizedStatus) {
      return {
        normalizedStatus,
        repaired: normalizedStatus !== status.trim(),
      };
    }

    return {
      normalizedStatus: status.trim(),
      repaired: false,
    };
  }

  const candidateCount = Array.isArray(parsedOutput?.candidates)
    ? parsedOutput.candidates.filter((candidate) => isPlainObject(candidate)).length
    : 0;
  const hasClarificationRequest = isPlainObject(parsedOutput?.clarificationRequest);

  if (hasClarificationRequest && candidateCount > 1 && !isNonEmptyString(parsedOutput?.selectedCandidateId)) {
    return {
      normalizedStatus: 'ambiguous',
      repaired: true,
    };
  }

  if (hasClarificationRequest) {
    return {
      normalizedStatus: 'needs_clarification',
      repaired: true,
    };
  }

  if (candidateCount > 0 || isNonEmptyString(parsedOutput?.selectedCandidateId)) {
    return {
      normalizedStatus: 'classified',
      repaired: true,
    };
  }

  return {
    normalizedStatus: 'no_action',
    repaired: true,
  };
}

function normalizeTemporalFocusValue(temporalFocus, {
  status = null,
} = {}) {
  if (!isNonEmptyString(temporalFocus)) {
    return {
      normalizedTemporalFocus: status === 'classified' || status === 'no_action'
        ? 'current'
        : 'unspecified',
      repaired: true,
    };
  }

  const trimmedTemporalFocus = temporalFocus.trim();
  const normalizedTemporalFocusKey = trimmedTemporalFocus.toLowerCase();
  const normalizedTemporalFocus = NORMALIZED_TEMPORAL_FOCUS.get(normalizedTemporalFocusKey);

  if (!normalizedTemporalFocus) {
    const normalizedTemporalFocusParts = uniqueStrings(
      trimmedTemporalFocus
        .split(/[\/|,;]+/u)
        .map((part) => NORMALIZED_TEMPORAL_FOCUS.get(part.trim().toLowerCase()))
        .filter(Boolean),
    );

    if (normalizedTemporalFocusParts.length > 0) {
      if (normalizedTemporalFocusParts.includes('current')) {
        return {
          normalizedTemporalFocus: 'current',
          repaired: true,
        };
      }

      if (normalizedTemporalFocusParts.includes('ongoing')) {
        return {
          normalizedTemporalFocus: 'ongoing',
          repaired: true,
        };
      }

      if (normalizedTemporalFocusParts.length === 1) {
        return {
          normalizedTemporalFocus: normalizedTemporalFocusParts[0],
          repaired: true,
        };
      }

      if (
        normalizedTemporalFocusParts.includes('past')
        && normalizedTemporalFocusParts.includes('future')
      ) {
        return {
          normalizedTemporalFocus: status === 'classified' || status === 'no_action'
            ? 'current'
            : 'unspecified',
          repaired: true,
        };
      }
    }

    return {
      normalizedTemporalFocus: trimmedTemporalFocus,
      repaired: false,
    };
  }

  return {
    normalizedTemporalFocus,
    repaired: normalizedTemporalFocus !== trimmedTemporalFocus,
  };
}

function deriveProviderRiskLevel(parsedOutput) {
  if (parsedOutput?.status === 'no_action') {
    return 'none';
  }

  const selectedCandidate = getSelectedCandidateFromParsedIntent(parsedOutput);
  const sideEffectLevel = isNonEmptyString(selectedCandidate?.sideEffectLevel)
    ? selectedCandidate.sideEffectLevel.trim()
    : null;

  if (selectedCandidate?.requiresApproval === true) {
    return 'high';
  }

  if (sideEffectLevel === 'read_only') {
    return 'low';
  }

  if ([
    'write_external',
    'publish_external',
    'financial',
    'destructive',
  ].includes(sideEffectLevel)) {
    return 'high';
  }

  if (parsedOutput?.status === 'ambiguous' || parsedOutput?.status === 'needs_clarification') {
    return 'medium';
  }

  return 'medium';
}

function normalizeRiskLevelValue(riskLevel, parsedOutput) {
  if (!isNonEmptyString(riskLevel)) {
    return {
      normalizedRiskLevel: deriveProviderRiskLevel(parsedOutput),
      repaired: true,
    };
  }

  const normalizedRiskLevelKey = riskLevel.trim().toLowerCase();
  const normalizedRiskLevel = NORMALIZED_RISK_LEVEL.get(normalizedRiskLevelKey);

  if (!normalizedRiskLevel) {
    return {
      normalizedRiskLevel: riskLevel.trim(),
      repaired: false,
    };
  }

  return {
    normalizedRiskLevel,
    repaired: normalizedRiskLevel !== riskLevel.trim(),
  };
}

function normalizeKnownReferenceSourceValue(source) {
  if (!isNonEmptyString(source)) {
    return {
      normalizedSource: 'provider_inference',
      repaired: true,
    };
  }

  const normalizedSourceKey = source.trim().toLowerCase();
  const normalizedSource = NORMALIZED_KNOWN_REFERENCE_SOURCES.get(normalizedSourceKey);

  if (!normalizedSource) {
    return {
      normalizedSource: source.trim(),
      repaired: false,
    };
  }

  return {
    normalizedSource,
    repaired: normalizedSource !== source.trim(),
  };
}

function normalizeKnownReferenceTypeValue(referenceType) {
  if (!isNonEmptyString(referenceType)) {
    return {
      normalizedReferenceType: 'unknown',
      repaired: true,
    };
  }

  const normalizedReferenceTypeKey = referenceType.trim().toLowerCase();
  const normalizedReferenceType = NORMALIZED_KNOWN_REFERENCE_TYPES.get(normalizedReferenceTypeKey);

  if (!normalizedReferenceType) {
    return {
      normalizedReferenceType: referenceType.trim(),
      repaired: false,
    };
  }

  return {
    normalizedReferenceType,
    repaired: normalizedReferenceType !== referenceType.trim(),
  };
}

function normalizeSafeIdentifier(value, fallbackValue) {
  const normalizedValue = isNonEmptyString(value)
    ? value.trim().replace(/[^a-zA-Z0-9._-]+/gu, '-').replace(/^-+|-+$/gu, '')
    : '';

  return normalizedValue.length > 0 ? normalizedValue : fallbackValue;
}

function createProviderBackedClassifierError({
  failureKind = 'classification_failure',
  message,
  providerId = null,
  modelId = null,
  requestType = PROVIDER_INTENT_CLASSIFIER_REQUEST_TYPE,
  providerResponseStatus = null,
  providerFailure = null,
  errorCode = null,
  cause = null,
} = {}) {
  const error = new Error(
    isNonEmptyString(message)
      ? message.trim()
      : 'Provider-backed intent classifier failed.',
  );

  error.name = 'ProviderBackedActionIntentClassifierError';
  error.failureKind = failureKind === 'provider_failure'
    ? 'provider_failure'
    : 'classification_failure';
  error.providerId = isNonEmptyString(providerId) ? providerId.trim() : null;
  error.modelId = isNonEmptyString(modelId) ? modelId.trim() : null;
  error.requestType = isNonEmptyString(requestType) ? requestType.trim() : PROVIDER_INTENT_CLASSIFIER_REQUEST_TYPE;
  error.providerResponseStatus = isNonEmptyString(providerResponseStatus)
    ? providerResponseStatus.trim()
    : null;
  error.providerFailure = providerFailure ?? null;
  error.errorCode = isNonEmptyString(errorCode) ? errorCode.trim() : null;

  if (cause) {
    error.cause = cause;
  }

  return error;
}

function isProviderBackedClassifierError(error) {
  return Boolean(
    error
    && typeof error === 'object'
    && error.name === 'ProviderBackedActionIntentClassifierError'
    && (error.failureKind === 'provider_failure' || error.failureKind === 'classification_failure')
  );
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

function assertBoundedString(value, description, maxLength) {
  if (value === undefined || value === null) {
    return null;
  }

  if (!isNonEmptyString(value)) {
    throw new Error(`${description} must be a non-empty string when provided.`);
  }

  const normalizedValue = value.trim();

  if (normalizedValue.length > maxLength) {
    return `${normalizedValue.slice(0, maxLength - 3)}...`;
  }

  return normalizedValue;
}

function assertClassifierRequest(classifierRequest) {
  if (!isPlainObject(classifierRequest)) {
    throw new Error('Provider-backed intent classifier requires classifierRequest to be an object.');
  }

  if (classifierRequest.kind !== 'semantic_intent_classification_request') {
    throw new Error('Provider-backed intent classifier requires kind "semantic_intent_classification_request".');
  }

  if (classifierRequest.version !== 1) {
    throw new Error('Provider-backed intent classifier request version must be 1.');
  }

  if (!isPlainObject(classifierRequest.request)) {
    throw new Error('Provider-backed intent classifier request.request must be an object.');
  }

  if (!isNonEmptyString(classifierRequest.request.originalInput)) {
    throw new Error('Provider-backed intent classifier request must include a non-empty originalInput.');
  }

  return {
    kind: 'semantic_intent_classification_request',
    version: 1,
    request: {
      ...classifierRequest.request,
      originalInput: classifierRequest.request.originalInput.trim(),
    },
    actionAffordances: assertActionAffordances(classifierRequest.actionAffordances ?? []),
    constraints: isPlainObject(classifierRequest.constraints)
      ? { ...classifierRequest.constraints }
      : {},
  };
}

function assertReadyPreparedProvider(preparedProvider) {
  const normalizedPreparedProvider = assertBrainProviderPreparation(
    preparedProvider,
    'Provider-backed intent classifier preparedProvider',
  );

  if (!normalizedPreparedProvider) {
    throw new Error('Provider-backed intent classifier preparedProvider must not be null.');
  }

  if (normalizedPreparedProvider.status !== 'ready') {
    throw new Error(`Provider-backed intent classifier provider is not ready: ${normalizedPreparedProvider.reason}`);
  }

  return normalizedPreparedProvider;
}

function normalizeRetryPolicy(retryPolicy = DEFAULT_RETRY_POLICY) {
  if (retryPolicy !== undefined && retryPolicy !== null && !isPlainObject(retryPolicy)) {
    throw new Error('Provider-backed intent classifier retryPolicy must be an object.');
  }

  const normalizedRetryPolicy = assertProviderRetryPolicy(
    retryPolicy === undefined || retryPolicy === null
      ? DEFAULT_RETRY_POLICY
      : createProviderRetryPolicy({
        ...DEFAULT_RETRY_POLICY,
        ...retryPolicy,
        backoffStrategy: retryPolicy.backoffStrategy ?? DEFAULT_RETRY_POLICY.backoffStrategy,
        retryableFailureCategories: retryPolicy.retryableFailureCategories ?? DEFAULT_RETRY_POLICY.retryableFailureCategories,
        appliesToRequestTypes: retryPolicy.appliesToRequestTypes ?? DEFAULT_RETRY_POLICY.appliesToRequestTypes,
      }),
    'Provider-backed intent classifier retryPolicy',
  );

  if (normalizedRetryPolicy.maxAttempts > MAX_CLASSIFIER_ATTEMPTS) {
    throw new Error(`Provider-backed intent classifier retryPolicy.maxAttempts must be ${MAX_CLASSIFIER_ATTEMPTS} or less.`);
  }

  return normalizedRetryPolicy;
}

function summarizeIntentMetadata(intentMetadata) {
  if (!isPlainObject(intentMetadata)) {
    return null;
  }

  return {
    primaryIntentId: intentMetadata.primaryIntentId ?? null,
    requestTypes: Array.isArray(intentMetadata.requestTypes)
      ? intentMetadata.requestTypes
      : [],
    semanticTags: Array.isArray(intentMetadata.semanticTags)
      ? intentMetadata.semanticTags
      : [],
    whenToUse: Array.isArray(intentMetadata.whenToUse)
      ? intentMetadata.whenToUse
      : [],
    whenNotToUse: Array.isArray(intentMetadata.whenNotToUse)
      ? intentMetadata.whenNotToUse
      : [],
    exampleRequests: Array.isArray(intentMetadata.exampleRequests)
      ? intentMetadata.exampleRequests
      : [],
    classificationGuidance: isPlainObject(intentMetadata.classificationGuidance)
      ? intentMetadata.classificationGuidance
      : null,
  };
}

function summarizeActionAffordance(affordance) {
  return {
    affordanceId: affordance.affordanceId,
    targetType: affordance.targetType,
    targetId: affordance.targetId,
    targetActionType: affordance.targetActionType,
    displayName: affordance.displayName,
    description: assertBoundedString(
      affordance.description,
      `Action affordance ${affordance.affordanceId} description`,
      500,
    ),
    owner: affordance.owner,
    lifecycleState: affordance.lifecycleState,
    sideEffectLevel: affordance.sideEffectLevel,
    executionMode: affordance.executionMode,
    readinessSummary: {
      status: affordance.readinessSummary.status,
      approvalRequired: affordance.readinessSummary.approvalRequired,
      reason: affordance.readinessSummary.reason,
      warnings: affordance.readinessSummary.warnings,
    },
    intentMetadata: summarizeIntentMetadata(affordance.intentMetadata),
    semanticTags: Array.isArray(affordance.metadata.semanticTags)
      ? affordance.metadata.semanticTags
      : [],
  };
}

function buildProviderClassifierSystemInstruction() {
  return [
    'You are an advisory action-intent classifier for the OpenMAS runtime.',
    'Return exactly one JSON object and no prose, no markdown, no code fences unless the whole response is a single JSON fence.',
    'The JSON object must be an action_intent object with kind "action_intent", version 1, and source "semantic_classifier".',
    'The understanding object is required and must include kind "action_request_understanding", version 2, originalInput, normalizedGoal, requestedOutcome, summary, requestType, temporalFocus, riskLevel, requiresAction, requiresClarification, requiredEvidence, knownReferences, missingContext, ambiguityMarkers, and warnings.',
    'The understanding object is descriptive only. It does not grant execution authority, approval, or permission.',
    'requiredEvidence must list what evidence is needed before the agent may claim success, for example runtime observations, tool observations, workflow observations, approval decisions, or memory evidence.',
    'knownReferences must capture explicit or safely inferred references from the request or bounded conversation context, such as tools, workflows, identities, providers, documents, or prior conversation targets.',
    'ambiguityMarkers must capture why the request is ambiguous or fragile when clarification is needed.',
    'Every action candidate must include kind "action_candidate", version 1, source "semantic_classifier", candidateId, actionType, targetType, targetId, sideEffectLevel, requiresApproval, reason, and matchedSignals.',
    'If clarificationRequest is present, it must include kind "action_clarification_request", version 1, clarificationId, reasonCategory, question, candidateIds, and blockingExecution.',
    'Clarification questions must be specific, actionable, and free of internal implementation noise such as classifier, confidence, runtime policy, or readiness jargon.',
    'When multiple candidates are plausible, ask a concrete either-or question that helps the user choose between them.',
    'When the request is vague but bounded conversation context contains one clear recent referent, you may use that referent to ask a safer follow-up clarification question.',
    'You must not execute tools, workflows, commands, memory writes, or external actions.',
    'You may only propose candidates that reference action affordances present in the request payload.',
    'Every candidate must preserve targetType, targetId, actionType, sideEffectLevel, and metadata.affordanceId from the selected affordance.',
    'Preserve metadata.readinessStatus from the selected affordance when available; runtime policy depends on that value.',
    'Every selected candidate must include metadata.affordanceMatchEvidence with affordanceId, targetType, targetId, matchedSignals, readinessStatus, and readinessReason.',
    'If useful, include metadata.rejectedAlternatives describing nearby affordances that were considered but rejected, with a concrete reason for each rejection.',
    'Use request.metadata.conversationContext only as bounded conversation evidence for resolving references like prior tools, workflows, or topics.',
    'Do not infer executable actions from vague follow-ups unless conversationContext contains one clear recent referent.',
    'If a selected action needs structured runtime input, put it in candidate.metadata.runtimeInput as a plain JSON object.',
    'Use status "classified" only when one action is clearly requested and safe to select.',
    'Use status "ambiguous" when multiple actions are plausible.',
    'Use status "needs_clarification" when confidence is low or required context is missing.',
    'Use status "no_action" when the user is only asking for an answer and no runtime action is needed.',
    'Use status "no_action" for greetings, conversational replies, explanations about capabilities, and other answer-only turns that do not require runtime execution.',
    'For no_action turns, use a governed conversational requestType such as "answer", "greeting", "conversation", "capability_question", "explanation_request", or "acknowledgment".',
    'When the user asks for a plan, preview, or explanation of what would happen before execution, use status "classified" with requestType "plan_request".',
    'For requestType "plan_request", still select exactly one known affordance candidate, but do not claim that execution already happened.',
    'candidateId, selectedCandidateId, and clarificationRequest.candidateIds must use safe identifiers with only letters, numbers, dot, underscore, or hyphen. Do not use ":" in candidateId values.',
    'For requestType \"plan_request\", keep the plan bounded to known affordances, known runtime evidence, and explicit request context. Do not invent tools, workflows, reports, filesystem paths, logs, or artifacts that are not present in the payload.',
    'Preserve request.originalInput exactly in understanding.originalInput.',
  ].join('\n');
}

function buildProviderClassifierPayload(classifierRequest) {
  return {
    kind: 'provider_intent_classification_payload',
    version: 1,
    request: classifierRequest.request,
    constraints: {
      ...classifierRequest.constraints,
      executionAllowed: false,
      classifierAuthority: 'advisory_only',
      outputMustBeStrictJson: true,
      candidatesMustReferenceKnownAffordances: true,
    },
    actionAffordances: classifierRequest.actionAffordances.map(summarizeActionAffordance),
    outputSchema: {
      kind: 'action_intent',
      version: 1,
      allowedStatuses: [
        'no_action',
        'classified',
        'ambiguous',
        'needs_clarification',
      ],
      requiredSource: 'semantic_classifier',
      requiredTopLevelFields: [
        'kind',
        'version',
        'status',
        'source',
        'understanding',
        'reason',
      ],
      understandingContract: {
        kind: 'action_request_understanding',
        version: 2,
        requiredFields: [
          'kind',
          'version',
          'originalInput',
          'normalizedGoal',
          'requestedOutcome',
          'summary',
          'requestType',
          'temporalFocus',
          'riskLevel',
          'requiresAction',
          'requiresClarification',
          'requiredEvidence',
          'knownReferences',
          'missingContext',
          'ambiguityMarkers',
          'warnings',
        ],
        allowedConversationalNoActionRequestTypes: [
          'answer',
          'greeting',
          'conversation',
          'capability_question',
          'explanation_request',
          'acknowledgment',
        ],
        allowedPlanningRequestTypes: [
          'plan_request',
        ],
        knownReferenceContract: {
          kind: 'action_known_reference',
          version: 1,
          requiredFields: [
            'kind',
            'version',
            'referenceType',
            'source',
            'confidence',
          ],
        },
      },
      candidateContract: {
        kind: 'action_candidate',
        version: 1,
        requiredSource: 'semantic_classifier',
        requiredFields: [
          'kind',
          'version',
          'candidateId',
          'actionType',
          'targetType',
          'targetId',
          'source',
          'confidence',
          'sideEffectLevel',
          'requiresApproval',
          'reason',
          'matchedSignals',
        ],
      },
      clarificationRequestContract: {
        kind: 'action_clarification_request',
        version: 1,
        requiredFields: [
          'kind',
          'version',
          'clarificationId',
          'reasonCategory',
          'question',
          'candidateIds',
          'blockingExecution',
        ],
      },
      requiredCandidateMetadata: [
        'affordanceId',
        'readinessStatus',
        'affordanceMatchEvidence',
      ],
      affordanceMatchEvidenceContract: {
        kind: 'action_affordance_match_evidence',
        version: 1,
        requiredFields: [
          'kind',
          'version',
          'affordanceId',
          'targetType',
          'targetId',
          'matchedSignals',
          'readinessStatus',
          'readinessReason',
        ],
      },
      rejectedAlternativeContract: {
        kind: 'action_affordance_rejection',
        version: 1,
        requiredFields: [
          'kind',
          'version',
          'affordanceId',
          'targetType',
          'targetId',
          'reason',
        ],
      },
    },
  };
}

function safeJsonStringify(value) {
  return JSON.stringify(value, null, 2);
}

function extractStrictJsonText(outputText) {
  if (!isNonEmptyString(outputText)) {
    throw new Error('Provider intent classifier output must be a non-empty string.');
  }

  const trimmedOutput = outputText.trim();
  const openingFenceMatch = trimmedOutput.match(/^```(?:[a-z0-9_-]+)?[^\S\r\n]*\r?\n?/iu);

  if (openingFenceMatch) {
    let fencedBody = trimmedOutput.slice(openingFenceMatch[0].length);
    fencedBody = fencedBody.replace(/\r?\n?```$/u, '').trim();
    return fencedBody;
  }

  return trimmedOutput;
}

function getSelectedCandidateFromParsedIntent(parsedOutput) {
  if (!Array.isArray(parsedOutput.candidates) || !isNonEmptyString(parsedOutput.selectedCandidateId)) {
    return null;
  }

  return parsedOutput.candidates.find((candidate) => {
    return isPlainObject(candidate) && candidate.candidateId === parsedOutput.selectedCandidateId;
  }) ?? null;
}

function deriveProviderIntentReason(parsedOutput) {
  const selectedCandidate = getSelectedCandidateFromParsedIntent(parsedOutput);
  const reasonCandidates = [
    parsedOutput.reason,
    parsedOutput.understanding?.summary,
    parsedOutput.understanding?.normalizedGoal,
    selectedCandidate?.reason,
    parsedOutput.clarificationRequest?.question,
  ];

  for (const reasonCandidate of reasonCandidates) {
    if (isNonEmptyString(reasonCandidate)) {
      return reasonCandidate.trim();
    }
  }

  if (parsedOutput.status === 'no_action') {
    return 'Provider classified the request as requiring no runtime action.';
  }

  if (parsedOutput.status === 'classified') {
    return 'Provider selected a runtime action candidate for the request.';
  }

  if (parsedOutput.status === 'ambiguous') {
    return 'Provider found multiple plausible runtime action candidates.';
  }

  if (parsedOutput.status === 'needs_clarification') {
    return 'Provider classified the request as needing clarification before runtime execution.';
  }

  return 'Provider returned an action intent for runtime evaluation.';
}

function deriveProviderCandidateReason(candidate) {
  if (isNonEmptyString(candidate.reason)) {
    return candidate.reason.trim();
  }

  if (isNonEmptyString(candidate.targetId)) {
    return `Provider selected action target ${candidate.targetId}.`;
  }

  return 'Provider proposed an action candidate for semantic classification.';
}

function deriveProviderRequestedOutcome(parsedOutput) {
  const selectedCandidate = getSelectedCandidateFromParsedIntent(parsedOutput);
  const requestedOutcomeCandidates = [
    parsedOutput.understanding?.requestedOutcome,
    parsedOutput.understanding?.normalizedGoal,
    parsedOutput.reason,
    selectedCandidate?.reason,
    parsedOutput.understanding?.summary,
  ];

  for (const requestedOutcomeCandidate of requestedOutcomeCandidates) {
    if (isNonEmptyString(requestedOutcomeCandidate)) {
      return requestedOutcomeCandidate.trim();
    }
  }

  if (parsedOutput.status === 'no_action') {
    return 'Provide an answer without runtime execution.';
  }

  if (parsedOutput.status === 'classified') {
    return 'Execute the selected runtime action and report grounded evidence.';
  }

  if (parsedOutput.status === 'ambiguous' || parsedOutput.status === 'needs_clarification') {
    return 'Clarify the intended runtime action before execution.';
  }

  return 'Understand the requested outcome before runtime execution.';
}

function deriveProviderRequiredEvidence(parsedOutput) {
  const selectedCandidate = getSelectedCandidateFromParsedIntent(parsedOutput);
  const requiredEvidence = Array.isArray(parsedOutput.understanding?.requiredEvidence)
    ? parsedOutput.understanding.requiredEvidence.filter((value) => isNonEmptyString(value))
    : [];

  if (requiredEvidence.length > 0) {
    return uniqueStrings(requiredEvidence.map((value) => value.trim()));
  }

  if (!selectedCandidate) {
    return [];
  }

  const derivedEvidence = [];

  if (selectedCandidate.targetType === 'tool') {
    derivedEvidence.push('tool_observation');
  } else if (selectedCandidate.targetType === 'workflow') {
    derivedEvidence.push('workflow_observation');
  } else {
    derivedEvidence.push('runtime_observation');
  }

  if (selectedCandidate.requiresApproval) {
    derivedEvidence.push('approval_decision');
  }

  return uniqueStrings(derivedEvidence);
}

function normalizeKnownReference(reference) {
  if (!isPlainObject(reference)) {
    return null;
  }

  const {
    normalizedSource,
    repaired: repairedSource,
  } = normalizeKnownReferenceSourceValue(reference.source);
  const {
    normalizedReferenceType,
    repaired: repairedReferenceType,
  } = normalizeKnownReferenceTypeValue(reference.referenceType);

  return {
    ...reference,
    kind: isNonEmptyString(reference.kind) ? reference.kind.trim() : 'action_known_reference',
    version: reference.version === undefined || reference.version === null ? 1 : reference.version,
    referenceType: normalizedReferenceType,
    referenceId: isNonEmptyString(reference.referenceId) ? reference.referenceId.trim() : null,
    label: isNonEmptyString(reference.label)
      ? reference.label.trim()
      : (isNonEmptyString(reference.referenceId) ? reference.referenceId.trim() : null),
    source: normalizedSource,
    confidence: isNonEmptyString(reference.confidence) ? reference.confidence.trim() : 'medium',
    metadata: {
      ...(isPlainObject(reference.metadata) ? { ...reference.metadata } : {}),
      ...(repairedSource || repairedReferenceType
        ? {
          _providerOutputRepairs: {
            source: repairedSource,
            referenceType: repairedReferenceType,
          },
        }
        : {}),
    },
  };
}

function normalizeActionAffordanceMatchEvidence(matchEvidence, {
  candidate,
  repairs,
  candidatePath,
}) {
  if (!isPlainObject(matchEvidence)) {
    return matchEvidence;
  }

  const normalizedMatchEvidence = {
    ...matchEvidence,
  };

  if (!isNonEmptyString(normalizedMatchEvidence.kind)) {
    normalizedMatchEvidence.kind = 'action_affordance_match_evidence';
    repairs.push(`${candidatePath}.metadata.affordanceMatchEvidence.kind`);
  }

  if (
    normalizedMatchEvidence.version === undefined
    || normalizedMatchEvidence.version === null
  ) {
    normalizedMatchEvidence.version = 1;
    repairs.push(`${candidatePath}.metadata.affordanceMatchEvidence.version`);
  }

  if (
    !isNonEmptyString(normalizedMatchEvidence.affordanceId)
    && isNonEmptyString(candidate.metadata?.affordanceId)
  ) {
    normalizedMatchEvidence.affordanceId = candidate.metadata.affordanceId.trim();
    repairs.push(`${candidatePath}.metadata.affordanceMatchEvidence.affordanceId`);
  }

  if (!isNonEmptyString(normalizedMatchEvidence.targetType) && isNonEmptyString(candidate.targetType)) {
    normalizedMatchEvidence.targetType = candidate.targetType.trim();
    repairs.push(`${candidatePath}.metadata.affordanceMatchEvidence.targetType`);
  }

  if (!isNonEmptyString(normalizedMatchEvidence.targetId) && isNonEmptyString(candidate.targetId)) {
    normalizedMatchEvidence.targetId = candidate.targetId.trim();
    repairs.push(`${candidatePath}.metadata.affordanceMatchEvidence.targetId`);
  }

  if (!Array.isArray(normalizedMatchEvidence.matchedSignals) || normalizedMatchEvidence.matchedSignals.length === 0) {
    normalizedMatchEvidence.matchedSignals = Array.isArray(candidate.matchedSignals)
      ? [
        ...candidate.matchedSignals,
      ]
      : [];
    repairs.push(`${candidatePath}.metadata.affordanceMatchEvidence.matchedSignals`);
  }

  if (
    !isNonEmptyString(normalizedMatchEvidence.readinessStatus)
    && isNonEmptyString(candidate.metadata?.readinessStatus)
  ) {
    normalizedMatchEvidence.readinessStatus = candidate.metadata.readinessStatus.trim();
    repairs.push(`${candidatePath}.metadata.affordanceMatchEvidence.readinessStatus`);
  }

  if (!isNonEmptyString(normalizedMatchEvidence.readinessReason) && isNonEmptyString(candidate.reason)) {
    normalizedMatchEvidence.readinessReason = candidate.reason.trim();
    repairs.push(`${candidatePath}.metadata.affordanceMatchEvidence.readinessReason`);
  }

  if (
    normalizedMatchEvidence.metadata !== undefined
    && normalizedMatchEvidence.metadata !== null
    && !isPlainObject(normalizedMatchEvidence.metadata)
  ) {
    normalizedMatchEvidence.metadata = {};
    repairs.push(`${candidatePath}.metadata.affordanceMatchEvidence.metadata`);
  }

  return normalizedMatchEvidence;
}

function normalizeActionAffordanceRejection(rejection, {
  repairs,
  candidatePath,
  rejectionIndex,
}) {
  if (!isPlainObject(rejection)) {
    return rejection;
  }

  const normalizedRejection = {
    ...rejection,
  };
  const rejectionPath = `${candidatePath}.metadata.rejectedAlternatives[${rejectionIndex}]`;

  if (!isNonEmptyString(normalizedRejection.kind)) {
    normalizedRejection.kind = 'action_affordance_rejection';
    repairs.push(`${rejectionPath}.kind`);
  }

  if (
    normalizedRejection.version === undefined
    || normalizedRejection.version === null
  ) {
    normalizedRejection.version = 1;
    repairs.push(`${rejectionPath}.version`);
  }

  if (!Array.isArray(normalizedRejection.matchedSignals)) {
    normalizedRejection.matchedSignals = [];
    repairs.push(`${rejectionPath}.matchedSignals`);
  }

  if (
    normalizedRejection.metadata !== undefined
    && normalizedRejection.metadata !== null
    && !isPlainObject(normalizedRejection.metadata)
  ) {
    normalizedRejection.metadata = {};
    repairs.push(`${rejectionPath}.metadata`);
  }

  return normalizedRejection;
}

function normalizeCandidateMetadata(candidate, {
  repairs,
  candidatePath,
}) {
  if (!isPlainObject(candidate.metadata)) {
    return candidate.metadata;
  }

  const normalizedMetadata = {
    ...candidate.metadata,
  };

  if (isPlainObject(normalizedMetadata.affordanceMatchEvidence)) {
    normalizedMetadata.affordanceMatchEvidence = normalizeActionAffordanceMatchEvidence(
      normalizedMetadata.affordanceMatchEvidence,
      {
        candidate,
        repairs,
        candidatePath,
      },
    );
  }

  if (Array.isArray(normalizedMetadata.rejectedAlternatives)) {
    normalizedMetadata.rejectedAlternatives = normalizedMetadata.rejectedAlternatives.map((rejection, rejectionIndex) => {
      return normalizeActionAffordanceRejection(rejection, {
        repairs,
        candidatePath,
        rejectionIndex,
      });
    });
  }

  return normalizedMetadata;
}

function deriveProviderKnownReferences(parsedOutput) {
  const selectedCandidate = getSelectedCandidateFromParsedIntent(parsedOutput);
  const knownReferences = Array.isArray(parsedOutput.understanding?.knownReferences)
    ? parsedOutput.understanding.knownReferences
      .map(normalizeKnownReference)
      .filter(Boolean)
    : [];

  if (knownReferences.length > 0) {
    return knownReferences;
  }

  if (!selectedCandidate) {
    return [];
  }

  return [
    {
      kind: 'action_known_reference',
      version: 1,
      referenceType: selectedCandidate.targetType ?? 'unknown',
      referenceId: selectedCandidate.targetId ?? null,
      label: selectedCandidate.targetId ?? null,
      source: 'provider_inference',
      confidence: selectedCandidate.confidence ?? 'medium',
      metadata: {
        affordanceId: selectedCandidate.metadata?.affordanceId ?? null,
      },
    },
  ];
}

function deriveProviderAmbiguityMarkers(parsedOutput) {
  const ambiguityMarkers = Array.isArray(parsedOutput.understanding?.ambiguityMarkers)
    ? parsedOutput.understanding.ambiguityMarkers.filter((value) => isNonEmptyString(value))
    : [];

  if (ambiguityMarkers.length > 0) {
    return uniqueStrings(ambiguityMarkers.map((value) => value.trim()));
  }

  if (parsedOutput.status === 'ambiguous') {
    return [
      'multiple_candidates',
    ];
  }

  if (parsedOutput.status === 'needs_clarification') {
    if (Array.isArray(parsedOutput.understanding?.missingContext) && parsedOutput.understanding.missingContext.length > 0) {
      return [
        'missing_context',
      ];
    }

    return [
      'clarification_required',
    ];
  }

  return [];
}

function attachProviderOutputRepairs(parsedOutput, repairs) {
  if (repairs.length === 0) {
    return parsedOutput;
  }

  if (
    parsedOutput.metadata !== undefined
    && parsedOutput.metadata !== null
    && !isPlainObject(parsedOutput.metadata)
  ) {
    return parsedOutput;
  }

  const existingRepairs = Array.isArray(parsedOutput.metadata?.providerOutputRepairs)
    ? parsedOutput.metadata.providerOutputRepairs
    : [];

  return {
    ...parsedOutput,
    metadata: {
      ...(isPlainObject(parsedOutput.metadata) ? parsedOutput.metadata : {}),
      providerOutputRepairs: uniqueStrings([
        ...existingRepairs,
        ...repairs,
      ]),
    },
  };
}

function deriveIntentTypeFromCandidate(selectedCandidate, {
  requestType = null,
} = {}) {
  if (requestType === 'plan_request') {
    return 'plan_preview';
  }

  if (selectedCandidate?.actionType === 'tool_execution' || selectedCandidate?.targetType === 'tool') {
    return 'tool_action';
  }

  if (selectedCandidate?.actionType === 'workflow_execution' || selectedCandidate?.targetType === 'workflow') {
    return 'workflow_action';
  }

  return 'classified_action';
}

function deriveIntentIdFromCandidate(selectedCandidate, {
  requestType = null,
  intentType = null,
} = {}) {
  const normalizedTargetType = isNonEmptyString(selectedCandidate?.targetType)
    ? selectedCandidate.targetType.trim()
    : 'action';
  const normalizedTargetId = isNonEmptyString(selectedCandidate?.targetId)
    ? selectedCandidate.targetId.trim()
    : 'unknown';
  const identifierPrefix = requestType === 'plan_request'
    ? `runtime.plan_preview.${normalizedTargetType}.${normalizedTargetId}`
    : `runtime.${intentType ?? 'classified_action'}.${normalizedTargetType}.${normalizedTargetId}`;

  return normalizeSafeIdentifier(
    identifierPrefix,
    `runtime.${intentType ?? 'classified_action'}.${normalizedTargetType}.unknown`,
  );
}

function normalizeProviderActionIntentOutput(parsedOutput, {
  requestOriginalInput = null,
} = {}) {
  const repairs = [];
  const candidateIdMap = new Map();
  const candidateArrayValue = Array.isArray(parsedOutput.candidates)
    ? parsedOutput.candidates
    : isPlainObject(parsedOutput.candidates)
      ? [parsedOutput.candidates]
      : parsedOutput.candidates;
  const normalizedOutput = {
    ...parsedOutput,
    kind: parsedOutput.kind,
    version: parsedOutput.version,
    source: parsedOutput.source,
    understanding: isPlainObject(parsedOutput.understanding)
      ? { ...parsedOutput.understanding }
      : parsedOutput.understanding,
    candidates: Array.isArray(candidateArrayValue)
      ? candidateArrayValue.map((candidate, index) => {
        if (!isPlainObject(candidate)) {
          return candidate;
        }

        const normalizedCandidate = { ...candidate };
        const candidatePath = `candidates[${index}]`;

        if (!isNonEmptyString(normalizedCandidate.kind)) {
          normalizedCandidate.kind = 'action_candidate';
          repairs.push(`${candidatePath}.kind`);
        }

        if (normalizedCandidate.version === undefined || normalizedCandidate.version === null) {
          normalizedCandidate.version = 1;
          repairs.push(`${candidatePath}.version`);
        }

        const originalCandidateId = isNonEmptyString(normalizedCandidate.candidateId)
          ? normalizedCandidate.candidateId.trim()
          : null;
        const repairedCandidateId = normalizeSafeIdentifier(
          normalizedCandidate.candidateId,
          normalizeSafeIdentifier(
            normalizedCandidate.metadata?.affordanceId,
            normalizeSafeIdentifier(
              `${normalizedCandidate.targetType ?? 'candidate'}-${normalizedCandidate.targetId ?? index + 1}`,
              `candidate-${index + 1}`,
            ),
          ),
        );

        if (normalizedCandidate.candidateId !== repairedCandidateId) {
          normalizedCandidate.candidateId = repairedCandidateId;
          repairs.push(`${candidatePath}.candidateId`);
        }

        if (originalCandidateId) {
          candidateIdMap.set(originalCandidateId, repairedCandidateId);
        }

        if (!isNonEmptyString(normalizedCandidate.source)) {
          normalizedCandidate.source = 'semantic_classifier';
          repairs.push(`${candidatePath}.source`);
        }

        if (!isNonEmptyString(normalizedCandidate.reason)) {
          repairs.push(`${candidatePath}.reason`);
          normalizedCandidate.reason = deriveProviderCandidateReason(normalizedCandidate);
        }

        if (isPlainObject(normalizedCandidate.metadata)) {
          normalizedCandidate.metadata = normalizeCandidateMetadata(normalizedCandidate, {
            repairs,
            candidatePath,
          });
        }

        return normalizedCandidate;
      })
      : candidateArrayValue,
    clarificationRequest: isPlainObject(parsedOutput.clarificationRequest)
      ? { ...parsedOutput.clarificationRequest }
      : parsedOutput.clarificationRequest,
    metadata: isPlainObject(parsedOutput.metadata)
      ? { ...parsedOutput.metadata }
      : parsedOutput.metadata,
  };

  if (!isNonEmptyString(normalizedOutput.kind)) {
    normalizedOutput.kind = 'action_intent';
    repairs.push('kind');
  }

  if (normalizedOutput.version === undefined || normalizedOutput.version === null) {
    normalizedOutput.version = 1;
    repairs.push('version');
  }

  if (!isNonEmptyString(normalizedOutput.source)) {
    normalizedOutput.source = 'semantic_classifier';
    repairs.push('source');
  }

  if (!Array.isArray(parsedOutput.candidates) && Array.isArray(normalizedOutput.candidates)) {
    repairs.push('candidates');
  }

  {
    const {
      normalizedStatus,
      repaired,
    } = normalizeIntentStatusValue(normalizedOutput.status, normalizedOutput);

    if (repaired || normalizedOutput.status !== normalizedStatus) {
      normalizedOutput.status = normalizedStatus;
      repairs.push('status');
    }
  }

  if (isPlainObject(normalizedOutput.understanding)) {
    if (!isNonEmptyString(normalizedOutput.understanding.kind)) {
      normalizedOutput.understanding.kind = 'action_request_understanding';
      repairs.push('understanding.kind');
    }

    if (
      normalizedOutput.understanding.version === undefined
      || normalizedOutput.understanding.version === null
    ) {
      normalizedOutput.understanding.version = 2;
      repairs.push('understanding.version');
    }

    if (
      !isNonEmptyString(normalizedOutput.understanding.originalInput)
      && isNonEmptyString(requestOriginalInput)
    ) {
      normalizedOutput.understanding.originalInput = requestOriginalInput.trim();
      repairs.push('understanding.originalInput');
    }

    if (normalizedOutput.status === 'no_action') {
      const {
        normalizedRequestType,
        repaired,
      } = normalizeNoActionRequestTypeValue(normalizedOutput.understanding.requestType);

      if (repaired || normalizedOutput.understanding.requestType !== normalizedRequestType) {
        normalizedOutput.understanding.requestType = normalizedRequestType;
        repairs.push('understanding.requestType');
      }
    } else {
      const {
        normalizedRequestType,
        repaired,
      } = normalizeClassifiedRequestTypeValue(normalizedOutput.understanding.requestType, {
        requestOriginalInput: requestOriginalInput ?? normalizedOutput.understanding.originalInput,
      });

      if (repaired || normalizedOutput.understanding.requestType !== normalizedRequestType) {
        normalizedOutput.understanding.requestType = normalizedRequestType;
        repairs.push('understanding.requestType');
      }
    }

    {
      const {
        normalizedTemporalFocus,
        repaired,
      } = normalizeTemporalFocusValue(normalizedOutput.understanding.temporalFocus, {
        status: normalizedOutput.status,
      });

      if (repaired || normalizedOutput.understanding.temporalFocus !== normalizedTemporalFocus) {
        normalizedOutput.understanding.temporalFocus = normalizedTemporalFocus;
        repairs.push('understanding.temporalFocus');
      }
    }

    {
      const {
        normalizedRiskLevel,
        repaired,
      } = normalizeRiskLevelValue(normalizedOutput.understanding.riskLevel, normalizedOutput);

      if (repaired || normalizedOutput.understanding.riskLevel !== normalizedRiskLevel) {
        normalizedOutput.understanding.riskLevel = normalizedRiskLevel;
        repairs.push('understanding.riskLevel');
      }
    }
  }

  if (!isNonEmptyString(normalizedOutput.reason)) {
    normalizedOutput.reason = deriveProviderIntentReason(normalizedOutput);
    repairs.push('reason');
  }

  if (isPlainObject(normalizedOutput.understanding) && !isNonEmptyString(normalizedOutput.understanding.summary)) {
    normalizedOutput.understanding.summary = normalizedOutput.reason;
    repairs.push('understanding.summary');
  }

  if (isPlainObject(normalizedOutput.understanding)) {
    if (!isNonEmptyString(normalizedOutput.understanding.requestedOutcome)) {
      normalizedOutput.understanding.requestedOutcome = deriveProviderRequestedOutcome(normalizedOutput);
      repairs.push('understanding.requestedOutcome');
    }

    if (!Array.isArray(normalizedOutput.understanding.requiredEvidence)) {
      normalizedOutput.understanding.requiredEvidence = deriveProviderRequiredEvidence(normalizedOutput);
      repairs.push('understanding.requiredEvidence');
    }

    if (!Array.isArray(normalizedOutput.understanding.knownReferences)) {
      normalizedOutput.understanding.knownReferences = deriveProviderKnownReferences(normalizedOutput);
      repairs.push('understanding.knownReferences');
    } else {
      const normalizedKnownReferences = deriveProviderKnownReferences(normalizedOutput);

      if (JSON.stringify(normalizedKnownReferences) !== JSON.stringify(normalizedOutput.understanding.knownReferences)) {
        normalizedOutput.understanding.knownReferences = normalizedKnownReferences;
        repairs.push('understanding.knownReferences');
      }
    }

    if (!Array.isArray(normalizedOutput.understanding.ambiguityMarkers)) {
      normalizedOutput.understanding.ambiguityMarkers = deriveProviderAmbiguityMarkers(normalizedOutput);
      repairs.push('understanding.ambiguityMarkers');
    }
  }

  if (
    normalizedOutput.status === 'classified'
    && !isNonEmptyString(normalizedOutput.selectedCandidateId)
    && Array.isArray(normalizedOutput.candidates)
    && normalizedOutput.candidates.length === 1
    && isNonEmptyString(normalizedOutput.candidates[0]?.candidateId)
  ) {
    normalizedOutput.selectedCandidateId = normalizedOutput.candidates[0].candidateId.trim();
    repairs.push('selectedCandidateId');
  }

  const selectedCandidate = getSelectedCandidateFromParsedIntent(normalizedOutput);

  if (normalizedOutput.status === 'no_action') {
    if (normalizedOutput.intentId !== null) {
      normalizedOutput.intentId = null;
      repairs.push('intentId');
    }

    if (normalizedOutput.intentType !== null) {
      normalizedOutput.intentType = null;
      repairs.push('intentType');
    }

    if (normalizedOutput.confidence !== null) {
      normalizedOutput.confidence = null;
      repairs.push('confidence');
    }

    if (normalizedOutput.confidenceScore !== null) {
      normalizedOutput.confidenceScore = null;
      repairs.push('confidenceScore');
    }

    if (normalizedOutput.selectedCandidateId !== null) {
      normalizedOutput.selectedCandidateId = null;
      repairs.push('selectedCandidateId');
    }

    if (!Array.isArray(normalizedOutput.candidates)) {
      normalizedOutput.candidates = [];
      repairs.push('candidates');
    } else if (normalizedOutput.candidates.length > 0) {
      normalizedOutput.candidates = [];
      repairs.push('candidates');
    }

    if (normalizedOutput.clarificationRequest !== null) {
      normalizedOutput.clarificationRequest = null;
      repairs.push('clarificationRequest');
    }
  }

  if (normalizedOutput.status === 'classified' && isPlainObject(normalizedOutput.understanding)) {
    if (normalizedOutput.understanding.requiresAction !== true) {
      normalizedOutput.understanding.requiresAction = true;
      repairs.push('understanding.requiresAction');
    }

    if (normalizedOutput.understanding.requiresClarification !== false) {
      normalizedOutput.understanding.requiresClarification = false;
      repairs.push('understanding.requiresClarification');
    }

    const derivedIntentType = isNonEmptyString(normalizedOutput.intentType)
      ? normalizedOutput.intentType.trim()
      : deriveIntentTypeFromCandidate(selectedCandidate, {
        requestType: normalizedOutput.understanding.requestType,
      });

    const shouldRewritePlanPreviewIntent =
      normalizedOutput.understanding.requestType === 'plan_request';
    const normalizedDerivedIntentType = shouldRewritePlanPreviewIntent
      ? deriveIntentTypeFromCandidate(selectedCandidate, {
        requestType: normalizedOutput.understanding.requestType,
      })
      : derivedIntentType;

    if (
      !isNonEmptyString(normalizedOutput.intentType)
      || (
        shouldRewritePlanPreviewIntent
        && normalizedOutput.intentType.trim() !== normalizedDerivedIntentType
      )
    ) {
      normalizedOutput.intentType = normalizedDerivedIntentType;
      repairs.push('intentType');
    }

    const derivedIntentId = deriveIntentIdFromCandidate(selectedCandidate, {
      requestType: normalizedOutput.understanding.requestType,
      intentType: normalizedDerivedIntentType,
    });

    if (
      !isNonEmptyString(normalizedOutput.intentId)
      || (
        shouldRewritePlanPreviewIntent
        && normalizedOutput.intentId.trim() !== derivedIntentId
      )
    ) {
      normalizedOutput.intentId = deriveIntentIdFromCandidate(selectedCandidate, {
        requestType: normalizedOutput.understanding.requestType,
        intentType: normalizedDerivedIntentType,
      });
      repairs.push('intentId');
    }

    if (!isNonEmptyString(normalizedOutput.confidence)) {
      normalizedOutput.confidence = isNonEmptyString(selectedCandidate?.confidence)
        ? selectedCandidate.confidence.trim()
        : 'medium';
      repairs.push('confidence');
    }

    if (
      normalizedOutput.confidenceScore === undefined
      || normalizedOutput.confidenceScore === null
    ) {
      normalizedOutput.confidenceScore = selectedCandidate?.confidenceScore ?? null;
      repairs.push('confidenceScore');
    }
  }

  if (
    (normalizedOutput.status === 'needs_clarification' || normalizedOutput.status === 'ambiguous')
    && isPlainObject(normalizedOutput.understanding)
  ) {
    if (normalizedOutput.understanding.requiresClarification !== true) {
      normalizedOutput.understanding.requiresClarification = true;
      repairs.push('understanding.requiresClarification');
    }

    if (normalizedOutput.selectedCandidateId !== null) {
      normalizedOutput.selectedCandidateId = null;
      repairs.push('selectedCandidateId');
    }

    if (!Array.isArray(normalizedOutput.candidates)) {
      normalizedOutput.candidates = [];
      repairs.push('candidates');
    }
  }

  if (isPlainObject(normalizedOutput.clarificationRequest)) {
    if (!isNonEmptyString(normalizedOutput.clarificationRequest.kind)) {
      normalizedOutput.clarificationRequest.kind = 'action_clarification_request';
      repairs.push('clarificationRequest.kind');
    }

    if (
      normalizedOutput.clarificationRequest.version === undefined
      || normalizedOutput.clarificationRequest.version === null
    ) {
      normalizedOutput.clarificationRequest.version = 1;
      repairs.push('clarificationRequest.version');
    }

    {
      const normalizedReasonCategory = normalizeClarificationReasonCategoryValue(
        normalizedOutput.clarificationRequest.reasonCategory,
      );

      if (normalizedOutput.clarificationRequest.reasonCategory !== normalizedReasonCategory) {
        normalizedOutput.clarificationRequest.reasonCategory = normalizedReasonCategory;
        repairs.push('clarificationRequest.reasonCategory');
      }
    }

    if (Array.isArray(normalizedOutput.clarificationRequest.candidateIds)) {
      normalizedOutput.clarificationRequest.candidateIds = normalizedOutput.clarificationRequest.candidateIds.map((candidateId, index) => {
        const originalCandidateId = isNonEmptyString(candidateId) ? candidateId.trim() : '';
        const repairedCandidateId = candidateIdMap.get(originalCandidateId)
          ?? normalizeSafeIdentifier(candidateId, `candidate-${index + 1}`);

        if (candidateId !== repairedCandidateId) {
          repairs.push(`clarificationRequest.candidateIds[${index}]`);
        }

        return repairedCandidateId;
      });
    }
  }

  if (isNonEmptyString(normalizedOutput.selectedCandidateId)) {
    const repairedSelectedCandidateId = candidateIdMap.get(normalizedOutput.selectedCandidateId.trim())
      ?? normalizeSafeIdentifier(normalizedOutput.selectedCandidateId, 'selected-candidate-001');

    if (normalizedOutput.selectedCandidateId !== repairedSelectedCandidateId) {
      normalizedOutput.selectedCandidateId = repairedSelectedCandidateId;
      repairs.push('selectedCandidateId');
    }
  }

  return attachProviderOutputRepairs(normalizedOutput, repairs);
}

function summarizeProviderRequest(providerRequest) {
  if (!providerRequest) {
    return null;
  }

  return {
    providerId: providerRequest.providerId,
    modelId: providerRequest.modelId,
    requestType: providerRequest.requestType,
    messageCount: providerRequest.messages.length,
    temperature: providerRequest.temperature,
    maxOutputTokens: providerRequest.maxOutputTokens,
  };
}

function summarizeProviderResponse(providerResponse) {
  if (!providerResponse) {
    return null;
  }

  return {
    providerId: providerResponse.providerId,
    modelId: providerResponse.modelId,
    requestType: providerResponse.requestType,
    status: providerResponse.status,
    finishReason: providerResponse.finishReason,
    providerResponseId: providerResponse.providerResponseId,
    usage: providerResponse.usage,
    warnings: providerResponse.warnings,
    errorCode: providerResponse.errorCode,
    errorMessage: providerResponse.errorMessage,
    providerFailure: providerResponse.providerFailure
      ? {
        category: providerResponse.providerFailure.category,
        retryable: providerResponse.providerFailure.retryable,
        httpStatusCode: providerResponse.providerFailure.httpStatusCode,
        providerErrorStatus: providerResponse.providerFailure.providerErrorStatus,
        diagnosticSummary: providerResponse.providerFailure.diagnosticSummary,
      }
      : null,
  };
}

function cloneAttempts(attempts) {
  return attempts.map((attempt) => {
    return {
      attemptNumber: attempt.attemptNumber,
      status: attempt.status,
      providerResponseStatus: attempt.providerResponseStatus,
      failureCategory: attempt.failureCategory ?? null,
      retryDecision: attempt.retryDecision ?? null,
      errorMessage: attempt.errorMessage,
    };
  });
}

function buildProviderIntentClassifierAuditRecord({
  classifierId,
  retryPolicy,
  providerRequest,
  providerResponse,
  attempts,
  classificationResult,
  errorMessage = null,
}) {
  const actionIntent = classificationResult?.actionIntent ?? null;
  const failureKind = classificationResult?.failureKind ?? null;
  const candidateCount = Array.isArray(actionIntent?.candidates)
    ? actionIntent.candidates.length
    : 0;
  const classificationWarnings = Array.isArray(classificationResult?.warnings)
    ? classificationResult.warnings
    : [];
  const warnings = [
    ...classificationWarnings,
    ...(errorMessage && failureKind === 'provider_failure' && classificationWarnings.length === 0
      ? [`Provider-backed intent classifier provider failed safely: ${errorMessage}`]
      : []),
    ...(errorMessage && failureKind === 'classification_failure' && classificationWarnings.length === 0
      ? [`Provider-backed intent classifier output failed safely: ${errorMessage}`]
      : []),
  ];

  return {
    kind: 'provider_intent_classifier_audit_record',
    version: 1,
    classifierId,
    status: classificationResult?.status === 'completed' ? 'completed' : 'failed',
    requestType: PROVIDER_INTENT_CLASSIFIER_REQUEST_TYPE,
    retryPolicy,
    providerRequest: summarizeProviderRequest(providerRequest),
    providerResponse: summarizeProviderResponse(providerResponse),
    attempts: cloneAttempts(attempts),
    actionIntentStatus: actionIntent?.status ?? null,
    failureKind,
    providerFailureCategory: providerResponse?.providerFailure?.category
      ?? classificationResult?.providerFailureCategory
      ?? null,
    selectedCandidateId: actionIntent?.selectedCandidateId ?? null,
    candidateCount,
    fallbackModeUsed: classificationResult?.status === 'completed' ? null : CLASSIFIER_FAILURE_FALLBACK_MODE,
    warnings: uniqueStrings(warnings),
  };
}

export function buildProviderIntentClassificationRequest({
  classifierRequest,
  preparedProvider,
  temperature = 0,
  maxOutputTokens = 1600,
}) {
  const normalizedClassifierRequest = assertClassifierRequest(classifierRequest);
  const normalizedPreparedProvider = assertReadyPreparedProvider(preparedProvider);
  const providerClassifierPayload = buildProviderClassifierPayload(normalizedClassifierRequest);

  return assertProviderRequest({
    providerId: normalizedPreparedProvider.providerId,
    modelId: normalizedPreparedProvider.modelId,
    requestType: PROVIDER_INTENT_CLASSIFIER_REQUEST_TYPE,
    messages: [
      {
        role: 'system',
        content: buildProviderClassifierSystemInstruction(),
      },
      {
        role: 'user',
        content: safeJsonStringify(providerClassifierPayload),
      },
    ],
    temperature,
    maxOutputTokens,
  });
}

export function parseProviderIntentClassificationOutput({
  outputText,
  requestOriginalInput = null,
}) {
  const jsonText = extractStrictJsonText(outputText);
  let parsedOutput;

  try {
    parsedOutput = JSON.parse(jsonText);
  } catch (error) {
    throw new Error(`Provider intent classifier output was not strict JSON: ${error.message}`);
  }

  if (!isPlainObject(parsedOutput)) {
    throw new Error('Provider intent classifier output must be one JSON object.');
  }

  return assertActionIntent(normalizeProviderActionIntentOutput(parsedOutput, {
    requestOriginalInput,
  }));
}

export function createProviderBackedActionIntentClassifierRuntime({
  preparedProvider,
  secretResolution,
  fetchImplementation = null,
  executeProviderRequestImplementation = executeProviderRequest,
  retryPolicy = DEFAULT_RETRY_POLICY,
  temperature = 0,
  maxOutputTokens = 1600,
} = {}) {
  const normalizedPreparedProvider = assertReadyPreparedProvider(preparedProvider);
  const normalizedExecuteProviderRequest = assertOptionalFunction(
    executeProviderRequestImplementation,
    'Provider-backed intent classifier executeProviderRequestImplementation',
  ) ?? executeProviderRequest;
  const normalizedRetryPolicy = normalizeRetryPolicy(retryPolicy);
  const normalizedFetchImplementation = assertOptionalFunction(
    fetchImplementation,
    'Provider-backed intent classifier fetchImplementation',
  );
  const telemetry = {
    providerRequest: null,
    providerResponse: null,
    attempts: [],
    errorMessage: null,
  };

  async function classifierAdapter(classifierRequest) {
    let lastError = null;
    const startedAtMs = Date.now();

    for (let attemptNumber = 1; attemptNumber <= normalizedRetryPolicy.maxAttempts; attemptNumber += 1) {
      try {
        const providerRequest = buildProviderIntentClassificationRequest({
          classifierRequest,
          preparedProvider: normalizedPreparedProvider,
          temperature,
          maxOutputTokens,
        });

        telemetry.providerRequest = providerRequest;

        let providerResponse;

        try {
          providerResponse = assertProviderResponse(await normalizedExecuteProviderRequest({
            preparedProvider: normalizedPreparedProvider,
            providerRequest,
            secretResolution,
            fetchImplementation: normalizedFetchImplementation,
          }));
        } catch (error) {
          providerResponse = createProviderExecutionFailureResponse({
            preparedProvider: normalizedPreparedProvider,
            providerRequest,
            error,
          });
        }

        telemetry.providerResponse = providerResponse;

        if (providerResponse.status !== 'completed') {
          const retryDecision = resolveProviderRetryDecision({
            retryPolicy: normalizedRetryPolicy,
            requestType: providerRequest.requestType,
            providerFailure: providerResponse.providerFailure,
            attemptNumber,
            elapsedMs: Math.max(0, Date.now() - startedAtMs),
          });

          telemetry.attempts.push({
            attemptNumber,
            status: 'failed',
            providerResponseStatus: providerResponse.status,
            failureCategory: providerResponse.providerFailure?.category ?? null,
            retryDecision,
            errorMessage: providerResponse.errorMessage ?? 'Provider intent classifier request failed.',
          });

          if (retryDecision.shouldRetry) {
            lastError = createProviderBackedClassifierError({
              failureKind: 'provider_failure',
              message: providerResponse.errorMessage ?? 'Provider intent classifier request failed.',
              providerId: providerResponse.providerId ?? normalizedPreparedProvider.providerId,
              modelId: providerResponse.modelId ?? normalizedPreparedProvider.modelId,
              requestType: providerRequest.requestType,
              providerResponseStatus: providerResponse.status,
              providerFailure: providerResponse.providerFailure ?? null,
              errorCode: providerResponse.errorCode ?? null,
            });
            telemetry.errorMessage = lastError.message;
            continue;
          }

          lastError = createProviderBackedClassifierError({
            failureKind: 'provider_failure',
            message: providerResponse.errorMessage ?? 'Provider intent classifier request failed.',
            providerId: providerResponse.providerId ?? normalizedPreparedProvider.providerId,
            modelId: providerResponse.modelId ?? normalizedPreparedProvider.modelId,
            requestType: providerRequest.requestType,
            providerResponseStatus: providerResponse.status,
            providerFailure: providerResponse.providerFailure ?? null,
            errorCode: providerResponse.errorCode ?? null,
          });
          telemetry.errorMessage = lastError.message;
          break;
        }

        const actionIntent = parseProviderIntentClassificationOutput({
          outputText: providerResponse.outputText,
          requestOriginalInput: classifierRequest.request.originalInput,
        });

        telemetry.attempts.push({
          attemptNumber,
          status: 'completed',
          providerResponseStatus: providerResponse.status,
          failureCategory: null,
          retryDecision: null,
          errorMessage: null,
        });

        return actionIntent;
      } catch (error) {
        lastError = isProviderBackedClassifierError(error)
          ? error
          : createProviderBackedClassifierError({
            failureKind: telemetry.providerResponse?.status === 'completed'
              ? 'classification_failure'
              : 'provider_failure',
            message: error.message,
            providerId: telemetry.providerResponse?.providerId ?? normalizedPreparedProvider.providerId,
            modelId: telemetry.providerResponse?.modelId ?? normalizedPreparedProvider.modelId,
            requestType: telemetry.providerRequest?.requestType ?? PROVIDER_INTENT_CLASSIFIER_REQUEST_TYPE,
            providerResponseStatus: telemetry.providerResponse?.status ?? null,
            providerFailure: telemetry.providerResponse?.providerFailure ?? null,
            errorCode: telemetry.providerResponse?.errorCode ?? null,
            cause: error,
          });
        telemetry.errorMessage = error.message;
        telemetry.attempts.push({
          attemptNumber,
          status: 'failed',
          providerResponseStatus: telemetry.providerResponse?.status ?? null,
          failureCategory: telemetry.providerResponse?.providerFailure?.category ?? null,
          retryDecision: null,
          errorMessage: error.message,
        });
      }
    }

    throw lastError;
  }

  function getTelemetry() {
    return {
      providerRequest: telemetry.providerRequest,
      providerResponse: telemetry.providerResponse,
      attempts: cloneAttempts(telemetry.attempts),
      errorMessage: telemetry.errorMessage,
      retryPolicy: normalizedRetryPolicy,
    };
  }

  return {
    classifierAdapter,
    getTelemetry,
  };
}

export async function classifyActionIntentWithProvider({
  request,
  actionAffordances,
  preparedProvider,
  secretResolution,
  fetchImplementation = null,
  executeProviderRequestImplementation = executeProviderRequest,
  retryPolicy = DEFAULT_RETRY_POLICY,
  temperature = 0,
  maxOutputTokens = 1600,
  classifierId = 'provider-backed-semantic-classifier',
} = {}) {
  const providerClassifierRuntime = createProviderBackedActionIntentClassifierRuntime({
    preparedProvider,
    secretResolution,
    fetchImplementation,
    executeProviderRequestImplementation,
    retryPolicy,
    temperature,
    maxOutputTokens,
  });

  const classificationResult = await classifyActionIntentForInvocation({
    request,
    actionAffordances,
    classifierAdapter: providerClassifierRuntime.classifierAdapter,
    classifierId,
  });
  const telemetry = providerClassifierRuntime.getTelemetry();
  const providerClassifierAudit = buildProviderIntentClassifierAuditRecord({
    classifierId,
    retryPolicy: telemetry.retryPolicy,
    providerRequest: telemetry.providerRequest,
    providerResponse: telemetry.providerResponse,
    attempts: telemetry.attempts,
    classificationResult,
    errorMessage: telemetry.errorMessage,
  });

  return {
    ...classificationResult,
    providerClassifierAudit,
  };
}

export {
  DEFAULT_RETRY_POLICY as DEFAULT_PROVIDER_INTENT_CLASSIFIER_RETRY_POLICY,
  PROVIDER_INTENT_CLASSIFIER_REQUEST_TYPE,
};
