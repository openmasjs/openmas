import { assertProviderFailure } from '../providers/provider-failure-contract.js';

const BRAIN_OUTPUT_STATUSES = new Set([
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
    return {
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
    };
  }

  if (!usage || typeof usage !== 'object' || Array.isArray(usage)) {
    throw new Error('Brain output usage must be an object when provided.');
  }

  const inputTokens = assertOptionalInteger(usage.inputTokens, 'Brain output usage inputTokens');
  const outputTokens = assertOptionalInteger(usage.outputTokens, 'Brain output usage outputTokens');
  const explicitTotalTokens = assertOptionalInteger(usage.totalTokens, 'Brain output usage totalTokens');
  const derivedTotalTokens = inputTokens !== null && outputTokens !== null
    ? inputTokens + outputTokens
    : null;

  return {
    inputTokens,
    outputTokens,
    totalTokens: explicitTotalTokens ?? derivedTotalTokens,
  };
}

function assertWarnings(warnings) {
  if (!Array.isArray(warnings)) {
    throw new Error('Brain output must include a warnings array.');
  }

  return warnings.map((warning, index) => {
    if (!isNonEmptyString(warning)) {
      throw new Error(`Brain output warnings[${index}] must be a non-empty string.`);
    }

    return warning.trim();
  });
}

function assertNullableProviderFailure(providerFailure) {
  if (providerFailure === undefined || providerFailure === null) {
    return null;
  }

  return assertProviderFailure(providerFailure);
}

export function assertBrainOutput(output) {
  if (!output || typeof output !== 'object' || Array.isArray(output)) {
    throw new Error('Brain output must be an object.');
  }

  if (!isNonEmptyString(output.executionType)) {
    throw new Error('Brain output must include a non-empty executionType.');
  }

  if (output.executionType.trim() !== 'probabilistic_brain') {
    throw new Error(`Brain output has an invalid executionType: ${output.executionType}`);
  }

  if (!isNonEmptyString(output.providerId)) {
    throw new Error('Brain output must include a non-empty providerId.');
  }

  if (!isNonEmptyString(output.modelId)) {
    throw new Error('Brain output must include a non-empty modelId.');
  }

  if (!isNonEmptyString(output.requestType)) {
    throw new Error('Brain output must include a non-empty requestType.');
  }

  if (!isNonEmptyString(output.status)) {
    throw new Error('Brain output must include a non-empty status.');
  }

  const status = output.status.trim();

  if (!BRAIN_OUTPUT_STATUSES.has(status)) {
    throw new Error(`Brain output has an invalid status: ${status}`);
  }

  if (status === 'completed' && !isNonEmptyString(output.outputText)) {
    throw new Error('Brain output with status "completed" must include a non-empty outputText.');
  }

  if (status === 'failed' && !isNonEmptyString(output.errorMessage)) {
    throw new Error('Brain output with status "failed" must include a non-empty errorMessage.');
  }

  return {
    kind: 'brain_output',
    version: 1,
    executionType: 'probabilistic_brain',
    status,
    providerId: output.providerId.trim(),
    modelId: output.modelId.trim(),
    requestType: output.requestType.trim(),
    providerResponseStatus: status,
    outputText: isNonEmptyString(output.outputText) ? output.outputText.trim() : null,
    finishReason: isNonEmptyString(output.finishReason) ? output.finishReason.trim() : null,
    providerResponseId: isNonEmptyString(output.providerResponseId) ? output.providerResponseId.trim() : null,
    usage: assertUsage(output.usage),
    warnings: assertWarnings(output.warnings ?? []),
    errorCode: isNonEmptyString(output.errorCode) ? output.errorCode.trim() : null,
    errorMessage: isNonEmptyString(output.errorMessage) ? output.errorMessage.trim() : null,
    providerFailure: status === 'failed'
      ? assertNullableProviderFailure(output.providerFailure)
      : null,
  };
}
