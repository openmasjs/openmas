import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { generateMasterKey } from '../../src/credentials/generate-master-key.js';
import { writeCredentialVault } from '../../src/credentials/write-credential-vault.js';
import { assertCredentialReferenceRegistry } from '../../src/contracts/credential-reference-contract.js';
import { collectReferencedCredentialReferenceIds } from '../../src/credential-references/collect-referenced-credential-reference-ids.js';
import { resolveCredentialReferencesForInvocation } from '../../src/credential-references/resolve-credential-references-for-invocation.js';
import { buildFakeOpenRouterSecretProbe } from '../helpers/fake-secret-probes.js';

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
  return assertCredentialReferenceRegistry({
    kind: 'credential_reference_registry',
    version: 1,
    credentialReferences: definitions.map((definition) => ({
      kind: 'credential_reference_definition',
      version: 1,
      credentialReferenceId: definition.credentialReferenceId,
      credentialType: definition.credentialType ?? 'api_key',
      valueShape: definition.valueShape ?? 'string',
      description: definition.description ?? 'Test credential reference.',
    })),
  });
}

function createBinding(credentialReferenceId, overrides = {}) {
  return {
    resourceId: overrides.resourceId ?? credentialReferenceId,
    accessMode: overrides.accessMode ?? 'execute',
    bindingState: overrides.bindingState ?? 'active',
    resourceType: overrides.resourceType ?? 'brain-provider',
    resourceLifecycleState: overrides.resourceLifecycleState ?? 'active',
    credentialReferenceId,
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
    () => resolveCredentialReferencesForInvocation(input),
  );
}

function publicResolutionPayload(result) {
  return {
    resolvedCredentialReferences: result.resolvedCredentialReferences,
    summary: result.summary,
    warnings: result.warnings,
    credentialVaultEnvironment: result.credentialVaultEnvironment,
    credentialVaultExists: result.credentialVaultExists,
  };
}

test('collectReferencedCredentialReferenceIds returns unique non-empty ids in binding order', () => {
  const ids = collectReferencedCredentialReferenceIds({
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

test('resolveCredentialReferencesForInvocation resolves string secrets by exact credentialReferenceId', async () => {
  const projectRootPath = await createTempProjectRoot();
  const credentialReferenceId = 'providers.openrouter.shared.default.api_key';
  const secretValue = buildFakeOpenRouterSecretProbe('secret-for-test');

  await writeDevelopmentVault(projectRootPath, {
    [credentialReferenceId]: secretValue,
    'providers.openrouter.shared.other.api_key': 'wrong-secret',
  });

  const result = await resolveWithCleanEnvironment({
    projectRootPath,
    usableBindings: [createBinding(credentialReferenceId, { resourceId: 'openrouter-api' })],
    credentialReferenceRegistry: createRegistry([{ credentialReferenceId }]),
  });

  assert.equal(result.summary.totalReferenced, 1);
  assert.equal(result.summary.resolved, 1);
  assert.equal(result.credentialVaultEnvironment, 'development');
  assert.equal(result.credentialVaultExists, true);
  assert.equal(result.secretValueByReferenceId.get(credentialReferenceId), secretValue);
  assert.equal(JSON.stringify(publicResolutionPayload(result)).includes(secretValue), false);
});

test('resolveCredentialReferencesForInvocation resolves JSON object secrets and keeps object values only in the Map', async () => {
  const projectRootPath = await createTempProjectRoot();
  const credentialReferenceId = 'tools.google.shared.service_account';
  const serviceAccount = {
    client_email: 'service-account@example.test',
    private_key: 'PRIVATE_KEY_VALUE_SHOULD_NOT_LEAK',
  };

  await writeDevelopmentVault(projectRootPath, {
    [credentialReferenceId]: serviceAccount,
  });

  const result = await resolveWithCleanEnvironment({
    projectRootPath,
    usableBindings: [createBinding(credentialReferenceId, { resourceId: 'google-drive' })],
    credentialReferenceRegistry: createRegistry([{
      credentialReferenceId,
      credentialType: 'service_account_json',
      valueShape: 'json_object',
    }]),
  });

  assert.equal(result.summary.resolved, 1);
  assert.deepEqual(result.secretValueByReferenceId.get(credentialReferenceId), serviceAccount);

  const publicPayload = JSON.stringify(publicResolutionPayload(result));
  assert.equal(publicPayload.includes(serviceAccount.client_email), false);
  assert.equal(publicPayload.includes(serviceAccount.private_key), false);
});

test('resolveCredentialReferencesForInvocation accepts empty JSON object secrets at resolver level', async () => {
  const projectRootPath = await createTempProjectRoot();
  const credentialReferenceId = 'custom.vendor.shared.credentials';

  await writeDevelopmentVault(projectRootPath, {
    [credentialReferenceId]: {},
  });

  const result = await resolveWithCleanEnvironment({
    projectRootPath,
    usableBindings: [createBinding(credentialReferenceId)],
    credentialReferenceRegistry: createRegistry([{
      credentialReferenceId,
      credentialType: 'custom_json',
      valueShape: 'json_object',
    }]),
  });

  assert.equal(result.summary.resolved, 1);
  assert.deepEqual(result.secretValueByReferenceId.get(credentialReferenceId), {});
});

test('resolveCredentialReferencesForInvocation marks empty string secrets unresolved', async () => {
  const projectRootPath = await createTempProjectRoot();
  const credentialReferenceId = 'providers.gemini.shared.default.api_key';

  await writeDevelopmentVault(projectRootPath, {
    [credentialReferenceId]: '',
  });

  const result = await resolveWithCleanEnvironment({
    projectRootPath,
    usableBindings: [createBinding(credentialReferenceId, { resourceId: 'gemini-api' })],
    credentialReferenceRegistry: createRegistry([{ credentialReferenceId }]),
  });

  assert.equal(result.summary.resolved, 0);
  assert.equal(result.summary.unresolved, 1);
  assert.equal(result.secretValueByReferenceId.has(credentialReferenceId), false);
});

test('resolveCredentialReferencesForInvocation marks arrays unresolved for JSON object references', async () => {
  const projectRootPath = await createTempProjectRoot();
  const credentialReferenceId = 'tools.google.shared.service_account';

  await writeDevelopmentVault(projectRootPath, {
    [credentialReferenceId]: ['not', 'an', 'object'],
  });

  const result = await resolveWithCleanEnvironment({
    projectRootPath,
    usableBindings: [createBinding(credentialReferenceId)],
    credentialReferenceRegistry: createRegistry([{
      credentialReferenceId,
      credentialType: 'service_account_json',
      valueShape: 'json_object',
    }]),
  });

  assert.equal(result.summary.resolved, 0);
  assert.equal(result.summary.unresolved, 1);
});

test('resolveCredentialReferencesForInvocation marks missing vault secrets unresolved', async () => {
  const projectRootPath = await createTempProjectRoot();
  const credentialReferenceId = 'providers.openrouter.shared.default.api_key';

  const result = await resolveWithCleanEnvironment({
    projectRootPath,
    usableBindings: [createBinding(credentialReferenceId)],
    credentialReferenceRegistry: createRegistry([{ credentialReferenceId }]),
  });

  assert.equal(result.credentialVaultEnvironment, 'development');
  assert.equal(result.credentialVaultExists, false);
  assert.equal(result.summary.resolved, 0);
  assert.equal(result.summary.unresolved, 1);
});

test('resolveCredentialReferencesForInvocation marks references unresolved when the vault key is missing', async () => {
  const projectRootPath = await createTempProjectRoot();
  const credentialReferenceId = 'providers.openrouter.shared.default.api_key';

  await writeDevelopmentVault(
    projectRootPath,
    { [credentialReferenceId]: buildFakeOpenRouterSecretProbe('secret-for-test') },
    { writeKey: false },
  );

  const result = await resolveWithCleanEnvironment({
    projectRootPath,
    usableBindings: [createBinding(credentialReferenceId)],
    credentialReferenceRegistry: createRegistry([{ credentialReferenceId }]),
  });

  assert.equal(result.summary.resolved, 0);
  assert.equal(result.summary.unresolved, 1);
  assert.match(result.warnings[0], /could not be opened|no master key was found/);
});

test('resolveCredentialReferencesForInvocation marks missing registry definitions as missing_definition', async () => {
  const projectRootPath = await createTempProjectRoot();
  const credentialReferenceId = 'providers.openrouter.shared.default.api_key';

  await writeDevelopmentVault(projectRootPath, {
    [credentialReferenceId]: buildFakeOpenRouterSecretProbe('secret-for-test'),
  });

  const result = await resolveWithCleanEnvironment({
    projectRootPath,
    usableBindings: [createBinding(credentialReferenceId)],
    credentialReferenceRegistry: createRegistry([]),
  });

  assert.equal(result.summary.totalReferenced, 1);
  assert.equal(result.summary.resolved, 0);
  assert.equal(result.summary.unresolved, 0);
  assert.equal(result.summary.missingDefinitions, 1);
  assert.equal(result.resolvedCredentialReferences[0].resolutionStatus, 'missing_definition');
});

test('resolveCredentialReferencesForInvocation deduplicates repeated referenced ids', async () => {
  const projectRootPath = await createTempProjectRoot();
  const credentialReferenceId = 'providers.openrouter.shared.default.api_key';

  await writeDevelopmentVault(projectRootPath, {
    [credentialReferenceId]: buildFakeOpenRouterSecretProbe('secret-for-test'),
  });

  const result = await resolveWithCleanEnvironment({
    projectRootPath,
    usableBindings: [
      createBinding(credentialReferenceId, { resourceId: 'openrouter-primary' }),
      createBinding(credentialReferenceId, { resourceId: 'openrouter-secondary' }),
    ],
    credentialReferenceRegistry: createRegistry([{ credentialReferenceId }]),
  });

  assert.equal(result.summary.totalReferenced, 1);
  assert.equal(result.summary.resolved, 1);
  assert.equal(result.resolvedCredentialReferences.length, 1);
  assert.equal(result.secretValueByReferenceId.size, 1);
});
