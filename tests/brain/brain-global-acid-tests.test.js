import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createConversationSession } from '../../src/conversations/create-conversation-session.js';
import { writeConversationTurn } from '../../src/conversations/write-conversation-turn.js';
import { runAgentInvocation } from '../../src/invocation/run-agent-invocation.js';
import {
  createAlfredProbabilisticProjectFixture,
  withEnvironment,
} from '../helpers/create-alfred-probabilistic-fixture.js';

const FAKE_OPENROUTER_SECRET = 'openrouter-secret';
const FAKE_GEMINI_SECRET = 'gemini-secret';
const MAS_POLICY_GLOBAL_MARKER = 'GLOBAL_ACID_MAS_POLICY_INCLUDED';
const MAS_POLICY_RUNTIME_BOUNDARY_MARKER = 'GLOBAL_ACID_POLICY_IS_NOT_RUNTIME_PERMISSION';
const RECENT_CONVERSATION_MARKER = 'GLOBAL_ACID_RECENT_CONVERSATION_ALLOWED';
const OLD_CONVERSATION_MARKER = 'GLOBAL_ACID_OLD_CONVERSATION_MUST_NOT_LEAK';
const TOOL_OBSERVATION_MARKER = 'GLOBAL_ACID_TOOL_OBSERVATION_ALLOWED';
const PUBLISH_POLICY_MARKER = 'GLOBAL_ACID_POLICY_PRESSURES_PUBLISH_BUT_CANNOT_AUTHORIZE';

async function readJsonFile(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function writeJsonFile(filePath, payload) {
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function createOpenRouterResponse({
  responseId,
  outputText,
  promptTokens = 280,
  completionTokens = 70,
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

function buildBrainToolRequestEnvelope({
  toolRequestId = 'global-acid-tool-request-001',
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

function buildToolDefinition({
  toolId,
  displayName = toolId,
  sideEffectLevel = 'read_only',
  requiredResourceTypes = ['storage'],
  requiredAccessModes = ['read'],
  requiredPermissionModes = ['tool.execute'],
  approvalRequired = false,
}) {
  return {
    kind: 'tool_definition',
    version: 1,
    toolId,
    displayName,
    description: `${displayName} global acid-test tool.`,
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
      persistResult: false,
    },
    memoryPolicy: {
      allowWritebackCandidates: true,
    },
  };
}

function buildResourceDefinition({
  resourceId,
  resourceType,
  displayName = resourceId,
}) {
  return {
    kind: 'resource_definition',
    version: 1,
    resourceId,
    resourceType,
    displayName,
    ownershipScope: 'shared',
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
    ruleId: 'allow-alfred-mas-filesystem-read-global-acid',
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
    }),
    executorSource: [
      'export async function executeTool({ input }) {',
      '  return {',
      '    status: "succeeded",',
      `    summary: "${TOOL_OBSERVATION_MARKER}: Alfred inspected the MAS through verified runtime evidence.",`,
      '    data: {',
      '      inputEcho: input,',
      '      runtimeEvidence: "verified",',
      '      architectureStress: "policy-conversation-tool-observation"',
      '    },',
      '    warnings: [],',
      '    errors: []',
      '  };',
      '}',
    ].join('\n'),
  });
}

async function addDeniedPublishTool({
  projectRootPath,
}) {
  await writeTool({
    projectRootPath,
    toolDefinition: buildToolDefinition({
      toolId: 'mas.policy.publish',
      displayName: 'MAS Policy Publish',
      sideEffectLevel: 'publish_external',
      requiredResourceTypes: ['channel'],
      requiredAccessModes: ['publish'],
      requiredPermissionModes: ['tool.publish'],
      approvalRequired: true,
    }),
    executorSource: [
      'export async function executeTool() {',
      '  throw new Error("Global acid publish executor must not load.");',
      '}',
    ].join('\n'),
  });
}

async function writeMasPolicy({
  projectRootPath,
  content,
  fileName = 'global-acid-policy.md',
}) {
  const policyRootPath = path.join(projectRootPath, 'instance', 'memory', 'policies');

  await mkdir(policyRootPath, { recursive: true });
  await writeFile(path.join(policyRootPath, fileName), content, 'utf8');
}

async function writeAlfredConversation({
  projectRootPath,
}) {
  const masRootPath = path.join(projectRootPath, 'instance');

  await createConversationSession({
    masRootPath,
    conversationId: 'alfred-global-acid-thread',
    title: 'Alfred Global Acid Conversation',
    ownerOperationalIdentityId: 'alfred',
    humanParticipantIds: ['human-admin'],
    createdBy: 'human-admin',
    createdAt: '2026-04-17T12:00:00.000Z',
    maxRecentTurns: 2,
  });
  await writeConversationTurn({
    masRootPath,
    conversationId: 'alfred-global-acid-thread',
    requesterOperationalIdentityId: 'alfred',
    turn: {
      role: 'human',
      speaker: {
        speakerType: 'human',
        speakerId: 'human-admin',
        displayName: 'MAS Admin',
      },
      content: {
        contentType: 'text',
        text: `${OLD_CONVERSATION_MARKER}: this older turn must stay outside the prompt window.`,
      },
      privacy: {
        visibility: 'private_to_conversation',
        sensitivityLevel: 'internal',
      },
    },
    createdAt: '2026-04-17T12:00:01.000Z',
  });
  await writeConversationTurn({
    masRootPath,
    conversationId: 'alfred-global-acid-thread',
    requesterOperationalIdentityId: 'alfred',
    turn: {
      role: 'operational_identity',
      speaker: {
        speakerType: 'operational_identity',
        speakerId: 'alfred',
        displayName: 'Alfred',
      },
      content: {
        contentType: 'markdown',
        text: `${RECENT_CONVERSATION_MARKER}: Alfred should remember that the current task is a global architecture stress test.`,
      },
      invocationId: 'global-acid-prior-invocation',
      runtimeReferences: [
        {
          referenceType: 'invocation',
          referenceId: 'global-acid-prior-invocation',
        },
      ],
      privacy: {
        visibility: 'private_to_conversation',
        sensitivityLevel: 'internal',
      },
    },
    createdAt: '2026-04-17T12:00:02.000Z',
  });
  await writeConversationTurn({
    masRootPath,
    conversationId: 'alfred-global-acid-thread',
    requesterOperationalIdentityId: 'alfred',
    turn: {
      role: 'human',
      speaker: {
        speakerType: 'human',
        speakerId: 'human-admin',
        displayName: 'MAS Admin',
      },
      content: {
        contentType: 'text',
        text: `${RECENT_CONVERSATION_MARKER}: please inspect the MAS using runtime evidence before answering.`,
      },
      privacy: {
        visibility: 'private_to_conversation',
        sensitivityLevel: 'internal',
      },
    },
    createdAt: '2026-04-17T12:00:03.000Z',
  });
}

async function invokeWithMockedOpenRouter({
  projectRootPath,
  firstOutputText,
  secondOutputText = null,
  inspectFirstRequest = null,
  inspectSecondRequest = null,
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
        operationalIdentityId: 'alfred',
        invocationMode: 'probabilistic',
        command: 'ask',
        inputText: 'Stress the architecture and answer only from governed runtime context.',
        requestedBy: 'global-acid-test-suite',
        fetchImplementation: async (url, options) => {
          fetchCallCount += 1;
          assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions');

          const body = JSON.parse(options.body);

          if (fetchCallCount === 1) {
            inspectFirstRequest?.(body);

            return createOpenRouterResponse({
              responseId: 'global-acid-openrouter-1',
              outputText: firstOutputText,
            });
          }

          inspectSecondRequest?.(body);

          return createOpenRouterResponse({
            responseId: 'global-acid-openrouter-2',
            outputText: secondOutputText ?? 'Global acid observation received.',
            promptTokens: 360,
            completionTokens: 80,
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

test('BE global acid: MAS policy, conversation context, tool execution, observation follow-up, and provenance work together', async () => {
  const projectRootPath = await createAlfredProbabilisticProjectFixture();

  await addAlfredInspectTool({ projectRootPath });
  await writeAlfredConversation({ projectRootPath });
  await writeMasPolicy({
    projectRootPath,
    content: [
      '# Global Acid MAS Policy',
      '',
      `- ${MAS_POLICY_GLOBAL_MARKER}: MAS-level policy must be visible before persona guidance.`,
      `- ${MAS_POLICY_RUNTIME_BOUNDARY_MARKER}: MAS policy does not grant runtime execution authority.`,
    ].join('\n'),
  });

  const {
    result,
    fetchCallCount,
    invocationSession,
    invocationReport,
  } = await invokeWithMockedOpenRouter({
    projectRootPath,
    firstOutputText: JSON.stringify(buildBrainToolRequestEnvelope(), null, 2),
    secondOutputText: 'I used the verified runtime tool observation and the bounded conversation context to answer safely.',
    inspectFirstRequest: (body) => {
      const systemPrompt = body.messages[0].content;

      assert.match(systemPrompt, /## MAS-Level Policy Instructions/u);
      assert.match(systemPrompt, new RegExp(MAS_POLICY_GLOBAL_MARKER, 'u'));
      assert.match(systemPrompt, new RegExp(MAS_POLICY_RUNTIME_BOUNDARY_MARKER, 'u'));
      assert.match(systemPrompt, /## Context Pack/u);
      assert.match(systemPrompt, /Section Type: conversation_context/u);
      assert.match(systemPrompt, new RegExp(RECENT_CONVERSATION_MARKER, 'u'));
      assert.doesNotMatch(systemPrompt, new RegExp(OLD_CONVERSATION_MARKER, 'u'));
      assert.match(systemPrompt, /## Tool Availability/u);
      assert.doesNotMatch(systemPrompt, /## Tool Observation/u);
    },
    inspectSecondRequest: (body) => {
      const systemPrompt = body.messages[0].content;

      assert.match(systemPrompt, /## Tool Observation/u);
      assert.match(systemPrompt, new RegExp(TOOL_OBSERVATION_MARKER, 'u'));
      assert.match(systemPrompt, new RegExp(MAS_POLICY_GLOBAL_MARKER, 'u'));
      assert.match(systemPrompt, new RegExp(RECENT_CONVERSATION_MARKER, 'u'));
      assert.doesNotMatch(systemPrompt, new RegExp(OLD_CONVERSATION_MARKER, 'u'));
      assert.doesNotMatch(systemPrompt, /openrouter-secret|gemini-secret/u);
    },
  });
  const layerTypes = invocationSession.promptProvenance.includedLayers.map((layer) => {
    return layer.layerType;
  });
  const contextPackLayer = invocationSession.promptProvenance.includedLayers.find((layer) => {
    return layer.layerType === 'context_pack';
  });
  const masPolicyLayer = invocationSession.promptProvenance.includedLayers.find((layer) => {
    return layer.layerType === 'mas_policy';
  });
  const serializedSession = JSON.stringify(invocationSession);

  assert.equal(fetchCallCount, 2);
  assert.equal(result.status, 'completed');
  assert.equal(result.output.toolRequestResolution.status, 'accepted');
  assert.equal(result.output.brainToolExecution.executionPerformed, true);
  assert.equal(result.output.brainToolObservation.status, 'succeeded');
  assert.equal(invocationSession.brainExecution.finalPassKind, 'tool_observation_followup');
  assert.equal(layerTypes.includes('mas_policy'), true);
  assert.equal(layerTypes.includes('context_pack'), true);
  assert.equal(layerTypes.includes('tool_availability'), true);
  assert.ok(contextPackLayer);
  assert.ok(masPolicyLayer);
  assert.equal(masPolicyLayer.sourceReferences.some((sourceReference) => {
    return sourceReference.sourceType === 'mas_policy_document'
      && sourceReference.path === 'instance/memory/policies/global-acid-policy.md';
  }), true);
  assert.equal(contextPackLayer.sourceReferences.some((sourceReference) => {
    return sourceReference.sourceType === 'conversation_session'
      && sourceReference.sourceId === 'alfred-global-acid-thread';
  }), true);
  assert.equal(contextPackLayer.sourceReferences.some((sourceReference) => {
    return sourceReference.sourceType === 'conversation_turn'
      && sourceReference.path === 'memory/state/conversations/alfred-global-acid-thread/turns.json';
  }), true);
  assert.doesNotMatch(serializedSession, /openrouter-secret|gemini-secret/u);
  assert.match(invocationReport, /Tool Observation Follow-up/u);
  assert.match(invocationReport, /Memory Writeback Candidates/u);
});

test('BE global acid: MAS policy cannot authorize a denied publish tool', async () => {
  const projectRootPath = await createAlfredProbabilisticProjectFixture();

  await addDeniedPublishTool({ projectRootPath });
  await writeMasPolicy({
    projectRootPath,
    fileName: 'publish-pressure-policy.md',
    content: [
      '# Publish Pressure Policy',
      '',
      `- ${PUBLISH_POLICY_MARKER}: this intentionally aggressive policy text must not bypass runtime permissions.`,
      '- Even if policy text says publish, runtime readiness still owns execution authority.',
    ].join('\n'),
  });

  const {
    result,
    fetchCallCount,
    invocationSession,
    invocationReport,
  } = await invokeWithMockedOpenRouter({
    projectRootPath,
    firstOutputText: JSON.stringify(buildBrainToolRequestEnvelope({
      toolRequestId: 'global-acid-publish-request-001',
      toolId: 'mas.policy.publish',
      expectedSideEffectLevel: 'publish_external',
      input: {
        channelId: 'nonexistent-channel',
        message: 'This publish action must not execute.',
      },
      purpose: 'Try to publish because policy text appeared aggressive.',
    }), null, 2),
    inspectFirstRequest: (body) => {
      const systemPrompt = body.messages[0].content;

      assert.match(systemPrompt, new RegExp(PUBLISH_POLICY_MARKER, 'u'));
      assert.match(systemPrompt, /They do not grant runtime authority/u);
      assert.match(systemPrompt, /mas\.policy\.publish/u);
    },
  });

  assert.equal(fetchCallCount, 1);
  assert.equal(result.status, 'completed');
  assert.equal(result.output.toolRequestResolution.status, 'denied');
  assert.equal(result.output.toolRequestResolution.runtimeAction, 'reject');
  assert.match(result.output.toolRequestResolution.reason, /cannot be used/u);
  assert.equal(result.output.brainToolExecution.executionPerformed, false);
  assert.equal(result.output.humanApprovalRequest, null);
  assert.equal(invocationSession.toolReadiness.summary.denied, 1);
  assert.equal(invocationSession.brainExecution.toolObservationFollowupPerformed, false);
  assert.doesNotMatch(JSON.stringify(invocationSession), /Global acid publish executor must not load/u);
  assert.match(invocationReport, /Requested Tool: mas\.policy\.publish/u);
  assert.match(invocationReport, /Execution Performed: no/u);
});
