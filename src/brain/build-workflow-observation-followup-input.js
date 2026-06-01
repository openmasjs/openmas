import { buildUserInput } from './build-user-input.js';

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function assertBrainWorkflowObservation(observation) {
  if (!isPlainObject(observation)) {
    throw new Error('Workflow Observation follow-up input requires a brain workflow observation object.');
  }

  if (observation.kind !== 'brain_workflow_observation') {
    throw new Error(`Workflow Observation follow-up input received unsupported observation kind: ${observation.kind}.`);
  }

  if (!isNonEmptyString(observation.workflowId)) {
    throw new Error('Workflow Observation follow-up input requires observation.workflowId.');
  }

  if (!isNonEmptyString(observation.workflowRunId)) {
    throw new Error('Workflow Observation follow-up input requires observation.workflowRunId.');
  }

  if (!isNonEmptyString(observation.status)) {
    throw new Error('Workflow Observation follow-up input requires observation.status.');
  }

  return observation;
}

export function buildWorkflowObservationFollowupInput({
  request,
  activeCognitiveSet,
  brainWorkflowObservation,
}) {
  const observation = assertBrainWorkflowObservation(brainWorkflowObservation);
  const originalUserInput = buildUserInput({
    request,
    activeCognitiveSet,
  });

  return [
    originalUserInput,
    '',
    'Runtime Follow-up:',
    `The runtime ran workflow ${observation.workflowId} with workflow run ${observation.workflowRunId}.`,
    `The observed workflow status is ${observation.status}.`,
    'Use the Workflow Observation instruction layer as bounded runtime evidence.',
    'Preserve exact workflow statuses, step outcomes, and uncertainty boundaries from the Workflow Observation layer.',
    'Translate for the human if needed, but do not upgrade bounded workflow evidence into broader system-health or readiness claims.',
    'Produce the final user-facing answer now.',
    'Do not emit another brain_workflow_request or brain_tool_request envelope in this pass.',
    'If the observation reports failure or pause, explain the status plainly instead of fabricating a successful result.',
  ].join('\n');
}
