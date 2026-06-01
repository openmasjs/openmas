import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { assertBrainToolRequestEnvelope } from '../../src/contracts/brain/brain-tool-request-contract.js';
import { parseBrainToolRequestEnvelopeFromText } from '../../src/tools/parse-brain-tool-request-envelope.js';
import { resolveBrainToolRequestForInvocation } from '../../src/tools/resolve-brain-tool-request-for-invocation.js';
import { runAgentInvocation } from '../../src/invocation/run-agent-invocation.js';
import { buildFakeGeminiSecretProbe } from '../helpers/fake-secret-probes.js';
import {
  createAlfredProbabilisticProjectFixture,
  withEnvironment,
} from '../helpers/create-alfred-probabilistic-fixture.js';

function buildBrainToolRequestEnvelope(overrides = {}) {
  return {
    kind: 'brain_tool_request',
    version: 1,
    toolRequestId: 'tool-request-001',
    toolId: 'mas.system.inspect',
    input: {
      includeCounts: true,
    },
    purpose: 'Inspect the MAS structure before answering.',
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
    providerResponseId: 'provider-response-tool-request-001',
    usage: {
      inputTokens: 100,
      outputTokens: 20,
      totalTokens: 120,
    },
    warnings: [],
  };
}

function buildToolReadinessVerdict(overrides = {}) {
  return {
    kind: 'tool_readiness_verdict',
    version: 1,
    toolId: 'mas.system.inspect',
    status: 'ready',
    approvalRequired: false,
    reason: 'Tool mas.system.inspect passed readiness gates and can be requested for execution.',
    matchedBindings: [
      {
        resourceId: 'mas-filesystem',
        resourceType: 'storage',
        accessMode: 'read',
        credentialReferenceId: null,
        secretResolutionStatus: null,
      },
    ],
    missingRequirements: [],
    warnings: [],
    ...overrides,
  };
}

function buildToolReadinessEvaluation(verdicts) {
  return {
    kind: 'tool_readiness_evaluation',
    version: 1,
    evaluatedTools: verdicts,
    summary: {
      totalEvaluated: verdicts.length,
      ready: verdicts.filter((verdict) => verdict.status === 'ready').length,
      approvalRequired: verdicts.filter((verdict) => verdict.status === 'approval_required').length,
      denied: verdicts.filter((verdict) => verdict.status === 'denied').length,
      unavailable: verdicts.filter((verdict) => verdict.status === 'unavailable').length,
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

async function writeJsonFile(filePath, payload) {
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

async function addToolRuntimeToAlfredFixture(projectRootPath, {
  toolDefinition = buildToolDefinition(),
} = {}) {
  const instanceRootPath = path.join(projectRootPath, 'instance');
  const toolRootPath = path.join(instanceRootPath, 'tools', toolDefinition.toolId);

  await mkdir(toolRootPath, { recursive: true });

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
    [
      'export async function executeTool({ input }) {',
      '  return {',
      '    status: "succeeded",',
      '    summary: "MAS system inspection completed from a brain-requested read-only tool.",',
      '    data: {',
      '      inputEcho: input,',
      `      apiKey: "${buildFakeGeminiSecretProbe('FAKE_BRAIN_TOOL_SECRET_SHOULD_NOT_LEAK')}",`,
      '      registeredOperationalIdentities: ["alfred"]',
      '    },',
      '    warnings: [],',
      '    errors: []',
      '  };',
      '}',
    ].join('\n'),
    'utf8',
  );
}

test('assertBrainToolRequestEnvelope accepts the strict v1 request shape', () => {
  const envelope = assertBrainToolRequestEnvelope(buildBrainToolRequestEnvelope());

  assert.equal(envelope.kind, 'brain_tool_request');
  assert.equal(envelope.version, 1);
  assert.equal(envelope.toolRequestId, 'tool-request-001');
  assert.equal(envelope.toolId, 'mas.system.inspect');
  assert.equal(envelope.input.includeCounts, true);
  assert.equal(envelope.expectedSideEffectLevel, 'read_only');
});

test('parseBrainToolRequestEnvelopeFromText parses exact JSON and rejects malformed envelopes', () => {
  const parsed = parseBrainToolRequestEnvelopeFromText({
    outputText: JSON.stringify(buildBrainToolRequestEnvelope()),
  });
  const fenced = parseBrainToolRequestEnvelopeFromText({
    outputText: [
      '```json',
      JSON.stringify(buildBrainToolRequestEnvelope({
        toolRequestId: 'tool-request-002',
      })),
      '```',
    ].join('\n'),
  });
  const normalJsonAnswer = parseBrainToolRequestEnvelopeFromText({
    outputText: JSON.stringify({
      answer: 'This is not a tool request.',
    }),
  });
  const invalid = parseBrainToolRequestEnvelopeFromText({
    outputText: '{"kind":"brain_tool_request","version":1',
  });

  assert.equal(parsed.status, 'parsed');
  assert.equal(parsed.toolRequest.toolId, 'mas.system.inspect');
  assert.equal(fenced.status, 'parsed');
  assert.equal(fenced.toolRequest.toolRequestId, 'tool-request-002');
  assert.equal(normalJsonAnswer.status, 'no_request');
  assert.equal(invalid.status, 'invalid');
});

test('parseBrainToolRequestEnvelopeFromText safely accepts one embedded JSON envelope', () => {
  const embedded = parseBrainToolRequestEnvelopeFromText({
    outputText: [
      'This request references the MAS. I will inspect the system now.',
      JSON.stringify(buildBrainToolRequestEnvelope({
        purpose: 'Inspect the MAS structure with literal braces {safe} in the purpose text.',
      }), null, 2),
    ].join('\n'),
  });
  const multiple = parseBrainToolRequestEnvelopeFromText({
    outputText: [
      'First request:',
      JSON.stringify(buildBrainToolRequestEnvelope({
        toolRequestId: 'tool-request-embedded-001',
      })),
      'Second request:',
      JSON.stringify(buildBrainToolRequestEnvelope({
        toolRequestId: 'tool-request-embedded-002',
      })),
    ].join('\n'),
  });
  const malformed = parseBrainToolRequestEnvelopeFromText({
    outputText: [
      'I will inspect the system now.',
      '{',
      '  "kind": "brain_tool_request",',
      '  "version": 1,',
      '  "toolRequestId": "tool-request-malformed-001"',
      'This text breaks the JSON object before it can close.',
    ].join('\n'),
  });

  assert.equal(embedded.status, 'parsed');
  assert.equal(embedded.toolRequest.toolId, 'mas.system.inspect');
  assert.equal(embedded.toolRequest.purpose, 'Inspect the MAS structure with literal braces {safe} in the purpose text.');
  assert.equal(multiple.status, 'invalid');
  assert.match(multiple.reason, /multiple brain_tool_request envelopes/u);
  assert.equal(malformed.status, 'invalid');
  assert.match(malformed.reason, /did not provide a parseable envelope/u);
});

test('parseBrainToolRequestEnvelopeFromText repairs narrow mas.os.delegate schema near misses', () => {
  const missingPurpose = parseBrainToolRequestEnvelopeFromText({
    outputText: JSON.stringify({
      kind: 'brain_tool_request',
      version: 1,
      toolRequestId: 'tool-request-delegate-001',
      toolId: 'mas.os.delegate',
      input: {
        targetOperationalIdentityId: 'bruce',
        task: 'inspect the MAS and report findings',
      },
      expectedSideEffectLevel: 'write_internal',
    }),
  });
  const workflowAlias = parseBrainToolRequestEnvelopeFromText({
    outputText: JSON.stringify({
      kind: 'brain_tool_request',
      version: 1,
      workflowRequestId: 'workflow-request-delegate-001',
      workflowId: 'mas-os-delegate',
      input: {
        targetOperationalIdentityId: 'bruce',
        task: 'inspect the MAS and report findings',
      },
    }),
  });

  assert.equal(missingPurpose.status, 'parsed');
  assert.equal(missingPurpose.toolRequest.toolId, 'mas.os.delegate');
  assert.match(missingPurpose.toolRequest.purpose, /Delegate inspect the MAS/u);
  assert.equal(missingPurpose.warnings.length, 1);

  assert.equal(workflowAlias.status, 'parsed');
  assert.equal(workflowAlias.toolRequest.toolId, 'mas.os.delegate');
  assert.equal(workflowAlias.toolRequest.toolRequestId, 'workflow-request-delegate-001');
  assert.equal(workflowAlias.toolRequest.expectedSideEffectLevel, 'write_internal');
  assert.equal(workflowAlias.warnings.length, 4);
});

test('parseBrainToolRequestEnvelopeFromText repairs narrow mas.os.schedule_delegation schema near misses', () => {
  const missingPurpose = parseBrainToolRequestEnvelopeFromText({
    outputText: JSON.stringify({
      kind: 'brain_tool_request',
      version: 1,
      toolRequestId: 'tool-request-schedule-delegation-001',
      toolId: 'mas.os.schedule_delegation',
      input: {
        targetOperationalIdentityId: 'bruce',
        task: 'inspect the MAS and report findings',
        runAt: '2026-05-15T18:00:00-05:00',
      },
      expectedSideEffectLevel: 'write_internal',
    }),
  });
  const workflowAlias = parseBrainToolRequestEnvelopeFromText({
    outputText: JSON.stringify({
      kind: 'brain_tool_request',
      version: 1,
      workflowRequestId: 'workflow-request-schedule-delegation-001',
      workflowId: 'mas-os-schedule-delegation',
      input: {
        targetOperationalIdentityId: 'bruce',
        task: 'inspect the MAS and report findings',
        runAt: '2026-05-15T18:00:00-05:00',
      },
    }),
  });

  assert.equal(missingPurpose.status, 'parsed');
  assert.equal(missingPurpose.toolRequest.toolId, 'mas.os.schedule_delegation');
  assert.match(missingPurpose.toolRequest.purpose, /Schedule delegation of inspect the MAS/u);
  assert.match(missingPurpose.toolRequest.purpose, /2026-05-15T18:00:00-05:00/u);
  assert.equal(missingPurpose.warnings.length, 1);

  assert.equal(workflowAlias.status, 'parsed');
  assert.equal(workflowAlias.toolRequest.toolId, 'mas.os.schedule_delegation');
  assert.equal(workflowAlias.toolRequest.toolRequestId, 'workflow-request-schedule-delegation-001');
  assert.equal(workflowAlias.toolRequest.expectedSideEffectLevel, 'write_internal');
  assert.equal(workflowAlias.warnings.length, 4);
});

test('resolveBrainToolRequestForInvocation accepts, denies, or requires approval without auto-execution', () => {
  const accepted = resolveBrainToolRequestForInvocation({
    brainOutput: buildBrainOutput({
      outputText: JSON.stringify(buildBrainToolRequestEnvelope()),
    }),
    toolReadinessEvaluation: buildToolReadinessEvaluation([
      buildToolReadinessVerdict(),
    ]),
  });
  const approvalRequired = resolveBrainToolRequestForInvocation({
    brainOutput: buildBrainOutput({
      outputText: JSON.stringify(buildBrainToolRequestEnvelope({
        toolRequestId: 'tool-request-approval-001',
        toolId: 'meta.reply.publish',
        expectedSideEffectLevel: 'publish_external',
      })),
    }),
    toolReadinessEvaluation: buildToolReadinessEvaluation([
      buildToolReadinessVerdict({
        toolId: 'meta.reply.publish',
        status: 'approval_required',
        approvalRequired: true,
        reason: 'Tool meta.reply.publish passed readiness gates but requires approval before execution.',
        matchedBindings: [
          {
            resourceId: 'meta-channel',
            resourceType: 'channel',
            accessMode: 'publish',
            credentialReferenceId: 'meta-token',
            secretResolutionStatus: 'resolved',
          },
        ],
      }),
    ]),
  });
  const denied = resolveBrainToolRequestForInvocation({
    brainOutput: buildBrainOutput({
      outputText: JSON.stringify(buildBrainToolRequestEnvelope({
        toolRequestId: 'tool-request-denied-001',
        toolId: 'meta.comments.read',
      })),
    }),
    toolReadinessEvaluation: buildToolReadinessEvaluation([
      buildToolReadinessVerdict({
        toolId: 'meta.comments.read',
        status: 'denied',
        approvalRequired: false,
        reason: 'No usable binding satisfies the required channel read access.',
        matchedBindings: [],
        missingRequirements: [
          {
            resourceType: 'channel',
            accessMode: 'read',
            reason: 'No usable binding satisfies channel read.',
          },
        ],
      }),
    ]),
  });

  assert.equal(accepted.status, 'accepted');
  assert.equal(accepted.runtimeAction, 'queue_for_execution');
  assert.equal(accepted.executionAllowed, true);
  assert.equal(accepted.autoExecutionPerformed, false);
  assert.equal(approvalRequired.status, 'approval_required');
  assert.equal(approvalRequired.runtimeAction, 'request_human_approval');
  assert.equal(approvalRequired.executionAllowed, false);
  assert.equal(approvalRequired.autoExecutionPerformed, false);
  assert.equal(denied.status, 'denied');
  assert.equal(denied.runtimeAction, 'reject');
  assert.equal(denied.executionAllowed, false);
});

test('runAgentInvocation executes an accepted read-only brain tool request and returns a grounded follow-up answer', async () => {
  await withEnvironment(
    {
      "openrouter-api-key": 'openrouter-secret',
      "gemini-api-key": 'gemini-secret',
    },
    async () => {
      const projectRootPath = await createAlfredProbabilisticProjectFixture();
      const envelopeText = [
        'This request references the MAS. I will request the read-only inspection tool.',
        JSON.stringify(buildBrainToolRequestEnvelope(), null, 2),
      ].join('\n');
      let fetchCallCount = 0;

      await addToolRuntimeToAlfredFixture(projectRootPath, {
        toolDefinition: buildToolDefinition({
          memoryPolicy: {
            allowWritebackCandidates: true,
          },
        }),
      });

      const result = await runAgentInvocation({
        projectRootPath,
        operationalIdentityId: 'alfred',
        invocationMode: 'probabilistic',
        command: 'ask',
        inputText: 'Please inspect the MAS before answering.',
        requestedBy: 'cli',
        fetchImplementation: async (url, options) => {
          fetchCallCount += 1;
          assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions');

          const body = JSON.parse(options.body);
          const systemMessage = body.messages[0].content;

          if (fetchCallCount === 1) {
            assert.match(systemMessage, /## Tool Availability/u);
            assert.match(systemMessage, /Brain Tool Request Envelope/u);
            assert.match(systemMessage, /MAS System Inspect/u);
            assert.doesNotMatch(systemMessage, /## Tool Observation/u);

            return {
              ok: true,
              async json() {
                return {
                  id: 'openrouter-tool-request-response-1',
                  choices: [
                    {
                      finish_reason: 'stop',
                      message: {
                        content: envelopeText,
                      },
                    },
                  ],
                  usage: {
                    prompt_tokens: 140,
                    completion_tokens: 40,
                    total_tokens: 180,
                  },
                };
              },
            };
          }

          assert.equal(fetchCallCount, 2);
          assert.match(systemMessage, /## Tool Observation/u);
          assert.match(systemMessage, /MAS system inspection completed from a brain-requested read-only tool/u);
          assert.match(systemMessage, /registeredOperationalIdentities/u);
          assert.match(systemMessage, /\[REDACTED\]/u);
          assert.doesNotMatch(systemMessage, new RegExp(buildFakeGeminiSecretProbe('FAKE_BRAIN_TOOL_SECRET_SHOULD_NOT_LEAK'), 'u'));
          assert.match(body.messages[1].content, /Runtime Follow-up/u);
          assert.match(body.messages[1].content, /Produce the final user-facing answer now/u);

          return {
            ok: true,
            async json() {
              return {
                id: 'openrouter-tool-followup-response-1',
                choices: [
                  {
                    finish_reason: 'stop',
                    message: {
                      content: 'The MAS inspection completed successfully. The runtime evidence shows Alfred is registered as an operational identity, and no unsafe mutation was performed.',
                    },
                  },
                ],
                usage: {
                  prompt_tokens: 220,
                  completion_tokens: 32,
                  total_tokens: 252,
                },
              };
            },
          };
        },
      });

      assert.equal(fetchCallCount, 2);
      assert.equal(result.status, 'completed');
      assert.equal(result.output.kind, 'brain_output');
      assert.match(result.output.outputText, /inspection completed successfully/u);
      assert.equal(result.output.toolRequestResolution.status, 'accepted');
      assert.equal(result.output.toolRequestResolution.runtimeAction, 'queue_for_execution');
      assert.equal(result.output.toolRequestResolution.autoExecutionPerformed, true);
      assert.equal(result.output.executedBrainToolRequest.toolId, 'mas.system.inspect');
      assert.equal(result.output.brainToolExecution.status, 'executed');
      assert.equal(result.output.brainToolExecution.executionPerformed, true);
      assert.equal(result.output.brainToolExecution.toolResultStatus, 'succeeded');
      assert.equal(result.output.brainToolExecution.memoryWritebackRequest.requiresHumanApproval, true);
      assert.equal(result.output.brainToolExecution.memoryWritebackRequest.memoryWrites.length, 1);
      assert.equal(result.output.brainToolObservation.status, 'succeeded');
      assert.equal(result.output.brainToolObservation.dataPreview.apiKey, '[REDACTED]');
      assert.equal(result.output.brainToolObservation.memoryWritebackCandidateIds.length, 1);

      const invocationSession = JSON.parse(await readFile(result.persistence.invocationSessionRecordPath, 'utf8'));
      const invocationReport = await readFile(result.persistence.invocationReportPath, 'utf8');
      const persistedToolAudit = JSON.parse(await readFile(invocationSession.brainToolExecution.toolAuditRecordPath, 'utf8'));
      const persistedWritebackRequest = JSON.parse(
        await readFile(invocationSession.brainToolExecution.memoryWritebackPersistence.recordPath, 'utf8'),
      );
      const serializedSession = JSON.stringify(invocationSession);

      assert.equal(invocationSession.toolReadiness.summary.ready, 1);
      assert.equal(invocationSession.toolRequestResolution.status, 'accepted');
      assert.equal(invocationSession.toolRequestResolution.autoExecutionPerformed, true);
      assert.equal(invocationSession.executedBrainToolRequest.toolRequestId, 'tool-request-001');
      assert.equal(invocationSession.brainToolExecution.status, 'executed');
      assert.equal(invocationSession.brainToolExecution.toolRunId, persistedToolAudit.toolRunId);
      assert.equal(invocationSession.brainToolExecution.memoryWritebackRequest.memoryWrites.length, 1);
      assert.equal(invocationSession.brainToolExecution.memoryWritebackPersistence.writeCount, 1);
      assert.equal(invocationSession.brainToolObservation.summary, 'MAS system inspection completed from a brain-requested read-only tool.');
      assert.deepEqual(
        invocationSession.brainToolObservation.memoryWritebackCandidateIds,
        invocationSession.brainToolExecution.memoryWritebackRequest.memoryWrites.map((candidate) => {
          return candidate.writeId;
        }),
      );
      assert.equal(invocationSession.brainOutput.providerResponseId, 'openrouter-tool-followup-response-1');
      assert.equal(invocationSession.brainExecution.toolObservationFollowupPerformed, true);
      assert.equal(invocationSession.brainExecution.finalPassKind, 'tool_observation_followup');
      assert.equal(invocationSession.brainExecution.attempts.length, 2);
      assert.equal(invocationSession.brainExecution.attempts[0].passKind, 'initial_reasoning');
      assert.equal(invocationSession.brainExecution.attempts[0].toolRequestResolution.status, 'accepted');
      assert.equal(invocationSession.brainExecution.attempts[0].toolRequestResolution.autoExecutionPerformed, true);
      assert.equal(invocationSession.brainExecution.attempts[1].passKind, 'tool_observation_followup');
      assert.equal(invocationSession.brainExecution.attempts[1].toolRequestResolution, null);
      assert.equal(invocationSession.promptProvenance.includedLayers.some((layer) => {
        return layer.layerType === 'tool_observation';
      }), true);
      assert.match(invocationReport, /Brain Tool Request/u);
      assert.match(invocationReport, /Runtime Action: queue_for_execution/u);
      assert.match(invocationReport, /Brain Tool Execution/u);
      assert.match(invocationReport, /Execution Performed: yes/u);
      assert.match(invocationReport, /Tool Observation/u);
      assert.match(invocationReport, /Tool Observation Follow-up/u);
      assert.match(invocationReport, /Follow-up Performed: yes/u);
      assert.match(invocationReport, /Memory Writeback Candidates/u);
      assert.match(invocationReport, /Tool Candidate Count: 1/u);
      assert.match(invocationReport, /Durable Memory Mutation: no/u);
      assert.match(invocationReport, /inspection completed successfully/u);
      assert.equal(persistedWritebackRequest.memoryWrites[0].approvalState, 'pending');
      assert.equal(persistedWritebackRequest.memoryWrites[0].sourceReferences[0].sourceType, 'tool_result');
      assert.doesNotMatch(serializedSession, new RegExp(`openrouter-secret|gemini-secret|${buildFakeGeminiSecretProbe('FAKE_BRAIN_TOOL_SECRET_SHOULD_NOT_LEAK')}`, 'u'));
      assert.doesNotMatch(JSON.stringify(persistedWritebackRequest), new RegExp(buildFakeGeminiSecretProbe('FAKE_BRAIN_TOOL_SECRET_SHOULD_NOT_LEAK'), 'u'));
    },
  );
});
