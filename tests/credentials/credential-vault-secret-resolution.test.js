import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { generateMasterKey } from '../../src/credentials/generate-master-key.js';
import { writeCredentialVault } from '../../src/credentials/write-credential-vault.js';
import { assertSecretReferenceRegistry } from '../../src/contracts/secret-reference-contract.js';
import { collectReferencedSecretReferenceIds } from '../../src/secret-references/collect-referenced-secret-reference-ids.js';
import { resolveSecretReferencesForInvocation } from '../../src/secret-references/resolve-secret-references-for-invocation.js';

async function createTempProjectRoot() {
  return mkdtemp(path.join(os.tmpdir(), 'openmas-vault-secret-resolution-'));
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

function createRegistry(definitions = []) {
  return assertSecretReferenceRegistry({
    kind: 'secret_reference_registry',
    version: 1,
    secretReferences: definitions.map((definition) => ({
      kind: 'secret_reference_definition',
      version: 1,
      secretReferenceId: definition.secretReferenceId,
      secretType: definition.secretType ?? 'api_key',
      valueShape: definition.valueShape ?? 'string',
      description: definition.description ?? 'Test secret reference.',
    })),
  });
}

function createBinding(secretReferenceId, overrides = {}) {
  return {
    resourceId: overrides.resourceId ?? secretReferenceId,
    accessMode: overrides.accessMode ?? 'execute',
    bindingState: overrides.bindingState ?? 'active',
    resourceType: overrides.resourceType ?? 'brain-provider',
    resourceLifecycleState: overrides.resourceLifecycleState ?? 'active',
    secretReferenceId,
  };
}

async function writeDevelopmentKey(projectRootPath, masterKeyHex) {
  await mkdir(path.join(projectRootPath, 'config', 'credentials'), { recursive: true });
  await writeFile(
    path.join(projectRootPath, 'config', 'credentials', 'development.key'),
    masterKeyHex,
    'utf8',
  );
}

async function writeDevelopmentVault(projectRootPath, credentials, { writeKey = true } = {}) {
  const masterKeyHex = generateMasterKey();

  if (writeKey) {
    await writeDevelopmentKey(projectRootPath, masterKeyHex);
  }

  await writeCredentialVault({
    projectRootPath,
    environment: 'development',
    credentials,
    masterKeyHex,
  });

  return masterKeyHex;
}

async function resolveWithCleanEnvironment(input) {
  return withEnvironment(
    {
      OPENMAS_ENV: null,
      OPENMAS_MASTER_KEY: null,
    },
    () => resolveSecretReferencesForInvocation(input),
  );
}

function publicResolutionPayload(result) {
  return {
    resolvedSecretReferences: result.resolvedSecretReferences,
    summary: result.summary,
    warnings: result.warnings,
    credentialVaultEnvironment: result.credentialVaultEnvironment,
    credentialVaultExists: result.credentialVaultExists,
  };
}

test('collectReferencedSecretReferenceIds returns unique non-empty ids in binding order', () => {
  const ids = collectReferencedSecretReferenceIds({
    usableBindings: [
      createBinding('providers.openrouter.shared.default.api_key'),
      createBinding('providers.openrouter.shared.default.api_key', { resourceId: 'second-provider' }),
      createBinding('  tools.google.shared.service_account  '),
      createBinding(null),
      createBinding(''),
    ],
  });

  assert.deepEqual(ids, [
    'providers.openrouter.shared.default.api_key',
    'tools.google.shared.service_account',
  ]);
});

test('resolveSecretReferencesForInvocation resolves string secrets by exact secretReferenceId', async () => {
  const projectRootPath = await createTempProjectRoot();
  const secretReferenceId = 'providers.openrouter.shared.default.api_key';
  const secretValue = 'sk-or-v1-secret-for-test';

  await writeDevelopmentVault(projectRootPath, {
    [secretReferenceId]: secretValue,
    'providers.openrouter.shared.other.api_key': 'wrong-secret',
  });

  const result = await resolveWithCleanEnvironment({
    projectRootPath,
    usableBindings: [createBinding(secretReferenceId, { resourceId: 'openrouter-api' })],
    secretReferenceRegistry: createRegistry([{ secretReferenceId }]),
  });

  assert.equal(result.summary.totalReferenced, 1);
  assert.equal(result.summary.resolved, 1);
  assert.equal(result.credentialVaultEnvironment, 'development');
  assert.equal(result.credentialVaultExists, true);
  assert.equal(result.secretValueByReferenceId.get(secretReferenceId), secretValue);
  assert.equal(JSON.stringify(publicResolutionPayload(result)).includes(secretValue), false);
});

test('resolveSecretReferencesForInvocation resolves JSON object secrets and keeps object values only in the Map', async () => {
  const projectRootPath = await createTempProjectRoot();
  const secretReferenceId = 'tools.google.shared.service_account';
  const serviceAccount = {
    client_email: 'service-account@example.test',
    private_key: 'PRIVATE_KEY_VALUE_SHOULD_NOT_LEAK',
  };

  await writeDevelopmentVault(projectRootPath, {
    [secretReferenceId]: serviceAccount,
  });

  const result = await resolveWithCleanEnvironment({
    projectRootPath,
    usableBindings: [createBinding(secretReferenceId, { resourceId: 'google-drive' })],
    secretReferenceRegistry: createRegistry([{
      secretReferenceId,
      secretType: 'service_account_json',
      valueShape: 'json_object',
    }]),
  });

  assert.equal(result.summary.resolved, 1);
  assert.deepEqual(result.secretValueByReferenceId.get(secretReferenceId), serviceAccount);

  const publicPayload = JSON.stringify(publicResolutionPayload(result));
  assert.equal(publicPayload.includes(serviceAccount.client_email), false);
  assert.equal(publicPayload.includes(serviceAccount.private_key), false);
});

test('resolveSecretReferencesForInvocation accepts empty JSON object secrets at resolver level', async () => {
  const projectRootPath = await createTempProjectRoot();
  const secretReferenceId = 'custom.vendor.shared.credentials';

  await writeDevelopmentVault(projectRootPath, {
    [secretReferenceId]: {},
  });

  const result = await resolveWithCleanEnvironment({
    projectRootPath,
    usableBindings: [createBinding(secretReferenceId)],
    secretReferenceRegistry: createRegistry([{
      secretReferenceId,
      secretType: 'custom_json',
      valueShape: 'json_object',
    }]),
  });

  assert.equal(result.summary.resolved, 1);
  assert.deepEqual(result.secretValueByReferenceId.get(secretReferenceId), {});
});

test('resolveSecretReferencesForInvocation marks empty string secrets unresolved', async () => {
  const projectRootPath = await createTempProjectRoot();
  const secretReferenceId = 'providers.gemini.shared.default.api_key';

  await writeDevelopmentVault(projectRootPath, {
    [secretReferenceId]: '',
  });

  const result = await resolveWithCleanEnvironment({
    projectRootPath,
    usableBindings: [createBinding(secretReferenceId, { resourceId: 'gemini-api' })],
    secretReferenceRegistry: createRegistry([{ secretReferenceId }]),
  });

  assert.equal(result.summary.resolved, 0);
  assert.equal(result.summary.unresolved, 1);
  assert.equal(result.secretValueByReferenceId.has(secretReferenceId), false);
});

test('resolveSecretReferencesForInvocation marks arrays unresolved for JSON object references', async () => {
  const projectRootPath = await createTempProjectRoot();
  const secretReferenceId = 'tools.google.shared.service_account';

  await writeDevelopmentVault(projectRootPath, {
    [secretReferenceId]: ['not', 'an', 'object'],
  });

  const result = await resolveWithCleanEnvironment({
    projectRootPath,
    usableBindings: [createBinding(secretReferenceId)],
    secretReferenceRegistry: createRegistry([{
      secretReferenceId,
      secretType: 'service_account_json',
      valueShape: 'json_object',
    }]),
  });

  assert.equal(result.summary.resolved, 0);
  assert.equal(result.summary.unresolved, 1);
});

test('resolveSecretReferencesForInvocation marks missing vault secrets unresolved', async () => {
  const projectRootPath = await createTempProjectRoot();
  const secretReferenceId = 'providers.openrouter.shared.default.api_key';

  const result = await resolveWithCleanEnvironment({
    projectRootPath,
    usableBindings: [createBinding(secretReferenceId)],
    secretReferenceRegistry: createRegistry([{ secretReferenceId }]),
  });

  assert.equal(result.credentialVaultEnvironment, 'development');
  assert.equal(result.credentialVaultExists, false);
  assert.equal(result.summary.resolved, 0);
  assert.equal(result.summary.unresolved, 1);
});

test('resolveSecretReferencesForInvocation marks references unresolved when the vault key is missing', async () => {
  const projectRootPath = await createTempProjectRoot();
  const secretReferenceId = 'providers.openrouter.shared.default.api_key';

  await writeDevelopmentVault(
    projectRootPath,
    { [secretReferenceId]: 'sk-or-v1-secret-for-test' },
    { writeKey: false },
  );

  const result = await resolveWithCleanEnvironment({
    projectRootPath,
    usableBindings: [createBinding(secretReferenceId)],
    secretReferenceRegistry: createRegistry([{ secretReferenceId }]),
  });

  assert.equal(result.summary.resolved, 0);
  assert.equal(result.summary.unresolved, 1);
  assert.match(result.warnings[0], /could not be opened|no master key was found/);
});

test('resolveSecretReferencesForInvocation marks missing registry definitions as missing_definition', async () => {
  const projectRootPath = await createTempProjectRoot();
  const secretReferenceId = 'providers.openrouter.shared.default.api_key';

  await writeDevelopmentVault(projectRootPath, {
    [secretReferenceId]: 'sk-or-v1-secret-for-test',
  });

  const result = await resolveWithCleanEnvironment({
    projectRootPath,
    usableBindings: [createBinding(secretReferenceId)],
    secretReferenceRegistry: createRegistry([]),
  });

  assert.equal(result.summary.totalReferenced, 1);
  assert.equal(result.summary.resolved, 0);
  assert.equal(result.summary.unresolved, 0);
  assert.equal(result.summary.missingDefinitions, 1);
  assert.equal(result.resolvedSecretReferences[0].resolutionStatus, 'missing_definition');
});

test('resolveSecretReferencesForInvocation deduplicates repeated referenced ids', async () => {
  const projectRootPath = await createTempProjectRoot();
  const secretReferenceId = 'providers.openrouter.shared.default.api_key';

  await writeDevelopmentVault(projectRootPath, {
    [secretReferenceId]: 'sk-or-v1-secret-for-test',
  });

  const result = await resolveWithCleanEnvironment({
    projectRootPath,
    usableBindings: [
      createBinding(secretReferenceId, { resourceId: 'openrouter-primary' }),
      createBinding(secretReferenceId, { resourceId: 'openrouter-secondary' }),
    ],
    secretReferenceRegistry: createRegistry([{ secretReferenceId }]),
  });

  assert.equal(result.summary.totalReferenced, 1);
  assert.equal(result.summary.resolved, 1);
  assert.equal(result.resolvedSecretReferences.length, 1);
  assert.equal(result.secretValueByReferenceId.size, 1);
});
