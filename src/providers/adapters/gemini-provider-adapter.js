import { assertProviderResponse } from '../../contracts/providers/provider-response-contract.js';
import { classifyProviderFailure } from '../classify-provider-failure.js';
import { parseJsonResponse, parseTextResponse, resolveFetchImplementation } from '../base-provider-adapter.js';

function buildGeminiContents(messages) {
  return messages
    .filter((message) => message.role !== 'system')
    .map((message) => {
      return {
        role: message.role === 'assistant' ? 'model' : 'user',
        parts: [
          {
            text: message.content,
          },
        ],
      };
    });
}

function buildGeminiSystemInstruction(messages) {
  const systemMessages = messages.filter((message) => {
    return message.role === 'system';
  });

  if (systemMessages.length === 0) {
    return null;
  }

  return {
    parts: systemMessages.map((message) => {
      return {
        text: message.content,
      };
    }),
  };
}

function extractGeminiOutputText(responseBody) {
  const candidate = Array.isArray(responseBody.candidates) ? responseBody.candidates[0] : null;
  const parts = candidate?.content?.parts;

  if (!Array.isArray(parts) || parts.length === 0) {
    return null;
  }

  const outputText = parts
    .map((part) => {
      return typeof part?.text === 'string' ? part.text : '';
    })
    .join('')
    .trim();

  return outputText.length > 0 ? outputText : null;
}

export const geminiProviderAdapter = {
  providerId: 'gemini-api',
  async execute({ providerRequest, secretValue, fetchImplementation, abortSignal = null }) {
    const effectiveFetch = resolveFetchImplementation(fetchImplementation);
    const contents = buildGeminiContents(providerRequest.messages);

    if (contents.length === 0) {
      throw new Error('Gemini provider execution requires at least one non-system message.');
    }

    const generationConfig = {};

    if (providerRequest.temperature !== null) {
      generationConfig.temperature = providerRequest.temperature;
    }

    if (providerRequest.maxOutputTokens !== null) {
      generationConfig.maxOutputTokens = providerRequest.maxOutputTokens;
    }

    const requestBody = {
      contents,
    };

    const systemInstruction = buildGeminiSystemInstruction(providerRequest.messages);

    if (systemInstruction) {
      requestBody.systemInstruction = systemInstruction;
    }

    if (Object.keys(generationConfig).length > 0) {
      requestBody.generationConfig = generationConfig;
    }

    const response = await effectiveFetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(providerRequest.modelId)}:generateContent?key=${encodeURIComponent(secretValue)}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        signal: abortSignal,
      },
    );

    if (!response.ok) {
      const responseText = await parseTextResponse(response);
      const providerFailure = classifyProviderFailure({
        errorCode: `http_${response.status}`,
        errorMessage: responseText || `Gemini request failed with HTTP ${response.status}.`,
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

    const responseBody = await parseJsonResponse(response, 'Gemini provider');
    const outputText = extractGeminiOutputText(responseBody);

    if (!outputText) {
      const providerFailure = classifyProviderFailure({
        errorCode: 'invalid_provider_response',
        errorMessage: 'Gemini provider response did not include a readable output text.',
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
      finishReason: responseBody.candidates?.[0]?.finishReason ?? null,
      providerResponseId: responseBody.responseId ?? null,
      usage: responseBody.usageMetadata
        ? {
          inputTokens: responseBody.usageMetadata.promptTokenCount ?? null,
          outputTokens: responseBody.usageMetadata.candidatesTokenCount ?? null,
          totalTokens: responseBody.usageMetadata.totalTokenCount ?? null,
        }
        : null,
      warnings: [],
      errorCode: null,
      errorMessage: null,
    });
  },
};
