import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { assertOperationalIdentityBindings } from '../../src/contracts/access/binding-contract.js';
import { assertCredentialReferenceRegistry } from '../../src/contracts/credentials/credential-reference-contract.js';

const CREDENTIAL_REFERENCE_NAMESPACE_PATTERN = /^(providers|channels|tools|custom)\.[a-z0-9][a-z0-9_.-]*$/u;
const LEGACY_CREDENTIAL_REFERENCE_ID_PATTERN = /^(chatgpt|openrouter|claude|gemini|ollama)-api-key$|^(alfred-whatsapp|maria-instagram)-token$/u;
const LEGACY_ENV_VAR_METADATA_PATTERN = /environmentVariableName|resolverType|OPENMAS_/u;
const BETA_REFERENCE_OPERATIONAL_IDENTITY_IDS = [
  'alfred',
  'bruce',
];

async function readJsonFile(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function readOptionalJsonFile(filePath) {
  try {
    return await readJsonFile(filePath);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }

    throw error;
  }
}

function assertCleanCredentialReferenceId(credentialReferenceId) {
  assert.match(credentialReferenceId, CREDENTIAL_REFERENCE_NAMESPACE_PATTERN);
  assert.doesNotMatch(credentialReferenceId, LEGACY_CREDENTIAL_REFERENCE_ID_PATTERN);
}

test('checked-in credential references and Beta Operational Identity bindings use namespaced vault ids', async () => {
  const projectRootPath = process.cwd();
  const credentialReferenceRegistryPath = path.join(projectRootPath, 'config', 'credential-references.json');
  const operationalIdentitiesRootPath = path.join(projectRootPath, 'instance', 'operational-identities');
  const registryJson = await readJsonFile(credentialReferenceRegistryPath);
  const registry = assertCredentialReferenceRegistry(registryJson);
  const credentialReferenceIds = new Set(registry.credentialReferences.map((reference) => reference.credentialReferenceId));

  assert.doesNotMatch(JSON.stringify(registryJson), LEGACY_ENV_VAR_METADATA_PATTERN);

  for (const reference of registry.credentialReferences) {
    assertCleanCredentialReferenceId(reference.credentialReferenceId);
  }

  for (const operationalIdentityId of BETA_REFERENCE_OPERATIONAL_IDENTITY_IDS) {
    const bindingsPath = path.join(operationalIdentitiesRootPath, operationalIdentityId, 'bindings.json');
    const bindingsJson = await readOptionalJsonFile(bindingsPath);

    assert.ok(bindingsJson, `Beta reference Operational Identity ${operationalIdentityId} must include bindings.json`);

    const bindings = assertOperationalIdentityBindings(bindingsJson);

    assert.equal(bindings.operationalIdentityId, operationalIdentityId);
    assert.doesNotMatch(JSON.stringify(bindingsJson), LEGACY_ENV_VAR_METADATA_PATTERN);

    for (const binding of bindings.bindings) {
      if (!binding.credentialReferenceId) {
        continue;
      }

      assertCleanCredentialReferenceId(binding.credentialReferenceId);
      assert.equal(
        credentialReferenceIds.has(binding.credentialReferenceId),
        true,
        `Binding ${bindings.operationalIdentityId}/${binding.resourceId} references an unknown credentialReferenceId: ${binding.credentialReferenceId}`,
      );
    }
  }
});
