import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { writeInvocationArtifacts } from '../../src/invocation/write-invocation-artifacts.js';

const FULL_DIAGNOSTIC_MARKER = 'FULL_DIAGNOSTIC_ATTEMPT_DETAIL_MARKER';

function buildPromptProvenance({ includeFullDiagnosticMarker = false } = {}) {
  const sourceReferences = includeFullDiagnosticMarker
    ? Array.from({ length: 25 }, (_, index) => {
      return {
        sourceType: 'memory_record',
        sourceId: `source-${index}`,
        path: `memory/durable/${FULL_DIAGNOSTIC_MARKER}-${index}.json`,
      };
    })
    : [
      {
        sourceType: 'identity_document',
        sourceId: 'system-steward',
        path: 'instance/cognitive-identities/system-steward/identity.md',
      },
    ];

  return {
    kind: 'prompt_provenance',
    version: 1,
    promptFactoryVersion: 'prompt-factory-v1',
    promptProfileId: 'default-layered-prompt-profile-v1',
    promptStackVersionId: 'prompt-stack-v1',
    assemblyStatus: 'assembled',
    providerId: 'openrouter-api',
    modelId: 'openrouter/free',
    requestType: 'generate_text',
    assembly: {
      systemInstructionsLength: 1000,
      userInputLength: 64,
      messageCount: 2,
    },
    includedLayerCount: 1,
    omittedLayerCount: 0,
    includedLayers: [
      {
        layerId: 'context-pack',
        layerType: 'context_pack',
        owner: 'context_factory',
        priority: 700,
        sourceReferences,
        contentLength: 4096,
        contentSha256: 'a'.repeat(64),
        summary: 'Context pack layer summary.',
        warnings: [],
      },
    ],
    omittedLayers: [],
    warnings: [],
  };
}

function buildInstructionLayerSummary() {
  return {
    kind: 'instruction_layer_summary',
    version: 1,
    totalLayers: 1,
    totalContentLength: 4096,
    layers: [
      {
        layerId: 'context-pack',
        layerType: 'context_pack',
        owner: 'context_factory',
        priority: 700,
        sourceReferenceCount: 25,
        contentLength: 4096,
        summary: 'Context pack layer summary.',
        warningCount: 0,
      },
    ],
    warnings: [],
  };
}

function buildBrainOutput({ outputText }) {
  return {
    kind: 'brain_output',
    version: 1,
    providerId: 'openrouter-api',
    modelId: 'openrouter/free',
    requestType: 'generate_text',
    status: 'completed',
    providerResponseStatus: 'completed',
    providerResponseId: 'provider-response-compact-001',
    outputText,
    finishReason: 'stop',
    usage: {
      inputTokens: 100,
      outputTokens: 20,
      totalTokens: 120,
    },
    warnings: [],
    errorCode: null,
    errorMessage: null,
  };
}

function buildProviderResponse({ outputText }) {
  return {
    kind: 'provider_response',
    version: 1,
    providerId: 'openrouter-api',
    modelId: 'openrouter/free',
    requestType: 'generate_text',
    status: 'completed',
    outputText,
    finishReason: 'stop',
    providerResponseId: 'provider-response-compact-001',
    usage: {
      inputTokens: 100,
      outputTokens: 20,
      totalTokens: 120,
    },
    warnings: [],
    errorCode: null,
    errorMessage: null,
  };
}

function buildProbabilisticInvocationSession() {
  const largeAttemptOutput = `${'Attempt output preview. '.repeat(30)}${FULL_DIAGNOSTIC_MARKER}`;

  return {
    kind: 'agent_invocation_session',
    invocationId: 'compaction-test',
    primaryCognitiveIdentityId: 'system-steward',
    operationalIdentityId: 'alfred',
    executionType: 'probabilistic_brain',
    brainExecution: {
      kind: 'brain_execution',
      version: 1,
      fallbackAttempted: false,
      fallbackUsed: false,
      fallbackSucceeded: false,
      finalBrainRole: 'primary',
      finalPassKind: 'initial_reasoning',
      finalProviderId: 'openrouter-api',
      finalModelId: 'openrouter/free',
      toolObservationFollowupPerformed: false,
      workflowObservationFollowupPerformed: false,
      attempts: [
        {
          kind: 'brain_execution_attempt',
          version: 1,
          brainRole: 'primary',
          passKind: 'initial_reasoning',
          brainId: 'alfred-primary-brain',
          providerId: 'openrouter-api',
          modelId: 'openrouter/free',
          providerPreparationStatus: 'ready',
          secretReferenceId: 'openrouter-api-key',
          status: 'completed',
          reason: 'Brain provider completed successfully.',
          brainInputSummary: {
            operationalIdentityId: 'alfred',
          },
          providerRequestSummary: {
            providerId: 'openrouter-api',
            modelId: 'openrouter/free',
            messageCount: 2,
          },
          instructionLayerSummary: buildInstructionLayerSummary(),
          promptProfileSelection: null,
          promptBudgetReport: null,
          promptProvenance: buildPromptProvenance({
            includeFullDiagnosticMarker: true,
          }),
          brainOutput: buildBrainOutput({
            outputText: largeAttemptOutput,
          }),
          providerResponse: buildProviderResponse({
            outputText: largeAttemptOutput,
          }),
          toolRequestResolution: null,
          workflowRequestResolution: null,
          humanApprovalRuntime: null,
        },
      ],
    },
    brainInputSummary: {
      operationalIdentityId: 'alfred',
    },
    providerRequestSummary: {
      providerId: 'openrouter-api',
      modelId: 'openrouter/free',
      messageCount: 2,
    },
    instructionLayerSummary: buildInstructionLayerSummary(),
    promptProfileSelection: null,
    promptBudgetReport: null,
    promptProvenance: buildPromptProvenance(),
    brainOutput: buildBrainOutput({
      outputText: 'Compact final answer.',
    }),
    providerResponse: buildProviderResponse({
      outputText: largeAttemptOutput,
    }),
    output: {
      ...buildBrainOutput({
        outputText: largeAttemptOutput,
      }),
      executionType: 'probabilistic_brain',
      intentResolution: null,
      toolRequestResolution: null,
      brainToolExecution: null,
      workflowRequestResolution: null,
      brainWorkflowExecution: null,
    },
    request: {
      operationalIdentityId: 'alfred',
      invocationMode: 'probabilistic',
      command: 'ask',
      requestedBy: 'test-suite',
    },
    message: 'Alfred answered through openrouter-api.',
    startedAt: '2026-04-22T00:00:00.000Z',
    finishedAt: '2026-04-22T00:00:01.000Z',
  };
}

test('writeInvocationArtifacts compacts probabilistic invocation sessions and preserves full diagnostics separately', async () => {
  const temporaryRootPath = await mkdtemp(path.join(os.tmpdir(), 'openmas-invocation-compaction-'));
  const masRootPath = path.join(temporaryRootPath, 'instance');
  const request = {
    operationalIdentityId: 'alfred',
    invocationMode: 'probabilistic',
    command: 'ask',
    requestedBy: 'test-suite',
  };

  const persistence = await writeInvocationArtifacts({
    masRootPath,
    invocationId: 'compaction-test',
    invocationSession: buildProbabilisticInvocationSession(),
    request,
    reportKind: 'probabilistic_brain_invocation_report',
    reportContent: '# Probabilistic Brain Invocation Report\n\nCompact final answer.\n',
  });

  const persistedSession = JSON.parse(await readFile(persistence.invocationSessionRecordPath, 'utf8'));
  const diagnosticsArtifact = JSON.parse(await readFile(persistence.invocationDiagnosticsPath, 'utf8'));
  const persistedSessionSize = (await stat(persistence.invocationSessionRecordPath)).size;
  const diagnosticsArtifactSize = (await stat(persistence.invocationDiagnosticsPath)).size;
  const serializedPersistedSession = JSON.stringify(persistedSession);
  const serializedDiagnosticsArtifact = JSON.stringify(diagnosticsArtifact);

  assert.equal(persistedSession.invocationSessionCompaction.status, 'applied');
  assert.equal(persistedSession.invocationSessionCompaction.diagnosticsArtifactPath, 'memory/internal/invocation-diagnostics/agent-invocation-diagnostics-compaction-test.json');
  assert.equal(persistedSession.brainExecution.compaction.diagnosticsArtifactPath, persistedSession.invocationSessionCompaction.diagnosticsArtifactPath);
  assert.equal(persistedSession.brainExecution.attempts[0].promptProvenance.includedLayerCount, 1);
  assert.equal(persistedSession.brainExecution.attempts[0].promptProvenance.includedLayers[0].sourceReferenceCount, 25);
  assert.equal(persistedSession.brainExecution.attempts[0].promptProvenance.includedLayers[0].sourceReferences, undefined);
  assert.equal(persistedSession.brainExecution.attempts[0].providerResponse.outputText, undefined);
  assert.equal(persistedSession.providerResponse.kind, 'provider_response');
  assert.equal(persistedSession.providerResponse.outputText, undefined);
  assert.equal(persistedSession.output.outputText, undefined);
  assert.equal(serializedPersistedSession.includes(FULL_DIAGNOSTIC_MARKER), false);

  assert.equal(diagnosticsArtifact.kind, 'invocation_diagnostics_artifact');
  assert.equal(diagnosticsArtifact.relativePath, persistedSession.invocationSessionCompaction.diagnosticsArtifactPath);
  assert.equal(serializedDiagnosticsArtifact.includes(FULL_DIAGNOSTIC_MARKER), true);
  assert.equal(diagnosticsArtifact.contents.brainExecution.attempts[0].providerResponse.outputText.includes(FULL_DIAGNOSTIC_MARKER), true);
  assert.equal(persistedSessionSize < diagnosticsArtifactSize, true);
});
