import { assertBrainSelection } from '../contracts/identity/execution-profile-contract.js';

function getInvocationMode(request) {
  return request.invocationMode ?? 'preflight';
}

export function getExecutionModeCompatibilityError({
  executionProfileDefinition,
  request,
}) {
  const invocationMode = getInvocationMode(request);
  const executionMode = executionProfileDefinition.executionMode;

  if (invocationMode === 'preflight') {
    return null;
  }

  if (invocationMode === 'deterministic') {
    if (executionMode === 'deterministic' || executionMode === 'hybrid') {
      return null;
    }

    return `Execution Profile ${executionProfileDefinition.executionProfileId} does not support deterministic invocation.`;
  }

  if (invocationMode === 'probabilistic') {
    if (executionMode === 'probabilistic' || executionMode === 'hybrid') {
      return null;
    }

    return `Execution Profile ${executionProfileDefinition.executionProfileId} does not support probabilistic invocation.`;
  }

  return `Unsupported invocation mode for brain selection: ${invocationMode}`;
}

export function selectBrainForInvocation({
  executionProfileDefinition,
  request,
}) {
  const compatibilityError = getExecutionModeCompatibilityError({
    executionProfileDefinition,
    request,
  });

  if (compatibilityError) {
    throw new Error(compatibilityError);
  }

  const commandIsEnabled = (
    executionProfileDefinition.enabledCommands.length === 0
    || executionProfileDefinition.enabledCommands.includes(request.command)
  );

  if (!commandIsEnabled) {
    throw new Error(
      `Execution Profile ${executionProfileDefinition.executionProfileId} does not enable command: ${request.command}`,
    );
  }

  return assertBrainSelection({
    selectedBrain: executionProfileDefinition.primaryBrain,
    fallbackBrain: executionProfileDefinition.fallbackBrain,
    selectionSource: 'primary_brain_default',
    brainRequired: getInvocationMode(request) === 'probabilistic',
  });
}
