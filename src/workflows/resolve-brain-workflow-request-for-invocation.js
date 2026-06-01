import { assertBrainOutput } from '../contracts/brain/brain-output-contract.js';
import { assertBrainWorkflowRequestResolution } from '../contracts/brain/brain-workflow-request-contract.js';
import { assertWorkflowRuntimeDefinition } from '../contracts/workflows/workflow-runtime-contract.js';
import { parseBrainWorkflowRequestEnvelopeFromText } from './parse-brain-workflow-request-envelope.js';

function normalizeWorkflowRuntimeDefinitions(workflowRuntimeDefinitions) {
  if (!Array.isArray(workflowRuntimeDefinitions)) {
    throw new Error('Brain workflow request resolution workflowRuntimeDefinitions must be an array.');
  }

  return workflowRuntimeDefinitions.map(assertWorkflowRuntimeDefinition);
}

function findWorkflowRuntimeDefinition({
  workflowRuntimeDefinitions,
  workflowId,
}) {
  return workflowRuntimeDefinitions.find((definition) => {
    return definition.workflowId === workflowId;
  }) ?? null;
}

function buildNoRequestResolution(reason) {
  return assertBrainWorkflowRequestResolution({
    kind: 'brain_workflow_request_resolution',
    version: 1,
    status: 'no_request',
    requestedWorkflowId: null,
    workflowRequest: null,
    workflowRuntimeDefinition: null,
    executionAllowed: false,
    autoExecutionPerformed: false,
    runtimeAction: 'none',
    reason,
    warnings: [],
  });
}

function buildInvalidResolution(parseResult) {
  return assertBrainWorkflowRequestResolution({
    kind: 'brain_workflow_request_resolution',
    version: 1,
    status: 'invalid',
    requestedWorkflowId: null,
    workflowRequest: null,
    workflowRuntimeDefinition: null,
    executionAllowed: false,
    autoExecutionPerformed: false,
    runtimeAction: 'reject',
    reason: parseResult.reason,
    warnings: parseResult.warnings,
  });
}

function buildDeniedResolution({
  workflowRequest,
  reason,
  warnings = [],
}) {
  return assertBrainWorkflowRequestResolution({
    kind: 'brain_workflow_request_resolution',
    version: 1,
    status: 'denied',
    requestedWorkflowId: workflowRequest.workflowId,
    workflowRequest,
    workflowRuntimeDefinition: null,
    executionAllowed: false,
    autoExecutionPerformed: false,
    runtimeAction: 'reject',
    reason,
    warnings,
  });
}

function buildAcceptedResolution({
  workflowRequest,
  workflowRuntimeDefinition,
}) {
  return assertBrainWorkflowRequestResolution({
    kind: 'brain_workflow_request_resolution',
    version: 1,
    status: 'accepted',
    requestedWorkflowId: workflowRequest.workflowId,
    workflowRequest,
    workflowRuntimeDefinition,
    executionAllowed: true,
    autoExecutionPerformed: false,
    runtimeAction: 'queue_for_execution',
    reason: `Brain workflow request for ${workflowRequest.workflowId} was accepted for runtime execution.`,
    warnings: [],
  });
}

function resolveParsedWorkflowRequest({
  workflowRequest,
  workflowRuntimeDefinitions,
}) {
  if (workflowRequest.expectedSideEffectLevel !== 'read_only') {
    return buildDeniedResolution({
      workflowRequest,
      reason: `Brain workflow request expectedSideEffectLevel must be "read_only" for automatic execution in this slice: ${workflowRequest.expectedSideEffectLevel}.`,
    });
  }

  const workflowRuntimeDefinition = findWorkflowRuntimeDefinition({
    workflowRuntimeDefinitions,
    workflowId: workflowRequest.workflowId,
  });

  if (!workflowRuntimeDefinition) {
    return buildDeniedResolution({
      workflowRequest,
      reason: `Workflow ${workflowRequest.workflowId} was not evaluated as available for this invocation.`,
    });
  }

  if (workflowRuntimeDefinition.lifecycleState !== 'active') {
    return buildDeniedResolution({
      workflowRequest,
      reason: `Workflow ${workflowRequest.workflowId} is not active: ${workflowRuntimeDefinition.lifecycleState}.`,
    });
  }

  if (workflowRuntimeDefinition.executionMode !== 'on_demand') {
    return buildDeniedResolution({
      workflowRequest,
      reason: `Workflow ${workflowRequest.workflowId} cannot be executed from a brain request because executionMode is ${workflowRuntimeDefinition.executionMode}.`,
    });
  }

  return buildAcceptedResolution({
    workflowRequest,
    workflowRuntimeDefinition,
  });
}

export function resolveBrainWorkflowRequestForInvocation({
  brainOutput,
  workflowRuntimeDefinitions = [],
} = {}) {
  const normalizedBrainOutput = assertBrainOutput(brainOutput);
  const normalizedWorkflowRuntimeDefinitions = normalizeWorkflowRuntimeDefinitions(workflowRuntimeDefinitions);

  if (normalizedBrainOutput.status !== 'completed') {
    return buildNoRequestResolution('Brain output did not complete, so no workflow request was evaluated.');
  }

  const parseResult = parseBrainWorkflowRequestEnvelopeFromText({
    outputText: normalizedBrainOutput.outputText,
  });

  if (parseResult.status === 'no_request') {
    return buildNoRequestResolution(parseResult.reason);
  }

  if (parseResult.status === 'invalid') {
    return buildInvalidResolution(parseResult);
  }

  return resolveParsedWorkflowRequest({
    workflowRequest: parseResult.workflowRequest,
    workflowRuntimeDefinitions: normalizedWorkflowRuntimeDefinitions,
  });
}
