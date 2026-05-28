import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AGENT_WORK_CYCLE_STAGE_IDS,
  assertAgentWorkCycleSummary,
} from '../../src/contracts/agent-work-cycle-contract.js';

function createStage(stageId, status = 'completed') {
  return {
    kind: 'agent_work_cycle_stage',
    version: 1,
    stageId,
    status,
    reason: `${stageId} ${status}`,
  };
}

function createSummary(overrides = {}) {
  const stages = AGENT_WORK_CYCLE_STAGE_IDS.map((stageId) => createStage(stageId));

  return {
    kind: 'agent_work_cycle_summary',
    version: 1,
    invocationId: 'invocation-work-cycle-001',
    primaryCognitiveIdentityId: 'system-steward',
    operationalIdentityId: 'alfred',
    invocationMode: 'probabilistic',
    executionStatus: 'completed',
    overallOutcome: 'acted',
    terminalStageId: 'continue_or_stop',
    stageCounts: {
      totalStages: stages.length,
      completed: stages.length,
      skipped: 0,
      blocked: 0,
      failed: 0,
      degraded: 0,
    },
    stages,
    metadata: {
      command: 'ask',
      executionType: 'probabilistic_brain',
    },
    ...overrides,
  };
}

test('assertAgentWorkCycleSummary accepts the canonical ordered stage list', () => {
  const summary = assertAgentWorkCycleSummary(createSummary());

  assert.equal(summary.kind, 'agent_work_cycle_summary');
  assert.equal(summary.stages.length, AGENT_WORK_CYCLE_STAGE_IDS.length);
  assert.equal(summary.stageCounts.totalStages, AGENT_WORK_CYCLE_STAGE_IDS.length);
});

test('assertAgentWorkCycleSummary rejects missing or reordered stages', () => {
  assert.throws(() => {
    return assertAgentWorkCycleSummary(createSummary({
      stages: AGENT_WORK_CYCLE_STAGE_IDS.slice(1).map((stageId) => createStage(stageId)),
      stageCounts: {
        totalStages: AGENT_WORK_CYCLE_STAGE_IDS.length - 1,
        completed: AGENT_WORK_CYCLE_STAGE_IDS.length - 1,
        skipped: 0,
        blocked: 0,
        failed: 0,
        degraded: 0,
      },
    }));
  }, /exactly/u);

  const reorderedStages = [...AGENT_WORK_CYCLE_STAGE_IDS];
  [reorderedStages[0], reorderedStages[1]] = [reorderedStages[1], reorderedStages[0]];

  assert.throws(() => {
    return assertAgentWorkCycleSummary(createSummary({
      stages: reorderedStages.map((stageId) => createStage(stageId)),
    }));
  }, /canonical order/u);
});

test('assertAgentWorkCycleSummary rejects ambiguous cognition-as-agent identity fields', () => {
  assert.throws(
    () => assertAgentWorkCycleSummary(createSummary({
      agentId: 'system-steward',
    })),
    /must not include agentId/u,
  );
});

test('assertAgentWorkCycleSummary requires explicit resolved-cognition evidence', () => {
  const summaryWithoutCognition = createSummary();

  delete summaryWithoutCognition.primaryCognitiveIdentityId;

  assert.throws(
    () => assertAgentWorkCycleSummary(summaryWithoutCognition),
    /must include primaryCognitiveIdentityId/u,
  );
});
