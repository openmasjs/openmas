import { TOOL_SIDE_EFFECT_LEVELS } from '../tools/tool-definition-contract.js';
import { assertWorkflowRuntimeDefinition } from '../workflows/workflow-runtime-contract.js';

const BRAIN_WORKFLOW_REQUEST_RESOLUTION_STATUSES = new Set([
  'no_request',
  'accepted',
  'denied',
  'invalid',
]);

const BRAIN_WORKFLOW_REQUEST_RUNTIME_ACTIONS = new Set([
  'none',
  'queue_for_execution',
  'reject',
]);

const SAFE_REQUEST_ID_PATTERN = /^[a-zA-Z0-9._-]+$/u;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function assertEnumValue(value, allowedValues, description) {
  if (!isNonEmptyString(value)) {
    throw new Error(`${description} must be a non-empty string.`);
  }

  const normalizedValue = value.trim();

  if (!allowedValues.has(normalizedValue)) {
    throw new Error(`${description} is invalid: ${normalizedValue}`);
  }

  return normalizedValue;
}

function assertStringArray(values, description) {
  if (!Array.isArray(values)) {
    throw new Error(`${description} must be an array.`);
  }

  return values.map((value, index) => {
    if (!isNonEmptyString(value)) {
      throw new Error(`${description}[${index}] must be a non-empty string.`);
    }

    return value.trim();
  });
}

function assertSafeRequestId(value, description) {
  if (!isNonEmptyString(value)) {
    throw new Error(`${description} must be a non-empty string.`);
  }

  const normalizedValue = value.trim();

  if (!SAFE_REQUEST_ID_PATTERN.test(normalizedValue)) {
    throw new Error(`${description} contains unsafe characters: ${normalizedValue}`);
  }

  return normalizedValue;
}

function assertNullableBrainWorkflowRequestEnvelope(workflowRequest, status) {
  if (workflowRequest === undefined || workflowRequest === null) {
    if (status === 'accepted' || status === 'denied') {
      throw new Error(`Brain workflow request resolution with status "${status}" must include workflowRequest.`);
    }

    return null;
  }

  if (status === 'no_request' || status === 'invalid') {
    throw new Error(`Brain workflow request resolution with status "${status}" must not include workflowRequest.`);
  }

  return assertBrainWorkflowRequestEnvelope(workflowRequest);
}

function assertNullableWorkflowRuntimeDefinition(workflowRuntimeDefinition, status) {
  if (workflowRuntimeDefinition === undefined || workflowRuntimeDefinition === null) {
    if (status === 'accepted') {
      throw new Error('Accepted brain workflow request resolution requires workflowRuntimeDefinition.');
    }

    return null;
  }

  if (status !== 'accepted') {
    throw new Error(`Brain workflow request resolution with status "${status}" must not include workflowRuntimeDefinition.`);
  }

  return assertWorkflowRuntimeDefinition(workflowRuntimeDefinition);
}

function assertResolutionConsistency(resolution) {
  if (resolution.status === 'accepted') {
    if (!resolution.workflowRequest || !resolution.workflowRuntimeDefinition) {
      throw new Error('Accepted brain workflow request resolution requires workflowRequest and workflowRuntimeDefinition.');
    }

    if (!resolution.executionAllowed || resolution.runtimeAction !== 'queue_for_execution') {
      throw new Error('Accepted brain workflow request resolution must be executionAllowed with queue_for_execution.');
    }
  }

  if (resolution.status === 'denied' || resolution.status === 'invalid') {
    if (resolution.autoExecutionPerformed !== false) {
      throw new Error(`${resolution.status} brain workflow request resolution must not auto-execute workflows.`);
    }

    if (resolution.executionAllowed || resolution.runtimeAction !== 'reject') {
      throw new Error(`${resolution.status} brain workflow request resolution must reject without execution permission.`);
    }
  }

  if (resolution.status === 'no_request') {
    if (resolution.autoExecutionPerformed !== false) {
      throw new Error('No-request brain workflow request resolution must not auto-execute workflows.');
    }

    if (resolution.executionAllowed || resolution.runtimeAction !== 'none') {
      throw new Error('No-request brain workflow request resolution must have no runtime action.');
    }
  }
}

export function assertBrainWorkflowRequestEnvelope(envelope) {
  if (!isPlainObject(envelope)) {
    throw new Error('Brain workflow request envelope must be an object.');
  }

  if (envelope.kind !== 'brain_workflow_request') {
    throw new Error('Brain workflow request envelope must include kind "brain_workflow_request".');
  }

  if (envelope.version !== 1) {
    throw new Error('Brain workflow request envelope version must be 1.');
  }

  if (!isNonEmptyString(envelope.workflowId)) {
    throw new Error('Brain workflow request envelope must include a non-empty workflowId.');
  }

  if (!isPlainObject(envelope.input)) {
    throw new Error('Brain workflow request envelope input must be an object.');
  }

  if (!isNonEmptyString(envelope.purpose)) {
    throw new Error('Brain workflow request envelope must include a non-empty purpose.');
  }

  return {
    kind: 'brain_workflow_request',
    version: 1,
    workflowRequestId: assertSafeRequestId(
      envelope.workflowRequestId,
      'Brain workflow request envelope workflowRequestId',
    ),
    workflowId: envelope.workflowId.trim(),
    input: { ...envelope.input },
    purpose: envelope.purpose.trim(),
    expectedSideEffectLevel: assertEnumValue(
      envelope.expectedSideEffectLevel,
      TOOL_SIDE_EFFECT_LEVELS,
      'Brain workflow request envelope expectedSideEffectLevel',
    ),
  };
}

export function assertBrainWorkflowRequestResolution(resolution) {
  if (!isPlainObject(resolution)) {
    throw new Error('Brain workflow request resolution must be an object.');
  }

  if (resolution.kind !== 'brain_workflow_request_resolution') {
    throw new Error('Brain workflow request resolution must include kind "brain_workflow_request_resolution".');
  }

  if (resolution.version !== 1) {
    throw new Error('Brain workflow request resolution version must be 1.');
  }

  const status = assertEnumValue(
    resolution.status,
    BRAIN_WORKFLOW_REQUEST_RESOLUTION_STATUSES,
    'Brain workflow request resolution status',
  );
  const runtimeAction = assertEnumValue(
    resolution.runtimeAction,
    BRAIN_WORKFLOW_REQUEST_RUNTIME_ACTIONS,
    'Brain workflow request resolution runtimeAction',
  );

  if (!isNonEmptyString(resolution.reason)) {
    throw new Error('Brain workflow request resolution must include a non-empty reason.');
  }

  if (typeof resolution.executionAllowed !== 'boolean') {
    throw new Error('Brain workflow request resolution executionAllowed must be a boolean.');
  }

  if (typeof resolution.autoExecutionPerformed !== 'boolean') {
    throw new Error('Brain workflow request resolution autoExecutionPerformed must be a boolean.');
  }

  const normalizedResolution = {
    kind: 'brain_workflow_request_resolution',
    version: 1,
    status,
    requestedWorkflowId: isNonEmptyString(resolution.requestedWorkflowId)
      ? resolution.requestedWorkflowId.trim()
      : null,
    workflowRequest: assertNullableBrainWorkflowRequestEnvelope(resolution.workflowRequest, status),
    workflowRuntimeDefinition: assertNullableWorkflowRuntimeDefinition(
      resolution.workflowRuntimeDefinition,
      status,
    ),
    executionAllowed: resolution.executionAllowed,
    autoExecutionPerformed: resolution.autoExecutionPerformed,
    runtimeAction,
    reason: resolution.reason.trim(),
    warnings: assertStringArray(
      resolution.warnings ?? [],
      'Brain workflow request resolution warnings',
    ),
  };

  assertResolutionConsistency(normalizedResolution);

  return normalizedResolution;
}

export {
  BRAIN_WORKFLOW_REQUEST_RESOLUTION_STATUSES,
  BRAIN_WORKFLOW_REQUEST_RUNTIME_ACTIONS,
};
