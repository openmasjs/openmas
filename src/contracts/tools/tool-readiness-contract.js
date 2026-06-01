const TOOL_READINESS_STATUSES = new Set([
  'ready',
  'approval_required',
  'denied',
  'unavailable',
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

function assertNullableString(value, description) {
  if (value === undefined || value === null) {
    return null;
  }

  if (!isNonEmptyString(value)) {
    throw new Error(`${description} must be a non-empty string when provided.`);
  }

  return value.trim();
}

function assertMatchedBinding(binding, index) {
  const description = `Tool readiness verdict matchedBindings[${index}]`;

  if (!isPlainObject(binding)) {
    throw new Error(`${description} must be an object.`);
  }

  if (!isNonEmptyString(binding.resourceId)) {
    throw new Error(`${description} must include a non-empty resourceId.`);
  }

  if (!isNonEmptyString(binding.resourceType)) {
    throw new Error(`${description} must include a non-empty resourceType.`);
  }

  if (!isNonEmptyString(binding.accessMode)) {
    throw new Error(`${description} must include a non-empty accessMode.`);
  }

  return {
    resourceId: binding.resourceId.trim(),
    resourceType: binding.resourceType.trim(),
    accessMode: binding.accessMode.trim(),
    credentialReferenceId: assertNullableString(binding.credentialReferenceId, `${description} credentialReferenceId`),
    secretResolutionStatus: assertNullableString(binding.secretResolutionStatus, `${description} secretResolutionStatus`),
  };
}

function assertMatchedBindings(bindings) {
  if (!Array.isArray(bindings)) {
    throw new Error('Tool readiness verdict matchedBindings must be an array.');
  }

  const seenBindingKeys = new Set();

  return bindings.map((binding, index) => {
    const normalizedBinding = assertMatchedBinding(binding, index);
    const bindingKey = `${normalizedBinding.resourceId}:${normalizedBinding.accessMode}`;

    if (seenBindingKeys.has(bindingKey)) {
      throw new Error(`Tool readiness verdict matchedBindings contains a duplicated binding: ${bindingKey}`);
    }

    seenBindingKeys.add(bindingKey);
    return normalizedBinding;
  });
}

function assertMissingRequirement(requirement, index) {
  const description = `Tool readiness verdict missingRequirements[${index}]`;

  if (!isPlainObject(requirement)) {
    throw new Error(`${description} must be an object.`);
  }

  if (!isNonEmptyString(requirement.reason)) {
    throw new Error(`${description} must include a non-empty reason.`);
  }

  return {
    resourceType: assertNullableString(requirement.resourceType, `${description} resourceType`),
    accessMode: assertNullableString(requirement.accessMode, `${description} accessMode`),
    reason: requirement.reason.trim(),
  };
}

function assertMissingRequirements(requirements) {
  if (!Array.isArray(requirements)) {
    throw new Error('Tool readiness verdict missingRequirements must be an array.');
  }

  return requirements.map(assertMissingRequirement);
}

export function assertToolReadinessVerdict(verdict) {
  if (!isPlainObject(verdict)) {
    throw new Error('Tool readiness verdict must be an object.');
  }

  if (verdict.kind !== 'tool_readiness_verdict') {
    throw new Error('Tool readiness verdict must include kind "tool_readiness_verdict".');
  }

  if (!Number.isInteger(verdict.version) || verdict.version < 1) {
    throw new Error('Tool readiness verdict must include an integer version greater than or equal to 1.');
  }

  if (!isNonEmptyString(verdict.toolId)) {
    throw new Error('Tool readiness verdict must include a non-empty toolId.');
  }

  if (!isNonEmptyString(verdict.reason)) {
    throw new Error('Tool readiness verdict must include a non-empty reason.');
  }

  if (typeof verdict.approvalRequired !== 'boolean') {
    throw new Error('Tool readiness verdict must include boolean approvalRequired.');
  }

  const normalizedVerdict = {
    kind: verdict.kind,
    version: verdict.version,
    toolId: verdict.toolId.trim(),
    status: assertEnumValue(verdict.status, TOOL_READINESS_STATUSES, 'Tool readiness verdict status'),
    approvalRequired: verdict.approvalRequired,
    reason: verdict.reason.trim(),
    matchedBindings: assertMatchedBindings(verdict.matchedBindings ?? []),
    missingRequirements: assertMissingRequirements(verdict.missingRequirements ?? []),
    warnings: assertStringArray(verdict.warnings ?? [], 'Tool readiness verdict warnings'),
  };

  if (normalizedVerdict.status === 'ready' && normalizedVerdict.approvalRequired) {
    throw new Error('Tool readiness verdict with status "ready" must not require approval.');
  }

  if (normalizedVerdict.status === 'approval_required' && !normalizedVerdict.approvalRequired) {
    throw new Error('Tool readiness verdict with status "approval_required" must require approval.');
  }

  if (
    (normalizedVerdict.status === 'denied' || normalizedVerdict.status === 'unavailable')
    && normalizedVerdict.missingRequirements.length === 0
  ) {
    throw new Error(`Tool readiness verdict with status "${normalizedVerdict.status}" must include at least one missing requirement.`);
  }

  return normalizedVerdict;
}

export function assertToolReadinessEvaluation(evaluation) {
  if (!isPlainObject(evaluation)) {
    throw new Error('Tool readiness evaluation must be an object.');
  }

  if (evaluation.kind !== 'tool_readiness_evaluation') {
    throw new Error('Tool readiness evaluation must include kind "tool_readiness_evaluation".');
  }

  if (!Number.isInteger(evaluation.version) || evaluation.version < 1) {
    throw new Error('Tool readiness evaluation must include an integer version greater than or equal to 1.');
  }

  if (!Array.isArray(evaluation.evaluatedTools)) {
    throw new Error('Tool readiness evaluation must include an evaluatedTools array.');
  }

  const evaluatedTools = evaluation.evaluatedTools.map(assertToolReadinessVerdict);
  const seenToolIds = new Set();

  for (const verdict of evaluatedTools) {
    if (seenToolIds.has(verdict.toolId)) {
      throw new Error(`Tool readiness evaluation contains a duplicated toolId: ${verdict.toolId}`);
    }

    seenToolIds.add(verdict.toolId);
  }

  if (!isPlainObject(evaluation.summary)) {
    throw new Error('Tool readiness evaluation must include a summary object.');
  }

  const summary = {
    totalEvaluated: evaluation.summary.totalEvaluated,
    ready: evaluation.summary.ready,
    approvalRequired: evaluation.summary.approvalRequired,
    denied: evaluation.summary.denied,
    unavailable: evaluation.summary.unavailable,
  };

  for (const [fieldName, value] of Object.entries(summary)) {
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(`Tool readiness evaluation summary.${fieldName} must be a non-negative integer.`);
    }
  }

  if (summary.totalEvaluated !== evaluatedTools.length) {
    throw new Error('Tool readiness evaluation summary.totalEvaluated must match evaluatedTools length.');
  }

  const countedSummary = evaluatedTools.reduce((counts, verdict) => {
    if (verdict.status === 'ready') {
      counts.ready++;
    } else if (verdict.status === 'approval_required') {
      counts.approvalRequired++;
    } else if (verdict.status === 'denied') {
      counts.denied++;
    } else if (verdict.status === 'unavailable') {
      counts.unavailable++;
    }

    return counts;
  }, {
    ready: 0,
    approvalRequired: 0,
    denied: 0,
    unavailable: 0,
  });

  if (
    countedSummary.ready !== summary.ready
    || countedSummary.approvalRequired !== summary.approvalRequired
    || countedSummary.denied !== summary.denied
    || countedSummary.unavailable !== summary.unavailable
  ) {
    throw new Error('Tool readiness evaluation summary counts must match evaluated tool statuses.');
  }

  return {
    kind: evaluation.kind,
    version: evaluation.version,
    evaluatedTools,
    summary,
    warnings: assertStringArray(evaluation.warnings ?? [], 'Tool readiness evaluation warnings'),
  };
}

export {
  TOOL_READINESS_STATUSES,
};
