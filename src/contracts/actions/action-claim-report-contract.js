const ACTION_CLAIM_TYPES = new Set([
  'external_delivery',
  'state_mutation',
  'tool_or_workflow_execution',
  'completed_action',
  'future_action',
]);

const ACTION_CLAIM_SURFACES = new Set([
  'channel',
  'state',
  'tool_or_workflow',
  'generic',
]);

const ACTION_CLAIM_EVIDENCE_REQUIREMENTS = new Set([
  'channel_delivery',
  'state_mutation',
  'tool_or_workflow_execution',
  'successful_runtime_observation',
  'selected_runtime_action',
]);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function assertNonEmptyString(value, description) {
  if (!isNonEmptyString(value)) {
    throw new Error(`${description} must be a non-empty string.`);
  }

  return value.trim();
}

function assertEnumValue(value, allowedValues, description) {
  const normalizedValue = assertNonEmptyString(value, description);

  if (!allowedValues.has(normalizedValue)) {
    throw new Error(`${description} is invalid: ${normalizedValue}`);
  }

  return normalizedValue;
}

function assertNullableString(value, description) {
  if (value === undefined || value === null) {
    return null;
  }

  return assertNonEmptyString(value, `${description} when provided`);
}

export function assertActionClaimDeclaration(declaration) {
  if (!isPlainObject(declaration)) {
    throw new Error('Action claim declaration must be an object.');
  }

  if (declaration.kind !== 'action_claim_declaration') {
    throw new Error('Action claim declaration must include kind "action_claim_declaration".');
  }

  if (declaration.version !== 1) {
    throw new Error('Action claim declaration version must be 1.');
  }

  return {
    kind: 'action_claim_declaration',
    version: 1,
    claimId: assertNonEmptyString(declaration.claimId, 'Action claim declaration claimId'),
    claimType: assertEnumValue(
      declaration.claimType,
      ACTION_CLAIM_TYPES,
      'Action claim declaration claimType',
    ),
    actionSurface: assertEnumValue(
      declaration.actionSurface,
      ACTION_CLAIM_SURFACES,
      'Action claim declaration actionSurface',
    ),
    evidenceRequirement: assertEnumValue(
      declaration.evidenceRequirement,
      ACTION_CLAIM_EVIDENCE_REQUIREMENTS,
      'Action claim declaration evidenceRequirement',
    ),
    summary: assertNonEmptyString(declaration.summary, 'Action claim declaration summary'),
    targetType: assertNullableString(declaration.targetType, 'Action claim declaration targetType'),
    targetId: assertNullableString(declaration.targetId, 'Action claim declaration targetId'),
    metadata: isPlainObject(declaration.metadata) ? { ...declaration.metadata } : {},
  };
}

export function assertActionClaimReport(report) {
  if (!isPlainObject(report)) {
    throw new Error('Action claim report must be an object.');
  }

  if (report.kind !== 'action_claim_report') {
    throw new Error('Action claim report must include kind "action_claim_report".');
  }

  if (report.version !== 1) {
    throw new Error('Action claim report version must be 1.');
  }

  if (!Array.isArray(report.claims)) {
    throw new Error('Action claim report claims must be an array.');
  }

  const seenClaimIds = new Set();
  const claims = report.claims.map((claim) => {
    const normalizedClaim = assertActionClaimDeclaration(claim);

    if (seenClaimIds.has(normalizedClaim.claimId)) {
      throw new Error(`Action claim report contains duplicated claimId: ${normalizedClaim.claimId}`);
    }

    seenClaimIds.add(normalizedClaim.claimId);
    return normalizedClaim;
  });

  return {
    kind: 'action_claim_report',
    version: 1,
    claims,
  };
}

export {
  ACTION_CLAIM_EVIDENCE_REQUIREMENTS,
  ACTION_CLAIM_SURFACES,
  ACTION_CLAIM_TYPES,
};
