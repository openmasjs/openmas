import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  buildRedactedCredentialVaultSummary,
  parseCommandLineArguments,
} from '../../bin/credentials.js';

test('parseCommandLineArguments reads the subcommand', () => {
  const result = parseCommandLineArguments(['node', 'bin/credentials.js', 'edit']);

  assert.equal(result.subcommand, 'edit');
  assert.equal(result.environment, null);
});

test('parseCommandLineArguments reads --environment value', () => {
  const result = parseCommandLineArguments([
    'node',
    'bin/credentials.js',
    'edit',
    '--environment',
    'development',
  ]);

  assert.equal(result.subcommand, 'edit');
  assert.equal(result.environment, 'development');
});

test('parseCommandLineArguments reads --environment=value', () => {
  const result = parseCommandLineArguments([
    'node',
    'bin/credentials.js',
    'show',
    '--environment=staging',
  ]);

  assert.equal(result.subcommand, 'show');
  assert.equal(result.environment, 'staging');
});

test('parseCommandLineArguments reads a positional environment shorthand', () => {
  const result = parseCommandLineArguments([
    'node',
    'bin/credentials.js',
    'edit',
    'development',
  ]);

  assert.equal(result.subcommand, 'edit');
  assert.equal(result.environment, 'development');
});

test('parseCommandLineArguments lets explicit environment override positional shorthand', () => {
  const result = parseCommandLineArguments([
    'node',
    'bin/credentials.js',
    'edit',
    'development',
    '--environment',
    'production',
  ]);

  assert.equal(result.subcommand, 'edit');
  assert.equal(result.environment, 'production');
});

test('buildRedactedCredentialVaultSummary never exposes credential values', () => {
  const summary = buildRedactedCredentialVaultSummary({
    environment: 'development',
    projectRootPath: process.cwd(),
    vaultFilePath: path.join(process.cwd(), 'config', 'credentials', 'development.json.enc'),
    credentials: {
      'providers.openrouter.shared.default.api_key': 'openrouter-sensitive-value',
      'tools.google.shared.service_account': {
        client_email: 'service@example.test',
        private_key: 'private-key-sensitive-value',
      },
    },
  });
  const serializedSummary = JSON.stringify(summary);

  assert.equal(summary.kind, 'credential_vault_summary');
  assert.equal(summary.environment, 'development');
  assert.equal(summary.credentialCount, 2);
  assert.equal(
    summary.credentials['providers.openrouter.shared.default.api_key'].redactedValue,
    '[redacted-secret]',
  );
  assert.deepEqual(
    summary.credentials['tools.google.shared.service_account'].keys,
    ['client_email', 'private_key'],
  );
  assert.doesNotMatch(serializedSummary, /openrouter-sensitive-value/u);
  assert.doesNotMatch(serializedSummary, /service@example\.test/u);
  assert.doesNotMatch(serializedSummary, /private-key-sensitive-value/u);
});
