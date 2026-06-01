import { TOOL_SIDE_EFFECT_LEVELS } from '../tools/tool-definition-contract.js';

const ACTION_REQUEST_TYPES = new Set([
  'answer',
  'greeting',
  'capability_question',
  'explanation_request',
  'acknowledgment',
  'plan_request',
  'memory_recall',
  'diagnostic',
  'tool_action',
  'workflow_action',
  'mutation',
  'approval',
  'handoff',
  'conversation',
  'unknown',
]);

const ACTION_TEMPORAL_FOCUS = new Set([
  'past',
  'current',
  'future',
  'ongoing',
  'unspecified',
]);

const ACTION_RISK_LEVELS = new Set([
  'none',
  'low',
  'medium',
  'high',
  'critical',
  'unknown',
]);

const ACTION_INTENT_STATUSES = new Set([
  'no_action',
  'classified',
  'ambiguous',
  'needs_clarification',
]);

const ACTION_INTENT_SOURCES = new Set([
  'none',
  'explicit_command',
  'explicit_envelope',
  'semantic_classifier',
  'deterministic_runtime',
  'brain_proposal',
  'runtime_policy',
  'human_approval_resume',
]);

const ACTION_TARGET_TYPES = new Set([
  'tool',
  'workflow',
  'command',
  'approval',
  'handoff',
  'memory',
  'conversation',
  'channel',
]);

const ACTION_TYPES = new Set([
  'answer_only',
  'memory_recall',
  'tool_execution',
  'workflow_execution',
  'command_execution',
  'approval_resume',
  'handoff',
  'channel_delivery',
  'conversation_reply',
]);

const ACTION_CONFIDENCE_LEVELS = new Set([
  'exact',
  'high',
  'medium',
  'low',
  'unknown',
]);

const ACTION_REQUEST_UNDERSTANDING_VERSIONS = new Set([
  1,
  2,
]);

const ACTION_KNOWN_REFERENCE_TYPES = new Set([
  'tool',
  'workflow',
  'invocation',
  'resource',
  'memory',
  'conversation',
  'operational_identity',
  'cognitive_identity',
  'provider',
  'policy',
  'document',
  'channel',
  'unknown',
]);

const ACTION_KNOWN_REFERENCE_SOURCES = new Set([
  'explicit_input',
  'conversation_context',
  'runtime_context',
  'memory_context',
  'provider_inference',
  'human_clarification',
  'unknown',
]);

const ACTION_CLARIFICATION_REASONS = new Set([
  'ambiguous_intent',
  'missing_context',
  'low_confidence',
  'multiple_candidates',
  'side_effect_unclear',
  'permission_unclear',
  'unsupported_request',
]);

const APPROVAL_REQUIRED_SIDE_EFFECT_LEVELS = new Set([
  'write_external',
  'publish_external',
  'financial',
  'destructive',
]);

const SAFE_IDENTIFIER_PATTERN = /^[a-zA-Z0-9._-]+$/u;
const SAFE_AFFORDANCE_ID_PATTERN = /^[a-zA-Z0-9._:-]+$/u;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function assertEnumValue(value, allowedValues, description) {
  if (!isNonEmptyString(value)) {
    throw new Error(`${description} must be a non-empty string.`);
  }

  const normalizedValue = value.trim();

  if (!allowedValues.has(normalizedValue)) {
    throw new Error(`${description} is invalid: ${normalizedValue}`);
  }

  return normalizedValue;
}

function assertNullableEnumValue(value, allowedValues, description) {
  if (value === undefined || value === null) {
    return null;
  }

  return assertEnumValue(value, allowedValues, description);
}

function assertSafeIdentifier(value, description) {
  if (!isNonEmptyString(value)) {
    throw new Error(`${description} must be a non-empty string.`);
  }

  const normalizedValue = value.trim();

  if (!SAFE_IDENTIFIER_PATTERN.test(normalizedValue)) {
    throw new Error(`${description} contains unsafe characters: ${normalizedValue}`);
  }

  return normalizedValue;
}

function assertSafeAffordanceIdentifier(value, description) {
  if (!isNonEmptyString(value)) {
    throw new Error(`${description} must be a non-empty string.`);
  }

  const normalizedValue = value.trim();

  if (!SAFE_AFFORDANCE_ID_PATTERN.test(normalizedValue)) {
    throw new Error(`${description} contains unsafe characters: ${normalizedValue}`);
  }

  return normalizedValue;
}

function assertNullableSafeIdentifier(value, description) {
  if (value === undefined || value === null) {
    return null;
  }

  return assertSafeIdentifier(value, description);
}

function assertNullableString(value, description) {
  if (value === undefined || value === null) {
    return null;
  }

  if (!isNonEmptyString(value)) {
    throw new Error(`${description} must be a non-empty string when provided.`);
  }

  return value.trim();
}

function assertStringArray(values, description, { allowEmpty = true } = {}) {
  if (!Array.isArray(values)) {
    throw new Error(`${description} must be an array.`);
  }

  if (!allowEmpty && values.length === 0) {
    throw new Error(`${description} must include at least one value.`);
  }

  return values.map((value, index) => {
    if (!isNonEmptyString(value)) {
      throw new Error(`${description}[${index}] must be a non-empty string.`);
    }

    return value.trim();
  });
}

function assertUniqueStringArray(values, description, { allowEmpty = true } = {}) {
  const normalizedValues = assertStringArray(values, description, { allowEmpty });
  const seenValues = new Set();

  return normalizedValues.filter((value) => {
    if (seenValues.has(value)) {
      return false;
    }

    seenValues.add(value);
    return true;
  });
}

function assertUniqueSafeIdentifierArray(values, description, { allowEmpty = true } = {}) {
  if (!Array.isArray(values)) {
    throw new Error(`${description} must be an array.`);
  }

  if (!allowEmpty && values.length === 0) {
    throw new Error(`${description} must include at least one value.`);
  }

  const seenValues = new Set();

  return values.map((value, index) => {
    const normalizedValue = assertSafeIdentifier(value, `${description}[${index}]`);

    if (seenValues.has(normalizedValue)) {
      throw new Error(`${description} contains a duplicated value: ${normalizedValue}`);
    }

    seenValues.add(normalizedValue);
    return normalizedValue;
  });
}

function assertOptionalBoolean(value, description, defaultValue) {
  if (value === undefined || value === null) {
    return defaultValue;
  }

  if (typeof value !== 'boolean') {
    throw new Error(`${description} must be a boolean when provided.`);
  }

  return value;
}

function assertNullableConfidenceScore(value, description) {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== 'number' || Number.isNaN(value) || value < 0 || value > 1) {
    throw new Error(`${description} must be a number between 0 and 1 when provided.`);
  }

  return value;
}

function assertOptionalMetadata(value, description) {
  if (value === undefined || value === null) {
    return {};
  }

  if (!isPlainObject(value)) {
    throw new Error(`${description} must be an object when provided.`);
  }

  return { ...value };
}

function assertActionAffordanceMatchEvidence(evidence, description) {
  if (!isPlainObject(evidence)) {
    throw new Error(`${description} must be an object.`);
  }

  if (evidence.kind !== 'action_affordance_match_evidence') {
    throw new Error(`${description} must include kind "action_affordance_match_evidence".`);
  }

  if (evidence.version !== 1) {
    throw new Error(`${description} version must be 1.`);
  }

  if (!isNonEmptyString(evidence.readinessReason)) {
    throw new Error(`${description} readinessReason must be a non-empty string.`);
  }

  return {
    kind: 'action_affordance_match_evidence',
    version: 1,
    affordanceId: assertSafeAffordanceIdentifier(
      evidence.affordanceId,
      `${description} affordanceId`,
    ),
    targetType: assertEnumValue(
      evidence.targetType,
      ACTION_TARGET_TYPES,
      `${description} targetType`,
    ),
    targetId: assertSafeIdentifier(
      evidence.targetId,
      `${description} targetId`,
    ),
    matchedSignals: assertUniqueStringArray(
      evidence.matchedSignals ?? [],
      `${description} matchedSignals`,
      {
        allowEmpty: false,
      },
    ),
    readinessStatus: assertNullableString(
      evidence.readinessStatus,
      `${description} readinessStatus`,
    ),
    readinessReason: evidence.readinessReason.trim(),
    metadata: assertOptionalMetadata(
      evidence.metadata,
      `${description} metadata`,
    ),
  };
}

function assertActionAffordanceRejection(rejection, description) {
  if (!isPlainObject(rejection)) {
    throw new Error(`${description} must be an object.`);
  }

  if (rejection.kind !== 'action_affordance_rejection') {
    throw new Error(`${description} must include kind "action_affordance_rejection".`);
  }

  if (rejection.version !== 1) {
    throw new Error(`${description} version must be 1.`);
  }

  if (!isNonEmptyString(rejection.reason)) {
    throw new Error(`${description} reason must be a non-empty string.`);
  }

  return {
    kind: 'action_affordance_rejection',
    version: 1,
    affordanceId: assertSafeAffordanceIdentifier(
      rejection.affordanceId,
      `${description} affordanceId`,
    ),
    targetType: assertEnumValue(
      rejection.targetType,
      ACTION_TARGET_TYPES,
      `${description} targetType`,
    ),
    targetId: assertSafeIdentifier(
      rejection.targetId,
      `${description} targetId`,
    ),
    reason: rejection.reason.trim(),
    matchedSignals: assertUniqueStringArray(
      rejection.matchedSignals ?? [],
      `${description} matchedSignals`,
    ),
    metadata: assertOptionalMetadata(
      rejection.metadata,
      `${description} metadata`,
    ),
  };
}

export function assertActionKnownReference(reference) {
  if (!isPlainObject(reference)) {
    throw new Error('Action known reference must be an object.');
  }

  if (reference.kind !== 'action_known_reference') {
    throw new Error('Action known reference must include kind "action_known_reference".');
  }

  if (reference.version !== 1) {
    throw new Error('Action known reference version must be 1.');
  }

  return {
    kind: 'action_known_reference',
    version: 1,
    referenceType: assertEnumValue(
      reference.referenceType,
      ACTION_KNOWN_REFERENCE_TYPES,
      'Action known reference referenceType',
    ),
    referenceId: assertNullableSafeIdentifier(
      reference.referenceId,
      'Action known reference referenceId',
    ),
    label: assertNullableString(
      reference.label,
      'Action known reference label',
    ),
    source: assertEnumValue(
      reference.source,
      ACTION_KNOWN_REFERENCE_SOURCES,
      'Action known reference source',
    ),
    confidence: assertEnumValue(
      reference.confidence,
      ACTION_CONFIDENCE_LEVELS,
      'Action known reference confidence',
    ),
    metadata: assertOptionalMetadata(
      reference.metadata,
      'Action known reference metadata',
    ),
  };
}

function assertActionKnownReferenceArray(values, description, { allowEmpty = true } = {}) {
  if (!Array.isArray(values)) {
    throw new Error(`${description} must be an array.`);
  }

  if (!allowEmpty && values.length === 0) {
    throw new Error(`${description} must include at least one value.`);
  }

  const seenValues = new Set();

  return values
    .map((value, index) => {
      return assertActionKnownReference(value, `${description}[${index}]`);
    })
    .filter((value) => {
      const referenceKey = [
        value.referenceType,
        value.referenceId ?? '',
        value.source,
        value.label ?? '',
      ].join('::');

      if (seenValues.has(referenceKey)) {
        return false;
      }

      seenValues.add(referenceKey);
      return true;
    });
}

function assertIntentConsistency(intent) {
  const candidateIds = new Set();

  for (const candidate of intent.candidates) {
    if (candidateIds.has(candidate.candidateId)) {
      throw new Error(`Action intent candidates contains a duplicated candidateId: ${candidate.candidateId}`);
    }

    candidateIds.add(candidate.candidateId);
  }

  if (intent.status === 'no_action') {
    if (
      intent.intentId !== null
      || intent.intentType !== null
      || intent.confidence !== null
      || intent.confidenceScore !== null
      || intent.selectedCandidateId !== null
      || intent.candidates.length > 0
      || intent.clarificationRequest !== null
    ) {
      throw new Error('No-action action intent must not include executable intent data.');
    }
  }

  if (intent.status === 'classified') {
    if (!intent.intentId || !intent.intentType || !intent.confidence) {
      throw new Error('Classified action intent requires intentId, intentType, and confidence.');
    }

    if (intent.candidates.length === 0) {
      throw new Error('Classified action intent requires at least one action candidate.');
    }

    if (!intent.selectedCandidateId) {
      throw new Error('Classified action intent requires selectedCandidateId.');
    }

    if (intent.clarificationRequest !== null) {
      throw new Error('Classified action intent must not include clarificationRequest.');
    }

    if (
      intent.understanding.requestType === 'plan_request'
      && intent.understanding.requiresAction !== true
    ) {
      throw new Error('Plan-request action intent must require a governed action target.');
    }
  }

  if (intent.status === 'ambiguous') {
    if (intent.candidates.length < 2) {
      throw new Error('Ambiguous action intent requires at least two action candidates.');
    }

    if (intent.selectedCandidateId !== null) {
      throw new Error('Ambiguous action intent must not include selectedCandidateId.');
    }

    if (intent.clarificationRequest === null) {
      throw new Error('Ambiguous action intent requires clarificationRequest.');
    }
  }

  if (intent.status === 'needs_clarification') {
    if (intent.selectedCandidateId !== null) {
      throw new Error('Needs-clarification action intent must not include selectedCandidateId.');
    }

    if (intent.clarificationRequest === null) {
      throw new Error('Needs-clarification action intent requires clarificationRequest.');
    }
  }

  if (intent.selectedCandidateId !== null) {
    if (!candidateIds.has(intent.selectedCandidateId)) {
      throw new Error(`Action intent selectedCandidateId does not match any candidate: ${intent.selectedCandidateId}`);
    }
  }
}

function assertCandidateConsistency(candidate) {
  if (
    APPROVAL_REQUIRED_SIDE_EFFECT_LEVELS.has(candidate.sideEffectLevel)
    && !candidate.requiresApproval
  ) {
    throw new Error(`Action candidate with sideEffectLevel "${candidate.sideEffectLevel}" must require approval.`);
  }
}

export function assertActionRequestUnderstanding(understanding) {
  if (!isPlainObject(understanding)) {
    throw new Error('Action request understanding must be an object.');
  }

  if (understanding.kind !== 'action_request_understanding') {
    throw new Error('Action request understanding must include kind "action_request_understanding".');
  }

  if (!ACTION_REQUEST_UNDERSTANDING_VERSIONS.has(understanding.version)) {
    throw new Error('Action request understanding version must be 1 or 2.');
  }

  if (!isNonEmptyString(understanding.originalInput)) {
    throw new Error('Action request understanding originalInput must be a non-empty string.');
  }

  if (!isNonEmptyString(understanding.summary)) {
    throw new Error('Action request understanding summary must be a non-empty string.');
  }

  const normalizedGoal = assertNullableString(
    understanding.normalizedGoal,
    'Action request understanding normalizedGoal',
  );
  const requestedOutcome = understanding.version === 1
    ? (normalizedGoal ?? understanding.summary.trim())
    : assertNullableString(
      understanding.requestedOutcome,
      'Action request understanding requestedOutcome',
    );

  return {
    kind: 'action_request_understanding',
    version: 2,
    originalInput: understanding.originalInput.trim(),
    normalizedGoal,
    requestedOutcome,
    requestType: assertEnumValue(
      understanding.requestType,
      ACTION_REQUEST_TYPES,
      'Action request understanding requestType',
    ),
    temporalFocus: assertEnumValue(
      understanding.temporalFocus,
      ACTION_TEMPORAL_FOCUS,
      'Action request understanding temporalFocus',
    ),
    riskLevel: assertEnumValue(
      understanding.riskLevel,
      ACTION_RISK_LEVELS,
      'Action request understanding riskLevel',
    ),
    requiresAction: assertOptionalBoolean(
      understanding.requiresAction,
      'Action request understanding requiresAction',
      false,
    ),
    requiresClarification: assertOptionalBoolean(
      understanding.requiresClarification,
      'Action request understanding requiresClarification',
      false,
    ),
    summary: understanding.summary.trim(),
    requiredEvidence: understanding.version === 1
      ? []
      : assertUniqueStringArray(
        understanding.requiredEvidence ?? [],
        'Action request understanding requiredEvidence',
      ),
    knownReferences: understanding.version === 1
      ? []
      : assertActionKnownReferenceArray(
        understanding.knownReferences ?? [],
        'Action request understanding knownReferences',
      ),
    evidence: assertStringArray(
      understanding.evidence ?? [],
      'Action request understanding evidence',
    ),
    missingContext: assertStringArray(
      understanding.missingContext ?? [],
      'Action request understanding missingContext',
    ),
    ambiguityMarkers: understanding.version === 1
      ? []
      : assertUniqueStringArray(
        understanding.ambiguityMarkers ?? [],
        'Action request understanding ambiguityMarkers',
      ),
    warnings: assertStringArray(
      understanding.warnings ?? [],
      'Action request understanding warnings',
    ),
    metadata: assertOptionalMetadata(
      understanding.metadata,
      'Action request understanding metadata',
    ),
  };
}

export function assertActionCandidate(candidate) {
  if (!isPlainObject(candidate)) {
    throw new Error('Action candidate must be an object.');
  }

  if (candidate.kind !== 'action_candidate') {
    throw new Error('Action candidate must include kind "action_candidate".');
  }

  if (candidate.version !== 1) {
    throw new Error('Action candidate version must be 1.');
  }

  if (!isNonEmptyString(candidate.reason)) {
    throw new Error('Action candidate reason must be a non-empty string.');
  }

  const normalizedMetadata = assertOptionalMetadata(candidate.metadata, 'Action candidate metadata');

  if (
    normalizedMetadata.affordanceMatchEvidence !== undefined
    && normalizedMetadata.affordanceMatchEvidence !== null
  ) {
    normalizedMetadata.affordanceMatchEvidence = assertActionAffordanceMatchEvidence(
      normalizedMetadata.affordanceMatchEvidence,
      'Action candidate metadata.affordanceMatchEvidence',
    );
  }

  if (
    normalizedMetadata.rejectedAlternatives !== undefined
    && normalizedMetadata.rejectedAlternatives !== null
  ) {
    if (!Array.isArray(normalizedMetadata.rejectedAlternatives)) {
      throw new Error('Action candidate metadata.rejectedAlternatives must be an array when provided.');
    }

    normalizedMetadata.rejectedAlternatives = normalizedMetadata.rejectedAlternatives.map((rejection, index) => {
      return assertActionAffordanceRejection(
        rejection,
        `Action candidate metadata.rejectedAlternatives[${index}]`,
      );
    });
  }

  const normalizedCandidate = {
    kind: 'action_candidate',
    version: 1,
    candidateId: assertSafeIdentifier(candidate.candidateId, 'Action candidate candidateId'),
    actionType: assertEnumValue(candidate.actionType, ACTION_TYPES, 'Action candidate actionType'),
    targetType: assertEnumValue(candidate.targetType, ACTION_TARGET_TYPES, 'Action candidate targetType'),
    targetId: assertSafeIdentifier(candidate.targetId, 'Action candidate targetId'),
    source: assertEnumValue(candidate.source, ACTION_INTENT_SOURCES, 'Action candidate source'),
    confidence: assertEnumValue(candidate.confidence, ACTION_CONFIDENCE_LEVELS, 'Action candidate confidence'),
    confidenceScore: assertNullableConfidenceScore(
      candidate.confidenceScore,
      'Action candidate confidenceScore',
    ),
    sideEffectLevel: assertEnumValue(
      candidate.sideEffectLevel,
      TOOL_SIDE_EFFECT_LEVELS,
      'Action candidate sideEffectLevel',
    ),
    requiresApproval: assertOptionalBoolean(
      candidate.requiresApproval,
      'Action candidate requiresApproval',
      false,
    ),
    reason: candidate.reason.trim(),
    matchedSignals: assertStringArray(candidate.matchedSignals ?? [], 'Action candidate matchedSignals'),
    missingContext: assertStringArray(candidate.missingContext ?? [], 'Action candidate missingContext'),
    warnings: assertStringArray(candidate.warnings ?? [], 'Action candidate warnings'),
    metadata: normalizedMetadata,
  };

  assertCandidateConsistency(normalizedCandidate);

  return normalizedCandidate;
}

export function assertActionClarificationRequest(clarificationRequest) {
  if (!isPlainObject(clarificationRequest)) {
    throw new Error('Action clarification request must be an object.');
  }

  if (clarificationRequest.kind !== 'action_clarification_request') {
    throw new Error('Action clarification request must include kind "action_clarification_request".');
  }

  if (clarificationRequest.version !== 1) {
    throw new Error('Action clarification request version must be 1.');
  }

  if (!isNonEmptyString(clarificationRequest.question)) {
    throw new Error('Action clarification request question must be a non-empty string.');
  }

  return {
    kind: 'action_clarification_request',
    version: 1,
    clarificationId: assertSafeIdentifier(
      clarificationRequest.clarificationId,
      'Action clarification request clarificationId',
    ),
    reasonCategory: assertEnumValue(
      clarificationRequest.reasonCategory,
      ACTION_CLARIFICATION_REASONS,
      'Action clarification request reasonCategory',
    ),
    question: clarificationRequest.question.trim(),
    candidateIds: assertUniqueSafeIdentifierArray(
      clarificationRequest.candidateIds ?? [],
      'Action clarification request candidateIds',
    ),
    missingContext: assertStringArray(
      clarificationRequest.missingContext ?? [],
      'Action clarification request missingContext',
    ),
    blockingExecution: assertOptionalBoolean(
      clarificationRequest.blockingExecution,
      'Action clarification request blockingExecution',
      true,
    ),
    warnings: assertStringArray(
      clarificationRequest.warnings ?? [],
      'Action clarification request warnings',
    ),
    metadata: assertOptionalMetadata(
      clarificationRequest.metadata,
      'Action clarification request metadata',
    ),
  };
}

export function assertActionIntent(intent) {
  if (!isPlainObject(intent)) {
    throw new Error('Action intent must be an object.');
  }

  if (intent.kind !== 'action_intent') {
    throw new Error('Action intent must include kind "action_intent".');
  }

  if (intent.version !== 1) {
    throw new Error('Action intent version must be 1.');
  }

  if (!isNonEmptyString(intent.reason)) {
    throw new Error('Action intent reason must be a non-empty string.');
  }

  const normalizedIntent = {
    kind: 'action_intent',
    version: 1,
    status: assertEnumValue(intent.status, ACTION_INTENT_STATUSES, 'Action intent status'),
    source: assertEnumValue(intent.source, ACTION_INTENT_SOURCES, 'Action intent source'),
    intentId: assertNullableSafeIdentifier(intent.intentId, 'Action intent intentId'),
    intentType: assertNullableString(intent.intentType, 'Action intent intentType'),
    confidence: assertNullableEnumValue(intent.confidence, ACTION_CONFIDENCE_LEVELS, 'Action intent confidence'),
    confidenceScore: assertNullableConfidenceScore(intent.confidenceScore, 'Action intent confidenceScore'),
    understanding: assertActionRequestUnderstanding(intent.understanding),
    candidates: Array.isArray(intent.candidates)
      ? intent.candidates.map(assertActionCandidate)
      : (() => {
        throw new Error('Action intent candidates must be an array.');
      })(),
    selectedCandidateId: assertNullableSafeIdentifier(
      intent.selectedCandidateId,
      'Action intent selectedCandidateId',
    ),
    clarificationRequest: intent.clarificationRequest === undefined || intent.clarificationRequest === null
      ? null
      : assertActionClarificationRequest(intent.clarificationRequest),
    reason: intent.reason.trim(),
    evidence: assertStringArray(intent.evidence ?? [], 'Action intent evidence'),
    warnings: assertStringArray(intent.warnings ?? [], 'Action intent warnings'),
    metadata: assertOptionalMetadata(intent.metadata, 'Action intent metadata'),
  };

  assertIntentConsistency(normalizedIntent);

  return normalizedIntent;
}

export {
  ACTION_CLARIFICATION_REASONS,
  ACTION_CONFIDENCE_LEVELS,
  ACTION_INTENT_SOURCES,
  ACTION_INTENT_STATUSES,
  ACTION_REQUEST_TYPES,
  ACTION_RISK_LEVELS,
  ACTION_TARGET_TYPES,
  ACTION_TEMPORAL_FOCUS,
  ACTION_TYPES,
  APPROVAL_REQUIRED_SIDE_EFFECT_LEVELS,
};
