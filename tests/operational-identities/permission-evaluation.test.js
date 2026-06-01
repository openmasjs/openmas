import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import {
  assertPermissionRule,
  assertOperationalIdentityPermissions,
} from '../../src/contracts/access/permission-contract.js';
import { readPermissionDefinitions } from '../../src/operational-identities/read-permission-definitions.js';
import { evaluatePermissionsForInvocation } from '../../src/operational-identities/evaluate-permissions-for-invocation.js';
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

function createAlfredPermissionsContent() {
  return {
    kind: 'operational_identity_permissions',
    version: 1,
    operationalIdentityId: 'alfred',
    defaultEffect: 'deny',
    rules: [
      {
        ruleId: 'allow-openrouter-execute',
        effect: 'allow',
        resourceId: 'openrouter-api',
        accessModes: ['execute'],
      },
      {
        ruleId: 'allow-gemini-execute',
        effect: 'allow',
        resourceId: 'gemini-api',
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

async function createProjectFixture({ includePermissions = true } = {}) {
  const temporaryRootPath = await mkdtemp(path.join(os.tmpdir(), 'openmas-permission-'));

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

  if (includePermissions) {
    await writeFile(
      path.join(temporaryRootPath, 'instance', 'operational-identities', 'alfred', 'permissions.json'),
      JSON.stringify(createAlfredPermissionsContent(), null, 2),
      'utf8',
    );
  }

  return temporaryRootPath;
}

// --- Permission Contract Tests ---

test('assertPermissionRule accepts a valid permission rule', () => {
  const rule = assertPermissionRule(
    {
      ruleId: 'allow-chatgpt-execute',
      effect: 'allow',
      resourceId: 'openrouter-api',
      accessModes: ['execute'],
    },
    0,
  );

  assert.equal(rule.ruleId, 'allow-chatgpt-execute');
  assert.equal(rule.effect, 'allow');
  assert.equal(rule.resourceId, 'openrouter-api');
  assert.deepEqual(rule.accessModes, ['execute']);
});

test('assertPermissionRule accepts a rule with multiple access modes', () => {
  const rule = assertPermissionRule(
    {
      ruleId: 'allow-storage-readwrite',
      effect: 'allow',
      resourceId: 'mas-filesystem',
      accessModes: ['read', 'write'],
    },
    0,
  );

  assert.deepEqual(rule.accessModes, ['read', 'write']);
});

test('assertPermissionRule rejects invalid effects', () => {
  assert.throws(
    () => assertPermissionRule(
      {
        ruleId: 'bad-rule',
        effect: 'maybe',
        resourceId: 'some-resource',
        accessModes: ['read'],
      },
      0,
    ),
    /invalid effect/,
  );
});

test('assertPermissionRule rejects deny rule effects in the current v1 model', () => {
  assert.throws(
    () => assertPermissionRule(
      {
        ruleId: 'deny-chatgpt-execute',
        effect: 'deny',
        resourceId: 'openrouter-api',
        accessModes: ['execute'],
      },
      0,
    ),
    /must currently use effect "allow"/,
  );
});

test('assertPermissionRule rejects missing ruleId', () => {
  assert.throws(
    () => assertPermissionRule(
      {
        effect: 'allow',
        resourceId: 'some-resource',
        accessModes: ['read'],
      },
      0,
    ),
    /non-empty ruleId/,
  );
});

test('assertPermissionRule rejects invalid access modes in rule', () => {
  assert.throws(
    () => assertPermissionRule(
      {
        ruleId: 'bad-rule',
        effect: 'allow',
        resourceId: 'some-resource',
        accessModes: ['delete'],
      },
      0,
    ),
    /invalid accessMode/,
  );
});

test('assertPermissionRule rejects empty accessModes array', () => {
  assert.throws(
    () => assertPermissionRule(
      {
        ruleId: 'bad-rule',
        effect: 'allow',
        resourceId: 'some-resource',
        accessModes: [],
      },
      0,
    ),
    /non-empty accessModes/,
  );
});

test('assertOperationalIdentityPermissions accepts a valid permissions file', () => {
  const result = assertOperationalIdentityPermissions(createAlfredPermissionsContent());

  assert.equal(result.operationalIdentityId, 'alfred');
  assert.equal(result.defaultEffect, 'deny');
  assert.equal(result.rules.length, 4);
  assert.equal(result.rules[0].ruleId, 'allow-openrouter-execute');
});

test('assertOperationalIdentityPermissions rejects duplicated ruleIds', () => {
  assert.throws(
    () => assertOperationalIdentityPermissions({
      kind: 'operational_identity_permissions',
      version: 1,
      operationalIdentityId: 'alfred',
      defaultEffect: 'deny',
      rules: [
        { ruleId: 'same-rule', effect: 'allow', resourceId: 'r1', accessModes: ['read'] },
        { ruleId: 'same-rule', effect: 'allow', resourceId: 'r2', accessModes: ['write'] },
      ],
    }),
    /duplicated ruleId/,
  );
});

test('assertOperationalIdentityPermissions rejects invalid defaultEffect', () => {
  assert.throws(
    () => assertOperationalIdentityPermissions({
      kind: 'operational_identity_permissions',
      version: 1,
      operationalIdentityId: 'alfred',
      defaultEffect: 'maybe',
      rules: [],
    }),
    /invalid defaultEffect/,
  );
});

test('assertOperationalIdentityPermissions rejects non-deny defaultEffect values in the current v1 model', () => {
  assert.throws(
    () => assertOperationalIdentityPermissions({
      kind: 'operational_identity_permissions',
      version: 1,
      operationalIdentityId: 'alfred',
      defaultEffect: 'allow',
      rules: [],
    }),
    /must currently use defaultEffect "deny"/,
  );
});

test('assertOperationalIdentityPermissions rejects missing defaultEffect', () => {
  assert.throws(
    () => assertOperationalIdentityPermissions({
      kind: 'operational_identity_permissions',
      version: 1,
      operationalIdentityId: 'alfred',
      rules: [],
    }),
    /non-empty defaultEffect/,
  );
});

test('assertOperationalIdentityPermissions rejects invalid kind', () => {
  assert.throws(
    () => assertOperationalIdentityPermissions({
      kind: 'wrong_kind',
      version: 1,
      operationalIdentityId: 'alfred',
      defaultEffect: 'deny',
      rules: [],
    }),
    /operational_identity_permissions/,
  );
});

// --- Permission Reader Tests ---

test('readPermissionDefinitions loads Alfred permissions', async () => {
  const projectRootPath = await createProjectFixture();
  const operationalIdentityRootPath = path.join(projectRootPath, 'instance', 'operational-identities', 'alfred');

  const { permissions } = await readPermissionDefinitions({
    operationalIdentityRootPath,
    expectedOperationalIdentityId: 'alfred',
  });

  assert.equal(permissions.operationalIdentityId, 'alfred');
  assert.equal(permissions.defaultEffect, 'deny');
  assert.equal(permissions.rules.length, 4);
});

test('readPermissionDefinitions returns null when permissions.json does not exist', async () => {
  const temporaryRootPath = await mkdtemp(path.join(os.tmpdir(), 'openmas-no-perms-'));
  await createDirectoryTree(temporaryRootPath, ['oi-root']);

  const { permissions } = await readPermissionDefinitions({
    operationalIdentityRootPath: path.join(temporaryRootPath, 'oi-root'),
    expectedOperationalIdentityId: 'test',
  });

  assert.equal(permissions, null);
});

test('readPermissionDefinitions rejects operationalIdentityId mismatch', async () => {
  const projectRootPath = await createProjectFixture();
  const operationalIdentityRootPath = path.join(projectRootPath, 'instance', 'operational-identities', 'alfred');

  await assert.rejects(
    () => readPermissionDefinitions({
      operationalIdentityRootPath,
      expectedOperationalIdentityId: 'maria',
    }),
    /mismatch/,
  );
});

// --- Permission Evaluation Tests ---

test('evaluatePermissionsForInvocation allows all bindings when rules match and states are active', () => {
  const resolvedBindings = [
    {
      resourceId: 'openrouter-api',
      accessMode: 'execute',
      bindingState: 'active',
      resourceType: 'brain-provider',
      resourceDisplayName: 'OpenRouter API',
      ownershipScope: 'shared',
      resourceLifecycleState: 'active',
    },
    {
      resourceId: 'mas-filesystem',
      accessMode: 'read',
      bindingState: 'active',
      resourceType: 'storage',
      resourceDisplayName: 'MAS Filesystem',
      ownershipScope: 'shared',
      resourceLifecycleState: 'active',
    },
  ];

  const permissionDefinitions = assertOperationalIdentityPermissions({
    kind: 'operational_identity_permissions',
    version: 1,
    operationalIdentityId: 'test-oi',
    defaultEffect: 'deny',
    rules: [
      { ruleId: 'allow-openrouter', effect: 'allow', resourceId: 'openrouter-api', accessModes: ['execute'] },
      { ruleId: 'allow-fs', effect: 'allow', resourceId: 'mas-filesystem', accessModes: ['read'] },
    ],
  });

  const result = evaluatePermissionsForInvocation({ resolvedBindings, permissionDefinitions });

  assert.equal(result.summary.totalEvaluated, 2);
  assert.equal(result.summary.allowed, 2);
  assert.equal(result.summary.denied, 0);
  assert.equal(result.allPermitted, true);

  assert.equal(result.evaluatedBindings[0].effect, 'allow');
  assert.equal(result.evaluatedBindings[0].matchedRuleId, 'allow-openrouter');
  assert.ok(result.evaluatedBindings[0].reason.includes('Explicit allow rule'));
});

test('evaluatePermissionsForInvocation denies binding when no matching rule exists', () => {
  const resolvedBindings = [
    {
      resourceId: 'secret-resource',
      accessMode: 'write',
      bindingState: 'active',
      resourceType: 'storage',
      resourceDisplayName: 'Secret Resource',
      ownershipScope: 'shared',
      resourceLifecycleState: 'active',
    },
  ];

  const permissionDefinitions = assertOperationalIdentityPermissions({
    kind: 'operational_identity_permissions',
    version: 1,
    operationalIdentityId: 'test-oi',
    defaultEffect: 'deny',
    rules: [],
  });

  const result = evaluatePermissionsForInvocation({ resolvedBindings, permissionDefinitions });

  assert.equal(result.summary.totalEvaluated, 1);
  assert.equal(result.summary.denied, 1);
  assert.equal(result.allPermitted, false);

  assert.equal(result.evaluatedBindings[0].effect, 'deny');
  assert.equal(result.evaluatedBindings[0].matchedRuleId, null);
  assert.ok(result.evaluatedBindings[0].reason.includes('No allow rule found'));
});

test('evaluatePermissionsForInvocation denies binding when binding state is not active (Gate 2)', () => {
  const resolvedBindings = [
    {
      resourceId: 'alfred-whatsapp',
      accessMode: 'publish',
      bindingState: 'draft',
      resourceType: 'channel',
      resourceDisplayName: 'Alfred WhatsApp',
      ownershipScope: 'dedicated',
      resourceLifecycleState: 'draft',
    },
  ];

  const permissionDefinitions = assertOperationalIdentityPermissions({
    kind: 'operational_identity_permissions',
    version: 1,
    operationalIdentityId: 'alfred',
    defaultEffect: 'deny',
    rules: [
      { ruleId: 'allow-whatsapp-publish', effect: 'allow', resourceId: 'alfred-whatsapp', accessModes: ['publish'] },
    ],
  });

  const result = evaluatePermissionsForInvocation({ resolvedBindings, permissionDefinitions });

  assert.equal(result.summary.denied, 1);
  assert.equal(result.allPermitted, false);

  assert.equal(result.evaluatedBindings[0].effect, 'deny');
  assert.equal(result.evaluatedBindings[0].matchedRuleId, 'allow-whatsapp-publish');
  assert.ok(result.evaluatedBindings[0].reason.includes('binding state is not active'));
  assert.ok(result.evaluatedBindings[0].reason.includes('draft'));
});

test('evaluatePermissionsForInvocation denies binding when resource lifecycle is not active (Gate 3)', () => {
  const resolvedBindings = [
    {
      resourceId: 'suspended-tool',
      accessMode: 'execute',
      bindingState: 'active',
      resourceType: 'tool',
      resourceDisplayName: 'Suspended Tool',
      ownershipScope: 'shared',
      resourceLifecycleState: 'suspended',
    },
  ];

  const permissionDefinitions = assertOperationalIdentityPermissions({
    kind: 'operational_identity_permissions',
    version: 1,
    operationalIdentityId: 'test-oi',
    defaultEffect: 'deny',
    rules: [
      { ruleId: 'allow-tool-execute', effect: 'allow', resourceId: 'suspended-tool', accessModes: ['execute'] },
    ],
  });

  const result = evaluatePermissionsForInvocation({ resolvedBindings, permissionDefinitions });

  assert.equal(result.summary.denied, 1);
  assert.equal(result.allPermitted, false);

  assert.equal(result.evaluatedBindings[0].effect, 'deny');
  assert.equal(result.evaluatedBindings[0].matchedRuleId, 'allow-tool-execute');
  assert.ok(result.evaluatedBindings[0].reason.includes('resource lifecycle state is not active'));
  assert.ok(result.evaluatedBindings[0].reason.includes('suspended'));
});

test('evaluatePermissionsForInvocation handles mixed allow and deny decisions', () => {
  const resolvedBindings = [
    {
      resourceId: 'openrouter-api',
      accessMode: 'execute',
      bindingState: 'active',
      resourceType: 'brain-provider',
      resourceDisplayName: 'OpenRouter API',
      ownershipScope: 'shared',
      resourceLifecycleState: 'active',
    },
    {
      resourceId: 'alfred-whatsapp',
      accessMode: 'publish',
      bindingState: 'draft',
      resourceType: 'channel',
      resourceDisplayName: 'Alfred WhatsApp',
      ownershipScope: 'dedicated',
      resourceLifecycleState: 'draft',
    },
    {
      resourceId: 'unauthorized-resource',
      accessMode: 'write',
      bindingState: 'active',
      resourceType: 'storage',
      resourceDisplayName: 'Unauthorized Resource',
      ownershipScope: 'shared',
      resourceLifecycleState: 'active',
    },
  ];

  const permissionDefinitions = assertOperationalIdentityPermissions({
    kind: 'operational_identity_permissions',
    version: 1,
    operationalIdentityId: 'alfred',
    defaultEffect: 'deny',
    rules: [
      { ruleId: 'allow-openrouter', effect: 'allow', resourceId: 'openrouter-api', accessModes: ['execute'] },
      { ruleId: 'allow-whatsapp', effect: 'allow', resourceId: 'alfred-whatsapp', accessModes: ['publish'] },
    ],
  });

  const result = evaluatePermissionsForInvocation({ resolvedBindings, permissionDefinitions });

  assert.equal(result.summary.totalEvaluated, 3);
  assert.equal(result.summary.allowed, 1);
  assert.equal(result.summary.denied, 2);
  assert.equal(result.allPermitted, false);

  const openRouterDecision = result.evaluatedBindings.find((d) => d.resourceId === 'openrouter-api');
  assert.equal(openRouterDecision.effect, 'allow');

  const whatsappDecision = result.evaluatedBindings.find((d) => d.resourceId === 'alfred-whatsapp');
  assert.equal(whatsappDecision.effect, 'deny');
  assert.ok(whatsappDecision.reason.includes('binding state is not active'));

  const unauthorizedDecision = result.evaluatedBindings.find((d) => d.resourceId === 'unauthorized-resource');
  assert.equal(unauthorizedDecision.effect, 'deny');
  assert.ok(unauthorizedDecision.reason.includes('No allow rule found'));
});

test('evaluatePermissionsForInvocation returns empty evaluation for empty resolved bindings', () => {
  const permissionDefinitions = assertOperationalIdentityPermissions({
    kind: 'operational_identity_permissions',
    version: 1,
    operationalIdentityId: 'test-oi',
    defaultEffect: 'deny',
    rules: [],
  });

  const result = evaluatePermissionsForInvocation({
    resolvedBindings: [],
    permissionDefinitions,
  });

  assert.equal(result.summary.totalEvaluated, 0);
  assert.equal(result.allPermitted, true);
});

test('evaluatePermissionsForInvocation returns empty evaluation when permission definitions are null', () => {
  const result = evaluatePermissionsForInvocation({
    resolvedBindings: [
      {
        resourceId: 'openrouter-api',
        accessMode: 'execute',
        bindingState: 'active',
        resourceType: 'brain-provider',
        resourceDisplayName: 'OpenRouter API',
        ownershipScope: 'shared',
        resourceLifecycleState: 'active',
      },
    ],
    permissionDefinitions: null,
  });

  assert.equal(result.summary.totalEvaluated, 0);
  assert.equal(result.allPermitted, true);
});

test('evaluatePermissionsForInvocation denies when access mode does not match rule', () => {
  const resolvedBindings = [
    {
      resourceId: 'mas-filesystem',
      accessMode: 'write',
      bindingState: 'active',
      resourceType: 'storage',
      resourceDisplayName: 'MAS Filesystem',
      ownershipScope: 'shared',
      resourceLifecycleState: 'active',
    },
  ];

  const permissionDefinitions = assertOperationalIdentityPermissions({
    kind: 'operational_identity_permissions',
    version: 1,
    operationalIdentityId: 'test-oi',
    defaultEffect: 'deny',
    rules: [
      { ruleId: 'allow-fs-read', effect: 'allow', resourceId: 'mas-filesystem', accessModes: ['read'] },
    ],
  });

  const result = evaluatePermissionsForInvocation({ resolvedBindings, permissionDefinitions });

  assert.equal(result.summary.denied, 1);
  assert.equal(result.evaluatedBindings[0].effect, 'deny');
  assert.ok(result.evaluatedBindings[0].reason.includes('No allow rule found'));
  assert.ok(result.evaluatedBindings[0].reason.includes('write'));
});

// --- Integration Tests ---

test('prepareAgentInvocation evaluates Alfred permissions during invocation preflight', async () => {
  const projectRootPath = await createProjectFixture({ includePermissions: true });
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
  assert.ok(readiness.permissionEvaluation !== null);
  assert.equal(readiness.permissionEvaluation.summary.totalEvaluated, 4);
  assert.equal(readiness.permissionEvaluation.summary.allowed, 3);
  assert.equal(readiness.permissionEvaluation.summary.denied, 1);
  assert.equal(readiness.permissionEvaluation.allPermitted, false);
  assert.ok(Array.isArray(readiness.usableBindings));
  assert.equal(readiness.usableBindings.length, 3);

  const openRouterDecision = readiness.permissionEvaluation.evaluatedBindings.find((d) => d.resourceId === 'openrouter-api');
  assert.equal(openRouterDecision.effect, 'allow');

  const whatsappDecision = readiness.permissionEvaluation.evaluatedBindings.find((d) => d.resourceId === 'alfred-whatsapp');
  assert.equal(whatsappDecision.effect, 'deny');
  assert.ok(whatsappDecision.reason.includes('binding state is not active'));
  assert.equal(readiness.usableBindings.some((binding) => binding.resourceId === 'alfred-whatsapp'), false);
});

test('prepareAgentInvocation returns null permissionEvaluation when permissions.json does not exist', async () => {
  const projectRootPath = await createProjectFixture({ includePermissions: false });
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
  assert.equal(readiness.permissionEvaluation, null);
  assert.ok(Array.isArray(readiness.usableBindings));
  assert.equal(readiness.usableBindings.length, 3);
  assert.equal(readiness.usableBindings.some((binding) => binding.resourceId === 'alfred-whatsapp'), false);
});

test('prepareAgentInvocation rejects direct Cognitive Identity execution before permission evaluation', async () => {
  const projectRootPath = await createProjectFixture({ includePermissions: true });
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

test('prepareAgentInvocation includes denied permissions as warnings', async () => {
  const projectRootPath = await createProjectFixture({ includePermissions: true });
  const bootResult = await runSystemBoot({ projectRootPath });

  const readiness = await prepareAgentInvocation({
    bootResult,
    request: {
      operationalIdentityId: 'alfred',
      command: 'hello',
      requestedBy: 'cli',
    },
  });

  const permissionWarnings = readiness.warnings.filter((w) => w.includes('Permission denied'));
  assert.equal(permissionWarnings.length, 1);
  assert.ok(permissionWarnings[0].includes('alfred-whatsapp'));
  assert.ok(permissionWarnings[0].includes('publish'));
});

test('runAgentInvocation persists permission evaluation in invocation session for Alfred', async () => {
  const projectRootPath = await createProjectFixture({ includePermissions: true });

  const result = await runAgentInvocation({
    projectRootPath,
    operationalIdentityId: 'alfred',
    command: 'hello',
    requestedBy: 'cli',
  });

  assert.equal(result.status, 'completed');
  assert.ok(result.warnings.some((warning) => warning.includes('Permission denied for resource alfred-whatsapp')));

  const invocationSession = JSON.parse(await readFile(result.persistence.invocationSessionRecordPath, 'utf8'));

  assert.ok(invocationSession.permissionEvaluation !== null);
  assert.ok(Array.isArray(invocationSession.usableBindings));
  assert.equal(invocationSession.usableBindings.length, 3);
  assert.equal(invocationSession.permissionEvaluation.summary.totalEvaluated, 4);
  assert.equal(invocationSession.permissionEvaluation.summary.allowed, 3);
  assert.equal(invocationSession.permissionEvaluation.summary.denied, 1);

  const openRouterDecision = invocationSession.permissionEvaluation.evaluatedBindings.find((d) => d.resourceId === 'openrouter-api');
  assert.equal(openRouterDecision.effect, 'allow');
  assert.equal(openRouterDecision.matchedRuleId, 'allow-openrouter-execute');
  assert.ok(openRouterDecision.reason.includes('Explicit allow rule'));

  const whatsappDecision = invocationSession.permissionEvaluation.evaluatedBindings.find((d) => d.resourceId === 'alfred-whatsapp');
  assert.equal(whatsappDecision.effect, 'deny');
  assert.ok(whatsappDecision.reason.includes('binding state is not active'));
  assert.equal(invocationSession.usableBindings.some((binding) => binding.resourceId === 'alfred-whatsapp'), false);
});

test('runAgentInvocation persists null permission evaluation when no permissions file exists', async () => {
  const projectRootPath = await createProjectFixture({ includePermissions: false });

  const result = await runAgentInvocation({
    projectRootPath,
    operationalIdentityId: 'alfred',
    command: 'hello',
    requestedBy: 'cli',
  });

  assert.equal(result.status, 'completed');

  const invocationSession = JSON.parse(await readFile(result.persistence.invocationSessionRecordPath, 'utf8'));

  assert.equal(invocationSession.permissionEvaluation, null);
  assert.ok(Array.isArray(invocationSession.usableBindings));
  assert.equal(invocationSession.usableBindings.length, 3);
  assert.equal(invocationSession.usableBindings.some((binding) => binding.resourceId === 'alfred-whatsapp'), false);
});
