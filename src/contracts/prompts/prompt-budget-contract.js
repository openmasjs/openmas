const PROMPT_BUDGET_RULE_ACTIONS = new Set([
  'preserve',
  'compress',
]);

const PROMPT_BUDGET_REPORT_STATUSES = new Set([
  'within_budget',
  'compressed',
  'over_budget',
]);

const PROMPT_BUDGET_DECISION_TYPES = new Set([
  'kept',
  'compressed',
  'over_budget',
]);

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function assertPositiveInteger(value, description) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${description} must be a positive integer.`);
  }

  return value;
}

function assertNonNegativeInteger(value, description) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${description} must be a non-negative integer.`);
  }

  return value;
}

function assertOptionalPositiveInteger(value, description) {
  if (value === null || value === undefined) {
    return null;
  }

  return assertPositiveInteger(value, description);
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

function assertPromptBudgetLayerRule(rule, index) {
  const description = `Prompt budget policy layerRules[${index}]`;

  if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
    throw new Error(`${description} must be an object.`);
  }

  if (!isNonEmptyString(rule.layerType)) {
    throw new Error(`${description} must include a non-empty layerType.`);
  }

  if (!isNonEmptyString(rule.action)) {
    throw new Error(`${description} must include a non-empty action.`);
  }

  const action = rule.action.trim();

  if (!PROMPT_BUDGET_RULE_ACTIONS.has(action)) {
    throw new Error(`${description} contains an invalid action: ${action}.`);
  }

  const maxContentCharacters = assertOptionalPositiveInteger(
    rule.maxContentCharacters,
    `${description} maxContentCharacters`,
  );
  const minContentCharacters = assertOptionalPositiveInteger(
    rule.minContentCharacters,
    `${description} minContentCharacters`,
  );

  if (action === 'compress' && maxContentCharacters === null) {
    throw new Error(`${description} must include maxContentCharacters when action is compress.`);
  }

  if (
    maxContentCharacters !== null
    && minContentCharacters !== null
    && minContentCharacters > maxContentCharacters
  ) {
    throw new Error(`${description} minContentCharacters must be less than or equal to maxContentCharacters.`);
  }

  return {
    layerType: rule.layerType.trim(),
    action,
    maxContentCharacters,
    minContentCharacters,
    reductionPriority: assertNonNegativeInteger(
      rule.reductionPriority ?? 0,
      `${description} reductionPriority`,
    ),
  };
}

function assertPromptBudgetSize(size, description) {
  if (!size || typeof size !== 'object' || Array.isArray(size)) {
    throw new Error(`${description} must be an object.`);
  }

  return {
    characters: assertNonNegativeInteger(size.characters, `${description} characters`),
    estimatedTokens: assertNonNegativeInteger(size.estimatedTokens, `${description} estimatedTokens`),
  };
}

function assertPromptBudgetDecision(decision, index) {
  const description = `Prompt budget report decisions[${index}]`;

  if (!decision || typeof decision !== 'object' || Array.isArray(decision)) {
    throw new Error(`${description} must be an object.`);
  }

  if (!isNonEmptyString(decision.layerId)) {
    throw new Error(`${description} must include a non-empty layerId.`);
  }

  if (!isNonEmptyString(decision.layerType)) {
    throw new Error(`${description} must include a non-empty layerType.`);
  }

  if (!isNonEmptyString(decision.decisionType)) {
    throw new Error(`${description} must include a non-empty decisionType.`);
  }

  const decisionType = decision.decisionType.trim();

  if (!PROMPT_BUDGET_DECISION_TYPES.has(decisionType)) {
    throw new Error(`${description} contains an invalid decisionType: ${decisionType}.`);
  }

  if (!isNonEmptyString(decision.reason)) {
    throw new Error(`${description} must include a non-empty reason.`);
  }

  return {
    layerId: decision.layerId.trim(),
    layerType: decision.layerType.trim(),
    decisionType,
    reason: decision.reason.trim(),
    before: assertPromptBudgetSize(decision.before, `${description} before`),
    after: assertPromptBudgetSize(decision.after, `${description} after`),
  };
}

export function assertPromptBudgetPolicy(policy) {
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) {
    throw new Error('Prompt budget policy must be an object.');
  }

  if (!isNonEmptyString(policy.kind) || policy.kind.trim() !== 'prompt_budget_policy') {
    throw new Error('Prompt budget policy kind must be prompt_budget_policy.');
  }

  if (policy.version !== 1) {
    throw new Error('Prompt budget policy version must be 1.');
  }

  if (!isNonEmptyString(policy.promptBudgetPolicyId)) {
    throw new Error('Prompt budget policy must include a non-empty promptBudgetPolicyId.');
  }

  if (!Array.isArray(policy.layerRules)) {
    throw new Error('Prompt budget policy layerRules must be an array.');
  }

  const layerRules = policy.layerRules.map(assertPromptBudgetLayerRule);
  const layerTypes = new Set();

  for (const rule of layerRules) {
    if (layerTypes.has(rule.layerType)) {
      throw new Error(`Prompt budget policy contains a duplicate layer rule for layerType: ${rule.layerType}.`);
    }

    layerTypes.add(rule.layerType);
  }

  return {
    kind: 'prompt_budget_policy',
    version: 1,
    promptBudgetPolicyId: policy.promptBudgetPolicyId.trim(),
    maxSystemInstructionCharacters: assertPositiveInteger(
      policy.maxSystemInstructionCharacters,
      'Prompt budget policy maxSystemInstructionCharacters',
    ),
    estimatedCharactersPerToken: assertPositiveInteger(
      policy.estimatedCharactersPerToken ?? 4,
      'Prompt budget policy estimatedCharactersPerToken',
    ),
    layerRules,
    warnings: assertStringArray(policy.warnings ?? [], 'Prompt budget policy warnings'),
  };
}

export function assertPromptBudgetReport(report) {
  if (!report || typeof report !== 'object' || Array.isArray(report)) {
    throw new Error('Prompt budget report must be an object.');
  }

  if (!isNonEmptyString(report.kind) || report.kind.trim() !== 'prompt_budget_report') {
    throw new Error('Prompt budget report kind must be prompt_budget_report.');
  }

  if (report.version !== 1) {
    throw new Error('Prompt budget report version must be 1.');
  }

  if (!isNonEmptyString(report.promptBudgetPolicyId)) {
    throw new Error('Prompt budget report must include a non-empty promptBudgetPolicyId.');
  }

  if (!isNonEmptyString(report.status)) {
    throw new Error('Prompt budget report must include a non-empty status.');
  }

  const status = report.status.trim();

  if (!PROMPT_BUDGET_REPORT_STATUSES.has(status)) {
    throw new Error(`Prompt budget report contains an invalid status: ${status}.`);
  }

  if (!Array.isArray(report.decisions)) {
    throw new Error('Prompt budget report decisions must be an array.');
  }

  return {
    kind: 'prompt_budget_report',
    version: 1,
    promptBudgetPolicyId: report.promptBudgetPolicyId.trim(),
    status,
    before: assertPromptBudgetSize(report.before, 'Prompt budget report before'),
    after: assertPromptBudgetSize(report.after, 'Prompt budget report after'),
    decisions: report.decisions.map(assertPromptBudgetDecision),
    warnings: assertStringArray(report.warnings ?? [], 'Prompt budget report warnings'),
  };
}
