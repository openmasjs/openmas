import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { assertBrainWorkflowRequestEnvelope } from '../../src/contracts/brain-workflow-request-contract.js';
import { parseBrainWorkflowRequestEnvelopeFromText } from '../../src/workflows/parse-brain-workflow-request-envelope.js';
import { resolveBrainWorkflowRequestForInvocation } from '../../src/workflows/resolve-brain-workflow-request-for-invocation.js';
import { executeAcceptedBrainWorkflowRequest } from '../../src/workflows/execute-accepted-brain-workflow-request.js';
import { runAgentInvocation } from '../../src/invocation/run-agent-invocation.js';
import { buildFakeGeminiSecretProbe } from '../helpers/fake-secret-probes.js';
import {
  createAlfredProbabilisticProjectFixture,
  withEnvironment,
} from '../helpers/create-alfred-probabilistic-fixture.js';

const FAKE_WORKFLOW_SECRET = buildFakeGeminiSecretProbe('FAKE_BRAIN_WORKFLOW_SECRET_SHOULD_NOT_LEAK');

function buildBrainWorkflowRequestEnvelope(overrides = {}) {
  return {
    kind: 'brain_workflow_request',
    version: 1,
    workflowRequestId: 'workflow-request-001',
    workflowId: 'mas-health-review',
    input: {
      includeCounts: true,
    },
    purpose: 'Run the MAS health review before answering.',
    expectedSideEffectLevel: 'read_only',
    ...overrides,
  };
}

function buildBrainOutput({ outputText }) {
  return {
    executionType: 'probabilistic_brain',
    status: 'completed',
    providerId: 'openrouter-api',
    modelId: 'openrouter/free',
    requestType: 'generate_text',
    outputText,
    finishReason: 'stop',
    providerResponseId: 'provider-response-workflow-request-001',
    usage: {
      inputTokens: 100,
      outputTokens: 20,
      totalTokens: 120,
    },
    warnings: [],
  };
}

function buildToolDefinition(overrides = {}) {
  return {
    kind: 'tool_definition',
    version: 1,
    toolId: 'mas.system.inspect',
    displayName: 'MAS System Inspect',
    description: 'Reads safe MAS system structure and inventory metadata without mutating the instance.',
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

function buildWorkflowRuntimeDefinition(overrides = {}) {
  return {
    kind: 'workflow_runtime_definition',
    version: 1,
    workflowId: 'mas-health-review',
    lifecycleState: 'active',
    executionMode: 'on_demand',
    statePolicy: {
      persistState: true,
      resumeAllowed: false,
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
    ...overrides,
  };
}

async function writeJsonFile(filePath, payload) {
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

async function addWorkflowRuntimeToAlfredFixture({
  projectRootPath,
  toolDefinition = buildToolDefinition(),
  workflowRuntimeDefinition = buildWorkflowRuntimeDefinition(),
  executorSource = null,
}) {
  const instanceRootPath = path.join(projectRootPath, 'instance');
  const toolRootPath = path.join(instanceRootPath, 'tools', toolDefinition.toolId);
  const workflowRootPath = path.join(instanceRootPath, 'workflows', workflowRuntimeDefinition.workflowId);

  await mkdir(toolRootPath, { recursive: true });
  await mkdir(workflowRootPath, { recursive: true });

  await writeJsonFile(
    path.join(instanceRootPath, 'registries', 'resources.json'),
    {
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
        },
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
          resourceId: 'mas-filesystem',
          resourceType: 'storage',
          displayName: 'MAS Filesystem',
          ownershipScope: 'shared',
          lifecycleState: 'active',
        },
      ],
    },
  );

  await writeJsonFile(
    path.join(instanceRootPath, 'operational-identities', 'alfred', 'bindings.json'),
    {
      kind: 'operational_identity_bindings',
      version: 1,
      operationalIdentityId: 'alfred',
      bindings: [
        {
          resourceId: 'openrouter-api',
          accessMode: 'execute',
          bindingState: 'active',
          credentialReferenceId: 'openrouter-api-key',
        },
        {
          resourceId: 'gemini-api',
          accessMode: 'execute',
          bindingState: 'active',
          credentialReferenceId: 'gemini-api-key',
        },
        {
          resourceId: 'mas-filesystem',
          accessMode: 'read',
          bindingState: 'active',
          credentialReferenceId: null,
        },
      ],
    },
  );

  await writeJsonFile(
    path.join(instanceRootPath, 'operational-identities', 'alfred', 'permissions.json'),
    {
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
          ruleId: 'allow-mas-filesystem-read',
          effect: 'allow',
          resourceId: 'mas-filesystem',
          accessModes: ['read'],
        },
      ],
    },
  );

  await writeJsonFile(
    path.join(toolRootPath, 'tool.json'),
    toolDefinition,
  );
  await writeFile(
    path.join(toolRootPath, 'executor.js'),
    executorSource ?? [
      'export async function executeTool({ input }) {',
      '  return {',
      '    status: "succeeded",',
      '    summary: "Workflow-requested MAS inspection completed.",',
      '    data: {',
      '      inputEcho: input,',
      `      apiKey: "${FAKE_WORKFLOW_SECRET}",`,
      '      registeredOperationalIdentities: ["alfred"]',
      '    },',
      '    warnings: [],',
      '    errors: []',
      '  };',
      '}',
    ].join('\n'),
    'utf8',
  );
  await writeJsonFile(
    path.join(workflowRootPath, 'runtime.json'),
    workflowRuntimeDefinition,
  );
}

test('assertBrainWorkflowRequestEnvelope accepts the strict v1 request shape', () => {
  const envelope = assertBrainWorkflowRequestEnvelope(buildBrainWorkflowRequestEnvelope());

  assert.equal(envelope.kind, 'brain_workflow_request');
  assert.equal(envelope.version, 1);
  assert.equal(envelope.workflowRequestId, 'workflow-request-001');
  assert.equal(envelope.workflowId, 'mas-health-review');
  assert.equal(envelope.input.includeCounts, true);
  assert.equal(envelope.expectedSideEffectLevel, 'read_only');
});

test('parseBrainWorkflowRequestEnvelopeFromText parses exact JSON and rejects malformed envelopes', () => {
  const parsed = parseBrainWorkflowRequestEnvelopeFromText({
    outputText: JSON.stringify(buildBrainWorkflowRequestEnvelope()),
  });
  const fenced = parseBrainWorkflowRequestEnvelopeFromText({
    outputText: [
      '```json',
      JSON.stringify(buildBrainWorkflowRequestEnvelope({
        workflowRequestId: 'workflow-request-002',
      })),
      '```',
    ].join('\n'),
  });
  const normalJsonAnswer = parseBrainWorkflowRequestEnvelopeFromText({
    outputText: JSON.stringify({
      answer: 'This is not a workflow request.',
    }),
  });
  const invalid = parseBrainWorkflowRequestEnvelopeFromText({
    outputText: '{"kind":"brain_workflow_request","version":1',
  });
  const embedded = parseBrainWorkflowRequestEnvelopeFromText({
    outputText: [
      'Claro, aqui tienes el plan general.',
      '<tool_call>brain_workflow_request',
      JSON.stringify(buildBrainWorkflowRequestEnvelope({
        workflowRequestId: 'workflow-request-embedded-001',
      }), null, 2),
    ].join('\n'),
  });

  assert.equal(parsed.status, 'parsed');
  assert.equal(parsed.workflowRequest.workflowId, 'mas-health-review');
  assert.equal(fenced.status, 'parsed');
  assert.equal(fenced.workflowRequest.workflowRequestId, 'workflow-request-002');
  assert.equal(embedded.status, 'parsed');
  assert.equal(embedded.workflowRequest.workflowRequestId, 'workflow-request-embedded-001');
  assert.equal(normalJsonAnswer.status, 'no_request');
  assert.equal(invalid.status, 'invalid');
});

test('resolveBrainWorkflowRequestForInvocation accepts on-demand read-only workflows and rejects unsafe or unknown requests', () => {
  const accepted = resolveBrainWorkflowRequestForInvocation({
    brainOutput: buildBrainOutput({
      outputText: JSON.stringify(buildBrainWorkflowRequestEnvelope()),
    }),
    workflowRuntimeDefinitions: [buildWorkflowRuntimeDefinition()],
  });
  const unknown = resolveBrainWorkflowRequestForInvocation({
    brainOutput: buildBrainOutput({
      outputText: JSON.stringify(buildBrainWorkflowRequestEnvelope({
        workflowId: 'unknown-workflow',
      })),
    }),
    workflowRuntimeDefinitions: [buildWorkflowRuntimeDefinition()],
  });
  const nonReadOnly = resolveBrainWorkflowRequestForInvocation({
    brainOutput: buildBrainOutput({
      outputText: JSON.stringify(buildBrainWorkflowRequestEnvelope({
        expectedSideEffectLevel: 'publish_external',
      })),
    }),
    workflowRuntimeDefinitions: [buildWorkflowRuntimeDefinition()],
  });

  assert.equal(accepted.status, 'accepted');
  assert.equal(accepted.runtimeAction, 'queue_for_execution');
  assert.equal(accepted.executionAllowed, true);
  assert.equal(accepted.autoExecutionPerformed, false);
  assert.equal(unknown.status, 'denied');
  assert.match(unknown.reason, /not evaluated as available/u);
  assert.equal(nonReadOnly.status, 'denied');
  assert.match(nonReadOnly.reason, /expectedSideEffectLevel must be "read_only"/u);
});

test('executeAcceptedBrainWorkflowRequest runs read-only workflows and returns bounded observation evidence', async () => {
  const projectRootPath = await createAlfredProbabilisticProjectFixture();
  const workflowRuntimeDefinition = buildWorkflowRuntimeDefinition({
    memoryPolicy: {
      allowWritebackCandidates: true,
    },
  });

  await addWorkflowRuntimeToAlfredFixture({
    projectRootPath,
    workflowRuntimeDefinition,
  });

  const execution = await executeAcceptedBrainWorkflowRequest({
    masRootPath: path.join(projectRootPath, 'instance'),
    invocationId: 'invocation-workflow-execution-001',
    operationalIdentityId: 'alfred',
    requestedBy: 'test-suite',
    workflowRequestResolution: resolveBrainWorkflowRequestForInvocation({
      brainOutput: buildBrainOutput({
        outputText: JSON.stringify(buildBrainWorkflowRequestEnvelope()),
      }),
      workflowRuntimeDefinitions: [workflowRuntimeDefinition],
    }),
    toolDefinitions: [buildToolDefinition()],
  });
  const serializedExecution = JSON.stringify(execution);
  const persistedState = JSON.parse(await readFile(execution.workflowRunStateRecordPath, 'utf8'));
  const persistedWritebackRequest = JSON.parse(await readFile(execution.memoryWritebackPersistence.recordPath, 'utf8'));

  assert.equal(execution.status, 'executed');
  assert.equal(execution.workflowRunStatus, 'succeeded');
  assert.equal(execution.observation.completedSteps[0], 'inspect-system');
  assert.equal(execution.observation.stepSummaries[0].status, 'succeeded');
  assert.equal(execution.observation.stepSummaries[0].toolResultStatus, 'succeeded');
  assert.equal(execution.memoryWritebackRequest.requiresHumanApproval, true);
  assert.equal(execution.memoryWritebackRequest.memoryWrites.length, 2);
  assert.equal(execution.memoryWritebackPersistence.writeCount, 2);
  assert.deepEqual(
    execution.observation.memoryWritebackCandidateIds.toSorted(),
    execution.memoryWritebackRequest.memoryWrites.map((candidate) => {
      return candidate.writeId;
    }).toSorted(),
  );
  assert.equal(persistedState.status, 'succeeded');
  assert.deepEqual(
    persistedState.memoryWritebackCandidateIds.toSorted(),
    execution.observation.memoryWritebackCandidateIds.toSorted(),
  );
  assert.deepEqual(
    persistedWritebackRequest.memoryWrites.map((candidate) => candidate.writeType).toSorted(),
    ['artifact_reference', 'task_state_update'],
  );
  assert.doesNotMatch(serializedExecution, new RegExp(FAKE_WORKFLOW_SECRET, 'u'));
  assert.doesNotMatch(JSON.stringify(persistedWritebackRequest), new RegExp(FAKE_WORKFLOW_SECRET, 'u'));
});

test('executeAcceptedBrainWorkflowRequest pauses read-only workflows when a step requires approval', async () => {
  const projectRootPath = await createAlfredProbabilisticProjectFixture();

  await addWorkflowRuntimeToAlfredFixture({
    projectRootPath,
    toolDefinition: buildToolDefinition({
      approvalPolicy: {
        required: true,
      },
    }),
    executorSource: [
      'export async function executeTool() {',
      '  throw new Error("approval-required workflow executor must not load");',
      '}',
    ].join('\n'),
  });

  const masRootPath = path.join(projectRootPath, 'instance');
  const workflowRequestResolution = resolveBrainWorkflowRequestForInvocation({
    brainOutput: buildBrainOutput({
      outputText: JSON.stringify(buildBrainWorkflowRequestEnvelope()),
    }),
    workflowRuntimeDefinitions: [buildWorkflowRuntimeDefinition()],
  });
  const execution = await executeAcceptedBrainWorkflowRequest({
    masRootPath,
    invocationId: 'invocation-workflow-approval-001',
    operationalIdentityId: 'alfred',
    requestedBy: 'test-suite',
    workflowRequestResolution,
    toolDefinitions: [
      buildToolDefinition({
        approvalPolicy: {
          required: true,
        },
      }),
    ],
  });
  const serializedExecution = JSON.stringify(execution);

  assert.equal(execution.status, 'executed');
  assert.equal(execution.workflowRunStatus, 'waiting_for_approval');
  assert.equal(execution.observation.approvalRequests.length, 1);
  assert.equal(execution.observation.toolRunIds.length, 0);
  assert.doesNotMatch(serializedExecution, /approval-required workflow executor must not load/u);
});

test('executeAcceptedBrainWorkflowRequest creates pending writeback evidence for failed workflows', async () => {
  const projectRootPath = await createAlfredProbabilisticProjectFixture();
  const workflowRuntimeDefinition = buildWorkflowRuntimeDefinition({
    memoryPolicy: {
      allowWritebackCandidates: true,
    },
  });

  await addWorkflowRuntimeToAlfredFixture({
    projectRootPath,
    workflowRuntimeDefinition,
    executorSource: [
      'export async function executeTool() {',
      '  throw new Error("workflow fixture failure");',
      '}',
    ].join('\n'),
  });

  const execution = await executeAcceptedBrainWorkflowRequest({
    masRootPath: path.join(projectRootPath, 'instance'),
    invocationId: 'invocation-workflow-failed-writeback-001',
    operationalIdentityId: 'alfred',
    requestedBy: 'test-suite',
    workflowRequestResolution: resolveBrainWorkflowRequestForInvocation({
      brainOutput: buildBrainOutput({
        outputText: JSON.stringify(buildBrainWorkflowRequestEnvelope()),
      }),
      workflowRuntimeDefinitions: [workflowRuntimeDefinition],
    }),
    toolDefinitions: [buildToolDefinition()],
  });
  const persistedWritebackRequest = JSON.parse(await readFile(execution.memoryWritebackPersistence.recordPath, 'utf8'));

  assert.equal(execution.status, 'executed');
  assert.equal(execution.workflowRunStatus, 'failed');
  assert.equal(execution.memoryWritebackRequest.requiresHumanApproval, true);
  assert.deepEqual(
    execution.memoryWritebackRequest.memoryWrites.map((candidate) => candidate.writeType).toSorted(),
    ['artifact_reference', 'task_state_update'],
  );
  assert.equal(
    execution.memoryWritebackRequest.memoryWrites.every((candidate) => {
      return candidate.approvalState === 'pending';
    }),
    true,
  );
  assert.deepEqual(
    persistedWritebackRequest.memoryWrites.map((candidate) => candidate.writeId).toSorted(),
    execution.observation.memoryWritebackCandidateIds.toSorted(),
  );
  assert.match(execution.observation.summary, /Failed steps: inspect-system/u);
});

test('executeAcceptedBrainWorkflowRequest pauses unsupported read-only workflow steps safely', async () => {
  const projectRootPath = await createAlfredProbabilisticProjectFixture();
  const workflowRuntimeDefinition = buildWorkflowRuntimeDefinition({
    workflowId: 'unsupported-review',
    steps: [
      {
        stepId: 'brain-summary',
        stepType: 'agent_brain',
        input: {},
        onFailure: 'pause_workflow',
      },
    ],
  });

  await addWorkflowRuntimeToAlfredFixture({
    projectRootPath,
    workflowRuntimeDefinition,
  });

  const execution = await executeAcceptedBrainWorkflowRequest({
    masRootPath: path.join(projectRootPath, 'instance'),
    invocationId: 'invocation-workflow-unsupported-001',
    operationalIdentityId: 'alfred',
    requestedBy: 'test-suite',
    workflowRequestResolution: resolveBrainWorkflowRequestForInvocation({
      brainOutput: buildBrainOutput({
        outputText: JSON.stringify(buildBrainWorkflowRequestEnvelope({
          workflowId: 'unsupported-review',
        })),
      }),
      workflowRuntimeDefinitions: [workflowRuntimeDefinition],
    }),
    toolDefinitions: [buildToolDefinition()],
  });

  assert.equal(execution.status, 'executed');
  assert.equal(execution.workflowRunStatus, 'waiting_for_external_event');
  assert.deepEqual(execution.observation.blockedSteps, ['brain-summary']);
  assert.match(execution.observation.stepSummaries[0].reason, /not executable by Workflow Runner v1/u);
});

test('runAgentInvocation executes an accepted read-only brain workflow request and returns a grounded follow-up answer', async () => {
  await withEnvironment(
    {
      "openrouter-api-key": 'openrouter-secret',
      "gemini-api-key": 'gemini-secret',
    },
    async () => {
      const projectRootPath = await createAlfredProbabilisticProjectFixture();
      const envelopeText = JSON.stringify(buildBrainWorkflowRequestEnvelope(), null, 2);
      let fetchCallCount = 0;

      await addWorkflowRuntimeToAlfredFixture({
        projectRootPath,
      });

      const result = await runAgentInvocation({
        projectRootPath,
        operationalIdentityId: 'alfred',
        invocationMode: 'probabilistic',
        command: 'ask',
        inputText: 'Run a MAS health review before answering.',
        requestedBy: 'cli',
        fetchImplementation: async (url, options) => {
          fetchCallCount += 1;
          assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions');

          const body = JSON.parse(options.body);
          const systemMessage = body.messages[0].content;

          if (fetchCallCount === 1) {
            assert.match(systemMessage, /## Workflow Availability/u);
            assert.match(systemMessage, /Brain Workflow Request Envelope/u);
            assert.match(systemMessage, /mas-health-review/u);
            assert.match(systemMessage, /Plan\/preview grounding rule/u);
            assert.match(systemMessage, /Do not invent workflow ids, audit reports, logs, checkpoints, or filesystem paths/u);
            assert.doesNotMatch(systemMessage, /## Workflow Observation/u);

            return {
              ok: true,
              async json() {
                return {
                  id: 'openrouter-workflow-request-response-1',
                  choices: [
                    {
                      finish_reason: 'stop',
                      message: {
                        content: envelopeText,
                      },
                    },
                  ],
                  usage: {
                    prompt_tokens: 180,
                    completion_tokens: 40,
                    total_tokens: 220,
                  },
                };
              },
            };
          }

          assert.equal(fetchCallCount, 2);
          assert.match(systemMessage, /## Workflow Observation/u);
          assert.match(systemMessage, /Workflow Status: succeeded/u);
          assert.match(systemMessage, /Tool Audit Record Path: memory\/state\/tool-run-/u);
          assert.doesNotMatch(systemMessage, new RegExp(FAKE_WORKFLOW_SECRET, 'u'));
          assert.match(body.messages[1].content, /Runtime Follow-up/u);
          assert.match(body.messages[1].content, /Produce the final user-facing answer now/u);

          return {
            ok: true,
            async json() {
              return {
                id: 'openrouter-workflow-followup-response-1',
                choices: [
                  {
                    finish_reason: 'stop',
                    message: {
                      content: 'The MAS health review workflow completed successfully. The runtime evidence shows the inspection step succeeded and persisted workflow state.',
                    },
                  },
                ],
                usage: {
                  prompt_tokens: 260,
                  completion_tokens: 32,
                  total_tokens: 292,
                },
              };
            },
          };
        },
      });

      assert.equal(fetchCallCount, 2);
      assert.equal(result.status, 'completed');
      assert.match(result.output.outputText, /workflow completed successfully/u);
      assert.equal(result.output.workflowRequestResolution.status, 'accepted');
      assert.equal(result.output.workflowRequestResolution.autoExecutionPerformed, true);
      assert.equal(result.output.executedBrainWorkflowRequest.workflowId, 'mas-health-review');
      assert.equal(result.output.brainWorkflowExecution.status, 'executed');
      assert.equal(result.output.brainWorkflowExecution.workflowRunStatus, 'succeeded');
      assert.equal(result.output.brainWorkflowObservation.status, 'succeeded');

      const invocationSession = JSON.parse(await readFile(result.persistence.invocationSessionRecordPath, 'utf8'));
      const invocationReport = await readFile(result.persistence.invocationReportPath, 'utf8');
      const serializedSession = JSON.stringify(invocationSession);

      assert.equal(invocationSession.workflowRequestResolution.status, 'accepted');
      assert.equal(invocationSession.workflowRequestResolution.autoExecutionPerformed, true);
      assert.equal(invocationSession.executedBrainWorkflowRequest.workflowRequestId, 'workflow-request-001');
      assert.equal(invocationSession.brainWorkflowExecution.workflowRunStatus, 'succeeded');
      assert.equal(invocationSession.brainWorkflowObservation.stepSummaries[0].status, 'succeeded');
      assert.equal(invocationSession.brainExecution.workflowObservationFollowupPerformed, true);
      assert.equal(invocationSession.brainExecution.finalPassKind, 'workflow_observation_followup');
      assert.equal(invocationSession.brainExecution.attempts.length, 2);
      assert.equal(invocationSession.brainExecution.attempts[0].workflowRequestResolution.status, 'accepted');
      assert.equal(invocationSession.brainExecution.attempts[1].workflowRequestResolution, null);
      assert.equal(invocationSession.promptProvenance.includedLayers.some((layer) => {
        return layer.layerType === 'workflow_observation';
      }), true);
      assert.match(invocationReport, /Brain Workflow Request/u);
      assert.match(invocationReport, /Brain Workflow Execution/u);
      assert.match(invocationReport, /Workflow Observation Follow-up/u);
      assert.match(invocationReport, /workflow completed successfully/u);
      assert.doesNotMatch(serializedSession, /openrouter-secret|gemini-secret/u);
      assert.doesNotMatch(serializedSession, new RegExp(FAKE_WORKFLOW_SECRET, 'u'));
    },
  );
});
