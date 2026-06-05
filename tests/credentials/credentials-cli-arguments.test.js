import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  buildRedactedCredentialVaultSummary,
  parseEditorCommand,
  parseCommandLineArguments,
  resolveEditor,
} from '../../bin/credentials.js';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CREDENTIALS_CLI_PATH = path.join(REPOSITORY_ROOT, 'bin', 'credentials.js');

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

test('parseEditorCommand supports simple commands, command args, and quoted executable paths', () => {
  assert.deepEqual(
    parseEditorCommand('nano'),
    { command: 'nano', args: [] },
  );
  assert.deepEqual(
    parseEditorCommand('code --wait'),
    { command: 'code', args: ['--wait'] },
  );
  assert.deepEqual(
    parseEditorCommand('"C:\\Program Files\\OpenMAS Editor\\editor.exe" --wait'),
    { command: 'C:\\Program Files\\OpenMAS Editor\\editor.exe', args: ['--wait'] },
  );
});

test('resolveEditor prefers VISUAL over EDITOR and ignores blank values', () => {
  const previousVisual = process.env.VISUAL;
  const previousEditor = process.env.EDITOR;

  try {
    process.env.VISUAL = '  code --wait  ';
    process.env.EDITOR = 'nano';
    assert.equal(resolveEditor(), 'code --wait');

    process.env.VISUAL = '   ';
    process.env.EDITOR = '  vim  ';
    assert.equal(resolveEditor(), 'vim');

    process.env.VISUAL = '   ';
    process.env.EDITOR = '   ';
    assert.equal(resolveEditor(), null);
  } finally {
    if (previousVisual === undefined) {
      delete process.env.VISUAL;
    } else {
      process.env.VISUAL = previousVisual;
    }

    if (previousEditor === undefined) {
      delete process.env.EDITOR;
    } else {
      process.env.EDITOR = previousEditor;
    }
  }
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

test('credentials show points new habitat users to credentials edit when the master key is missing', async () => {
  const projectRootPath = await mkdtemp(path.join(os.tmpdir(), 'openmas-credentials-cli-'));

  try {
    const result = spawnSync(process.execPath, [
      CREDENTIALS_CLI_PATH,
      'show',
      'development',
    ], {
      cwd: projectRootPath,
      encoding: 'utf8',
      env: {
        ...process.env,
        OPENMAS_ENV: '',
        OPENMAS_MASTER_KEY: '',
      },
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Error: No master key found/u);
    assert.match(result.stderr, /openmas credentials edit development/u);
    assert.match(result.stderr, /For a new local habitat/u);
  } finally {
    await rm(projectRootPath, { recursive: true, force: true });
  }
});
