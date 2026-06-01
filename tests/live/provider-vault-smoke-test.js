#!/usr/bin/env node

import process from 'node:process';
import { executeProviderRequest } from '../../src/providers/execute-provider-request.js';
import {
  LIVE_CREDENTIAL_REFERENCE_IDS,
  assertProviderCompleted,
  createProviderDiagnosticError,
  printRequiredSecretReferenceStatus,
  readLiveCredentialVault,
  requireVaultSecret,
  runLiveSmokeMain,
} from './live-smoke-helpers.js';

function buildSecretResolution(credentialReferenceId, secretValue) {
  return {
    resolvedCredentialReferences: [
      {
        resourceId: 'live-provider-smoke-resource',
        credentialReferenceId,
        credentialType: 'api_key',
        resolutionStatus: 'resolved',
        reason: 'Runtime-only live smoke test secret.',
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
      [credentialReferenceId, secretValue],
    ]),
  };
}

function buildPreparedProvider({ providerId, modelId, credentialReferenceId }) {
  return {
    brainId: `${providerId}-live-smoke`,
    providerId,
    modelId,
    resourceId: providerId,
    credentialReferenceId,
    secretResolutionStatus: 'resolved',
    status: 'ready',
    reason: 'Live provider smoke test is ready.',
  };
}

async function runGeminiSmokeTest(credentials) {
  const credentialReferenceId = LIVE_CREDENTIAL_REFERENCE_IDS.geminiSharedDefault;
  const apiKey = requireVaultSecret(credentials, credentialReferenceId, 'Gemini');
  const modelId = 'gemini-flash-latest';

  return executeProviderRequest({
    preparedProvider: buildPreparedProvider({
      providerId: 'gemini-api',
      modelId,
      credentialReferenceId,
    }),
    providerRequest: {
      providerId: 'gemini-api',
      modelId,
      requestType: 'generate_text',
      messages: [
        {
          role: 'system',
          content: 'Answer clearly in one short sentence.',
        },
        {
          role: 'user',
          content: 'Say OpenMAS provider smoke passed.',
        },
      ],
      temperature: 0.2,
      maxOutputTokens: 80,
    },
    secretResolution: buildSecretResolution(credentialReferenceId, apiKey),
  });
}

function createGeminiSpec() {
  return {
    label: 'gemini-api',
    providerId: 'gemini-api',
    modelId: 'gemini-flash-latest',
    credentialReferenceId: LIVE_CREDENTIAL_REFERENCE_IDS.geminiSharedDefault,
    run: runGeminiSmokeTest,
  };
}

async function runOpenRouterSmokeTest(credentials) {
  const credentialReferenceId = LIVE_CREDENTIAL_REFERENCE_IDS.openRouterSharedDefault;
  const apiKey = requireVaultSecret(credentials, credentialReferenceId, 'OpenRouter');
  const modelId = 'openrouter/free';

  return executeProviderRequest({
    preparedProvider: buildPreparedProvider({
      providerId: 'openrouter-api',
      modelId,
      credentialReferenceId,
    }),
    providerRequest: {
      providerId: 'openrouter-api',
      modelId,
      requestType: 'generate_text',
      messages: [
        {
          role: 'system',
          content: 'Answer clearly in one short sentence.',
        },
        {
          role: 'user',
          content: 'Say hello from OpenMAS.',
        },
      ],
      temperature: 0.2,
      maxOutputTokens: 80,
    },
    secretResolution: buildSecretResolution(credentialReferenceId, apiKey),
  });
}

function createOpenRouterSpec() {
  return {
    label: 'openrouter-api',
    providerId: 'openrouter-api',
    modelId: 'openrouter/free',
    credentialReferenceId: LIVE_CREDENTIAL_REFERENCE_IDS.openRouterSharedDefault,
    run: runOpenRouterSmokeTest,
  };
}

async function runOllamaSmokeTest(credentials) {
  const credentialReferenceId = LIVE_CREDENTIAL_REFERENCE_IDS.ollamaSharedDefault;
  const apiKey = requireVaultSecret(credentials, credentialReferenceId, 'Ollama');

  const modelId = 'nemotron-3-super:cloud';

  return executeProviderRequest({
    preparedProvider: buildPreparedProvider({
      providerId: 'ollama-api',
      modelId,
      credentialReferenceId,
    }),
    providerRequest: {
      providerId: 'ollama-api',
      modelId,
      requestType: 'generate_text',
      messages: [
        {
          role: 'system',
          content: 'Answer clearly in one short English sentence.',
        },
        {
          role: 'user',
          content: 'Say OpenMAS Ollama smoke passed.',
        },
      ],
      temperature: 0.2,
      maxOutputTokens: 80,
    },
    secretResolution: buildSecretResolution(credentialReferenceId, apiKey),
  });
}

function createOllamaSpec() {
  return {
    label: 'ollama-api',
    providerId: 'ollama-api',
    modelId: 'nemotron-3-super:cloud',
    credentialReferenceId: LIVE_CREDENTIAL_REFERENCE_IDS.ollamaSharedDefault,
    run: runOllamaSmokeTest,
  };
}

function printProviderResult(spec, result) {
  const warnings = result.warnings ?? [];
  const outputText = result.outputText ?? '';

  console.log(`Provider: ${spec.label}`);
  console.log(`Credential Reference: ${spec.credentialReferenceId}`);
  console.log(`Status: ${result.status}`);
  console.log(`Model: ${result.modelId}`);

  if (result.status === 'completed') {
    console.log(`Output Preview: ${outputText ? outputText.slice(0, 220) : 'n/a'}`);
  }

  if (result.usage) {
    console.log(
      `Usage: input=${result.usage.inputTokens ?? 'n/a'} output=${result.usage.outputTokens ?? 'n/a'} total=${result.usage.totalTokens ?? 'n/a'}`,
    );
  }

  if (result.errorMessage) {
    console.log(`Error: ${result.errorMessage}`);
  }

  if (warnings.length > 0) {
    console.log(`Warnings: ${warnings.join(' | ')}`);
  }

  console.log('');
}

async function runProviderProbe(spec, credentials) {
  try {
    const result = await spec.run(credentials);

    printProviderResult(spec, result);
    assertProviderCompleted({
      providerId: spec.providerId,
      modelId: spec.modelId,
      credentialReferenceId: spec.credentialReferenceId,
      result,
    });

    return {
      providerId: spec.providerId,
      status: 'passed',
    };
  } catch (error) {
    const diagnosticError = error?.phase && error?.reasonCode
      ? error
      : createProviderDiagnosticError({
          providerId: spec.providerId,
          modelId: spec.modelId,
          credentialReferenceId: spec.credentialReferenceId,
          error,
        });

    console.log(`Provider: ${spec.label}`);
    console.log(`Credential Reference: ${spec.credentialReferenceId}`);
    console.log('Status: failed');
    console.log(`Failure Phase: ${diagnosticError.phase}`);
    console.log(`Reason Code: ${diagnosticError.reasonCode}`);
    console.log(`Probable Cause: ${diagnosticError.probableCause}`);
    console.log(`Next Step: ${diagnosticError.nextStep}`);
    console.log('');

    return {
      providerId: spec.providerId,
      status: 'failed',
      diagnosticError,
    };
  }
}

async function main() {
  const label = 'OpenMAS Live Provider Vault Smoke Test';

  await runLiveSmokeMain(label, async () => {
    console.log(label);
    console.log('');

    const specs = [
      createGeminiSpec(),
      createOpenRouterSpec(),
      createOllamaSpec(),
    ];
    const requiredSecretReferenceIds = specs.map((spec) => {
      return spec.credentialReferenceId;
    });
    const credentials = await readLiveCredentialVault({
      requiredSecretReferenceIds,
    });

    printRequiredSecretReferenceStatus({
      credentials,
      requiredSecretReferenceIds,
    });

    const probeResults = [];

    for (const spec of specs) {
      probeResults.push(await runProviderProbe(spec, credentials));
    }

    const failedResults = probeResults.filter((result) => {
      return result.status !== 'passed';
    });

    console.log('Provider Smoke Summary');
    console.log(`Passed: ${probeResults.length - failedResults.length}`);
    console.log(`Failed: ${failedResults.length}`);

    if (failedResults.length > 0) {
      process.exitCode = 1;
    }
  });
}

await main();
