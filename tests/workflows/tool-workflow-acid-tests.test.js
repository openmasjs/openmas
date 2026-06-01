import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { runWorkflow } from '../../src/workflows/run-workflow.js';
import { buildFakeGeminiSecretProbe } from '../helpers/fake-secret-probes.js';

const FAKE_GEMINI_SECRET_VALUE = buildFakeGeminiSecretProbe('FAKE_TOOL_SECRET_SHOULD_NOT_LEAK_123');
const FAKE_BEARER_SECRET_VALUE = 'Bearer fake-token-that-must-not-leak';
const FAKE_FAILURE_SECRET_VALUE = buildFakeGeminiSecretProbe('FAKE_FAILURE_SECRET_SHOULD_NOT_LEAK_456');

async function createDirectoryTree(rootPath, relativePaths) {
  for (const relativePath of relativePaths) {
    await mkdir(path.join(rootPath, relativePath), { recursive: true });
  }
}

async function writeJsonFile(filePath, payload) {
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function buildResourceDefinition({
  resourceId,
  resourceType,
  displayName = resourceId,
  ownershipScope = 'shared',
  dedicatedToOperationalIdentityId = null,
  lifecycleState = 'active',
}) {
  return {
    kind: 'resource_definition',
    version: 1,
    resourceId,
    resourceType,
    displayName,
    ownershipScope,
    ...(ownershipScope === 'dedicated' ? { dedicatedToOperationalIdentityId } : {}),
    lifecycleState,
  };
}

function buildBinding({
  resourceId,
  accessMode,
  bindingState = 'active',
  credentialReferenceId = null,
}) {
  return {
    resourceId,
    accessMode,
    bindingState,
    credentialReferenceId,
  };
}

function buildAllowRule({
  ruleId,
  resourceId,
  accessModes,
}) {
  return {
    ruleId,
    effect: 'allow',
    resourceId,
    accessModes,
  };
}

function buildToolDefinition({
  toolId,
  displayName = toolId,
  description = `${toolId} acid test tool.`,
  owner = 'mas',
  sideEffectLevel = 'read_only',
  requiredResourceTypes = ['storage'],
  requiredAccessModes = ['read'],
  requiredPermissionModes = ['tool.execute'],
  approvalRequired = false,
  persistResult = false,
  allowWritebackCandidates = false,
}) {
  return {
    kind: 'tool_definition',
    version: 1,
    toolId,
    displayName,
    description,
    lifecycleState: 'active',
    owner,
    toolType: 'local_js_module',
    sideEffectLevel,
    inputSchema: {
      type: 'object',
    },
    outputSchema: {
      type: 'object',
    },
    requiredResourceTypes,
    requiredAccessModes,
    requiredPermissionModes,
    approvalPolicy: {
      required: approvalRequired,
    },
    execution: {
      modulePath: 'executor.js',
      timeoutMs: 10000,
      retryPolicy: {
        enabled: false,
      },
    },
    artifactPolicy: {
      persistResult,
    },
    memoryPolicy: {
      allowWritebackCandidates,
    },
  };
}

function buildWorkflowRuntimeDefinition({
  workflowId,
  steps,
  allowWritebackCandidates = false,
}) {
  return {
    kind: 'workflow_runtime_definition',
    version: 1,
    workflowId,
    lifecycleState: 'active',
    executionMode: 'on_demand',
    statePolicy: {
      persistState: true,
      resumeAllowed: true,
    },
    steps,
    approvalPolicy: {
      defaultRequiredForSideEffectLevels: [
        'write_external',
        'publish_external',
        'financial',
        'destructive',
      ],
    },
    artifactPolicy: {
      persistFinalReport: true,
    },
    memoryPolicy: {
      allowWritebackCandidates,
    },
  };
}

function defaultExecutorSource(toolId) {
  return [
    'export async function executeTool() {',
    '  return {',
    '    status: "succeeded",',
    `    summary: "${toolId} acid fixture executed.",`,
    '    data: { ok: true },',
    '    warnings: [],',
    '    errors: []',
    '  };',
    '}',
  ].join('\n');
}

async function createAcidFixture({
  operationalIdentityId,
  resources,
  bindings,
  permissionRules,
  toolDefinitions,
  workflowRuntimeDefinition,
  executorSources = {},
}) {
  const temporaryRootPath = await mkdtemp(path.join(os.tmpdir(), 'openmas-tw-acid-'));
  const masRootPath = path.join(temporaryRootPath, 'instance');
  const workflowId = workflowRuntimeDefinition.workflowId;
  const relativePaths = [
    'memory',
    'memory/state',
    'memory/artifacts',
    'operational-identities',
    `operational-identities/${operationalIdentityId}`,
    'registries',
    'tools',
    'workflows',
    `workflows/${workflowId}`,
    ...toolDefinitions.map((toolDefinition) => `tools/${toolDefinition.toolId}`),
  ];

  await createDirectoryTree(masRootPath, relativePaths);
  await writeJsonFile(
    path.join(masRootPath, 'registries', 'operational-identities.json'),
    {
      kind: 'operational_identities_registry',
      version: 1,
      operationalIdentities: [
        {
          operationalIdentityId,
          rootPath: operationalIdentityId,
          category: 'acid-test',
        },
      ],
    },
  );
  await writeJsonFile(
    path.join(masRootPath, 'registries', 'resources.json'),
    {
      kind: 'resource_registry',
      version: 1,
      resources,
    },
  );
  await writeJsonFile(
    path.join(masRootPath, 'operational-identities', operationalIdentityId, 'bindings.json'),
    {
      kind: 'operational_identity_bindings',
      version: 1,
      operationalIdentityId,
      bindings,
    },
  );
  await writeJsonFile(
    path.join(masRootPath, 'operational-identities', operationalIdentityId, 'permissions.json'),
    {
      kind: 'operational_identity_permissions',
      version: 1,
      operationalIdentityId,
      defaultEffect: 'deny',
      rules: permissionRules,
    },
  );

  for (const toolDefinition of toolDefinitions) {
    await writeJsonFile(
      path.join(masRootPath, 'tools', toolDefinition.toolId, 'tool.json'),
      toolDefinition,
    );
    await writeFile(
      path.join(masRootPath, 'tools', toolDefinition.toolId, 'executor.js'),
      executorSources[toolDefinition.toolId] ?? defaultExecutorSource(toolDefinition.toolId),
      'utf8',
    );
  }

  await writeJsonFile(
    path.join(masRootPath, 'workflows', workflowId, 'runtime.json'),
    workflowRuntimeDefinition,
  );

  return {
    masRootPath,
  };
}

function readTextFile(filePath) {
  return readFile(filePath, 'utf8');
}

test('TW acid: Alfred safe inspection persists redacted audit and governed writeback without leaking tool secrets', async () => {
  const toolDefinition = buildToolDefinition({
    toolId: 'mas.system.inspect',
    displayName: 'MAS System Inspect',
    persistResult: true,
    allowWritebackCandidates: true,
  });
  const workflowRuntimeDefinition = buildWorkflowRuntimeDefinition({
    workflowId: 'alfred-safe-inspection-acid',
    allowWritebackCandidates: true,
    steps: [
      {
        stepId: 'inspect-system',
        stepType: 'tool_call',
        toolId: 'mas.system.inspect',
        input: {
          includeCounts: true,
        },
        onFailure: 'fail_workflow',
      },
    ],
  });
  const { masRootPath } = await createAcidFixture({
    operationalIdentityId: 'alfred',
    resources: [
      buildResourceDefinition({
        resourceId: 'mas-filesystem',
        resourceType: 'storage',
        displayName: 'MAS Filesystem',
      }),
    ],
    bindings: [
      buildBinding({
        resourceId: 'mas-filesystem',
        accessMode: 'read',
      }),
    ],
    permissionRules: [
      buildAllowRule({
        ruleId: 'allow-alfred-mas-filesystem-read',
        resourceId: 'mas-filesystem',
        accessModes: ['read'],
      }),
    ],
    toolDefinitions: [toolDefinition],
    workflowRuntimeDefinition,
    executorSources: {
      'mas.system.inspect': [
        'export async function executeTool({ input }) {',
        '  return {',
        '    status: "succeeded",',
        '    summary: "Alfred completed safe MAS inspection.",',
        '    data: {',
        `      apiKey: "${FAKE_GEMINI_SECRET_VALUE}",`,
        `      nestedAuthorization: "${FAKE_BEARER_SECRET_VALUE}",`,
        '      inputEcho: input,',
        '      registeredOperationalIdentities: ["alfred"]',
        '    },',
        '    warnings: [],',
        '    errors: []',
        '  };',
        '}',
      ].join('\n'),
    },
  });
  const result = await runWorkflow({
    masRootPath,
    workflowId: 'alfred-safe-inspection-acid',
    workflowRunId: 'workflow-run-alfred-safe-inspection-acid',
    operationalIdentityId: 'alfred',
    invocationId: 'invocation-alfred-safe-inspection-acid',
    requestedBy: 'acid-test-suite',
  });
  const auditRecordText = await readTextFile(result.stepResults[0].toolPersistence.auditRecordPath);
  const resultSnapshotText = await readTextFile(result.stepResults[0].toolPersistence.resultSnapshotPath);
  const writebackRequestText = await readTextFile(result.memoryWritebackPersistence.recordPath);

  assert.equal(result.status, 'succeeded');
  assert.equal(result.stepResults[0].status, 'succeeded');
  assert.equal(result.stepResults[0].toolPersistence.auditRecord.resultEvidence.redactionApplied, true);
  assert.equal(result.workflowRunState.memoryWritebackCandidateIds.length, result.memoryWritebackRequest.memoryWrites.length);
  assert.doesNotMatch(auditRecordText, new RegExp(FAKE_GEMINI_SECRET_VALUE, 'u'));
  assert.doesNotMatch(resultSnapshotText, new RegExp(FAKE_GEMINI_SECRET_VALUE, 'u'));
  assert.doesNotMatch(writebackRequestText, new RegExp(FAKE_GEMINI_SECRET_VALUE, 'u'));
  assert.doesNotMatch(auditRecordText, /fake-token-that-must-not-leak/u);
  assert.doesNotMatch(resultSnapshotText, /fake-token-that-must-not-leak/u);
  assert.match(resultSnapshotText, /\[REDACTED\]/u);
});

test('TW acid: Maria cannot use an Alfred-dedicated channel even if her bindings file references it', async () => {
  const toolDefinition = buildToolDefinition({
    toolId: 'whatsapp.message.publish',
    displayName: 'WhatsApp Message Publish',
    sideEffectLevel: 'publish_external',
    requiredResourceTypes: ['channel'],
    requiredAccessModes: ['publish'],
    requiredPermissionModes: ['tool.publish'],
    approvalRequired: true,
  });
  const workflowRuntimeDefinition = buildWorkflowRuntimeDefinition({
    workflowId: 'maria-alfred-boundary-acid',
    steps: [
      {
        stepId: 'publish-whatsapp-message',
        stepType: 'tool_call',
        toolId: 'whatsapp.message.publish',
        input: {
          message: 'Maria must not be able to use Alfred dedicated WhatsApp.',
        },
        onFailure: 'fail_workflow',
      },
    ],
  });
  const { masRootPath } = await createAcidFixture({
    operationalIdentityId: 'maria',
    resources: [
      buildResourceDefinition({
        resourceId: 'alfred-whatsapp',
        resourceType: 'channel',
        displayName: 'Alfred WhatsApp',
        ownershipScope: 'dedicated',
        dedicatedToOperationalIdentityId: 'alfred',
      }),
    ],
    bindings: [
      buildBinding({
        resourceId: 'alfred-whatsapp',
        accessMode: 'publish',
      }),
    ],
    permissionRules: [
      buildAllowRule({
        ruleId: 'allow-maria-alleged-whatsapp-publish',
        resourceId: 'alfred-whatsapp',
        accessModes: ['publish'],
      }),
    ],
    toolDefinitions: [toolDefinition],
    workflowRuntimeDefinition,
    executorSources: {
      'whatsapp.message.publish': [
        'export async function executeTool() {',
        '  throw new Error("Maria boundary executor must not load.");',
        '}',
      ].join('\n'),
    },
  });
  const result = await runWorkflow({
    masRootPath,
    workflowId: 'maria-alfred-boundary-acid',
    workflowRunId: 'workflow-run-maria-alfred-boundary-acid',
    operationalIdentityId: 'maria',
    invocationId: 'invocation-maria-alfred-boundary-acid',
    requestedBy: 'acid-test-suite',
  });
  const readinessVerdict = result.toolReadiness.evaluatedTools[0];

  assert.equal(result.status, 'failed');
  assert.equal(readinessVerdict.status, 'denied');
  assert.deepEqual(result.workflowRunState.toolRunIds, []);
  assert.deepEqual(result.workflowRunState.approvalRequests, []);
  assert.equal(result.stepResults[0].toolResult, null);
  assert.match(result.warnings.join('\n'), /dedicated resource that belongs to a different operational identity/u);
  assert.doesNotMatch(JSON.stringify(result.warnings), /Maria boundary executor must not load/u);
});

test('TW acid: Juan cannot publish to a shared Meta resource without an explicit publish permission', async () => {
  const toolDefinition = buildToolDefinition({
    toolId: 'meta.campaign.publish',
    displayName: 'Meta Campaign Publish',
    sideEffectLevel: 'publish_external',
    requiredResourceTypes: ['channel'],
    requiredAccessModes: ['publish'],
    requiredPermissionModes: ['tool.publish'],
    approvalRequired: true,
  });
  const workflowRuntimeDefinition = buildWorkflowRuntimeDefinition({
    workflowId: 'juan-meta-permission-acid',
    steps: [
      {
        stepId: 'publish-campaign',
        stepType: 'tool_call',
        toolId: 'meta.campaign.publish',
        input: {
          campaignId: 'campaign-acid-test',
          budgetChange: 'increase',
        },
        onFailure: 'fail_workflow',
      },
    ],
  });
  const { masRootPath } = await createAcidFixture({
    operationalIdentityId: 'juan',
    resources: [
      buildResourceDefinition({
        resourceId: 'meta-channel',
        resourceType: 'channel',
        displayName: 'Meta Channel',
      }),
    ],
    bindings: [
      buildBinding({
        resourceId: 'meta-channel',
        accessMode: 'publish',
      }),
    ],
    permissionRules: [],
    toolDefinitions: [toolDefinition],
    workflowRuntimeDefinition,
    executorSources: {
      'meta.campaign.publish': [
        'export async function executeTool() {',
        '  throw new Error("Juan denied executor must not load.");',
        '}',
      ].join('\n'),
    },
  });
  const result = await runWorkflow({
    masRootPath,
    workflowId: 'juan-meta-permission-acid',
    workflowRunId: 'workflow-run-juan-meta-permission-acid',
    operationalIdentityId: 'juan',
    invocationId: 'invocation-juan-meta-permission-acid',
    requestedBy: 'acid-test-suite',
  });
  const permissionDecision = result.toolReadiness.evaluatedTools[0].missingRequirements[0];

  assert.equal(result.status, 'failed');
  assert.equal(result.toolReadiness.evaluatedTools[0].status, 'denied');
  assert.equal(result.toolReadiness.summary.denied, 1);
  assert.deepEqual(result.workflowRunState.approvalRequests, []);
  assert.deepEqual(result.workflowRunState.toolRunIds, []);
  assert.match(permissionDecision.reason, /No allow rule found/u);
  assert.doesNotMatch(JSON.stringify(result), /Juan denied executor must not load/u);
});

test('TW acid: a missing credential reference blocks provider-backed tool execution before the executor loads', async () => {
  const toolDefinition = buildToolDefinition({
    toolId: 'provider.model.inspect',
    displayName: 'Provider Model Inspect',
    requiredResourceTypes: ['brain-provider'],
    requiredAccessModes: ['execute'],
    requiredPermissionModes: ['tool.execute'],
  });
  const workflowRuntimeDefinition = buildWorkflowRuntimeDefinition({
    workflowId: 'missing-secret-provider-acid',
    steps: [
      {
        stepId: 'inspect-provider',
        stepType: 'tool_call',
        toolId: 'provider.model.inspect',
        input: {
          provider: 'openrouter',
        },
        onFailure: 'fail_workflow',
      },
    ],
  });
  const { masRootPath } = await createAcidFixture({
    operationalIdentityId: 'alfred',
    resources: [
      buildResourceDefinition({
        resourceId: 'openrouter-provider',
        resourceType: 'brain-provider',
        displayName: 'OpenRouter Provider',
      }),
    ],
    bindings: [
      buildBinding({
        resourceId: 'openrouter-provider',
        accessMode: 'execute',
        credentialReferenceId: 'secret_openrouter_api_key',
      }),
    ],
    permissionRules: [
      buildAllowRule({
        ruleId: 'allow-alfred-openrouter-execute',
        resourceId: 'openrouter-provider',
        accessModes: ['execute'],
      }),
    ],
    toolDefinitions: [toolDefinition],
    workflowRuntimeDefinition,
    executorSources: {
      'provider.model.inspect': [
        'export async function executeTool() {',
        '  throw new Error("Provider executor must not load without secret resolution.");',
        '}',
      ].join('\n'),
    },
  });
  const result = await runWorkflow({
    masRootPath,
    workflowId: 'missing-secret-provider-acid',
    workflowRunId: 'workflow-run-missing-secret-provider-acid',
    operationalIdentityId: 'alfred',
    invocationId: 'invocation-missing-secret-provider-acid',
    requestedBy: 'acid-test-suite',
  });
  const readinessVerdict = result.toolReadiness.evaluatedTools[0];

  assert.equal(result.status, 'failed');
  assert.equal(readinessVerdict.status, 'unavailable');
  assert.equal(result.toolReadiness.summary.unavailable, 1);
  assert.match(readinessVerdict.reason, /required secrets are not resolved/u);
  assert.match(readinessVerdict.missingRequirements[0].reason, /Credential Reference secret_openrouter_api_key is not resolved/u);
  assert.deepEqual(result.workflowRunState.toolRunIds, []);
  assert.equal(result.stepResults[0].toolResult, null);
  assert.doesNotMatch(JSON.stringify(result), /Provider executor must not load without secret resolution/u);
});

test('TW acid: side-effecting tools pause for human approval without executing or copying proposed action input into writeback', async () => {
  const doNotPublishProbe = 'DO_NOT_PUBLISH_THIS_ACID_TEST_MESSAGE';
  const toolDefinition = buildToolDefinition({
    toolId: 'meta.reply.publish',
    displayName: 'Meta Reply Publish',
    sideEffectLevel: 'publish_external',
    requiredResourceTypes: ['channel'],
    requiredAccessModes: ['publish'],
    requiredPermissionModes: ['tool.publish'],
    approvalRequired: true,
  });
  const workflowRuntimeDefinition = buildWorkflowRuntimeDefinition({
    workflowId: 'side-effect-approval-acid',
    allowWritebackCandidates: true,
    steps: [
      {
        stepId: 'publish-reply',
        stepType: 'tool_call',
        toolId: 'meta.reply.publish',
        input: {
          conversationId: 'conversation-acid-test',
          replyText: doNotPublishProbe,
        },
        onFailure: 'fail_workflow',
      },
    ],
  });
  const { masRootPath } = await createAcidFixture({
    operationalIdentityId: 'maria',
    resources: [
      buildResourceDefinition({
        resourceId: 'meta-channel',
        resourceType: 'channel',
        displayName: 'Meta Channel',
      }),
    ],
    bindings: [
      buildBinding({
        resourceId: 'meta-channel',
        accessMode: 'publish',
      }),
    ],
    permissionRules: [
      buildAllowRule({
        ruleId: 'allow-maria-meta-publish',
        resourceId: 'meta-channel',
        accessModes: ['publish'],
      }),
    ],
    toolDefinitions: [toolDefinition],
    workflowRuntimeDefinition,
    executorSources: {
      'meta.reply.publish': [
        'export async function executeTool() {',
        '  throw new Error("Side-effect executor must not load before approval.");',
        '}',
      ].join('\n'),
    },
  });
  const result = await runWorkflow({
    masRootPath,
    workflowId: 'side-effect-approval-acid',
    workflowRunId: 'workflow-run-side-effect-approval-acid',
    operationalIdentityId: 'maria',
    invocationId: 'invocation-side-effect-approval-acid',
    requestedBy: 'acid-test-suite',
  });
  const writebackRequestText = await readTextFile(result.memoryWritebackPersistence.recordPath);

  assert.equal(result.status, 'waiting_for_approval');
  assert.equal(result.stepResults[0].status, 'approval_required');
  assert.deepEqual(result.workflowRunState.toolRunIds, []);
  assert.equal(result.workflowRunState.approvalRequests.length, 1);
  assert.equal(result.stepResults[0].toolResult, null);
  assert.equal(result.memoryWritebackRequest.memoryWrites.length, 2);
  assert.doesNotMatch(writebackRequestText, new RegExp(doNotPublishProbe, 'u'));
  assert.doesNotMatch(JSON.stringify(result.stepResults), /Side-effect executor must not load/u);
});

test('TW acid: workflow recovery keeps failed tool execution evidence linked when a ready tool throws', async () => {
  const toolDefinition = buildToolDefinition({
    toolId: 'mas.health.collect',
    displayName: 'MAS Health Collect',
    persistResult: true,
    allowWritebackCandidates: true,
  });
  const workflowRuntimeDefinition = buildWorkflowRuntimeDefinition({
    workflowId: 'workflow-failure-recovery-acid',
    allowWritebackCandidates: true,
    steps: [
      {
        stepId: 'collect-health',
        stepType: 'tool_call',
        toolId: 'mas.health.collect',
        input: {
          includeDiagnostics: true,
        },
        onFailure: 'pause_workflow',
      },
    ],
  });
  const { masRootPath } = await createAcidFixture({
    operationalIdentityId: 'alfred',
    resources: [
      buildResourceDefinition({
        resourceId: 'mas-filesystem',
        resourceType: 'storage',
        displayName: 'MAS Filesystem',
      }),
    ],
    bindings: [
      buildBinding({
        resourceId: 'mas-filesystem',
        accessMode: 'read',
      }),
    ],
    permissionRules: [
      buildAllowRule({
        ruleId: 'allow-alfred-mas-filesystem-read',
        resourceId: 'mas-filesystem',
        accessModes: ['read'],
      }),
    ],
    toolDefinitions: [toolDefinition],
    workflowRuntimeDefinition,
    executorSources: {
      'mas.health.collect': [
        'export async function executeTool() {',
        `  throw new Error("Health collector failed with ${FAKE_FAILURE_SECRET_VALUE}");`,
        '}',
      ].join('\n'),
    },
  });
  const result = await runWorkflow({
    masRootPath,
    workflowId: 'workflow-failure-recovery-acid',
    workflowRunId: 'workflow-run-failure-recovery-acid',
    operationalIdentityId: 'alfred',
    invocationId: 'invocation-failure-recovery-acid',
    requestedBy: 'acid-test-suite',
  });
  const failedToolRunId = result.stepResults[0].toolResult.toolRunId;
  const auditRecordText = await readTextFile(result.stepResults[0].toolPersistence.auditRecordPath);
  const persistedState = JSON.parse(await readTextFile(result.persistence.workflowRunStateRecordPath));

  assert.equal(result.status, 'waiting_for_external_event');
  assert.equal(result.stepResults[0].status, 'failed');
  assert.equal(result.stepResults[0].toolPersistence.auditRecord.status, 'failed');
  assert.deepEqual(result.workflowRunState.toolRunIds, [failedToolRunId]);
  assert.deepEqual(persistedState.toolRunIds, [failedToolRunId]);
  assert.equal(result.workflowRunState.blockedSteps[0], 'collect-health');
  assert.equal(result.memoryWritebackRequest.memoryWrites.length, 3);
  assert.doesNotMatch(auditRecordText, new RegExp(FAKE_FAILURE_SECRET_VALUE, 'u'));
  assert.match(auditRecordText, /\[REDACTED\]/u);
});
