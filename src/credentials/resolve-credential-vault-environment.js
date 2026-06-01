import { validateEnvironmentName } from './resolve-master-key.js';
import { DEFAULT_CREDENTIAL_VAULT_ENVIRONMENT } from './credential-vault-environment-constants.js';

function readOpenMasEnvironment(environmentVariables) {
  if (!environmentVariables || typeof environmentVariables !== 'object') {
    return null;
  }

  return environmentVariables.OPENMAS_ENV ?? null;
}

export function resolveCredentialVaultEnvironment({
  requestedEnvironment = null,
  environmentVariables = process.env,
} = {}) {
  if (typeof requestedEnvironment === 'string' && requestedEnvironment.trim().length > 0) {
    const validation = validateEnvironmentName(requestedEnvironment);

    if (!validation.valid) {
      throw new Error(validation.reason);
    }

    return {
      kind: 'credential_vault_environment_selection',
      version: 1,
      environment: validation.normalized,
      vaultEnvironment: validation.normalized,
      source: 'requested_environment',
      usesDefaultVault: false,
      reason: `Credential vault environment resolved from the explicit request: ${validation.normalized}.`,
    };
  }

  const openMasEnvironment = readOpenMasEnvironment(environmentVariables);

  if (typeof openMasEnvironment !== 'string' || openMasEnvironment.trim().length === 0) {
    return {
      kind: 'credential_vault_environment_selection',
      version: 1,
      environment: DEFAULT_CREDENTIAL_VAULT_ENVIRONMENT,
      vaultEnvironment: DEFAULT_CREDENTIAL_VAULT_ENVIRONMENT,
      source: 'development_default',
      usesDefaultVault: false,
      reason: 'OPENMAS_ENV is not set or blank; using the development credential vault.',
    };
  }

  const validation = validateEnvironmentName(openMasEnvironment);

  if (!validation.valid) {
    throw new Error(validation.reason);
  }

  return {
    kind: 'credential_vault_environment_selection',
    version: 1,
    environment: validation.normalized,
    vaultEnvironment: validation.normalized,
    source: 'OPENMAS_ENV',
    usesDefaultVault: false,
    reason: `Credential vault environment resolved from OPENMAS_ENV: ${validation.normalized}.`,
  };
}
