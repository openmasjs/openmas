import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { resolveMasterKey, validateEnvironmentName } from './resolve-master-key.js';
import { decryptCredentialVault } from './decrypt-credential-vault.js';
import { DEFAULT_CREDENTIAL_VAULT_ENVIRONMENT } from './credential-vault-environment-constants.js';

async function readVaultFile(vaultFilePath) {
  try {
    return await readFile(vaultFilePath);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }

    throw error;
  }
}

export async function openCredentialVault({ projectRootPath, environment }) {
  const requestedEnvironment = typeof environment === 'string' && environment.trim().length > 0
    ? environment
    : DEFAULT_CREDENTIAL_VAULT_ENVIRONMENT;
  const validation = validateEnvironmentName(requestedEnvironment);

  if (!validation.valid) {
    throw new Error(validation.reason);
  }

  const normalizedEnvironment = validation.normalized;
  const vaultFilePath = path.join(projectRootPath, 'config', 'credentials', `${normalizedEnvironment}.json.enc`);
  const encryptedBuffer = await readVaultFile(vaultFilePath);

  if (encryptedBuffer === null) {
    return {
      credentials: null,
      vaultFilePath,
      masterKeySource: null,
      exists: false,
    };
  }

  const masterKeyResult = await resolveMasterKey({ projectRootPath, environment: normalizedEnvironment });

  if (masterKeyResult.source === 'not_found') {
    throw new Error(
      `Credential vault exists at ${vaultFilePath} but no master key was found to decrypt it. `
      + masterKeyResult.reason,
    );
  }

  if (masterKeyResult.source === 'invalid') {
    throw new Error(
      `Credential vault exists at ${vaultFilePath} but the master key is invalid. `
      + masterKeyResult.reason,
    );
  }

  let decryptedJson;

  try {
    decryptedJson = decryptCredentialVault(encryptedBuffer, masterKeyResult.masterKeyHex);
  } catch (error) {
    throw new Error(
      `Failed to decrypt the credential vault at ${vaultFilePath}. ${error.message}`,
    );
  }

  let credentials;

  try {
    credentials = JSON.parse(decryptedJson);
  } catch (error) {
    throw new Error(
      `The credential vault at ${vaultFilePath} was decrypted but contains invalid JSON. ${error.message}`,
    );
  }

  if (credentials === null || typeof credentials !== 'object' || Array.isArray(credentials)) {
    throw new Error(
      `The credential vault at ${vaultFilePath} must contain a JSON object, not ${Array.isArray(credentials) ? 'an array' : typeof credentials}.`,
    );
  }

  return {
    credentials,
    vaultFilePath,
    masterKeySource: masterKeyResult.source,
    exists: true,
  };
}
