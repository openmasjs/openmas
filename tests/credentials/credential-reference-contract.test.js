import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CREDENTIAL_REFERENCE_TYPES,
  CREDENTIAL_REFERENCE_VALUE_SHAPES,
  assertResolvedCredentialReference,
  assertCredentialReferenceDefinition,
  assertCredentialReferenceRegistry,
} from '../../src/contracts/credentials/credential-reference-contract.js';

function createDefinition(overrides = {}) {
  return {
    kind: 'credential_reference_definition',
    version: 1,
    credentialReferenceId: 'providers.openrouter.shared.default.api_key',
    credentialType: 'api_key',
    valueShape: 'string',
    description: 'Shared OpenRouter API key for authorized Operational Identities.',
    ...overrides,
  };
}

test('assertCredentialReferenceDefinition accepts the clean vault-backed contract shape', () => {
  const definition = assertCredentialReferenceDefinition(createDefinition());

  assert.deepEqual(definition, {
    kind: 'credential_reference_definition',
    version: 1,
    credentialReferenceId: 'providers.openrouter.shared.default.api_key',
    credentialType: 'api_key',
    valueShape: 'string',
    description: 'Shared OpenRouter API key for authorized Operational Identities.',
  });
});

test('assertCredentialReferenceDefinition accepts JSON object credential shapes', () => {
  const definition = assertCredentialReferenceDefinition(createDefinition({
    credentialReferenceId: 'tools.google.shared.service_account',
    credentialType: 'service_account_json',
    valueShape: 'json_object',
  }));

  assert.equal(definition.credentialType, 'service_account_json');
  assert.equal(definition.valueShape, 'json_object');
});

test('assertCredentialReferenceDefinition accepts custom_json for community tools', () => {
  const definition = assertCredentialReferenceDefinition(createDefinition({
    credentialReferenceId: 'custom.vendor_x.maria.credentials',
    credentialType: 'custom_json',
    valueShape: 'json_object',
  }));

  assert.equal(definition.credentialType, 'custom_json');
});

test('assertCredentialReferenceDefinition rejects resolverType from the old env-var scaffold', () => {
  assert.throws(
    () => assertCredentialReferenceDefinition(createDefinition({
      resolverType: 'environment_variable',
    })),
    /must not include resolverType/,
  );
});

test('assertCredentialReferenceDefinition rejects environmentVariableName from the old env-var scaffold', () => {
  assert.throws(
    () => assertCredentialReferenceDefinition(createDefinition({
      environmentVariableName: 'LEGACY_PROVIDER_API_KEY',
    })),
    /must not include environmentVariableName/,
  );
});

test('assertCredentialReferenceDefinition requires valueShape', () => {
  const definition = createDefinition();
  delete definition.valueShape;

  assert.throws(
    () => assertCredentialReferenceDefinition(definition),
    /non-empty valueShape/,
  );
});

test('assertCredentialReferenceDefinition rejects unsupported valueShape values', () => {
  assert.throws(
    () => assertCredentialReferenceDefinition(createDefinition({
      valueShape: 'array',
    })),
    /invalid valueShape/,
  );
});

test('assertCredentialReferenceDefinition rejects unsupported credentialType values', () => {
  assert.throws(
    () => assertCredentialReferenceDefinition(createDefinition({
      credentialType: 'vendor_specific_magic',
    })),
    /invalid credentialType/,
  );
});

test('assertCredentialReferenceRegistry rejects duplicate credentialReferenceIds', () => {
  assert.throws(
    () => assertCredentialReferenceRegistry({
      kind: 'credential_reference_registry',
      version: 1,
      credentialReferences: [
        createDefinition(),
        createDefinition({
          description: 'Duplicate id with different description.',
        }),
      ],
    }),
    /duplicated credentialReferenceId/,
  );
});

test('assertResolvedCredentialReference normalizes clean resolution metadata without secret values', () => {
  const reference = assertResolvedCredentialReference({
    resourceId: 'openrouter-api',
    credentialReferenceId: 'providers.openrouter.shared.default.api_key',
    credentialType: 'api_key',
    valueShape: 'string',
    resolutionStatus: 'resolved',
    reason: 'Credential reference resolved from the OpenMAS Credential Vault.',
    hasSecretValue: true,
  });

  assert.equal(reference.hasSecretValue, true);
  assert.equal(reference.credentialType, 'api_key');
  assert.equal(reference.valueShape, 'string');
  assert.equal(reference.secretValue, undefined);
  assert.equal(reference.environmentVariableName, undefined);
  assert.equal(reference.resolverType, undefined);
});

test('credential-reference constants expose the clean Phase 2 type surface', () => {
  assert.equal(CREDENTIAL_REFERENCE_TYPES.has('api_key'), true);
  assert.equal(CREDENTIAL_REFERENCE_TYPES.has('custom_json'), true);
  assert.equal(CREDENTIAL_REFERENCE_TYPES.has('oauth_token_set'), true);
  assert.equal(CREDENTIAL_REFERENCE_VALUE_SHAPES.has('string'), true);
  assert.equal(CREDENTIAL_REFERENCE_VALUE_SHAPES.has('json_object'), true);
  assert.equal(CREDENTIAL_REFERENCE_VALUE_SHAPES.has('array'), false);
});
