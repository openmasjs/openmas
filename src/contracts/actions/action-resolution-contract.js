import {
  ACTION_INTENT_SOURCES,
  assertActionCandidate,
  assertActionClarificationRequest,
  assertActionIntent,
} from './action-intent-contract.js';

const ACTION_RESOLUTION_STATUSES = new Set([
  'no_action',
  'plan_only',
  'accepted',
  'approval_required',
  'denied',
  'needs_clarification',
  'ambiguous',
  'no_capability',
]);

const ACTION_RUNTIME_ACTIONS = new Set([
  'none',
  'answer_only',
  'memory_recall',
  'queue_tool_request',
  'queue_workflow_request',
  'execute_command',
  'request_human_approval',
  'ask_clarification',
  'reject',
  'handoff',
  'queue_channel_delivery',
]);

const NO_EXECUTION_RUNTIME_ACTIONS = new Set([
  'none',
  'answer_only',
  'memory_recall',
]);

const EXECUTABLE_RUNTIME_ACTIONS = new Set([
  'answer_only',
  'memory_recall',
  'queue_tool_request',
  'queue_workflow_request',
  'execute_command',
  'handoff',
  'queue_channel_delivery',
]);

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

function assertOptionalMetadata(value, description) {
  if (value === undefined || value === null) {
    return {};
  }

  if (!isPlainObject(value)) {
    throw new Error(`${description} must be an object when provided.`);
  }

  return { ...value };
}

function assertOptionalBoolean(value, description) {
  if (typeof value !== 'boolean') {
    throw new Error(`${description} must be a boolean.`);
  }

  return value;
}

function assertNullableActionIntent(actionIntent) {
  if (actionIntent === undefined || actionIntent === null) {
    return null;
  }

  return assertActionIntent(actionIntent);
}

function assertNullableActionCandidate(candidate) {
  if (candidate === undefined || candidate === null) {
    return null;
  }

  return assertActionCandidate(candidate);
}

function assertNullableClarificationRequest(clarificationRequest) {
  if (clarificationRequest === undefined || clarificationRequest === null) {
    return null;
  }

  return assertActionClarificationRequest(clarificationRequest);
}

function assertAcceptedResolutionConsistency(resolution) {
  if (resolution.selectedCandidate === null) {
    throw new Error('Accepted action resolution requires selectedCandidate.');
  }

  if (!resolution.executionAllowed || resolution.approvalRequired) {
    throw new Error('Accepted action resolution must allow execution without approval requirement.');
  }

  if (!EXECUTABLE_RUNTIME_ACTIONS.has(resolution.runtimeAction)) {
    throw new Error('Accepted action resolution must use an executable runtimeAction.');
  }

  if (resolution.clarificationRequest !== null) {
    throw new Error('Accepted action resolution must not include clarificationRequest.');
  }

  if (
    resolution.selectedCandidate.targetType === 'tool'
    && resolution.runtimeAction !== 'queue_tool_request'
  ) {
    throw new Error('Accepted tool action resolution must use queue_tool_request runtimeAction.');
  }

  if (
    resolution.selectedCandidate.targetType === 'workflow'
    && resolution.runtimeAction !== 'queue_workflow_request'
  ) {
    throw new Error('Accepted workflow action resolution must use queue_workflow_request runtimeAction.');
  }

  if (
    resolution.selectedCandidate.targetType === 'channel'
    && resolution.runtimeAction !== 'queue_channel_delivery'
  ) {
    throw new Error('Accepted channel action resolution must use queue_channel_delivery runtimeAction.');
  }
}

function assertResolutionConsistency(resolution) {
  if (
    resolution.actionIntent?.selectedCandidateId
    && resolution.selectedCandidate !== null
    && resolution.actionIntent.selectedCandidateId !== resolution.selectedCandidate.candidateId
  ) {
    throw new Error('Action resolution selectedCandidate must match actionIntent selectedCandidateId.');
  }

  if (resolution.status === 'no_action') {
    if (resolution.selectedCandidate !== null || resolution.clarificationRequest !== null) {
      throw new Error('No-action action resolution must not include selectedCandidate or clarificationRequest.');
    }

    if (resolution.executionAllowed || resolution.approvalRequired) {
      throw new Error('No-action action resolution must not allow execution or require approval.');
    }

    if (!NO_EXECUTION_RUNTIME_ACTIONS.has(resolution.runtimeAction)) {
      throw new Error('No-action action resolution must use none, answer_only, or memory_recall runtimeAction.');
    }
  }

  if (resolution.status === 'accepted') {
    assertAcceptedResolutionConsistency(resolution);
  }

  if (resolution.status === 'plan_only') {
    if (resolution.selectedCandidate === null) {
      throw new Error('Plan-only action resolution requires selectedCandidate.');
    }

    if (resolution.executionAllowed || resolution.approvalRequired) {
      throw new Error('Plan-only action resolution must not allow execution or require approval for the current invocation.');
    }

    if (resolution.runtimeAction !== 'answer_only') {
      throw new Error('Plan-only action resolution must use answer_only runtimeAction.');
    }

    if (resolution.clarificationRequest !== null) {
      throw new Error('Plan-only action resolution must not include clarificationRequest.');
    }
  }

  if (resolution.status === 'approval_required') {
    if (resolution.selectedCandidate === null) {
      throw new Error('Approval-required action resolution requires selectedCandidate.');
    }

    if (resolution.executionAllowed || !resolution.approvalRequired) {
      throw new Error('Approval-required action resolution must not allow execution and must require approval.');
    }

    if (resolution.runtimeAction !== 'request_human_approval') {
      throw new Error('Approval-required action resolution must use request_human_approval runtimeAction.');
    }

    if (resolution.clarificationRequest !== null) {
      throw new Error('Approval-required action resolution must not include clarificationRequest.');
    }
  }

  if (resolution.status === 'denied') {
    if (resolution.executionAllowed || resolution.approvalRequired) {
      throw new Error('Denied action resolution must not allow execution or require approval.');
    }

    if (resolution.runtimeAction !== 'reject') {
      throw new Error('Denied action resolution must reject execution.');
    }
  }

  if (resolution.status === 'needs_clarification' || resolution.status === 'ambiguous') {
    if (resolution.selectedCandidate !== null) {
      throw new Error(`${resolution.status} action resolution must not include selectedCandidate.`);
    }

    if (resolution.clarificationRequest === null) {
      throw new Error(`${resolution.status} action resolution requires clarificationRequest.`);
    }

    if (resolution.executionAllowed || resolution.approvalRequired || resolution.runtimeAction !== 'ask_clarification') {
      throw new Error(`${resolution.status} action resolution must ask clarification without execution or approval.`);
    }
  }

  if (resolution.status === 'no_capability') {
    if (resolution.selectedCandidate !== null || resolution.clarificationRequest !== null) {
      throw new Error('No-capability action resolution must not include selectedCandidate or clarificationRequest.');
    }

    if (resolution.executionAllowed || resolution.approvalRequired || resolution.runtimeAction !== 'none') {
      throw new Error('No-capability action resolution must not execute or request approval.');
    }
  }
}

export function assertActionResolution(resolution) {
  if (!isPlainObject(resolution)) {
    throw new Error('Action resolution must be an object.');
  }

  if (resolution.kind !== 'action_resolution') {
    throw new Error('Action resolution must include kind "action_resolution".');
  }

  if (resolution.version !== 1) {
    throw new Error('Action resolution version must be 1.');
  }

  if (!isNonEmptyString(resolution.reason)) {
    throw new Error('Action resolution reason must be a non-empty string.');
  }

  const normalizedResolution = {
    kind: 'action_resolution',
    version: 1,
    status: assertEnumValue(
      resolution.status,
      ACTION_RESOLUTION_STATUSES,
      'Action resolution status',
    ),
    source: assertEnumValue(
      resolution.source,
      ACTION_INTENT_SOURCES,
      'Action resolution source',
    ),
    runtimeAction: assertEnumValue(
      resolution.runtimeAction,
      ACTION_RUNTIME_ACTIONS,
      'Action resolution runtimeAction',
    ),
    actionIntent: assertNullableActionIntent(resolution.actionIntent),
    selectedCandidate: assertNullableActionCandidate(resolution.selectedCandidate),
    clarificationRequest: assertNullableClarificationRequest(resolution.clarificationRequest),
    executionAllowed: assertOptionalBoolean(
      resolution.executionAllowed,
      'Action resolution executionAllowed',
    ),
    approvalRequired: assertOptionalBoolean(
      resolution.approvalRequired,
      'Action resolution approvalRequired',
    ),
    reason: resolution.reason.trim(),
    evidence: assertStringArray(resolution.evidence ?? [], 'Action resolution evidence'),
    decisionTrace: assertStringArray(resolution.decisionTrace ?? [], 'Action resolution decisionTrace'),
    warnings: assertStringArray(resolution.warnings ?? [], 'Action resolution warnings'),
    metadata: assertOptionalMetadata(resolution.metadata, 'Action resolution metadata'),
  };

  assertResolutionConsistency(normalizedResolution);

  return normalizedResolution;
}

export {
  ACTION_RESOLUTION_STATUSES,
  ACTION_RUNTIME_ACTIONS,
};
