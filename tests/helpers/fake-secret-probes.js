function joinNonSecretParts(parts, separator = '') {
  return parts.join(separator);
}

export function buildFakeOpenRouterSecretProbe(suffix = 'secretvalue1234567890') {
  return `${joinNonSecretParts(['sk', 'or', 'v1'], '-')}-${suffix}`;
}

export function buildFakeGeminiSecretProbe(suffix = 'SyFakeSecretValue1234567890') {
  return joinNonSecretParts(['AI', 'za', suffix]);
}

export function buildFakeOpenAiSecretProbe(suffix = 'testsecret1234567890123456789012345678901234567890') {
  return `${joinNonSecretParts(['sk'])}-${suffix}`;
}

export function buildFakeAnthropicSecretProbe(suffix = 'api03-abc123') {
  return `${joinNonSecretParts(['sk', 'ant'], '-')}-${suffix}`;
}
