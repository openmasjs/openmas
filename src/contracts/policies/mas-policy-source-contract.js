const MAS_POLICY_LIFECYCLE_STATES = new Set([
  'active',
  'draft',
  'disabled',
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

function assertNonNegativeInteger(value, description) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${description} must be a non-negative integer.`);
  }

  return value;
}

function assertSha256(value, description) {
  if (!isNonEmptyString(value)) {
    throw new Error(`${description} must be a non-empty SHA-256 hex digest.`);
  }

  const normalizedValue = value.trim();

  if (!/^[a-f0-9]{64}$/u.test(normalizedValue)) {
    throw new Error(`${description} must be a lowercase SHA-256 hex digest.`);
  }

  return normalizedValue;
}

function assertOptionalIsoDate(value, description) {
  if (value === null || value === undefined) {
    return null;
  }

  if (!isNonEmptyString(value)) {
    throw new Error(`${description} must be a non-empty ISO date string when provided.`);
  }

  const normalizedValue = value.trim();

  if (Number.isNaN(Date.parse(normalizedValue))) {
    throw new Error(`${description} must be a valid ISO date string.`);
  }

  return normalizedValue;
}

export function assertMasPolicySource(policySource, index = null) {
  const description = Number.isInteger(index)
    ? `MAS policy source[${index}]`
    : 'MAS policy source';

  if (!isPlainObject(policySource)) {
    throw new Error(`${description} must be an object.`);
  }

  if (policySource.kind !== 'mas_policy_source') {
    throw new Error(`${description} must include kind "mas_policy_source".`);
  }

  if (!Number.isInteger(policySource.version) || policySource.version < 1) {
    throw new Error(`${description} must include an integer version greater than or equal to 1.`);
  }

  if (!isNonEmptyString(policySource.sourceId)) {
    throw new Error(`${description} must include a non-empty sourceId.`);
  }

  if (!isNonEmptyString(policySource.title)) {
    throw new Error(`${description} must include a non-empty title.`);
  }

  if (!isNonEmptyString(policySource.sourcePath)) {
    throw new Error(`${description} must include a non-empty sourcePath.`);
  }

  if (!isNonEmptyString(policySource.content)) {
    throw new Error(`${description} must include non-empty content.`);
  }

  return {
    kind: 'mas_policy_source',
    version: policySource.version,
    sourceId: policySource.sourceId.trim(),
    title: policySource.title.trim(),
    sourcePath: policySource.sourcePath.trim(),
    lifecycleState: assertEnumValue(
      policySource.lifecycleState ?? 'active',
      MAS_POLICY_LIFECYCLE_STATES,
      `${description} lifecycleState`,
    ),
    priority: assertNonNegativeInteger(policySource.priority ?? 100, `${description} priority`),
    content: policySource.content.trim(),
    contentSha256: assertSha256(policySource.contentSha256, `${description} contentSha256`),
    modifiedAt: assertOptionalIsoDate(policySource.modifiedAt, `${description} modifiedAt`),
    warnings: Array.isArray(policySource.warnings)
      ? policySource.warnings.map((warning, warningIndex) => {
        if (!isNonEmptyString(warning)) {
          throw new Error(`${description} warnings[${warningIndex}] must be a non-empty string.`);
        }

        return warning.trim();
      })
      : [],
  };
}

export function assertMasPolicySources(policySources, description = 'MAS policy sources') {
  if (!Array.isArray(policySources)) {
    throw new Error(`${description} must be an array.`);
  }

  const seenSourceIds = new Set();

  return policySources.map((policySource, index) => {
    const normalizedPolicySource = assertMasPolicySource(policySource, index);

    if (seenSourceIds.has(normalizedPolicySource.sourceId)) {
      throw new Error(`${description} contains a duplicated sourceId: ${normalizedPolicySource.sourceId}`);
    }

    seenSourceIds.add(normalizedPolicySource.sourceId);
    return normalizedPolicySource;
  });
}

export {
  MAS_POLICY_LIFECYCLE_STATES,
};
