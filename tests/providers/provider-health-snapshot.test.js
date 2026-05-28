import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runAgentInvocation } from '../../src/invocation/run-agent-invocation.js';
import {
  buildProviderHealthSnapshotCollection,
  extractProviderHealthEventsFromInvocationSession,
} from '../../src/providers/build-provider-health-snapshots-for-invocation.js';
import {
  createAlfredProbabilisticProjectFixture as createProjectFixture,
  withEnvironment,
} from '../helpers/create-alfred-probabilistic-fixture.js';

test('buildProviderHealthSnapshotCollection classifies healthy, degraded, and unavailable provider states', () => {
  const providerHealth = buildProviderHealthSnapshotCollection({
    generatedAt: '2026-04-23T12:00:00.000Z',
    maxHistoricalSessions: 12,
    includedHistoricalSessionCount: 3,
    includedCurrentInvocation: true,
    providerAssignments: [
      {
        providerId: 'openrouter-api',
        modelId: 'openrouter/free',
        roleId: 'selected_brain',
        readinessStatus: 'ready',
      },
      {
        providerId: 'gemini-api',
        modelId: 'gemini-flash-latest',
        roleId: 'fallback_brain',
        readinessStatus: 'ready',
      },
    ],
    providerEvents: [
      {
        providerId: 'openrouter-api',
        modelId: 'openrouter/free',
        requestType: 'generate_text',
        status: 'failed',
        failureCategory: 'transient_unavailable',
        occurredAt: '2026-04-23T11:59:00.000Z',
        source: 'brain_execution',
        roleId: 'selected_brain',
        sequenceNumber: 3,
      },
      {
        providerId: 'openrouter-api',
        modelId: 'openrouter/free',
        requestType: 'generate_text',
        status: 'failed',
        failureCategory: 'network_error',
        occurredAt: '2026-04-23T11:58:00.000Z',
        source: 'brain_execution',
        roleId: 'selected_brain',
        sequenceNumber: 2,
      },
      {
        providerId: 'openrouter-api',
        modelId: 'openrouter/free',
        requestType: 'generate_text',
        status: 'completed',
        failureCategory: null,
        occurredAt: '2026-04-23T11:57:00.000Z',
        source: 'brain_execution',
        roleId: 'selected_brain',
        sequenceNumber: 1,
      },
      {
        providerId: 'gemini-api',
        modelId: 'gemini-flash-latest',
        requestType: 'generate_text',
        status: 'completed',
        failureCategory: null,
        occurredAt: '2026-04-23T11:59:30.000Z',
        source: 'brain_execution',
        roleId: 'fallback_brain',
        sequenceNumber: 4,
      },
    ],
  });

  const openRouterSnapshot = providerHealth.snapshots.find((snapshot) => {
    return snapshot.providerId === 'openrouter-api';
  });
  const geminiSnapshot = providerHealth.snapshots.find((snapshot) => {
    return snapshot.providerId === 'gemini-api';
  });

  assert.ok(openRouterSnapshot);
  assert.equal(openRouterSnapshot.healthStatus, 'unavailable');
  assert.equal(openRouterSnapshot.degraded, true);
  assert.equal(openRouterSnapshot.unavailable, true);
  assert.equal(openRouterSnapshot.consecutiveFailureCount, 2);
  assert.equal(openRouterSnapshot.lastFailureCategory, 'transient_unavailable');
  assert.equal(openRouterSnapshot.lastSuccessAt, '2026-04-23T11:57:00.000Z');
  assert.match(openRouterSnapshot.providerRoleImpactSummary, /Selected brain provider is currently unavailable/u);

  assert.ok(geminiSnapshot);
  assert.equal(geminiSnapshot.healthStatus, 'healthy');
  assert.equal(geminiSnapshot.degraded, false);
  assert.equal(geminiSnapshot.unavailable, false);
  assert.equal(geminiSnapshot.consecutiveFailureCount, 0);
  assert.match(geminiSnapshot.providerRoleImpactSummary, /Fallback brain provider is healthy/u);
});

test('extractProviderHealthEventsFromInvocationSession preserves provider ordering across classifier and follow-up activity', () => {
  const providerEvents = extractProviderHealthEventsFromInvocationSession({
    invocationId: 'invocation-ordering-1',
    startedAt: '2026-04-23T12:00:00.000Z',
    finishedAt: '2026-04-23T12:00:10.000Z',
    brainExecution: {
      attempts: [
        {
          brainRole: 'primary',
          passKind: 'initial_reasoning',
          providerId: 'openrouter-api',
          modelId: 'openrouter/free',
          status: 'completed',
          providerResponse: {
            requestType: 'generate_text',
            providerFailure: null,
          },
          brainOutput: {
            providerFailure: null,
          },
        },
        {
          brainRole: 'primary',
          passKind: 'tool_observation_followup',
          providerId: 'openrouter-api',
          modelId: 'openrouter/free',
          status: 'completed',
          providerResponse: {
            requestType: 'generate_text',
            providerFailure: null,
          },
          brainOutput: {
            providerFailure: null,
          },
        },
      ],
    },
    semanticIntentRuntime: {
      providerClassifierAudit: {
        requestType: 'classify_intent',
        providerRequest: {
          providerId: 'openrouter-api',
          modelId: 'openrouter/free',
        },
        attempts: [
          {
            attemptNumber: 1,
            status: 'failed',
            failureCategory: 'malformed_response',
          },
        ],
      },
    },
  });

  const providerHealth = buildProviderHealthSnapshotCollection({
    generatedAt: '2026-04-23T12:01:00.000Z',
    providerAssignments: [
      {
        providerId: 'openrouter-api',
        modelId: 'openrouter/free',
        roleId: 'selected_brain',
        readinessStatus: 'ready',
      },
      {
        providerId: 'openrouter-api',
        modelId: 'openrouter/free',
        roleId: 'semantic_classifier',
        readinessStatus: 'ready',
      },
    ],
    providerEvents,
    includedHistoricalSessionCount: 0,
    includedCurrentInvocation: true,
  });
  const openRouterSnapshot = providerHealth.snapshots[0];

  assert.equal(providerEvents.length, 3);
  assert.equal(openRouterSnapshot.providerId, 'openrouter-api');
  assert.equal(openRouterSnapshot.latestEventStatus, 'completed');
  assert.equal(openRouterSnapshot.healthStatus, 'healthy');
  assert.equal(openRouterSnapshot.consecutiveFailureCount, 0);
  assert.equal(openRouterSnapshot.observedAttemptCount, 3);
  assert.equal(openRouterSnapshot.observedRequestTypes.includes('classify_intent'), true);
});

test('runAgentInvocation persists history-aware provider health snapshots into session, output, and report', async () => {
  await withEnvironment(
    {
      "openrouter-api-key": 'openrouter-secret',
      "gemini-api-key": 'gemini-secret',
    },
    async () => {
      const projectRootPath = await createProjectFixture();

      const failingPrimaryFetch = async (url) => {
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
          ok: true,
          async json() {
            return {
              responseId: 'gemini-provider-health-response',
              candidates: [
                {
                  finishReason: 'STOP',
                  content: {
                    parts: [
                      {
                        text: 'Gemini handled the request while OpenRouter was unavailable.',
                      },
                    ],
                  },
                },
              ],
              usageMetadata: {
                promptTokenCount: 90,
                candidatesTokenCount: 14,
                totalTokenCount: 104,
              },
            };
          },
        };
      };

      const firstResult = await runAgentInvocation({
        projectRootPath,
        operationalIdentityId: 'alfred',
        invocationMode: 'probabilistic',
        command: 'ask',
        inputText: 'Run the first provider health test invocation.',
        requestedBy: 'cli',
        fetchImplementation: failingPrimaryFetch,
      });

      assert.equal(firstResult.status, 'completed');

      const secondResult = await runAgentInvocation({
        projectRootPath,
        operationalIdentityId: 'alfred',
        invocationMode: 'probabilistic',
        command: 'ask',
        inputText: 'Run the second provider health test invocation.',
        requestedBy: 'cli',
        fetchImplementation: failingPrimaryFetch,
      });

      assert.equal(secondResult.status, 'completed');
      assert.ok(secondResult.output.providerHealth);

      const openRouterSnapshot = secondResult.output.providerHealth.snapshots.find((snapshot) => {
        return snapshot.providerId === 'openrouter-api';
      });
      const geminiSnapshot = secondResult.output.providerHealth.snapshots.find((snapshot) => {
        return snapshot.providerId === 'gemini-api';
      });

      assert.ok(openRouterSnapshot);
      assert.equal(openRouterSnapshot.healthStatus, 'unavailable');
      assert.equal(openRouterSnapshot.consecutiveFailureCount, 2);
      assert.equal(openRouterSnapshot.providerRoleImpacts[0].roleId, 'selected_brain');

      assert.ok(geminiSnapshot);
      assert.equal(geminiSnapshot.healthStatus, 'healthy');
      assert.equal(geminiSnapshot.providerRoleImpacts[0].roleId, 'fallback_brain');

      const invocationSession = JSON.parse(await readFile(secondResult.persistence.invocationSessionRecordPath, 'utf8'));
      const invocationReport = await readFile(secondResult.persistence.invocationReportPath, 'utf8');

      assert.ok(invocationSession.providerHealth);
      assert.equal(invocationSession.providerHealth.snapshots.length >= 2, true);
      assert.equal(invocationSession.providerHealth.includedHistoricalSessionCount >= 1, true);
      assert.equal(invocationSession.providerHealth.includedCurrentInvocation, true);
      assert.match(invocationReport, /Provider Health Snapshot/u);
      assert.match(invocationReport, /### openrouter-api/u);
    },
  );
});
