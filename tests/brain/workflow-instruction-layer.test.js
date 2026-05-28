import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { assertWorkflowInstructionDefinition } from '../../src/contracts/workflow-instruction-contract.js';
import { buildWorkflowLayer, WORKFLOW_LAYER_PRIORITY } from '../../src/brain/build-workflow-layer.js';
import { readWorkflowInstructionsForInvocation } from '../../src/workflows/read-workflow-instructions-for-invocation.js';
import { runAgentInvocation } from '../../src/invocation/run-agent-invocation.js';
import {
  createAlfredProbabilisticProjectFixture,
  withEnvironment,
} from '../helpers/create-alfred-probabilistic-fixture.js';

const WORKFLOW_GUIDANCE_MARKER = 'WORKFLOW_GUIDANCE_MARKER_COMPLAINT_HANDLING_V1';

async function writeWorkflow({
  projectRootPath,
  workflowDirectoryName,
  definitionOverrides = {},
  instructions = `# Complaint Handling Workflow\n\n${WORKFLOW_GUIDANCE_MARKER}: classify severity, respond carefully, and escalate when needed.`,
}) {
  const workflowRootPath = path.join(projectRootPath, 'instance', 'workflows', workflowDirectoryName);

  await mkdir(workflowRootPath, { recursive: true });
  await writeFile(
    path.join(workflowRootPath, 'workflow.json'),
    JSON.stringify({
      kind: 'workflow_instruction_definition',
      version: 1,
      workflowId: workflowDirectoryName,
      displayName: 'Complaint Handling Workflow',
      lifecycleState: 'active',
      description: 'Guides safe complaint triage and response drafting.',
      commandTriggers: ['ask'],
      operationalIdentityIds: ['alfred'],
      cognitiveIdentityIds: ['system-steward'],
      ...definitionOverrides,
    }, null, 2),
    'utf8',
  );
  await writeFile(
    path.join(workflowRootPath, 'workflow.md'),
    instructions,
    'utf8',
  );
}

function createWorkflowReadiness(overrides = {}) {
  return {
    operationalIdentityDefinition: {
      operationalIdentityId: 'alfred',
    },
    activeCognitiveSet: {
      primaryCognitiveIdentityId: 'system-steward',
      secondaryCognitiveIdentityIds: [],
    },
    ...overrides,
  };
}

test('assertWorkflowInstructionDefinition accepts a valid read-only workflow definition', () => {
  const definition = assertWorkflowInstructionDefinition({
    kind: 'workflow_instruction_definition',
    version: 1,
    workflowId: 'complaint-handling',
    displayName: 'Complaint Handling Workflow',
    lifecycleState: 'active',
    commandTriggers: ['ask'],
    operationalIdentityIds: ['alfred'],
    cognitiveIdentityIds: ['system-steward'],
  });

  assert.equal(definition.workflowId, 'complaint-handling');
  assert.equal(definition.lifecycleState, 'active');
  assert.deepEqual(definition.commandTriggers, ['ask']);
});

test('assertWorkflowInstructionDefinition rejects definitions without command triggers', () => {
  assert.throws(() => {
    assertWorkflowInstructionDefinition({
      kind: 'workflow_instruction_definition',
      version: 1,
      workflowId: 'untriggered-workflow',
      displayName: 'Untriggered Workflow',
      lifecycleState: 'active',
      commandTriggers: [],
    });
  }, /commandTriggers must include at least one value/u);
});

test('readWorkflowInstructionsForInvocation resolves only active matching workflow guidance', async () => {
  const projectRootPath = await createAlfredProbabilisticProjectFixture();
  const masRootPath = path.join(projectRootPath, 'instance');

  await writeWorkflow({
    projectRootPath,
    workflowDirectoryName: 'complaint-handling',
  });
  await writeWorkflow({
    projectRootPath,
    workflowDirectoryName: 'disabled-workflow',
    definitionOverrides: {
      workflowId: 'disabled-workflow',
      lifecycleState: 'disabled',
    },
  });
  await writeWorkflow({
    projectRootPath,
    workflowDirectoryName: 'maria-only-workflow',
    definitionOverrides: {
      workflowId: 'maria-only-workflow',
      operationalIdentityIds: ['maria'],
    },
  });

  const result = await readWorkflowInstructionsForInvocation({
    masRootPath,
    request: {
      command: 'ask',
    },
    readiness: createWorkflowReadiness(),
  });

  assert.equal(result.workflowContexts.length, 1);
  assert.equal(result.workflowContexts[0].workflowId, 'complaint-handling');
  assert.equal(result.workflowContexts[0].sourcePaths.definition, 'instance/workflows/complaint-handling/workflow.json');
  assert.equal(result.workflowContexts[0].sourcePaths.instructions, 'instance/workflows/complaint-handling/workflow.md');
  assert.match(result.workflowContexts[0].instructionText, new RegExp(WORKFLOW_GUIDANCE_MARKER, 'u'));
});

test('buildWorkflowLayer creates a prompt layer without granting execution authority', async () => {
  const projectRootPath = await createAlfredProbabilisticProjectFixture();
  const masRootPath = path.join(projectRootPath, 'instance');

  await writeWorkflow({
    projectRootPath,
    workflowDirectoryName: 'complaint-handling',
  });

  const result = await readWorkflowInstructionsForInvocation({
    masRootPath,
    request: {
      command: 'ask',
    },
    readiness: createWorkflowReadiness(),
  });
  const layer = buildWorkflowLayer({
    workflowContexts: result.workflowContexts,
    warnings: result.warnings,
  });

  assert.equal(layer.layerId, 'workflow-instructions');
  assert.equal(layer.layerType, 'workflow');
  assert.equal(layer.owner, 'mas-workflows');
  assert.equal(layer.priority, WORKFLOW_LAYER_PRIORITY);
  assert.equal(layer.sourceReferences[0].sourceType, 'workflow_definition');
  assert.equal(layer.sourceReferences[1].sourceType, 'workflow_instructions');
  assert.match(layer.content, /Workflow Instructions/u);
  assert.match(layer.content, /do not grant permission to execute tools/u);
  assert.match(layer.content, new RegExp(WORKFLOW_GUIDANCE_MARKER, 'u'));
});

test('runAgentInvocation includes matching workflow guidance in the Prompt Factory layer stack', async () => {
  const projectRootPath = await createAlfredProbabilisticProjectFixture();
  const providerSystemMessages = [];

  await writeWorkflow({
    projectRootPath,
    workflowDirectoryName: 'complaint-handling',
  });

  const result = await withEnvironment(
    {
      "openrouter-api-key": 'openrouter-secret',
      "gemini-api-key": 'gemini-secret',
    },
    () => {
      return runAgentInvocation({
        projectRootPath,
        operationalIdentityId: 'alfred',
        invocationMode: 'probabilistic',
        command: 'ask',
        inputText: 'Use the complaint workflow guidance and explain the next safe step.',
        requestedBy: 'workflow-layer-test',
        fetchImplementation: async (url, options) => {
          assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions');
          assert.equal(options.headers.Authorization, 'Bearer openrouter-secret');

          const body = JSON.parse(options.body);

          providerSystemMessages.push(body.messages[0].content);

          return {
            ok: true,
            async json() {
              return {
                id: 'openrouter-workflow-layer-test',
                choices: [
                  {
                    finish_reason: 'stop',
                    message: {
                      content: 'Alfred used the workflow guidance and identified the next safe step.',
                    },
                  },
                ],
                usage: {
                  prompt_tokens: 260,
                  completion_tokens: 14,
                  total_tokens: 274,
                },
              };
            },
          };
        },
      });
    },
  );
  const providerSystemMessage = providerSystemMessages[0];
  const invocationSession = JSON.parse(await readFile(result.persistence.invocationSessionRecordPath, 'utf8'));
  const workflowLayer = invocationSession.promptProvenance.includedLayers.find((layer) => {
    return layer.layerType === 'workflow';
  });
  const layerTypes = invocationSession.instructionLayerSummary.layers.map((layer) => layer.layerType);

  assert.equal(result.status, 'completed');
  assert.match(providerSystemMessage, /Workflow Instructions/u);
  assert.match(providerSystemMessage, new RegExp(WORKFLOW_GUIDANCE_MARKER, 'u'));
  assert.match(providerSystemMessage, /do not grant permission to execute tools/u);
  assert.equal(layerTypes.indexOf('capability') < layerTypes.indexOf('workflow'), true);
  assert.equal(layerTypes.indexOf('workflow') < layerTypes.indexOf('execution_guard'), true);
  assert.equal(layerTypes.indexOf('execution_guard') < layerTypes.indexOf('context_pack'), true);
  assert.ok(workflowLayer);
  assert.equal(workflowLayer.sourceReferences[0].path, 'instance/workflows/complaint-handling/workflow.json');
  assert.equal(workflowLayer.sourceReferences[1].path, 'instance/workflows/complaint-handling/workflow.md');
  assert.equal(invocationSession.promptProvenance.omittedLayers.some((layer) => {
    return layer.layerType === 'workflow';
  }), false);
  assert.equal(invocationSession.promptProvenance.omittedLayers.some((layer) => {
    return layer.layerType === 'few_shot';
  }), true);
  assert.doesNotMatch(JSON.stringify(invocationSession.promptProvenance), new RegExp(WORKFLOW_GUIDANCE_MARKER, 'u'));
  assert.doesNotMatch(providerSystemMessage, /openrouter-secret|gemini-secret/u);
});
