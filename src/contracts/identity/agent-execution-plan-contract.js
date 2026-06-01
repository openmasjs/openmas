import { assertActionClarificationRequest } from '../actions/action-intent-contract.js';

export const AGENT_EXECUTION_PLAN_STEP_TYPES = [
  'analysis',
  'tool_execution',
  'workflow_execution',
  'request_approval',
  'verification',
  'summarize',
  'clarification',
];

export const AGENT_EXECUTION_PLAN_TARGET_TYPES = [
  'tool',
  'workflow',
  'memory',
  'approval',
];

export const AGENT_EXECUTION_PLAN_MEMORY_SOURCE_TYPES = [
  'memory_record',
  'durable_memory_record',
  'knowledge_document',
  'policy_document',
  'conversation_context',
  'runtime_state',
  'runtime_artifact',
];

export const AGENT_EXECUTION_PLAN_MEMORY_SCOPES = [
  'mas_instance',
  'operational_identity',
  'cognitive_identity',
  'conversation',
];

export const AGENT_EXECUTION_PLAN_MEMORY_REQUIREMENT_LEVELS = [
  'required',
  'preferred',
];

export const AGENT_EXECUTION_PLAN_APPROVAL_TYPES = [
  'human_approval',
];

export const AGENT_EXECUTION_PLAN_RISK_LEVELS = [
  'low',
  'medium',
  'high',
];

export const AGENT_EXECUTION_PLAN_VERIFICATION_EVIDENCE_TYPES = [
  'tool_observation',
  'workflow_observation',
  'approval_state',
  'brain_output',
  'human_confirmation',
  'memory_writeback_review',
];

const STEP_TYPE_SET = new Set(AGENT_EXECUTION_PLAN_STEP_TYPES);
const TARGET_TYPE_SET = new Set(AGENT_EXECUTION_PLAN_TARGET_TYPES);
const MEMORY_SOURCE_TYPE_SET = new Set(AGENT_EXECUTION_PLAN_MEMORY_SOURCE_TYPES);
const MEMORY_SCOPE_SET = new Set(AGENT_EXECUTION_PLAN_MEMORY_SCOPES);
const MEMORY_REQUIREMENT_LEVEL_SET = new Set(AGENT_EXECUTION_PLAN_MEMORY_REQUIREMENT_LEVELS);
const APPROVAL_TYPE_SET = new Set(AGENT_EXECUTION_PLAN_APPROVAL_TYPES);
const RISK_LEVEL_SET = new Set(AGENT_EXECUTION_PLAN_RISK_LEVELS);
const VERIFICATION_EVIDENCE_TYPE_SET = new Set(AGENT_EXECUTION_PLAN_VERIFICATION_EVIDENCE_TYPES);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeStringArray(values, description) {
  if (!Array.isArray(values)) {
    throw new Error(`${description} must be an array.`);
  }

  const normalizedValues = values.map((value) => {
    if (!isNonEmptyString(value)) {
      throw new Error(`${description} must contain only non-empty strings.`);
    }

    return value.trim();
  });

  const uniqueValues = new Set(normalizedValues);

  if (uniqueValues.size !== normalizedValues.length) {
    throw new Error(`${description} must not contain duplicates.`);
  }

  return normalizedValues;
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

function assertNullableNonEmptyString(value, description) {
  if (value === null || value === undefined) {
    return null;
  }

  if (!isNonEmptyString(value)) {
    throw new Error(`${description} must be null or a non-empty string.`);
  }

  return value.trim();
}

function assertSetMembership(value, allowedValues, description) {
  if (!allowedValues.has(value)) {
    throw new Error(`${description} contains an invalid value: ${value}`);
  }
}

function assertOptionalMetadata(metadata, description) {
  if (metadata === undefined || metadata === null) {
    return null;
  }

  if (!isPlainObject(metadata)) {
    throw new Error(`${description} must be a plain object when provided.`);
  }

  return metadata;
}

function buildAllowedIdentifierSet(values) {
  if (values === null || values === undefined) {
    return null;
  }

  return new Set(normalizeStringArray(values, 'Allowed identifier list'));
}

function assertReferencedIdentifier(identifier, allowedIdentifiers, description) {
  if (allowedIdentifiers && !allowedIdentifiers.has(identifier)) {
    throw new Error(`${description} references an unknown affordance identifier: ${identifier}`);
  }
}

export function assertAgentExecutionPlanStep(step, {
  requiredToolIds = new Set(),
  requiredWorkflowIds = new Set(),
  knownToolIds = null,
  knownWorkflowIds = null,
} = {}) {
  const allowedKeys = new Set([
    'kind',
    'version',
    'stepId',
    'title',
    'description',
    'stepType',
    'targetType',
    'targetId',
    'dependsOnStepIds',
    'completionCriteria',
    'reason',
    'metadata',
  ]);

  assertOnlyAllowedKeys(step, allowedKeys, 'Agent execution plan step');

  if (step.kind !== 'agent_execution_plan_step') {
    throw new Error(`Agent execution plan step kind must be "agent_execution_plan_step"; received ${step.kind}`);
  }

  if (step.version !== 1) {
    throw new Error(`Agent execution plan step version must be 1; received ${step.version}`);
  }

  const stepId = assertNullableNonEmptyString(step.stepId, 'Agent execution plan stepId');
  const title = assertNullableNonEmptyString(step.title, 'Agent execution plan step title');
  const description = assertNullableNonEmptyString(step.description, 'Agent execution plan step description');
  const reason = assertNullableNonEmptyString(step.reason, 'Agent execution plan step reason');

  if (stepId === null || title === null || description === null || reason === null) {
    throw new Error('Agent execution plan step must include non-empty stepId, title, description, and reason.');
  }

  assertSetMembership(step.stepType, STEP_TYPE_SET, 'Agent execution plan stepType');

  const targetType = assertNullableNonEmptyString(step.targetType, 'Agent execution plan targetType');
  const targetId = assertNullableNonEmptyString(step.targetId, 'Agent execution plan targetId');

  if (targetType !== null) {
    assertSetMembership(targetType, TARGET_TYPE_SET, 'Agent execution plan targetType');
  }

  if ((targetType === null) !== (targetId === null)) {
    throw new Error('Agent execution plan step targetType and targetId must either both be set or both be null.');
  }

  if (step.stepType === 'tool_execution') {
    if (targetType !== 'tool' || targetId === null) {
      throw new Error('Tool execution plan steps must target a known tool.');
    }

    if (!requiredToolIds.has(targetId)) {
      throw new Error(`Tool execution plan step references tool ${targetId}, but it is not declared in requiredTools.`);
    }

    assertReferencedIdentifier(targetId, knownToolIds, 'Agent execution plan step');
  }

  if (step.stepType === 'workflow_execution') {
    if (targetType !== 'workflow' || targetId === null) {
      throw new Error('Workflow execution plan steps must target a known workflow.');
    }

    if (!requiredWorkflowIds.has(targetId)) {
      throw new Error(`Workflow execution plan step references workflow ${targetId}, but it is not declared in requiredWorkflows.`);
    }

    assertReferencedIdentifier(targetId, knownWorkflowIds, 'Agent execution plan step');
  }

  if (step.stepType === 'clarification' && (targetType !== null || targetId !== null)) {
    throw new Error('Clarification plan steps must not target a tool or workflow directly.');
  }

  const dependsOnStepIds = normalizeStringArray(
    step.dependsOnStepIds ?? [],
    'Agent execution plan step dependsOnStepIds',
  );
  const completionCriteria = normalizeStringArray(
    step.completionCriteria ?? [],
    'Agent execution plan step completionCriteria',
  );

  if (completionCriteria.length === 0) {
    throw new Error('Agent execution plan step must include at least one completion criterion.');
  }

  return {
    ...step,
    stepId,
    title,
    description,
    reason,
    targetType,
    targetId,
    dependsOnStepIds,
    completionCriteria,
    ...(step.metadata !== undefined ? { metadata: assertOptionalMetadata(step.metadata, 'Agent execution plan step metadata') } : {}),
  };
}

export function assertAgentExecutionPlanMemoryRequirement(memoryRequirement) {
  const allowedKeys = new Set([
    'kind',
    'version',
    'requirementId',
    'sourceType',
    'sourceId',
    'scope',
    'requirementLevel',
    'reason',
    'metadata',
  ]);

  assertOnlyAllowedKeys(memoryRequirement, allowedKeys, 'Agent execution plan memory requirement');

  if (memoryRequirement.kind !== 'agent_execution_plan_memory_requirement') {
    throw new Error(`Agent execution plan memory requirement kind must be "agent_execution_plan_memory_requirement"; received ${memoryRequirement.kind}`);
  }

  if (memoryRequirement.version !== 1) {
    throw new Error(`Agent execution plan memory requirement version must be 1; received ${memoryRequirement.version}`);
  }

  const requirementId = assertNullableNonEmptyString(memoryRequirement.requirementId, 'Agent execution plan memory requirementId');
  const sourceId = assertNullableNonEmptyString(memoryRequirement.sourceId, 'Agent execution plan memory sourceId');
  const reason = assertNullableNonEmptyString(memoryRequirement.reason, 'Agent execution plan memory reason');

  if (requirementId === null || sourceId === null || reason === null) {
    throw new Error('Agent execution plan memory requirement must include non-empty requirementId, sourceId, and reason.');
  }

  assertSetMembership(memoryRequirement.sourceType, MEMORY_SOURCE_TYPE_SET, 'Agent execution plan memory sourceType');
  assertSetMembership(memoryRequirement.scope, MEMORY_SCOPE_SET, 'Agent execution plan memory scope');
  assertSetMembership(memoryRequirement.requirementLevel, MEMORY_REQUIREMENT_LEVEL_SET, 'Agent execution plan memory requirementLevel');

  return {
    ...memoryRequirement,
    requirementId,
    sourceId,
    reason,
    ...(memoryRequirement.metadata !== undefined ? { metadata: assertOptionalMetadata(memoryRequirement.metadata, 'Agent execution plan memory metadata') } : {}),
  };
}

export function assertAgentExecutionPlanApprovalRequirement(approvalRequirement) {
  const allowedKeys = new Set([
    'kind',
    'version',
    'approvalRequirementId',
    'approvalType',
    'targetType',
    'targetId',
    'reason',
    'metadata',
  ]);

  assertOnlyAllowedKeys(approvalRequirement, allowedKeys, 'Agent execution plan approval requirement');

  if (approvalRequirement.kind !== 'agent_execution_plan_approval_requirement') {
    throw new Error(`Agent execution plan approval requirement kind must be "agent_execution_plan_approval_requirement"; received ${approvalRequirement.kind}`);
  }

  if (approvalRequirement.version !== 1) {
    throw new Error(`Agent execution plan approval requirement version must be 1; received ${approvalRequirement.version}`);
  }

  const approvalRequirementId = assertNullableNonEmptyString(approvalRequirement.approvalRequirementId, 'Agent execution plan approvalRequirementId');
  const targetType = assertNullableNonEmptyString(approvalRequirement.targetType, 'Agent execution plan approval targetType');
  const targetId = assertNullableNonEmptyString(approvalRequirement.targetId, 'Agent execution plan approval targetId');
  const reason = assertNullableNonEmptyString(approvalRequirement.reason, 'Agent execution plan approval reason');

  if (approvalRequirementId === null || targetType === null || targetId === null || reason === null) {
    throw new Error('Agent execution plan approval requirement must include non-empty approvalRequirementId, targetType, targetId, and reason.');
  }

  assertSetMembership(approvalRequirement.approvalType, APPROVAL_TYPE_SET, 'Agent execution plan approvalType');
  assertSetMembership(targetType, TARGET_TYPE_SET, 'Agent execution plan approval targetType');

  return {
    ...approvalRequirement,
    approvalRequirementId,
    targetType,
    targetId,
    reason,
    ...(approvalRequirement.metadata !== undefined ? { metadata: assertOptionalMetadata(approvalRequirement.metadata, 'Agent execution plan approval metadata') } : {}),
  };
}

export function assertAgentExecutionPlanRiskAssessment(riskAssessment) {
  const allowedKeys = new Set([
    'kind',
    'version',
    'overallRiskLevel',
    'summary',
    'riskItems',
    'metadata',
  ]);

  assertOnlyAllowedKeys(riskAssessment, allowedKeys, 'Agent execution plan risk assessment');

  if (riskAssessment.kind !== 'agent_execution_plan_risk_assessment') {
    throw new Error(`Agent execution plan risk assessment kind must be "agent_execution_plan_risk_assessment"; received ${riskAssessment.kind}`);
  }

  if (riskAssessment.version !== 1) {
    throw new Error(`Agent execution plan risk assessment version must be 1; received ${riskAssessment.version}`);
  }

  assertSetMembership(riskAssessment.overallRiskLevel, RISK_LEVEL_SET, 'Agent execution plan overallRiskLevel');

  const summary = assertNullableNonEmptyString(riskAssessment.summary, 'Agent execution plan risk summary');

  if (summary === null) {
    throw new Error('Agent execution plan risk assessment must include a non-empty summary.');
  }

  const riskItems = normalizeStringArray(riskAssessment.riskItems ?? [], 'Agent execution plan riskItems');

  return {
    ...riskAssessment,
    summary,
    riskItems,
    ...(riskAssessment.metadata !== undefined ? { metadata: assertOptionalMetadata(riskAssessment.metadata, 'Agent execution plan risk metadata') } : {}),
  };
}

export function assertAgentExecutionPlanVerificationCriterion(verificationCriterion, {
  requiredToolIds = new Set(),
  requiredWorkflowIds = new Set(),
  knownToolIds = null,
  knownWorkflowIds = null,
} = {}) {
  const allowedKeys = new Set([
    'kind',
    'version',
    'criterionId',
    'description',
    'evidenceTypes',
    'targetType',
    'targetId',
    'metadata',
  ]);

  assertOnlyAllowedKeys(verificationCriterion, allowedKeys, 'Agent execution plan verification criterion');

  if (verificationCriterion.kind !== 'agent_execution_plan_verification_criterion') {
    throw new Error(`Agent execution plan verification criterion kind must be "agent_execution_plan_verification_criterion"; received ${verificationCriterion.kind}`);
  }

  if (verificationCriterion.version !== 1) {
    throw new Error(`Agent execution plan verification criterion version must be 1; received ${verificationCriterion.version}`);
  }

  const criterionId = assertNullableNonEmptyString(verificationCriterion.criterionId, 'Agent execution plan verification criterionId');
  const description = assertNullableNonEmptyString(verificationCriterion.description, 'Agent execution plan verification description');
  const targetType = assertNullableNonEmptyString(verificationCriterion.targetType, 'Agent execution plan verification targetType');
  const targetId = assertNullableNonEmptyString(verificationCriterion.targetId, 'Agent execution plan verification targetId');

  if (criterionId === null || description === null) {
    throw new Error('Agent execution plan verification criterion must include non-empty criterionId and description.');
  }

  if ((targetType === null) !== (targetId === null)) {
    throw new Error('Agent execution plan verification targetType and targetId must either both be set or both be null.');
  }

  if (targetType !== null) {
    assertSetMembership(targetType, TARGET_TYPE_SET, 'Agent execution plan verification targetType');

    if (targetType === 'tool') {
      if (!requiredToolIds.has(targetId)) {
        throw new Error(`Verification criterion references tool ${targetId}, but it is not declared in requiredTools.`);
      }

      assertReferencedIdentifier(targetId, knownToolIds, 'Agent execution plan verification criterion');
    }

    if (targetType === 'workflow') {
      if (!requiredWorkflowIds.has(targetId)) {
        throw new Error(`Verification criterion references workflow ${targetId}, but it is not declared in requiredWorkflows.`);
      }

      assertReferencedIdentifier(targetId, knownWorkflowIds, 'Agent execution plan verification criterion');
    }
  }

  const evidenceTypes = normalizeStringArray(
    verificationCriterion.evidenceTypes ?? [],
    'Agent execution plan verification evidenceTypes',
  );

  if (evidenceTypes.length === 0) {
    throw new Error('Agent execution plan verification criterion must include at least one evidence type.');
  }

  for (const evidenceType of evidenceTypes) {
    assertSetMembership(evidenceType, VERIFICATION_EVIDENCE_TYPE_SET, 'Agent execution plan verification evidenceType');
  }

  return {
    ...verificationCriterion,
    criterionId,
    description,
    targetType,
    targetId,
    evidenceTypes,
    ...(verificationCriterion.metadata !== undefined ? { metadata: assertOptionalMetadata(verificationCriterion.metadata, 'Agent execution plan verification metadata') } : {}),
  };
}

export function assertAgentExecutionPlan(plan, {
  knownToolIds = null,
  knownWorkflowIds = null,
} = {}) {
  const allowedKeys = new Set([
    'kind',
    'version',
    'planId',
    'goal',
    'assumptions',
    'steps',
    'requiredTools',
    'requiredWorkflows',
    'requiredMemory',
    'requiredApprovals',
    'riskAssessment',
    'verificationCriteria',
    'clarificationRequest',
    'directExecutionAllowed',
    'metadata',
  ]);

  assertOnlyAllowedKeys(plan, allowedKeys, 'Agent execution plan');

  if (plan.kind !== 'agent_execution_plan') {
    throw new Error(`Agent execution plan kind must be "agent_execution_plan"; received ${plan.kind}`);
  }

  if (plan.version !== 1) {
    throw new Error(`Agent execution plan version must be 1; received ${plan.version}`);
  }

  const planId = assertNullableNonEmptyString(plan.planId, 'Agent execution planId');
  const goal = assertNullableNonEmptyString(plan.goal, 'Agent execution plan goal');

  if (planId === null || goal === null) {
    throw new Error('Agent execution plan must include non-empty planId and goal.');
  }

  if (plan.directExecutionAllowed !== false) {
    throw new Error('Agent execution plans cannot directly execute; directExecutionAllowed must be false.');
  }

  const assumptions = normalizeStringArray(plan.assumptions ?? [], 'Agent execution plan assumptions');
  const requiredTools = normalizeStringArray(plan.requiredTools ?? [], 'Agent execution plan requiredTools');
  const requiredWorkflows = normalizeStringArray(plan.requiredWorkflows ?? [], 'Agent execution plan requiredWorkflows');
  const knownToolIdSet = buildAllowedIdentifierSet(knownToolIds);
  const knownWorkflowIdSet = buildAllowedIdentifierSet(knownWorkflowIds);
  const requiredToolIdSet = new Set(requiredTools);
  const requiredWorkflowIdSet = new Set(requiredWorkflows);

  for (const toolId of requiredTools) {
    assertReferencedIdentifier(toolId, knownToolIdSet, 'Agent execution plan requiredTools');
  }

  for (const workflowId of requiredWorkflows) {
    assertReferencedIdentifier(workflowId, knownWorkflowIdSet, 'Agent execution plan requiredWorkflows');
  }

  if (!Array.isArray(plan.steps) || plan.steps.length === 0) {
    throw new Error('Agent execution plan must include at least one plan step.');
  }

  const normalizedSteps = plan.steps.map((step) => {
    return assertAgentExecutionPlanStep(step, {
      requiredToolIds: requiredToolIdSet,
      requiredWorkflowIds: requiredWorkflowIdSet,
      knownToolIds: knownToolIdSet,
      knownWorkflowIds: knownWorkflowIdSet,
    });
  });
  const stepIds = normalizedSteps.map((step) => step.stepId);
  const stepIdSet = new Set(stepIds);

  if (stepIdSet.size !== stepIds.length) {
    throw new Error('Agent execution plan steps must not contain duplicate stepIds.');
  }

  for (const step of normalizedSteps) {
    for (const dependencyStepId of step.dependsOnStepIds) {
      if (!stepIdSet.has(dependencyStepId)) {
        throw new Error(`Agent execution plan step ${step.stepId} depends on unknown step ${dependencyStepId}.`);
      }
    }
  }

  const normalizedMemoryRequirements = Array.isArray(plan.requiredMemory)
    ? plan.requiredMemory.map(assertAgentExecutionPlanMemoryRequirement)
    : (() => {
        throw new Error('Agent execution plan requiredMemory must be an array.');
      })();
  const normalizedApprovalRequirements = Array.isArray(plan.requiredApprovals)
    ? plan.requiredApprovals.map(assertAgentExecutionPlanApprovalRequirement)
    : (() => {
        throw new Error('Agent execution plan requiredApprovals must be an array.');
      })();
  const riskAssessment = assertAgentExecutionPlanRiskAssessment(plan.riskAssessment);
  const verificationCriteria = Array.isArray(plan.verificationCriteria)
    ? plan.verificationCriteria.map((verificationCriterion) => {
        return assertAgentExecutionPlanVerificationCriterion(verificationCriterion, {
          requiredToolIds: requiredToolIdSet,
          requiredWorkflowIds: requiredWorkflowIdSet,
          knownToolIds: knownToolIdSet,
          knownWorkflowIds: knownWorkflowIdSet,
        });
      })
    : (() => {
        throw new Error('Agent execution plan verificationCriteria must be an array.');
      })();

  if (verificationCriteria.length === 0) {
    throw new Error('Agent execution plan must include at least one verification criterion.');
  }

  const clarificationRequest = plan.clarificationRequest === null || plan.clarificationRequest === undefined
    ? null
    : assertActionClarificationRequest(plan.clarificationRequest);

  return {
    ...plan,
    planId,
    goal,
    assumptions,
    steps: normalizedSteps,
    requiredTools,
    requiredWorkflows,
    requiredMemory: normalizedMemoryRequirements,
    requiredApprovals: normalizedApprovalRequirements,
    riskAssessment,
    verificationCriteria,
    clarificationRequest,
    directExecutionAllowed: false,
    ...(plan.metadata !== undefined ? { metadata: assertOptionalMetadata(plan.metadata, 'Agent execution plan metadata') } : {}),
  };
}
