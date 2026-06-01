const ACTION_RESULT_ASSESSMENT_STATUSES = new Set([
  'success',
  'failure',
  'partial_success',
  'no_execution',
  'approval_pause',
  'clarification_required',
  'not_applicable',
]);

const ACTION_REQUEST_FULFILLMENT_STATUSES = new Set([
  'fulfilled',
  'not_fulfilled',
  'partially_fulfilled',
  'pending_approval',
  'needs_clarification',
  'not_applicable',
]);

const ACTION_RESULT_EVIDENCE_TYPES = new Set([
  'action_resolution',
  'tool_resolution',
  'tool_execution',
  'tool_observation',
  'workflow_resolution',
  'workflow_execution',
  'workflow_observation',
  'human_approval',
  'action_claim_guard',
  'verification_gate',
  'brain_output',
]);

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

function assertNullableString(value, description) {
  if (value === undefined || value === null) {
    return null;
  }

  if (!isNonEmptyString(value)) {
    throw new Error(`${description} must be a non-empty string when provided.`);
  }

  return value.trim();
}

function assertBoolean(value, description) {
  if (typeof value !== 'boolean') {
    throw new Error(`${description} must be a boolean.`);
  }

  return value;
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

function assertRequestedAction(action) {
  if (action === undefined || action === null) {
    return null;
  }

  if (!isPlainObject(action)) {
    throw new Error('Action result assessment requestedAction must be an object when provided.');
  }

  return {
    actionType: assertNullableString(action.actionType, 'Action result assessment requestedAction actionType'),
    targetType: assertNullableString(action.targetType, 'Action result assessment requestedAction targetType'),
    targetId: assertNullableString(action.targetId, 'Action result assessment requestedAction targetId'),
    runtimeAction: assertNullableString(action.runtimeAction, 'Action result assessment requestedAction runtimeAction'),
    sideEffectLevel: assertNullableString(
      action.sideEffectLevel,
      'Action result assessment requestedAction sideEffectLevel',
    ),
  };
}

function assertEvidenceItem(evidence, index) {
  if (!isPlainObject(evidence)) {
    throw new Error(`Action result assessment evidence[${index}] must be an object.`);
  }

  return {
    evidenceType: assertEnumValue(
      evidence.evidenceType,
      ACTION_RESULT_EVIDENCE_TYPES,
      `Action result assessment evidence[${index}] evidenceType`,
    ),
    targetId: assertNullableString(evidence.targetId, `Action result assessment evidence[${index}] targetId`),
    runId: assertNullableString(evidence.runId, `Action result assessment evidence[${index}] runId`),
    status: assertNullableString(evidence.status, `Action result assessment evidence[${index}] status`),
    summary: assertNullableString(evidence.summary, `Action result assessment evidence[${index}] summary`),
  };
}

function assertEvidence(values) {
  if (!Array.isArray(values)) {
    throw new Error('Action result assessment evidence must be an array.');
  }

  return values.map(assertEvidenceItem);
}

function assertFinalAnswerAssessment(value) {
  if (!isPlainObject(value)) {
    throw new Error('Action result assessment finalAnswerAssessment must be an object.');
  }

  return {
    answerGroundedInEvidence: assertBoolean(
      value.answerGroundedInEvidence,
      'Action result assessment finalAnswerAssessment answerGroundedInEvidence',
    ),
    claimGuardStatus: assertNullableString(
      value.claimGuardStatus,
      'Action result assessment finalAnswerAssessment claimGuardStatus',
    ),
    unsupportedClaimCount: Number.isInteger(value.unsupportedClaimCount) && value.unsupportedClaimCount >= 0
      ? value.unsupportedClaimCount
      : (() => {
        throw new Error('Action result assessment finalAnswerAssessment unsupportedClaimCount must be a non-negative integer.');
      })(),
  };
}

function assertAssessmentConsistency(assessment) {
  if (assessment.status === 'success' && assessment.requestFulfillment !== 'fulfilled') {
    throw new Error('Successful action result assessment must be fulfilled.');
  }

  if (assessment.status === 'failure' && assessment.requestFulfillment !== 'not_fulfilled') {
    throw new Error('Failed action result assessment must not be fulfilled.');
  }

  if (assessment.status === 'partial_success' && assessment.requestFulfillment !== 'partially_fulfilled') {
    throw new Error('Partial action result assessment must be partially fulfilled.');
  }

  if (assessment.status === 'approval_pause' && assessment.requestFulfillment !== 'pending_approval') {
    throw new Error('Approval-paused action result assessment must be pending approval.');
  }

  if (assessment.status === 'clarification_required' && assessment.requestFulfillment !== 'needs_clarification') {
    throw new Error('Clarification-required action result assessment must need clarification.');
  }
}

export function assertActionResultAssessment(assessment) {
  if (!isPlainObject(assessment)) {
    throw new Error('Action result assessment must be an object.');
  }

  if (assessment.kind !== 'action_result_assessment') {
    throw new Error('Action result assessment must include kind "action_result_assessment".');
  }

  if (assessment.version !== 1) {
    throw new Error('Action result assessment version must be 1.');
  }

  if (!isNonEmptyString(assessment.reason)) {
    throw new Error('Action result assessment reason must be a non-empty string.');
  }

  const normalizedAssessment = {
    kind: 'action_result_assessment',
    version: 1,
    status: assertEnumValue(
      assessment.status,
      ACTION_RESULT_ASSESSMENT_STATUSES,
      'Action result assessment status',
    ),
    requestFulfillment: assertEnumValue(
      assessment.requestFulfillment,
      ACTION_REQUEST_FULFILLMENT_STATUSES,
      'Action result assessment requestFulfillment',
    ),
    requestedAction: assertRequestedAction(assessment.requestedAction),
    executionObserved: assertBoolean(assessment.executionObserved, 'Action result assessment executionObserved'),
    approvalPaused: assertBoolean(assessment.approvalPaused, 'Action result assessment approvalPaused'),
    clarificationRequired: assertBoolean(
      assessment.clarificationRequired,
      'Action result assessment clarificationRequired',
    ),
    finalAnswerAssessment: assertFinalAnswerAssessment(assessment.finalAnswerAssessment),
    reason: assessment.reason.trim(),
    evidence: assertEvidence(assessment.evidence ?? []),
    finalAnswerGuidance: assertStringArray(
      assessment.finalAnswerGuidance ?? [],
      'Action result assessment finalAnswerGuidance',
    ),
    recommendedNextActions: assertStringArray(
      assessment.recommendedNextActions ?? [],
      'Action result assessment recommendedNextActions',
    ),
    warnings: assertStringArray(assessment.warnings ?? [], 'Action result assessment warnings'),
    metadata: assertOptionalMetadata(assessment.metadata, 'Action result assessment metadata'),
  };

  assertAssessmentConsistency(normalizedAssessment);

  return normalizedAssessment;
}

export {
  ACTION_REQUEST_FULFILLMENT_STATUSES,
  ACTION_RESULT_ASSESSMENT_STATUSES,
  ACTION_RESULT_EVIDENCE_TYPES,
};
