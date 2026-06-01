import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { assertPromptProfileDefinition } from '../../src/contracts/prompts/prompt-profile-contract.js';
import { createDefaultPromptBudgetPolicy, DEFAULT_PROMPT_BUDGET_POLICY } from '../../src/brain/apply-prompt-budget-to-instruction-layers.js';
import { readPromptProfileForInvocation } from '../../src/prompt-profiles/read-prompt-profile-for-invocation.js';
import { runSystemBoot } from '../../src/boot/run-system-boot.js';
import { prepareAgentInvocation } from '../../src/invocation/prepare-agent-invocation.js';
import { assembleBrainInputForInvocation } from '../../src/brain/assemble-brain-input-for-invocation.js';
import { runAgentInvocation } from '../../src/invocation/run-agent-invocation.js';
import {
  createAlfredProbabilisticProjectFixture,
  withEnvironment,
} from '../helpers/create-alfred-probabilistic-fixture.js';

const PROFILE_COMPRESSION_MARKER = 'PROFILE_COMPRESSION_MARKER_SHOULD_NOT_REACH_PROVIDER';

function createTightFewShotBudgetPolicy({
  promptBudgetPolicyId = 'alfred-tight-few-shot-budget-v1',
} = {}) {
  return createDefaultPromptBudgetPolicy({
    promptBudgetPolicyId,
    maxSystemInstructionCharacters: 24000,
    layerRules: DEFAULT_PROMPT_BUDGET_POLICY.layerRules.map((rule) => {
      if (rule.layerType !== 'few_shot') {
        return rule;
      }

      return {
        ...rule,
        maxContentCharacters: 1300,
        minContentCharacters: 1100,
      };
    }),
  });
}

async function writePromptProfile({
  projectRootPath,
  profileDirectoryName,
  profileOverrides = {},
}) {
  const profileRootPath = path.join(
    projectRootPath,
    'instance',
    'prompt-factory',
    'profiles',
    profileDirectoryName,
  );

  await mkdir(profileRootPath, { recursive: true });
  await writeFile(
    path.join(profileRootPath, 'profile.json'),
    JSON.stringify({
      kind: 'prompt_profile_definition',
      version: 1,
      promptProfileId: profileDirectoryName,
      promptStackVersionId: `${profileDirectoryName}-stack-v1`,
      displayName: `Prompt Profile ${profileDirectoryName}`,
      description: 'Test prompt profile.',
      lifecycleState: 'active',
      selectionPriority: 10,
      selectionCriteria: {},
      promptBudgetPolicy: createDefaultPromptBudgetPolicy({
        promptBudgetPolicyId: `${profileDirectoryName}-budget-v1`,
      }),
      warnings: [],
      ...profileOverrides,
    }, null, 2),
    'utf8',
  );
}

async function writeLongGoldenExampleSet({ projectRootPath }) {
  const exampleRootPath = path.join(
    projectRootPath,
    'instance',
    'evaluations',
    'golden-examples',
    'system-steward-profile-examples',
  );

  await mkdir(exampleRootPath, { recursive: true });
  await writeFile(
    path.join(exampleRootPath, 'examples.json'),
    JSON.stringify({
      kind: 'golden_example_set_definition',
      version: 1,
      exampleSetId: 'system-steward-profile-examples',
      displayName: 'System Steward Profile Examples',
      lifecycleState: 'active',
      commandTriggers: ['ask'],
      operationalIdentityIds: ['alfred'],
      cognitiveIdentityIds: ['system-steward'],
      examples: [
        {
          exampleId: 'profile-budgeted-example',
          title: 'Profile Budgeted Example',
          userInput: 'Explain the MAS status.',
          idealOutput: [
            'Answer with profile-governed discipline.',
            'Keep the diagnostic boundary explicit.',
            'x'.repeat(12000),
            PROFILE_COMPRESSION_MARKER,
          ].join('\n'),
          qualityCriteria: [
            'concise',
            'safe',
            'version traceable',
          ],
          antiPatterns: [
            'silent prompt drift',
          ],
        },
      ],
    }, null, 2),
    'utf8',
  );
}

async function prepareAlfredAskInvocation({ projectRootPath }) {
  const bootResult = await runSystemBoot({
    projectRootPath,
  });
  const request = {
    operationalIdentityId: 'alfred',
    invocationMode: 'probabilistic',
    command: 'ask',
    inputText: 'Explain the current MAS status using the selected prompt profile.',
    requestedBy: 'prompt-profile-test',
  };
  const readiness = await prepareAgentInvocation({
    bootResult,
    request,
  });

  return {
    bootResult,
    request,
    readiness,
  };
}

test('assertPromptProfileDefinition accepts a valid versioned prompt profile', () => {
  const profile = assertPromptProfileDefinition({
    kind: 'prompt_profile_definition',
    version: 1,
    promptProfileId: 'alfred-ask-profile-v1',
    promptStackVersionId: 'alfred-ask-stack-v1',
    lifecycleState: 'active',
    selectionPriority: 20,
    selectionCriteria: {
      operationalIdentityIds: ['alfred'],
      commands: ['ask'],
      invocationModes: ['probabilistic'],
      executionModes: ['hybrid'],
    },
    promptBudgetPolicy: createTightFewShotBudgetPolicy(),
  });

  assert.equal(profile.promptProfileId, 'alfred-ask-profile-v1');
  assert.equal(profile.promptStackVersionId, 'alfred-ask-stack-v1');
  assert.equal(profile.selectionCriteria.commands[0], 'ask');
  assert.equal(profile.promptBudgetPolicy.promptBudgetPolicyId, 'alfred-tight-few-shot-budget-v1');
});

test('assertPromptProfileDefinition rejects unsupported selection criteria', () => {
  assert.throws(() => {
    assertPromptProfileDefinition({
      kind: 'prompt_profile_definition',
      version: 1,
      promptProfileId: 'invalid-profile',
      promptStackVersionId: 'invalid-stack',
      lifecycleState: 'active',
      selectionCriteria: {
        hiddenSelector: ['not-supported'],
      },
    });
  }, /unsupported field: hiddenSelector/u);
});

test('readPromptProfileForInvocation falls back to the framework default when no MAS profiles exist', async () => {
  const projectRootPath = await createAlfredProbabilisticProjectFixture();
  const {
    bootResult,
    request,
    readiness,
  } = await prepareAlfredAskInvocation({
    projectRootPath,
  });

  const result = await readPromptProfileForInvocation({
    masRootPath: bootResult.masRootPath,
    request,
    readiness,
    brainReference: readiness.brainSelection.selectedBrain,
  });

  assert.equal(result.promptProfile.promptProfileId, 'default-layered-prompt-profile-v1');
  assert.equal(result.promptProfile.promptStackVersionId, 'prompt-stack-v1');
  assert.equal(result.selectionReport.selectionSource, 'framework_default');
  assert.equal(result.selectionReport.candidateCount, 0);
  assert.equal(result.warnings.length, 0);
});

test('readPromptProfileForInvocation selects the highest priority matching MAS profile deterministically', async () => {
  const projectRootPath = await createAlfredProbabilisticProjectFixture();

  await writePromptProfile({
    projectRootPath,
    profileDirectoryName: 'generic-low-priority-profile',
    profileOverrides: {
      promptProfileId: 'generic-low-priority-profile',
      promptStackVersionId: 'generic-stack-v1',
      selectionPriority: 5,
      selectionCriteria: {},
    },
  });
  await writePromptProfile({
    projectRootPath,
    profileDirectoryName: 'disabled-exact-profile',
    profileOverrides: {
      promptProfileId: 'disabled-exact-profile',
      promptStackVersionId: 'disabled-stack-v1',
      lifecycleState: 'disabled',
      selectionPriority: 100,
      selectionCriteria: {
        operationalIdentityIds: ['alfred'],
        commands: ['ask'],
        invocationModes: ['probabilistic'],
        executionModes: ['hybrid'],
      },
    },
  });
  await writePromptProfile({
    projectRootPath,
    profileDirectoryName: 'alfred-ask-profile-v2',
    profileOverrides: {
      promptProfileId: 'alfred-ask-profile-v2',
      promptStackVersionId: 'alfred-ask-stack-v2',
      selectionPriority: 50,
      selectionCriteria: {
        operationalIdentityIds: ['alfred'],
        cognitiveIdentityIds: ['system-steward'],
        commands: ['ask'],
        invocationModes: ['probabilistic'],
        executionModes: ['hybrid'],
        providerIds: ['openrouter-api'],
      },
      promptBudgetPolicy: createTightFewShotBudgetPolicy(),
    },
  });

  const {
    bootResult,
    request,
    readiness,
  } = await prepareAlfredAskInvocation({
    projectRootPath,
  });
  const result = await readPromptProfileForInvocation({
    masRootPath: bootResult.masRootPath,
    request,
    readiness,
    brainReference: readiness.brainSelection.selectedBrain,
  });

  assert.equal(result.promptProfile.promptProfileId, 'alfred-ask-profile-v2');
  assert.equal(result.promptProfile.promptStackVersionId, 'alfred-ask-stack-v2');
  assert.equal(result.selectionReport.selectionSource, 'mas_profile');
  assert.equal(result.selectionReport.matchedCandidateCount, 2);
  assert.equal(result.selectionReport.sourcePath, 'instance/prompt-factory/profiles/alfred-ask-profile-v2/profile.json');
});

test('assembleBrainInputForInvocation applies the selected prompt profile to budget and provenance', async () => {
  const projectRootPath = await createAlfredProbabilisticProjectFixture();

  await writePromptProfile({
    projectRootPath,
    profileDirectoryName: 'alfred-tight-profile',
    profileOverrides: {
      promptProfileId: 'alfred-tight-profile',
      promptStackVersionId: 'alfred-tight-stack-v3',
      selectionPriority: 50,
      selectionCriteria: {
        operationalIdentityIds: ['alfred'],
        commands: ['ask'],
        invocationModes: ['probabilistic'],
        executionModes: ['hybrid'],
      },
      promptBudgetPolicy: createTightFewShotBudgetPolicy({
        promptBudgetPolicyId: 'alfred-tight-profile-budget-v1',
      }),
    },
  });
  await writeLongGoldenExampleSet({
    projectRootPath,
  });

  await withEnvironment(
    {
      "openrouter-api-key": 'openrouter-secret',
      "gemini-api-key": 'gemini-secret',
    },
    async () => {
      const {
        bootResult,
        request,
        readiness,
      } = await prepareAlfredAskInvocation({
        projectRootPath,
      });
      const result = await assembleBrainInputForInvocation({
        bootResult,
        readiness,
        request,
        invocationId: 'prompt-profile-assembly-001',
      });

      assert.equal(result.promptProfileSelection.selectedProfileId, 'alfred-tight-profile');
      assert.equal(result.promptProfileSelection.promptStackVersionId, 'alfred-tight-stack-v3');
      assert.equal(result.promptBudgetReport.promptBudgetPolicyId, 'alfred-tight-profile-budget-v1');
      assert.equal(result.promptBudgetReport.status, 'compressed');
      assert.equal(result.brainInput.promptProfileId, 'alfred-tight-profile');
      assert.equal(result.brainInput.promptStackVersionId, 'alfred-tight-stack-v3');
      assert.equal(result.promptProvenance.promptProfileId, 'alfred-tight-profile');
      assert.equal(result.promptProvenance.promptStackVersionId, 'alfred-tight-stack-v3');
      assert.doesNotMatch(result.providerRequest.messages[0].content, new RegExp(PROFILE_COMPRESSION_MARKER, 'u'));
    },
  );
});

test('runAgentInvocation persists prompt profile selection and prompt stack versioning metadata', async () => {
  const projectRootPath = await createAlfredProbabilisticProjectFixture();
  const providerSystemMessages = [];

  await writePromptProfile({
    projectRootPath,
    profileDirectoryName: 'alfred-runtime-profile',
    profileOverrides: {
      promptProfileId: 'alfred-runtime-profile',
      promptStackVersionId: 'alfred-runtime-stack-v1',
      selectionPriority: 50,
      selectionCriteria: {
        operationalIdentityIds: ['alfred'],
        commands: ['ask'],
        invocationModes: ['probabilistic'],
      },
      promptBudgetPolicy: createTightFewShotBudgetPolicy({
        promptBudgetPolicyId: 'alfred-runtime-budget-v1',
      }),
    },
  });
  await writeLongGoldenExampleSet({
    projectRootPath,
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
        inputText: 'Answer using the selected prompt profile.',
        requestedBy: 'prompt-profile-runtime-test',
        fetchImplementation: async (url, options) => {
          assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions');

          const body = JSON.parse(options.body);

          providerSystemMessages.push(body.messages[0].content);

          return {
            ok: true,
            async json() {
              return {
                id: 'openrouter-prompt-profile-test',
                choices: [
                  {
                    finish_reason: 'stop',
                    message: {
                      content: 'Alfred answered with a versioned prompt profile.',
                    },
                  },
                ],
                usage: {
                  prompt_tokens: 320,
                  completion_tokens: 12,
                  total_tokens: 332,
                },
              };
            },
          };
        },
      });
    },
  );
  const invocationSession = JSON.parse(await readFile(result.persistence.invocationSessionRecordPath, 'utf8'));

  assert.equal(result.status, 'completed');
  assert.match(providerSystemMessages[0], /Prompt Budget Compression Notice/u);
  assert.equal(invocationSession.promptProfileSelection.selectedProfileId, 'alfred-runtime-profile');
  assert.equal(invocationSession.promptProfileSelection.promptStackVersionId, 'alfred-runtime-stack-v1');
  assert.equal(invocationSession.brainInputSummary.promptProfileId, 'alfred-runtime-profile');
  assert.equal(invocationSession.brainInputSummary.promptStackVersionId, 'alfred-runtime-stack-v1');
  assert.equal(invocationSession.promptBudgetReport.promptBudgetPolicyId, 'alfred-runtime-budget-v1');
  assert.equal(invocationSession.promptProvenance.promptProfileId, 'alfred-runtime-profile');
  assert.equal(invocationSession.promptProvenance.promptStackVersionId, 'alfred-runtime-stack-v1');
  assert.doesNotMatch(JSON.stringify(invocationSession.promptProvenance), new RegExp(PROFILE_COMPRESSION_MARKER, 'u'));
});
