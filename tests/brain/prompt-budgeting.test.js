import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { assertInstructionLayer } from '../../src/contracts/brain/instruction-layer-contract.js';
import {
  applyPromptBudgetToInstructionLayers,
  createDefaultPromptBudgetPolicy,
  DEFAULT_PROMPT_BUDGET_POLICY,
} from '../../src/brain/apply-prompt-budget-to-instruction-layers.js';
import { estimatePromptContentSize } from '../../src/brain/estimate-prompt-size.js';
import { runSystemBoot } from '../../src/boot/run-system-boot.js';
import { prepareAgentInvocation } from '../../src/invocation/prepare-agent-invocation.js';
import { assembleBrainInputForInvocation } from '../../src/brain/assemble-brain-input-for-invocation.js';
import {
  createAlfredProbabilisticProjectFixture,
  withEnvironment,
} from '../helpers/create-alfred-probabilistic-fixture.js';

const GOLDEN_EXAMPLE_BUDGET_MARKER = 'GOLDEN_EXAMPLE_BUDGET_MARKER_SHOULD_BE_COMPRESSED_AWAY';

function createLayer({
  layerId,
  layerType,
  priority,
  content,
}) {
  return assertInstructionLayer({
    layerId,
    layerType,
    owner: 'test-suite',
    priority,
    sourceReferences: [
      {
        sourceType: 'test_source',
        sourceId: `${layerId}.md`,
        path: `instance/test/${layerId}.md`,
      },
    ],
    content,
    summary: `${layerId} summary`,
    warnings: [],
  });
}

function createTestBudgetPolicy(overrides = {}) {
  return createDefaultPromptBudgetPolicy({
    promptBudgetPolicyId: 'test-prompt-budget-policy-v1',
    maxSystemInstructionCharacters: 3200,
    layerRules: [
      {
        layerType: 'framework_runtime',
        action: 'preserve',
      },
      {
        layerType: 'context_pack',
        action: 'compress',
        maxContentCharacters: 900,
        minContentCharacters: 650,
        reductionPriority: 80,
      },
      {
        layerType: 'few_shot',
        action: 'compress',
        maxContentCharacters: 700,
        minContentCharacters: 450,
        reductionPriority: 100,
      },
    ],
    ...overrides,
  });
}

async function writeLongGoldenExampleSet({ projectRootPath }) {
  const exampleRootPath = path.join(
    projectRootPath,
    'instance',
    'evaluations',
    'golden-examples',
    'system-steward-budget-examples',
  );

  await mkdir(exampleRootPath, { recursive: true });
  await writeFile(
    path.join(exampleRootPath, 'examples.json'),
    JSON.stringify({
      kind: 'golden_example_set_definition',
      version: 1,
      exampleSetId: 'system-steward-budget-examples',
      displayName: 'System Steward Budget Examples',
      lifecycleState: 'active',
      commandTriggers: ['ask'],
      operationalIdentityIds: ['alfred'],
      cognitiveIdentityIds: ['system-steward'],
      examples: [
        {
          exampleId: 'budgeted-example',
          title: 'Budgeted Example',
          userInput: 'Explain the MAS status.',
          idealOutput: [
            'Start with a concise answer.',
            'Keep the diagnostic boundary explicit.',
            'x'.repeat(12000),
            GOLDEN_EXAMPLE_BUDGET_MARKER,
          ].join('\n'),
          qualityCriteria: [
            'concise',
            'safe',
            'audit-friendly',
          ],
          antiPatterns: [
            'claiming unavailable execution',
          ],
        },
      ],
    }, null, 2),
    'utf8',
  );
}

test('estimatePromptContentSize uses a deterministic approximate token estimate', () => {
  assert.deepEqual(
    estimatePromptContentSize({
      content: '123456789',
      estimatedCharactersPerToken: 4,
    }),
    {
      characters: 9,
      estimatedTokens: 3,
    },
  );
});

test('applyPromptBudgetToInstructionLayers compresses expandable layers without touching protected layers', () => {
  const protectedMarker = 'PROTECTED_FRAMEWORK_RUNTIME_MARKER';
  const contextMarker = 'CONTEXT_MARKER_AFTER_LONG_CONTENT';
  const fewShotMarker = 'FEW_SHOT_MARKER_AFTER_LONG_CONTENT';
  const layers = [
    createLayer({
      layerId: 'runtime-core',
      layerType: 'framework_runtime',
      priority: 10,
      content: `## Runtime\n${protectedMarker}\nAlways preserve this layer.`,
    }),
    createLayer({
      layerId: 'context-pack',
      layerType: 'context_pack',
      priority: 80,
      content: `## Context\n${'context '.repeat(900)}\n${contextMarker}`,
    }),
    createLayer({
      layerId: 'few-shot-examples',
      layerType: 'few_shot',
      priority: 90,
      content: `## Examples\n${'example '.repeat(800)}\n${fewShotMarker}`,
    }),
  ];

  const result = applyPromptBudgetToInstructionLayers({
    instructionLayers: layers,
    promptBudgetPolicy: createTestBudgetPolicy(),
  });
  const runtimeLayer = result.instructionLayers.find((layer) => {
    return layer.layerType === 'framework_runtime';
  });
  const contextLayer = result.instructionLayers.find((layer) => {
    return layer.layerType === 'context_pack';
  });
  const fewShotLayer = result.instructionLayers.find((layer) => {
    return layer.layerType === 'few_shot';
  });

  assert.equal(result.promptBudgetReport.status, 'compressed');
  assert.match(runtimeLayer.content, new RegExp(protectedMarker, 'u'));
  assert.match(contextLayer.content, /Prompt Budget Compression Notice/u);
  assert.match(fewShotLayer.content, /Prompt Budget Compression Notice/u);
  assert.doesNotMatch(contextLayer.content, new RegExp(contextMarker, 'u'));
  assert.doesNotMatch(fewShotLayer.content, new RegExp(fewShotMarker, 'u'));
  assert.equal(result.promptBudgetReport.decisions.filter((decision) => {
    return decision.decisionType === 'compressed';
  }).length, 2);
  assert.equal(result.promptBudgetReport.after.characters <= 3200, true);
});

test('applyPromptBudgetToInstructionLayers reports over-budget protected layers instead of silently truncating them', () => {
  const protectedMarker = 'PROTECTED_POLICY_MARKER_MUST_SURVIVE';
  const layers = [
    createLayer({
      layerId: 'policy-instructions',
      layerType: 'policy',
      priority: 40,
      content: `## Policy\n${protectedMarker}\n${'policy '.repeat(600)}`,
    }),
  ];

  const result = applyPromptBudgetToInstructionLayers({
    instructionLayers: layers,
    promptBudgetPolicy: createDefaultPromptBudgetPolicy({
      promptBudgetPolicyId: 'protected-over-budget-test',
      maxSystemInstructionCharacters: 500,
      layerRules: [
        {
          layerType: 'policy',
          action: 'preserve',
        },
      ],
    }),
  });
  const policyLayer = result.instructionLayers[0];

  assert.equal(result.promptBudgetReport.status, 'over_budget');
  assert.match(policyLayer.content, new RegExp(protectedMarker, 'u'));
  assert.equal(result.promptBudgetReport.decisions[0].decisionType, 'over_budget');
  assert.match(result.promptBudgetReport.warnings[0], /final system instructions remain over budget/u);
});

test('assembleBrainInputForInvocation applies prompt budgeting before provider request creation', async () => {
  const projectRootPath = await createAlfredProbabilisticProjectFixture();

  await writeLongGoldenExampleSet({
    projectRootPath,
  });

  await withEnvironment(
    {
      "openrouter-api-key": 'openrouter-secret',
      "gemini-api-key": 'gemini-secret',
    },
    async () => {
      const bootResult = await runSystemBoot({
        projectRootPath,
      });
      const request = {
        operationalIdentityId: 'alfred',
        invocationMode: 'probabilistic',
        command: 'ask',
        inputText: 'Use any matching examples, but stay within the prompt budget.',
        requestedBy: 'prompt-budgeting-test',
      };
      const readiness = await prepareAgentInvocation({
        bootResult,
        request,
      });
      const result = await assembleBrainInputForInvocation({
        bootResult,
        readiness,
        request,
        invocationId: 'prompt-budgeting-integration-001',
        promptBudgetPolicy: createDefaultPromptBudgetPolicy({
          promptBudgetPolicyId: 'few-shot-integration-budget-test',
          maxSystemInstructionCharacters: 24000,
          layerRules: DEFAULT_PROMPT_BUDGET_POLICY.layerRules.map((rule) => {
            if (rule.layerType !== 'few_shot') {
              return rule;
            }

            return {
              ...rule,
              maxContentCharacters: 1400,
              minContentCharacters: 1200,
            };
          }),
        }),
      });
      const fewShotLayer = result.instructionLayers.find((layer) => {
        return layer.layerType === 'few_shot';
      });

      assert.equal(result.promptBudgetReport.status, 'compressed');
      assert.match(fewShotLayer.content, /Prompt Budget Compression Notice/u);
      assert.match(result.providerRequest.messages[0].content, /Prompt Budget Compression Notice/u);
      assert.doesNotMatch(result.providerRequest.messages[0].content, new RegExp(GOLDEN_EXAMPLE_BUDGET_MARKER, 'u'));
      assert.equal(result.promptProvenance.warnings.some((warning) => {
        return warning.includes('few-shot-examples was compressed');
      }), true);
      assert.equal(result.promptProvenance.includedLayers.some((layer) => {
        return layer.layerType === 'few_shot' && layer.content !== undefined;
      }), false);
    },
  );
});
