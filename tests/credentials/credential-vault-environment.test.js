import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveCredentialVaultEnvironment } from '../../src/credentials/resolve-credential-vault-environment.js';

function withEnvironment(overrides, callback) {
  const previousValues = new Map();

  for (const [key, value] of Object.entries(overrides)) {
    previousValues.set(key, process.env[key]);

    if (value === null) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  return Promise.resolve()
    .then(callback)
    .finally(() => {
      for (const [key, value] of previousValues.entries()) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    });
}

test('resolveCredentialVaultEnvironment selects development when OPENMAS_ENV is absent', () => {
  const result = resolveCredentialVaultEnvironment({
    environmentVariables: {},
  });

  assert.equal(result.kind, 'credential_vault_environment_selection');
  assert.equal(result.version, 1);
  assert.equal(result.environment, 'development');
  assert.equal(result.vaultEnvironment, 'development');
  assert.equal(result.source, 'development_default');
  assert.equal(result.usesDefaultVault, false);
});

test('resolveCredentialVaultEnvironment selects development when OPENMAS_ENV is blank', () => {
  const result = resolveCredentialVaultEnvironment({
    environmentVariables: {
      OPENMAS_ENV: '   ',
    },
  });

  assert.equal(result.environment, 'development');
  assert.equal(result.vaultEnvironment, 'development');
  assert.equal(result.usesDefaultVault, false);
});

test('resolveCredentialVaultEnvironment reads OPENMAS_ENV from process.env by default', async () => {
  await withEnvironment({ OPENMAS_ENV: 'staging' }, async () => {
    const result = resolveCredentialVaultEnvironment();

    assert.equal(result.environment, 'staging');
    assert.equal(result.vaultEnvironment, 'staging');
    assert.equal(result.source, 'OPENMAS_ENV');
    assert.equal(result.usesDefaultVault, false);
  });
});

test('resolveCredentialVaultEnvironment normalizes OPENMAS_ENV to lowercase', () => {
  const result = resolveCredentialVaultEnvironment({
    environmentVariables: {
      OPENMAS_ENV: 'Production',
    },
  });

  assert.equal(result.environment, 'production');
  assert.equal(result.vaultEnvironment, 'production');
});

test('resolveCredentialVaultEnvironment trims OPENMAS_ENV', () => {
  const result = resolveCredentialVaultEnvironment({
    environmentVariables: {
      OPENMAS_ENV: '  development  ',
    },
  });

  assert.equal(result.environment, 'development');
  assert.equal(result.vaultEnvironment, 'development');
});

test('resolveCredentialVaultEnvironment accepts hyphenated and underscored environment names', () => {
  const hyphenated = resolveCredentialVaultEnvironment({
    environmentVariables: {
      OPENMAS_ENV: 'client-a-production',
    },
  });
  const underscored = resolveCredentialVaultEnvironment({
    environmentVariables: {
      OPENMAS_ENV: 'client_a_staging',
    },
  });

  assert.equal(hyphenated.environment, 'client-a-production');
  assert.equal(underscored.environment, 'client_a_staging');
});

test('resolveCredentialVaultEnvironment ignores NODE_ENV for credential vault selection', () => {
  const result = resolveCredentialVaultEnvironment({
    environmentVariables: {
      NODE_ENV: 'production',
    },
  });

  assert.equal(result.environment, 'development');
  assert.equal(result.vaultEnvironment, 'development');
  assert.equal(result.source, 'development_default');
});

test('resolveCredentialVaultEnvironment lets an explicit request override OPENMAS_ENV', () => {
  const result = resolveCredentialVaultEnvironment({
    requestedEnvironment: 'staging',
    environmentVariables: {
      OPENMAS_ENV: 'production',
    },
  });

  assert.equal(result.environment, 'staging');
  assert.equal(result.vaultEnvironment, 'staging');
  assert.equal(result.source, 'requested_environment');
});

test('resolveCredentialVaultEnvironment rejects path traversal names', () => {
  assert.throws(
    () => resolveCredentialVaultEnvironment({
      environmentVariables: {
        OPENMAS_ENV: '../../production',
      },
    }),
    /Invalid environment name/,
  );
});

test('resolveCredentialVaultEnvironment rejects names with dots', () => {
  assert.throws(
    () => resolveCredentialVaultEnvironment({
      environmentVariables: {
        OPENMAS_ENV: 'prod.secret',
      },
    }),
    /Invalid environment name/,
  );
});

test('resolveCredentialVaultEnvironment rejects names with spaces', () => {
  assert.throws(
    () => resolveCredentialVaultEnvironment({
      environmentVariables: {
        OPENMAS_ENV: 'prod secret',
      },
    }),
    /Invalid environment name/,
  );
});
