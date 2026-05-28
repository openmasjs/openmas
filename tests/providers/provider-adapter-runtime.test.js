import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertProviderRequest,
} from '../../src/contracts/provider-request-contract.js';
import {
  assertProviderResponse,
} from '../../src/contracts/provider-response-contract.js';
import { resolveProviderAdapter } from '../../src/providers/resolve-provider-adapter.js';
import { executeProviderRequest } from '../../src/providers/execute-provider-request.js';

function createPreparedProvider({
  providerId,
  modelId,
  secretReferenceId,
}) {
  return {
    brainId: `${providerId}-primary`,
    providerId,
    modelId,
    resourceId: providerId,
    secretReferenceId,
    secretResolutionStatus: 'resolved',
    status: 'ready',
    reason: 'Provider is ready for execution.',
  };
}

function createSecretResolution(secretReferenceId, secretValue) {
  return {
    resolvedSecretReferences: [
      {
        resourceId: 'provider-resource',
        secretReferenceId,
        secretType: 'api_key',
        resolutionStatus: 'resolved',
        reason: 'resolved',
        hasSecretValue: true,
      },
    ],
    summary: {
      totalReferenced: 1,
      resolved: 1,
      unresolved: 0,
      missingDefinitions: 0,
    },
    warnings: [],
    secretValueByReferenceId: new Map([
      [secretReferenceId, secretValue],
    ]),
  };
}

test('assertProviderRequest accepts a valid generate_text request', () => {
  const request = assertProviderRequest({
    providerId: 'openrouter-api',
    modelId: 'openai/gpt-5.4-mini',
    requestType: 'generate_text',
    messages: [
      {
        role: 'system',
        content: 'You are helpful.',
      },
      {
        role: 'user',
        content: 'Say hello.',
      },
    ],
    temperature: 0.2,
    maxOutputTokens: 120,
  });

  assert.equal(request.providerId, 'openrouter-api');
  assert.equal(request.messages.length, 2);
});

test('assertProviderRequest accepts a valid classify_intent request', () => {
  const request = assertProviderRequest({
    providerId: 'openrouter-api',
    modelId: 'openrouter/free',
    requestType: 'classify_intent',
    messages: [
      {
        role: 'system',
        content: 'Classify the user action intent and return JSON only.',
      },
      {
        role: 'user',
        content: '{"kind":"provider_intent_classification_payload","version":1}',
      },
    ],
    temperature: 0,
    maxOutputTokens: 1600,
  });

  assert.equal(request.requestType, 'classify_intent');
  assert.equal(request.temperature, 0);
});

test('assertProviderResponse requires outputText when completed', () => {
  assert.throws(
    () => assertProviderResponse({
      providerId: 'gemini-api',
      modelId: 'gemini-2.5-flash',
      requestType: 'generate_text',
      status: 'completed',
      outputText: '',
      warnings: [],
    }),
    /outputText/,
  );
});

test('resolveProviderAdapter resolves Gemini, Ollama, and OpenRouter adapters', () => {
  const geminiAdapter = resolveProviderAdapter({ providerId: 'gemini-api' });
  const ollamaAdapter = resolveProviderAdapter({ providerId: 'ollama-api' });
  const openRouterAdapter = resolveProviderAdapter({ providerId: 'openrouter-api' });

  assert.equal(geminiAdapter.providerId, 'gemini-api');
  assert.equal(ollamaAdapter.providerId, 'ollama-api');
  assert.equal(openRouterAdapter.providerId, 'openrouter-api');
});

test('resolveProviderAdapter rejects unsupported providers clearly', () => {
  assert.throws(
    () => resolveProviderAdapter({ providerId: 'chatgpt-api' }),
    /No provider adapter is registered/,
  );
});

test('executeProviderRequest calls the OpenRouter adapter through mocked fetch', async () => {
  const providerResponse = await executeProviderRequest({
    preparedProvider: createPreparedProvider({
      providerId: 'openrouter-api',
      modelId: 'openai/gpt-5.4-mini',
      secretReferenceId: 'openrouter-api-key',
    }),
    providerRequest: {
      providerId: 'openrouter-api',
      modelId: 'openai/gpt-5.4-mini',
      requestType: 'generate_text',
      messages: [
        {
          role: 'system',
          content: 'You are helpful.',
        },
        {
          role: 'user',
          content: 'Say hello in one sentence.',
        },
      ],
      temperature: 0.1,
      maxOutputTokens: 64,
    },
    secretResolution: createSecretResolution('openrouter-api-key', 'openrouter-secret'),
    fetchImplementation: async (url, options) => {
      assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions');
      assert.equal(options.method, 'POST');
      assert.equal(options.headers.Authorization, 'Bearer openrouter-secret');

      const body = JSON.parse(options.body);
      assert.equal(body.model, 'openai/gpt-5.4-mini');
      assert.equal(body.messages.length, 2);

      return {
        ok: true,
        async json() {
          return {
            id: 'openrouter-response-1',
            choices: [
              {
                finish_reason: 'stop',
                message: {
                  content: 'Hello from OpenRouter.',
                },
              },
            ],
            usage: {
              prompt_tokens: 12,
              completion_tokens: 4,
              total_tokens: 16,
            },
          };
        },
      };
    },
  });

  assert.equal(providerResponse.status, 'completed');
  assert.equal(providerResponse.outputText, 'Hello from OpenRouter.');
  assert.equal(providerResponse.usage.totalTokens, 16);
});

test('executeProviderRequest maps OpenRouter authentication failures to provider taxonomy', async () => {
  const providerResponse = await executeProviderRequest({
    preparedProvider: createPreparedProvider({
      providerId: 'openrouter-api',
      modelId: 'openrouter/free',
      secretReferenceId: 'openrouter-api-key',
    }),
    providerRequest: {
      providerId: 'openrouter-api',
      modelId: 'openrouter/free',
      requestType: 'generate_text',
      messages: [
        {
          role: 'user',
          content: 'Hello.',
        },
      ],
    },
    secretResolution: createSecretResolution('openrouter-api-key', 'openrouter-secret'),
    fetchImplementation: async () => {
      return {
        ok: false,
        status: 401,
        async text() {
          return JSON.stringify({
            error: {
              message: 'Invalid API key.',
              code: 'invalid_api_key',
            },
          });
        },
      };
    },
  });

  assert.equal(providerResponse.status, 'failed');
  assert.equal(providerResponse.providerFailure.category, 'authentication_failed');
  assert.equal(providerResponse.providerFailure.retryable, false);
  assert.equal(providerResponse.providerFailure.httpStatusCode, 401);
  assert.equal(providerResponse.providerFailure.providerErrorCode, 'invalid_api_key');
});

test('executeProviderRequest calls the Gemini adapter through mocked fetch', async () => {
  const providerResponse = await executeProviderRequest({
    preparedProvider: createPreparedProvider({
      providerId: 'gemini-api',
      modelId: 'gemini-2.5-flash',
      secretReferenceId: 'gemini-api-key',
    }),
    providerRequest: {
      providerId: 'gemini-api',
      modelId: 'gemini-2.5-flash',
      requestType: 'generate_text',
      messages: [
        {
          role: 'system',
          content: 'You are a precise assistant.',
        },
        {
          role: 'user',
          content: 'Say hello in one sentence.',
        },
      ],
      temperature: 0.3,
      maxOutputTokens: 80,
    },
    secretResolution: createSecretResolution('gemini-api-key', 'gemini-secret'),
    fetchImplementation: async (url, options) => {
      assert.match(url, /^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/models\/gemini-2\.5-flash:generateContent\?key=gemini-secret$/);
      assert.equal(options.method, 'POST');

      const body = JSON.parse(options.body);
      assert.equal(body.contents.length, 1);
      assert.equal(body.contents[0].role, 'user');
      assert.equal(body.systemInstruction.parts.length, 1);

      return {
        ok: true,
        async json() {
          return {
            responseId: 'gemini-response-1',
            candidates: [
              {
                finishReason: 'STOP',
                content: {
                  parts: [
                    {
                      text: 'Hello from Gemini.',
                    },
                  ],
                },
              },
            ],
            usageMetadata: {
              promptTokenCount: 10,
              candidatesTokenCount: 5,
              totalTokenCount: 15,
            },
          };
        },
      };
    },
  });

  assert.equal(providerResponse.status, 'completed');
  assert.equal(providerResponse.outputText, 'Hello from Gemini.');
  assert.equal(providerResponse.usage.totalTokens, 15);
});

test('executeProviderRequest maps Gemini high-demand failures to provider taxonomy', async () => {
  const providerResponse = await executeProviderRequest({
    preparedProvider: createPreparedProvider({
      providerId: 'gemini-api',
      modelId: 'gemini-flash-latest',
      secretReferenceId: 'gemini-api-key',
    }),
    providerRequest: {
      providerId: 'gemini-api',
      modelId: 'gemini-flash-latest',
      requestType: 'generate_text',
      messages: [
        {
          role: 'user',
          content: 'Hello.',
        },
      ],
    },
    secretResolution: createSecretResolution('gemini-api-key', 'gemini-secret'),
    fetchImplementation: async () => {
      return {
        ok: false,
        status: 503,
        async text() {
          return JSON.stringify({
            error: {
              code: 503,
              message: 'This model is currently experiencing high demand. Please try again later.',
              status: 'UNAVAILABLE',
            },
          });
        },
      };
    },
  });

  assert.equal(providerResponse.status, 'failed');
  assert.equal(providerResponse.providerFailure.category, 'transient_unavailable');
  assert.equal(providerResponse.providerFailure.retryable, true);
  assert.equal(providerResponse.providerFailure.providerErrorStatus, 'UNAVAILABLE');
  assert.match(providerResponse.errorMessage, /high demand/u);
});

test('executeProviderRequest calls the Ollama adapter through mocked fetch', async () => {
  const providerResponse = await executeProviderRequest({
    preparedProvider: createPreparedProvider({
      providerId: 'ollama-api',
      modelId: 'nemotron-3-super:cloud',
      secretReferenceId: 'ollama-api-key',
    }),
    providerRequest: {
      providerId: 'ollama-api',
      modelId: 'nemotron-3-super:cloud',
      requestType: 'generate_text',
      messages: [
        {
          role: 'system',
          content: 'You are a precise assistant.',
        },
        {
          role: 'user',
          content: 'Say hello in one sentence.',
        },
        {
          role: 'assistant',
          content: 'I will answer briefly.',
        },
      ],
      temperature: 0.4,
      maxOutputTokens: 90,
    },
    secretResolution: createSecretResolution('ollama-api-key', 'ollama-secret'),
    fetchImplementation: async (url, options) => {
      assert.equal(url, 'https://ollama.com/api/chat');
      assert.equal(options.method, 'POST');
      assert.equal(options.headers.Authorization, 'Bearer ollama-secret');

      const body = JSON.parse(options.body);
      assert.equal(body.model, 'nemotron-3-super:cloud');
      assert.equal(body.stream, false);
      assert.equal(body.messages.length, 3);
      assert.equal(body.messages[0].role, 'system');
      assert.equal(body.options.temperature, 0.4);
      assert.equal(body.options.num_predict, 90);

      return {
        ok: true,
        async json() {
          return {
            model: 'nemotron-3-super:cloud',
            done: true,
            done_reason: 'stop',
            message: {
              role: 'assistant',
              content: 'Hello from Ollama.',
            },
            prompt_eval_count: 14,
            eval_count: 5,
          };
        },
      };
    },
  });

  assert.equal(providerResponse.status, 'completed');
  assert.equal(providerResponse.outputText, 'Hello from Ollama.');
  assert.equal(providerResponse.finishReason, 'stop');
  assert.equal(providerResponse.usage.inputTokens, 14);
  assert.equal(providerResponse.usage.outputTokens, 5);
  assert.equal(providerResponse.usage.totalTokens, 19);
});

test('executeProviderRequest maps Ollama empty output failures to provider taxonomy', async () => {
  const providerResponse = await executeProviderRequest({
    preparedProvider: createPreparedProvider({
      providerId: 'ollama-api',
      modelId: 'nemotron-3-super:cloud',
      secretReferenceId: 'ollama-api-key',
    }),
    providerRequest: {
      providerId: 'ollama-api',
      modelId: 'nemotron-3-super:cloud',
      requestType: 'generate_text',
      messages: [
        {
          role: 'user',
          content: 'Hello.',
        },
      ],
    },
    secretResolution: createSecretResolution('ollama-api-key', 'ollama-secret'),
    fetchImplementation: async () => {
      return {
        ok: true,
        async json() {
          return {
            done: true,
            done_reason: 'stop',
            message: {
              role: 'assistant',
              content: '',
            },
            prompt_eval_count: 8,
            eval_count: 0,
          };
        },
      };
    },
  });

  assert.equal(providerResponse.status, 'failed');
  assert.equal(providerResponse.providerFailure.category, 'empty_output');
  assert.equal(providerResponse.providerFailure.retryable, true);
  assert.equal(providerResponse.providerFailure.httpStatusCode, null);
});

test('executeProviderRequest fails clearly when the prepared provider is not ready', async () => {
  await assert.rejects(
    () => executeProviderRequest({
      preparedProvider: {
        brainId: 'gemini-primary',
        providerId: 'gemini-api',
        modelId: 'gemini-2.5-flash',
        resourceId: 'gemini-api',
        secretReferenceId: 'gemini-api-key',
        secretResolutionStatus: 'unresolved',
        status: 'not_ready',
        reason: 'Secret is missing.',
      },
      providerRequest: {
        providerId: 'gemini-api',
        modelId: 'gemini-2.5-flash',
        requestType: 'generate_text',
        messages: [
          {
            role: 'user',
            content: 'Hello.',
          },
        ],
      },
      secretResolution: createSecretResolution('gemini-api-key', 'gemini-secret'),
    }),
    /not ready/,
  );
});
