import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { assertGoldenExampleSetDefinition } from '../../src/contracts/examples/golden-example-contract.js';
import { buildFewShotLayer, FEW_SHOT_LAYER_PRIORITY } from '../../src/brain/build-few-shot-layer.js';
import { readGoldenExamplesForInvocation } from '../../src/examples/read-golden-examples-for-invocation.js';
import { runAgentInvocation } from '../../src/invocation/run-agent-invocation.js';
import {
  createAlfredProbabilisticProjectFixture,
  withEnvironment,
} from '../helpers/create-alfred-probabilistic-fixture.js';

const GOLDEN_EXAMPLE_MARKER = 'GOLDEN_EXAMPLE_MARKER_SYSTEM_STEWARD_QUALITY_ANCHOR';

async function writeGoldenExampleSet({
  projectRootPath,
  exampleDirectoryName,
  definitionOverrides = {},
}) {
  const exampleRootPath = path.join(projectRootPath, 'instance', 'evaluations', 'golden-examples', exampleDirectoryName);

  await mkdir(exampleRootPath, { recursive: true });
  await writeFile(
    path.join(exampleRootPath, 'examples.json'),
    JSON.stringify({
      kind: 'golden_example_set_definition',
      version: 1,
      exampleSetId: exampleDirectoryName,
      displayName: 'System Steward Diagnostic Examples',
      lifecycleState: 'active',
      description: 'Quality anchors for concise System Steward diagnostic answers.',
      commandTriggers: ['ask'],
      operationalIdentityIds: ['alfred'],
      cognitiveIdentityIds: ['system-steward'],
      examples: [
        {
          exampleId: 'concise-diagnostic-answer',
          title: 'Concise Diagnostic Answer',
          userInput: 'Briefly explain the next safe MAS diagnostic step.',
          idealOutput: `${GOLDEN_EXAMPLE_MARKER}: State the diagnostic step, mention the evidence boundary, and avoid pretending to execute unavailable actions.`,
          qualityCriteria: [
            'answer is concise',
            'answer names the next safe step',
            'answer does not claim unsupported tool execution',
          ],
          antiPatterns: [
            'inventing a completed tool action',
            'turning the example into a new policy',
          ],
        },
      ],
      ...definitionOverrides,
    }, null, 2),
    'utf8',
  );
}

function createReadiness(overrides = {}) {
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

test('assertGoldenExampleSetDefinition accepts a valid golden example set', () => {
  const definition = assertGoldenExampleSetDefinition({
    kind: 'golden_example_set_definition',
    version: 1,
    exampleSetId: 'system-steward-diagnostics',
    displayName: 'System Steward Diagnostics',
    lifecycleState: 'active',
    commandTriggers: ['ask'],
    operationalIdentityIds: ['alfred'],
    cognitiveIdentityIds: ['system-steward'],
    examples: [
      {
        exampleId: 'example-1',
        title: 'Example 1',
        userInput: 'What should I do next?',
        idealOutput: 'Explain the next safe step.',
        qualityCriteria: ['concise'],
        antiPatterns: ['hidden policy'],
      },
    ],
  });

  assert.equal(definition.exampleSetId, 'system-steward-diagnostics');
  assert.equal(definition.examples.length, 1);
});

test('assertGoldenExampleSetDefinition rejects policy-like fields in examples', () => {
  assert.throws(() => {
    assertGoldenExampleSetDefinition({
      kind: 'golden_example_set_definition',
      version: 1,
      exampleSetId: 'hidden-policy-example',
      displayName: 'Hidden Policy Example',
      lifecycleState: 'active',
      commandTriggers: ['ask'],
      examples: [
        {
          exampleId: 'example-1',
          title: 'Example 1',
          userInput: 'What should I do next?',
          idealOutput: 'Explain the next safe step.',
          policyInstructions: ['Never put policy instructions in examples.'],
        },
      ],
    });
  }, /policy-like field "policyInstructions"/u);
});

test('readGoldenExamplesForInvocation resolves only active matching example sets', async () => {
  const projectRootPath = await createAlfredProbabilisticProjectFixture();
  const masRootPath = path.join(projectRootPath, 'instance');

  await writeGoldenExampleSet({
    projectRootPath,
    exampleDirectoryName: 'system-steward-diagnostics',
  });
  await writeGoldenExampleSet({
    projectRootPath,
    exampleDirectoryName: 'disabled-examples',
    definitionOverrides: {
      exampleSetId: 'disabled-examples',
      lifecycleState: 'disabled',
    },
  });
  await writeGoldenExampleSet({
    projectRootPath,
    exampleDirectoryName: 'maria-only-examples',
    definitionOverrides: {
      exampleSetId: 'maria-only-examples',
      operationalIdentityIds: ['maria'],
    },
  });

  const result = await readGoldenExamplesForInvocation({
    masRootPath,
    request: {
      command: 'ask',
    },
    readiness: createReadiness(),
  });

  assert.equal(result.exampleSets.length, 1);
  assert.equal(result.exampleSets[0].exampleSetId, 'system-steward-diagnostics');
  assert.equal(result.exampleSets[0].sourcePath, 'instance/evaluations/golden-examples/system-steward-diagnostics/examples.json');
  assert.match(result.exampleSets[0].examples[0].idealOutput, new RegExp(GOLDEN_EXAMPLE_MARKER, 'u'));
});

test('buildFewShotLayer creates a quality-anchor layer without policy authority', async () => {
  const projectRootPath = await createAlfredProbabilisticProjectFixture();
  const masRootPath = path.join(projectRootPath, 'instance');

  await writeGoldenExampleSet({
    projectRootPath,
    exampleDirectoryName: 'system-steward-diagnostics',
  });

  const result = await readGoldenExamplesForInvocation({
    masRootPath,
    request: {
      command: 'ask',
    },
    readiness: createReadiness(),
  });
  const layer = buildFewShotLayer({
    exampleSets: result.exampleSets,
    warnings: result.warnings,
  });

  assert.equal(layer.layerId, 'few-shot-examples');
  assert.equal(layer.layerType, 'few_shot');
  assert.equal(layer.owner, 'evaluation-and-audit');
  assert.equal(layer.priority, FEW_SHOT_LAYER_PRIORITY);
  assert.equal(layer.sourceReferences[0].sourceType, 'golden_example_set');
  assert.match(layer.content, /Few-Shot and Golden Examples/u);
  assert.match(layer.content, /They are not policies, permissions, runtime facts, or workflow state/u);
  assert.match(layer.content, new RegExp(GOLDEN_EXAMPLE_MARKER, 'u'));
});

test('runAgentInvocation includes matching golden examples in the Prompt Factory layer stack', async () => {
  const projectRootPath = await createAlfredProbabilisticProjectFixture();
  const providerSystemMessages = [];

  await writeGoldenExampleSet({
    projectRootPath,
    exampleDirectoryName: 'system-steward-diagnostics',
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
        inputText: 'Answer with the same quality discipline as the available golden examples.',
        requestedBy: 'few-shot-layer-test',
        fetchImplementation: async (url, options) => {
          assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions');
          assert.equal(options.headers.Authorization, 'Bearer openrouter-secret');

          const body = JSON.parse(options.body);

          providerSystemMessages.push(body.messages[0].content);

          return {
            ok: true,
            async json() {
              return {
                id: 'openrouter-few-shot-layer-test',
                choices: [
                  {
                    finish_reason: 'stop',
                    message: {
                      content: 'Alfred used the golden example quality anchor safely.',
                    },
                  },
                ],
                usage: {
                  prompt_tokens: 280,
                  completion_tokens: 12,
                  total_tokens: 292,
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
  const fewShotLayer = invocationSession.promptProvenance.includedLayers.find((layer) => {
    return layer.layerType === 'few_shot';
  });
  const layerTypes = invocationSession.instructionLayerSummary.layers.map((layer) => layer.layerType);

  assert.equal(result.status, 'completed');
  assert.match(providerSystemMessage, /Few-Shot and Golden Examples/u);
  assert.match(providerSystemMessage, new RegExp(GOLDEN_EXAMPLE_MARKER, 'u'));
  assert.match(providerSystemMessage, /Do not infer new permissions, facts, or hidden policies from examples/u);
  assert.equal(layerTypes.indexOf('context_pack') < layerTypes.indexOf('few_shot'), true);
  assert.ok(fewShotLayer);
  assert.equal(fewShotLayer.sourceReferences[0].path, 'instance/evaluations/golden-examples/system-steward-diagnostics/examples.json');
  assert.equal(invocationSession.promptProvenance.omittedLayers.some((layer) => {
    return layer.layerType === 'few_shot';
  }), false);
  assert.equal(invocationSession.promptProvenance.omittedLayers.some((layer) => {
    return layer.layerType === 'workflow';
  }), true);
  assert.doesNotMatch(JSON.stringify(invocationSession.promptProvenance), new RegExp(GOLDEN_EXAMPLE_MARKER, 'u'));
  assert.doesNotMatch(providerSystemMessage, /openrouter-secret|gemini-secret/u);
});
