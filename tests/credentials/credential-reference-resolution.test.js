import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { generateMasterKey } from '../../src/credentials/generate-master-key.js';
import { writeCredentialVault } from '../../src/credentials/write-credential-vault.js';
import {
  assertCredentialReferenceDefinition,
  assertCredentialReferenceRegistry,
} from '../../src/contracts/credentials/credential-reference-contract.js';
import { assertProviderIntegrationPreparation } from '../../src/contracts/providers/provider-integration-contract.js';
import { readCredentialReferenceRegistry } from '../../src/credential-references/read-credential-reference-registry.js';
import { resolveCredentialReferenceDefinition } from '../../src/credential-references/resolve-credential-reference-definition.js';
import { resolveCredentialReferencesForInvocation } from '../../src/credential-references/resolve-credential-references-for-invocation.js';
import { prepareProviderIntegrationsForInvocation } from '../../src/providers/prepare-provider-integrations-for-invocation.js';
import { runSystemBoot } from '../../src/boot/run-system-boot.js';
import { prepareAgentInvocation } from '../../src/invocation/prepare-agent-invocation.js';
import { runAgentInvocation } from '../../src/invocation/run-agent-invocation.js';
import { writeSystemStewardCommandModules } from '../helpers/write-system-steward-command-modules.js';

async function createDirectoryTree(rootPath, relativePaths) {
  for (const relativePath of relativePaths) {
    await mkdir(path.join(rootPath, relativePath), { recursive: true });
  }
}

function createCredentialReferenceRegistryContent() {
  return {
    kind: 'credential_reference_registry',
    version: 1,
    credentialReferences: [
      {
        kind: 'credential_reference_definition',
        version: 1,
        credentialReferenceId: 'gemini-api-key',
        credentialType: 'api_key',
        valueShape: 'string',
      },
      {
        kind: 'credential_reference_definition',
        version: 1,
        credentialReferenceId: 'openrouter-api-key',
        credentialType: 'api_key',
        valueShape: 'string',
      },
      {
        kind: 'credential_reference_definition',
        version: 1,
        credentialReferenceId: 'alfred-whatsapp-token',
        credentialType: 'access_token',
        valueShape: 'string',
      },
    ],
  };
}

function createResourcesRegistryContent() {
  return {
    kind: 'resource_registry',
    version: 1,
    resources: [
      {
        kind: 'resource_definition',
        version: 1,
        resourceId: 'gemini-api',
        resourceType: 'brain-provider',
        displayName: 'Gemini API',
        ownershipScope: 'shared',
        lifecycleState: 'active',
      },
      {
        kind: 'resource_definition',
        version: 1,
        resourceId: 'openrouter-api',
        resourceType: 'brain-provider',
        displayName: 'OpenRouter API',
        ownershipScope: 'shared',
        lifecycleState: 'active',
      },
      {
        kind: 'resource_definition',
        version: 1,
        resourceId: 'mas-filesystem',
        resourceType: 'storage',
        displayName: 'MAS Filesystem',
        ownershipScope: 'shared',
        lifecycleState: 'active',
      },
      {
        kind: 'resource_definition',
        version: 1,
        resourceId: 'alfred-whatsapp',
        resourceType: 'channel',
        displayName: 'Alfred WhatsApp',
        ownershipScope: 'dedicated',
        dedicatedToOperationalIdentityId: 'alfred',
        lifecycleState: 'draft',
      },
    ],
  };
}

function createAlfredBindingsContent() {
  return {
    kind: 'operational_identity_bindings',
    version: 1,
    operationalIdentityId: 'alfred',
    bindings: [
      {
        resourceId: 'gemini-api',
        accessMode: 'execute',
        bindingState: 'active',
        credentialReferenceId: 'gemini-api-key',
      },
      {
        resourceId: 'openrouter-api',
        accessMode: 'execute',
        bindingState: 'active',
        credentialReferenceId: 'openrouter-api-key',
      },
      {
        resourceId: 'mas-filesystem',
        accessMode: 'read',
        bindingState: 'active',
      },
      {
        resourceId: 'alfred-whatsapp',
        accessMode: 'publish',
        bindingState: 'draft',
        credentialReferenceId: 'alfred-whatsapp-token',
      },
    ],
  };
}

function createAlfredPermissionsContent() {
  return {
    kind: 'operational_identity_permissions',
    version: 1,
    operationalIdentityId: 'alfred',
    defaultEffect: 'deny',
    rules: [
      {
        ruleId: 'allow-gemini-execute',
        effect: 'allow',
        resourceId: 'gemini-api',
        accessModes: ['execute'],
      },
      {
        ruleId: 'allow-openrouter-execute',
        effect: 'allow',
        resourceId: 'openrouter-api',
        accessModes: ['execute'],
      },
      {
        ruleId: 'allow-filesystem-read',
        effect: 'allow',
        resourceId: 'mas-filesystem',
        accessModes: ['read'],
      },
      {
        ruleId: 'allow-whatsapp-publish',
        effect: 'allow',
        resourceId: 'alfred-whatsapp',
        accessModes: ['publish'],
      },
    ],
  };
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

async function createProjectFixture({ includeCredentialReferenceRegistry = true } = {}) {
  const temporaryRootPath = await mkdtemp(path.join(os.tmpdir(), 'openmas-credential-reference-'));

  await writeFile(
    path.join(temporaryRootPath, 'package.json'),
    JSON.stringify(
      {
        name: 'openmas-fixture',
        private: true,
        type: 'module',
        openmas: {
          projectKind: 'framework',
          schemaVersion: 1,
        },
      },
      null,
      2,
    ),
    'utf8',
  );

  await createDirectoryTree(temporaryRootPath, [
    'bin',
    'src',
    'docs',
    'var',
    'tests',
    'config',
    'instance',
    'instance/cognitive-identities/system-steward',
    'instance/cognitive-identities/system-steward/commands',
    'instance/cognitive-identities/system-steward/memory',
    'instance/memory',
    'instance/memory/knowledge',
    'instance/memory/policies',
    'instance/memory/state',
    'instance/memory/artifacts',
    'instance/tools',
    'instance/workflows',
    'instance/registries',
    'instance/evaluations',
    'instance/operational-identities',
    'instance/operational-identities/alfred',
  ]);

  await writeFile(
    path.join(temporaryRootPath, 'instance', 'registries', 'cognitive-identities.json'),
    JSON.stringify(
      {
        kind: 'cognitive_identities_registry',
        version: 1,
        cognitiveIdentities: [
          {
            cognitiveIdentityId: 'system-steward',
            rootPath: 'system-steward',
            category: 'platform',
          },
        ],
      },
      null,
      2,
    ),
    'utf8',
  );

  await writeFile(
    path.join(temporaryRootPath, 'instance', 'registries', 'operational-identities.json'),
    JSON.stringify(
      {
        kind: 'operational_identities_registry',
        version: 1,
        operationalIdentities: [
          {
            operationalIdentityId: 'alfred',
            rootPath: 'alfred',
            category: 'platform',
          },
        ],
      },
      null,
      2,
    ),
    'utf8',
  );

  await writeFile(
    path.join(temporaryRootPath, 'instance', 'registries', 'resources.json'),
    JSON.stringify(createResourcesRegistryContent(), null, 2),
    'utf8',
  );

  if (includeCredentialReferenceRegistry) {
    await writeFile(
      path.join(temporaryRootPath, 'config', 'credential-references.json'),
      JSON.stringify(createCredentialReferenceRegistryContent(), null, 2),
      'utf8',
    );
  }

  await writeFile(path.join(temporaryRootPath, 'instance', 'cognitive-identities', 'system-steward', 'identity.md'), '# System Steward\n', 'utf8');
  await writeFile(path.join(temporaryRootPath, 'instance', 'cognitive-identities', 'system-steward', 'policies.md'), '# Policies\n', 'utf8');
  await writeFile(path.join(temporaryRootPath, 'instance', 'cognitive-identities', 'system-steward', 'capabilities.md'), '# Capabilities\n', 'utf8');
  await writeSystemStewardCommandModules(temporaryRootPath);

  await writeFile(
    path.join(temporaryRootPath, 'instance', 'operational-identities', 'alfred', 'identity.json'),
    JSON.stringify(
      {
        kind: 'operational_identity_definition',
        version: 1,
        operationalIdentityId: 'alfred',
        displayName: 'Alfred',
        lifecycleState: 'active',
        auditActorId: 'system-steward.ops.alfred.v1',
        attachedCognitiveIdentities: [
          { cognitiveIdentityId: 'system-steward' },
        ],
        executionProfileId: 'alfred-default',
        persona: {
          tone: 'helpful',
        },
      },
      null,
      2,
    ),
    'utf8',
  );

  await writeFile(
    path.join(temporaryRootPath, 'instance', 'operational-identities', 'alfred', 'execution-profile.json'),
    JSON.stringify(
      {
        kind: 'execution_profile_definition',
        version: 1,
        executionProfileId: 'alfred-default',
        executionMode: 'deterministic',
        primaryBrain: {
          brainId: 'openrouter-primary',
          providerId: 'openrouter-api',
          modelId: 'openrouter/free',
        },
        fallbackBrain: {
          brainId: 'gemini-fallback',
          providerId: 'gemini-api',
          modelId: 'gemini-flash-latest',
        },
        enabledCommands: [
          'help',
          'hello',
          'status',
          'bootstrap',
          'gap-analysis',
          'inspect',
          'diagnose',
        ],
      },
      null,
      2,
    ),
    'utf8',
  );

  await writeFile(
    path.join(temporaryRootPath, 'instance', 'operational-identities', 'alfred', 'bindings.json'),
    JSON.stringify(createAlfredBindingsContent(), null, 2),
    'utf8',
  );

  await writeFile(
    path.join(temporaryRootPath, 'instance', 'operational-identities', 'alfred', 'permissions.json'),
    JSON.stringify(createAlfredPermissionsContent(), null, 2),
    'utf8',
  );

  await writeDevelopmentCredentialVault(temporaryRootPath);

  return temporaryRootPath;
}

async function writeDevelopmentCredentialVault(projectRootPath, credentials = {
  'gemini-api-key': 'gemini-secret',
  'openrouter-api-key': 'openrouter-secret',
}) {
  const masterKeyHex = generateMasterKey();

  await mkdir(path.join(projectRootPath, 'config', 'credentials'), { recursive: true });
  await writeFile(
    path.join(projectRootPath, 'config', 'credentials', 'development.key'),
    masterKeyHex,
    'utf8',
  );
  await writeCredentialVault({
    projectRootPath,
    environment: 'development',
    credentials,
    masterKeyHex,
  });

  return masterKeyHex;
}

test('assertCredentialReferenceDefinition accepts a valid vault-backed credential reference', () => {
  const definition = assertCredentialReferenceDefinition({
    kind: 'credential_reference_definition',
    version: 1,
    credentialReferenceId: 'gemini-api-key',
    credentialType: 'api_key',
    valueShape: 'string',
  });

  assert.equal(definition.credentialReferenceId, 'gemini-api-key');
  assert.equal(definition.credentialType, 'api_key');
  assert.equal(definition.valueShape, 'string');
});

test('assertCredentialReferenceDefinition rejects legacy resolver types', () => {
  assert.throws(
    () => assertCredentialReferenceDefinition({
      kind: 'credential_reference_definition',
      version: 1,
      credentialReferenceId: 'gemini-api-key',
      resolverType: 'environment_variable',
      credentialType: 'api_key',
      valueShape: 'string',
    }),
    /must not include resolverType/,
  );
});

test('assertCredentialReferenceRegistry rejects duplicate credentialReferenceIds', () => {
  assert.throws(
    () => assertCredentialReferenceRegistry({
      kind: 'credential_reference_registry',
      version: 1,
      credentialReferences: [
        {
          kind: 'credential_reference_definition',
          version: 1,
          credentialReferenceId: 'same-secret',
          credentialType: 'api_key',
          valueShape: 'string',
        },
        {
          kind: 'credential_reference_definition',
          version: 1,
          credentialReferenceId: 'same-secret',
          credentialType: 'api_key',
          valueShape: 'string',
        },
      ],
    }),
    /duplicated credentialReferenceId/,
  );
});

test('readCredentialReferenceRegistry loads the credential reference registry', async () => {
  const projectRootPath = await createProjectFixture();

  const { registry } = await readCredentialReferenceRegistry({ projectRootPath });

  assert.ok(registry);
  assert.equal(registry.credentialReferences.length, 3);
});

test('readCredentialReferenceRegistry returns null when the registry file does not exist', async () => {
  const projectRootPath = await createProjectFixture({ includeCredentialReferenceRegistry: false });

  const { registry } = await readCredentialReferenceRegistry({ projectRootPath });

  assert.equal(registry, null);
});

test('resolveCredentialReferenceDefinition finds a credential reference by id', () => {
  const registry = assertCredentialReferenceRegistry(createCredentialReferenceRegistryContent());

  const definition = resolveCredentialReferenceDefinition({
    credentialReferenceRegistry: registry,
    credentialReferenceId: 'gemini-api-key',
  });

  assert.equal(definition.valueShape, 'string');
});

test('resolveCredentialReferencesForInvocation resolves vault-backed secrets without leaking values', async () => {
  const projectRootPath = await mkdtemp(path.join(os.tmpdir(), 'openmas-secret-vault-'));
  await writeDevelopmentCredentialVault(projectRootPath);
  const registry = assertCredentialReferenceRegistry(createCredentialReferenceRegistryContent());

  const result = await resolveCredentialReferencesForInvocation({
    projectRootPath,
    usableBindings: [
      {
        resourceId: 'gemini-api',
        accessMode: 'execute',
        bindingState: 'active',
        credentialReferenceId: 'gemini-api-key',
        resourceType: 'brain-provider',
        resourceLifecycleState: 'active',
      },
      {
        resourceId: 'openrouter-api',
        accessMode: 'execute',
        bindingState: 'active',
        credentialReferenceId: 'openrouter-api-key',
        resourceType: 'brain-provider',
        resourceLifecycleState: 'active',
      },
    ],
    credentialReferenceRegistry: registry,
  });

  assert.equal(result.credentialVaultEnvironment, 'development');
  assert.equal(result.credentialVaultExists, true);
  assert.equal(result.summary.totalReferenced, 2);
  assert.equal(result.summary.resolved, 2);
  assert.equal(result.summary.unresolved, 0);
  assert.equal(result.summary.missingDefinitions, 0);
  assert.equal(result.resolvedCredentialReferences[0].hasSecretValue, true);
  assert.equal(typeof result.secretValueByReferenceId.get('gemini-api-key'), 'string');
  assert.equal(result.resolvedCredentialReferences[0].secretValue, undefined);
  assert.equal(result.resolvedCredentialReferences[0].environmentVariableName, undefined);
  assert.equal(result.resolvedCredentialReferences[0].resolverType, undefined);
});

test('resolveCredentialReferencesForInvocation reports unresolved and missing-definition references', async () => {
  const projectRootPath = await mkdtemp(path.join(os.tmpdir(), 'openmas-secret-vault-'));
  await writeDevelopmentCredentialVault(projectRootPath, {
    'openrouter-api-key': 'openrouter-secret',
  });
  const registry = assertCredentialReferenceRegistry(createCredentialReferenceRegistryContent());

  const result = await resolveCredentialReferencesForInvocation({
    projectRootPath,
    usableBindings: [
      {
        resourceId: 'gemini-api',
        accessMode: 'execute',
        bindingState: 'active',
        credentialReferenceId: 'gemini-api-key',
        resourceType: 'brain-provider',
        resourceLifecycleState: 'active',
      },
      {
        resourceId: 'ghost-provider',
        accessMode: 'execute',
        bindingState: 'active',
        credentialReferenceId: 'missing-credential-reference',
        resourceType: 'brain-provider',
        resourceLifecycleState: 'active',
      },
    ],
    credentialReferenceRegistry: registry,
  });

  assert.equal(result.summary.totalReferenced, 2);
  assert.equal(result.summary.resolved, 0);
  assert.equal(result.summary.unresolved, 1);
  assert.equal(result.summary.missingDefinitions, 1);
  assert.equal(result.warnings.length, 2);
});

test('prepareProviderIntegrationsForInvocation prepares future brain and channel integrations', () => {
  const preparation = prepareProviderIntegrationsForInvocation({
    usableBindings: [
      {
        resourceId: 'gemini-api',
        accessMode: 'execute',
        resourceType: 'brain-provider',
        credentialReferenceId: 'gemini-api-key',
      },
      {
        resourceId: 'community-whatsapp',
        accessMode: 'publish',
        resourceType: 'channel',
        credentialReferenceId: 'community-whatsapp-token',
      },
    ],
    secretResolution: {
      resolvedCredentialReferences: [
        {
          resourceId: 'gemini-api',
          credentialReferenceId: 'gemini-api-key',
          resolutionStatus: 'resolved',
          credentialType: 'api_key',
          valueShape: 'string',
          reason: 'resolved',
          hasSecretValue: true,
        },
        {
          resourceId: 'community-whatsapp',
          credentialReferenceId: 'community-whatsapp-token',
          resolutionStatus: 'unresolved',
          credentialType: 'access_token',
          valueShape: 'string',
          reason: 'missing vault secret',
          hasSecretValue: false,
        },
      ],
      summary: {
        totalReferenced: 2,
        resolved: 1,
        unresolved: 1,
        missingDefinitions: 0,
      },
      warnings: [],
    },
    brainSelection: {
      selectedBrain: {
        brainId: 'gemini-primary',
        providerId: 'gemini-api',
        modelId: 'gemini-flash-latest',
      },
      fallbackBrain: null,
      selectionSource: 'primary_brain_default',
      brainRequired: false,
    },
  });

  assertProviderIntegrationPreparation(preparation);
  assert.equal(preparation.selectedBrainProvider.status, 'ready');
  assert.equal(preparation.channelProviders[0].status, 'not_ready');
});

test('prepareAgentInvocation resolves credential references and provider preparation for Alfred', async () => {
  await withEnvironment(
    {
      OPENMAS_ENV: null,
      OPENMAS_MASTER_KEY: null,
    },
    async () => {
      const projectRootPath = await createProjectFixture();
      const bootResult = await runSystemBoot({ projectRootPath });

      const readiness = await prepareAgentInvocation({
        bootResult,
        request: {
          operationalIdentityId: 'alfred',
          command: 'hello',
          requestedBy: 'cli',
        },
      });

      assert.equal(readiness.status, 'ready');
      assert.ok(readiness.secretResolution);
      assert.equal(readiness.secretResolution.summary.totalReferenced, 2);
      assert.equal(readiness.secretResolution.summary.resolved, 2);
      assert.ok(readiness.providerPreparation);
      assert.equal(readiness.providerPreparation.selectedBrainProvider.status, 'ready');
      assert.equal(readiness.providerPreparation.fallbackBrainProvider.status, 'ready');
    },
  );
});

test('runAgentInvocation persists secret and provider summaries without secret values', async () => {
  await withEnvironment(
    {
      OPENMAS_ENV: null,
      OPENMAS_MASTER_KEY: null,
    },
    async () => {
      const projectRootPath = await createProjectFixture();

      const result = await runAgentInvocation({
        projectRootPath,
        operationalIdentityId: 'alfred',
        command: 'hello',
        requestedBy: 'cli',
      });

      assert.equal(result.status, 'completed');

      const invocationSession = JSON.parse(await readFile(result.persistence.invocationSessionRecordPath, 'utf8'));

      assert.ok(invocationSession.secretResolution);
      assert.equal(invocationSession.secretResolution.summary.totalReferenced, 2);
      assert.ok(invocationSession.providerPreparation);
      assert.equal(invocationSession.providerPreparation.selectedBrainProvider.status, 'ready');
      assert.equal(invocationSession.secretResolution.secretValueByReferenceId, undefined);
      assert.equal(invocationSession.secretResolution.resolvedCredentialReferences[0].secretValue, undefined);
    },
  );
});
