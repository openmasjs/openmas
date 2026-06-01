import { assertBrainProviderPreparation } from '../contracts/providers/provider-integration-contract.js';
import { assertProviderRequest } from '../contracts/providers/provider-request-contract.js';
import { assertProviderResponse } from '../contracts/providers/provider-response-contract.js';
import { resolveProviderAdapter } from './resolve-provider-adapter.js';

function resolveSecretValue({ secretResolution, credentialReferenceId }) {
  if (!secretResolution || !(secretResolution.secretValueByReferenceId instanceof Map)) {
    throw new Error('Provider execution requires secretResolution.secretValueByReferenceId.');
  }

  const secretValue = secretResolution.secretValueByReferenceId.get(credentialReferenceId);

  if (typeof secretValue !== 'string' || secretValue.length === 0) {
    throw new Error(`Provider execution secret is not available for credentialReferenceId: ${credentialReferenceId}`);
  }

  return secretValue;
}

export async function executeProviderRequest({
  preparedProvider,
  providerRequest,
  secretResolution,
  fetchImplementation,
  abortSignal = null,
}) {
  const normalizedPreparedProvider = assertBrainProviderPreparation(preparedProvider, 'Prepared Provider');
  const normalizedProviderRequest = assertProviderRequest(providerRequest);

  if (normalizedPreparedProvider.status !== 'ready') {
    throw new Error(`Prepared Provider is not ready: ${normalizedPreparedProvider.reason}`);
  }

  if (normalizedPreparedProvider.providerId !== normalizedProviderRequest.providerId) {
    throw new Error(
      `Prepared Provider ${normalizedPreparedProvider.providerId} does not match Provider Request ${normalizedProviderRequest.providerId}.`,
    );
  }

  if (normalizedPreparedProvider.modelId !== normalizedProviderRequest.modelId) {
    throw new Error(
      `Prepared Provider model ${normalizedPreparedProvider.modelId} does not match Provider Request model ${normalizedProviderRequest.modelId}.`,
    );
  }

  if (!normalizedPreparedProvider.credentialReferenceId) {
    throw new Error(`Prepared Provider ${normalizedPreparedProvider.providerId} does not define a credentialReferenceId.`);
  }

  const secretValue = resolveSecretValue({
    secretResolution,
    credentialReferenceId: normalizedPreparedProvider.credentialReferenceId,
  });

  const adapter = resolveProviderAdapter({
    providerId: normalizedPreparedProvider.providerId,
  });

  const providerResponse = await adapter.execute({
    providerRequest: normalizedProviderRequest,
    preparedProvider: normalizedPreparedProvider,
    secretValue,
    fetchImplementation,
    abortSignal,
  });

  return assertProviderResponse(providerResponse);
}
