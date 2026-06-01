#!/usr/bin/env node

import process from 'node:process';
import {
  LIVE_CREDENTIAL_REFERENCE_IDS,
  assertNoSecretLeak,
  createLiveSmokeDiagnosticError,
  createLiveSmokeId,
  isNonEmptyString,
  printAgentSmokeSummary,
  printRequiredSecretReferenceStatus,
  readLiveCredentialVault,
  runLiveProbabilisticAgentTurn,
  runLiveSmokeMain,
} from './live-smoke-helpers.js';

const DEFAULT_DELAY_SECONDS = 90;
const MINIMUM_DELAY_SECONDS = 30;
const MAXIMUM_DELAY_SECONDS = 30 * 60;

function resolveDelaySeconds(value = process.env.OPENMAS_LIVE_SCHEDULE_DELAY_SECONDS) {
  if (value === undefined || value === null || String(value).trim().length === 0) {
    return DEFAULT_DELAY_SECONDS;
  }

  const delaySeconds = Number.parseInt(String(value), 10);

  if (
    !Number.isInteger(delaySeconds)
    || delaySeconds < MINIMUM_DELAY_SECONDS
    || delaySeconds > MAXIMUM_DELAY_SECONDS
  ) {
    throw createLiveSmokeDiagnosticError({
      phase: 'scheduled_smoke_configuration',
      reasonCode: 'invalid_scheduled_smoke_delay',
      message: 'OPENMAS_LIVE_SCHEDULE_DELAY_SECONDS must be an integer between 30 and 1800.',
      probableCause: `Received delay value: ${String(value)}`,
      nextStep: 'Use a future delay that leaves enough time for provider latency and any planned service restart.',
    });
  }

  return delaySeconds;
}

function appearsToClaimScheduledDelegation(result) {
  const text = [
    result.message,
    result.nextStep,
    result.output?.outputText,
  ].join('\n').toLowerCase();

  return /bruce|schedul|timer|program|agend|delegat/i.test(text);
}

function assertScheduledDelegationSubmitted(result, { requestedRunAt }) {
  const runtimeTruth = result.osExecution?.runtimeTruth ?? null;
  const toolExecution = result.output?.brainToolExecution ?? null;
  const dataPreview = toolExecution?.observation?.dataPreview ?? null;
  const systemCallId = dataPreview?.systemCall?.systemCallId ?? null;

  if (result.status !== 'completed') {
    throw createLiveSmokeDiagnosticError({
      phase: 'agent_invocation',
      reasonCode: 'scheduled_parent_invocation_not_completed',
      message: `Expected Alfred invocation turn to complete, received ${result.status}.`,
      probableCause: result.message,
      nextStep: 'Check Alfred provider readiness and the OS-managed invocation result before evaluating scheduled execution.',
      details: result.errors ?? [],
    });
  }

  if (toolExecution?.requestedToolId !== 'mas.os.schedule_delegation') {
    const reasonCode = appearsToClaimScheduledDelegation(result)
      ? 'unsafe_scheduled_claim_without_os_tool_execution'
      : 'scheduled_delegation_tool_request_missing';

    throw createLiveSmokeDiagnosticError({
      phase: 'ai_native_scheduled_delegation_contract',
      reasonCode,
      message: `Expected mas.os.schedule_delegation request, received ${toolExecution?.requestedToolId ?? 'none'}.`,
      probableCause: reasonCode === 'unsafe_scheduled_claim_without_os_tool_execution'
        ? 'Alfred produced text that appears to claim scheduled work, but the runtime has no OS tool execution evidence.'
        : 'Alfred answered without emitting the required mas.os.schedule_delegation tool request.',
      nextStep: 'Inspect the scheduled delegation instruction layer and Tool Request envelope. Scheduled work is valid only after OS Tool execution evidence exists.',
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
      reasonCode: 'scheduled_delegation_tool_execution_failed',
      message: `Expected mas.os.schedule_delegation to succeed, received ${toolExecution.toolResultStatus ?? 'n/a'}.`,
      probableCause: toolExecution.reason ?? 'The OS scheduled delegation affordance did not complete successfully.',
      nextStep: 'Inspect the OS Tool execution, parent runtime lineage, System Call inbox, and delegation policy.',
    });
  }

  if (dataPreview?.systemCall?.operation !== 'schedule_delegation' || !isNonEmptyString(systemCallId)) {
    throw createLiveSmokeDiagnosticError({
      phase: 'os_system_call_submission',
      reasonCode: 'scheduled_delegation_system_call_missing_or_wrong_operation',
      message: `Expected schedule_delegation System Call, received ${dataPreview?.systemCall?.operation ?? 'n/a'}.`,
      probableCause: 'The Tool execution did not produce the expected scheduled delegation System Call preview.',
      nextStep: 'Inspect mas.os.schedule_delegation runtime output and System Call contract normalization.',
    });
  }

  if (!['pending', 'scheduled'].includes(runtimeTruth?.status)) {
    throw createLiveSmokeDiagnosticError({
      phase: 'os_runtime_truth',
      reasonCode: 'scheduled_delegation_runtime_truth_not_pending_or_scheduled',
      message: `Expected OS runtime truth pending or scheduled after submission, received ${runtimeTruth?.status ?? 'n/a'}.`,
      probableCause: runtimeTruth?.summary ?? 'The runtime did not expose the expected non-final scheduled submission state.',
      nextStep: 'Inspect OS-managed CLI runtime truth mapping and the durable System Call Result.',
    });
  }

  assertNoSecretLeak('Scheduled delegation smoke output', [
    result.message,
    result.nextStep,
    result.output?.outputText,
    toolExecution.reason,
    toolExecution.observation?.summary,
    requestedRunAt,
    systemCallId,
  ].join('\n'));

  return {
    requestedRunAt,
    systemCallId,
  };
}

async function main() {
  const label = 'OpenMAS Alfred -> Bruce Scheduled Delegation Live Smoke Test';

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

    const delaySeconds = resolveDelaySeconds();
    const requestedRunAt = new Date(Date.now() + delaySeconds * 1000).toISOString();
    const toolRequestId = createLiveSmokeId('tool-request-live-scheduled');
    const childTask = 'Bruce, in one short sentence, confirm that you received the OpenMAS scheduled live smoke request.';
    const result = await runLiveProbabilisticAgentTurn({
      operationalIdentityId: 'alfred',
      requestedBy: 'live-smoke-alfred-bruce-scheduled-delegation',
      inputText: [
        'Return exactly one JSON object and no prose.',
        `Emit kind "brain_tool_request", version 1, toolRequestId "${toolRequestId}", toolId "mas.os.schedule_delegation", purpose "OpenMAS scheduled live smoke", and expectedSideEffectLevel "write_internal".`,
        'Copy the current OpenMAS OS parentContext object exactly as provided by your OpenMAS OS context layer into input.parentContext.',
        'Set input.targetOperationalIdentityId to "bruce".',
        `Set input.task exactly to "${childTask}"`,
        `Set input.runAt exactly to "${requestedRunAt}" with no suffix and no transformation.`,
        'Set input.missedRunPolicy to "delay".',
        'Set input.command to "ask".',
        'Set input.mode to "probabilistic".',
      ].join(' '),
    });

    printAgentSmokeSummary(label, result);

    const submission = assertScheduledDelegationSubmitted(result, {
      requestedRunAt,
    });

    console.log(`Scheduled System Call: ${submission.systemCallId}`);
    console.log(`Requested Run At: ${submission.requestedRunAt}`);
    console.log(`Delay Seconds: ${delaySeconds}`);
    console.log('');

    process.exitCode = 0;
  });
}

await main();
