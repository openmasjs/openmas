export const VERIFICATION_GATE_STATUSES = [
  'passed',
  'failed',
  'degraded',
  'not_applicable',
];

export const VERIFICATION_GATE_OUTCOMES = [
  'verified',
  'not_verified',
  'partially_verified',
  'not_applicable',
];

const STATUS_SET = new Set(VERIFICATION_GATE_STATUSES);
const OUTCOME_SET = new Set(VERIFICATION_GATE_OUTCOMES);
const EVIDENCE_TYPE_SET = new Set([
  'tool_observation',
  'workflow_observation',
  'state_mutation',
  'channel_delivery',
  'observation_preview',
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
    throw new Error(`${description} must be null or a non-empty string.`);
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
    throw new Error('Verification gate requestedAction must be an object when provided.');
  }

  return {
    actionType: assertNullableString(action.actionType, 'Verification gate requestedAction actionType'),
    targetType: assertNullableString(action.targetType, 'Verification gate requestedAction targetType'),
    targetId: assertNullableString(action.targetId, 'Verification gate requestedAction targetId'),
    runtimeAction: assertNullableString(action.runtimeAction, 'Verification gate requestedAction runtimeAction'),
    sideEffectLevel: assertNullableString(
      action.sideEffectLevel,
      'Verification gate requestedAction sideEffectLevel',
    ),
  };
}

function assertEvidenceRequirement(requirement, index) {
  if (!isPlainObject(requirement)) {
    throw new Error(`Verification gate evidenceRequirements[${index}] must be an object.`);
  }

  return {
    requirementId: assertEnumValue(
      requirement.requirementId,
      new Set([requirement.requirementId]),
      `Verification gate evidenceRequirements[${index}] requirementId`,
    ),
    evidenceType: assertEnumValue(
      requirement.evidenceType,
      EVIDENCE_TYPE_SET,
      `Verification gate evidenceRequirements[${index}] evidenceType`,
    ),
    targetType: assertNullableString(
      requirement.targetType,
      `Verification gate evidenceRequirements[${index}] targetType`,
    ),
    targetId: assertNullableString(
      requirement.targetId,
      `Verification gate evidenceRequirements[${index}] targetId`,
    ),
    required: assertBoolean(
      requirement.required,
      `Verification gate evidenceRequirements[${index}] required`,
    ),
    present: assertBoolean(
      requirement.present,
      `Verification gate evidenceRequirements[${index}] present`,
    ),
    verified: assertBoolean(
      requirement.verified,
      `Verification gate evidenceRequirements[${index}] verified`,
    ),
    source: assertNullableString(
      requirement.source,
      `Verification gate evidenceRequirements[${index}] source`,
    ),
    reason: assertEnumValue(
      requirement.reason,
      new Set([requirement.reason]),
      `Verification gate evidenceRequirements[${index}] reason`,
    ),
    metadata: assertOptionalMetadata(
      requirement.metadata,
      `Verification gate evidenceRequirements[${index}] metadata`,
    ),
  };
}

function assertEvidenceRequirements(values) {
  if (!Array.isArray(values)) {
    throw new Error('Verification gate evidenceRequirements must be an array.');
  }

  return values.map(assertEvidenceRequirement);
}

function assertNonNegativeInteger(value, description) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${description} must be a non-negative integer.`);
  }

  return value;
}

function assertClaimSupportSummary(value) {
  if (!isPlainObject(value)) {
    throw new Error('Verification gate claimSupportSummary must be an object.');
  }

  const totalClaims = assertNonNegativeInteger(
    value.totalClaims,
    'Verification gate claimSupportSummary totalClaims',
  );
  const relevantClaims = assertNonNegativeInteger(
    value.relevantClaims,
    'Verification gate claimSupportSummary relevantClaims',
  );
  const supportedClaims = assertNonNegativeInteger(
    value.supportedClaims,
    'Verification gate claimSupportSummary supportedClaims',
  );
  const unsupportedClaims = assertNonNegativeInteger(
    value.unsupportedClaims,
    'Verification gate claimSupportSummary unsupportedClaims',
  );

  if (relevantClaims > totalClaims) {
    throw new Error('Verification gate claimSupportSummary relevantClaims cannot exceed totalClaims.');
  }

  if (supportedClaims + unsupportedClaims !== relevantClaims) {
    throw new Error('Verification gate claimSupportSummary supportedClaims plus unsupportedClaims must equal relevantClaims.');
  }

  return {
    totalClaims,
    relevantClaims,
    supportedClaims,
    unsupportedClaims,
  };
}

function assertVerificationGateConsistency(gate) {
  if (gate.status === 'passed' && gate.verificationOutcome !== 'verified') {
    throw new Error('Passed verification gate must have verificationOutcome "verified".');
  }

  if (gate.status === 'failed' && gate.verificationOutcome !== 'not_verified') {
    throw new Error('Failed verification gate must have verificationOutcome "not_verified".');
  }

  if (gate.status === 'degraded' && gate.verificationOutcome !== 'partially_verified') {
    throw new Error('Degraded verification gate must have verificationOutcome "partially_verified".');
  }

  if (gate.status === 'not_applicable' && gate.verificationOutcome !== 'not_applicable') {
    throw new Error('Not-applicable verification gate must have verificationOutcome "not_applicable".');
  }

  for (const requirement of gate.evidenceRequirements) {
    if (requirement.verified && !requirement.present) {
      throw new Error(`Verification gate requirement ${requirement.requirementId} cannot be verified when present is false.`);
    }
  }
}

export function assertVerificationGate(verificationGate) {
  if (!isPlainObject(verificationGate)) {
    throw new Error('Verification gate must be an object.');
  }

  if (verificationGate.kind !== 'verification_gate') {
    throw new Error('Verification gate must include kind "verification_gate".');
  }

  if (verificationGate.version !== 1) {
    throw new Error('Verification gate version must be 1.');
  }

  if (!isNonEmptyString(verificationGate.reason)) {
    throw new Error('Verification gate reason must be a non-empty string.');
  }

  const normalizedGate = {
    kind: 'verification_gate',
    version: 1,
    status: assertEnumValue(
      verificationGate.status,
      STATUS_SET,
      'Verification gate status',
    ),
    verificationOutcome: assertEnumValue(
      verificationGate.verificationOutcome,
      OUTCOME_SET,
      'Verification gate verificationOutcome',
    ),
    requestedAction: assertRequestedAction(verificationGate.requestedAction),
    executionObserved: assertBoolean(
      verificationGate.executionObserved,
      'Verification gate executionObserved',
    ),
    evidenceRequirements: assertEvidenceRequirements(verificationGate.evidenceRequirements ?? []),
    claimSupportSummary: assertClaimSupportSummary(verificationGate.claimSupportSummary),
    reason: verificationGate.reason.trim(),
    recommendedNextActions: assertStringArray(
      verificationGate.recommendedNextActions ?? [],
      'Verification gate recommendedNextActions',
    ),
    warnings: assertStringArray(
      verificationGate.warnings ?? [],
      'Verification gate warnings',
    ),
    metadata: assertOptionalMetadata(verificationGate.metadata, 'Verification gate metadata'),
  };

  assertVerificationGateConsistency(normalizedGate);

  return normalizedGate;
}
