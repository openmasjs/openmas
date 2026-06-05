#!/usr/bin/env node

import process from 'node:process';
import {
  LIVE_CREDENTIAL_REFERENCE_IDS,
  assertNoSecretLeak,
  createLiveSmokeDiagnosticError,
  printAgentSmokeSummary,
  printRequiredSecretReferenceStatus,
  readLiveCredentialVault,
  runLiveProbabilisticAgentTurn,
  runLiveSmokeMain,
} from './live-smoke-helpers.js';

function appearsToClaimDelegation(result) {
  const text = [
    result.message,
    result.nextStep,
    result.output?.outputText,
  ].join('\n').toLowerCase();

  return /bruce|delegat|acknowledged|recib|confirm/i.test(text);
}

function assertDelegationSubmitted(result) {
  const runtimeTruth = result.osExecution?.runtimeTruth ?? null;
  const toolExecution = result.output?.brainToolExecution ?? null;
  const dataPreview = toolExecution?.observation?.dataPreview ?? null;
  const outputText = result.output?.outputText ?? '';

  if (result.status !== 'completed') {
    throw createLiveSmokeDiagnosticError({
      phase: 'agent_invocation',
      reasonCode: 'delegation_parent_invocation_not_completed',
      message: `Expected Alfred invocation turn to complete, received ${result.status}.`,
      probableCause: result.message,
      nextStep: 'Check Alfred provider readiness and the OS-managed invocation result before evaluating delegation behavior.',
      details: result.errors ?? [],
    });
  }

  if (toolExecution?.requestedToolId !== 'mas.os.delegate') {
    const reasonCode = appearsToClaimDelegation(result)
      ? 'unsafe_delegation_claim_without_os_tool_execution'
      : 'delegation_tool_request_missing';

    throw createLiveSmokeDiagnosticError({
      phase: 'ai_native_delegation_contract',
      reasonCode,
      message: `Expected mas.os.delegate request, received ${toolExecution?.requestedToolId ?? 'none'}.`,
      probableCause: reasonCode === 'unsafe_delegation_claim_without_os_tool_execution'
        ? 'Alfred produced text that appears to claim delegation or Bruce acknowledgement, but the runtime has no OS tool execution evidence.'
        : 'Alfred answered without emitting the required mas.os.delegate tool request.',
      nextStep: 'Harden the delegation instruction layer, tool-request parsing, or semantic runtime so an AI Agent cannot claim delegated work unless the OS tool request was emitted and accepted.',
      details: [
        `Action Resolution: ${result.output?.actionResolution?.status ?? 'n/a'}`,
        `Tool Request Resolution: ${result.output?.toolRequestResolution?.status ?? 'n/a'}`,
        `OS Runtime Truth: ${runtimeTruth?.status ?? 'n/a'} (${runtimeTruth?.phase ?? 'n/a'})`,
      ],
    });
  }

  if (toolExecution.toolResultStatus !== 'succeeded') {
    throw createLiveSmokeDiagnosticError({
      phase: 'os_tool_execution',
      reasonCode: 'delegation_tool_execution_failed',
      message: `Expected mas.os.delegate to succeed, received ${toolExecution.toolResultStatus ?? 'n/a'}.`,
      probableCause: toolExecution.reason ?? 'The OS delegation affordance was requested but did not complete successfully.',
      nextStep: 'Inspect tool execution, OS System Call inbox, delegation policy, and parent process/thread state.',
    });
  }

  if (dataPreview?.systemCall?.operation !== 'delegate') {
    throw createLiveSmokeDiagnosticError({
      phase: 'os_system_call_submission',
      reasonCode: 'delegation_system_call_missing_or_wrong_operation',
      message: `Expected delegate System Call, received ${dataPreview?.systemCall?.operation ?? 'n/a'}.`,
      probableCause: 'The tool execution did not produce the expected delegate System Call preview.',
      nextStep: 'Inspect mas.os.delegate runtime output and System Call contract normalization.',
    });
  }

  if (!['pending', 'waiting'].includes(runtimeTruth?.status)) {
    throw createLiveSmokeDiagnosticError({
      phase: 'os_runtime_truth',
      reasonCode: 'delegation_runtime_truth_not_pending_or_waiting',
      message: `Expected OS runtime truth pending or waiting after delegation submission, received ${runtimeTruth?.status ?? 'n/a'}.`,
      probableCause: runtimeTruth?.summary ?? 'The parent runtime did not expose the expected non-final delegation submission state.',
      nextStep: 'Inspect OS-managed CLI runtime truth mapping for mas.os.delegate and parent wait state.',
    });
  }

  assertNoSecretLeak('Delegation smoke output', [
    result.message,
    result.nextStep,
    outputText,
    toolExecution.reason,
    toolExecution.observation?.summary,
  ].join('\n'));
}

async function main() {
  const label = 'OpenMAS Alfred -> Bruce Delegation Live Smoke Test';

  await runLiveSmokeMain(label, async () => {
    const requiredSecretReferenceIds = [
      LIVE_CREDENTIAL_REFERENCE_IDS.openRouterAlfredDefault,
      LIVE_CREDENTIAL_REFERENCE_IDS.openRouterBruceDefault,
      LIVE_CREDENTIAL_REFERENCE_IDS.geminiSharedDefault,
    ];
    const credentials = await readLiveCredentialVault({
      requiredSecretReferenceIds,
    });

    printRequiredSecretReferenceStatus({
      credentials,
      requiredSecretReferenceIds,
    });

    const requestedChildTask = 'Bruce, in one short sentence, confirm that you received the OpenMAS live delegation smoke request.';
    const requestedEnvelopeShape = JSON.stringify({
      kind: 'brain_tool_request',
      version: 1,
      toolRequestId: 'tool-request-live-delegation-smoke',
      toolId: 'mas.os.delegate',
      input: {
        targetOperationalIdentityId: 'bruce',
        task: requestedChildTask,
        command: 'ask',
        mode: 'probabilistic',
        parentContext: {
          jobId: 'COPY_FROM_OPENMAS_OS_RUNTIME_CONTEXT',
          processId: 'COPY_FROM_OPENMAS_OS_RUNTIME_CONTEXT',
          threadId: 'COPY_FROM_OPENMAS_OS_RUNTIME_CONTEXT',
        },
      },
      purpose: 'OpenMAS live delegation smoke',
      expectedSideEffectLevel: 'write_internal',
    }, null, 2);

    const result = await runLiveProbabilisticAgentTurn({
      operationalIdentityId: 'alfred',
      requestedBy: 'live-smoke-alfred-bruce-delegation',
      inputText: [
        'Return exactly one JSON object and no prose.',
        'The returned JSON must match this object shape:',
        requestedEnvelopeShape,
        'Replace input.parentContext with the exact parentContext object from the OpenMAS OS Runtime Context layer.',
        'input must be a JSON object, not a string.',
        'input.parentContext must be a JSON object, not a string.',
        'Do not escape, quote, stringify, or nest the input object as text.',
        'Emit kind "brain_tool_request", version 1, toolRequestId "tool-request-live-delegation-smoke", toolId "mas.os.delegate", purpose "OpenMAS live delegation smoke", and expectedSideEffectLevel "write_internal".',
        'Copy the current OpenMAS OS parentContext object exactly as provided by your OpenMAS OS context layer into input.parentContext.',
        'Set input.targetOperationalIdentityId to "bruce".',
        `Set input.task exactly to ${JSON.stringify(requestedChildTask)}.`,
        'Set input.command to "ask".',
        'Set input.mode to "probabilistic".',
        'Do not use mas.os.schedule_delegation for this request.',
      ].join('\n'),
    });

    printAgentSmokeSummary(label, result);
    assertDelegationSubmitted(result);

    process.exitCode = 0;
  });
}

await main();
