import { assertInstructionLayer } from '../contracts/brain/instruction-layer-contract.js';

const FEW_SHOT_LAYER_PRIORITY = 90;

function formatList(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return 'none';
  }

  return values.join(', ');
}

function buildExampleSetSourceReference(exampleSet) {
  return {
    sourceType: 'golden_example_set',
    sourceId: `${exampleSet.exampleSetId}:examples.json`,
    path: exampleSet.sourcePath,
  };
}

function buildExampleBlock(example) {
  return [
    `#### Example: ${example.title}`,
    `Example ID: ${example.exampleId}`,
    '',
    'User Input:',
    example.userInput,
    '',
    'Ideal Output:',
    example.idealOutput,
    '',
    'Quality Criteria:',
    formatList(example.qualityCriteria),
    '',
    'Anti-Patterns:',
    formatList(example.antiPatterns),
  ].join('\n');
}

function buildExampleSetBlock(exampleSet) {
  return [
    `### Golden Example Set: ${exampleSet.displayName}`,
    `Example Set ID: ${exampleSet.exampleSetId}`,
    `Lifecycle State: ${exampleSet.lifecycleState}`,
    `Command Triggers: ${formatList(exampleSet.commandTriggers)}`,
    `Operational Identity Scope: ${formatList(exampleSet.operationalIdentityIds)}`,
    `Cognitive Identity Scope: ${formatList(exampleSet.cognitiveIdentityIds)}`,
    exampleSet.description ? `Description: ${exampleSet.description}` : null,
    '',
    ...exampleSet.examples.map(buildExampleBlock),
  ].filter((line) => line !== null).join('\n');
}

export function buildFewShotInstructionContent({ exampleSets }) {
  return [
    '## Few-Shot and Golden Examples',
    'These examples are quality anchors for style, structure, and expected answer quality.',
    'They are not policies, permissions, runtime facts, or workflow state.',
    'If an example conflicts with Runtime Core, Policy, Capability, Workflow, Execution Guards, or Context Pack instructions, those higher-authority layers win.',
    'Do not infer new permissions, facts, or hidden policies from examples.',
    '',
    ...exampleSets.map(buildExampleSetBlock),
  ].join('\n\n');
}

export function buildFewShotLayer({
  exampleSets = [],
  warnings = [],
} = {}) {
  if (!Array.isArray(exampleSets) || exampleSets.length === 0) {
    return null;
  }

  return assertInstructionLayer({
    layerId: 'few-shot-examples',
    layerType: 'few_shot',
    owner: 'evaluation-and-audit',
    priority: FEW_SHOT_LAYER_PRIORITY,
    sourceReferences: exampleSets.map(buildExampleSetSourceReference),
    content: buildFewShotInstructionContent({
      exampleSets,
    }),
    summary: `${exampleSets.length} golden example set${exampleSets.length === 1 ? '' : 's'} matched this invocation.`,
    warnings,
  });
}

export {
  FEW_SHOT_LAYER_PRIORITY,
};
