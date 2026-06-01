import { assertProviderAdapter } from './base-provider-adapter.js';
import { geminiProviderAdapter } from './adapters/gemini-provider-adapter.js';
import { ollamaProviderAdapter } from './adapters/ollama-provider-adapter.js';
import { openRouterProviderAdapter } from './adapters/openrouter-provider-adapter.js';

const PROVIDER_ADAPTER_BY_ID = new Map([
  ['gemini-api', geminiProviderAdapter],
  ['ollama-api', ollamaProviderAdapter],
  ['openrouter-api', openRouterProviderAdapter],
]);

export function resolveProviderAdapter({ providerId }) {
  if (typeof providerId !== 'string' || providerId.trim().length === 0) {
    throw new Error('Provider adapter resolution requires a non-empty providerId.');
  }

  const normalizedProviderId = providerId.trim();
  const adapter = PROVIDER_ADAPTER_BY_ID.get(normalizedProviderId);

  if (!adapter) {
    throw new Error(`No provider adapter is registered for providerId: ${normalizedProviderId}`);
  }

  return assertProviderAdapter(adapter);
}
