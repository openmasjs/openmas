import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { generateMasterKey } from '../../src/credentials/generate-master-key.js';
import { writeCredentialVault } from '../../src/credentials/write-credential-vault.js';
import { runAgentInvocation } from '../../src/invocation/run-agent-invocation.js';
import {
  createAlfredProbabilisticProjectFixture as createProjectFixture,
  createDurableMemoryRecord,
  withEnvironment,
  writeDurableMemoryRecord,
} from '../helpers/create-alfred-probabilistic-fixture.js';

async function overwriteDevelopmentCredentialVault({ projectRootPath, credentials }) {
  const masterKeyHex = generateMasterKey();
  const credentialsRootPath = path.join(projectRootPath, 'config', 'credentials');

  await mkdir(credentialsRootPath, { recursive: true });
  await writeFile(path.join(credentialsRootPath, 'development.key'), masterKeyHex, 'utf8');
  await writeCredentialVault({
    projectRootPath,
    environment: 'development',
    credentials,
    masterKeyHex,
  });
}

test('runAgentInvocation lets Alfred answer a probabilistic ask through mocked OpenRouter', async () => {
  await withEnvironment(
    {
      "openrouter-api-key": 'openrouter-secret',
      "gemini-api-key": 'gemini-secret',
    },
    async () => {
      const projectRootPath = await createProjectFixture();
      let fetchCallCount = 0;

      const result = await runAgentInvocation({
        projectRootPath,
        operationalIdentityId: 'alfred',
        invocationMode: 'probabilistic',
        command: 'ask',
        inputText: 'What is your role inside this MAS?',
        requestedBy: 'cli',
        fetchImplementation: async (url, options) => {
          fetchCallCount += 1;
          assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions');
          assert.equal(options.headers.Authorization, 'Bearer openrouter-secret');

          const body = JSON.parse(options.body);
          assert.equal(body.model, 'openrouter/free');
          assert.equal(body.messages.length, 2);
          assert.match(body.messages[0].content, /System Steward/);
          assert.match(body.messages[1].content, /What is your role inside this MAS/);

          return {
            ok: true,
            async json() {
              return {
                id: 'openrouter-probabilistic-response-1',
                choices: [
                  {
                    finish_reason: 'stop',
                    message: {
                      content: 'I am Alfred, the System Steward operational identity for this MAS.',
                    },
                  },
                ],
                usage: {
                  prompt_tokens: 120,
                  completion_tokens: 16,
                  total_tokens: 136,
                },
              };
            },
          };
        },
      });

      assert.equal(fetchCallCount, 1);
      assert.equal(result.status, 'completed');
      assert.equal(result.output.executionType, 'probabilistic_brain');
      assert.equal(result.output.kind, 'brain_output');
      assert.equal(result.output.status, 'completed');
      assert.equal(result.output.providerId, 'openrouter-api');
      assert.equal(result.output.modelId, 'openrouter/free');
      assert.equal(result.output.requestType, 'generate_text');
      assert.equal(result.output.usage.inputTokens, 120);
      assert.equal(result.output.usage.outputTokens, 16);
      assert.equal(result.output.usage.totalTokens, 136);
      assert.match(result.output.outputText, /I am Alfred/);

      const invocationSession = JSON.parse(await readFile(result.persistence.invocationSessionRecordPath, 'utf8'));
      const invocationReport = await readFile(result.persistence.invocationReportPath, 'utf8');
      const serializedSession = JSON.stringify(invocationSession);

      assert.equal(invocationSession.executionType, 'probabilistic_brain');
      assert.equal(invocationSession.brainInputSummary.operationalIdentityId, 'alfred');
      assert.equal(invocationSession.providerRequestSummary.providerId, 'openrouter-api');
      assert.equal(invocationSession.instructionLayerSummary.kind, 'instruction_layer_summary');
      assert.equal(invocationSession.instructionLayerSummary.totalLayers, 7);
      assert.equal(invocationSession.brainExecution.attempts[0].instructionLayerSummary.totalLayers, 7);
      assert.equal(invocationSession.brainExecution.toolObservationFollowupPerformed, false);
      assert.equal(invocationSession.brainExecution.finalPassKind, 'initial_reasoning');
      assert.equal(invocationSession.promptProvenance.kind, 'prompt_provenance');
      assert.equal(invocationSession.promptProvenance.includedLayerCount, 7);
      assert.equal(invocationSession.promptProvenance.omittedLayerCount, 2);
      assert.equal(invocationSession.promptProvenance.includedLayers[2].sourceReferences[0].path, 'instance/cognitive-identities/system-steward/identity.md');
      assert.equal(invocationSession.promptProvenance.includedLayers.at(-1).layerType, 'context_pack');
      assert.equal(invocationSession.brainExecution.attempts[0].promptProvenance.includedLayerCount, 7);
      assert.equal(invocationSession.brainOutput.kind, 'brain_output');
      assert.equal(invocationSession.brainOutput.usage.totalTokens, 136);
      assert.equal(invocationSession.providerResponse.status, 'completed');
      assert.equal(invocationSession.providerResponse.kind, 'provider_response');
      assert.doesNotMatch(serializedSession, /openrouter-secret/);
      assert.doesNotMatch(serializedSession, /Be precise and audit-friendly/);
      assert.doesNotMatch(serializedSession, /Explain MAS structure and runtime status/);
      assert.match(invocationReport, /Probabilistic Brain Invocation Report/);
      assert.match(invocationReport, /Usage Accounting/);
      assert.match(invocationReport, /I am Alfred/);
    },
  );
});

test('runAgentInvocation resolves provider secrets from the development vault without provider-specific environment variables', async () => {
  await withEnvironment(
    {
      "openrouter-api-key": null,
      "gemini-api-key": null,
      OPENMAS_ENV: null,
      OPENMAS_MASTER_KEY: null,
    },
    async () => {
      const projectRootPath = await createProjectFixture();

      await overwriteDevelopmentCredentialVault({
        projectRootPath,
        credentials: {
          'openrouter-api-key': 'vault-only-openrouter-secret',
          'gemini-api-key': 'vault-only-gemini-secret',
        },
      });

      let fetchCallCount = 0;

      const result = await runAgentInvocation({
        projectRootPath,
        operationalIdentityId: 'alfred',
        invocationMode: 'probabilistic',
        command: 'ask',
        inputText: 'Can you answer from vault-only credentials?',
        requestedBy: 'cli',
        fetchImplementation: async (url, options) => {
          fetchCallCount += 1;
          assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions');
          assert.equal(options.headers.Authorization, 'Bearer vault-only-openrouter-secret');

          return {
            ok: true,
            async json() {
              return {
                id: 'openrouter-vault-only-response-1',
                choices: [
                  {
                    finish_reason: 'stop',
                    message: {
                      content: 'OpenRouter answered with a vault-only credential.',
                    },
                  },
                ],
                usage: {
                  prompt_tokens: 92,
                  completion_tokens: 11,
                  total_tokens: 103,
                },
              };
            },
          };
        },
      });

      assert.equal(fetchCallCount, 1);
      assert.equal(result.status, 'completed');
      assert.equal(result.output.providerId, 'openrouter-api');
      assert.equal(result.readiness.secretResolution.credentialVaultEnvironment, 'development');
      assert.equal(result.readiness.secretResolution.summary.resolved, 2);
      assert.equal(result.readiness.providerPreparation.selectedBrainProvider.status, 'ready');
      assert.equal(result.readiness.providerPreparation.fallbackBrainProvider.status, 'ready');

      const invocationSession = JSON.parse(await readFile(result.persistence.invocationSessionRecordPath, 'utf8'));
      const serializedSession = JSON.stringify(invocationSession);

      assert.equal(invocationSession.secretResolution.credentialVaultEnvironment, 'development');
      assert.equal(invocationSession.secretResolution.secretValueByReferenceId, undefined);
      assert.doesNotMatch(serializedSession, /vault-only-openrouter-secret/u);
      assert.doesNotMatch(serializedSession, /vault-only-gemini-secret/u);
      assert.doesNotMatch(serializedSession, /OPENMAS_/u);
    },
  );
});

test('runAgentInvocation does not silently apply legacy intent compatibility when semantic runtime is disabled', async () => {
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
        inputText: 'Please inspect the MAS for me.',
        requestedBy: 'cli',
        semanticIntentRuntimeMode: 'disabled',
        fetchImplementation: async () => {
          return {
            ok: true,
            async json() {
              return {
                id: 'openrouter-probabilistic-response-legacy-disabled',
                choices: [
                  {
                    finish_reason: 'stop',
                    message: {
                      content: 'I can help if you want me to inspect the MAS.',
                    },
                  },
                ],
                usage: {
                  prompt_tokens: 110,
                  completion_tokens: 14,
                  total_tokens: 124,
                },
              };
            },
          };
        },
      });

      assert.equal(result.status, 'completed');
      assert.doesNotMatch(result.warnings.join('\n'), /Legacy intent compatibility mode is enabled/u);

      const invocationSession = JSON.parse(await readFile(result.persistence.invocationSessionRecordPath, 'utf8'));

      assert.equal(invocationSession.semanticIntentRuntime.mode, 'disabled');
      assert.equal(invocationSession.intentResolution.status, 'skipped');
      assert.match(
        invocationSession.intentResolution.reason,
        /Legacy intent compatibility is disabled/u,
      );
      assert.equal(invocationSession.toolRequestResolution.status, 'no_request');
      assert.equal(invocationSession.brainToolExecution.executionPerformed, false);
    },
  );
});

test('runAgentInvocation applies legacy intent compatibility only when explicitly enabled', async () => {
  await withEnvironment(
    {
      "openrouter-api-key": 'openrouter-secret',
      "gemini-api-key": 'gemini-secret',
    },
    async () => {
      const projectRootPath = await createProjectFixture();
      let providerCallCount = 0;

      const result = await runAgentInvocation({
        projectRootPath,
        operationalIdentityId: 'alfred',
        invocationMode: 'probabilistic',
        command: 'ask',
        inputText: 'Please inspect the MAS for me.',
        requestedBy: 'cli',
        semanticIntentRuntimeMode: 'disabled',
        legacyIntentCompatibilityMode: 'compatibility',
        fetchImplementation: async () => {
          providerCallCount += 1;

          return {
            ok: true,
            async json() {
              return {
                id: `openrouter-probabilistic-response-legacy-enabled-${providerCallCount}`,
                choices: [
                  {
                    finish_reason: 'stop',
                    message: {
                      content: providerCallCount === 1
                        ? 'I will help with that request.'
                        : 'I completed the read-only MAS inspection and can summarize the findings.',
                    },
                  },
                ],
                usage: {
                  prompt_tokens: 110,
                  completion_tokens: 18,
                  total_tokens: 128,
                },
              };
            },
          };
        },
      });

      assert.equal(result.status, 'completed');
      assert.equal(providerCallCount >= 1, true);
      assert.match(result.warnings.join('\n'), /Legacy intent compatibility mode is enabled/u);

      const invocationSession = JSON.parse(await readFile(result.persistence.invocationSessionRecordPath, 'utf8'));

      assert.equal(invocationSession.semanticIntentRuntime.mode, 'disabled');
      assert.equal(invocationSession.intentResolution.status, 'blocked');
      assert.equal(invocationSession.intentResolution.source, 'runtime_pattern');
      assert.equal(invocationSession.intentResolution.target.targetId, 'mas.system.inspect');
      assert.equal(invocationSession.toolRequestResolution.status, 'no_request');
      assert.equal(invocationSession.brainToolExecution.executionPerformed, false);
      assert.match(invocationSession.intentResolution.reason, /was not executable/u);
    },
  );
});

test('runAgentInvocation carries approved durable memory into Alfred probabilistic prompt and provenance', async () => {
  await withEnvironment(
    {
      "openrouter-api-key": 'openrouter-secret',
      "gemini-api-key": 'gemini-secret',
    },
    async () => {
      const projectRootPath = await createProjectFixture();
      const durableMemoryRecord = createDurableMemoryRecord();
      let providerSystemMessage = null;
      let providerRequestBody = null;

      await writeDurableMemoryRecord({
        projectRootPath,
        memoryRecord: durableMemoryRecord,
      });

      const result = await runAgentInvocation({
        projectRootPath,
        operationalIdentityId: 'alfred',
        invocationMode: 'probabilistic',
        command: 'ask',
        inputText: 'What organization are you helping administer?',
        requestedBy: 'cli',
        fetchImplementation: async (url, options) => {
          assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions');
          assert.equal(options.headers.Authorization, 'Bearer openrouter-secret');

          providerRequestBody = JSON.parse(options.body);
          providerSystemMessage = providerRequestBody.messages[0].content;

          assert.match(providerSystemMessage, /Context Pack/);
          assert.match(providerSystemMessage, /Domain Knowledge/);
          assert.match(providerSystemMessage, /ALFRED_DURABLE_MEMORY_ALLOWED/);
          assert.match(providerSystemMessage, /memory\/durable\/memory-record-mem_alfred_durable_context\.json/);
          assert.doesNotMatch(providerSystemMessage, /"kind":\s*"memory_record"/);

          return {
            ok: true,
            async json() {
              return {
                id: 'openrouter-durable-context-response-1',
                choices: [
                  {
                    finish_reason: 'stop',
                    message: {
                      content: 'I am Alfred, and I help administer the Sin Cuchillo MAS using approved durable memory as supporting context.',
                    },
                  },
                ],
                usage: {
                  prompt_tokens: 160,
                  completion_tokens: 22,
                  total_tokens: 182,
                },
              };
            },
          };
        },
      });

      assert.equal(result.status, 'completed');
      assert.equal(result.output.providerId, 'openrouter-api');
      assert.match(result.output.outputText, /Sin Cuchillo MAS/);
      assert.equal(providerRequestBody.model, 'openrouter/free');

      const invocationSession = JSON.parse(await readFile(result.persistence.invocationSessionRecordPath, 'utf8'));
      const invocationReport = await readFile(result.persistence.invocationReportPath, 'utf8');
      const contextPackLayer = invocationSession.promptProvenance.includedLayers.find((layer) => {
        return layer.layerType === 'context_pack';
      });
      const serializedSession = JSON.stringify(invocationSession);

      assert.ok(contextPackLayer);
      assert.equal(contextPackLayer.sourceReferences.some((sourceReference) => {
        return (
          sourceReference.sourceType === 'durable_memory_record'
          && sourceReference.sourceId === 'mem_alfred_durable_context'
          && sourceReference.path === 'memory/durable/memory-record-mem_alfred_durable_context.json'
        );
      }), true);
      assert.match(contextPackLayer.summary, /Durable memory provenance: 1 included, 0 omitted, 0 rejected durable source references\./);
      assert.match(contextPackLayer.contentSha256, /^[a-f0-9]{64}$/u);
      assert.equal(contextPackLayer.content, undefined);
      assert.doesNotMatch(serializedSession, /ALFRED_DURABLE_MEMORY_ALLOWED/);
      assert.doesNotMatch(serializedSession, /openrouter-secret/);
      assert.match(invocationReport, /Probabilistic Brain Invocation Report/);
      assert.match(invocationReport, /Sin Cuchillo MAS/);
    },
  );
});

test('runAgentInvocation keeps Alfred deterministic commands working in hybrid mode', async () => {
  const projectRootPath = await createProjectFixture();

  const result = await runAgentInvocation({
    projectRootPath,
    operationalIdentityId: 'alfred',
    command: 'hello',
    requestedBy: 'cli',
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.request.invocationMode, 'deterministic');
  assert.equal(result.output.executionType, undefined);

  const invocationSession = JSON.parse(await readFile(result.persistence.invocationSessionRecordPath, 'utf8'));

  assert.equal(invocationSession.executionType, 'deterministic_command');
  assert.equal(invocationSession.executionMode, 'hybrid');
  assert.equal(invocationSession.brainRequired, false);
  assert.equal(invocationSession.promptProvenance, null);
});

test('runAgentInvocation keeps deterministic commands working without provider vault secrets', async () => {
  await withEnvironment(
    {
      "openrouter-api-key": null,
      "gemini-api-key": null,
      OPENMAS_ENV: null,
      OPENMAS_MASTER_KEY: null,
    },
    async () => {
      const projectRootPath = await createProjectFixture();

      const result = await runAgentInvocation({
        projectRootPath,
        operationalIdentityId: 'alfred',
        command: 'hello',
        requestedBy: 'cli',
      });

      assert.equal(result.status, 'completed');
      assert.equal(result.request.invocationMode, 'deterministic');
      assert.equal(result.readiness.providerPreparation.selectedBrainProvider.status, 'not_ready');
      assert.equal(result.readiness.providerPreparation.fallbackBrainProvider.status, 'not_ready');
      assert.equal(result.readiness.secretResolution.summary.unresolved, 2);

      const invocationSession = JSON.parse(await readFile(result.persistence.invocationSessionRecordPath, 'utf8'));

      assert.equal(invocationSession.executionType, 'deterministic_command');
      assert.equal(invocationSession.brainRequired, false);
      assert.equal(invocationSession.secretResolution.summary.unresolved, 2);
    },
  );
});

test('runAgentInvocation falls back when the selected provider is not ready', async () => {
  await withEnvironment(
    {
      "openrouter-api-key": null,
      "gemini-api-key": 'gemini-secret',
    },
    async () => {
      const projectRootPath = await createProjectFixture();
      let openRouterCalled = false;
      let geminiCalled = false;

      const result = await runAgentInvocation({
        projectRootPath,
        operationalIdentityId: 'alfred',
        invocationMode: 'probabilistic',
        command: 'ask',
        inputText: 'Can you answer?',
        requestedBy: 'cli',
        fetchImplementation: async (url) => {
          if (url.includes('openrouter.ai')) {
            openRouterCalled = true;
            throw new Error('OpenRouter must not be called when its secret is unresolved.');
          }

          geminiCalled = true;

          return {
            ok: true,
            async json() {
              return {
                responseId: 'gemini-fallback-response-1',
                candidates: [
                  {
                    finishReason: 'STOP',
                    content: {
                      parts: [
                        {
                          text: 'Gemini fallback answered because OpenRouter was not ready.',
                        },
                      ],
                    },
                  },
                ],
                usageMetadata: {
                  promptTokenCount: 80,
                  candidatesTokenCount: 10,
                  totalTokenCount: 90,
                },
              };
            },
          };
        },
      });

      assert.equal(openRouterCalled, false);
      assert.equal(geminiCalled, true);
      assert.equal(result.status, 'completed');
      assert.match(result.message, /after fallback from openrouter-api/);
      assert.equal(result.readiness.providerPreparation.selectedBrainProvider.status, 'not_ready');
      assert.equal(result.readiness.providerPreparation.fallbackBrainProvider.status, 'ready');
      assert.equal(result.output.providerId, 'gemini-api');
      assert.equal(result.output.modelId, 'gemini-flash-latest');
      assert.match(result.output.outputText, /Gemini fallback answered/);
      assert.equal(result.output.fallbackDecisionTrace.status, 'fallback_succeeded');
      assert.equal(result.output.fallbackDecisionTrace.primaryProviderStatus, 'not_ready');
      assert.equal(result.output.fallbackDecisionTrace.fallbackProviderStatus, 'completed');

      const invocationSession = JSON.parse(await readFile(result.persistence.invocationSessionRecordPath, 'utf8'));

      assert.equal(invocationSession.brainExecution.fallbackAttempted, true);
      assert.equal(invocationSession.brainExecution.fallbackUsed, true);
      assert.equal(invocationSession.brainExecution.fallbackSucceeded, true);
      assert.equal(invocationSession.brainExecution.finalBrainRole, 'fallback');
      assert.equal(invocationSession.brainExecution.attempts[0].status, 'not_ready');
      assert.equal(invocationSession.brainExecution.attempts[1].status, 'completed');
      assert.equal(invocationSession.fallbackDecisionTrace.status, 'fallback_succeeded');
      assert.equal(invocationSession.fallbackDecisionTrace.primaryProviderId, 'openrouter-api');
      assert.equal(invocationSession.fallbackDecisionTrace.primaryProviderStatus, 'not_ready');
      assert.equal(invocationSession.fallbackDecisionTrace.fallbackProviderId, 'gemini-api');
      assert.equal(invocationSession.fallbackDecisionTrace.fallbackProviderStatus, 'completed');
      assert.equal(invocationSession.instructionLayerSummary.totalLayers, 7);
      assert.equal(invocationSession.brainExecution.attempts[0].instructionLayerSummary, null);
      assert.equal(invocationSession.brainExecution.attempts[1].instructionLayerSummary.totalLayers, 7);
      assert.equal(invocationSession.promptProvenance.includedLayerCount, 7);
      assert.equal(invocationSession.brainExecution.attempts[0].promptProvenance, null);
      assert.equal(invocationSession.brainExecution.attempts[1].promptProvenance.includedLayerCount, 7);
    },
  );
});

test('runAgentInvocation blocks probabilistic mode when selected and fallback provider secrets are missing', async () => {
  await withEnvironment(
    {
      "openrouter-api-key": null,
      "gemini-api-key": null,
      OPENMAS_ENV: null,
      OPENMAS_MASTER_KEY: null,
    },
    async () => {
      const projectRootPath = await createProjectFixture();
      let providerCallCount = 0;

      const result = await runAgentInvocation({
        projectRootPath,
        operationalIdentityId: 'alfred',
        invocationMode: 'probabilistic',
        command: 'ask',
        inputText: 'Can you answer without configured provider secrets?',
        requestedBy: 'cli',
        fetchImplementation: async () => {
          providerCallCount += 1;
          throw new Error('Provider must not be called when provider secrets are unresolved.');
        },
      });

      assert.equal(providerCallCount, 0);
      assert.equal(result.status, 'blocked');
      assert.match(result.message, /Secret Reference openrouter-api-key is not resolved/u);
      assert.equal(result.persistence, null);
      assert.equal(result.readiness.secretResolution.credentialVaultEnvironment, 'development');
      assert.equal(result.readiness.secretResolution.summary.resolved, 0);
      assert.equal(result.readiness.secretResolution.summary.unresolved, 2);
      assert.equal(result.readiness.providerPreparation.selectedBrainProvider.status, 'not_ready');
      assert.equal(result.readiness.providerPreparation.fallbackBrainProvider.status, 'not_ready');
      assert.equal(result.readiness.providerPreparation.selectedBrainProvider.secretResolutionStatus, 'unresolved');
      assert.equal(result.readiness.providerPreparation.fallbackBrainProvider.secretResolutionStatus, 'unresolved');
    },
  );
});

test('runAgentInvocation rejects direct cognitive probabilistic operation without an Operational Identity', async () => {
  const projectRootPath = await createProjectFixture();

  await assert.rejects(
    () => runAgentInvocation({
      projectRootPath,
      agentId: 'system-steward',
      invocationMode: 'probabilistic',
      command: 'ask',
      inputText: 'Can you answer without an operational identity?',
      requestedBy: 'cli',
    }),
    /operationalIdentityId/u,
  );
});

test('runAgentInvocation falls back when the primary provider response fails', async () => {
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
        inputText: 'Please answer through fallback when the primary provider fails.',
        requestedBy: 'cli',
        fetchImplementation: async (url) => {
          if (url.includes('openrouter.ai')) {
            return {
              ok: false,
              status: 500,
              async text() {
                return 'OpenRouter unavailable.';
              },
            };
          }

          return {
            ok: true,
            async json() {
              return {
                responseId: 'gemini-fallback-response-2',
                candidates: [
                  {
                    finishReason: 'STOP',
                    content: {
                      parts: [
                        {
                          text: 'Gemini successfully handled the fallback request.',
                        },
                      ],
                    },
                  },
                ],
                usageMetadata: {
                  promptTokenCount: 90,
                  candidatesTokenCount: 12,
                  totalTokenCount: 102,
                },
              };
            },
          };
        },
      });

      assert.equal(result.status, 'completed');
      assert.match(result.message, /after fallback from openrouter-api/);
      assert.ok(result.persistence);
      assert.equal(result.output.providerResponseStatus, 'completed');
      assert.equal(result.output.kind, 'brain_output');
      assert.equal(result.output.status, 'completed');
      assert.equal(result.output.providerId, 'gemini-api');
      assert.match(result.output.outputText, /Gemini successfully handled/);
      assert.equal(result.output.fallbackDecisionTrace.status, 'fallback_succeeded');
      assert.equal(result.output.fallbackDecisionTrace.primaryFailureCategory, 'transient_unavailable');

      const invocationSession = JSON.parse(await readFile(result.persistence.invocationSessionRecordPath, 'utf8'));
      const invocationReport = await readFile(result.persistence.invocationReportPath, 'utf8');

      assert.equal(invocationSession.providerResponse.status, 'completed');
      assert.equal(invocationSession.brainOutput.status, 'completed');
      assert.equal(invocationSession.brainOutput.providerId, 'gemini-api');
      assert.equal(invocationSession.brainExecution.fallbackAttempted, true);
      assert.equal(invocationSession.brainExecution.fallbackUsed, true);
      assert.equal(invocationSession.brainExecution.fallbackSucceeded, true);
      assert.equal(invocationSession.brainExecution.attempts[0].providerResponse.status, 'failed');
      assert.equal(invocationSession.brainExecution.attempts[0].brainOutput.errorCode, 'http_500');
      assert.equal(invocationSession.brainExecution.attempts[1].providerResponse.status, 'completed');
      assert.equal(invocationSession.fallbackDecisionTrace.status, 'fallback_succeeded');
      assert.equal(invocationSession.fallbackDecisionTrace.primaryProviderId, 'openrouter-api');
      assert.equal(invocationSession.fallbackDecisionTrace.primaryFailureCategory, 'transient_unavailable');
      assert.equal(invocationSession.fallbackDecisionTrace.fallbackProviderId, 'gemini-api');
      assert.equal(invocationSession.fallbackDecisionTrace.fallbackSucceeded, true);
      assert.doesNotMatch(JSON.stringify(invocationSession), /openrouter-secret/);
      assert.match(invocationReport, /Fallback Used: yes/);
      assert.match(invocationReport, /## Fallback Decision Trace/);
      assert.match(invocationReport, /Status: fallback_succeeded/);
      assert.match(invocationReport, /Gemini successfully handled/);
    },
  );
});

test('runAgentInvocation retries a retryable primary provider failure before fallback when policy allows it', async () => {
  await withEnvironment(
    {
      "openrouter-api-key": 'openrouter-secret',
      "gemini-api-key": 'gemini-secret',
    },
    async () => {
      const projectRootPath = await createProjectFixture();
      let openRouterCallCount = 0;
      let geminiCallCount = 0;

      const result = await runAgentInvocation({
        projectRootPath,
        operationalIdentityId: 'alfred',
        invocationMode: 'probabilistic',
        command: 'ask',
        inputText: 'Please recover through primary-provider retry before using fallback.',
        requestedBy: 'cli',
        providerRetryPolicy: {
          kind: 'provider_retry_policy',
          version: 1,
          maxAttempts: 2,
          retryableFailureCategories: [
            'transient_unavailable',
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

            if (openRouterCallCount === 1) {
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
                  id: 'openrouter-retry-success-1',
                  choices: [
                    {
                      finish_reason: 'stop',
                      message: {
                        content: 'OpenRouter recovered on retry and answered without fallback.',
                      },
                    },
                  ],
                  usage: {
                    prompt_tokens: 98,
                    completion_tokens: 15,
                    total_tokens: 113,
                  },
                };
              },
            };
          }

          geminiCallCount += 1;

          return {
            ok: true,
            async json() {
              return {
                responseId: 'gemini-should-not-run',
                candidates: [
                  {
                    finishReason: 'STOP',
                    content: {
                      parts: [
                        {
                          text: 'Gemini should not have been used.',
                        },
                      ],
                    },
                  },
                ],
                usageMetadata: {
                  promptTokenCount: 10,
                  candidatesTokenCount: 4,
                  totalTokenCount: 14,
                },
              };
            },
          };
        },
      });

      assert.equal(result.status, 'completed');
      assert.equal(openRouterCallCount, 2);
      assert.equal(geminiCallCount, 0);
      assert.equal(result.output.providerId, 'openrouter-api');
      assert.match(result.output.outputText, /recovered on retry/u);

      const invocationSession = JSON.parse(await readFile(result.persistence.invocationSessionRecordPath, 'utf8'));

      assert.equal(invocationSession.brainExecution.fallbackAttempted, false);
      assert.equal(invocationSession.fallbackDecisionTrace.status, 'skipped_primary_completed');
      assert.equal(invocationSession.fallbackDecisionTrace.primaryProviderStatus, 'completed');
      assert.equal(invocationSession.fallbackDecisionTrace.fallbackConfigured, true);
      assert.equal(invocationSession.fallbackDecisionTrace.fallbackReady, true);
      assert.equal(invocationSession.brainExecution.attempts[0].providerRetryExecution.totalAttempts, 2);
      assert.equal(invocationSession.brainExecution.attempts[0].providerRetryExecution.attempts[0].retryDecision.shouldRetry, true);
      assert.equal(invocationSession.brainExecution.attempts[0].providerRetryExecution.stoppedReason, 'completed');
    },
  );
});

test('runAgentInvocation persists a failed result when primary and fallback providers fail', async () => {
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
        inputText: 'Please fail both configured providers.',
        requestedBy: 'cli',
        fetchImplementation: async (url) => {
          const providerLabel = url.includes('openrouter.ai') ? 'OpenRouter' : 'Gemini';

          return {
            ok: false,
            status: 503,
            async text() {
              return `${providerLabel} unavailable.`;
            },
          };
        },
      });

      assert.equal(result.status, 'failed');
      assert.match(result.message, /primary provider openrouter-api and fallback provider gemini-api both failed/);
      assert.equal(result.output.providerId, 'gemini-api');
      assert.equal(result.output.status, 'failed');
      assert.equal(result.output.errorCode, 'http_503');
      assert.equal(result.output.fallbackDecisionTrace.status, 'fallback_failed');
      assert.equal(result.output.fallbackDecisionTrace.primaryFailureCategory, 'transient_unavailable');
      assert.equal(result.output.fallbackDecisionTrace.fallbackFailureCategory, 'transient_unavailable');

      const invocationSession = JSON.parse(await readFile(result.persistence.invocationSessionRecordPath, 'utf8'));

      assert.equal(invocationSession.brainExecution.fallbackAttempted, true);
      assert.equal(invocationSession.brainExecution.fallbackUsed, true);
      assert.equal(invocationSession.brainExecution.fallbackSucceeded, false);
      assert.equal(invocationSession.brainExecution.finalBrainRole, 'fallback');
      assert.equal(invocationSession.brainExecution.attempts[0].status, 'failed');
      assert.equal(invocationSession.brainExecution.attempts[1].status, 'failed');
      assert.equal(invocationSession.fallbackDecisionTrace.status, 'fallback_failed');
      assert.equal(invocationSession.fallbackDecisionTrace.primaryProviderId, 'openrouter-api');
      assert.equal(invocationSession.fallbackDecisionTrace.fallbackProviderId, 'gemini-api');
      assert.equal(invocationSession.fallbackDecisionTrace.fallbackAttempted, true);
      assert.doesNotMatch(JSON.stringify(invocationSession), /openrouter-secret/);
      assert.doesNotMatch(JSON.stringify(invocationSession), /gemini-secret/);
    },
  );
});

test('runAgentInvocation records skipped fallback when the fallback provider is configured but not ready', async () => {
  await withEnvironment(
    {
      "openrouter-api-key": 'openrouter-secret',
      "gemini-api-key": null,
    },
    async () => {
      const projectRootPath = await createProjectFixture();
      let geminiCalled = false;

      const result = await runAgentInvocation({
        projectRootPath,
        operationalIdentityId: 'alfred',
        invocationMode: 'probabilistic',
        command: 'ask',
        inputText: 'Please show the not-ready fallback path.',
        requestedBy: 'cli',
        fetchImplementation: async (url) => {
          if (!url.includes('openrouter.ai')) {
            geminiCalled = true;
            throw new Error('Gemini must not be called when its secret is unresolved.');
          }

          return {
            ok: false,
            status: 503,
            async text() {
              return 'OpenRouter unavailable.';
            },
          };
        },
      });

      assert.equal(geminiCalled, false);
      assert.equal(result.status, 'failed');
      assert.match(result.message, /fallback provider gemini-api was not ready/u);
      assert.equal(result.output.providerId, 'openrouter-api');
      assert.equal(result.output.fallbackDecisionTrace.status, 'skipped_fallback_not_ready');
      assert.equal(result.output.fallbackDecisionTrace.fallbackConfigured, true);
      assert.equal(result.output.fallbackDecisionTrace.fallbackReady, false);
      assert.equal(result.output.fallbackDecisionTrace.fallbackProviderStatus, 'not_ready');

      const invocationSession = JSON.parse(await readFile(result.persistence.invocationSessionRecordPath, 'utf8'));

      assert.equal(invocationSession.brainExecution.fallbackAttempted, true);
      assert.equal(invocationSession.fallbackDecisionTrace.status, 'skipped_fallback_not_ready');
      assert.equal(invocationSession.fallbackDecisionTrace.primaryProviderId, 'openrouter-api');
      assert.equal(invocationSession.fallbackDecisionTrace.fallbackProviderId, 'gemini-api');
      assert.equal(invocationSession.fallbackDecisionTrace.fallbackProviderStatus, 'not_ready');
    },
  );
});

test('runAgentInvocation blocks probabilistic mode when the profile is deterministic-only', async () => {
  const projectRootPath = await createProjectFixture({
    executionMode: 'deterministic',
  });

  const result = await runAgentInvocation({
    projectRootPath,
    operationalIdentityId: 'alfred',
    invocationMode: 'probabilistic',
    command: 'ask',
    inputText: 'Can deterministic-only Alfred answer probabilistically?',
    requestedBy: 'cli',
  });

  assert.equal(result.status, 'blocked');
  assert.match(result.message, /does not support probabilistic invocation/);
});
