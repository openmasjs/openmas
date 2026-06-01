import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { assertResourceDefinition, assertResourceRegistry, isResourceActive } from '../../src/contracts/access/resource-contract.js';
import { assertOperationalIdentityBindings, assertBindingEntry, isBindingActive } from '../../src/contracts/access/binding-contract.js';
import { readResourcesRegistry } from '../../src/operational-identities/read-resources-registry.js';
import { resolveResourceDefinition } from '../../src/operational-identities/resolve-resource-definition.js';
import { readBindingDefinitions } from '../../src/operational-identities/read-binding-definitions.js';
import { resolveBindingsForInvocation } from '../../src/operational-identities/resolve-bindings-for-invocation.js';
import { runSystemBoot } from '../../src/boot/run-system-boot.js';
import { prepareAgentInvocation } from '../../src/invocation/prepare-agent-invocation.js';
import { runAgentInvocation } from '../../src/invocation/run-agent-invocation.js';
import { writeSystemStewardCommandModules } from '../helpers/write-system-steward-command-modules.js';

async function createDirectoryTree(rootPath, relativePaths) {
  for (const relativePath of relativePaths) {
    await mkdir(path.join(rootPath, relativePath), { recursive: true });
  }
}

function createResourcesRegistryContent() {
  return {
    kind: 'resource_registry',
    version: 1,
    resources: [
      {
        kind: 'resource_definition',
        version: 1,
        resourceId: 'openrouter-api',
        resourceType: 'brain-provider',
        displayName: 'OpenRouter API',
        ownershipScope: 'shared',
        lifecycleState: 'active',
        description: 'Primary OpenRouter brain provider.',
      },
      {
        kind: 'resource_definition',
        version: 1,
        resourceId: 'gemini-api',
        resourceType: 'brain-provider',
        displayName: 'Gemini API',
        ownershipScope: 'shared',
        lifecycleState: 'active',
        description: 'Gemini brain provider.',
      },
      {
        kind: 'resource_definition',
        version: 1,
        resourceId: 'mas-filesystem',
        resourceType: 'storage',
        displayName: 'MAS Filesystem',
        ownershipScope: 'shared',
        lifecycleState: 'active',
        description: 'Shared filesystem storage.',
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
        description: 'Dedicated WhatsApp channel for Alfred.',
      },
      {
        kind: 'resource_definition',
        version: 1,
        resourceId: 'maria-instagram',
        resourceType: 'channel',
        displayName: 'Maria Instagram',
        ownershipScope: 'dedicated',
        dedicatedToOperationalIdentityId: 'maria',
        lifecycleState: 'draft',
        description: 'Dedicated Instagram channel for Maria.',
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
        resourceId: 'openrouter-api',
        accessMode: 'execute',
        bindingState: 'active',
      },
      {
        resourceId: 'gemini-api',
        accessMode: 'execute',
        bindingState: 'active',
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
      },
    ],
  };
}

async function createProjectFixture() {
  const temporaryRootPath = await mkdtemp(path.join(os.tmpdir(), 'openmas-resource-binding-'));

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
          {
            cognitiveIdentityId: 'system-steward',
          },
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

  return temporaryRootPath;
}

// --- Contract Tests ---

test('assertResourceDefinition accepts a valid shared resource', () => {
  const definition = assertResourceDefinition({
    kind: 'resource_definition',
    version: 1,
    resourceId: 'openrouter-api',
    resourceType: 'brain-provider',
    displayName: 'OpenRouter API',
    ownershipScope: 'shared',
    lifecycleState: 'active',
    description: 'Primary brain provider.',
  });

  assert.equal(definition.resourceId, 'openrouter-api');
  assert.equal(definition.resourceType, 'brain-provider');
  assert.equal(definition.ownershipScope, 'shared');
  assert.equal(definition.dedicatedToOperationalIdentityId, null);
  assert.equal(definition.lifecycleState, 'active');
});

test('assertResourceDefinition accepts a valid dedicated resource', () => {
  const definition = assertResourceDefinition({
    kind: 'resource_definition',
    version: 1,
    resourceId: 'alfred-whatsapp',
    resourceType: 'channel',
    displayName: 'Alfred WhatsApp',
    ownershipScope: 'dedicated',
    dedicatedToOperationalIdentityId: 'alfred',
    lifecycleState: 'draft',
    description: 'Dedicated WhatsApp channel.',
  });

  assert.equal(definition.ownershipScope, 'dedicated');
  assert.equal(definition.dedicatedToOperationalIdentityId, 'alfred');
  assert.equal(definition.lifecycleState, 'draft');
});

test('assertResourceDefinition rejects dedicated resources without dedicatedToOperationalIdentityId', () => {
  assert.throws(
    () => assertResourceDefinition({
      kind: 'resource_definition',
      version: 1,
      resourceId: 'bad-resource',
      resourceType: 'channel',
      displayName: 'Bad Resource',
      ownershipScope: 'dedicated',
      lifecycleState: 'active',
    }),
    /dedicatedToOperationalIdentityId/,
  );
});

test('assertResourceDefinition rejects shared resources that include dedicatedToOperationalIdentityId', () => {
  assert.throws(
    () => assertResourceDefinition({
      kind: 'resource_definition',
      version: 1,
      resourceId: 'bad-resource',
      resourceType: 'brain-provider',
      displayName: 'Bad Resource',
      ownershipScope: 'shared',
      dedicatedToOperationalIdentityId: 'alfred',
      lifecycleState: 'active',
    }),
    /must not include dedicatedToOperationalIdentityId/,
  );
});

test('assertResourceDefinition rejects invalid resource types', () => {
  assert.throws(
    () => assertResourceDefinition({
      kind: 'resource_definition',
      version: 1,
      resourceId: 'bad-resource',
      resourceType: 'unknown-type',
      displayName: 'Bad Resource',
      ownershipScope: 'shared',
      lifecycleState: 'active',
    }),
    /resourceType is invalid/,
  );
});

test('assertResourceDefinition rejects invalid lifecycle states', () => {
  assert.throws(
    () => assertResourceDefinition({
      kind: 'resource_definition',
      version: 1,
      resourceId: 'bad-resource',
      resourceType: 'storage',
      displayName: 'Bad Resource',
      ownershipScope: 'shared',
      lifecycleState: 'deleted',
    }),
    /lifecycleState is invalid/,
  );
});

test('assertResourceRegistry rejects duplicated resource ids', () => {
  assert.throws(
    () => assertResourceRegistry({
      kind: 'resource_registry',
      version: 1,
      resources: [
        {
          kind: 'resource_definition',
          version: 1,
          resourceId: 'same-id',
          resourceType: 'storage',
          displayName: 'Resource A',
          ownershipScope: 'shared',
          lifecycleState: 'active',
        },
        {
          kind: 'resource_definition',
          version: 1,
          resourceId: 'same-id',
          resourceType: 'storage',
          displayName: 'Resource B',
          ownershipScope: 'shared',
          lifecycleState: 'active',
        },
      ],
    }),
    /duplicated resourceId/,
  );
});

test('isResourceActive returns true for active resources and false for draft', () => {
  assert.equal(isResourceActive({
    kind: 'resource_definition',
    version: 1,
    resourceId: 'r1',
    resourceType: 'storage',
    displayName: 'R1',
    ownershipScope: 'shared',
    lifecycleState: 'active',
  }), true);

  assert.equal(isResourceActive({
    kind: 'resource_definition',
    version: 1,
    resourceId: 'r2',
    resourceType: 'storage',
    displayName: 'R2',
    ownershipScope: 'shared',
    lifecycleState: 'draft',
  }), false);
});

// --- Binding Contract Tests ---

test('assertOperationalIdentityBindings accepts a valid bindings file', () => {
  const result = assertOperationalIdentityBindings(createAlfredBindingsContent());

  assert.equal(result.operationalIdentityId, 'alfred');
  assert.equal(result.bindings.length, 4);
  assert.equal(result.bindings[0].resourceId, 'openrouter-api');
  assert.equal(result.bindings[0].accessMode, 'execute');
  assert.equal(result.bindings[0].bindingState, 'active');
});

test('assertOperationalIdentityBindings rejects duplicated resource ids in bindings', () => {
  assert.throws(
    () => assertOperationalIdentityBindings({
      kind: 'operational_identity_bindings',
      version: 1,
      operationalIdentityId: 'alfred',
      bindings: [
        { resourceId: 'r1', accessMode: 'read', bindingState: 'active' },
        { resourceId: 'r1', accessMode: 'write', bindingState: 'active' },
      ],
    }),
    /duplicated resourceId/,
  );
});

test('assertBindingEntry rejects invalid access modes', () => {
  assert.throws(
    () => assertBindingEntry({ resourceId: 'r1', accessMode: 'delete', bindingState: 'active' }, 0),
    /invalid accessMode/,
  );
});

test('assertBindingEntry rejects invalid binding states', () => {
  assert.throws(
    () => assertBindingEntry({ resourceId: 'r1', accessMode: 'read', bindingState: 'destroyed' }, 0),
    /bindingState is invalid/,
  );
});

test('isBindingActive returns true for active bindings and false for draft', () => {
  assert.equal(isBindingActive({ resourceId: 'r1', accessMode: 'read', bindingState: 'active' }), true);
  assert.equal(isBindingActive({ resourceId: 'r2', accessMode: 'read', bindingState: 'draft' }), false);
});

// --- Registry and Resolver Tests ---

test('readResourcesRegistry loads and validates the resource registry', async () => {
  const projectRootPath = await createProjectFixture();

  const { registry } = await readResourcesRegistry({
    masRootPath: path.join(projectRootPath, 'instance'),
  });

  assert.equal(registry.kind, 'resource_registry');
  assert.equal(registry.resources.length, 5);
  assert.equal(registry.resources[0].resourceId, 'openrouter-api');
  assert.equal(registry.resources[4].ownershipScope, 'dedicated');
});

test('readResourcesRegistry returns null registry when resources.json does not exist', async () => {
  const temporaryRootPath = await mkdtemp(path.join(os.tmpdir(), 'openmas-no-resources-'));
  await createDirectoryTree(temporaryRootPath, ['instance/registries']);

  const { registry } = await readResourcesRegistry({
    masRootPath: path.join(temporaryRootPath, 'instance'),
  });

  assert.equal(registry, null);
});

test('resolveResourceDefinition finds a resource by id', async () => {
  const projectRootPath = await createProjectFixture();

  const { registry } = await readResourcesRegistry({
    masRootPath: path.join(projectRootPath, 'instance'),
  });

  const resource = resolveResourceDefinition({ resourceRegistry: registry, resourceId: 'openrouter-api' });

  assert.equal(resource.resourceId, 'openrouter-api');
  assert.equal(resource.resourceType, 'brain-provider');
  assert.equal(resource.ownershipScope, 'shared');
});

test('resolveResourceDefinition throws for unknown resource id', async () => {
  const projectRootPath = await createProjectFixture();

  const { registry } = await readResourcesRegistry({
    masRootPath: path.join(projectRootPath, 'instance'),
  });

  assert.throws(
    () => resolveResourceDefinition({ resourceRegistry: registry, resourceId: 'nonexistent' }),
    /Resource not found/,
  );
});

// --- Binding Definitions Tests ---

test('readBindingDefinitions loads Alfred bindings', async () => {
  const projectRootPath = await createProjectFixture();
  const operationalIdentityRootPath = path.join(projectRootPath, 'instance', 'operational-identities', 'alfred');

  const { bindings } = await readBindingDefinitions({
    operationalIdentityRootPath,
    expectedOperationalIdentityId: 'alfred',
  });

  assert.equal(bindings.operationalIdentityId, 'alfred');
  assert.equal(bindings.bindings.length, 4);
});

test('readBindingDefinitions returns null when bindings.json does not exist', async () => {
  const temporaryRootPath = await mkdtemp(path.join(os.tmpdir(), 'openmas-no-bindings-'));
  await createDirectoryTree(temporaryRootPath, ['oi-root']);

  const { bindings } = await readBindingDefinitions({
    operationalIdentityRootPath: path.join(temporaryRootPath, 'oi-root'),
    expectedOperationalIdentityId: 'test',
  });

  assert.equal(bindings, null);
});

test('readBindingDefinitions rejects operationalIdentityId mismatch', async () => {
  const projectRootPath = await createProjectFixture();
  const operationalIdentityRootPath = path.join(projectRootPath, 'instance', 'operational-identities', 'alfred');

  await assert.rejects(
    () => readBindingDefinitions({
      operationalIdentityRootPath,
      expectedOperationalIdentityId: 'maria',
    }),
    /mismatch/,
  );
});

// --- Resolve Bindings for Invocation Tests ---

test('resolveBindingsForInvocation cross-references Alfred bindings against resources', async () => {
  const projectRootPath = await createProjectFixture();

  const { registry } = await readResourcesRegistry({
    masRootPath: path.join(projectRootPath, 'instance'),
  });

  const { bindings } = await readBindingDefinitions({
    operationalIdentityRootPath: path.join(projectRootPath, 'instance', 'operational-identities', 'alfred'),
    expectedOperationalIdentityId: 'alfred',
  });

  const result = resolveBindingsForInvocation({
    bindingDefinitions: bindings,
    resourceRegistry: registry,
    operationalIdentityId: 'alfred',
  });

  assert.equal(result.resolvedBindings.length, 4);
  assert.equal(result.warnings.length, 0);

  const openRouterBinding = result.resolvedBindings.find((b) => b.resourceId === 'openrouter-api');
  assert.equal(openRouterBinding.resourceType, 'brain-provider');
  assert.equal(openRouterBinding.ownershipScope, 'shared');
  assert.equal(openRouterBinding.accessMode, 'execute');
  assert.equal(openRouterBinding.bindingState, 'active');
  assert.equal(openRouterBinding.resourceLifecycleState, 'active');

  const whatsappBinding = result.resolvedBindings.find((b) => b.resourceId === 'alfred-whatsapp');
  assert.equal(whatsappBinding.resourceType, 'channel');
  assert.equal(whatsappBinding.ownershipScope, 'dedicated');
  assert.equal(whatsappBinding.bindingState, 'draft');
  assert.equal(whatsappBinding.resourceLifecycleState, 'draft');
});

test('resolveBindingsForInvocation warns when a binding references a nonexistent resource', () => {
  const registry = assertResourceRegistry({
    kind: 'resource_registry',
    version: 1,
    resources: [
      {
        kind: 'resource_definition',
        version: 1,
        resourceId: 'only-resource',
        resourceType: 'storage',
        displayName: 'Only Resource',
        ownershipScope: 'shared',
        lifecycleState: 'active',
      },
    ],
  });

  const bindings = assertOperationalIdentityBindings({
    kind: 'operational_identity_bindings',
    version: 1,
    operationalIdentityId: 'test-oi',
    bindings: [
      { resourceId: 'nonexistent-resource', accessMode: 'read', bindingState: 'active' },
    ],
  });

  const result = resolveBindingsForInvocation({
    bindingDefinitions: bindings,
    resourceRegistry: registry,
    operationalIdentityId: 'test-oi',
  });

  assert.equal(result.resolvedBindings.length, 0);
  assert.equal(result.warnings.length, 1);
  assert.ok(result.warnings[0].includes('not found in the registry'));
});

test('resolveBindingsForInvocation warns when an OI tries to bind a dedicated resource owned by another OI', () => {
  const registry = assertResourceRegistry({
    kind: 'resource_registry',
    version: 1,
    resources: [
      {
        kind: 'resource_definition',
        version: 1,
        resourceId: 'maria-instagram',
        resourceType: 'channel',
        displayName: 'Maria Instagram',
        ownershipScope: 'dedicated',
        dedicatedToOperationalIdentityId: 'maria',
        lifecycleState: 'active',
      },
    ],
  });

  const bindings = assertOperationalIdentityBindings({
    kind: 'operational_identity_bindings',
    version: 1,
    operationalIdentityId: 'alfred',
    bindings: [
      { resourceId: 'maria-instagram', accessMode: 'read', bindingState: 'active' },
    ],
  });

  const result = resolveBindingsForInvocation({
    bindingDefinitions: bindings,
    resourceRegistry: registry,
    operationalIdentityId: 'alfred',
  });

  assert.equal(result.resolvedBindings.length, 0);
  assert.equal(result.warnings.length, 1);
  assert.ok(result.warnings[0].includes('dedicated to maria'));
});

test('resolveBindingsForInvocation returns empty when no binding definitions exist', () => {
  const result = resolveBindingsForInvocation({
    bindingDefinitions: null,
    resourceRegistry: null,
    operationalIdentityId: 'test',
  });

  assert.equal(result.resolvedBindings.length, 0);
  assert.equal(result.warnings.length, 0);
});

// --- Integration Tests ---

test('prepareAgentInvocation resolves Alfred bindings during invocation preflight', async () => {
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
  assert.ok(readiness.resolvedBindings !== null);
  assert.equal(readiness.resolvedBindings.resolvedBindings.length, 4);
  assert.ok(Array.isArray(readiness.usableBindings));
  assert.equal(readiness.usableBindings.length, 3);

  const openRouterBinding = readiness.resolvedBindings.resolvedBindings.find((b) => b.resourceId === 'openrouter-api');
  assert.equal(openRouterBinding.resourceType, 'brain-provider');
  assert.equal(openRouterBinding.ownershipScope, 'shared');
  assert.equal(readiness.usableBindings.some((binding) => binding.resourceId === 'alfred-whatsapp'), false);
});

test('prepareAgentInvocation rejects direct Cognitive Identity execution before binding resolution', async () => {
  const projectRootPath = await createProjectFixture();
  const bootResult = await runSystemBoot({ projectRootPath });

  await assert.rejects(
    () => prepareAgentInvocation({
      bootResult,
      request: {
        agentId: 'system-steward',
        command: 'hello',
        requestedBy: 'cli',
      },
    }),
    /operationalIdentityId/u,
  );
});

test('runAgentInvocation persists resolved bindings metadata in invocation session for Alfred', async () => {
  const projectRootPath = await createProjectFixture();

  const result = await runAgentInvocation({
    projectRootPath,
    operationalIdentityId: 'alfred',
    command: 'hello',
    requestedBy: 'cli',
  });

  assert.equal(result.status, 'completed');

  const invocationSession = JSON.parse(await readFile(result.persistence.invocationSessionRecordPath, 'utf8'));

  assert.ok(Array.isArray(invocationSession.resolvedBindings));
  assert.equal(invocationSession.resolvedBindings.length, 4);
  assert.ok(Array.isArray(invocationSession.usableBindings));
  assert.equal(invocationSession.usableBindings.length, 3);

  const openRouterBinding = invocationSession.resolvedBindings.find((b) => b.resourceId === 'openrouter-api');
  assert.equal(openRouterBinding.resourceType, 'brain-provider');
  assert.equal(openRouterBinding.ownershipScope, 'shared');
  assert.equal(openRouterBinding.accessMode, 'execute');
  assert.equal(openRouterBinding.bindingState, 'active');
  assert.equal(openRouterBinding.resourceLifecycleState, 'active');

  const whatsappBinding = invocationSession.resolvedBindings.find((b) => b.resourceId === 'alfred-whatsapp');
  assert.equal(whatsappBinding.resourceType, 'channel');
  assert.equal(whatsappBinding.ownershipScope, 'dedicated');
  assert.equal(whatsappBinding.bindingState, 'draft');
  assert.equal(invocationSession.usableBindings.some((binding) => binding.resourceId === 'alfred-whatsapp'), false);
});
