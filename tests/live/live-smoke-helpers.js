import process from 'node:process';
import { openCredentialVault } from '../../src/credentials/open-credential-vault.js';
import { runOsManagedCliInvocation } from '../../bin/invoke-agent.js';

export const LIVE_CREDENTIAL_REFERENCE_IDS = Object.freeze({
  geminiSharedDefault: 'providers.gemini.shared.default.api_key',
  ollamaSharedDefault: 'providers.ollama.shared.default.api_key',
  openRouterSharedDefault: 'providers.openrouter.shared.default.api_key',
  openRouterAlfredDefault: 'providers.openrouter.alfred.default.api_key',
  openRouterBruceDefault: 'providers.openrouter.bruce.default.api_key',
});

const SECRET_LIKE_PATTERNS = Object.freeze([
  /\bsk-or-[A-Za-z0-9_-]{12,}\b/u,
  /\bsk-[A-Za-z0-9_-]{12,}\b/u,
  /\bAIza[0-9A-Za-z_-]{20,}\b/u,
  /\bOPENMAS_MASTER_KEY\b/u,
]);

export function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export class LiveSmokeDiagnosticError extends Error {
  constructor({
    phase,
    reasonCode,
    message,
    probableCause,
    nextStep,
    details = [],
  }) {
    super(message);
    this.name = 'LiveSmokeDiagnosticError';
    this.phase = phase;
    this.reasonCode = reasonCode;
    this.probableCause = probableCause;
    this.nextStep = nextStep;
    this.details = details;
  }
}

export function createLiveSmokeDiagnosticError(input) {
  return new LiveSmokeDiagnosticError(input);
}

export function redactSecretLike(text) {
  let redactedText = String(text ?? '');

  for (const pattern of SECRET_LIKE_PATTERNS) {
    redactedText = redactedText.replace(pattern, '[redacted-secret]');
  }

  return redactedText;
}

export async function readLiveCredentialVault({
  projectRootPath = process.cwd(),
  requiredSecretReferenceIds = [],
} = {}) {
  let vault;

  try {
    vault = await openCredentialVault({
      projectRootPath,
    });
  } catch (error) {
    throw createLiveSmokeDiagnosticError({
      phase: 'credential_vault_open',
      reasonCode: classifyCredentialVaultOpenFailure(error.message),
      message: 'The OpenMAS Credential Vault could not be opened.',
      probableCause: redactSecretLike(error.message),
      nextStep: 'Open the vault with the credentials CLI, verify the environment and master key, then rerun this live smoke test.',
      details: [
        `Project Root: ${projectRootPath}`,
      ],
    });
  }

  if (!vault.exists || vault.credentials === null) {
    throw createLiveSmokeDiagnosticError({
      phase: 'credential_vault_open',
      reasonCode: 'credential_vault_file_missing',
      message: 'The OpenMAS Credential Vault file was not found.',
      probableCause: `Expected vault file does not exist: ${vault.vaultFilePath}`,
      nextStep: 'Create or edit the development vault with the credentials CLI, then add the required provider credential references.',
      details: [
        `Vault File: ${vault.vaultFilePath}`,
      ],
    });
  }

  const missingCredentialReferenceIds = requiredSecretReferenceIds.filter((credentialReferenceId) => {
    return !isNonEmptyString(vault.credentials[credentialReferenceId]);
  });

  if (missingCredentialReferenceIds.length > 0) {
    throw createLiveSmokeDiagnosticError({
      phase: 'credential_vault_secret_resolution',
      reasonCode: 'required_secret_reference_missing',
      message: 'The Credential Vault opened, but required provider secrets are missing.',
      probableCause: `Missing credential references: ${missingCredentialReferenceIds.join(', ')}`,
      nextStep: 'Add the missing credential reference ids to the vault. The value must be the real provider API key, not an example placeholder.',
      details: [
        `Vault File: ${vault.vaultFilePath}`,
        `Master Key Source: ${vault.masterKeySource}`,
      ],
    });
  }

  return vault.credentials;
}

export function requireVaultSecret(credentials, credentialReferenceId, label) {
  const secretValue = credentials[credentialReferenceId];

  if (!isNonEmptyString(secretValue)) {
    throw createLiveSmokeDiagnosticError({
      phase: 'credential_vault_secret_resolution',
      reasonCode: 'required_secret_reference_missing',
      message: `${credentialReferenceId} is required in the OpenMAS Credential Vault for the ${label} live smoke test.`,
      probableCause: 'The vault opened, but this provider key is missing or blank.',
      nextStep: `Add ${credentialReferenceId} to the vault with a valid ${label} API key.`,
    });
  }

  return secretValue;
}

export function assertNoSecretLeak(label, text) {
  const normalizedText = String(text ?? '');

  for (const pattern of SECRET_LIKE_PATTERNS) {
    if (pattern.test(normalizedText)) {
      throw new Error(`${label} appears to contain a raw secret-like value.`);
    }
  }
}

export function printRequiredSecretReferenceStatus({ credentials, requiredSecretReferenceIds }) {
  console.log('Credential Vault Check: opened');

  for (const credentialReferenceId of requiredSecretReferenceIds) {
    const status = isNonEmptyString(credentials?.[credentialReferenceId])
      ? 'present'
      : 'missing';

    console.log(`Credential Reference: ${credentialReferenceId} -> ${status}`);
  }

  console.log('');
}

export function createLiveSmokeId(prefix) {
  return `${prefix}-${Date.now()}`;
}

export async function runLiveProbabilisticAgentTurn({
  operationalIdentityId,
  inputText,
  requestedBy,
  semanticIntentRuntimeMode = 'provider',
} = {}) {
  return runOsManagedCliInvocation({
    projectRootPath: process.cwd(),
    masRootHint: 'instance',
    operationalIdentityId,
    invocationMode: 'probabilistic',
    command: 'ask',
    inputText,
    requestedBy,
    semanticIntentRuntimeMode,
  });
}

export function classifyProviderFailure({ result = null, error = null } = {}) {
  const message = error?.message ?? result?.errorMessage ?? result?.message ?? '';
  const normalizedMessage = message.toLowerCase();

  if (/readable output text|missing output|output text/u.test(normalizedMessage)) {
    return {
      phase: 'provider_response_shape',
      reasonCode: 'provider_response_missing_readable_output',
      probableCause: 'The provider adapter received a response, but it could not extract a usable text answer from the provider payload.',
      nextStep: 'Inspect the provider adapter response parsing and the provider account/model response format.',
    };
  }

  if (/401|403|unauthorized|forbidden|invalid api key|invalid key|authentication|auth/i.test(message)) {
    return {
      phase: 'provider_authentication',
      reasonCode: 'provider_rejected_credentials',
      probableCause: 'The provider rejected the API key or account authorization.',
      nextStep: 'Verify the vault value for this provider, confirm the key belongs to the expected account, and confirm the provider account has access to the selected model.',
    };
  }

  if (/429|rate limit|quota|too many requests|insufficient|credits|billing/i.test(message)) {
    return {
      phase: 'provider_quota_or_rate_limit',
      reasonCode: 'provider_quota_or_rate_limit',
      probableCause: 'The provider accepted the key but rejected the request because of quota, rate limits, credits, or billing.',
      nextStep: 'Wait for provider quota reset, switch keys/accounts, or select a model/account with available quota.',
    };
  }

  if (/enotfound|econnreset|etimedout|fetch failed|network|socket|dns/i.test(message)) {
    return {
      phase: 'provider_network',
      reasonCode: 'provider_network_failure',
      probableCause: 'The request did not reliably reach the provider or the provider connection failed.',
      nextStep: 'Check internet connectivity, provider status, firewall/proxy settings, and retry the smoke test.',
    };
  }

  return {
    phase: 'provider_request',
    reasonCode: 'provider_request_failed',
    probableCause: message || 'The provider adapter did not complete successfully.',
    nextStep: 'Review the provider status/error message above and inspect the adapter if the provider account and key are known to be valid.',
  };
}

export function createProviderDiagnosticError({
  providerId,
  modelId,
  credentialReferenceId,
  result = null,
  error = null,
}) {
  const classification = classifyProviderFailure({ result, error });
  const providerStatus = result?.status ?? 'threw';
  const providerMessage = error?.message ?? result?.errorMessage ?? result?.message ?? 'No provider error message was returned.';

  return createLiveSmokeDiagnosticError({
    phase: classification.phase,
    reasonCode: classification.reasonCode,
    message: `${providerId} live provider smoke failed.`,
    probableCause: classification.probableCause,
    nextStep: classification.nextStep,
    details: [
      `Provider: ${providerId}`,
      `Model: ${modelId}`,
      `Credential Reference: ${credentialReferenceId}`,
      `Provider Status: ${providerStatus}`,
      `Provider Message: ${redactSecretLike(providerMessage)}`,
    ],
  });
}

export function assertProviderCompleted({
  providerId,
  modelId,
  credentialReferenceId,
  result,
}) {
  if (result.status !== 'completed') {
    throw createProviderDiagnosticError({
      providerId,
      modelId,
      credentialReferenceId,
      result,
    });
  }

  if (!isNonEmptyString(result.outputText)) {
    throw createProviderDiagnosticError({
      providerId,
      modelId,
      credentialReferenceId,
      result: {
        ...result,
        errorMessage: 'Provider response did not include a readable output text.',
      },
    });
  }

  assertNoSecretLeak(`${providerId} output`, result.outputText);
  assertNoSecretLeak(`${providerId} warnings`, (result.warnings ?? []).join('\n'));
  assertNoSecretLeak(`${providerId} error`, result.errorMessage ?? '');
}

export function printAgentSmokeSummary(label, result) {
  const runtimeTruth = result.osExecution?.runtimeTruth ?? null;
  const output = result.output ?? {};
  const toolExecution = output.brainToolExecution ?? null;
  const toolResolution = output.toolRequestResolution ?? null;
  const actionResolution = output.actionResolution ?? null;
  const outputText = output.outputText ?? '';

  console.log(label);
  console.log('');
  console.log(`Status: ${runtimeTruth?.status ?? result.status}`);
  console.log(`Invocation Turn Status: ${result.status}`);
  console.log(`Operational Identity: ${result.operationalIdentityId ?? 'n/a'}`);
  console.log(`Primary Cognitive Identity: ${result.primaryCognitiveIdentityId ?? 'n/a'}`);
  console.log(`Provider: ${output.providerId ?? 'n/a'}`);
  console.log(`Model: ${output.modelId ?? 'n/a'}`);

  if (runtimeTruth) {
    console.log(`OS Runtime Truth: ${runtimeTruth.status} (${runtimeTruth.phase})`);
    console.log(`OS Runtime Final: ${runtimeTruth.final ? 'yes' : 'no'}`);
    console.log(`OS Runtime Summary: ${runtimeTruth.summary}`);
  }

  if (result.osExecution) {
    console.log(`OS Job: ${result.osExecution.jobId} (${result.osExecution.jobStatus})`);
    console.log(`OS Process: ${result.osExecution.processId} (${result.osExecution.processStatus})`);
    console.log(`OS Thread: ${result.osExecution.threadId} (${result.osExecution.threadStatus})`);
  }

  if (toolExecution) {
    if (actionResolution) {
      console.log(`Action Resolution: ${actionResolution.status ?? 'n/a'} | source=${actionResolution.source ?? 'n/a'}`);
    }

    if (toolResolution) {
      console.log(`Tool Request Resolution: ${toolResolution.status ?? 'n/a'} | runtime=${toolResolution.runtimeAction ?? 'n/a'}`);
    }

    console.log(`Requested Tool: ${toolExecution.requestedToolId ?? 'n/a'}`);
    console.log(`Tool Execution: ${toolExecution.status ?? 'n/a'}`);
    console.log(`Tool Result: ${toolExecution.toolResultStatus ?? 'n/a'}`);
  }

  if (output.usage) {
    console.log(
      `Usage: input=${output.usage.inputTokens ?? 'n/a'} output=${output.usage.outputTokens ?? 'n/a'} total=${output.usage.totalTokens ?? 'n/a'}`,
    );
  }

  if (outputText) {
    console.log('');
    console.log('Output Preview:');
    console.log(outputText.slice(0, 600));
  }

  if (result.warnings?.length > 0) {
    console.log('');
    console.log(`Warnings: ${result.warnings.length}`);

    for (const warning of result.warnings.slice(0, 5)) {
      console.log(`- ${redactSecretLike(warning)}`);
    }
  }

  if (result.errors?.length > 0) {
    console.log('');
    console.log(`Errors: ${redactSecretLike(result.errors.join(' | '))}`);
  }

  console.log('');
}

export function assertCompletedAgentSmoke(result, {
  operationalIdentityId,
  primaryCognitiveIdentityId,
} = {}) {
  const runtimeTruth = result.osExecution?.runtimeTruth ?? null;
  const outputText = result.output?.outputText ?? '';

  if (result.status !== 'completed') {
    throw createLiveSmokeDiagnosticError({
      phase: 'agent_invocation',
      reasonCode: 'agent_invocation_not_completed',
      message: `Expected completed invocation, received ${result.status}.`,
      probableCause: result.message,
      nextStep: 'Check the Credential Vault, provider readiness, Operational Identity bindings, and invocation output above.',
      details: result.errors ?? [],
    });
  }

  if (runtimeTruth && runtimeTruth.final !== true) {
    throw createLiveSmokeDiagnosticError({
      phase: 'os_runtime_truth',
      reasonCode: 'os_runtime_not_final',
      message: `Expected final OS runtime truth, received ${runtimeTruth.status} (${runtimeTruth.phase}).`,
      probableCause: runtimeTruth.summary,
      nextStep: 'Inspect the OS job/process/thread state for pending, waiting, or scheduled work.',
    });
  }

  if (result.operationalIdentityId !== operationalIdentityId) {
    throw createLiveSmokeDiagnosticError({
      phase: 'identity_resolution',
      reasonCode: 'unexpected_operational_identity',
      message: `Expected Operational Identity ${operationalIdentityId}, received ${result.operationalIdentityId ?? 'n/a'}.`,
      probableCause: 'The invocation resolved to a different acting authority than the smoke test requested.',
      nextStep: 'Inspect the Operational Identity registry and invocation request.',
    });
  }

  if (result.primaryCognitiveIdentityId !== primaryCognitiveIdentityId) {
    throw createLiveSmokeDiagnosticError({
      phase: 'cognitive_identity_resolution',
      reasonCode: 'unexpected_primary_cognitive_identity',
      message: `Expected Primary Cognitive Identity ${primaryCognitiveIdentityId}, received ${result.primaryCognitiveIdentityId ?? 'n/a'}.`,
      probableCause: 'The Operational Identity resolved a different cognitive identity than expected.',
      nextStep: 'Inspect attached Cognitive Identities, command routing, and active cognitive set resolution.',
    });
  }

  if (result.output?.executionType !== 'probabilistic_brain') {
    throw createLiveSmokeDiagnosticError({
      phase: 'agent_invocation',
      reasonCode: 'unexpected_execution_type',
      message: `Expected probabilistic brain output, received ${result.output?.executionType ?? 'n/a'}.`,
      probableCause: 'The invocation did not run through the probabilistic provider-backed brain path.',
      nextStep: 'Inspect the command, invocation mode, and Operational Identity execution profile.',
    });
  }

  if (!isNonEmptyString(outputText)) {
    throw createLiveSmokeDiagnosticError({
      phase: 'provider_response_shape',
      reasonCode: 'agent_output_missing_readable_text',
      message: 'Expected a non-empty live provider output text.',
      probableCause: 'The provider-backed invocation completed but did not produce readable output text.',
      nextStep: 'Inspect provider adapter response parsing and provider response payload.',
    });
  }

  assertNoSecretLeak('Agent smoke output', [
    result.message,
    result.nextStep,
    outputText,
  ].join('\n'));
}

function classifyCredentialVaultOpenFailure(message) {
  if (/no master key|master key/i.test(message)) {
    return 'credential_vault_master_key_missing_or_invalid';
  }

  if (/decrypt|invalid json/i.test(message)) {
    return 'credential_vault_decryption_or_json_failure';
  }

  if (/environment/i.test(message)) {
    return 'credential_vault_environment_invalid';
  }

  return 'credential_vault_open_failed';
}

function normalizeDiagnosticError(error) {
  if (error instanceof LiveSmokeDiagnosticError) {
    return error;
  }

  return createLiveSmokeDiagnosticError({
    phase: 'unexpected_live_smoke_failure',
    reasonCode: 'unexpected_exception',
    message: error.message,
    probableCause: 'The live smoke script failed outside a classified diagnostic boundary.',
    nextStep: 'Inspect the stack trace by rerunning the script directly if the safe summary is not enough.',
    details: [
      error.stack ?? error.message,
    ],
  });
}

export function printLiveSmokeFailure(label, error) {
  const diagnosticError = normalizeDiagnosticError(error);

  console.log(label);
  console.log('Status: failed');
  console.log(`Failure Phase: ${diagnosticError.phase}`);
  console.log(`Reason Code: ${diagnosticError.reasonCode}`);
  console.log(`Summary: ${redactSecretLike(diagnosticError.message)}`);
  console.log(`Probable Cause: ${redactSecretLike(diagnosticError.probableCause ?? 'n/a')}`);
  console.log(`Next Step: ${redactSecretLike(diagnosticError.nextStep ?? 'n/a')}`);

  if (diagnosticError.details?.length > 0) {
    console.log('Details:');

    for (const detail of diagnosticError.details.slice(0, 10)) {
      console.log(`- ${redactSecretLike(detail)}`);
    }
  }
}

export async function runLiveSmokeMain(label, callback) {
  try {
    await callback();
  } catch (error) {
    printLiveSmokeFailure(label, error);
    process.exitCode = 1;
  }
}
