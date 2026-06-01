import { TOOL_SIDE_EFFECT_LEVELS } from '../tools/tool-definition-contract.js';
import { assertActionIntentMetadata } from '../actions/action-intent-metadata-contract.js';

const WORKFLOW_RUNTIME_LIFECYCLE_STATES = new Set([
  'draft',
  'active',
  'disabled',
  'deprecated',
  'archived',
]);

const WORKFLOW_EXECUTION_MODES = new Set([
  'on_demand',
  'manual',
  'scheduled',
  'event_triggered',
]);

const WORKFLOW_STEP_TYPES = new Set([
  'tool_call',
  'agent_brain',
  'human_approval',
  'memory_writeback_candidate',
  'artifact_write',
  'condition',
  'wait',
  'handoff',
]);

const WORKFLOW_STEP_FAILURE_POLICIES = new Set([
  'fail_workflow',
  'pause_workflow',
  'skip_step',
  'continue',
]);

const SAFE_WORKFLOW_ID_PATTERN = /^[a-zA-Z0-9._-]+$/u;

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

function assertSafeIdentifier(value, description) {
  if (!isNonEmptyString(value)) {
    throw new Error(`${description} must be a non-empty string.`);
  }

  const normalizedValue = value.trim();

  if (!SAFE_WORKFLOW_ID_PATTERN.test(normalizedValue)) {
    throw new Error(`${description} contains unsafe characters: ${normalizedValue}`);
  }

  return normalizedValue;
}

function assertStringArray(values, description, { allowEmpty = true, allowedValues = null } = {}) {
  if (!Array.isArray(values)) {
    throw new Error(`${description} must be an array.`);
  }

  if (!allowEmpty && values.length === 0) {
    throw new Error(`${description} must include at least one value.`);
  }

  const seenValues = new Set();

  return values.map((value, index) => {
    if (!isNonEmptyString(value)) {
      throw new Error(`${description}[${index}] must be a non-empty string.`);
    }

    const normalizedValue = value.trim();

    if (allowedValues && !allowedValues.has(normalizedValue)) {
      throw new Error(`${description}[${index}] is invalid: ${normalizedValue}`);
    }

    if (seenValues.has(normalizedValue)) {
      throw new Error(`${description} contains a duplicated value: ${normalizedValue}`);
    }

    seenValues.add(normalizedValue);
    return normalizedValue;
  });
}

function assertOptionalBoolean(value, description, defaultValue) {
  if (value === undefined || value === null) {
    return defaultValue;
  }

  if (typeof value !== 'boolean') {
    throw new Error(`${description} must be a boolean when provided.`);
  }

  return value;
}

function assertOptionalPlainObject(value, description) {
  if (value === undefined || value === null) {
    return {};
  }

  if (!isPlainObject(value)) {
    throw new Error(`${description} must be an object when provided.`);
  }

  return { ...value };
}

function assertStatePolicy(statePolicy) {
  if (statePolicy === undefined || statePolicy === null) {
    return {
      persistState: true,
      resumeAllowed: false,
    };
  }

  if (!isPlainObject(statePolicy)) {
    throw new Error('Workflow runtime definition statePolicy must be an object when provided.');
  }

  return {
    persistState: assertOptionalBoolean(
      statePolicy.persistState,
      'Workflow runtime definition statePolicy.persistState',
      true,
    ),
    resumeAllowed: assertOptionalBoolean(
      statePolicy.resumeAllowed,
      'Workflow runtime definition statePolicy.resumeAllowed',
      false,
    ),
  };
}

function assertApprovalPolicy(approvalPolicy) {
  if (approvalPolicy === undefined || approvalPolicy === null) {
    return {
      defaultRequiredForSideEffectLevels: [],
    };
  }

  if (!isPlainObject(approvalPolicy)) {
    throw new Error('Workflow runtime definition approvalPolicy must be an object when provided.');
  }

  return {
    defaultRequiredForSideEffectLevels: assertStringArray(
      approvalPolicy.defaultRequiredForSideEffectLevels ?? [],
      'Workflow runtime definition approvalPolicy.defaultRequiredForSideEffectLevels',
      { allowedValues: TOOL_SIDE_EFFECT_LEVELS },
    ),
  };
}

function assertArtifactPolicy(artifactPolicy) {
  if (artifactPolicy === undefined || artifactPolicy === null) {
    return {
      persistFinalReport: false,
    };
  }

  if (!isPlainObject(artifactPolicy)) {
    throw new Error('Workflow runtime definition artifactPolicy must be an object when provided.');
  }

  return {
    persistFinalReport: assertOptionalBoolean(
      artifactPolicy.persistFinalReport,
      'Workflow runtime definition artifactPolicy.persistFinalReport',
      false,
    ),
  };
}

function assertMemoryPolicy(memoryPolicy) {
  if (memoryPolicy === undefined || memoryPolicy === null) {
    return {
      allowWritebackCandidates: false,
    };
  }

  if (!isPlainObject(memoryPolicy)) {
    throw new Error('Workflow runtime definition memoryPolicy must be an object when provided.');
  }

  return {
    allowWritebackCandidates: assertOptionalBoolean(
      memoryPolicy.allowWritebackCandidates,
      'Workflow runtime definition memoryPolicy.allowWritebackCandidates',
      false,
    ),
  };
}

function assertWorkflowStep(step, index) {
  const description = `Workflow runtime definition steps[${index}]`;

  if (!isPlainObject(step)) {
    throw new Error(`${description} must be an object.`);
  }

  if (!isNonEmptyString(step.stepId)) {
    throw new Error(`${description} must include a non-empty stepId.`);
  }

  const stepId = assertSafeIdentifier(step.stepId, `${description} stepId`);
  const stepType = assertEnumValue(step.stepType, WORKFLOW_STEP_TYPES, `${description} stepType`);

  if (stepType === 'tool_call' && !isNonEmptyString(step.toolId)) {
    throw new Error(`${description} with stepType "tool_call" must include a non-empty toolId.`);
  }

  return {
    stepId,
    stepType,
    toolId: isNonEmptyString(step.toolId) ? step.toolId.trim() : null,
    dependsOn: assertStringArray(step.dependsOn ?? [], `${description} dependsOn`),
    input: assertOptionalPlainObject(step.input, `${description} input`),
    onFailure: assertEnumValue(
      step.onFailure ?? 'fail_workflow',
      WORKFLOW_STEP_FAILURE_POLICIES,
      `${description} onFailure`,
    ),
  };
}

function assertWorkflowSteps(steps) {
  if (!Array.isArray(steps)) {
    throw new Error('Workflow runtime definition must include a steps array.');
  }

  if (steps.length === 0) {
    throw new Error('Workflow runtime definition steps must include at least one step.');
  }

  const seenStepIds = new Set();
  const normalizedSteps = steps.map((step, index) => {
    const normalizedStep = assertWorkflowStep(step, index);

    if (seenStepIds.has(normalizedStep.stepId)) {
      throw new Error(`Workflow runtime definition contains a duplicated stepId: ${normalizedStep.stepId}`);
    }

    seenStepIds.add(normalizedStep.stepId);
    return normalizedStep;
  });

  for (const step of normalizedSteps) {
    for (const dependencyStepId of step.dependsOn) {
      if (dependencyStepId === step.stepId) {
        throw new Error(`Workflow runtime definition step "${step.stepId}" must not depend on itself.`);
      }

      if (!seenStepIds.has(dependencyStepId)) {
        throw new Error(`Workflow runtime definition step "${step.stepId}" depends on unknown stepId: ${dependencyStepId}`);
      }
    }
  }

  assertNoDependencyCycles(normalizedSteps);

  return normalizedSteps;
}

function assertNoDependencyCycles(steps) {
  const stepsById = new Map(steps.map((step) => [step.stepId, step]));
  const visitingStepIds = new Set();
  const visitedStepIds = new Set();

  function visit(stepId, path = []) {
    if (visitedStepIds.has(stepId)) {
      return;
    }

    if (visitingStepIds.has(stepId)) {
      throw new Error(`Workflow runtime definition contains a dependency cycle: ${[...path, stepId].join(' -> ')}`);
    }

    visitingStepIds.add(stepId);

    for (const dependencyStepId of stepsById.get(stepId).dependsOn) {
      visit(dependencyStepId, [...path, stepId]);
    }

    visitingStepIds.delete(stepId);
    visitedStepIds.add(stepId);
  }

  for (const step of steps) {
    visit(step.stepId);
  }
}

export function assertWorkflowRuntimeDefinition(definition) {
  if (!isPlainObject(definition)) {
    throw new Error('Workflow runtime definition must be an object.');
  }

  if (definition.kind !== 'workflow_runtime_definition') {
    throw new Error('Workflow runtime definition must include kind "workflow_runtime_definition".');
  }

  if (!Number.isInteger(definition.version) || definition.version < 1) {
    throw new Error('Workflow runtime definition must include an integer version greater than or equal to 1.');
  }

  return {
    kind: definition.kind,
    version: definition.version,
    workflowId: assertSafeIdentifier(definition.workflowId, 'Workflow runtime definition workflowId'),
    lifecycleState: assertEnumValue(
      definition.lifecycleState,
      WORKFLOW_RUNTIME_LIFECYCLE_STATES,
      'Workflow runtime definition lifecycleState',
    ),
    executionMode: assertEnumValue(
      definition.executionMode,
      WORKFLOW_EXECUTION_MODES,
      'Workflow runtime definition executionMode',
    ),
    statePolicy: assertStatePolicy(definition.statePolicy),
    steps: assertWorkflowSteps(definition.steps),
    approvalPolicy: assertApprovalPolicy(definition.approvalPolicy),
    artifactPolicy: assertArtifactPolicy(definition.artifactPolicy),
    memoryPolicy: assertMemoryPolicy(definition.memoryPolicy),
    intentMetadata: assertActionIntentMetadata(definition.intentMetadata, {
      targetType: 'workflow',
      targetActionType: 'workflow_execution',
      targetId: definition.workflowId,
    }),
  };
}

export function isWorkflowRuntimeActive(definition) {
  return assertWorkflowRuntimeDefinition(definition).lifecycleState === 'active';
}

export {
  WORKFLOW_EXECUTION_MODES,
  WORKFLOW_RUNTIME_LIFECYCLE_STATES,
  WORKFLOW_STEP_FAILURE_POLICIES,
  WORKFLOW_STEP_TYPES,
};
