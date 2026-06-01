import { assertAgentWorkCycleSummary } from '../identity/agent-work-cycle-contract.js';
import { assertAgentExecutionPlan } from '../identity/agent-execution-plan-contract.js';
import { assertPlanExecutionCoordination } from '../plans/plan-execution-coordination-contract.js';
import { assertVerificationGate } from '../actions/verification-gate-contract.js';

const AGENT_EXECUTION_STATUSES = new Set([
  'completed',
  'blocked',
  'failed',
]);

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isNullableNonEmptyString(value) {
  return value === null || value === undefined || isNonEmptyString(value);
}

export function assertAgentExecutionResult(result) {
  if (!result || typeof result !== 'object') {
    throw new Error('Agent execution result must be an object.');
  }

  if (!AGENT_EXECUTION_STATUSES.has(result.status)) {
    throw new Error(`Agent execution result contains an invalid status: ${result.status}`);
  }

  if (!isNonEmptyString(result.invocationId)) {
    throw new Error('Agent execution result must include a non-empty invocationId.');
  }

  if (Object.hasOwn(result, 'agentId')) {
    throw new Error('Agent execution result must not include agentId; use operationalIdentityId and primaryCognitiveIdentityId.');
  }

  if (!isNonEmptyString(result.operationalIdentityId)) {
    throw new Error('Agent execution result must include a non-empty operationalIdentityId.');
  }

  if (!Object.hasOwn(result, 'primaryCognitiveIdentityId')) {
    throw new Error('Agent execution result must include primaryCognitiveIdentityId, using null when cognition was not resolved.');
  }

  if (!isNullableNonEmptyString(result.primaryCognitiveIdentityId)) {
    throw new Error('Agent execution result primaryCognitiveIdentityId must be null or a non-empty string.');
  }

  if (!result.request || typeof result.request !== 'object') {
    throw new Error('Agent execution result must include the normalized request.');
  }

  if (!isNonEmptyString(result.message)) {
    throw new Error('Agent execution result must include a non-empty message.');
  }

  if (!Array.isArray(result.warnings)) {
    throw new Error('Agent execution result must include a warnings array.');
  }

  if (!Array.isArray(result.errors)) {
    throw new Error('Agent execution result must include an errors array.');
  }

  if (!isNonEmptyString(result.nextStep)) {
    throw new Error('Agent execution result must include a non-empty nextStep.');
  }

  if (result.workCycle !== undefined && result.workCycle !== null) {
    assertAgentWorkCycleSummary(result.workCycle);
  }

  if (result.executionPlan !== undefined && result.executionPlan !== null) {
    assertAgentExecutionPlan(result.executionPlan);
  }

  if (result.planExecutionCoordination !== undefined && result.planExecutionCoordination !== null) {
    assertPlanExecutionCoordination(result.planExecutionCoordination);
  }

  if (result.verificationGate !== undefined && result.verificationGate !== null) {
    assertVerificationGate(result.verificationGate);
  }

  return result;
}
