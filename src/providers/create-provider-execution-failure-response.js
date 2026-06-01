import { assertProviderResponse } from '../contracts/providers/provider-response-contract.js';
import { classifyProviderFailure } from './classify-provider-failure.js';

export function createProviderExecutionFailureResponse({
  preparedProvider,
  providerRequest,
  error,
  metadata = {},
}) {
  const providerFailure = classifyProviderFailure({
    errorCode: 'provider_execution_error',
    errorMessage: error?.message ?? null,
    error,
    metadata,
  });

  return assertProviderResponse({
    providerId: preparedProvider.providerId,
    modelId: preparedProvider.modelId,
    requestType: providerRequest.requestType,
    status: 'failed',
    outputText: null,
    finishReason: null,
    providerResponseId: null,
    usage: null,
    warnings: [],
    errorCode: 'provider_execution_error',
    errorMessage: providerFailure.safeMessage,
    providerFailure,
  });
}
