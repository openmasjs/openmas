import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { runAgentInvocation } from '../../src/invocation/run-agent-invocation.js';
import { buildAgentWorkCycleSummary } from '../../src/invocation/build-agent-work-cycle-summary.js';
import {
  createAlfredProbabilisticProjectFixture,
  withEnvironment,
} from '../helpers/create-alfred-probabilistic-fixture.js';

async function writeJsonFile(filePath, payload) {
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

async function addReadOnlyToolFixture(projectRootPath) {
  const instanceRootPath = path.join(projectRootPath, 'instance');
  const toolRootPath = path.join(instanceRootPath, 'tools', 'mas.system.inspect');

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
    {
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
    },
  );

  await writeFile(
    path.join(toolRootPath, 'executor.js'),
    [
      'export async function executeTool() {',
      '  return {',
      '    status: "succeeded",',
      '    summary: "MAS system inspection completed from a work-cycle fixture.",',
      '    data: {',
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

test('runAgentInvocation returns and persists a work cycle summary for answer-only probabilistic replies', async () => {
  await withEnvironment(
    {
      "openrouter-api-key": 'openrouter-secret',
      "gemini-api-key": 'gemini-secret',
    },
    async () => {
      const projectRootPath = await createAlfredProbabilisticProjectFixture();

      const result = await runAgentInvocation({
        projectRootPath,
        operationalIdentityId: 'alfred',
        invocationMode: 'probabilistic',
        command: 'ask',
        inputText: 'Hello Alfred, please just greet me.',
        requestedBy: 'cli',
        fetchImplementation: async () => {
          return {
            ok: true,
            async json() {
              return {
                id: 'openrouter-work-cycle-answer-only-001',
                choices: [
                  {
                    finish_reason: 'stop',
                    message: {
                      content: 'Hello. I am here and ready to help.',
                    },
                  },
                ],
                usage: {
                  prompt_tokens: 120,
                  completion_tokens: 12,
                  total_tokens: 132,
                },
              };
            },
          };
        },
      });

      assert.equal(result.status, 'completed');
      assert.equal(result.workCycle.kind, 'agent_work_cycle_summary');
      assert.equal(result.workCycle.overallOutcome, 'answered_only');
      assert.equal(result.executionPlan, null);
      assert.equal(result.planExecutionCoordination, null);
      assert.equal(result.workCycle.stageCounts.totalStages, 12);
      assert.equal(result.workCycle.stages.find((stage) => stage.stageId === 'plan').status, 'skipped');
      assert.equal(result.workCycle.stages.find((stage) => stage.stageId === 'execute').status, 'skipped');
      assert.equal(result.workCycle.stages.find((stage) => stage.stageId === 'persist').status, 'completed');

      const invocationSession = JSON.parse(await readFile(result.persistence.invocationSessionRecordPath, 'utf8'));

      assert.equal(invocationSession.agentWorkCycle.kind, 'agent_work_cycle_summary');
      assert.equal(invocationSession.agentWorkCycle.overallOutcome, 'answered_only');
      assert.equal(invocationSession.executionPlan, null);
      assert.equal(invocationSession.planExecutionCoordination, null);
      assert.equal(invocationSession.agentWorkCycle.stages.find((stage) => stage.stageId === 'continue_or_stop').status, 'completed');
    },
  );
});

test('runAgentInvocation returns completed capability, execute, observe, and verify stages for acted tool execution', async () => {
  await withEnvironment(
    {
      "openrouter-api-key": 'openrouter-secret',
      "gemini-api-key": 'gemini-secret',
    },
    async () => {
      const projectRootPath = await createAlfredProbabilisticProjectFixture();

      await addReadOnlyToolFixture(projectRootPath);

      const result = await runAgentInvocation({
        projectRootPath,
        operationalIdentityId: 'alfred',
        invocationMode: 'probabilistic',
        command: 'ask',
        inputText: 'Please inspect the MAS now.',
        requestedBy: 'cli',
        fetchImplementation: async (url, options) => {
          const body = JSON.parse(options.body);
          const systemMessage = body.messages[0].content;

          if (/## Tool Observation/u.test(systemMessage)) {
            return {
              ok: true,
              async json() {
                return {
                  id: 'openrouter-work-cycle-followup-001',
                  choices: [
                    {
                      finish_reason: 'stop',
                      message: {
                        content: 'The MAS inspection completed successfully and remained read-only.',
                      },
                    },
                  ],
                  usage: {
                    prompt_tokens: 180,
                    completion_tokens: 18,
                    total_tokens: 198,
                  },
                };
              },
            };
          }

          return {
            ok: true,
            async json() {
              return {
                id: 'openrouter-work-cycle-initial-001',
                choices: [
                  {
                    finish_reason: 'stop',
                    message: {
                      content: [
                        'I will request the read-only system inspection tool.',
                        JSON.stringify({
                          kind: 'brain_tool_request',
                          version: 1,
                          toolRequestId: 'tool-request-001',
                          toolId: 'mas.system.inspect',
                          input: {
                            includeCounts: true,
                          },
                          purpose: 'Inspect the MAS before answering.',
                          expectedSideEffectLevel: 'read_only',
                        }, null, 2),
                      ].join('\n'),
                    },
                  },
                ],
                usage: {
                  prompt_tokens: 150,
                  completion_tokens: 32,
                  total_tokens: 182,
                },
              };
            },
          };
        },
      });

      assert.equal(result.status, 'completed');
      assert.equal(result.workCycle.overallOutcome, 'acted');
      assert.equal(result.executionPlan.kind, 'agent_execution_plan');
      assert.equal(result.executionPlan.requiredTools[0], 'mas.system.inspect');
      assert.equal(result.planExecutionCoordination.kind, 'plan_execution_coordination');
      assert.equal(result.planExecutionCoordination.status, 'ready');
      assert.equal(result.planExecutionCoordination.selectedTargetId, 'mas.system.inspect');
      assert.equal(result.workCycle.stages.find((stage) => stage.stageId === 'plan').status, 'completed');
      assert.equal(result.workCycle.stages.find((stage) => stage.stageId === 'select_capabilities').status, 'completed');
      assert.equal(result.workCycle.stages.find((stage) => stage.stageId === 'execute').status, 'completed');
      assert.equal(result.workCycle.stages.find((stage) => stage.stageId === 'observe').status, 'completed');
      assert.equal(result.workCycle.stages.find((stage) => stage.stageId === 'verify').status, 'completed');

      const invocationSession = JSON.parse(await readFile(result.persistence.invocationSessionRecordPath, 'utf8'));

      assert.equal(invocationSession.agentWorkCycle.overallOutcome, 'acted');
      assert.equal(invocationSession.executionPlan.kind, 'agent_execution_plan');
      assert.equal(invocationSession.executionPlan.requiredTools[0], 'mas.system.inspect');
      assert.equal(invocationSession.planExecutionCoordination.kind, 'plan_execution_coordination');
      assert.equal(invocationSession.planExecutionCoordination.status, 'ready');
      assert.equal(invocationSession.planExecutionCoordination.selectedTargetId, 'mas.system.inspect');
      assert.equal(invocationSession.agentWorkCycle.stages.find((stage) => stage.stageId === 'plan').status, 'completed');
      assert.equal(invocationSession.agentWorkCycle.stages.find((stage) => stage.stageId === 'select_capabilities').status, 'completed');
      assert.equal(invocationSession.agentWorkCycle.stages.find((stage) => stage.stageId === 'execute').status, 'completed');
      assert.equal(invocationSession.agentWorkCycle.stages.find((stage) => stage.stageId === 'observe').status, 'completed');
      assert.equal(invocationSession.agentWorkCycle.stages.find((stage) => stage.stageId === 'verify').status, 'completed');
    },
  );
});

test('buildAgentWorkCycleSummary uses verification gate status for the verify stage when runtime evidence is degraded', () => {
  const workCycle = buildAgentWorkCycleSummary({
    invocationId: 'invocation-work-cycle-verify-001',
    primaryCognitiveIdentityId: 'system-steward',
    operationalIdentityId: 'alfred',
    request: {
      command: 'ask',
      invocationMode: 'probabilistic',
    },
    executionStatus: 'completed',
    executionType: 'probabilistic_brain',
    actionResolution: {
      kind: 'action_resolution',
      version: 1,
      status: 'accepted',
      runtimeAction: 'queue_tool_request',
      source: 'explicit_envelope',
      selectedCandidate: {
        actionType: 'tool_execution',
        targetType: 'tool',
        targetId: 'mas.system.inspect',
        sideEffectLevel: 'read_only',
      },
      reason: 'Tool action accepted.',
    },
    actionResultAssessment: {
      status: 'partial_success',
      requestFulfillment: 'partially_fulfilled',
      reason: 'Runtime execution was observed, but bounded inline verification evidence is incomplete.',
    },
    verificationGate: {
      kind: 'verification_gate',
      version: 1,
      status: 'degraded',
      verificationOutcome: 'partially_verified',
      requestedAction: {
        actionType: 'tool_execution',
        targetType: 'tool',
        targetId: 'mas.system.inspect',
        runtimeAction: 'queue_tool_request',
        sideEffectLevel: 'read_only',
      },
      executionObserved: true,
      evidenceRequirements: [],
      claimSupportSummary: {
        totalClaims: 0,
        relevantClaims: 0,
        supportedClaims: 0,
        unsupportedClaims: 0,
      },
      reason: 'Runtime execution was observed, but bounded inline verification evidence is incomplete.',
      recommendedNextActions: [
        'Review the persisted artifact.',
      ],
      warnings: [],
    },
    message: 'Done.',
    nextStep: 'Review the persisted artifact.',
    persistenceCompleted: true,
  });

  const verifyStage = workCycle.stages.find((stage) => stage.stageId === 'verify');

  assert.equal(verifyStage.status, 'degraded');
  assert.equal(verifyStage.metadata.verificationStatus, 'degraded');
  assert.equal(workCycle.overallOutcome, 'acted_with_review');
});
