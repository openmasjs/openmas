import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { runAgentInvocation } from '../../src/invocation/run-agent-invocation.js';
import { buildActionClaimReportEnvelope } from '../../src/actions/action-claim-report-envelope.js';
import {
  createAlfredProbabilisticProjectFixture,
  withEnvironment,
} from '../helpers/create-alfred-probabilistic-fixture.js';

const FAKE_OPENROUTER_SECRET = 'openrouter-secret';
const FAKE_GEMINI_SECRET = 'gemini-secret';

async function readJsonFile(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function writeJsonFile(filePath, payload) {
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function buildBrainToolRequestEnvelope({
  toolRequestId = 'tool-request-acid-001',
  toolId = 'mas.system.inspect',
  expectedSideEffectLevel = 'read_only',
  input = {
    includeCounts: true,
  },
  purpose = 'Execute the requested runtime action before answering.',
} = {}) {
  return {
    kind: 'brain_tool_request',
    version: 1,
    toolRequestId,
    toolId,
    input,
    purpose,
    expectedSideEffectLevel,
  };
}

function buildActionClaimReport({
  claims,
}) {
  return {
    kind: 'action_claim_report',
    version: 1,
    claims,
  };
}

function buildActionClaim({
  claimId = 'action-claim-001',
  claimType = 'completed_action',
  actionSurface = 'generic',
  evidenceRequirement = 'successful_runtime_observation',
  summary = 'The MAS inspection completed successfully.',
  targetType = 'tool',
  targetId = 'mas.system.inspect',
} = {}) {
  return {
    kind: 'action_claim_declaration',
    version: 1,
    claimId,
    claimType,
    actionSurface,
    evidenceRequirement,
    summary,
    targetType,
    targetId,
    metadata: {},
  };
}

function buildToolDefinition({
  toolId,
  displayName = toolId,
  description = `${toolId} BE acid-test tool.`,
  sideEffectLevel = 'read_only',
  requiredResourceTypes = ['storage'],
  requiredAccessModes = ['read'],
  requiredPermissionModes = ['tool.execute'],
  approvalRequired = false,
  allowWritebackCandidates = false,
  persistResult = false,
}) {
  return {
    kind: 'tool_definition',
    version: 1,
    toolId,
    displayName,
    description,
    lifecycleState: 'active',
    owner: 'mas',
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

function buildResourceDefinition({
  resourceId,
  resourceType,
  displayName = resourceId,
  ownershipScope = 'shared',
  dedicatedToOperationalIdentityId = null,
}) {
  return {
    kind: 'resource_definition',
    version: 1,
    resourceId,
    resourceType,
    displayName,
    ownershipScope,
    ...(ownershipScope === 'dedicated' ? { dedicatedToOperationalIdentityId } : {}),
    lifecycleState: 'active',
  };
}

function buildBinding({
  resourceId,
  accessMode,
  secretReferenceId = null,
}) {
  return {
    resourceId,
    accessMode,
    bindingState: 'active',
    secretReferenceId,
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

function createOpenRouterResponse({
  responseId,
  outputText,
  promptTokens = 180,
  completionTokens = 40,
}) {
  return {
    ok: true,
    async json() {
      return {
        id: responseId,
        choices: [
          {
            finish_reason: 'stop',
            message: {
              content: outputText,
            },
          },
        ],
        usage: {
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          total_tokens: promptTokens + completionTokens,
        },
      };
    },
  };
}

async function appendCognitiveIdentitiesRegistryEntry({
  projectRootPath,
  cognitiveIdentityId,
  rootPath,
  category = 'acid-test',
}) {
  const registryPath = path.join(projectRootPath, 'instance', 'registries', 'cognitive-identities.json');
  const registry = await readJsonFile(registryPath);

  if (!registry.cognitiveIdentities.some((entry) => entry.cognitiveIdentityId === cognitiveIdentityId)) {
    registry.cognitiveIdentities.push({
      cognitiveIdentityId,
      rootPath,
      category,
    });
  }

  await writeJsonFile(registryPath, registry);
}

async function appendOperationalIdentityRegistryEntry({
  projectRootPath,
  operationalIdentityId,
  rootPath = operationalIdentityId,
  category = 'acid-test',
}) {
  const registryPath = path.join(projectRootPath, 'instance', 'registries', 'operational-identities.json');
  const registry = await readJsonFile(registryPath);

  if (!registry.operationalIdentities.some((entry) => entry.operationalIdentityId === operationalIdentityId)) {
    registry.operationalIdentities.push({
      operationalIdentityId,
      rootPath,
      category,
    });
  }

  await writeJsonFile(registryPath, registry);
}

async function upsertResources({
  projectRootPath,
  resources,
}) {
  const registryPath = path.join(projectRootPath, 'instance', 'registries', 'resources.json');
  const registry = await readJsonFile(registryPath);
  const byResourceId = new Map(registry.resources.map((resource) => {
    return [resource.resourceId, resource];
  }));

  for (const resource of resources) {
    byResourceId.set(resource.resourceId, resource);
  }

  registry.resources = [...byResourceId.values()];
  await writeJsonFile(registryPath, registry);
}

async function writeCognitiveIdentity({
  projectRootPath,
  cognitiveIdentityId,
  rootPath,
  displayName,
}) {
  const cognitiveIdentityRootPath = path.join(projectRootPath, 'instance', 'cognitive-identities', ...rootPath.split('/'));

  await mkdir(cognitiveIdentityRootPath, { recursive: true });
  await appendCognitiveIdentitiesRegistryEntry({
    projectRootPath,
    cognitiveIdentityId,
    rootPath,
  });
  await writeFile(path.join(cognitiveIdentityRootPath, 'identity.md'), `# ${displayName}\n\n${displayName} supports BE acid tests.\n`, 'utf8');
  await writeFile(path.join(cognitiveIdentityRootPath, 'policies.md'), '# Policies\n\n- Request runtime actions only through approved envelopes.\n', 'utf8');
  await writeFile(path.join(cognitiveIdentityRootPath, 'capabilities.md'), '# Capabilities\n\n- Collaborate with MAS runtime tools safely.\n', 'utf8');
}

async function writeOperationalIdentity({
  projectRootPath,
  operationalIdentityId,
  displayName,
  cognitiveIdentityId,
  bindings,
  permissionRules,
}) {
  const operationalIdentityRootPath = path.join(
    projectRootPath,
    'instance',
    'operational-identities',
    operationalIdentityId,
  );

  await mkdir(operationalIdentityRootPath, { recursive: true });
  await appendOperationalIdentityRegistryEntry({
    projectRootPath,
    operationalIdentityId,
  });
  await writeJsonFile(path.join(operationalIdentityRootPath, 'identity.json'), {
    kind: 'operational_identity_definition',
    version: 1,
    operationalIdentityId,
    displayName,
    lifecycleState: 'active',
    auditActorId: `${cognitiveIdentityId}.ops.${operationalIdentityId}.v1`,
    attachedCognitiveIdentities: [
      {
        cognitiveIdentityId,
      },
    ],
    executionProfileId: `${operationalIdentityId}-default`,
    persona: {
      tone: 'professional',
      presentationStyle: 'clear and audit-friendly',
    },
  });
  await writeJsonFile(path.join(operationalIdentityRootPath, 'execution-profile.json'), {
    kind: 'execution_profile_definition',
    version: 1,
    executionProfileId: `${operationalIdentityId}-default`,
    executionMode: 'hybrid',
    primaryBrain: {
      brainId: `${operationalIdentityId}-openrouter-primary`,
      providerId: 'openrouter-api',
      modelId: 'openrouter/free',
    },
    fallbackBrain: {
      brainId: `${operationalIdentityId}-gemini-fallback`,
      providerId: 'gemini-api',
      modelId: 'gemini-flash-latest',
    },
    enabledCommands: [
      'ask',
    ],
  });
  await writeJsonFile(path.join(operationalIdentityRootPath, 'bindings.json'), {
    kind: 'operational_identity_bindings',
    version: 1,
    operationalIdentityId,
    bindings,
  });
  await writeJsonFile(path.join(operationalIdentityRootPath, 'permissions.json'), {
    kind: 'operational_identity_permissions',
    version: 1,
    operationalIdentityId,
    defaultEffect: 'deny',
    rules: permissionRules,
  });
}

async function writeTool({
  projectRootPath,
  toolDefinition,
  executorSource,
}) {
  const toolRootPath = path.join(projectRootPath, 'instance', 'tools', toolDefinition.toolId);

  await mkdir(toolRootPath, { recursive: true });
  await writeJsonFile(path.join(toolRootPath, 'tool.json'), toolDefinition);
  await writeFile(path.join(toolRootPath, 'executor.js'), executorSource, 'utf8');
}

async function addAlfredInspectTool({
  projectRootPath,
  executorSource = null,
  allowWritebackCandidates = true,
}) {
  await upsertResources({
    projectRootPath,
    resources: [
      buildResourceDefinition({
        resourceId: 'mas-filesystem',
        resourceType: 'storage',
        displayName: 'MAS Filesystem',
      }),
    ],
  });

  const alfredRootPath = path.join(projectRootPath, 'instance', 'operational-identities', 'alfred');
  const bindings = await readJsonFile(path.join(alfredRootPath, 'bindings.json'));
  const permissions = await readJsonFile(path.join(alfredRootPath, 'permissions.json'));

  bindings.bindings.push(buildBinding({
    resourceId: 'mas-filesystem',
    accessMode: 'read',
  }));
  permissions.rules.push(buildAllowRule({
    ruleId: 'allow-alfred-mas-filesystem-read',
    resourceId: 'mas-filesystem',
    accessModes: ['read'],
  }));

  await writeJsonFile(path.join(alfredRootPath, 'bindings.json'), bindings);
  await writeJsonFile(path.join(alfredRootPath, 'permissions.json'), permissions);
  await writeTool({
    projectRootPath,
    toolDefinition: buildToolDefinition({
      toolId: 'mas.system.inspect',
      displayName: 'MAS System Inspect',
      allowWritebackCandidates,
    }),
    executorSource: executorSource ?? [
      'export async function executeTool({ input }) {',
      '  return {',
      '    status: "succeeded",',
      '    summary: "Alfred inspected the MAS through a verified runtime tool.",',
      '    data: {',
      '      inputEcho: input,',
      '      runtimeEvidence: "verified",',
      '      registeredOperationalIdentities: ["alfred"]',
      '    },',
      '    warnings: [],',
      '    errors: []',
      '  };',
      '}',
    ].join('\n'),
  });
}

async function addMasHealthReviewWorkflow({
  projectRootPath,
  allowWritebackCandidates = true,
}) {
  const workflowRootPath = path.join(projectRootPath, 'instance', 'workflows', 'mas-health-review');

  await mkdir(workflowRootPath, { recursive: true });
  await writeJsonFile(path.join(workflowRootPath, 'runtime.json'), {
    kind: 'workflow_runtime_definition',
    version: 1,
    workflowId: 'mas-health-review',
    lifecycleState: 'active',
    executionMode: 'on_demand',
    statePolicy: {
      persistState: true,
      resumeAllowed: true,
    },
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
  });
  await writeJsonFile(path.join(workflowRootPath, 'workflow.json'), {
    kind: 'workflow_instruction_definition',
    version: 1,
    workflowId: 'mas-health-review',
    displayName: 'MAS Health Review',
    lifecycleState: 'active',
    description: 'Review safe MAS health evidence before producing an administrative answer.',
    commandTriggers: [
      'workflow',
    ],
    operationalIdentityIds: [
      'alfred',
    ],
    cognitiveIdentityIds: [
      'system-steward',
    ],
  });
  await writeFile(
    path.join(workflowRootPath, 'workflow.md'),
    '# MAS Health Review\n\nUse this workflow for safe read-only MAS health reviews.\n',
    'utf8',
  );
}

async function createAlfredAcidFixture() {
  const projectRootPath = await createAlfredProbabilisticProjectFixture();

  await addAlfredInspectTool({
    projectRootPath,
  });

  return projectRootPath;
}

async function addMariaWithAlfredDedicatedChannel({ projectRootPath }) {
  await writeCognitiveIdentity({
    projectRootPath,
    cognitiveIdentityId: 'community-manager',
    rootPath: 'marketing-and-sales/community-manager',
    displayName: 'Community Manager',
  });
  await upsertResources({
    projectRootPath,
    resources: [
      buildResourceDefinition({
        resourceId: 'alfred-whatsapp',
        resourceType: 'channel',
        displayName: 'Alfred WhatsApp',
        ownershipScope: 'dedicated',
        dedicatedToOperationalIdentityId: 'alfred',
      }),
    ],
  });
  await writeOperationalIdentity({
    projectRootPath,
    operationalIdentityId: 'maria',
    displayName: 'Maria',
    cognitiveIdentityId: 'community-manager',
    bindings: [
      buildBinding({
        resourceId: 'openrouter-api',
        accessMode: 'execute',
        secretReferenceId: 'openrouter-api-key',
      }),
      buildBinding({
        resourceId: 'gemini-api',
        accessMode: 'execute',
        secretReferenceId: 'gemini-api-key',
      }),
      buildBinding({
        resourceId: 'alfred-whatsapp',
        accessMode: 'publish',
      }),
    ],
    permissionRules: [
      buildAllowRule({
        ruleId: 'allow-maria-openrouter-execute',
        resourceId: 'openrouter-api',
        accessModes: ['execute'],
      }),
      buildAllowRule({
        ruleId: 'allow-maria-gemini-execute',
        resourceId: 'gemini-api',
        accessModes: ['execute'],
      }),
      buildAllowRule({
        ruleId: 'allow-maria-alleged-whatsapp-publish',
        resourceId: 'alfred-whatsapp',
        accessModes: ['publish'],
      }),
    ],
  });
  await writeTool({
    projectRootPath,
    toolDefinition: buildToolDefinition({
      toolId: 'whatsapp.message.publish',
      displayName: 'WhatsApp Message Publish',
      sideEffectLevel: 'publish_external',
      requiredResourceTypes: ['channel'],
      requiredAccessModes: ['publish'],
      requiredPermissionModes: ['tool.publish'],
      approvalRequired: true,
    }),
    executorSource: [
      'export async function executeTool() {',
      '  throw new Error("Maria dedicated-channel acid executor must not load.");',
      '}',
    ].join('\n'),
  });
}

async function addJuanWithPublishTool({ projectRootPath }) {
  await writeCognitiveIdentity({
    projectRootPath,
    cognitiveIdentityId: 'media-buyer',
    rootPath: 'marketing-and-sales/media-buyer',
    displayName: 'Media Buyer',
  });
  await upsertResources({
    projectRootPath,
    resources: [
      buildResourceDefinition({
        resourceId: 'meta-channel',
        resourceType: 'channel',
        displayName: 'Meta Channel',
      }),
    ],
  });
  await writeOperationalIdentity({
    projectRootPath,
    operationalIdentityId: 'juan',
    displayName: 'Juan',
    cognitiveIdentityId: 'media-buyer',
    bindings: [
      buildBinding({
        resourceId: 'openrouter-api',
        accessMode: 'execute',
        secretReferenceId: 'openrouter-api-key',
      }),
      buildBinding({
        resourceId: 'gemini-api',
        accessMode: 'execute',
        secretReferenceId: 'gemini-api-key',
      }),
      buildBinding({
        resourceId: 'meta-channel',
        accessMode: 'publish',
      }),
    ],
    permissionRules: [
      buildAllowRule({
        ruleId: 'allow-juan-openrouter-execute',
        resourceId: 'openrouter-api',
        accessModes: ['execute'],
      }),
      buildAllowRule({
        ruleId: 'allow-juan-gemini-execute',
        resourceId: 'gemini-api',
        accessModes: ['execute'],
      }),
      buildAllowRule({
        ruleId: 'allow-juan-meta-publish',
        resourceId: 'meta-channel',
        accessModes: ['publish'],
      }),
    ],
  });
  await writeTool({
    projectRootPath,
    toolDefinition: buildToolDefinition({
      toolId: 'meta.campaign.publish',
      displayName: 'Meta Campaign Publish',
      sideEffectLevel: 'publish_external',
      requiredResourceTypes: ['channel'],
      requiredAccessModes: ['publish'],
      requiredPermissionModes: ['tool.publish'],
      approvalRequired: true,
    }),
    executorSource: [
      'export async function executeTool() {',
      '  throw new Error("Juan publish acid executor must not load before approval.");',
      '}',
    ].join('\n'),
  });
}

async function invokeProbabilisticAcid({
  projectRootPath,
  operationalIdentityId = 'alfred',
  inputText,
  firstOutputText,
  secondOutputText = null,
  inspectFirstRequest = null,
  inspectSecondRequest = null,
  legacyIntentCompatibilityMode = 'disabled',
}) {
  let fetchCallCount = 0;

  return withEnvironment(
    {
      "openrouter-api-key": FAKE_OPENROUTER_SECRET,
      "gemini-api-key": FAKE_GEMINI_SECRET,
    },
    async () => {
      const result = await runAgentInvocation({
        projectRootPath,
        operationalIdentityId,
        invocationMode: 'probabilistic',
        command: 'ask',
        inputText,
        requestedBy: 'acid-test-suite',
        legacyIntentCompatibilityMode,
        fetchImplementation: async (url, options) => {
          fetchCallCount += 1;
          assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions');

          const body = JSON.parse(options.body);

          if (fetchCallCount === 1) {
            inspectFirstRequest?.(body);

            return createOpenRouterResponse({
              responseId: `${operationalIdentityId}-acid-response-1`,
              outputText: firstOutputText,
            });
          }

          inspectSecondRequest?.(body);

          return createOpenRouterResponse({
            responseId: `${operationalIdentityId}-acid-response-2`,
            outputText: secondOutputText ?? 'Runtime observation received.',
            promptTokens: 240,
            completionTokens: 50,
          });
        },
      });

      return {
        result,
        fetchCallCount,
        invocationSession: result.persistence
          ? JSON.parse(await readFile(result.persistence.invocationSessionRecordPath, 'utf8'))
          : null,
        invocationReport: result.persistence?.invocationReportPath
          ? await readFile(result.persistence.invocationReportPath, 'utf8')
          : null,
      };
    },
  );
}

test('BE acid: Alfred valid tool request executes once and final answer is grounded in observation', async () => {
  const projectRootPath = await createAlfredAcidFixture();
  const envelopeText = JSON.stringify(buildBrainToolRequestEnvelope(), null, 2);
  const {
    result,
    fetchCallCount,
    invocationSession,
    invocationReport,
  } = await invokeProbabilisticAcid({
    projectRootPath,
    inputText: 'Inspect the MAS before answering.',
    firstOutputText: envelopeText,
    secondOutputText: 'I inspected the MAS through verified runtime evidence. The inspection completed safely.',
    inspectFirstRequest: (body) => {
      assert.match(body.messages[0].content, /## Tool Availability/u);
      assert.doesNotMatch(body.messages[0].content, /## Tool Observation/u);
    },
    inspectSecondRequest: (body) => {
      assert.match(body.messages[0].content, /## Tool Observation/u);
      assert.match(body.messages[0].content, /## Evidence-Sharp Answer Guard/u);
      assert.match(body.messages[0].content, /Do not upgrade weaker evidence into stronger claims/u);
      assert.match(body.messages[0].content, /verified runtime tool/u);
      assert.match(body.messages[1].content, /Runtime Follow-up/u);
      assert.match(body.messages[1].content, /Preserve exact evidence labels/u);
    },
  });

  assert.equal(fetchCallCount, 2);
  assert.equal(result.status, 'completed');
  assert.match(result.output.outputText, /verified runtime evidence/u);
  assert.equal(result.output.toolRequestResolution.status, 'accepted');
  assert.equal(result.output.toolRequestResolution.autoExecutionPerformed, true);
  assert.equal(result.output.brainToolExecution.executionPerformed, true);
  assert.equal(result.output.brainToolExecution.toolResultStatus, 'succeeded');
  assert.equal(result.output.brainToolExecution.memoryWritebackRequest.memoryWrites.length, 1);
  assert.equal(result.output.actionResultAssessment.status, 'success');
  assert.equal(result.output.actionResultAssessment.requestFulfillment, 'fulfilled');
  assert.equal(result.output.actionResultAssessment.executionObserved, true);
  assert.equal(result.warningRelevance.kind, 'runtime_warning_relevance');
  assert.equal(result.warningRelevance.version, 2);
  assert.equal(invocationSession.brainExecution.finalPassKind, 'tool_observation_followup');
  assert.equal(invocationSession.brainToolObservation.memoryWritebackCandidateIds.length, 1);
  assert.equal(invocationSession.actionResultAssessment.status, 'success');
  assert.equal(invocationSession.warningRelevance.kind, 'runtime_warning_relevance');
  assert.equal(
    invocationSession.warningRelevance.actionContextReferences.requestedToolIds.includes('mas.system.inspect'),
    true,
  );
  assert.equal(
    invocationSession.warningRelevance.actionContextReferences.requestedResourceIds.includes('mas-filesystem'),
    true,
  );
  assert.match(invocationReport, /Memory Writeback Candidates/u);
  assert.match(invocationReport, /Tool Candidate Count: 1/u);
  assert.match(invocationReport, /Action Result Assessment/u);
  assert.match(invocationReport, /Request Fulfillment: fulfilled/u);
});

test('BE acid: explicit MAS inspection intent executes even when the brain forgets the tool envelope', async () => {
  const projectRootPath = await createAlfredAcidFixture();
  const {
    result,
    fetchCallCount,
    invocationSession,
    invocationReport,
  } = await invokeProbabilisticAcid({
    projectRootPath,
    inputText: 'Porfa inspeccionando el MAS nuevamente para saber si algo cambio.',
    firstOutputText: 'I can summarize this from memory without a runtime tool request.',
    secondOutputText: 'I inspected the MAS through runtime evidence after the explicit inspection request.',
    legacyIntentCompatibilityMode: 'compatibility',
    inspectFirstRequest: (body) => {
      assert.match(body.messages[0].content, /## Tool Availability/u);
    },
    inspectSecondRequest: (body) => {
      assert.match(body.messages[0].content, /## Tool Observation/u);
      assert.match(body.messages[0].content, /verified runtime tool/u);
    },
  });

  assert.equal(fetchCallCount, 2);
  assert.equal(result.status, 'completed');
  assert.equal(result.output.toolRequestResolution.status, 'accepted');
  assert.equal(result.output.toolRequestResolution.requestedToolId, 'mas.system.inspect');
  assert.equal(result.output.intentResolution.status, 'resolved');
  assert.equal(result.output.intentResolution.target.targetId, 'mas.system.inspect');
  assert.equal(result.output.toolRequestResolution.toolRequest.toolRequestId, 'runtime-intent-admin-mas-inspect-001');
  assert.match(result.output.toolRequestResolution.reason, /Runtime intent resolution accepted/u);
  assert.equal(result.output.brainToolExecution.executionPerformed, true);
  assert.equal(result.output.brainToolObservation.status, 'succeeded');
  assert.equal(invocationSession.brainExecution.finalPassKind, 'tool_observation_followup');
  assert.match(invocationReport, /Intent Resolution/u);
  assert.match(invocationReport, /Runtime intent resolution accepted/u);
  assert.match(result.output.outputText, /runtime evidence/u);
});

test('BE acid: explicit MAS health review intent runs workflow when the brain forgets the workflow envelope', async () => {
  const projectRootPath = await createAlfredAcidFixture();

  await addMasHealthReviewWorkflow({
    projectRootPath,
  });

  const {
    result,
    fetchCallCount,
    invocationSession,
    invocationReport,
  } = await invokeProbabilisticAcid({
    projectRootPath,
    inputText: 'Please run a full MAS health review before answering.',
    firstOutputText: 'I can discuss MAS health from context without requesting a workflow.',
    secondOutputText: 'I ran the MAS health review workflow and can summarize the verified workflow observation.',
    legacyIntentCompatibilityMode: 'compatibility',
    inspectFirstRequest: (body) => {
      assert.match(body.messages[0].content, /## Workflow Availability/u);
      assert.match(body.messages[0].content, /mas-health-review/u);
    },
    inspectSecondRequest: (body) => {
      assert.match(body.messages[0].content, /## Workflow Observation/u);
      assert.match(body.messages[0].content, /mas-health-review/u);
    },
  });

  assert.equal(fetchCallCount, 2);
  assert.equal(result.status, 'completed');
  assert.equal(result.output.intentResolution.status, 'resolved');
  assert.equal(result.output.intentResolution.target.targetType, 'workflow');
  assert.equal(result.output.intentResolution.target.targetId, 'mas-health-review');
  assert.equal(result.output.toolRequestResolution.status, 'no_request');
  assert.equal(result.output.brainToolExecution.executionPerformed, false);
  assert.equal(result.output.workflowRequestResolution.status, 'accepted');
  assert.equal(result.output.brainWorkflowExecution.executionPerformed, true);
  assert.equal(result.output.brainWorkflowObservation.status, 'succeeded');
  assert.equal(invocationSession.brainExecution.finalPassKind, 'workflow_observation_followup');
  assert.match(invocationReport, /Runtime intent resolution accepted mas-health-review/u);
  assert.match(result.output.outputText, /workflow observation/u);
});

test('BE acid: Alfred cannot create runtime evidence by merely claiming that he inspected the MAS', async () => {
  const projectRootPath = await createAlfredAcidFixture();
  const {
    result,
    fetchCallCount,
    invocationSession,
    invocationReport,
  } = await invokeProbabilisticAcid({
    projectRootPath,
    inputText: 'Tell me if you inspected the MAS.',
    firstOutputText: [
      'I inspected the MAS already and everything is fine.',
      buildActionClaimReportEnvelope(buildActionClaimReport({
        claims: [
          buildActionClaim(),
        ],
      })),
    ].join('\n'),
  });

  assert.equal(fetchCallCount, 1);
  assert.equal(result.status, 'completed');
  assert.equal(result.output.toolRequestResolution.status, 'no_request');
  assert.equal(result.output.brainToolExecution.executionPerformed, false);
  assert.equal(result.output.brainToolExecution.toolRunId, null);
  assert.equal(result.output.brainToolObservation, null);
  assert.equal(result.output.actionClaimGuard.status, 'unsupported');
  assert.equal(result.output.actionClaimGuard.unsupportedClaimCount, 1);
  assert.equal(result.output.actionResultAssessment.status, 'no_execution');
  assert.equal(result.output.actionResultAssessment.requestFulfillment, 'not_fulfilled');
  assert.equal(result.output.actionResultAssessment.executionObserved, false);
  assert.match(result.warnings.join('\n'), /Unsupported action claim detected/u);
  assert.match(result.warnings.join('\n'), /Action result assessment found 1 unsupported action claim/u);
  assert.equal(invocationSession.brainExecution.toolObservationFollowupPerformed, false);
  assert.equal(invocationSession.brainToolExecution.toolAuditRecordPath, null);
  assert.equal(invocationSession.actionClaimGuard.status, 'unsupported');
  assert.equal(invocationSession.actionResultAssessment.status, 'no_execution');
  assert.match(invocationReport, /Execution Performed: no/u);
  assert.match(invocationReport, /Tool Run ID: n\/a/u);
  assert.match(invocationReport, /Action Claim Guard/u);
  assert.match(invocationReport, /Unsupported Claims: 1/u);
  assert.match(invocationReport, /Action Result Assessment/u);
  assert.match(invocationReport, /Status: no_execution/u);
});

test('BE acid: brain hallucinated unknown tool is rejected without execution', async () => {
  const projectRootPath = await createAlfredAcidFixture();
  const {
    result,
    fetchCallCount,
    invocationSession,
    invocationReport,
  } = await invokeProbabilisticAcid({
    projectRootPath,
    inputText: 'Use any tool you need.',
    firstOutputText: JSON.stringify(buildBrainToolRequestEnvelope({
      toolRequestId: 'tool-request-hallucinated-001',
      toolId: 'mas.secret.root.delete',
      purpose: 'Hallucinated unsafe tool request.',
    }), null, 2),
  });

  assert.equal(fetchCallCount, 1);
  assert.equal(result.output.toolRequestResolution.status, 'denied');
  assert.equal(result.output.toolRequestResolution.runtimeAction, 'reject');
  assert.match(result.output.toolRequestResolution.reason, /not evaluated as available/u);
  assert.equal(result.output.brainToolExecution.executionPerformed, false);
  assert.equal(invocationSession.brainToolExecution.toolAuditRecordPath, null);
  assert.match(invocationReport, /Runtime Action: reject/u);
  assert.match(invocationReport, /Execution Performed: no/u);
});

test('BE acid: malformed brain tool envelope is rejected without execution', async () => {
  const projectRootPath = await createAlfredAcidFixture();
  const malformedEnvelope = '<openmas-tool-request>{"kind":"brain_tool_request","version":1,</openmas-tool-request>';
  const {
    result,
    fetchCallCount,
    invocationSession,
    invocationReport,
  } = await invokeProbabilisticAcid({
    projectRootPath,
    inputText: 'Inspect the MAS if needed.',
    firstOutputText: malformedEnvelope,
  });

  assert.equal(fetchCallCount, 1);
  assert.equal(result.output.toolRequestResolution.status, 'invalid');
  assert.equal(result.output.toolRequestResolution.runtimeAction, 'reject');
  assert.match(result.output.toolRequestResolution.reason, /not valid JSON/u);
  assert.equal(result.output.brainToolExecution.executionPerformed, false);
  assert.equal(invocationSession.brainToolExecution.toolAuditRecordPath, null);
  assert.match(invocationReport, /Status: invalid/u);
  assert.match(invocationReport, /Runtime Action: reject/u);
});

test('BE acid: Maria cannot use Alfred dedicated channel from probabilistic tool request', async () => {
  const projectRootPath = await createAlfredProbabilisticProjectFixture();

  await addMariaWithAlfredDedicatedChannel({
    projectRootPath,
  });

  const {
    result,
    fetchCallCount,
    invocationSession,
    invocationReport,
  } = await invokeProbabilisticAcid({
    projectRootPath,
    operationalIdentityId: 'maria',
    inputText: 'Publish this WhatsApp reply if you can.',
    firstOutputText: JSON.stringify(buildBrainToolRequestEnvelope({
      toolRequestId: 'tool-request-maria-whatsapp-001',
      toolId: 'whatsapp.message.publish',
      expectedSideEffectLevel: 'publish_external',
      input: {
        recipientId: 'customer-123',
        message: 'This should not be sent by Maria.',
      },
      purpose: 'Try to publish a WhatsApp reply.',
    }), null, 2),
  });

  assert.equal(fetchCallCount, 1);
  assert.equal(result.status, 'completed');
  assert.equal(result.output.toolRequestResolution.status, 'denied');
  assert.equal(result.output.toolRequestResolution.runtimeAction, 'reject');
  assert.equal(result.output.brainToolExecution.executionPerformed, false);
  assert.equal(result.output.humanApprovalRequest, null);
  assert.equal(invocationSession.toolReadiness.summary.denied, 1);
  assert.match(result.warnings.join('\n'), /dedicated resource that belongs to a different operational identity/u);
  assert.match(invocationReport, /Requested Tool: whatsapp\.message\.publish/u);
  assert.match(invocationReport, /Execution Performed: no/u);
  assert.doesNotMatch(JSON.stringify(invocationSession), /Maria dedicated-channel acid executor must not load/u);
});

test('BE acid: Juan publish request creates human approval requirement without executing', async () => {
  const projectRootPath = await createAlfredProbabilisticProjectFixture();

  await addJuanWithPublishTool({
    projectRootPath,
  });

  const {
    result,
    fetchCallCount,
    invocationSession,
    invocationReport,
  } = await invokeProbabilisticAcid({
    projectRootPath,
    operationalIdentityId: 'juan',
    inputText: 'Publish this Meta campaign update if allowed.',
    firstOutputText: JSON.stringify(buildBrainToolRequestEnvelope({
      toolRequestId: 'tool-request-juan-publish-001',
      toolId: 'meta.campaign.publish',
      expectedSideEffectLevel: 'publish_external',
      input: {
        campaignId: 'campaign-123',
        change: 'increase budget by 20%',
      },
      purpose: 'Publish a Meta campaign change.',
    }), null, 2),
  });

  assert.equal(fetchCallCount, 1);
  assert.equal(result.status, 'completed');
  assert.equal(result.output.toolRequestResolution.status, 'approval_required');
  assert.equal(result.output.toolRequestResolution.runtimeAction, 'request_human_approval');
  assert.equal(result.output.brainToolExecution.executionPerformed, false);
  assert.equal(result.output.humanApprovalState.status, 'pending');
  assert.equal(result.output.humanApprovalState.executionBlocked, true);
  assert.equal(result.output.actionResultAssessment.status, 'approval_pause');
  assert.equal(result.output.actionResultAssessment.requestFulfillment, 'pending_approval');
  assert.equal(result.output.actionResultAssessment.approvalPaused, true);
  assert.equal(invocationSession.toolReadiness.summary.approvalRequired, 1);
  assert.equal(invocationSession.humanApprovalRequest.subject.toolId, 'meta.campaign.publish');
  assert.equal(invocationSession.actionResultAssessment.status, 'approval_pause');
  assert.match(invocationReport, /Approval State: pending/u);
  assert.match(invocationReport, /Execution Blocked: yes/u);
  assert.match(invocationReport, /Status: approval_pause/u);
  assert.doesNotMatch(JSON.stringify(invocationSession), /Juan publish acid executor must not load/u);
});

test('BE acid: failed tool execution returns failure observation and final answer must not fabricate success', async () => {
  const projectRootPath = await createAlfredProbabilisticProjectFixture();
  const failureSecretProbe = 'AIzaFAKE_BE_ACTION_FAILURE_SECRET';

  await addAlfredInspectTool({
    projectRootPath,
    executorSource: [
      'export async function executeTool() {',
      `  throw new Error("Inspection failed with ${failureSecretProbe}");`,
      '}',
    ].join('\n'),
  });

  const {
    result,
    fetchCallCount,
    invocationSession,
    invocationReport,
  } = await invokeProbabilisticAcid({
    projectRootPath,
    inputText: 'Inspect the MAS and report honestly.',
    firstOutputText: JSON.stringify(buildBrainToolRequestEnvelope(), null, 2),
    secondOutputText: 'The MAS inspection tool failed. I cannot claim a successful inspection; the runtime recorded a failed tool observation.',
    inspectSecondRequest: (body) => {
      assert.match(body.messages[0].content, /Tool Status: failed/u);
      assert.match(body.messages[0].content, /Tool Errors/u);
      assert.doesNotMatch(body.messages[0].content, new RegExp(failureSecretProbe, 'u'));
      assert.match(body.messages[0].content, /\[REDACTED\]/u);
    },
  });

  assert.equal(fetchCallCount, 2);
  assert.equal(result.status, 'completed');
  assert.equal(result.output.brainToolExecution.executionPerformed, true);
  assert.equal(result.output.brainToolExecution.toolResultStatus, 'failed');
  assert.equal(result.output.brainToolObservation.status, 'failed');
  assert.equal(result.output.actionResultAssessment.status, 'failure');
  assert.equal(result.output.actionResultAssessment.requestFulfillment, 'not_fulfilled');
  assert.equal(result.output.actionResultAssessment.executionObserved, true);
  assert.match(result.output.outputText, /tool failed/i);
  assert.doesNotMatch(JSON.stringify(invocationSession), new RegExp(failureSecretProbe, 'u'));
  assert.equal(invocationSession.actionResultAssessment.status, 'failure');
  assert.match(invocationReport, /Tool Result Status: failed/u);
  assert.match(invocationReport, /Status: failure/u);
});
