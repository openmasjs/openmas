const PERMISSION_EFFECTS = new Set([
  'allow',
  'deny',
]);

const PERMISSION_ACCESS_MODES = new Set([
  'read',
  'write',
  'execute',
  'publish',
]);

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function assertPermissionRule(rule, index) {
  if (!rule || typeof rule !== 'object') {
    throw new Error(`Permission rule at index ${index} must be an object.`);
  }

  if (!isNonEmptyString(rule.ruleId)) {
    throw new Error(`Permission rule at index ${index} must include a non-empty ruleId.`);
  }

  if (!isNonEmptyString(rule.effect)) {
    throw new Error(`Permission rule at index ${index} must include a non-empty effect.`);
  }

  const normalizedEffect = rule.effect.trim();

  if (!PERMISSION_EFFECTS.has(normalizedEffect)) {
    throw new Error(`Permission rule at index ${index} has an invalid effect: ${normalizedEffect}`);
  }

  if (normalizedEffect !== 'allow') {
    throw new Error(`Permission rule at index ${index} must currently use effect "allow".`);
  }

  if (!isNonEmptyString(rule.resourceId)) {
    throw new Error(`Permission rule at index ${index} must include a non-empty resourceId.`);
  }

  if (!Array.isArray(rule.accessModes) || rule.accessModes.length === 0) {
    throw new Error(`Permission rule at index ${index} must include a non-empty accessModes array.`);
  }

  const normalizedAccessModes = rule.accessModes.map((mode, modeIndex) => {
    if (!isNonEmptyString(mode)) {
      throw new Error(`Permission rule at index ${index} has an invalid accessMode at position ${modeIndex}.`);
    }

    const normalizedMode = mode.trim();

    if (!PERMISSION_ACCESS_MODES.has(normalizedMode)) {
      throw new Error(`Permission rule at index ${index} has an invalid accessMode: ${normalizedMode}`);
    }

    return normalizedMode;
  });

  return {
    ruleId: rule.ruleId.trim(),
    effect: normalizedEffect,
    resourceId: rule.resourceId.trim(),
    accessModes: normalizedAccessModes,
  };
}

export function assertOperationalIdentityPermissions(permissionsFile) {
  if (!permissionsFile || typeof permissionsFile !== 'object') {
    throw new Error('Operational Identity permissions file must be an object.');
  }

  if (permissionsFile.kind !== 'operational_identity_permissions') {
    throw new Error('Operational Identity permissions file must include kind "operational_identity_permissions".');
  }

  if (!Number.isInteger(permissionsFile.version) || permissionsFile.version < 1) {
    throw new Error('Operational Identity permissions file must include an integer version greater than or equal to 1.');
  }

  if (!isNonEmptyString(permissionsFile.operationalIdentityId)) {
    throw new Error('Operational Identity permissions file must include a non-empty operationalIdentityId.');
  }

  if (!isNonEmptyString(permissionsFile.defaultEffect)) {
    throw new Error('Operational Identity permissions file must include a non-empty defaultEffect.');
  }

  const normalizedDefaultEffect = permissionsFile.defaultEffect.trim();

  if (!PERMISSION_EFFECTS.has(normalizedDefaultEffect)) {
    throw new Error(`Operational Identity permissions file has an invalid defaultEffect: ${normalizedDefaultEffect}`);
  }

  if (normalizedDefaultEffect !== 'deny') {
    throw new Error('Operational Identity permissions file must currently use defaultEffect "deny".');
  }

  if (!Array.isArray(permissionsFile.rules)) {
    throw new Error('Operational Identity permissions file must include a rules array.');
  }

  const seenRuleIds = new Set();

  const normalizedRules = permissionsFile.rules.map((rule, index) => {
    const normalizedRule = assertPermissionRule(rule, index);

    if (seenRuleIds.has(normalizedRule.ruleId)) {
      throw new Error(`Operational Identity permissions file contains a duplicated ruleId: ${normalizedRule.ruleId}`);
    }

    seenRuleIds.add(normalizedRule.ruleId);

    return normalizedRule;
  });

  return {
    kind: permissionsFile.kind,
    version: permissionsFile.version,
    operationalIdentityId: permissionsFile.operationalIdentityId.trim(),
    defaultEffect: normalizedDefaultEffect,
    rules: normalizedRules,
  };
}

export function assertPermissionDecision(decision) {
  if (!decision || typeof decision !== 'object') {
    throw new Error('Permission decision must be an object.');
  }

  if (!isNonEmptyString(decision.resourceId)) {
    throw new Error('Permission decision must include a non-empty resourceId.');
  }

  if (!isNonEmptyString(decision.accessMode)) {
    throw new Error('Permission decision must include a non-empty accessMode.');
  }

  if (!isNonEmptyString(decision.effect)) {
    throw new Error('Permission decision must include a non-empty effect.');
  }

  if (!PERMISSION_EFFECTS.has(decision.effect.trim())) {
    throw new Error(`Permission decision has an invalid effect: ${decision.effect}`);
  }

  if (!isNonEmptyString(decision.reason)) {
    throw new Error('Permission decision must include a non-empty reason.');
  }

  return {
    resourceId: decision.resourceId.trim(),
    accessMode: decision.accessMode.trim(),
    effect: decision.effect.trim(),
    matchedRuleId: isNonEmptyString(decision.matchedRuleId) ? decision.matchedRuleId.trim() : null,
    reason: decision.reason.trim(),
  };
}

export function assertPermissionEvaluation(evaluation) {
  if (!evaluation || typeof evaluation !== 'object') {
    throw new Error('Permission evaluation must be an object.');
  }

  if (!Array.isArray(evaluation.evaluatedBindings)) {
    throw new Error('Permission evaluation must include an evaluatedBindings array.');
  }

  const normalizedDecisions = evaluation.evaluatedBindings.map((decision) => {
    return assertPermissionDecision(decision);
  });

  if (!evaluation.summary || typeof evaluation.summary !== 'object') {
    throw new Error('Permission evaluation must include a summary object.');
  }

  if (typeof evaluation.summary.totalEvaluated !== 'number') {
    throw new Error('Permission evaluation summary must include a totalEvaluated number.');
  }

  if (typeof evaluation.summary.allowed !== 'number') {
    throw new Error('Permission evaluation summary must include an allowed number.');
  }

  if (typeof evaluation.summary.denied !== 'number') {
    throw new Error('Permission evaluation summary must include a denied number.');
  }

  if (typeof evaluation.allPermitted !== 'boolean') {
    throw new Error('Permission evaluation must include an allPermitted boolean.');
  }

  return {
    evaluatedBindings: normalizedDecisions,
    summary: {
      totalEvaluated: evaluation.summary.totalEvaluated,
      allowed: evaluation.summary.allowed,
      denied: evaluation.summary.denied,
    },
    allPermitted: evaluation.allPermitted,
  };
}

export { PERMISSION_EFFECTS, PERMISSION_ACCESS_MODES };
