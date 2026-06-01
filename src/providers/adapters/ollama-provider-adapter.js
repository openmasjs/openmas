import { assertProviderResponse } from '../../contracts/providers/provider-response-contract.js';
import { classifyProviderFailure } from '../classify-provider-failure.js';
import { parseJsonResponse, parseTextResponse, resolveFetchImplementation } from '../base-provider-adapter.js';

function extractOllamaOutputText(responseBody) {
  const messageContent = responseBody.message?.content;

  if (typeof messageContent === 'string' && messageContent.trim().length > 0) {
    return messageContent.trim();
  }

  if (typeof responseBody.response === 'string' && responseBody.response.trim().length > 0) {
    return responseBody.response.trim();
  }

  return null;
}

function buildOllamaOptions(providerRequest) {
  const options = {};

  if (providerRequest.temperature !== null) {
    options.temperature = providerRequest.temperature;
  }

  if (providerRequest.maxOutputTokens !== null) {
    options.num_predict = providerRequest.maxOutputTokens;
  }

  return Object.keys(options).length > 0 ? options : null;
}

function normalizeInteger(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function buildOllamaUsage(responseBody) {
  const inputTokens = normalizeInteger(responseBody.prompt_eval_count);
  const outputTokens = normalizeInteger(responseBody.eval_count);
  const totalTokens = inputTokens !== null && outputTokens !== null
    ? inputTokens + outputTokens
    : null;

  if (inputTokens === null && outputTokens === null && totalTokens === null) {
    return null;
  }

  return {
    inputTokens,
    outputTokens,
    totalTokens,
  };
}

function buildOllamaFinishReason(responseBody) {
  if (typeof responseBody.done_reason === 'string' && responseBody.done_reason.trim().length > 0) {
    return responseBody.done_reason.trim();
  }

  return responseBody.done === true ? 'done' : null;
}

function buildMissingContentErrorMessage(responseBody) {
  if (typeof responseBody.message?.thinking === 'string' && responseBody.message.thinking.trim().length > 0) {
    return 'Ollama provider response included internal thinking but no readable assistant content. Increase maxOutputTokens or use a model/settings combination that returns message.content.';
  }

  return 'Ollama provider response did not include a readable output text.';
}

export const ollamaProviderAdapter = {
  providerId: 'ollama-api',
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
      stream: false,
    };
    const options = buildOllamaOptions(providerRequest);

    if (options) {
      requestBody.options = options;
    }

    const response = await effectiveFetch('https://ollama.com/api/chat', {
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
        errorMessage: responseText || `Ollama request failed with HTTP ${response.status}.`,
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

    const responseBody = await parseJsonResponse(response, 'Ollama provider');
    const outputText = extractOllamaOutputText(responseBody);

    if (!outputText) {
      const providerFailure = classifyProviderFailure({
        errorCode: 'invalid_provider_response',
        errorMessage: buildMissingContentErrorMessage(responseBody),
      });

      return assertProviderResponse({
        providerId: providerRequest.providerId,
        modelId: providerRequest.modelId,
        requestType: providerRequest.requestType,
        status: 'failed',
        outputText: null,
        finishReason: buildOllamaFinishReason(responseBody),
        providerResponseId: null,
        usage: buildOllamaUsage(responseBody),
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
      finishReason: buildOllamaFinishReason(responseBody),
      providerResponseId: null,
      usage: buildOllamaUsage(responseBody),
      warnings: [],
      errorCode: null,
      errorMessage: null,
    });
  },
};
