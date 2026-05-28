import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { generateMasterKey } from '../../src/credentials/generate-master-key.js';
import { openCredentialVault } from '../../src/credentials/open-credential-vault.js';
import { writeCredentialVault } from '../../src/credentials/write-credential-vault.js';

async function createTempProjectRoot() {
  return mkdtemp(path.join(os.tmpdir(), 'openmas-vault-io-'));
}

async function setupMasterKey(projectRootPath, masterKeyHex) {
  await mkdir(path.join(projectRootPath, 'config', 'credentials'), { recursive: true });
  await writeFile(path.join(projectRootPath, 'config', 'credentials', 'development.key'), masterKeyHex, 'utf8');
}

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

// --- Write then Open Roundtrip ---

test('write then open returns the original credentials object', async () => {
  const projectRootPath = await createTempProjectRoot();
  const masterKeyHex = generateMasterKey();
  await setupMasterKey(projectRootPath, masterKeyHex);

  const credentials = {
    'openrouter-api-key': 'sk-or-v1-abc123',
    'gemini-api-key': 'AIzaSy123',
  };

  await withEnvironment({ OPENMAS_MASTER_KEY: null }, async () => {
    await writeCredentialVault({ projectRootPath, credentials, masterKeyHex });
    const result = await openCredentialVault({ projectRootPath });

    assert.deepEqual(result.credentials, credentials);
    assert.equal(result.exists, true);
    assert.equal(result.masterKeySource, 'environment_key_file');
  });
});

test('write creates the vault file at the expected development path by default', async () => {
  const projectRootPath = await createTempProjectRoot();
  const masterKeyHex = generateMasterKey();

  const credentials = { 'api-key': 'value' };
  const writeResult = await writeCredentialVault({ projectRootPath, credentials, masterKeyHex });

  assert.ok(writeResult.vaultFilePath.endsWith(path.join('credentials', 'development.json.enc')));
  assert.equal(writeResult.credentialCount, 1);

  const fileExists = await readFile(writeResult.vaultFilePath).then(() => true).catch(() => false);
  assert.equal(fileExists, true);
});

test('write creates intermediate directories for per-environment vaults', async () => {
  const projectRootPath = await createTempProjectRoot();
  const masterKeyHex = generateMasterKey();

  const credentials = { 'api-key': 'staging-value' };
  const writeResult = await writeCredentialVault({
    projectRootPath,
    environment: 'staging',
    credentials,
    masterKeyHex,
  });

  assert.ok(writeResult.vaultFilePath.endsWith('staging.json.enc'));
  assert.equal(writeResult.credentialCount, 1);

  const fileExists = await readFile(writeResult.vaultFilePath).then(() => true).catch(() => false);
  assert.equal(fileExists, true);
});

test('write then open works with an empty credentials object', async () => {
  const projectRootPath = await createTempProjectRoot();
  const masterKeyHex = generateMasterKey();
  await setupMasterKey(projectRootPath, masterKeyHex);

  await withEnvironment({ OPENMAS_MASTER_KEY: null }, async () => {
    await writeCredentialVault({ projectRootPath, credentials: {}, masterKeyHex });
    const result = await openCredentialVault({ projectRootPath });

    assert.deepEqual(result.credentials, {});
    assert.equal(result.exists, true);
  });
});

test('write then open preserves all key-value pairs', async () => {
  const projectRootPath = await createTempProjectRoot();
  const masterKeyHex = generateMasterKey();
  await setupMasterKey(projectRootPath, masterKeyHex);

  const credentials = {
    'openrouter-api-key': 'sk-or-v1-abc123def456',
    'gemini-api-key': 'AIzaSyA1B2C3D4E5F6',
    'ollama-api-key': 'ollama-cloud-key-xyz',
    'chatgpt-api-key': 'sk-proj-abc123',
    'claude-api-key': 'sk-ant-api03-abc123',
    'alfred-whatsapp-token': 'EAABsbCS1IDBAO',
    'maria-instagram-token': 'IGQVJWZArV2',
  };

  await withEnvironment({ OPENMAS_MASTER_KEY: null }, async () => {
    await writeCredentialVault({ projectRootPath, credentials, masterKeyHex });
    const result = await openCredentialVault({ projectRootPath });

    assert.deepEqual(result.credentials, credentials);
    assert.equal(Object.keys(result.credentials).length, 7);
  });
});

// --- Open — Vault Does Not Exist ---

test('open returns exists false when vault file does not exist', async () => {
  const projectRootPath = await createTempProjectRoot();

  await withEnvironment({ OPENMAS_MASTER_KEY: null }, async () => {
    const result = await openCredentialVault({ projectRootPath });

    assert.equal(result.credentials, null);
    assert.equal(result.exists, false);
    assert.equal(result.masterKeySource, null);
    assert.ok(result.vaultFilePath.endsWith(path.join('credentials', 'development.json.enc')));
  });
});

// --- Open — Error Handling ---

test('open throws when vault exists but no master key is available', async () => {
  const projectRootPath = await createTempProjectRoot();
  const masterKeyHex = generateMasterKey();

  await writeCredentialVault({ projectRootPath, credentials: { 'key': 'val' }, masterKeyHex });

  await withEnvironment({ OPENMAS_MASTER_KEY: null }, async () => {
    await assert.rejects(
      () => openCredentialVault({ projectRootPath }),
      /no master key was found/,
    );
  });
});

test('open throws when vault exists but master key is wrong', async () => {
  const projectRootPath = await createTempProjectRoot();
  const correctKey = generateMasterKey();
  const wrongKey = generateMasterKey();

  await writeCredentialVault({ projectRootPath, credentials: { 'key': 'val' }, masterKeyHex: correctKey });
  await setupMasterKey(projectRootPath, wrongKey);

  await withEnvironment({ OPENMAS_MASTER_KEY: null }, async () => {
    await assert.rejects(
      () => openCredentialVault({ projectRootPath }),
      /Failed to decrypt/,
    );
  });
});

test('open reports the correct masterKeySource', async () => {
  const projectRootPath = await createTempProjectRoot();
  const masterKeyHex = generateMasterKey();

  await writeCredentialVault({ projectRootPath, credentials: { 'key': 'val' }, masterKeyHex });

  await withEnvironment({ OPENMAS_MASTER_KEY: masterKeyHex }, async () => {
    const result = await openCredentialVault({ projectRootPath });

    assert.equal(result.masterKeySource, 'environment_variable');
    assert.equal(result.exists, true);
  });
});

// --- Per-Environment ---

test('per-environment write then open uses config/credentials/<env>.json.enc', async () => {
  const projectRootPath = await createTempProjectRoot();
  const masterKeyHex = generateMasterKey();

  await mkdir(path.join(projectRootPath, 'config', 'credentials'), { recursive: true });
  await writeFile(
    path.join(projectRootPath, 'config', 'credentials', 'production.key'),
    masterKeyHex,
    'utf8',
  );

  const credentials = { 'prod-api-key': 'sk-prod-123' };

  await withEnvironment({ OPENMAS_MASTER_KEY: null }, async () => {
    const writeResult = await writeCredentialVault({
      projectRootPath,
      environment: 'production',
      credentials,
      masterKeyHex,
    });

    assert.ok(writeResult.vaultFilePath.endsWith('production.json.enc'));

    const result = await openCredentialVault({ projectRootPath, environment: 'production' });

    assert.deepEqual(result.credentials, credentials);
    assert.equal(result.exists, true);
    assert.equal(result.masterKeySource, 'environment_key_file');
  });
});

test('default vault uses config/credentials/development.json.enc', async () => {
  const projectRootPath = await createTempProjectRoot();
  const masterKeyHex = generateMasterKey();
  await setupMasterKey(projectRootPath, masterKeyHex);

  const credentials = { 'default-key': 'default-value' };

  await withEnvironment({ OPENMAS_MASTER_KEY: null }, async () => {
    await writeCredentialVault({ projectRootPath, credentials, masterKeyHex });
    const result = await openCredentialVault({ projectRootPath });

    assert.ok(result.vaultFilePath.endsWith(path.join('credentials', 'development.json.enc')));
  });
});

// --- Write Input Validation ---

test('write rejects null credentials', async () => {
  const projectRootPath = await createTempProjectRoot();
  const masterKeyHex = generateMasterKey();

  await assert.rejects(
    () => writeCredentialVault({ projectRootPath, credentials: null, masterKeyHex }),
    /must be a JSON object/,
  );
});

test('write rejects array credentials', async () => {
  const projectRootPath = await createTempProjectRoot();
  const masterKeyHex = generateMasterKey();

  await assert.rejects(
    () => writeCredentialVault({ projectRootPath, credentials: ['key'], masterKeyHex }),
    /must be a JSON object/,
  );
});

test('write rejects string credentials', async () => {
  const projectRootPath = await createTempProjectRoot();
  const masterKeyHex = generateMasterKey();

  await assert.rejects(
    () => writeCredentialVault({ projectRootPath, credentials: 'not-an-object', masterKeyHex }),
    /must be a JSON object/,
  );
});

// --- Path Traversal Prevention ---

test('open rejects path traversal in environment name', async () => {
  const projectRootPath = await createTempProjectRoot();

  await withEnvironment({ OPENMAS_MASTER_KEY: null }, async () => {
    await assert.rejects(
      () => openCredentialVault({ projectRootPath, environment: '../../etc/passwd' }),
      /Invalid environment name/,
    );
  });
});

test('write rejects path traversal in environment name', async () => {
  const projectRootPath = await createTempProjectRoot();
  const masterKeyHex = generateMasterKey();

  await assert.rejects(
    () => writeCredentialVault({
      projectRootPath,
      environment: '../../etc/passwd',
      credentials: {},
      masterKeyHex,
    }),
    /Invalid environment name/,
  );
});
