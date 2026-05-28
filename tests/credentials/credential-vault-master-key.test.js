import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { generateMasterKey } from '../../src/credentials/generate-master-key.js';
import { resolveMasterKey, validateEnvironmentName } from '../../src/credentials/resolve-master-key.js';

async function createTempProjectRoot() {
  return mkdtemp(path.join(os.tmpdir(), 'openmas-masterkey-'));
}

async function writeEnvironmentKey(projectRootPath, environment, key) {
  await mkdir(path.join(projectRootPath, 'config', 'credentials'), { recursive: true });
  await writeFile(path.join(projectRootPath, 'config', 'credentials', `${environment}.key`), key, 'utf8');
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

// --- Environment Variable Resolution ---

test('resolveMasterKey resolves from OPENMAS_MASTER_KEY env var when set', async () => {
  const projectRootPath = await createTempProjectRoot();
  const expectedKey = generateMasterKey();

  await withEnvironment({ OPENMAS_MASTER_KEY: expectedKey }, async () => {
    const result = await resolveMasterKey({ projectRootPath });

    assert.equal(result.masterKeyHex, expectedKey);
    assert.equal(result.source, 'environment_variable');
    assert.equal(result.keyFilePath, null);
  });
});

test('resolveMasterKey env var takes priority over key files', async () => {
  const projectRootPath = await createTempProjectRoot();
  const envKey = generateMasterKey();
  const fileKey = generateMasterKey();

  await writeEnvironmentKey(projectRootPath, 'development', fileKey);

  await withEnvironment({ OPENMAS_MASTER_KEY: envKey }, async () => {
    const result = await resolveMasterKey({ projectRootPath });

    assert.equal(result.masterKeyHex, envKey);
    assert.equal(result.source, 'environment_variable');
  });
});

test('resolveMasterKey treats empty env var as not set', async () => {
  const projectRootPath = await createTempProjectRoot();

  await withEnvironment({ OPENMAS_MASTER_KEY: '' }, async () => {
    const result = await resolveMasterKey({ projectRootPath });

    assert.equal(result.masterKeyHex, null);
    assert.equal(result.source, 'not_found');
  });
});

test('resolveMasterKey treats whitespace-only env var as not set', async () => {
  const projectRootPath = await createTempProjectRoot();

  await withEnvironment({ OPENMAS_MASTER_KEY: '   ' }, async () => {
    const result = await resolveMasterKey({ projectRootPath });

    assert.equal(result.masterKeyHex, null);
    assert.equal(result.source, 'not_found');
  });
});

// --- Environment Key File Resolution ---

test('resolveMasterKey defaults to config/credentials/development.key when env var is not set', async () => {
  const projectRootPath = await createTempProjectRoot();
  const expectedKey = generateMasterKey();

  await writeEnvironmentKey(projectRootPath, 'development', expectedKey);

  await withEnvironment({ OPENMAS_MASTER_KEY: null }, async () => {
    const result = await resolveMasterKey({ projectRootPath });

    assert.equal(result.masterKeyHex, expectedKey);
    assert.equal(result.source, 'environment_key_file');
    assert.ok(result.keyFilePath.endsWith(path.join('credentials', 'development.key')));
  });
});

test('resolveMasterKey development key takes priority over root legacy key files', async () => {
  const projectRootPath = await createTempProjectRoot();
  const developmentKey = generateMasterKey();
  const credentialsKey = generateMasterKey();
  const masterKey = generateMasterKey();

  await writeEnvironmentKey(projectRootPath, 'development', developmentKey);
  await mkdir(path.join(projectRootPath, 'config'), { recursive: true });
  await writeFile(path.join(projectRootPath, 'config', 'credentials.key'), credentialsKey, 'utf8');
  await writeFile(path.join(projectRootPath, 'config', 'master.key'), masterKey, 'utf8');

  await withEnvironment({ OPENMAS_MASTER_KEY: null }, async () => {
    const result = await resolveMasterKey({ projectRootPath });

    assert.equal(result.masterKeyHex, developmentKey);
    assert.equal(result.source, 'environment_key_file');
  });
});

// --- Legacy Root Key Files ---

test('resolveMasterKey does not fall back to config/master.key for implicit development', async () => {
  const projectRootPath = await createTempProjectRoot();
  const expectedKey = generateMasterKey();

  await mkdir(path.join(projectRootPath, 'config'), { recursive: true });
  await writeFile(path.join(projectRootPath, 'config', 'master.key'), expectedKey, 'utf8');

  await withEnvironment({ OPENMAS_MASTER_KEY: null }, async () => {
    const result = await resolveMasterKey({ projectRootPath });

    assert.equal(result.masterKeyHex, null);
    assert.equal(result.source, 'not_found');
    assert.equal(result.keyFilePath, null);
    assert.ok(result.reason.includes('development'));
  });
});

// --- Not Found ---

test('resolveMasterKey returns not_found when no key source exists', async () => {
  const projectRootPath = await createTempProjectRoot();

  await withEnvironment({ OPENMAS_MASTER_KEY: null }, async () => {
    const result = await resolveMasterKey({ projectRootPath });

    assert.equal(result.masterKeyHex, null);
    assert.equal(result.source, 'not_found');
    assert.equal(result.keyFilePath, null);
    assert.ok(result.reason.includes('No master key found'));
  });
});

// --- Trimming ---

test('resolveMasterKey trims trailing newline from key file', async () => {
  const projectRootPath = await createTempProjectRoot();
  const expectedKey = generateMasterKey();

  await writeEnvironmentKey(projectRootPath, 'development', expectedKey + '\n');

  await withEnvironment({ OPENMAS_MASTER_KEY: null }, async () => {
    const result = await resolveMasterKey({ projectRootPath });

    assert.equal(result.masterKeyHex, expectedKey);
    assert.equal(result.source, 'environment_key_file');
  });
});

test('resolveMasterKey trims whitespace from env var', async () => {
  const projectRootPath = await createTempProjectRoot();
  const expectedKey = generateMasterKey();

  await withEnvironment({ OPENMAS_MASTER_KEY: `  ${expectedKey}  ` }, async () => {
    const result = await resolveMasterKey({ projectRootPath });

    assert.equal(result.masterKeyHex, expectedKey);
    assert.equal(result.source, 'environment_variable');
  });
});

test('resolveMasterKey treats empty key file as not found', async () => {
  const projectRootPath = await createTempProjectRoot();

  await writeEnvironmentKey(projectRootPath, 'development', '');

  await withEnvironment({ OPENMAS_MASTER_KEY: null }, async () => {
    const result = await resolveMasterKey({ projectRootPath });

    assert.equal(result.masterKeyHex, null);
    assert.equal(result.source, 'not_found');
  });
});

// --- Per-Environment Resolution ---

test('resolveMasterKey per-environment resolves from config/credentials/<env>.key', async () => {
  const projectRootPath = await createTempProjectRoot();
  const expectedKey = generateMasterKey();

  await mkdir(path.join(projectRootPath, 'config', 'credentials'), { recursive: true });
  await writeFile(
    path.join(projectRootPath, 'config', 'credentials', 'production.key'),
    expectedKey,
    'utf8',
  );

  await withEnvironment({ OPENMAS_MASTER_KEY: null }, async () => {
    const result = await resolveMasterKey({ projectRootPath, environment: 'production' });

    assert.equal(result.masterKeyHex, expectedKey);
    assert.equal(result.source, 'environment_key_file');
    assert.ok(result.keyFilePath.endsWith('production.key'));
  });
});

test('resolveMasterKey per-environment does not fall back to config/credentials.key', async () => {
  const projectRootPath = await createTempProjectRoot();
  const fileKey = generateMasterKey();

  await mkdir(path.join(projectRootPath, 'config', 'credentials'), { recursive: true });
  await writeFile(path.join(projectRootPath, 'config', 'credentials.key'), fileKey, 'utf8');

  await withEnvironment({ OPENMAS_MASTER_KEY: null }, async () => {
    const result = await resolveMasterKey({ projectRootPath, environment: 'staging' });

    assert.equal(result.masterKeyHex, null);
    assert.equal(result.source, 'not_found');
  });
});

test('resolveMasterKey per-environment does not fall back to config/master.key', async () => {
  const projectRootPath = await createTempProjectRoot();
  const fileKey = generateMasterKey();

  await mkdir(path.join(projectRootPath, 'config'), { recursive: true });
  await writeFile(path.join(projectRootPath, 'config', 'master.key'), fileKey, 'utf8');

  await withEnvironment({ OPENMAS_MASTER_KEY: null }, async () => {
    const result = await resolveMasterKey({ projectRootPath, environment: 'development' });

    assert.equal(result.masterKeyHex, null);
    assert.equal(result.source, 'not_found');
  });
});

test('resolveMasterKey per-environment still prefers env var over key file', async () => {
  const projectRootPath = await createTempProjectRoot();
  const envKey = generateMasterKey();
  const fileKey = generateMasterKey();

  await mkdir(path.join(projectRootPath, 'config', 'credentials'), { recursive: true });
  await writeFile(
    path.join(projectRootPath, 'config', 'credentials', 'production.key'),
    fileKey,
    'utf8',
  );

  await withEnvironment({ OPENMAS_MASTER_KEY: envKey }, async () => {
    const result = await resolveMasterKey({ projectRootPath, environment: 'production' });

    assert.equal(result.masterKeyHex, envKey);
    assert.equal(result.source, 'environment_variable');
  });
});

// --- Key Format Validation ---

test('resolveMasterKey returns invalid when env var contains non-hex characters', async () => {
  const projectRootPath = await createTempProjectRoot();
  const badKey = 'zz' + 'a'.repeat(62);

  await withEnvironment({ OPENMAS_MASTER_KEY: badKey }, async () => {
    const result = await resolveMasterKey({ projectRootPath });

    assert.equal(result.masterKeyHex, null);
    assert.equal(result.source, 'invalid');
    assert.ok(result.reason.includes('OPENMAS_MASTER_KEY'));
    assert.ok(result.reason.includes('invalid'));
  });
});

test('resolveMasterKey returns invalid when env var is too short', async () => {
  const projectRootPath = await createTempProjectRoot();

  await withEnvironment({ OPENMAS_MASTER_KEY: 'abcdef1234' }, async () => {
    const result = await resolveMasterKey({ projectRootPath });

    assert.equal(result.masterKeyHex, null);
    assert.equal(result.source, 'invalid');
  });
});

test('resolveMasterKey returns invalid when key file contains non-hex characters', async () => {
  const projectRootPath = await createTempProjectRoot();

  await mkdir(path.join(projectRootPath, 'config', 'credentials'), { recursive: true });
  await writeFile(
    path.join(projectRootPath, 'config', 'credentials', 'development.key'),
    'this-is-not-a-valid-hex-key-string-and-should-be-rejected-by-va',
    'utf8',
  );

  await withEnvironment({ OPENMAS_MASTER_KEY: null }, async () => {
    const result = await resolveMasterKey({ projectRootPath });

    assert.equal(result.masterKeyHex, null);
    assert.equal(result.source, 'invalid');
    assert.ok(result.reason.includes('development.key'));
    assert.ok(result.reason.includes('invalid'));
  });
});

test('resolveMasterKey returns invalid when per-environment key file contains invalid key', async () => {
  const projectRootPath = await createTempProjectRoot();

  await mkdir(path.join(projectRootPath, 'config', 'credentials'), { recursive: true });
  await writeFile(
    path.join(projectRootPath, 'config', 'credentials', 'staging.key'),
    'not-hex-not-hex-not-hex-not-hex-not-hex-not-hex-not-hex-not-hex',
    'utf8',
  );

  await withEnvironment({ OPENMAS_MASTER_KEY: null }, async () => {
    const result = await resolveMasterKey({ projectRootPath, environment: 'staging' });

    assert.equal(result.masterKeyHex, null);
    assert.equal(result.source, 'invalid');
    assert.ok(result.reason.includes('staging.key'));
  });
});

test('resolveMasterKey accepts uppercase hex characters in key', async () => {
  const projectRootPath = await createTempProjectRoot();
  const upperKey = generateMasterKey().toUpperCase();

  await writeEnvironmentKey(projectRootPath, 'development', upperKey);

  await withEnvironment({ OPENMAS_MASTER_KEY: null }, async () => {
    const result = await resolveMasterKey({ projectRootPath });

    assert.equal(result.masterKeyHex, upperKey);
    assert.equal(result.source, 'environment_key_file');
  });
});

test('resolveMasterKey accepts mixed-case hex characters in env var', async () => {
  const projectRootPath = await createTempProjectRoot();
  const mixedKey = 'aAbBcCdD' + '0'.repeat(56);

  await withEnvironment({ OPENMAS_MASTER_KEY: mixedKey }, async () => {
    const result = await resolveMasterKey({ projectRootPath });

    assert.equal(result.masterKeyHex, mixedKey);
    assert.equal(result.source, 'environment_variable');
  });
});

// --- Edge Cases ---

test('resolveMasterKey treats null environment as development', async () => {
  const projectRootPath = await createTempProjectRoot();
  const expectedKey = generateMasterKey();

  await writeEnvironmentKey(projectRootPath, 'development', expectedKey);

  await withEnvironment({ OPENMAS_MASTER_KEY: null }, async () => {
    const result = await resolveMasterKey({ projectRootPath, environment: null });

    assert.equal(result.masterKeyHex, expectedKey);
    assert.equal(result.source, 'environment_key_file');
  });
});

test('resolveMasterKey treats undefined environment as development', async () => {
  const projectRootPath = await createTempProjectRoot();
  const expectedKey = generateMasterKey();

  await writeEnvironmentKey(projectRootPath, 'development', expectedKey);

  await withEnvironment({ OPENMAS_MASTER_KEY: null }, async () => {
    const result = await resolveMasterKey({ projectRootPath, environment: undefined });

    assert.equal(result.masterKeyHex, expectedKey);
    assert.equal(result.source, 'environment_key_file');
  });
});

test('resolveMasterKey treats empty string environment as development', async () => {
  const projectRootPath = await createTempProjectRoot();
  const expectedKey = generateMasterKey();

  await writeEnvironmentKey(projectRootPath, 'development', expectedKey);

  await withEnvironment({ OPENMAS_MASTER_KEY: null }, async () => {
    const result = await resolveMasterKey({ projectRootPath, environment: '' });

    assert.equal(result.masterKeyHex, expectedKey);
    assert.equal(result.source, 'environment_key_file');
  });
});

// --- Environment Name Validation & Path Traversal Prevention ---

test('validateEnvironmentName accepts valid environment names', () => {
  assert.equal(validateEnvironmentName('development').valid, true);
  assert.equal(validateEnvironmentName('staging').valid, true);
  assert.equal(validateEnvironmentName('production').valid, true);
  assert.equal(validateEnvironmentName('test').valid, true);
  assert.equal(validateEnvironmentName('my-custom-env').valid, true);
  assert.equal(validateEnvironmentName('env_with_underscores').valid, true);
  assert.equal(validateEnvironmentName('env123').valid, true);
});

test('validateEnvironmentName normalizes to lowercase', () => {
  const result = validateEnvironmentName('Production');

  assert.equal(result.valid, true);
  assert.equal(result.normalized, 'production');
});

test('validateEnvironmentName rejects path traversal with dot-dot-slash', () => {
  const result = validateEnvironmentName('../../etc/passwd');

  assert.equal(result.valid, false);
  assert.ok(result.reason.includes('Invalid environment name'));
});

test('validateEnvironmentName rejects path traversal with backslash', () => {
  const result = validateEnvironmentName('..\\..\\windows\\system32');

  assert.equal(result.valid, false);
  assert.ok(result.reason.includes('Invalid environment name'));
});

test('validateEnvironmentName rejects names with dots', () => {
  const result = validateEnvironmentName('prod.secret');

  assert.equal(result.valid, false);
  assert.ok(result.reason.includes('Invalid environment name'));
});

test('validateEnvironmentName rejects names with slashes', () => {
  const result = validateEnvironmentName('prod/secret');

  assert.equal(result.valid, false);
});

test('validateEnvironmentName rejects names with spaces', () => {
  const result = validateEnvironmentName('my environment');

  assert.equal(result.valid, false);
});

test('validateEnvironmentName rejects empty string', () => {
  const result = validateEnvironmentName('');

  assert.equal(result.valid, false);
});

test('validateEnvironmentName rejects null', () => {
  const result = validateEnvironmentName(null);

  assert.equal(result.valid, false);
});

test('resolveMasterKey throws on path traversal environment name', async () => {
  const projectRootPath = await createTempProjectRoot();

  await withEnvironment({ OPENMAS_MASTER_KEY: null }, async () => {
    await assert.rejects(
      () => resolveMasterKey({ projectRootPath, environment: '../../etc/passwd' }),
      /Invalid environment name/,
    );
  });
});

test('resolveMasterKey throws on environment name with slashes', async () => {
  const projectRootPath = await createTempProjectRoot();

  await withEnvironment({ OPENMAS_MASTER_KEY: null }, async () => {
    await assert.rejects(
      () => resolveMasterKey({ projectRootPath, environment: 'secret/path' }),
      /Invalid environment name/,
    );
  });
});
