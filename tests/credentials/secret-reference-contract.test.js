import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SECRET_REFERENCE_TYPES,
  SECRET_REFERENCE_VALUE_SHAPES,
  assertResolvedSecretReference,
  assertSecretReferenceDefinition,
  assertSecretReferenceRegistry,
} from '../../src/contracts/secret-reference-contract.js';

function createDefinition(overrides = {}) {
  return {
    kind: 'secret_reference_definition',
    version: 1,
    secretReferenceId: 'providers.openrouter.shared.default.api_key',
    secretType: 'api_key',
    valueShape: 'string',
    description: 'Shared OpenRouter API key for authorized Operational Identities.',
    ...overrides,
  };
}

test('assertSecretReferenceDefinition accepts the clean vault-backed contract shape', () => {
  const definition = assertSecretReferenceDefinition(createDefinition());

  assert.deepEqual(definition, {
    kind: 'secret_reference_definition',
    version: 1,
    secretReferenceId: 'providers.openrouter.shared.default.api_key',
    secretType: 'api_key',
    valueShape: 'string',
    description: 'Shared OpenRouter API key for authorized Operational Identities.',
  });
});

test('assertSecretReferenceDefinition accepts JSON object credential shapes', () => {
  const definition = assertSecretReferenceDefinition(createDefinition({
    secretReferenceId: 'tools.google.shared.service_account',
    secretType: 'service_account_json',
    valueShape: 'json_object',
  }));

  assert.equal(definition.secretType, 'service_account_json');
  assert.equal(definition.valueShape, 'json_object');
});

test('assertSecretReferenceDefinition accepts custom_json for community tools', () => {
  const definition = assertSecretReferenceDefinition(createDefinition({
    secretReferenceId: 'custom.vendor_x.maria.credentials',
    secretType: 'custom_json',
    valueShape: 'json_object',
  }));

  assert.equal(definition.secretType, 'custom_json');
});

test('assertSecretReferenceDefinition rejects resolverType from the old env-var scaffold', () => {
  assert.throws(
    () => assertSecretReferenceDefinition(createDefinition({
      resolverType: 'environment_variable',
    })),
    /must not include resolverType/,
  );
});

test('assertSecretReferenceDefinition rejects environmentVariableName from the old env-var scaffold', () => {
  assert.throws(
    () => assertSecretReferenceDefinition(createDefinition({
      environmentVariableName: 'LEGACY_PROVIDER_API_KEY',
    })),
    /must not include environmentVariableName/,
  );
});

test('assertSecretReferenceDefinition requires valueShape', () => {
  const definition = createDefinition();
  delete definition.valueShape;

  assert.throws(
    () => assertSecretReferenceDefinition(definition),
    /non-empty valueShape/,
  );
});

test('assertSecretReferenceDefinition rejects unsupported valueShape values', () => {
  assert.throws(
    () => assertSecretReferenceDefinition(createDefinition({
      valueShape: 'array',
    })),
    /invalid valueShape/,
  );
});

test('assertSecretReferenceDefinition rejects unsupported secretType values', () => {
  assert.throws(
    () => assertSecretReferenceDefinition(createDefinition({
      secretType: 'vendor_specific_magic',
    })),
    /invalid secretType/,
  );
});

test('assertSecretReferenceRegistry rejects duplicate secretReferenceIds', () => {
  assert.throws(
    () => assertSecretReferenceRegistry({
      kind: 'secret_reference_registry',
      version: 1,
      secretReferences: [
        createDefinition(),
        createDefinition({
          description: 'Duplicate id with different description.',
        }),
      ],
    }),
    /duplicated secretReferenceId/,
  );
});

test('assertResolvedSecretReference normalizes clean resolution metadata without secret values', () => {
  const reference = assertResolvedSecretReference({
    resourceId: 'openrouter-api',
    secretReferenceId: 'providers.openrouter.shared.default.api_key',
    secretType: 'api_key',
    valueShape: 'string',
    resolutionStatus: 'resolved',
    reason: 'Secret reference resolved from the OpenMAS Credential Vault.',
    hasSecretValue: true,
  });

  assert.equal(reference.hasSecretValue, true);
  assert.equal(reference.secretType, 'api_key');
  assert.equal(reference.valueShape, 'string');
  assert.equal(reference.secretValue, undefined);
  assert.equal(reference.environmentVariableName, undefined);
  assert.equal(reference.resolverType, undefined);
});

test('secret-reference constants expose the clean Phase 2 type surface', () => {
  assert.equal(SECRET_REFERENCE_TYPES.has('api_key'), true);
  assert.equal(SECRET_REFERENCE_TYPES.has('custom_json'), true);
  assert.equal(SECRET_REFERENCE_TYPES.has('oauth_token_set'), true);
  assert.equal(SECRET_REFERENCE_VALUE_SHAPES.has('string'), true);
  assert.equal(SECRET_REFERENCE_VALUE_SHAPES.has('json_object'), true);
  assert.equal(SECRET_REFERENCE_VALUE_SHAPES.has('array'), false);
});
