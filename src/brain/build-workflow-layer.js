import { assertInstructionLayer } from '../contracts/brain/instruction-layer-contract.js';

const WORKFLOW_LAYER_PRIORITY = 60;

function formatList(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return 'none';
  }

  return values.join(', ');
}

function buildWorkflowSourceReferences(workflowContext) {
  return [
    {
      sourceType: 'workflow_definition',
      sourceId: `${workflowContext.workflowId}:workflow.json`,
      path: workflowContext.sourcePaths.definition,
    },
    {
      sourceType: 'workflow_instructions',
      sourceId: `${workflowContext.workflowId}:workflow.md`,
      path: workflowContext.sourcePaths.instructions,
    },
  ];
}

function buildWorkflowBlock(workflowContext) {
  return [
    `### Workflow: ${workflowContext.displayName}`,
    `Workflow ID: ${workflowContext.workflowId}`,
    `Lifecycle State: ${workflowContext.lifecycleState}`,
    `Command Triggers: ${formatList(workflowContext.commandTriggers)}`,
    `Operational Identity Scope: ${formatList(workflowContext.operationalIdentityIds)}`,
    `Cognitive Identity Scope: ${formatList(workflowContext.cognitiveIdentityIds)}`,
    workflowContext.description ? `Description: ${workflowContext.description}` : null,
    '',
    '#### Workflow Guidance',
    workflowContext.instructionText,
  ].filter((line) => line !== null).join('\n');
}

export function buildWorkflowInstructionContent({ workflowContexts }) {
  return [
    '## Workflow Instructions',
    'These instructions describe the relevant read-only workflow guidance for this invocation.',
    'They do not grant permission to execute tools, call external systems, publish messages, mutate memory, or advance workflow state.',
    'If the workflow requires an action that is not available through the current runtime, explain the required next step instead of pretending the action was performed.',
    '',
    ...workflowContexts.map(buildWorkflowBlock),
  ].join('\n\n');
}

export function buildWorkflowLayer({
  workflowContexts = [],
  warnings = [],
} = {}) {
  if (!Array.isArray(workflowContexts) || workflowContexts.length === 0) {
    return null;
  }

  return assertInstructionLayer({
    layerId: 'workflow-instructions',
    layerType: 'workflow',
    owner: 'mas-workflows',
    priority: WORKFLOW_LAYER_PRIORITY,
    sourceReferences: workflowContexts.flatMap(buildWorkflowSourceReferences),
    content: buildWorkflowInstructionContent({
      workflowContexts,
    }),
    summary: `${workflowContexts.length} workflow instruction set${workflowContexts.length === 1 ? '' : 's'} matched this invocation.`,
    warnings,
  });
}

export {
  WORKFLOW_LAYER_PRIORITY,
};
