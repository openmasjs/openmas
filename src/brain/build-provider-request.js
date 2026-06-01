import { assertProviderRequest } from '../contracts/providers/provider-request-contract.js';

export function buildProviderRequest({ brainInput }) {
  const messages = [
    {
      role: 'system',
      content: brainInput.systemInstructions,
    },
    {
      role: 'user',
      content: brainInput.userInput,
    },
  ];

  if (brainInput.assistantPrimer) {
    messages.push({
      role: 'assistant',
      content: brainInput.assistantPrimer,
    });
  }

  return assertProviderRequest({
    providerId: brainInput.providerId,
    modelId: brainInput.modelId,
    requestType: 'generate_text',
    messages,
  });
}
