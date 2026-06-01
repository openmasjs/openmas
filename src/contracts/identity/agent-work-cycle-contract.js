export const AGENT_WORK_CYCLE_STAGE_IDS = [
  'receive_request',
  'understand',
  'decide',
  'plan',
  'select_capabilities',
  'request_approval',
  'execute',
  'observe',
  'verify',
  'summarize',
  'persist',
  'continue_or_stop',
];

export const AGENT_WORK_CYCLE_STAGE_STATUSES = [
  'completed',
  'skipped',
  'blocked',
  'failed',
  'degraded',
];

const AGENT_WORK_CYCLE_STAGE_ID_SET = new Set(AGENT_WORK_CYCLE_STAGE_IDS);
const AGENT_WORK_CYCLE_STAGE_STATUS_SET = new Set(AGENT_WORK_CYCLE_STAGE_STATUSES);
const AGENT_EXECUTION_STATUS_SET = new Set([
  'completed',
  'blocked',
  'failed',
]);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isNullableNonEmptyString(value) {
  return value === null || value === undefined || isNonEmptyString(value);
}

function assertStageCounts(stageCounts, expectedTotalStages) {
  if (!isPlainObject(stageCounts)) {
    throw new Error('Agent work cycle summary stageCounts must be an object.');
  }

  const allowedKeys = new Set([
    'totalStages',
    ...AGENT_WORK_CYCLE_STAGE_STATUSES,
  ]);

  for (const key of Object.keys(stageCounts)) {
    if (!allowedKeys.has(key)) {
      throw new Error(`Agent work cycle summary stageCounts contains an unsupported key: ${key}`);
    }

    if (!Number.isInteger(stageCounts[key]) || stageCounts[key] < 0) {
      throw new Error(`Agent work cycle summary stageCounts.${key} must be a non-negative integer.`);
    }
  }

  if (stageCounts.totalStages !== expectedTotalStages) {
    throw new Error(`Agent work cycle summary stageCounts.totalStages must be ${expectedTotalStages}.`);
  }

  const derivedTotal = AGENT_WORK_CYCLE_STAGE_STATUSES.reduce((total, status) => {
    return total + (stageCounts[status] ?? 0);
  }, 0);

  if (derivedTotal !== expectedTotalStages) {
    throw new Error('Agent work cycle summary stageCounts must add up to the total number of stages.');
  }
}

export function assertAgentWorkCycleStage(stage) {
  if (!isPlainObject(stage)) {
    throw new Error('Agent work cycle stage must be an object.');
  }

  if (stage.kind !== 'agent_work_cycle_stage') {
    throw new Error(`Agent work cycle stage kind must be "agent_work_cycle_stage"; received ${stage.kind}`);
  }

  if (stage.version !== 1) {
    throw new Error(`Agent work cycle stage version must be 1; received ${stage.version}`);
  }

  if (!AGENT_WORK_CYCLE_STAGE_ID_SET.has(stage.stageId)) {
    throw new Error(`Agent work cycle stage contains an invalid stageId: ${stage.stageId}`);
  }

  if (!AGENT_WORK_CYCLE_STAGE_STATUS_SET.has(stage.status)) {
    throw new Error(`Agent work cycle stage contains an invalid status: ${stage.status}`);
  }

  if (!isNonEmptyString(stage.reason)) {
    throw new Error('Agent work cycle stage must include a non-empty reason.');
  }

  if (stage.metadata !== undefined && stage.metadata !== null && !isPlainObject(stage.metadata)) {
    throw new Error('Agent work cycle stage metadata must be a plain object when provided.');
  }

  return {
    ...stage,
    reason: stage.reason.trim(),
  };
}

export function assertAgentWorkCycleSummary(summary) {
  if (!isPlainObject(summary)) {
    throw new Error('Agent work cycle summary must be an object.');
  }

  if (summary.kind !== 'agent_work_cycle_summary') {
    throw new Error(`Agent work cycle summary kind must be "agent_work_cycle_summary"; received ${summary.kind}`);
  }

  if (summary.version !== 1) {
    throw new Error(`Agent work cycle summary version must be 1; received ${summary.version}`);
  }

  if (!isNonEmptyString(summary.invocationId)) {
    throw new Error('Agent work cycle summary must include a non-empty invocationId.');
  }

  if (Object.hasOwn(summary, 'agentId')) {
    throw new Error('Agent work cycle summary must not include agentId; use operationalIdentityId and primaryCognitiveIdentityId.');
  }

  if (!Object.hasOwn(summary, 'primaryCognitiveIdentityId')) {
    throw new Error('Agent work cycle summary must include primaryCognitiveIdentityId, using null when cognition was not resolved.');
  }

  if (!isNullableNonEmptyString(summary.primaryCognitiveIdentityId)) {
    throw new Error('Agent work cycle summary primaryCognitiveIdentityId must be null or a non-empty string.');
  }

  if (!isNonEmptyString(summary.operationalIdentityId)) {
    throw new Error('Agent work cycle summary must include a non-empty operationalIdentityId.');
  }

  if (!isNonEmptyString(summary.invocationMode)) {
    throw new Error('Agent work cycle summary must include a non-empty invocationMode.');
  }

  if (!AGENT_EXECUTION_STATUS_SET.has(summary.executionStatus)) {
    throw new Error(`Agent work cycle summary contains an invalid executionStatus: ${summary.executionStatus}`);
  }

  if (!isNonEmptyString(summary.overallOutcome)) {
    throw new Error('Agent work cycle summary must include a non-empty overallOutcome.');
  }

  if (!AGENT_WORK_CYCLE_STAGE_ID_SET.has(summary.terminalStageId)) {
    throw new Error(`Agent work cycle summary contains an invalid terminalStageId: ${summary.terminalStageId}`);
  }

  if (!Array.isArray(summary.stages)) {
    throw new Error('Agent work cycle summary must include a stages array.');
  }

  if (summary.stages.length !== AGENT_WORK_CYCLE_STAGE_IDS.length) {
    throw new Error(`Agent work cycle summary must include exactly ${AGENT_WORK_CYCLE_STAGE_IDS.length} stages.`);
  }

  const normalizedStages = summary.stages.map(assertAgentWorkCycleStage);

  for (let index = 0; index < AGENT_WORK_CYCLE_STAGE_IDS.length; index += 1) {
    if (normalizedStages[index].stageId !== AGENT_WORK_CYCLE_STAGE_IDS[index]) {
      throw new Error(`Agent work cycle stages must appear in canonical order; expected ${AGENT_WORK_CYCLE_STAGE_IDS[index]} at position ${index}.`);
    }
  }

  assertStageCounts(summary.stageCounts, normalizedStages.length);

  if (summary.metadata !== undefined && summary.metadata !== null && !isPlainObject(summary.metadata)) {
    throw new Error('Agent work cycle summary metadata must be a plain object when provided.');
  }

  return {
    ...summary,
    invocationId: summary.invocationId.trim(),
    primaryCognitiveIdentityId: summary.primaryCognitiveIdentityId ?? null,
    operationalIdentityId: summary.operationalIdentityId.trim(),
    invocationMode: summary.invocationMode.trim(),
    executionStatus: summary.executionStatus,
    overallOutcome: summary.overallOutcome.trim(),
    terminalStageId: summary.terminalStageId,
    stages: normalizedStages,
  };
}
