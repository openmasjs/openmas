import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runAgentInvocation } from '../../src/invocation/run-agent-invocation.js';
import {
  createAlfredProbabilisticProjectFixture as createProjectFixture,
  withEnvironment,
} from '../helpers/create-alfred-probabilistic-fixture.js';

function createOpenRouterSuccessResponse({
  id = 'openrouter-response-001',
  outputText = 'OpenRouter answered successfully.',
  promptTokens = 120,
  completionTokens = 24,
} = {}) {
  return {
    ok: true,
    async json() {
      return {
        id,
        choices: [
          {
            finish_reason: 'stop',
            message: {
              content: outputText,
            },
          },
        ],
        usage: {
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          total_tokens: promptTokens + completionTokens,
        },
      };
    },
  };
}

function createGeminiSuccessResponse({
  responseId = 'gemini-response-001',
  outputText = 'Gemini answered successfully.',
  promptTokens = 90,
  completionTokens = 16,
} = {}) {
  return {
    ok: true,
    async json() {
      return {
        responseId,
        candidates: [
          {
            finishReason: 'STOP',
            content: {
              parts: [
                {
                  text: outputText,
                },
              ],
            },
          },
        ],
        usageMetadata: {
          promptTokenCount: promptTokens,
          candidatesTokenCount: completionTokens,
          totalTokenCount: promptTokens + completionTokens,
        },
      };
    },
  };
}

async function readInvocationSession(result) {
  return JSON.parse(await readFile(result.persistence.invocationSessionRecordPath, 'utf8'));
}

test('PR acid: primary provider transient failure falls back safely', async () => {
  await withEnvironment(
    {
      "openrouter-api-key": 'openrouter-secret',
      "gemini-api-key": 'gemini-secret',
    },
    async () => {
      const projectRootPath = await createProjectFixture({
        includeInspectionAffordances: true,
      });
      let openRouterCallCount = 0;
      let geminiCallCount = 0;

      const result = await runAgentInvocation({
        projectRootPath,
        operationalIdentityId: 'alfred',
        invocationMode: 'probabilistic',
        command: 'ask',
        inputText: 'Please answer safely even if the primary provider is temporarily unavailable.',
        requestedBy: 'provider-resilience-acid-suite',
        fetchImplementation: async (url) => {
          if (url.includes('openrouter.ai')) {
            openRouterCallCount += 1;

            return {
              ok: false,
              status: 503,
              async text() {
                return 'OpenRouter unavailable.';
              },
            };
          }

          geminiCallCount += 1;

          return createGeminiSuccessResponse({
            responseId: 'gemini-transient-fallback',
            outputText: 'Gemini recovered the request after a transient primary-provider failure.',
          });
        },
      });

      const invocationSession = await readInvocationSession(result);

      assert.equal(openRouterCallCount, 1);
      assert.equal(geminiCallCount, 1);
      assert.equal(result.status, 'completed');
      assert.equal(result.output.providerId, 'gemini-api');
      assert.equal(result.output.fallbackDecisionTrace.status, 'fallback_succeeded');
      assert.equal(result.output.fallbackDecisionTrace.primaryFailureCategory, 'transient_unavailable');
      assert.match(result.message, /after fallback from openrouter-api/u);
      assert.match(result.nextStep, /fallback provider gemini-api after primary provider openrouter-api failed/u);
      assert.equal(invocationSession.fallbackDecisionTrace.status, 'fallback_succeeded');
      assert.equal(invocationSession.fallbackDecisionTrace.primaryFailureCategory, 'transient_unavailable');
    },
  );
});

test('PR acid: primary provider authentication failure does not retry blindly', async () => {
  await withEnvironment(
    {
      "openrouter-api-key": 'openrouter-secret',
      "gemini-api-key": 'gemini-secret',
    },
    async () => {
      const projectRootPath = await createProjectFixture({
        includeInspectionAffordances: true,
      });
      let openRouterCallCount = 0;
      let geminiCallCount = 0;

      const result = await runAgentInvocation({
        projectRootPath,
        operationalIdentityId: 'alfred',
        invocationMode: 'probabilistic',
        command: 'ask',
        inputText: 'Recover safely when the primary provider API key is invalid.',
        requestedBy: 'provider-resilience-acid-suite',
        providerRetryPolicy: {
          kind: 'provider_retry_policy',
          version: 1,
          maxAttempts: 3,
          retryableFailureCategories: [
            'transient_unavailable',
            'rate_limited',
          ],
          backoffStrategy: {
            kind: 'fixed',
            baseDelayMs: 100,
            maxDelayMs: 100,
          },
          maxElapsedMs: 5000,
          allowFallbackProvider: true,
          appliesToRequestTypes: [
            'generate_text',
          ],
        },
        fetchImplementation: async (url) => {
          if (url.includes('openrouter.ai')) {
            openRouterCallCount += 1;

            return {
              ok: false,
              status: 401,
              async text() {
                return JSON.stringify({
                  error: {
                    message: 'API key not valid. Please pass a valid API key.',
                    status: 'UNAUTHENTICATED',
                  },
                });
              },
            };
          }

          geminiCallCount += 1;

          return createGeminiSuccessResponse({
            responseId: 'gemini-auth-fallback',
            outputText: 'Gemini handled the request after a non-retryable authentication failure.',
          });
        },
      });

      const invocationSession = await readInvocationSession(result);
      const primaryAttempt = invocationSession.brainExecution.attempts[0];

      assert.equal(result.status, 'completed');
      assert.equal(openRouterCallCount, 1);
      assert.equal(geminiCallCount, 1);
      assert.equal(result.output.fallbackDecisionTrace.primaryFailureCategory, 'authentication_failed');
      assert.equal(primaryAttempt.providerRetryExecution.totalAttempts, 1);
      assert.equal(primaryAttempt.providerRetryExecution.attempts[0].providerFailureCategory, 'authentication_failed');
      assert.equal(primaryAttempt.providerRetryExecution.attempts[0].retryDecision.shouldRetry, false);
      assert.equal(primaryAttempt.providerRetryExecution.attempts[0].retryDecision.stopReason, 'failure_marked_non_retryable');
    },
  );
});

test('PR acid: provider empty output is classified separately from unavailable provider', async () => {
  await withEnvironment(
    {
      "openrouter-api-key": 'openrouter-secret',
      "gemini-api-key": 'gemini-secret',
    },
    async () => {
      const projectRootPath = await createProjectFixture({
        includeInspectionAffordances: true,
      });
      let openRouterCallCount = 0;
      let geminiCallCount = 0;

      const result = await runAgentInvocation({
        projectRootPath,
        operationalIdentityId: 'alfred',
        invocationMode: 'probabilistic',
        command: 'ask',
        inputText: 'Recover safely if the provider returns an empty output.',
        requestedBy: 'provider-resilience-acid-suite',
        fetchImplementation: async (url) => {
          if (url.includes('openrouter.ai')) {
            openRouterCallCount += 1;

            return {
              ok: true,
              async json() {
                return {
                  id: 'openrouter-empty-output',
                  choices: [
                    {
                      finish_reason: 'stop',
                      message: {
                        content: '   ',
                      },
                    },
                  ],
                  usage: {
                    prompt_tokens: 55,
                    completion_tokens: 0,
                    total_tokens: 55,
                  },
                };
              },
            };
          }

          geminiCallCount += 1;

          return createGeminiSuccessResponse({
            responseId: 'gemini-empty-output-fallback',
            outputText: 'Gemini handled the request after the primary provider returned no readable output.',
          });
        },
      });

      const invocationSession = await readInvocationSession(result);

      assert.equal(result.status, 'completed');
      assert.equal(openRouterCallCount, 1);
      assert.equal(geminiCallCount, 1);
      assert.equal(result.output.fallbackDecisionTrace.status, 'fallback_succeeded');
      assert.equal(result.output.fallbackDecisionTrace.primaryFailureCategory, 'empty_output');
      assert.notEqual(result.output.fallbackDecisionTrace.primaryFailureCategory, 'transient_unavailable');
      assert.equal(invocationSession.brainExecution.attempts[0].brainOutput.providerFailure.category, 'empty_output');
      assert.equal(invocationSession.fallbackDecisionTrace.primaryFailureCategory, 'empty_output');
    },
  );
});

test('PR acid: semantic classifier provider failure does not produce misleading action clarification', async () => {
  await withEnvironment(
    {
      "openrouter-api-key": 'openrouter-secret',
      "gemini-api-key": 'gemini-secret',
    },
    async () => {
      const projectRootPath = await createProjectFixture();
      let openRouterCallCount = 0;

      const result = await runAgentInvocation({
        projectRootPath,
        operationalIdentityId: 'alfred',
        invocationMode: 'probabilistic',
        command: 'ask',
        inputText: 'Hola Alfred, podrias inspeccionar el MAS nuevamente?',
        requestedBy: 'provider-resilience-acid-suite',
        semanticIntentRuntimeMode: 'provider',
        fetchImplementation: async (url) => {
          assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions');
          openRouterCallCount += 1;

          if (openRouterCallCount === 1) {
            return createOpenRouterSuccessResponse({
              id: 'openrouter-brain-answer-before-classifier-failure',
              outputText: 'Puedo ayudarte con eso. Si necesitas mas detalle, te explico el proceso con claridad.',
            });
          }

          return {
            ok: false,
            status: 503,
            async text() {
              return 'OpenRouter unavailable during semantic classifier request.';
            },
          };
        },
      });

      const invocationSession = await readInvocationSession(result);

      assert.equal(result.status, 'completed');
      assert.equal(openRouterCallCount, 2);
      assert.equal(result.output.semanticIntentRuntime.status, 'failed');
      assert.equal(result.output.semanticIntentRuntime.providerClassifierAudit.status, 'failed');
      assert.equal(result.output.semanticIntentRuntime.providerClassifierAudit.fallbackModeUsed, 'safe_clarification');
      assert.equal(result.output.actionResolution.status, 'needs_clarification');
      assert.equal(result.output.brainToolExecution.executionPerformed, false);
      assert.equal(result.output.brainWorkflowExecution.status, 'not_executed');
      assert.equal(result.output.brainWorkflowExecution.executionPerformed, false);
      assert.match(result.nextStep, /(Semantic routing degraded|enrutamiento semantico se degrado)/iu);
      assert.match(result.nextStep, /openrouter-api/iu);
      assert.match(result.nextStep, /(explicit tool\/workflow request|solicitud explicita de tool\/workflow)/iu);
      assert.doesNotMatch(result.nextStep, /mas\.system\.inspect/u);
      assert.equal(invocationSession.semanticIntentRuntime.providerClassifierAudit.status, 'failed');
      assert.equal(invocationSession.actionResolution.status, 'needs_clarification');
    },
  );
});

test('PR acid: semantic classifier empty output keeps governed plan previews available through fallback or local recovery', async () => {
  await withEnvironment(
    {
      "openrouter-api-key": 'openrouter-secret',
      "gemini-api-key": 'gemini-secret',
    },
    async () => {
      const projectRootPath = await createProjectFixture({
        includeInspectionAffordances: true,
      });
      let openRouterCallCount = 0;
      let geminiCallCount = 0;

      const result = await runAgentInvocation({
        projectRootPath,
        operationalIdentityId: 'alfred',
        invocationMode: 'probabilistic',
        command: 'ask',
        inputText: 'Alfred, podrias ayudarme con un plan de inspeccion del MAS sin ejecutar nada todavia?',
        requestedBy: 'provider-resilience-acid-suite',
        semanticIntentRuntimeMode: 'provider',
        fetchImplementation: async (url) => {
          if (url.includes('openrouter.ai')) {
            openRouterCallCount += 1;

            if (openRouterCallCount === 1) {
              return createOpenRouterSuccessResponse({
                id: 'openrouter-plan-preview-answer',
                outputText: [
                  'Puedo ayudarte con un borrador de plan de inspeccion del MAS sin ejecutar nada por ahora.',
                  '1. Delimitar el alcance.',
                  '2. Elegir entre mas.system.inspect y mas-health-review segun profundidad.',
                  '3. Confirmar si luego deseas ejecutar una revision de solo lectura.',
                ].join('\n'),
              });
            }

            return createOpenRouterSuccessResponse({
              id: 'openrouter-plan-preview-classifier-empty-output',
              outputText: '   ',
            });
          }

          geminiCallCount += 1;

          return createGeminiSuccessResponse({
            responseId: 'gemini-plan-preview-classifier-fallback',
            outputText: JSON.stringify({
              kind: 'action_intent',
              version: 1,
              status: 'classified',
              source: 'semantic_classifier',
              intentId: 'admin.mas.inspect.plan',
              intentType: 'administrative_plan_preview',
              confidence: 'high',
              confidenceScore: 0.92,
              selectedCandidateId: 'candidate-plan-preview-001',
              candidates: [
                {
                  kind: 'action_candidate',
                  version: 1,
                  candidateId: 'candidate-plan-preview-001',
                  source: 'semantic_classifier',
                  targetType: 'tool',
                  targetId: 'mas.system.inspect',
                  actionType: 'tool_execution',
                  sideEffectLevel: 'read_only',
                  confidence: 'high',
                  confidenceScore: 0.92,
                  requiresApproval: false,
                  reason: 'The user explicitly requested a preview plan for MAS inspection before any execution.',
                  matchedSignals: [
                    'plan-preview',
                    'inspection-plan',
                  ],
                  metadata: {
                    affordanceId: 'tool:mas.system.inspect',
                  },
                },
              ],
              understanding: {
                kind: 'action_request_understanding',
                version: 2,
                originalInput: 'Alfred, podrias ayudarme con un plan de inspeccion del MAS sin ejecutar nada todavia?',
                summary: 'The user wants a governed inspection preview before any runtime execution.',
                normalizedGoal: 'Preview the MAS inspection plan before execution.',
                requestedOutcome: 'Provide a governed preview-only plan without executing the inspection.',
                requiresAction: true,
                requiresClarification: false,
                requestType: 'plan_request',
                temporalFocus: 'future',
                requiredEvidence: [],
                knownReferences: [
                  {
                    kind: 'action_known_reference',
                    version: 1,
                    referenceType: 'invocation',
                    referenceId: 'current-invocation',
                    label: 'Current invocation',
                    source: 'provider_inference',
                    confidence: 'medium',
                  },
                ],
                ambiguityMarkers: [],
              },
              reason: 'The request asks for a plan before any inspection is executed.',
            }),
          });
        },
      });

      const invocationSession = await readInvocationSession(result);

      assert.equal(result.status, 'completed');
      assert.equal(openRouterCallCount, 2);
      assert.ok(geminiCallCount === 0 || geminiCallCount === 1);
      assert.equal(result.output.semanticIntentRuntime.providerClassifierAudit.status, 'completed');
      assert.ok(
        result.output.semanticIntentRuntime.providerClassifierAudit.fallbackModeUsed === null
        || result.output.semanticIntentRuntime.providerClassifierAudit.fallbackModeUsed === 'fallback_provider',
      );
      assert.equal(result.output.actionResolution.status, 'plan_only');
      assert.equal(result.output.brainToolExecution.executionPerformed, false);
      assert.equal(result.output.brainWorkflowExecution.executionPerformed, false);
      assert.match(result.output.outputText, /(borrador(?: no verificado)?|draft)/iu);
      assert.equal(invocationSession.semanticIntentRuntime.providerClassifierAudit.status, 'completed');
      assert.equal(invocationSession.actionResolution.status, 'plan_only');
    },
  );
});

test('PR acid: final answer provider failure produces clear operator guidance', async () => {
  await withEnvironment(
    {
      "openrouter-api-key": 'openrouter-secret',
      "gemini-api-key": 'gemini-secret',
    },
    async () => {
      const projectRootPath = await createProjectFixture();

      const result = await runAgentInvocation({
        projectRootPath,
        operationalIdentityId: 'alfred',
        invocationMode: 'probabilistic',
        command: 'ask',
        inputText: 'Please show a fully failed provider path with operator guidance.',
        requestedBy: 'provider-resilience-acid-suite',
        fetchImplementation: async (url) => {
          if (url.includes('openrouter.ai')) {
            return {
              ok: false,
              status: 503,
              async text() {
                return 'OpenRouter unavailable.';
              },
            };
          }

          return {
            ok: false,
            status: 429,
            async text() {
              return JSON.stringify({
                error: {
                  message: 'Rate limit exceeded',
                  code: 'rate_limited',
                },
              });
            },
          };
        },
      });

      const invocationSession = await readInvocationSession(result);

      assert.equal(result.status, 'failed');
      assert.equal(result.output.fallbackDecisionTrace.status, 'fallback_failed');
      assert.equal(result.output.fallbackDecisionTrace.primaryFailureCategory, 'transient_unavailable');
      assert.equal(result.output.fallbackDecisionTrace.fallbackFailureCategory, 'rate_limited');
      assert.match(result.nextStep, /primary provider openrouter-api failed \(transient_unavailable\)/u);
      assert.match(result.nextStep, /fallback provider gemini-api also failed \(rate_limited\)/u);
      assert.match(result.nextStep, /provider health, secret references, and persisted invocation evidence/u);
      assert.equal(invocationSession.fallbackDecisionTrace.status, 'fallback_failed');
      assert.equal(invocationSession.fallbackDecisionTrace.fallbackFailureCategory, 'rate_limited');
    },
  );
});
