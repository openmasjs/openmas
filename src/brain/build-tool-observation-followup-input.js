import { buildUserInput } from './build-user-input.js';

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function assertBrainToolObservation(observation) {
  if (!isPlainObject(observation)) {
    throw new Error('Tool Observation follow-up input requires a brain tool observation object.');
  }

  if (observation.kind !== 'brain_tool_observation') {
    throw new Error(`Tool Observation follow-up input received unsupported observation kind: ${observation.kind}.`);
  }

  if (!isNonEmptyString(observation.toolId)) {
    throw new Error('Tool Observation follow-up input requires observation.toolId.');
  }

  if (!isNonEmptyString(observation.toolRunId)) {
    throw new Error('Tool Observation follow-up input requires observation.toolRunId.');
  }

  if (!isNonEmptyString(observation.status)) {
    throw new Error('Tool Observation follow-up input requires observation.status.');
  }

  return observation;
}

export function buildToolObservationFollowupInput({
  request,
  activeCognitiveSet,
  brainToolObservation,
}) {
  const observation = assertBrainToolObservation(brainToolObservation);
  const originalUserInput = buildUserInput({
    request,
    activeCognitiveSet,
  });

  return [
    originalUserInput,
    '',
    'Runtime Follow-up:',
    `The runtime executed read-only tool ${observation.toolId} with tool run ${observation.toolRunId}.`,
    `The observed tool status is ${observation.status}.`,
    'Use the Tool Observation instruction layer as bounded runtime evidence.',
    'Preserve exact evidence labels, lifecycle states, readiness states, and uncertainty boundaries from the Tool Observation layer.',
    'Preserve exact numeric count labels; do not merge counts across categories or rename inventory counts as readiness or execution counts.',
    'Translate for the human if needed, but preserve exact evidence meaning across languages. Do not turn inventory labels into execution claims.',
    'Produce the final user-facing answer now.',
    'Do not emit another brain_tool_request envelope in this pass.',
    'If the observation reports failure, explain the failure plainly instead of fabricating a successful result.',
  ].join('\n');
}
