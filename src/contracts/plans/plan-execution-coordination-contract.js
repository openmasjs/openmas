import { AGENT_EXECUTION_PLAN_STEP_TYPES } from '../identity/agent-execution-plan-contract.js';
import { assertBrainToolRequestResolution } from '../brain/brain-tool-request-contract.js';
import { assertBrainWorkflowRequestResolution } from '../brain/brain-workflow-request-contract.js';

export const PLAN_EXECUTION_COORDINATION_STATUSES = [
  'ready',
  'approval_required',
  'blocked',
  'failed',
  'no_execution',
];

export const PLAN_EXECUTION_COORDINATION_RUNTIME_ACTIONS = [
  'none',
  'queue_tool_request',
  'queue_workflow_request',
  'pause_for_approval',
  'stop',
];

const STATUS_SET = new Set(PLAN_EXECUTION_COORDINATION_STATUSES);
const RUNTIME_ACTION_SET = new Set(PLAN_EXECUTION_COORDINATION_RUNTIME_ACTIONS);
const STEP_TYPE_SET = new Set(AGENT_EXECUTION_PLAN_STEP_TYPES);
const TARGET_TYPE_SET = new Set([
  'tool',
  'workflow',
  'approval',
]);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function assertOnlyAllowedKeys(value, allowedKeys, description) {
  if (!isPlainObject(value)) {
    throw new Error(`${description} must be a plain object.`);
  }

  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      throw new Error(`${description} contains an unsupported key: ${key}`);
    }
  }
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

function assertNullableString(value, description) {
  if (value === undefined || value === null) {
    return null;
  }

  if (!isNonEmptyString(value)) {
    throw new Error(`${description} must be null or a non-empty string.`);
  }

  return value.trim();
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

function assertNullableTargetType(value, description) {
  const normalizedValue = assertNullableString(value, description);

  if (normalizedValue !== null && !TARGET_TYPE_SET.has(normalizedValue)) {
    throw new Error(`${description} is invalid: ${normalizedValue}`);
  }

  return normalizedValue;
}

function assertNullableStepType(value, description) {
  const normalizedValue = assertNullableString(value, description);

  if (normalizedValue !== null && !STEP_TYPE_SET.has(normalizedValue)) {
    throw new Error(`${description} is invalid: ${normalizedValue}`);
  }

  return normalizedValue;
}

function assertOptionalMetadata(value, description) {
  if (value === undefined || value === null) {
    return null;
  }

  if (!isPlainObject(value)) {
    throw new Error(`${description} must be a plain object when provided.`);
  }

  return value;
}

export function assertPlanExecutionCoordination(coordination) {
  const allowedKeys = new Set([
    'kind',
    'version',
    'status',
    'runtimeAction',
    'selectedStepId',
    'selectedStepType',
    'selectedTargetType',
    'selectedTargetId',
    'executionAllowed',
    'executionBlocked',
    'approvalRequired',
    'approvalRequestId',
    'reason',
    'warnings',
    'evidence',
    'toolRequestResolution',
    'workflowRequestResolution',
    'metadata',
  ]);

  assertOnlyAllowedKeys(coordination, allowedKeys, 'Plan execution coordination');

  if (coordination.kind !== 'plan_execution_coordination') {
    throw new Error('Plan execution coordination kind must be "plan_execution_coordination".');
  }

  if (coordination.version !== 1) {
    throw new Error(`Plan execution coordination version must be 1; received ${coordination.version}`);
  }

  const status = assertEnumValue(
    coordination.status,
    STATUS_SET,
    'Plan execution coordination status',
  );
  const runtimeAction = assertEnumValue(
    coordination.runtimeAction,
    RUNTIME_ACTION_SET,
    'Plan execution coordination runtimeAction',
  );
  const selectedStepId = assertNullableString(
    coordination.selectedStepId,
    'Plan execution coordination selectedStepId',
  );
  const selectedStepType = assertNullableStepType(
    coordination.selectedStepType,
    'Plan execution coordination selectedStepType',
  );
  const selectedTargetType = assertNullableTargetType(
    coordination.selectedTargetType,
    'Plan execution coordination selectedTargetType',
  );
  const selectedTargetId = assertNullableString(
    coordination.selectedTargetId,
    'Plan execution coordination selectedTargetId',
  );
  const approvalRequestId = assertNullableString(
    coordination.approvalRequestId,
    'Plan execution coordination approvalRequestId',
  );
  const reason = assertNullableString(
    coordination.reason,
    'Plan execution coordination reason',
  );

  if (reason === null) {
    throw new Error('Plan execution coordination must include a non-empty reason.');
  }

  if (typeof coordination.executionAllowed !== 'boolean') {
    throw new Error('Plan execution coordination executionAllowed must be a boolean.');
  }

  if (typeof coordination.executionBlocked !== 'boolean') {
    throw new Error('Plan execution coordination executionBlocked must be a boolean.');
  }

  if (typeof coordination.approvalRequired !== 'boolean') {
    throw new Error('Plan execution coordination approvalRequired must be a boolean.');
  }

  if ((selectedStepId === null) !== (selectedStepType === null)) {
    throw new Error('Plan execution coordination selectedStepId and selectedStepType must either both be set or both be null.');
  }

  if ((selectedTargetType === null) !== (selectedTargetId === null)) {
    throw new Error('Plan execution coordination selectedTargetType and selectedTargetId must either both be set or both be null.');
  }

  const toolRequestResolution = coordination.toolRequestResolution === undefined || coordination.toolRequestResolution === null
    ? null
    : assertBrainToolRequestResolution(coordination.toolRequestResolution);
  const workflowRequestResolution = coordination.workflowRequestResolution === undefined || coordination.workflowRequestResolution === null
    ? null
    : assertBrainWorkflowRequestResolution(coordination.workflowRequestResolution);

  if (status === 'ready') {
    if (!coordination.executionAllowed || coordination.executionBlocked || coordination.approvalRequired) {
      throw new Error('Ready plan execution coordination must allow execution without an approval gate.');
    }

    if (runtimeAction === 'queue_tool_request') {
      if (selectedTargetType !== 'tool' || selectedStepType !== 'tool_execution') {
        throw new Error('Ready tool coordination must target a tool execution step.');
      }

      if (toolRequestResolution?.status !== 'accepted') {
        throw new Error('Ready tool coordination must include an accepted toolRequestResolution.');
      }
    } else if (runtimeAction === 'queue_workflow_request') {
      if (selectedTargetType !== 'workflow' || selectedStepType !== 'workflow_execution') {
        throw new Error('Ready workflow coordination must target a workflow execution step.');
      }

      if (workflowRequestResolution?.status !== 'accepted') {
        throw new Error('Ready workflow coordination must include an accepted workflowRequestResolution.');
      }
    } else {
      throw new Error(`Ready plan execution coordination must queue a tool or workflow request; received ${runtimeAction}.`);
    }
  }

  if (status === 'approval_required') {
    if (coordination.executionAllowed || !coordination.executionBlocked || !coordination.approvalRequired) {
      throw new Error('Approval-required plan execution coordination must block execution until approval is granted.');
    }

    if (runtimeAction !== 'pause_for_approval') {
      throw new Error('Approval-required plan execution coordination must pause for approval.');
    }
  }

  if (status === 'blocked' || status === 'failed') {
    if (coordination.executionAllowed || !coordination.executionBlocked) {
      throw new Error(`${status} plan execution coordination must block execution.`);
    }

    if (runtimeAction !== 'stop') {
      throw new Error(`${status} plan execution coordination must stop execution.`);
    }
  }

  if (status === 'no_execution') {
    if (coordination.executionAllowed || coordination.executionBlocked) {
      throw new Error('No-execution plan coordination must neither allow nor block runtime execution.');
    }

    if (runtimeAction !== 'none') {
      throw new Error('No-execution plan coordination must use runtimeAction "none".');
    }
  }

  return {
    ...coordination,
    status,
    runtimeAction,
    selectedStepId,
    selectedStepType,
    selectedTargetType,
    selectedTargetId,
    approvalRequestId,
    reason,
    warnings: assertStringArray(coordination.warnings ?? [], 'Plan execution coordination warnings'),
    evidence: assertStringArray(coordination.evidence ?? [], 'Plan execution coordination evidence'),
    toolRequestResolution,
    workflowRequestResolution,
    ...(coordination.metadata !== undefined
      ? { metadata: assertOptionalMetadata(coordination.metadata, 'Plan execution coordination metadata') }
      : {}),
  };
}
