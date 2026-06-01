import { assertProviderFailure } from './provider-failure-contract.js';

const PROVIDER_RESPONSE_STATUSES = new Set([
  'completed',
  'failed',
]);

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function assertOptionalInteger(value, description) {
  if (value === undefined || value === null) {
    return null;
  }

  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${description} must be a non-negative integer when provided.`);
  }

  return value;
}

function assertUsage(usage) {
  if (usage === undefined || usage === null) {
    return null;
  }

  if (!usage || typeof usage !== 'object' || Array.isArray(usage)) {
    throw new Error('Provider response usage must be an object when provided.');
  }

  return {
    inputTokens: assertOptionalInteger(usage.inputTokens, 'Provider response usage inputTokens'),
    outputTokens: assertOptionalInteger(usage.outputTokens, 'Provider response usage outputTokens'),
    totalTokens: assertOptionalInteger(usage.totalTokens, 'Provider response usage totalTokens'),
  };
}

function assertNullableProviderFailure(providerFailure) {
  if (providerFailure === undefined || providerFailure === null) {
    return null;
  }

  return assertProviderFailure(providerFailure);
}

export function assertProviderResponse(response) {
  if (!response || typeof response !== 'object' || Array.isArray(response)) {
    throw new Error('Provider response must be an object.');
  }

  if (!isNonEmptyString(response.providerId)) {
    throw new Error('Provider response must include a non-empty providerId.');
  }

  if (!isNonEmptyString(response.modelId)) {
    throw new Error('Provider response must include a non-empty modelId.');
  }

  if (!isNonEmptyString(response.requestType)) {
    throw new Error('Provider response must include a non-empty requestType.');
  }

  if (!isNonEmptyString(response.status)) {
    throw new Error('Provider response must include a non-empty status.');
  }

  const status = response.status.trim();

  if (!PROVIDER_RESPONSE_STATUSES.has(status)) {
    throw new Error(`Provider response has an invalid status: ${status}`);
  }

  if (!Array.isArray(response.warnings)) {
    throw new Error('Provider response must include a warnings array.');
  }

  if (status === 'completed' && !isNonEmptyString(response.outputText)) {
    throw new Error('Provider response with status "completed" must include a non-empty outputText.');
  }

  if (status === 'failed' && !isNonEmptyString(response.errorMessage)) {
    throw new Error('Provider response with status "failed" must include a non-empty errorMessage.');
  }

  return {
    kind: 'provider_response',
    providerId: response.providerId.trim(),
    modelId: response.modelId.trim(),
    requestType: response.requestType.trim(),
    status,
    outputText: isNonEmptyString(response.outputText) ? response.outputText.trim() : null,
    finishReason: isNonEmptyString(response.finishReason) ? response.finishReason.trim() : null,
    providerResponseId: isNonEmptyString(response.providerResponseId) ? response.providerResponseId.trim() : null,
    usage: assertUsage(response.usage),
    warnings: response.warnings.map((warning, index) => {
      if (!isNonEmptyString(warning)) {
        throw new Error(`Provider response warnings[${index}] must be a non-empty string.`);
      }

      return warning.trim();
    }),
    errorCode: isNonEmptyString(response.errorCode) ? response.errorCode.trim() : null,
    errorMessage: isNonEmptyString(response.errorMessage) ? response.errorMessage.trim() : null,
    providerFailure: status === 'failed'
      ? assertNullableProviderFailure(response.providerFailure)
      : null,
  };
}
