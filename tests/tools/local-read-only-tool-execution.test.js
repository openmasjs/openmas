import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { readToolDefinitions } from '../../src/tools/read-tool-definitions.js';
import { evaluatePermissionsForInvocation } from '../../src/operational-identities/evaluate-permissions-for-invocation.js';
import { evaluateToolReadinessForInvocation } from '../../src/tools/evaluate-tool-readiness-for-invocation.js';
import { executeLocalReadOnlyToolForInvocation } from '../../src/tools/execute-local-read-only-tool-for-invocation.js';

async function createDirectoryTree(rootPath, relativePaths) {
  for (const relativePath of relativePaths) {
    await mkdir(path.join(rootPath, relativePath), { recursive: true });
  }
}

function buildToolDefinition(overrides = {}) {
  return {
    kind: 'tool_definition',
    version: 1,
    toolId: 'mas.system.inspect',
    displayName: 'MAS System Inspect',
    description: 'Inspects safe MAS system state.',
    lifecycleState: 'active',
    owner: 'mas',
    toolType: 'local_js_module',
    sideEffectLevel: 'read_only',
    inputSchema: {
      type: 'object',
    },
    outputSchema: {
      type: 'object',
    },
    requiredResourceTypes: ['storage'],
    requiredAccessModes: ['read'],
    requiredPermissionModes: ['tool.execute'],
    approvalPolicy: {
      required: false,
    },
    execution: {
      modulePath: 'executor.js',
      timeoutMs: 10000,
      retryPolicy: {
        enabled: false,
      },
    },
    artifactPolicy: {
      persistResult: false,
    },
    memoryPolicy: {
      allowWritebackCandidates: false,
    },
    ...overrides,
  };
}

function buildResolvedBindings(overrides = {}) {
  return [
    {
      resourceId: 'mas-filesystem',
      accessMode: 'read',
      bindingState: 'active',
      secretReferenceId: null,
      resourceType: 'storage',
      resourceDisplayName: 'MAS Filesystem',
      ownershipScope: 'shared',
      resourceLifecycleState: 'active',
      ...overrides,
    },
  ];
}

function buildPermissionEvaluation({ resolvedBindings }) {
  return evaluatePermissionsForInvocation({
    resolvedBindings,
    permissionDefinitions: {
      kind: 'operational_identity_permissions',
      version: 1,
      operationalIdentityId: 'alfred',
      defaultEffect: 'deny',
      rules: [
        {
          ruleId: 'allow-mas-filesystem-read',
          effect: 'allow',
          resourceId: 'mas-filesystem',
          accessModes: ['read'],
        },
      ],
    },
  });
}

async function createMasToolFixture({ executorSource } = {}) {
  const temporaryRootPath = await mkdtemp(path.join(os.tmpdir(), 'openmas-local-tool-'));
  const masRootPath = path.join(temporaryRootPath, 'instance');

  await createDirectoryTree(masRootPath, [
    'cognitive-identities',
    'memory',
    'memory/state',
    'memory/artifacts',
    'operational-identities',
    'registries',
    'tools',
    'tools/mas.system.inspect',
    'workflows',
  ]);
  await writeFile(
    path.join(masRootPath, 'registries', 'cognitive-identities.json'),
    JSON.stringify({
      kind: 'cognitive_identities_registry',
      version: 1,
      cognitiveIdentities: [
        {
          cognitiveIdentityId: 'system-steward',
          rootPath: 'system-steward',
          category: 'platform',
        },
      ],
    }, null, 2),
    'utf8',
  );
  await writeFile(
    path.join(masRootPath, 'registries', 'operational-identities.json'),
    JSON.stringify({
      kind: 'operational_identities_registry',
      version: 1,
      operationalIdentities: [
        {
          operationalIdentityId: 'alfred',
          rootPath: 'alfred',
          category: 'platform',
        },
      ],
    }, null, 2),
    'utf8',
  );
  await writeFile(
    path.join(masRootPath, 'registries', 'resources.json'),
    JSON.stringify({
      kind: 'resource_registry',
      version: 1,
      resources: [
        {
          kind: 'resource_definition',
          version: 1,
          resourceId: 'mas-filesystem',
          resourceType: 'storage',
          displayName: 'MAS Filesystem',
          ownershipScope: 'shared',
          lifecycleState: 'active',
        },
      ],
    }, null, 2),
    'utf8',
  );
  await writeFile(
    path.join(masRootPath, 'tools', 'mas.system.inspect', 'tool.json'),
    JSON.stringify(buildToolDefinition(), null, 2),
    'utf8',
  );
  await writeFile(
    path.join(masRootPath, 'tools', 'mas.system.inspect', 'executor.js'),
    executorSource ?? [
      'export async function executeTool({ input, masRootPath, toolRunId }) {',
      '  return {',
      '    summary: "Fixture MAS inspection completed.",',
      '    data: {',
      '      inputEcho: input,',
      '      masRootPathEndsWithInstance: masRootPath.endsWith("instance"),',
      '      toolRunIdPrefix: toolRunId.slice(0, 9)',
      '    },',
      '    warnings: []',
      '  };',
      '}',
    ].join('\n'),
    'utf8',
  );

  return {
    temporaryRootPath,
    masRootPath,
  };
}

async function prepareReadyTool({ masRootPath }) {
  const toolRegistry = await readToolDefinitions({ masRootPath });
  const toolDefinition = toolRegistry.toolDefinitions.find((definition) => {
    return definition.toolId === 'mas.system.inspect';
  });
  const resolvedBindings = buildResolvedBindings();
  const permissionEvaluation = buildPermissionEvaluation({ resolvedBindings });
  const toolReadiness = evaluateToolReadinessForInvocation({
    toolDefinitions: [toolDefinition],
    resolvedBindings,
    permissionEvaluation,
  });

  return {
    toolDefinition,
    readinessVerdict: toolReadiness.evaluatedTools[0],
  };
}

async function executeCheckedInMasSystemInspect({ input = {} } = {}) {
  const masRootPath = path.resolve('instance');
  const toolRegistry = await readToolDefinitions({ masRootPath });
  const toolDefinition = toolRegistry.toolDefinitions.find((definition) => {
    return definition.toolId === 'mas.system.inspect';
  });
  const resolvedBindings = buildResolvedBindings();
  const permissionEvaluation = buildPermissionEvaluation({ resolvedBindings });
  const readinessEvaluation = evaluateToolReadinessForInvocation({
    toolDefinitions: [toolDefinition],
    resolvedBindings,
    permissionEvaluation,
  });
  const result = await executeLocalReadOnlyToolForInvocation({
    masRootPath,
    toolDefinition,
    readinessVerdict: readinessEvaluation.evaluatedTools[0],
    input,
    invocationId: 'invocation-checked-in-tool-test-001',
    operationalIdentityId: 'alfred',
    requestedBy: 'test-suite',
  });

  return {
    masRootPath,
    readinessVerdict: readinessEvaluation.evaluatedTools[0],
    result,
  };
}

test('executeLocalReadOnlyToolForInvocation executes a ready local read-only tool through the framework runner', async () => {
  const { masRootPath } = await createMasToolFixture();
  const { toolDefinition, readinessVerdict } = await prepareReadyTool({ masRootPath });

  const result = await executeLocalReadOnlyToolForInvocation({
    masRootPath,
    toolDefinition,
    readinessVerdict,
    input: {
      includeCounts: true,
    },
    invocationId: 'invocation-tool-test-001',
    operationalIdentityId: 'alfred',
    requestedBy: 'test-suite',
  });
  const serializedResult = JSON.stringify(result);

  assert.equal(result.kind, 'tool_result');
  assert.equal(result.toolId, 'mas.system.inspect');
  assert.equal(result.status, 'succeeded');
  assert.match(result.toolRunId, /^tool-run-/u);
  assert.equal(result.summary, 'Fixture MAS inspection completed.');
  assert.equal(result.data.inputEcho.includeCounts, true);
  assert.equal(result.data.masRootPathEndsWithInstance, true);
  assert.equal(result.audit.invocationId, 'invocation-tool-test-001');
  assert.equal(result.audit.operationalIdentityId, 'alfred');
  assert.equal(serializedResult.includes('SECRET_VALUE'), false);
});

test('executeLocalReadOnlyToolForInvocation returns a normalized failed tool result when executor throws', async () => {
  const { masRootPath } = await createMasToolFixture({
    executorSource: [
      'export async function executeTool() {',
      '  throw new Error("fixture executor exploded");',
      '}',
    ].join('\n'),
  });
  const { toolDefinition, readinessVerdict } = await prepareReadyTool({ masRootPath });

  const result = await executeLocalReadOnlyToolForInvocation({
    masRootPath,
    toolDefinition,
    readinessVerdict,
    input: {},
    invocationId: 'invocation-tool-test-002',
    operationalIdentityId: 'alfred',
    requestedBy: 'test-suite',
  });

  assert.equal(result.status, 'failed');
  assert.match(result.summary, /failed during local read-only execution/u);
  assert.match(result.errors[0], /fixture executor exploded/u);
  assert.equal(result.audit.invocationId, 'invocation-tool-test-002');
});

test('executeLocalReadOnlyToolForInvocation rejects non-ready or unsafe tool execution before loading executor code', async () => {
  const { masRootPath } = await createMasToolFixture();
  const { toolDefinition, readinessVerdict } = await prepareReadyTool({ masRootPath });

  await assert.rejects(
    () => executeLocalReadOnlyToolForInvocation({
      masRootPath,
      toolDefinition,
      readinessVerdict: {
        ...readinessVerdict,
        status: 'denied',
        missingRequirements: [
          {
            resourceType: 'storage',
            accessMode: 'read',
            reason: 'Denied for test.',
          },
        ],
      },
      input: {},
      invocationId: 'invocation-tool-test-003',
      operationalIdentityId: 'alfred',
      requestedBy: 'test-suite',
    }),
    /readiness status is denied/u,
  );

  await assert.rejects(
    () => executeLocalReadOnlyToolForInvocation({
      masRootPath,
      toolDefinition: {
        ...toolDefinition,
        sideEffectLevel: 'write_internal',
      },
      readinessVerdict,
      input: {},
      invocationId: 'invocation-tool-test-004',
      operationalIdentityId: 'alfred',
      requestedBy: 'test-suite',
    }),
    /sideEffectLevel is write_internal/u,
  );
});

test('checked-in mas.system.inspect tool can be read, pass readiness, and execute as a read-only local tool', async () => {
  const { masRootPath, readinessVerdict, result } = await executeCheckedInMasSystemInspect();

  assert.equal(readinessVerdict.status, 'ready');
  assert.equal(result.status, 'succeeded');
  assert.equal(result.toolId, 'mas.system.inspect');
  assert.equal(result.data.inspectionVersion, 2);
  assert.equal(result.data.toolIds.includes('mas.system.inspect'), true);
  assert.equal(typeof result.data.registeredCognitiveIdentityCount, 'number');
  assert.equal(typeof result.data.operationalIdentityCount, 'number');
  assert.equal(result.data.sections.cognitiveIdentities.evidenceLabel, 'registered_cognitive_identities_only');
  assert.match(result.data.sections.cognitiveIdentities.caution, /Do not describe registered Cognitive Identities as active workers/u);
  assert.equal(result.data.sections.cognitiveIdentities.cognitiveIdentities, undefined);
  assert.equal(result.data.sections.tools.readinessEvaluation.status, 'not_evaluated_by_inspect_tool');
  assert.equal(
    result.data.diagnosticSummary.keySemantics.some((semantic) => {
      return semantic.includes('do not call them active workers');
    }),
    true,
  );

  const serializedResult = JSON.stringify(result);
  assert.equal(Buffer.byteLength(JSON.stringify(result.data), 'utf8') < 8192, true);
  assert.doesNotMatch(serializedResult, /AIza|sk-or-v1|SECRET_VALUE/u);

  const toolFileContents = await readFile(path.join(masRootPath, 'tools', 'mas.system.inspect', 'tool.json'), 'utf8');
  assert.match(toolFileContents, /"sideEffectLevel": "read_only"/u);
});

test('checked-in mas.system.inspect v2 supports bounded section selection and warning evidence', async () => {
  const { result } = await executeCheckedInMasSystemInspect({
    input: {
      sections: ['tools', 'cognitiveIdentities', 'not-a-real-section'],
      includeCounts: false,
      includeReadiness: true,
    },
  });

  assert.equal(result.status, 'succeeded');
  assert.deepEqual(result.data.includedSections, ['cognitiveIdentities', 'tools']);
  assert.equal(result.data.sections.cognitiveIdentities.registeredCount, undefined);
  assert.equal(result.data.sections.resources, undefined);
  assert.equal(result.data.sections.tools.readinessEvaluation.status, 'not_evaluated_by_inspect_tool');
  assert.match(result.warnings.join('\n'), /Ignored unsupported MAS inspect section: not-a-real-section/u);
  assert.equal(typeof result.data.registeredCognitiveIdentityCount, 'number');
});
