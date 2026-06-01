#!/usr/bin/env node

import process from 'node:process';
import { readFile } from 'node:fs/promises';
import { runAgentInvocation } from '../../src/invocation/run-agent-invocation.js';
import {
  createLiveSmokeDiagnosticError,
  printRequiredSecretReferenceStatus,
  readLiveCredentialVault,
  runLiveSmokeMain,
} from './live-smoke-helpers.js';
import {
  createAlfredProbabilisticProjectFixture,
  createDurableMemoryRecord,
  writeDurableMemoryRecord,
} from '../helpers/create-alfred-probabilistic-fixture.js';

const LIVE_OPENROUTER_CREDENTIAL_REFERENCE_ID = 'providers.openrouter.shared.default.api_key';
const LIVE_GEMINI_CREDENTIAL_REFERENCE_ID = 'providers.gemini.shared.default.api_key';

async function readRequiredCredentialVaultSecrets() {
  const requiredSecretReferenceIds = [
    LIVE_OPENROUTER_CREDENTIAL_REFERENCE_ID,
    LIVE_GEMINI_CREDENTIAL_REFERENCE_ID,
  ];
  const credentials = await readLiveCredentialVault({
    requiredSecretReferenceIds,
  });

  printRequiredSecretReferenceStatus({
    credentials,
    requiredSecretReferenceIds,
  });

  return credentials;
}

function findContextPackLayer(invocationSession) {
  return invocationSession.promptProvenance?.includedLayers.find((layer) => {
    return layer.layerType === 'context_pack';
  }) ?? null;
}

function hasDurableMemoryProvenance(contextPackLayer) {
  return contextPackLayer?.sourceReferences.some((sourceReference) => {
    return (
      sourceReference.sourceType === 'durable_memory_record'
      && sourceReference.sourceId === 'mem_alfred_durable_context'
      && sourceReference.path === 'memory/durable/memory-record-mem_alfred_durable_context.json'
    );
  }) ?? false;
}

function printSafeResultSummary({
  result,
  invocationSession,
  contextPackLayer,
  projectRootPath,
}) {
  console.log('OpenMAS Alfred Live Durable Context Smoke Test');
  console.log('');
  console.log(`Status: ${result.status}`);
  console.log(`Provider: ${result.output?.providerId ?? 'n/a'}`);
  console.log(`Model: ${result.output?.modelId ?? 'n/a'}`);
  console.log(`Usage: input=${result.output?.usage?.inputTokens ?? 'n/a'} output=${result.output?.usage?.outputTokens ?? 'n/a'} total=${result.output?.usage?.totalTokens ?? 'n/a'}`);
  console.log(`Durable Context Provenance: ${hasDurableMemoryProvenance(contextPackLayer) ? 'present' : 'missing'}`);
  console.log(`Prompt Layer Count: ${invocationSession.promptProvenance?.includedLayerCount ?? 'n/a'}`);
  console.log(`Temporary MAS Fixture: ${projectRootPath}`);
  console.log('');

  if (result.output?.outputText) {
    console.log('Output Preview:');
    console.log(result.output.outputText.slice(0, 600));
    console.log('');
  }

  if (result.warnings.length > 0) {
    console.log('Warnings:');
    for (const warning of result.warnings) {
      console.log(`- ${warning}`);
    }
    console.log('');
  }

  if (result.errors.length > 0) {
    console.log('Errors:');
    for (const error of result.errors) {
      console.log(`- ${error}`);
    }
    console.log('');
  }
}

async function main() {
  const label = 'OpenMAS Alfred Live Durable Context Smoke Test';

  await runLiveSmokeMain(label, async () => {
    const credentialVaultSecrets = await readRequiredCredentialVaultSecrets();

    const projectRootPath = await createAlfredProbabilisticProjectFixture({
      credentialVaultSecrets: {
        'openrouter-api-key': credentialVaultSecrets[LIVE_OPENROUTER_CREDENTIAL_REFERENCE_ID],
        'gemini-api-key': credentialVaultSecrets[LIVE_GEMINI_CREDENTIAL_REFERENCE_ID],
      },
    });

    await writeDurableMemoryRecord({
      projectRootPath,
      memoryRecord: createDurableMemoryRecord(),
    });

    const result = await runAgentInvocation({
      projectRootPath,
      operationalIdentityId: 'alfred',
      invocationMode: 'probabilistic',
      command: 'ask',
      inputText: 'In one short sentence, identify yourself as Alfred and state which organization appears in your approved durable memory.',
      requestedBy: 'live-smoke-test',
    });

    if (!result.persistence?.invocationSessionRecordPath) {
      printSafeResultSummary({
        result,
        invocationSession: {},
        contextPackLayer: null,
        projectRootPath,
      });
      throw createLiveSmokeDiagnosticError({
        phase: 'agent_invocation_persistence',
        reasonCode: 'invocation_session_record_missing',
        message: 'Alfred live durable context smoke did not persist an invocation session record.',
        probableCause: result.message,
        nextStep: 'Inspect invocation persistence and fixture MAS memory paths.',
      });
    }

    const invocationSession = JSON.parse(await readFile(result.persistence.invocationSessionRecordPath, 'utf8'));
    const contextPackLayer = findContextPackLayer(invocationSession);

    printSafeResultSummary({
      result,
      invocationSession,
      contextPackLayer,
      projectRootPath,
    });

    if (result.status !== 'completed') {
      throw createLiveSmokeDiagnosticError({
        phase: 'agent_invocation',
        reasonCode: 'agent_invocation_not_completed',
        message: `Expected completed invocation, received ${result.status}.`,
        probableCause: result.message,
        nextStep: 'Check provider readiness and the fixture execution profile.',
        details: result.errors ?? [],
      });
    }

    if (!hasDurableMemoryProvenance(contextPackLayer)) {
      throw createLiveSmokeDiagnosticError({
        phase: 'memory_context_provenance',
        reasonCode: 'durable_memory_provenance_missing',
        message: 'Durable memory provenance was not present in the prompt context pack.',
        probableCause: 'The invocation completed, but the Context Pack did not carry the expected durable memory source reference.',
        nextStep: 'Inspect memory source registry, durable memory writer, and Context Pack builder.',
      });
    }

    process.exitCode = 0;
  });
}

await main();
