import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { runAgentInvocation } from '../../src/invocation/run-agent-invocation.js';
import {
  buildSemanticClassifierCandidateFromAffordance,
  buildSemanticClassifiedIntentFromCandidate,
} from '../../src/actions/classify-action-intent-for-invocation.js';
import {
  createAlfredProbabilisticProjectFixture,
  withEnvironment,
} from '../helpers/create-alfred-probabilistic-fixture.js';

const OPENROUTER_SECRET = 'openrouter-secret';
const GEMINI_SECRET = 'gemini-secret';

function createOpenRouterResponse({
  responseId,
  outputText,
  promptTokens = 180,
  completionTokens = 48,
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

async function readJsonFile(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function writeJsonFile(filePath, payload) {
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function buildResourceDefinition({
  resourceId,
  resourceType,
  displayName = resourceId,
  ownershipScope = 'shared',
}) {
  return {
    kind: 'resource_definition',
    version: 1,
    resourceId,
    resourceType,
    displayName,
    ownershipScope,
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

function buildToolDefinition({
  toolId,
  displayName,
  description,
  sideEffectLevel = 'read_only',
  requiredResourceTypes,
  requiredAccessModes,
  requiredPermissionModes,
  approvalRequired = false,
  allowWritebackCandidates = false,
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
      persistResult: true,
    },
    memoryPolicy: {
      allowWritebackCandidates,
    },
  };
}

function buildReadinessSummary({
  status = 'ready',
  approvalRequired = false,
  reason = 'Affordance passed readiness gates and is safe to select.',
} = {}) {
  return {
    kind: 'action_affordance_readiness_summary',
    version: 1,
    status,
    source: 'tool_readiness_evaluation',
    approvalRequired,
    reason,
    matchedBindingCount: 1,
    missingRequirementCount: 0,
    warnings: [],
  };
}

function buildInspectAffordance() {
  return {
    kind: 'action_affordance',
    version: 1,
    affordanceId: 'tool:mas.system.inspect',
    sourceType: 'tool_definition',
    sourcePath: 'instance/tools/mas.system.inspect/tool.json',
    targetActionType: 'tool_execution',
    targetType: 'tool',
    targetId: 'mas.system.inspect',
    displayName: 'MAS System Inspect',
    description: 'Read the current MAS inventory without mutating the instance.',
    owner: 'mas',
    lifecycleState: 'active',
    sideEffectLevel: 'read_only',
    executionMode: null,
    readinessSummary: buildReadinessSummary(),
    warnings: [],
    metadata: {
      semanticTags: [
        'mas.inspect',
        'system.inventory',
      ],
    },
  };
}

function buildWorkflowAffordance() {
  return {
    kind: 'action_affordance',
    version: 1,
    affordanceId: 'workflow:mas-health-review',
    sourceType: 'workflow_runtime_definition',
    sourcePath: 'instance/workflows/mas-health-review/runtime.json',
    targetActionType: 'workflow_execution',
    targetType: 'workflow',
    targetId: 'mas-health-review',
    displayName: 'MAS Health Review',
    description: 'Run the governed MAS health review workflow.',
    owner: 'mas',
    lifecycleState: 'active',
    sideEffectLevel: 'read_only',
    executionMode: 'on_demand',
    readinessSummary: buildReadinessSummary({
      status: 'not_evaluated',
      reason: 'Workflow lifecycle is active; workflow runtime readiness will be validated by downstream workflow request resolution.',
    }),
    warnings: [],
    metadata: {
      semanticTags: [
        'mas.health.review',
        'workflow.review',
      ],
    },
  };
}

function buildInspectIntent(inputText) {
  const request = {
    originalInput: inputText,
    command: 'ask',
    conversationId: 'alfred-admin',
    metadata: {},
  };
  const candidate = buildSemanticClassifierCandidateFromAffordance({
    affordance: buildInspectAffordance(),
    candidateId: 'candidate-mas-inspect-001',
    confidence: 'high',
    confidenceScore: 0.95,
    reason: 'The user clearly requested a read-only MAS inspection.',
    matchedSignals: [
      'inspect-mas',
      'inventory-request',
    ],
  });

  return buildSemanticClassifiedIntentFromCandidate({
    request,
    candidate,
    intentId: 'admin.mas.inspect',
    intentType: 'administrative_diagnostic',
    confidence: 'high',
    confidenceScore: 0.95,
    normalizedGoal: 'Inspect the current MAS state and explain the observed result.',
    requestedOutcome: 'Run the MAS inspection tool and explain the verified result.',
    requestType: 'tool_action',
    reason: 'The request explicitly asks for a governed MAS inspection.',
    evidence: [
      'The user asked for an inspection of the MAS.',
    ],
  });
}

function buildHealthReviewPlanIntent(inputText) {
  const request = {
    originalInput: inputText,
    command: 'ask',
    conversationId: 'alfred-admin',
    metadata: {},
  };
  const candidate = buildSemanticClassifierCandidateFromAffordance({
    affordance: buildWorkflowAffordance(),
    candidateId: 'candidate-mas-health-review-plan-001',
    confidence: 'high',
    confidenceScore: 0.91,
    reason: 'A broader MAS health review is the better governed plan to preview before execution.',
    matchedSignals: [
      'plan-before-execution',
      'health-review-better-than-inspection',
    ],
    rejectedAlternatives: [
      {
        affordance: buildInspectAffordance(),
        reason: 'A quick inspection is narrower and does not cover the broader health-review workflow the user asked us to compare.',
        matchedSignals: [
          'quick-inspection',
        ],
      },
    ],
  });

  return buildSemanticClassifiedIntentFromCandidate({
    request,
    candidate,
    intentId: 'admin.mas.health_review.plan',
    intentType: 'administrative_plan_preview',
    confidence: 'high',
    confidenceScore: 0.91,
    normalizedGoal: 'Preview the best governed MAS review path before execution.',
    requestedOutcome: 'Present the MAS health review plan before any execution begins.',
    requestType: 'plan_request',
    reason: 'The request asks the runtime to decide on the safer governed review path before executing anything.',
    evidence: [
      'The user asked for a plan before execution.',
      'The user asked whether inspection or health review is the better path.',
    ],
  });
}

function buildHealthReviewIntent(inputText) {
  const request = {
    originalInput: inputText,
    command: 'ask',
    conversationId: 'alfred-admin',
    metadata: {},
  };
  const candidate = buildSemanticClassifierCandidateFromAffordance({
    affordance: buildWorkflowAffordance(),
    candidateId: 'candidate-mas-health-review-001',
    confidence: 'high',
    confidenceScore: 0.94,
    reason: 'The user requested a broader MAS health review workflow.',
    matchedSignals: [
      'health-review',
      'workflow-summary',
    ],
  });

  return buildSemanticClassifiedIntentFromCandidate({
    request,
    candidate,
    intentId: 'admin.mas.health_review',
    intentType: 'administrative_workflow',
    confidence: 'high',
    confidenceScore: 0.94,
    normalizedGoal: 'Run the MAS health review workflow and summarize the verified outcome.',
    requestedOutcome: 'Execute the MAS health review workflow and summarize what happened with evidence references.',
    requestType: 'workflow_action',
    reason: 'The request asks for a broader health review and an evidence-backed summary.',
    evidence: [
      'The user explicitly asked for a health review and an explanation of what happened.',
    ],
  });
}

async function upsertResources({
  projectRootPath,
  resources,
}) {
  const registryPath = path.join(projectRootPath, 'instance', 'registries', 'resources.json');
  const registry = await readJsonFile(registryPath);
  const resourcesById = new Map(registry.resources.map((resource) => {
    return [resource.resourceId, resource];
  }));

  for (const resource of resources) {
    resourcesById.set(resource.resourceId, resource);
  }

  registry.resources = [...resourcesById.values()];
  await writeJsonFile(registryPath, registry);
}

async function appendBindingAndPermission({
  projectRootPath,
  resourceId,
  accessMode,
  secretReferenceId = null,
  ruleId,
}) {
  const operationalIdentityRootPath = path.join(
    projectRootPath,
    'instance',
    'operational-identities',
    'alfred',
  );
  const bindingsPath = path.join(operationalIdentityRootPath, 'bindings.json');
  const permissionsPath = path.join(operationalIdentityRootPath, 'permissions.json');
  const bindings = await readJsonFile(bindingsPath);
  const permissions = await readJsonFile(permissionsPath);

  if (!bindings.bindings.some((binding) => binding.resourceId === resourceId && binding.accessMode === accessMode)) {
    bindings.bindings.push(buildBinding({
      resourceId,
      accessMode,
      secretReferenceId,
    }));
  }

  if (!permissions.rules.some((rule) => rule.ruleId === ruleId)) {
    permissions.rules.push(buildAllowRule({
      ruleId,
      resourceId,
      accessModes: [
        accessMode,
      ],
    }));
  }

  await writeJsonFile(bindingsPath, bindings);
  await writeJsonFile(permissionsPath, permissions);
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
}) {
  await upsertResources({
    projectRootPath,
    resources: [
      buildResourceDefinition({
        resourceId: 'mas-filesystem',
        resourceType: 'storage',
        displayName: 'MAS Filesystem',
      }),
      buildResourceDefinition({
        resourceId: 'claude-api',
        resourceType: 'brain-provider',
        displayName: 'Claude API',
      }),
      buildResourceDefinition({
        resourceId: 'ollama-api',
        resourceType: 'brain-provider',
        displayName: 'Ollama API',
      }),
      {
        ...buildResourceDefinition({
          resourceId: 'alfred-whatsapp',
          resourceType: 'channel',
          displayName: 'Alfred WhatsApp',
        }),
        lifecycleState: 'draft',
      },
      {
        ...buildResourceDefinition({
          resourceId: 'maria-instagram',
          resourceType: 'channel',
          displayName: 'Maria Instagram',
        }),
        lifecycleState: 'draft',
      },
    ],
  });

  await appendBindingAndPermission({
    projectRootPath,
    resourceId: 'mas-filesystem',
    accessMode: 'read',
    ruleId: 'allow-alfred-mas-filesystem-read',
  });

  await writeTool({
    projectRootPath,
    toolDefinition: buildToolDefinition({
      toolId: 'mas.system.inspect',
      displayName: 'MAS System Inspect',
      description: 'Inspect the MAS inventory without mutating the instance.',
      requiredResourceTypes: [
        'storage',
      ],
      requiredAccessModes: [
        'read',
      ],
      requiredPermissionModes: [
        'tool.execute',
      ],
    }),
    executorSource: executorSource ?? [
      'export async function executeTool() {',
      '  return {',
      '    status: "succeeded",',
      '    summary: "MAS system inspection completed without mutating the instance.",',
      '    data: {',
      '      diagnosticSummary: {',
      '        counts: {',
      '          registeredCognitiveIdentities: 4,',
      '          configuredOperationalIdentities: 3,',
      '          activeOperationalIdentities: 3,',
      '          resources: 8,',
      '          activeResources: 6,',
      '          installedTools: 4,',
      '          activeTools: 4,',
      '          installedWorkflows: 1,',
      '          activeWorkflowRuntimes: 1',
      '        }',
      '      },',
      '      sections: {',
      '        cognitiveIdentities: {',
      '          registeredCognitiveIdentityIds: ["community-manager", "copywriter-senior", "media-buyer", "system-steward"]',
      '        },',
      '        operationalIdentities: {',
      '          configuredOperationalIdentityIds: ["alfred", "juan", "maria"],',
      '          activeOperationalIdentityIds: ["alfred", "juan", "maria"]',
      '        },',
      '        resources: {',
      '          lifecycleCounts: { active: 6, draft: 2, disabled: 0, unknown: 0 },',
      '          activeResourceIds: ["chatgpt-api", "claude-api", "gemini-api", "mas-filesystem", "ollama-api", "openrouter-api"],',
      '          draftResourceIds: ["alfred-whatsapp", "maria-instagram"]',
      '        },',
      '        tools: {',
      '          activeToolIds: ["mas.permissions.inspect", "mas.system.inspect", "mas.tools.inspect", "mas.workflows.inspect"]',
      '        },',
      '        workflows: {',
      '          activeWorkflowRuntimeIds: ["mas-health-review"],',
      '          installedWorkflowIds: ["mas-health-review"]',
      '        }',
      '      }',
      '    },',
      '    warnings: [],',
      '    errors: []',
      '  };',
      '}',
    ].join('\n'),
  });
}

async function addMasHealthReviewWorkflow({ projectRootPath }) {
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
      allowWritebackCandidates: false,
    },
  });
  await writeJsonFile(path.join(workflowRootPath, 'workflow.json'), {
    kind: 'workflow_instruction_definition',
    version: 1,
    workflowId: 'mas-health-review',
    displayName: 'MAS Health Review',
    lifecycleState: 'active',
    description: 'Review safe MAS health evidence before producing an answer.',
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

async function addApprovalRequiredPublishToolForAlfred({ projectRootPath }) {
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

  await appendBindingAndPermission({
    projectRootPath,
    resourceId: 'meta-channel',
    accessMode: 'publish',
    ruleId: 'allow-alfred-meta-channel-publish',
  });

  await writeTool({
    projectRootPath,
    toolDefinition: buildToolDefinition({
      toolId: 'meta.reply.publish',
      displayName: 'Meta Reply Publish',
      description: 'Publish an external Meta reply after explicit human approval.',
      sideEffectLevel: 'publish_external',
      requiredResourceTypes: [
        'channel',
      ],
      requiredAccessModes: [
        'publish',
      ],
      requiredPermissionModes: [
        'tool.publish',
      ],
      approvalRequired: true,
    }),
    executorSource: [
      'export async function executeTool() {',
      '  throw new Error("Approval-required publish tool must not execute before approval.");',
      '}',
    ].join('\n'),
  });
}

function buildBrainToolRequestEnvelope({
  toolRequestId = 'tool-request-001',
  toolId = 'mas.system.inspect',
  purpose = 'Inspect the MAS before answering.',
  expectedSideEffectLevel = 'read_only',
  input = {
    includeCounts: true,
  },
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

function buildClassifierOutputText(value) {
  if (typeof value === 'string') {
    return value;
  }

  return JSON.stringify(value, null, 2);
}

function extractFirstMatch(text, expression) {
  const match = text.match(expression);
  return match ? match[1] : null;
}

function flattenMessageContent(content) {
  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    return content.map((part) => {
      if (typeof part === 'string') {
        return part;
      }

      if (part && typeof part === 'object' && typeof part.text === 'string') {
        return part.text;
      }

      return '';
    }).join('\n');
  }

  if (content && typeof content === 'object' && typeof content.text === 'string') {
    return content.text;
  }

  return '';
}

async function invokePlannerExecutorAcid({
  projectRootPath,
  inputText,
  initialOutputText,
  classifierOutput = null,
  followupOutput = null,
}) {
  let initialCallCount = 0;
  let classifierCallCount = 0;
  let followupCallCount = 0;

  return withEnvironment(
    {
      "openrouter-api-key": OPENROUTER_SECRET,
      "gemini-api-key": GEMINI_SECRET,
    },
    async () => {
      const result = await runAgentInvocation({
        projectRootPath,
        operationalIdentityId: 'alfred',
        invocationMode: 'probabilistic',
        semanticIntentRuntimeMode: 'provider',
        command: 'ask',
        inputText,
        requestedBy: 'planner-executor-acid-suite',
        fetchImplementation: async (url, options) => {
          assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions');

          const body = JSON.parse(options.body);
          const systemMessage = body.messages.map((message) => {
            return flattenMessageContent(message.content);
          }).join('\n\n');

          if (/advisory action-intent classifier/u.test(systemMessage)) {
            classifierCallCount += 1;

            return createOpenRouterResponse({
              responseId: 'planner-executor-acid-classifier',
              outputText: buildClassifierOutputText(
                typeof classifierOutput === 'function'
                  ? classifierOutput({ body, systemMessage })
                  : classifierOutput,
              ),
              promptTokens: 220,
              completionTokens: 60,
            });
          }

          if (
            /## Tool Observation/u.test(systemMessage)
            || /## Workflow Observation/u.test(systemMessage)
            || /Runtime Follow-up:/u.test(systemMessage)
          ) {
            followupCallCount += 1;

            return createOpenRouterResponse({
              responseId: `planner-executor-acid-followup-${followupCallCount}`,
              outputText: typeof followupOutput === 'function'
                ? followupOutput({ body, systemMessage })
                : followupOutput,
              promptTokens: 260,
              completionTokens: 70,
            });
          }

          initialCallCount += 1;

          return createOpenRouterResponse({
            responseId: `planner-executor-acid-initial-${initialCallCount}`,
            outputText: typeof initialOutputText === 'function'
              ? initialOutputText({ body, systemMessage })
              : initialOutputText,
          });
        },
      });

      const invocationSession = JSON.parse(await readFile(result.persistence.invocationSessionRecordPath, 'utf8'));
      const invocationReport = await readFile(result.persistence.invocationReportPath, 'utf8');

      return {
        result,
        invocationSession,
        invocationReport,
        callCounts: {
          initial: initialCallCount,
          classifier: classifierCallCount,
          followup: followupCallCount,
        },
      };
    },
  );
}

test('PL acid: Alfred inspects the MAS and explains the verified result through the full planner/executor loop', async () => {
  const projectRootPath = await createAlfredProbabilisticProjectFixture();

  await addAlfredInspectTool({
    projectRootPath,
  });

  const {
    result,
    invocationSession,
    invocationReport,
    callCounts,
  } = await invokePlannerExecutorAcid({
    projectRootPath,
    inputText: 'Please inspect the MAS and explain the result.',
    initialOutputText: 'I will review the MAS state and then explain the verified result.',
    classifierOutput: buildInspectIntent('Please inspect the MAS and explain the result.'),
    followupOutput: ({ systemMessage }) => {
      const toolRunId = extractFirstMatch(systemMessage, /Tool Run ID: ([^\r\n]+)/u);
      const auditRecordPath = extractFirstMatch(systemMessage, /Audit Record Path: ([^\r\n]+)/u);

      assert.ok(toolRunId);
      assert.ok(auditRecordPath);

      return [
        'I inspected the MAS through verified runtime evidence.',
        `Tool run: ${toolRunId}.`,
        `Audit record: ${auditRecordPath}.`,
        'Observed counts: 4 registered cognitive identities, 3 configured operational identities, 8 total resources, and 6 active resources.',
      ].join(' ');
    },
  });

  assert.equal(callCounts.initial, 1);
  assert.equal(callCounts.classifier, 1);
  assert.equal(callCounts.followup, 1);
  assert.equal(result.status, 'completed');
  assert.equal(result.workCycle.overallOutcome, 'acted');
  assert.equal(result.executionPlan.kind, 'agent_execution_plan');
  assert.equal(result.planExecutionCoordination.status, 'ready');
  assert.equal(result.planExecutionCoordination.selectedTargetId, 'mas.system.inspect');
  assert.equal(result.verificationGate.status, 'passed');
  assert.equal(result.output.brainToolExecution.executionPerformed, true);
  assert.equal(result.output.brainToolObservation.status, 'succeeded');
  assert.equal(result.workCycle.stages.find((stage) => stage.stageId === 'plan').status, 'completed');
  assert.equal(result.workCycle.stages.find((stage) => stage.stageId === 'execute').status, 'completed');
  assert.equal(result.workCycle.stages.find((stage) => stage.stageId === 'observe').status, 'completed');
  assert.equal(result.workCycle.stages.find((stage) => stage.stageId === 'verify').status, 'completed');
  assert.match(result.output.outputText, /Tool run:/u);
  assert.match(result.output.outputText, /Audit record:/u);
  assert.equal(invocationSession.executionPlan.requiredTools[0], 'mas.system.inspect');
  assert.equal(invocationSession.planExecutionCoordination.status, 'ready');
  assert.equal(invocationSession.verificationGate.status, 'passed');
  assert.match(invocationReport, /Execution Plan/u);
  assert.match(invocationReport, /Plan Execution Coordination/u);
  assert.match(invocationReport, /Verification Gate/u);
});

test('PL acid: Alfred can preview the better governed review path before executing anything', async () => {
  const projectRootPath = await createAlfredProbabilisticProjectFixture();

  await addAlfredInspectTool({
    projectRootPath,
  });
  await addMasHealthReviewWorkflow({
    projectRootPath,
  });

  const {
    result,
    invocationSession,
    invocationReport,
    callCounts,
  } = await invokePlannerExecutorAcid({
    projectRootPath,
    inputText: 'Before executing anything, decide whether a quick inspection or a broader health review is better and show me the plan.',
    initialOutputText: [
      'The broader MAS health review is the better governed path to preview before execution.',
      'Plan preview:',
      '1. Validate the workflow and its tool dependency.',
      '2. If you approve execution later, run workflow mas-health-review.',
      '3. Observe the workflow result and summarize the evidence.',
    ].join(' '),
    classifierOutput: buildHealthReviewPlanIntent('Before executing anything, decide whether a quick inspection or a broader health review is better and show me the plan.'),
  });

  assert.equal(callCounts.initial, 1);
  assert.equal(callCounts.classifier, 1);
  assert.equal(callCounts.followup, 0);
  assert.equal(result.status, 'completed');
  assert.equal(result.workCycle.overallOutcome, 'planned_only');
  assert.equal(result.executionPlan.kind, 'agent_execution_plan');
  assert.equal(result.executionPlan.metadata.planMode, 'preview_only');
  assert.equal(result.executionPlan.requiredWorkflows[0], 'mas-health-review');
  assert.equal(result.planExecutionCoordination.status, 'no_execution');
  assert.equal(result.planExecutionCoordination.selectedTargetId, 'mas-health-review');
  assert.equal(result.planExecutionCoordination.metadata.previewOnly, true);
  assert.equal(result.workCycle.stages.find((stage) => stage.stageId === 'plan').status, 'completed');
  assert.equal(result.workCycle.stages.find((stage) => stage.stageId === 'execute').status, 'skipped');
  assert.match(result.output.outputText, /Plan preview:/u);
  assert.equal(invocationSession.executionPlan.metadata.planMode, 'preview_only');
  assert.equal(invocationSession.planExecutionCoordination.status, 'no_execution');
  assert.match(invocationReport, /Plan Present: yes/u);
  assert.match(invocationReport, /Status: no_execution/u);
});

test('PL acid: risky actions pause for approval instead of executing', async () => {
  const projectRootPath = await createAlfredProbabilisticProjectFixture();

  await addApprovalRequiredPublishToolForAlfred({
    projectRootPath,
  });

  const {
    result,
    invocationSession,
    invocationReport,
    callCounts,
  } = await invokePlannerExecutorAcid({
    projectRootPath,
    inputText: 'Please publish this reviewed Meta reply if allowed.',
    initialOutputText: JSON.stringify(buildBrainToolRequestEnvelope({
      toolRequestId: 'tool-request-publish-001',
      toolId: 'meta.reply.publish',
      purpose: 'Publish the reviewed Meta reply if approval permits it.',
      expectedSideEffectLevel: 'publish_external',
      input: {
        conversationId: 'conversation-123',
        replyText: 'Thanks for your message. This reply should be published only after human approval.',
      },
    }), null, 2),
  });

  assert.equal(callCounts.initial, 1);
  assert.equal(callCounts.classifier, 0);
  assert.equal(callCounts.followup, 0);
  assert.equal(result.status, 'completed');
  assert.equal(result.workCycle.overallOutcome, 'approval_paused');
  assert.equal(result.output.toolRequestResolution.status, 'approval_required');
  assert.equal(result.output.brainToolExecution.executionPerformed, false);
  assert.equal(result.output.actionResultAssessment.status, 'approval_pause');
  assert.equal(result.planExecutionCoordination.status, 'approval_required');
  assert.equal(result.planExecutionCoordination.runtimeAction, 'pause_for_approval');
  assert.equal(result.workCycle.stages.find((stage) => stage.stageId === 'request_approval').status, 'blocked');
  assert.equal(result.workCycle.stages.find((stage) => stage.stageId === 'execute').status, 'blocked');
  assert.equal(invocationSession.planExecutionCoordination.status, 'approval_required');
  assert.match(invocationReport, /Approval Required: yes/u);
  assert.match(invocationReport, /Runtime Action: pause_for_approval/u);
});

test('PL acid: Alfred continues honestly after a failed tool observation instead of fabricating success', async () => {
  const projectRootPath = await createAlfredProbabilisticProjectFixture();
  const failureSecretProbe = 'ACID_FAILURE_SECRET_DO_NOT_LEAK';

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
    invocationSession,
    invocationReport,
    callCounts,
  } = await invokePlannerExecutorAcid({
    projectRootPath,
    inputText: 'Inspect the MAS and continue with an honest summary even if something fails.',
    initialOutputText: JSON.stringify(buildBrainToolRequestEnvelope(), null, 2),
    followupOutput: ({ systemMessage }) => {
      assert.match(systemMessage, /Tool Status: failed/u);
      assert.match(systemMessage, /Tool Errors/u);
      assert.doesNotMatch(systemMessage, new RegExp(failureSecretProbe, 'u'));
      assert.match(systemMessage, /\[REDACTED\]/u);

      return 'The MAS inspection failed. I cannot claim a successful inspection. The runtime recorded a failed tool observation, and we should review that audit record before trying again.';
    },
  });

  assert.equal(callCounts.initial, 1);
  assert.equal(callCounts.classifier, 0);
  assert.equal(callCounts.followup, 1);
  assert.equal(result.status, 'completed');
  assert.equal(result.output.brainToolExecution.executionPerformed, true);
  assert.equal(result.output.brainToolExecution.toolResultStatus, 'failed');
  assert.equal(result.output.brainToolObservation.status, 'failed');
  assert.equal(result.output.actionResultAssessment.status, 'failure');
  assert.equal(result.workCycle.stages.find((stage) => stage.stageId === 'observe').status, 'completed');
  assert.equal(result.workCycle.stages.find((stage) => stage.stageId === 'verify').status, 'completed');
  assert.equal(result.workCycle.overallOutcome, 'completed');
  assert.ok(
    result.output.outputText === null ||
      /failed tool observation/u.test(result.output.outputText),
  );
  assert.doesNotMatch(JSON.stringify(invocationSession), new RegExp(failureSecretProbe, 'u'));
  assert.equal(invocationSession.actionResultAssessment.status, 'failure');
  assert.match(invocationReport, /Tool Result Status: failed/u);
  assert.match(invocationReport, /Status: failure/u);
});

test('PL acid: Alfred can summarize what happened with evidence links after a governed workflow run', async () => {
  const projectRootPath = await createAlfredProbabilisticProjectFixture();

  await addAlfredInspectTool({
    projectRootPath,
  });
  await addMasHealthReviewWorkflow({
    projectRootPath,
  });

  const {
    result,
    invocationSession,
    invocationReport,
    callCounts,
  } = await invokePlannerExecutorAcid({
    projectRootPath,
    inputText: 'Run a full MAS health review and summarize what happened with evidence links.',
    initialOutputText: 'I will review MAS health and then summarize exactly what happened with evidence references.',
    classifierOutput: buildHealthReviewIntent('Run a full MAS health review and summarize what happened with evidence links.'),
    followupOutput: ({ systemMessage }) => {
      const workflowRunId = extractFirstMatch(systemMessage, /Workflow Run ID: ([^\r\n]+)/u);
      const workflowStatePath = extractFirstMatch(systemMessage, /Workflow Run State Path: ([^\r\n]+)/u);
      const toolRunId = extractFirstMatch(systemMessage, /Tool Run IDs:\r?\n- ([^\r\n]+)/u);

      assert.ok(workflowRunId);
      assert.ok(workflowStatePath);
      assert.ok(toolRunId);

      return [
        'The MAS health review completed successfully.',
        `Evidence links: workflow ${workflowRunId}, state ${workflowStatePath}, tool ${toolRunId}.`,
        'The workflow completed the inspect-system step and preserved the read-only boundary.',
      ].join(' ');
    },
  });

  assert.equal(callCounts.initial, 1);
  assert.equal(callCounts.classifier, 1);
  assert.equal(callCounts.followup, 1);
  assert.equal(result.status, 'completed');
  assert.equal(result.workCycle.overallOutcome, 'acted');
  assert.equal(result.executionPlan.requiredWorkflows[0], 'mas-health-review');
  assert.equal(result.planExecutionCoordination.status, 'ready');
  assert.equal(result.output.workflowRequestResolution.status, 'accepted');
  assert.equal(result.output.brainWorkflowExecution.executionPerformed, true);
  assert.equal(result.output.brainWorkflowObservation.status, 'succeeded');
  assert.equal(result.verificationGate.status, 'passed');
  assert.equal(result.workCycle.stages.find((stage) => stage.stageId === 'verify').status, 'completed');
  assert.match(result.output.outputText, /Evidence links:/u);
  assert.match(result.output.outputText, /workflow-run-/u);
  assert.match(result.output.outputText, /memory\/state\/workflows\//u);
  assert.equal(invocationSession.planExecutionCoordination.selectedTargetId, 'mas-health-review');
  assert.match(invocationReport, /Workflow Observation/u);
  assert.match(invocationReport, /Verification Gate/u);
});
