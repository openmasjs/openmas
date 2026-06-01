import {
  APPROVAL_REQUIRED_SIDE_EFFECT_LEVELS,
  assertActionCandidate,
  assertActionClarificationRequest,
} from '../contracts/actions/action-intent-contract.js';
import { buildHighQualityClarificationRequest } from './build-clarification-request-quality.js';

const ACTION_RESOLUTION_POLICY_VERSION = 'action-resolution-policy-v1';

const ACTION_POLICY_DECISION_STATUSES = new Set([
  'accepted',
  'approval_required',
  'needs_clarification',
  'denied',
]);

const ACTION_POLICY_READY_STATUSES = new Set([
  'ready',
]);

const ACTION_POLICY_APPROVAL_STATUSES = new Set([
  'approval_required',
]);

const ACTION_POLICY_DENIED_STATUSES = new Set([
  'denied',
  'unavailable',
]);

const ACTION_POLICY_UNVERIFIED_STATUSES = new Set([
  'not_evaluated',
]);

const ACTION_POLICY_EXECUTABLE_CONFIDENCE_LEVELS = new Set([
  'exact',
  'high',
]);

const DEFAULT_ACTION_RESOLUTION_POLICY = {
  minimumExecutableConfidenceScore: 0.8,
  requireVerifiedReadiness: true,
};

function workflowReadinessCanBeDeferred({
  candidate,
  normalizedReadinessStatus,
}) {
  return candidate.targetType === 'workflow'
    && normalizedReadinessStatus === 'not_evaluated';
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function assertStringArray(values, description) {
  if (!Array.isArray(values)) {
    throw new Error(`${description} must be an array.`);
  }

  return values.map((value, index) => {
    if (!isNonEmptyString(value)) {
      throw new Error(`${description}[${index}] must be a non-empty string.`);
    }

    return value.trim();
  });
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

function assertDecisionStatus(status) {
  if (!isNonEmptyString(status)) {
    throw new Error('Action resolution policy decision status must be a non-empty string.');
  }

  const normalizedStatus = status.trim();

  if (!ACTION_POLICY_DECISION_STATUSES.has(normalizedStatus)) {
    throw new Error(`Action resolution policy decision status is invalid: ${normalizedStatus}`);
  }

  return normalizedStatus;
}

function normalizeReadinessStatus(readinessStatus) {
  if (!isNonEmptyString(readinessStatus)) {
    return null;
  }

  return readinessStatus.trim();
}

function mergePolicy(defaultPolicy, overrides) {
  if (overrides === undefined || overrides === null) {
    return { ...defaultPolicy };
  }

  if (!isPlainObject(overrides)) {
    throw new Error('Action resolution policy overrides must be an object when provided.');
  }

  const minimumExecutableConfidenceScore = overrides.minimumExecutableConfidenceScore
    ?? defaultPolicy.minimumExecutableConfidenceScore;

  if (
    typeof minimumExecutableConfidenceScore !== 'number'
    || Number.isNaN(minimumExecutableConfidenceScore)
    || minimumExecutableConfidenceScore < 0
    || minimumExecutableConfidenceScore > 1
  ) {
    throw new Error('Action resolution policy minimumExecutableConfidenceScore must be a number between 0 and 1.');
  }

  const requireVerifiedReadiness = overrides.requireVerifiedReadiness
    ?? defaultPolicy.requireVerifiedReadiness;

  if (typeof requireVerifiedReadiness !== 'boolean') {
    throw new Error('Action resolution policy requireVerifiedReadiness must be a boolean.');
  }

  return {
    minimumExecutableConfidenceScore,
    requireVerifiedReadiness,
  };
}

function sideEffectRequiresApproval(sideEffectLevel) {
  return APPROVAL_REQUIRED_SIDE_EFFECT_LEVELS.has(sideEffectLevel);
}

function hasStructuredRuntimeInput(candidate) {
  const runtimeInput = candidate.metadata?.runtimeInput;

  return isPlainObject(runtimeInput)
    && Object.keys(runtimeInput).length > 0;
}

function semanticInternalWriteRequiresStructuredRuntimeInput(candidate) {
  return candidate.source === 'semantic_classifier'
    && candidate.targetType === 'tool'
    && candidate.sideEffectLevel === 'write_internal'
    && !hasStructuredRuntimeInput(candidate);
}

function confidenceIsExecutable({
  candidate,
  policy,
}) {
  if (!ACTION_POLICY_EXECUTABLE_CONFIDENCE_LEVELS.has(candidate.confidence)) {
    return false;
  }

  if (
    candidate.confidenceScore !== null
    && candidate.confidence !== 'exact'
    && candidate.confidenceScore < policy.minimumExecutableConfidenceScore
  ) {
    return false;
  }

  return true;
}

function buildClarificationRequest({
  candidate,
  reasonCategory,
  missingContext,
  warnings = [],
  request = null,
}) {
  return buildHighQualityClarificationRequest({
    clarificationId: `clarification-policy-${candidate.candidateId}`,
    reasonCategory,
    existingQuestion: null,
    candidates: [
      candidate,
    ],
    missingContext,
    warnings,
    request,
    metadata: {
      policyVersion: ACTION_RESOLUTION_POLICY_VERSION,
      targetType: candidate.targetType,
      targetId: candidate.targetId,
    },
  });
}

function buildPolicyDecision({
  status,
  reason,
  clarificationRequest = null,
  executionAllowed,
  approvalRequired,
  evidence = [],
  decisionTrace = [],
  warnings = [],
  metadata = {},
}) {
  if (!isNonEmptyString(reason)) {
    throw new Error('Action resolution policy decision reason must be a non-empty string.');
  }

  if (clarificationRequest !== null) {
    assertActionClarificationRequest(clarificationRequest);
  }

  return {
    kind: 'action_resolution_policy_decision',
    version: 1,
    status: assertDecisionStatus(status),
    executionAllowed,
    approvalRequired,
    clarificationRequest,
    reason: reason.trim(),
    evidence: assertStringArray(evidence, 'Action resolution policy decision evidence'),
    decisionTrace: assertStringArray(
      decisionTrace,
      'Action resolution policy decision decisionTrace',
    ),
    warnings: assertStringArray(warnings, 'Action resolution policy decision warnings'),
    metadata: assertOptionalMetadata(
      {
        policyVersion: ACTION_RESOLUTION_POLICY_VERSION,
        ...metadata,
      },
      'Action resolution policy decision metadata',
    ),
  };
}

export function evaluateActionResolutionPolicy({
  candidate,
  readinessStatus = null,
  policyOverrides = null,
  request = null,
} = {}) {
  const normalizedCandidate = assertActionCandidate(candidate);
  const normalizedReadinessStatus = normalizeReadinessStatus(readinessStatus)
    ?? normalizeReadinessStatus(normalizedCandidate.metadata.readinessStatus);
  const policy = mergePolicy(DEFAULT_ACTION_RESOLUTION_POLICY, policyOverrides);
  const baseEvidence = [
    `Candidate confidence: ${normalizedCandidate.confidence}.`,
    `Candidate sideEffectLevel: ${normalizedCandidate.sideEffectLevel}.`,
    `Candidate requiresApproval: ${normalizedCandidate.requiresApproval ? 'yes' : 'no'}.`,
    `Candidate readinessStatus: ${normalizedReadinessStatus ?? 'missing'}.`,
  ];
  const baseDecisionTrace = [
    'Action resolution policy evaluated candidate confidence, readiness, and approval requirements.',
  ];
  const baseMetadata = {
    confidence: normalizedCandidate.confidence,
    confidenceScore: normalizedCandidate.confidenceScore,
    sideEffectLevel: normalizedCandidate.sideEffectLevel,
    requiresApproval: normalizedCandidate.requiresApproval,
    readinessStatus: normalizedReadinessStatus,
    minimumExecutableConfidenceScore: policy.minimumExecutableConfidenceScore,
    requireVerifiedReadiness: policy.requireVerifiedReadiness,
  };
  const deferredWorkflowReadiness = workflowReadinessCanBeDeferred({
    candidate: normalizedCandidate,
    normalizedReadinessStatus,
  });

  if (ACTION_POLICY_DENIED_STATUSES.has(normalizedReadinessStatus)) {
    return buildPolicyDecision({
      status: 'denied',
      executionAllowed: false,
      approvalRequired: false,
      reason: `Action candidate ${normalizedCandidate.targetType}:${normalizedCandidate.targetId} is not executable because readiness status is ${normalizedReadinessStatus}.`,
      evidence: baseEvidence,
      decisionTrace: [
        ...baseDecisionTrace,
        'Readiness policy denied execution.',
      ],
      warnings: normalizedCandidate.warnings,
      metadata: {
        ...baseMetadata,
        reasonCategory: 'readiness_denied',
      },
    });
  }

  if (!confidenceIsExecutable({
    candidate: normalizedCandidate,
    policy,
  })) {
    const clarificationRequest = buildClarificationRequest({
      candidate: normalizedCandidate,
      reasonCategory: 'low_confidence',
      missingContext: [
        'high_confidence_action_selection',
      ],
      warnings: normalizedCandidate.warnings,
      request,
    });

    return buildPolicyDecision({
      status: 'needs_clarification',
      executionAllowed: false,
      approvalRequired: false,
      clarificationRequest,
      reason: `Action candidate ${normalizedCandidate.targetType}:${normalizedCandidate.targetId} requires clarification because confidence is ${normalizedCandidate.confidence}.`,
      evidence: baseEvidence,
      decisionTrace: [
        ...baseDecisionTrace,
        'Confidence policy stopped execution.',
      ],
      warnings: normalizedCandidate.warnings,
      metadata: {
        ...baseMetadata,
        reasonCategory: 'low_confidence',
      },
    });
  }

  if (
    policy.requireVerifiedReadiness
    && (
      normalizedReadinessStatus === null
      || (
        ACTION_POLICY_UNVERIFIED_STATUSES.has(normalizedReadinessStatus)
        && !deferredWorkflowReadiness
      )
    )
  ) {
    const clarificationRequest = buildClarificationRequest({
      candidate: normalizedCandidate,
      reasonCategory: 'permission_unclear',
      missingContext: [
        'verified_action_readiness',
      ],
      warnings: normalizedCandidate.warnings,
      request,
    });

    return buildPolicyDecision({
      status: 'needs_clarification',
      executionAllowed: false,
      approvalRequired: false,
      clarificationRequest,
      reason: `Action candidate ${normalizedCandidate.targetType}:${normalizedCandidate.targetId} requires clarification because readiness is not verified.`,
      evidence: baseEvidence,
      decisionTrace: [
        ...baseDecisionTrace,
        'Readiness policy stopped execution because readiness is missing or not evaluated.',
      ],
      warnings: normalizedCandidate.warnings,
      metadata: {
        ...baseMetadata,
        reasonCategory: 'readiness_unverified',
      },
    });
  }

  if (
    normalizedCandidate.requiresApproval
    || sideEffectRequiresApproval(normalizedCandidate.sideEffectLevel)
    || ACTION_POLICY_APPROVAL_STATUSES.has(normalizedReadinessStatus)
  ) {
    return buildPolicyDecision({
      status: 'approval_required',
      executionAllowed: false,
      approvalRequired: true,
      reason: `Action candidate ${normalizedCandidate.targetType}:${normalizedCandidate.targetId} requires human approval before execution.`,
      evidence: baseEvidence,
      decisionTrace: [
        ...baseDecisionTrace,
        'Approval policy stopped automatic execution.',
      ],
      warnings: normalizedCandidate.warnings,
      metadata: {
        ...baseMetadata,
        reasonCategory: 'approval_required',
      },
    });
  }

  if (semanticInternalWriteRequiresStructuredRuntimeInput(normalizedCandidate)) {
    const clarificationRequest = buildClarificationRequest({
      candidate: normalizedCandidate,
      reasonCategory: 'unsupported_request',
      missingContext: [
        'structured_runtime_input',
      ],
      warnings: normalizedCandidate.warnings,
      request,
    });

    return buildPolicyDecision({
      status: 'needs_clarification',
      executionAllowed: false,
      approvalRequired: false,
      clarificationRequest,
      reason: `Action candidate ${normalizedCandidate.targetType}:${normalizedCandidate.targetId} requires clarification because semantic write_internal actions need explicit structured runtime input.`,
      evidence: baseEvidence,
      decisionTrace: [
        ...baseDecisionTrace,
        'Semantic write_internal policy stopped execution because structured runtime input was missing.',
      ],
      warnings: normalizedCandidate.warnings,
      metadata: {
        ...baseMetadata,
        reasonCategory: 'structured_runtime_input_missing',
      },
    });
  }

  if (
    policy.requireVerifiedReadiness
    && !ACTION_POLICY_READY_STATUSES.has(normalizedReadinessStatus)
    && !deferredWorkflowReadiness
  ) {
    const clarificationRequest = buildClarificationRequest({
      candidate: normalizedCandidate,
      reasonCategory: 'permission_unclear',
      missingContext: [
        'known_action_readiness_status',
      ],
      warnings: normalizedCandidate.warnings,
      request,
    });

    return buildPolicyDecision({
      status: 'needs_clarification',
      executionAllowed: false,
      approvalRequired: false,
      clarificationRequest,
      reason: `Action candidate ${normalizedCandidate.targetType}:${normalizedCandidate.targetId} has unsupported readiness status ${normalizedReadinessStatus}.`,
      evidence: baseEvidence,
      decisionTrace: [
        ...baseDecisionTrace,
        'Readiness policy stopped execution because readiness status is unsupported.',
      ],
      warnings: normalizedCandidate.warnings,
      metadata: {
        ...baseMetadata,
        reasonCategory: 'unsupported_readiness_status',
      },
    });
  }

  return buildPolicyDecision({
    status: 'accepted',
    executionAllowed: true,
    approvalRequired: false,
    reason: `Action candidate ${normalizedCandidate.targetType}:${normalizedCandidate.targetId} passed confidence, readiness, and approval policy.`,
    evidence: baseEvidence,
    decisionTrace: [
      ...baseDecisionTrace,
      ...(deferredWorkflowReadiness
        ? ['Workflow readiness evaluation is deferred to downstream workflow request resolution.']
        : []),
      'Action candidate passed policy and can be queued for execution.',
    ],
    warnings: normalizedCandidate.warnings,
    metadata: {
      ...baseMetadata,
      reasonCategory: 'policy_accepted',
      readinessDeferredToWorkflowRuntime: deferredWorkflowReadiness,
    },
  });
}

export {
  ACTION_POLICY_DECISION_STATUSES,
  ACTION_RESOLUTION_POLICY_VERSION,
  DEFAULT_ACTION_RESOLUTION_POLICY,
};
