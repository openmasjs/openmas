import { TOOL_SIDE_EFFECT_LEVELS } from '../tools/tool-definition-contract.js';
import { assertToolReadinessVerdict } from '../tools/tool-readiness-contract.js';

const BRAIN_TOOL_REQUEST_RESOLUTION_STATUSES = new Set([
  'no_request',
  'accepted',
  'approval_required',
  'denied',
  'invalid',
]);

const BRAIN_TOOL_REQUEST_RUNTIME_ACTIONS = new Set([
  'none',
  'queue_for_execution',
  'request_human_approval',
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

function assertNullableToolReadinessVerdict(verdict, status) {
  if (verdict === undefined || verdict === null) {
    return null;
  }

  if (status === 'no_request' || status === 'invalid') {
    throw new Error(`Brain tool request resolution with status "${status}" must not include a toolReadinessVerdict.`);
  }

  return assertToolReadinessVerdict(verdict);
}

function assertNullableBrainToolRequestEnvelope(toolRequest, status) {
  if (toolRequest === undefined || toolRequest === null) {
    if (status === 'accepted' || status === 'approval_required' || status === 'denied') {
      throw new Error(`Brain tool request resolution with status "${status}" must include toolRequest.`);
    }

    return null;
  }

  if (status === 'no_request' || status === 'invalid') {
    throw new Error(`Brain tool request resolution with status "${status}" must not include toolRequest.`);
  }

  return assertBrainToolRequestEnvelope(toolRequest);
}

function assertResolutionConsistency(resolution) {
  if (resolution.status === 'accepted') {
    if (!resolution.toolRequest || !resolution.toolReadinessVerdict) {
      throw new Error('Accepted brain tool request resolution requires toolRequest and toolReadinessVerdict.');
    }

    if (resolution.toolReadinessVerdict.status !== 'ready') {
      throw new Error('Accepted brain tool request resolution requires a ready tool readiness verdict.');
    }

    if (!resolution.executionAllowed || resolution.approvalRequired || resolution.runtimeAction !== 'queue_for_execution') {
      throw new Error('Accepted brain tool request resolution must be executionAllowed without approval and queue_for_execution.');
    }
  }

  if (resolution.status === 'approval_required') {
    if (resolution.autoExecutionPerformed !== false) {
      throw new Error('Approval-required brain tool request resolution must not auto-execute tools.');
    }

    if (!resolution.toolRequest || !resolution.toolReadinessVerdict) {
      throw new Error('Approval-required brain tool request resolution requires toolRequest and toolReadinessVerdict.');
    }

    if (resolution.toolReadinessVerdict.status !== 'approval_required') {
      throw new Error('Approval-required brain tool request resolution requires an approval_required tool readiness verdict.');
    }

    if (resolution.executionAllowed || !resolution.approvalRequired || resolution.runtimeAction !== 'request_human_approval') {
      throw new Error('Approval-required brain tool request resolution must request human approval without execution permission.');
    }
  }

  if (resolution.status === 'denied') {
    if (resolution.autoExecutionPerformed !== false) {
      throw new Error('Denied brain tool request resolution must not auto-execute tools.');
    }

    if (resolution.executionAllowed || resolution.runtimeAction !== 'reject') {
      throw new Error('Denied brain tool request resolution must reject without execution permission.');
    }
  }

  if (resolution.status === 'invalid') {
    if (resolution.autoExecutionPerformed !== false) {
      throw new Error('Invalid brain tool request resolution must not auto-execute tools.');
    }

    if (resolution.executionAllowed || resolution.runtimeAction !== 'reject') {
      throw new Error('Invalid brain tool request resolution must reject without execution permission.');
    }
  }

  if (resolution.status === 'no_request') {
    if (resolution.autoExecutionPerformed !== false) {
      throw new Error('No-request brain tool request resolution must not auto-execute tools.');
    }

    if (resolution.executionAllowed || resolution.approvalRequired || resolution.runtimeAction !== 'none') {
      throw new Error('No-request brain tool request resolution must have no runtime action.');
    }
  }
}

export function assertBrainToolRequestEnvelope(envelope) {
  if (!isPlainObject(envelope)) {
    throw new Error('Brain tool request envelope must be an object.');
  }

  if (envelope.kind !== 'brain_tool_request') {
    throw new Error('Brain tool request envelope must include kind "brain_tool_request".');
  }

  if (envelope.version !== 1) {
    throw new Error('Brain tool request envelope version must be 1.');
  }

  if (!isNonEmptyString(envelope.toolId)) {
    throw new Error('Brain tool request envelope must include a non-empty toolId.');
  }

  if (!isPlainObject(envelope.input)) {
    throw new Error('Brain tool request envelope input must be an object.');
  }

  if (!isNonEmptyString(envelope.purpose)) {
    throw new Error('Brain tool request envelope must include a non-empty purpose.');
  }

  return {
    kind: 'brain_tool_request',
    version: 1,
    toolRequestId: assertSafeRequestId(envelope.toolRequestId, 'Brain tool request envelope toolRequestId'),
    toolId: envelope.toolId.trim(),
    input: { ...envelope.input },
    purpose: envelope.purpose.trim(),
    expectedSideEffectLevel: assertEnumValue(
      envelope.expectedSideEffectLevel,
      TOOL_SIDE_EFFECT_LEVELS,
      'Brain tool request envelope expectedSideEffectLevel',
    ),
  };
}

export function assertBrainToolRequestResolution(resolution) {
  if (!isPlainObject(resolution)) {
    throw new Error('Brain tool request resolution must be an object.');
  }

  if (resolution.kind !== 'brain_tool_request_resolution') {
    throw new Error('Brain tool request resolution must include kind "brain_tool_request_resolution".');
  }

  if (resolution.version !== 1) {
    throw new Error('Brain tool request resolution version must be 1.');
  }

  const status = assertEnumValue(
    resolution.status,
    BRAIN_TOOL_REQUEST_RESOLUTION_STATUSES,
    'Brain tool request resolution status',
  );
  const runtimeAction = assertEnumValue(
    resolution.runtimeAction,
    BRAIN_TOOL_REQUEST_RUNTIME_ACTIONS,
    'Brain tool request resolution runtimeAction',
  );

  if (!isNonEmptyString(resolution.reason)) {
    throw new Error('Brain tool request resolution must include a non-empty reason.');
  }

  if (typeof resolution.executionAllowed !== 'boolean') {
    throw new Error('Brain tool request resolution executionAllowed must be a boolean.');
  }

  if (typeof resolution.approvalRequired !== 'boolean') {
    throw new Error('Brain tool request resolution approvalRequired must be a boolean.');
  }

  if (typeof resolution.autoExecutionPerformed !== 'boolean') {
    throw new Error('Brain tool request resolution autoExecutionPerformed must be a boolean.');
  }

  const normalizedResolution = {
    kind: 'brain_tool_request_resolution',
    version: 1,
    status,
    requestedToolId: isNonEmptyString(resolution.requestedToolId) ? resolution.requestedToolId.trim() : null,
    toolRequest: assertNullableBrainToolRequestEnvelope(resolution.toolRequest, status),
    toolReadinessVerdict: assertNullableToolReadinessVerdict(resolution.toolReadinessVerdict, status),
    executionAllowed: resolution.executionAllowed,
    approvalRequired: resolution.approvalRequired,
    autoExecutionPerformed: resolution.autoExecutionPerformed,
    runtimeAction,
    reason: resolution.reason.trim(),
    warnings: assertStringArray(resolution.warnings ?? [], 'Brain tool request resolution warnings'),
  };

  assertResolutionConsistency(normalizedResolution);

  return normalizedResolution;
}

export {
  BRAIN_TOOL_REQUEST_RESOLUTION_STATUSES,
  BRAIN_TOOL_REQUEST_RUNTIME_ACTIONS,
};
