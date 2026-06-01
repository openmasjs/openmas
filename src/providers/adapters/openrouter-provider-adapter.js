import { assertProviderResponse } from '../../contracts/providers/provider-response-contract.js';
import { classifyProviderFailure } from '../classify-provider-failure.js';
import { parseJsonResponse, parseTextResponse, resolveFetchImplementation } from '../base-provider-adapter.js';

function extractOpenRouterOutputText(responseBody) {
  const messageContent = responseBody.choices?.[0]?.message?.content;

  if (typeof messageContent === 'string' && messageContent.trim().length > 0) {
    return messageContent.trim();
  }

  if (Array.isArray(messageContent)) {
    const outputText = messageContent
      .map((entry) => {
        if (typeof entry === 'string') {
          return entry;
        }

        if (typeof entry?.text === 'string') {
          return entry.text;
        }

        return '';
      })
      .join('')
      .trim();

    return outputText.length > 0 ? outputText : null;
  }

  return null;
}

export const openRouterProviderAdapter = {
  providerId: 'openrouter-api',
  async execute({ providerRequest, secretValue, fetchImplementation, abortSignal = null }) {
    const effectiveFetch = resolveFetchImplementation(fetchImplementation);
    const requestBody = {
      model: providerRequest.modelId,
      messages: providerRequest.messages.map((message) => {
        return {
          role: message.role,
          content: message.content,
        };
      }),
    };

    if (providerRequest.temperature !== null) {
      requestBody.temperature = providerRequest.temperature;
    }

    if (providerRequest.maxOutputTokens !== null) {
      requestBody.max_tokens = providerRequest.maxOutputTokens;
    }

    const response = await effectiveFetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secretValue}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
      signal: abortSignal,
    });

    if (!response.ok) {
      const responseText = await parseTextResponse(response);
      const providerFailure = classifyProviderFailure({
        errorCode: `http_${response.status}`,
        errorMessage: responseText || `OpenRouter request failed with HTTP ${response.status}.`,
        httpStatusCode: response.status,
      });

      return assertProviderResponse({
        providerId: providerRequest.providerId,
        modelId: providerRequest.modelId,
        requestType: providerRequest.requestType,
        status: 'failed',
        outputText: null,
        finishReason: null,
        providerResponseId: null,
        usage: null,
        warnings: [],
        errorCode: `http_${response.status}`,
        errorMessage: providerFailure.safeMessage,
        providerFailure,
      });
    }

    const responseBody = await parseJsonResponse(response, 'OpenRouter provider');
    const outputText = extractOpenRouterOutputText(responseBody);

    if (!outputText) {
      const providerFailure = classifyProviderFailure({
        errorCode: 'invalid_provider_response',
        errorMessage: 'OpenRouter provider response did not include a readable output text.',
      });

      return assertProviderResponse({
        providerId: providerRequest.providerId,
        modelId: providerRequest.modelId,
        requestType: providerRequest.requestType,
        status: 'failed',
        outputText: null,
        finishReason: null,
        providerResponseId: responseBody.id ?? null,
        usage: null,
        warnings: [],
        errorCode: 'invalid_provider_response',
        errorMessage: providerFailure.safeMessage,
        providerFailure,
      });
    }

    return assertProviderResponse({
      providerId: providerRequest.providerId,
      modelId: providerRequest.modelId,
      requestType: providerRequest.requestType,
      status: 'completed',
      outputText,
      finishReason: responseBody.choices?.[0]?.finish_reason ?? null,
      providerResponseId: responseBody.id ?? null,
      usage: responseBody.usage
        ? {
          inputTokens: responseBody.usage.prompt_tokens ?? null,
          outputTokens: responseBody.usage.completion_tokens ?? null,
          totalTokens: responseBody.usage.total_tokens ?? null,
        }
        : null,
      warnings: [],
      errorCode: null,
      errorMessage: null,
    });
  },
};
