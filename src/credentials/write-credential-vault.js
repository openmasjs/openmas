import path from 'node:path';
import { writeFile, mkdir } from 'node:fs/promises';
import { validateEnvironmentName } from './resolve-master-key.js';
import { encryptCredentialVault } from './encrypt-credential-vault.js';
import { DEFAULT_CREDENTIAL_VAULT_ENVIRONMENT } from './credential-vault-environment-constants.js';

export async function writeCredentialVault({ projectRootPath, environment, credentials, masterKeyHex }) {
  if (credentials === null || typeof credentials !== 'object' || Array.isArray(credentials)) {
    throw new Error(
      `Credentials must be a JSON object, not ${Array.isArray(credentials) ? 'an array' : typeof credentials}.`,
    );
  }

  const requestedEnvironment = typeof environment === 'string' && environment.trim().length > 0
    ? environment
    : DEFAULT_CREDENTIAL_VAULT_ENVIRONMENT;
  const validation = validateEnvironmentName(requestedEnvironment);

  if (!validation.valid) {
    throw new Error(validation.reason);
  }

  const normalizedEnvironment = validation.normalized;
  const vaultFilePath = path.join(projectRootPath, 'config', 'credentials', `${normalizedEnvironment}.json.enc`);
  const plaintextJson = JSON.stringify(credentials, null, 2) + '\n';
  const encryptedBuffer = encryptCredentialVault(plaintextJson, masterKeyHex);

  const vaultDirectory = path.dirname(vaultFilePath);
  await mkdir(vaultDirectory, { recursive: true });
  await writeFile(vaultFilePath, encryptedBuffer);

  return {
    vaultFilePath,
    credentialCount: Object.keys(credentials).length,
  };
}
