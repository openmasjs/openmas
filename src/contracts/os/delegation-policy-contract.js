import {
  assertSafeOsSerializableValue,
} from './openmas-os-runtime-contract.js';
import {
  OPENMAS_OS_ACTION_INVOCATION_MODES,
  OPENMAS_OS_ACTION_TYPES,
} from './openmas-os-action-request-contract.js';

const OPENMAS_DELEGATION_POLICY_KIND = 'openmas_delegation_policy';
const OPENMAS_DELEGATION_POLICY_VERSION = 1;

const DELEGATION_POLICY_EFFECTS = new Set([
  'allow',
]);

const DELEGATION_POLICY_DEFAULT_EFFECTS = new Set([
  'deny',
]);

const SAFE_DELEGATION_POLICY_IDENTIFIER_PATTERN = /^[a-zA-Z0-9._*-]+$/u;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function assertPlainObject(value, description) {
  if (!isPlainObject(value)) {
    throw new Error(`${description} must be an object.`);
  }

  return value;
}

function assertRequiredString(value, description) {
  if (!isNonEmptyString(value)) {
    throw new Error(`${description} must be a non-empty string.`);
  }

  return value.trim();
}

function assertSafePolicyIdentifier(value, description) {
  const normalizedValue = assertRequiredString(value, description);

  if (!SAFE_DELEGATION_POLICY_IDENTIFIER_PATTERN.test(normalizedValue)) {
    throw new Error(`${description} contains unsafe characters: ${normalizedValue}`);
  }

  return normalizedValue;
}

function assertEnumValue(value, allowedValues, description) {
  const normalizedValue = assertRequiredString(value, description);

  if (!allowedValues.has(normalizedValue)) {
    throw new Error(`${description} is invalid: ${normalizedValue}`);
  }

  return normalizedValue;
}

function normalizeStringList({
  value,
  fallback = ['*'],
  allowedValues = null,
  description,
  allowWildcard = true,
}) {
  const rawValues = value === undefined || value === null
    ? fallback
    : value;

  const values = Array.isArray(rawValues) ? rawValues : [rawValues];

  if (values.length === 0) {
    throw new Error(`${description} must not be empty.`);
  }

  const normalizedValues = values.map((entry, index) => {
    const normalizedEntry = assertSafePolicyIdentifier(entry, `${description}[${index}]`);

    if (normalizedEntry === '*') {
      if (!allowWildcard) {
        throw new Error(`${description}[${index}] must not use wildcard "*".`);
      }

      return normalizedEntry;
    }

    if (allowedValues && !allowedValues.has(normalizedEntry)) {
      throw new Error(`${description}[${index}] is invalid: ${normalizedEntry}`);
    }

    return normalizedEntry;
  });

  return [...new Set(normalizedValues)];
}

function assertDelegationPolicyRule(rule, index) {
  assertPlainObject(rule, `Delegation policy rule at index ${index}`);

  const safeRule = assertSafeOsSerializableValue(rule, `Delegation policy rule at index ${index}`);
  const ruleId = assertSafePolicyIdentifier(safeRule.ruleId, `Delegation policy rule at index ${index} ruleId`);
  const effect = assertEnumValue(
    safeRule.effect,
    DELEGATION_POLICY_EFFECTS,
    `Delegation policy rule ${ruleId} effect`,
  );

  if (Object.hasOwn(safeRule, 'agentId') || Object.hasOwn(safeRule, 'agentIds')) {
    throw new Error(`Delegation policy rule ${ruleId} must not include agentId or agentIds. Delegation authorizes Operational Identities, not Cognitive Identity selectors.`);
  }

  return {
    ruleId,
    effect,
    fromOperationalIdentityIds: normalizeStringList({
      value: safeRule.fromOperationalIdentityIds ?? safeRule.fromOperationalIdentityId ?? safeRule.from,
      description: `Delegation policy rule ${ruleId} fromOperationalIdentityIds`,
    }),
    toOperationalIdentityIds: normalizeStringList({
      value: safeRule.toOperationalIdentityIds ?? safeRule.toOperationalIdentityId ?? safeRule.to,
      description: `Delegation policy rule ${ruleId} toOperationalIdentityIds`,
    }),
    actionTypes: normalizeStringList({
      value: safeRule.actionTypes ?? safeRule.actionType,
      fallback: ['delegate'],
      allowedValues: OPENMAS_OS_ACTION_TYPES,
      description: `Delegation policy rule ${ruleId} actionTypes`,
    }),
    commands: normalizeStringList({
      value: safeRule.commands ?? safeRule.command,
      fallback: ['ask'],
      description: `Delegation policy rule ${ruleId} commands`,
    }),
    modes: normalizeStringList({
      value: safeRule.modes ?? safeRule.mode,
      fallback: ['probabilistic'],
      allowedValues: OPENMAS_OS_ACTION_INVOCATION_MODES,
      description: `Delegation policy rule ${ruleId} modes`,
    }),
    description: isNonEmptyString(safeRule.description) ? safeRule.description.trim() : null,
  };
}

export function assertDelegationPolicy(policy) {
  assertPlainObject(policy, 'Delegation policy');

  const safePolicy = assertSafeOsSerializableValue(policy, 'Delegation policy');

  if (safePolicy.kind !== OPENMAS_DELEGATION_POLICY_KIND) {
    throw new Error(`Delegation policy must include kind "${OPENMAS_DELEGATION_POLICY_KIND}".`);
  }

  if (!Number.isInteger(safePolicy.version) || safePolicy.version < OPENMAS_DELEGATION_POLICY_VERSION) {
    throw new Error(
      `Delegation policy must include an integer version greater than or equal to ${OPENMAS_DELEGATION_POLICY_VERSION}.`,
    );
  }

  const defaultEffect = assertEnumValue(
    safePolicy.defaultEffect,
    DELEGATION_POLICY_DEFAULT_EFFECTS,
    'Delegation policy defaultEffect',
  );

  if (!Array.isArray(safePolicy.rules)) {
    throw new Error('Delegation policy must include a rules array.');
  }

  const seenRuleIds = new Set();
  const rules = safePolicy.rules.map((rule, index) => {
    const normalizedRule = assertDelegationPolicyRule(rule, index);

    if (seenRuleIds.has(normalizedRule.ruleId)) {
      throw new Error(`Delegation policy contains a duplicated ruleId: ${normalizedRule.ruleId}`);
    }

    seenRuleIds.add(normalizedRule.ruleId);
    return normalizedRule;
  });

  return {
    kind: OPENMAS_DELEGATION_POLICY_KIND,
    version: safePolicy.version,
    defaultEffect,
    rules,
  };
}

export {
  DELEGATION_POLICY_DEFAULT_EFFECTS,
  DELEGATION_POLICY_EFFECTS,
  OPENMAS_DELEGATION_POLICY_KIND,
  OPENMAS_DELEGATION_POLICY_VERSION,
};
