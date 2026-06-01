import { assertInstructionLayer } from '../contracts/brain/instruction-layer-contract.js';
import { assertWorkflowRuntimeDefinition } from '../contracts/workflows/workflow-runtime-contract.js';

const WORKFLOW_AVAILABILITY_LAYER_PRIORITY = 62;

function normalizeWorkflowRuntimeDefinition(workflowRuntimeDefinition) {
  const normalizedDefinition = assertWorkflowRuntimeDefinition(workflowRuntimeDefinition);

  return {
    ...normalizedDefinition,
    sourcePath: typeof workflowRuntimeDefinition.sourcePath === 'string'
      && workflowRuntimeDefinition.sourcePath.trim().length > 0
      ? workflowRuntimeDefinition.sourcePath.trim()
      : `instance/workflows/${normalizedDefinition.workflowId}/runtime.json`,
  };
}

function formatStep(step) {
  return [
    `- Step ID: ${step.stepId}`,
    `  Step Type: ${step.stepType}`,
    `  Tool ID: ${step.toolId ?? 'n/a'}`,
    `  Depends On: ${step.dependsOn.length > 0 ? step.dependsOn.join(', ') : 'none'}`,
    `  Failure Policy: ${step.onFailure}`,
  ].join('\n');
}

function buildWorkflowBlock(workflowRuntimeDefinition) {
  return [
    `### Workflow ID: ${workflowRuntimeDefinition.workflowId}`,
    `Lifecycle State: ${workflowRuntimeDefinition.lifecycleState}`,
    `Execution Mode: ${workflowRuntimeDefinition.executionMode}`,
    `Persist State: ${workflowRuntimeDefinition.statePolicy.persistState ? 'yes' : 'no'}`,
    `Resume Allowed: ${workflowRuntimeDefinition.statePolicy.resumeAllowed ? 'yes' : 'no'}`,
    `Step Count: ${workflowRuntimeDefinition.steps.length}`,
    'Steps:',
    ...workflowRuntimeDefinition.steps.map(formatStep),
  ].join('\n');
}

function buildWorkflowAvailabilitySourceReferences(workflowRuntimeDefinitions) {
  return [
    {
      sourceType: 'framework_runtime',
      sourceId: 'openmas-workflow-availability-layer',
      path: 'src/brain/build-workflow-availability-layer.js',
    },
    ...workflowRuntimeDefinitions.map((workflowRuntimeDefinition) => {
      return {
        sourceType: 'workflow_runtime_definition',
        sourceId: `${workflowRuntimeDefinition.workflowId}:runtime.json`,
        path: workflowRuntimeDefinition.sourcePath,
      };
    }),
  ];
}

function buildWorkflowAvailabilityInstructionContent({
  workflowRuntimeDefinitions,
}) {
  return [
    '## Workflow Availability',
    'This layer lists executable workflow runtime definitions evaluated by the runtime for the current invocation.',
    'Workflow availability is runtime evidence, not execution, not permission escalation, and not proof that any workflow has run.',
    'The brain may only request workflows through the runtime workflow request path. The runtime remains the only authority that can execute, deny, pause, or persist workflow state.',
    'Never claim that a workflow was executed unless the runtime returns workflow observation evidence.',
    '',
    '## Brain Workflow Request Envelope',
    'If you need an available workflow, respond with only a JSON object that matches this exact shape:',
    '{',
    '  "kind": "brain_workflow_request",',
    '  "version": 1,',
    '  "workflowRequestId": "workflow-request-001",',
    '  "workflowId": "workflow.id.from.available.list",',
    '  "input": {},',
    '  "purpose": "Explain why this workflow is needed for the current user request.",',
    '  "expectedSideEffectLevel": "read_only"',
    '}',
    'Plan/preview grounding rule: if the user asks for a plan before execution, only mention workflow ids from this layer and describe them as candidate runtime steps, not as completed execution.',
    'Do not invent workflow ids, audit reports, logs, checkpoints, or filesystem paths that are not explicitly listed in the current invocation context.',
    'Do not claim the workflow was executed. The runtime may accept, deny, pause, or fail the workflow request.',
    'For normal answers that do not need a workflow, do not emit this envelope.',
    '',
    '## Available On-Demand Workflows',
    ...workflowRuntimeDefinitions.map(buildWorkflowBlock),
  ].join('\n');
}

export function buildWorkflowAvailabilityLayer({
  workflowRuntimeDefinitions = [],
  warnings = [],
} = {}) {
  if (!Array.isArray(workflowRuntimeDefinitions)) {
    throw new Error('Workflow Availability layer workflowRuntimeDefinitions must be an array.');
  }

  const normalizedWorkflowRuntimeDefinitions = workflowRuntimeDefinitions
    .map(normalizeWorkflowRuntimeDefinition)
    .filter((definition) => {
      return definition.lifecycleState === 'active' && definition.executionMode === 'on_demand';
    })
    .toSorted((left, right) => {
      return left.workflowId.localeCompare(right.workflowId);
    });

  if (normalizedWorkflowRuntimeDefinitions.length === 0) {
    return null;
  }

  return assertInstructionLayer({
    layerId: 'workflow-availability',
    layerType: 'workflow_availability',
    owner: 'tool-and-workflow-runtime',
    priority: WORKFLOW_AVAILABILITY_LAYER_PRIORITY,
    sourceReferences: buildWorkflowAvailabilitySourceReferences(normalizedWorkflowRuntimeDefinitions),
    content: buildWorkflowAvailabilityInstructionContent({
      workflowRuntimeDefinitions: normalizedWorkflowRuntimeDefinitions,
    }),
    summary: `${normalizedWorkflowRuntimeDefinitions.length} executable on-demand workflow${normalizedWorkflowRuntimeDefinitions.length === 1 ? '' : 's'} available for request.`,
    warnings,
  });
}

export {
  WORKFLOW_AVAILABILITY_LAYER_PRIORITY,
};
