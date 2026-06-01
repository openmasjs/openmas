import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { DEFAULT_CREDENTIAL_VAULT_ENVIRONMENT } from './credential-vault-environment-constants.js';

const MASTER_KEY_HEX_PATTERN = /^[0-9a-fA-F]{64}$/;
const SAFE_ENVIRONMENT_NAME_PATTERN = /^[a-z0-9_-]+$/;

function validateMasterKeyFormat(value) {
  return MASTER_KEY_HEX_PATTERN.test(value);
}

export function validateEnvironmentName(environment) {
  if (typeof environment !== 'string' || environment.trim().length === 0) {
    return { valid: false, normalized: null, reason: 'Environment name must be a non-empty string.' };
  }

  const normalized = environment.trim().toLowerCase();

  if (!SAFE_ENVIRONMENT_NAME_PATTERN.test(normalized)) {
    return {
      valid: false,
      normalized: null,
      reason: `Invalid environment name: "${environment}". `
        + 'Environment names may only contain lowercase letters, numbers, hyphens, and underscores (pattern: /^[a-z0-9_-]+$/).',
    };
  }

  return { valid: true, normalized, reason: null };
}

async function readKeyFile(filePath) {
  try {
    const content = await readFile(filePath, 'utf8');
    const trimmed = content.trim();

    if (trimmed.length === 0) {
      return null;
    }

    return trimmed;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }

    throw error;
  }
}

export async function resolveMasterKey({ projectRootPath, environment }) {
  const requestedEnvironment = typeof environment === 'string' && environment.trim().length > 0
    ? environment
    : DEFAULT_CREDENTIAL_VAULT_ENVIRONMENT;
  const validation = validateEnvironmentName(requestedEnvironment);

  if (!validation.valid) {
    throw new Error(validation.reason);
  }

  const normalizedEnvironment = validation.normalized;

  const envVarValue = process.env.OPENMAS_MASTER_KEY ?? null;

  if (typeof envVarValue === 'string' && envVarValue.trim().length > 0) {
    const trimmedValue = envVarValue.trim();

    if (!validateMasterKeyFormat(trimmedValue)) {
      return {
        masterKeyHex: null,
        source: 'invalid',
        keyFilePath: null,
        reason: 'The OPENMAS_MASTER_KEY environment variable contains an invalid value. '
          + 'The master key must be a 64-character hexadecimal string.',
      };
    }

    return {
      masterKeyHex: trimmedValue,
      source: 'environment_variable',
      keyFilePath: null,
      reason: 'Master key resolved from the OPENMAS_MASTER_KEY environment variable.',
    };
  }

  const environmentKeyFilePath = path.join(
    projectRootPath,
    'config',
    'credentials',
    `${normalizedEnvironment}.key`,
  );
  const environmentKeyValue = await readKeyFile(environmentKeyFilePath);

  if (environmentKeyValue !== null) {
    if (!validateMasterKeyFormat(environmentKeyValue)) {
      return {
        masterKeyHex: null,
        source: 'invalid',
        keyFilePath: environmentKeyFilePath,
        reason: `The key file at ${environmentKeyFilePath} contains an invalid value. `
          + 'The master key must be a 64-character hexadecimal string.',
      };
    }

    return {
      masterKeyHex: environmentKeyValue,
      source: 'environment_key_file',
      keyFilePath: environmentKeyFilePath,
      reason: `Master key resolved from ${environmentKeyFilePath}.`,
    };
  }

  return {
    masterKeyHex: null,
    source: 'not_found',
    keyFilePath: null,
    reason: `No master key found for the "${normalizedEnvironment}" environment. `
      + `Searched: OPENMAS_MASTER_KEY env var, ${environmentKeyFilePath}.`,
  };
}
