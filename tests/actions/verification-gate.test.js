import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateVerificationGateForInvocation } from '../../src/actions/evaluate-verification-gate-for-invocation.js';

function buildAcceptedToolActionResolution() {
  return {
    kind: 'action_resolution',
    version: 1,
    status: 'accepted',
    runtimeAction: 'queue_tool_request',
    selectedCandidate: {
      actionType: 'tool_execution',
      targetType: 'tool',
      targetId: 'mas.system.inspect',
      sideEffectLevel: 'read_only',
    },
    reason: 'Tool action accepted.',
  };
}

function buildToolExecution({
  observation = {
    kind: 'brain_tool_observation',
    version: 1,
    toolId: 'mas.system.inspect',
    toolRunId: 'tool-run-001',
    status: 'succeeded',
    summary: 'MAS system inspection completed.',
    dataPreview: {
      registeredCognitiveIdentityCount: 4,
    },
    resultEvidence: {
      inlineDataIncluded: true,
      fullResultArtifactPersisted: false,
    },
  },
} = {}) {
  return {
    kind: 'brain_tool_execution_result',
    version: 1,
    status: 'executed',
    executionPerformed: true,
    requestedToolId: 'mas.system.inspect',
    toolRequestId: 'tool-request-001',
    toolRunId: 'tool-run-001',
    toolResultStatus: 'succeeded',
    toolAuditRecordPath: 'memory/state/tool-run-001.json',
    toolResultSnapshotPath: null,
    memoryWritebackRequest: null,
    memoryWritebackPersistence: null,
    observation,
    reason: 'Tool executed.',
    warnings: [],
    errors: [],
  };
}

function buildActionClaimGuard(overrides = {}) {
  return {
    kind: 'action_claim_guard',
    version: 1,
    status: 'supported',
    claimCount: 1,
    supportedClaimCount: 1,
    unsupportedClaimCount: 0,
    claims: [],
    warnings: [],
    ...overrides,
  };
}

test('evaluateVerificationGateForInvocation passes when execution evidence and preview are present', () => {
  const gate = evaluateVerificationGateForInvocation({
    actionResolution: buildAcceptedToolActionResolution(),
    brainToolExecution: buildToolExecution(),
    actionClaimGuard: buildActionClaimGuard(),
  });

  assert.equal(gate.status, 'passed');
  assert.equal(gate.verificationOutcome, 'verified');
  assert.equal(gate.executionObserved, true);
  assert.equal(gate.evidenceRequirements.length, 2);
  assert.equal(gate.claimSupportSummary.unsupportedClaims, 0);
});

test('evaluateVerificationGateForInvocation fails when execution has no observation record', () => {
  const gate = evaluateVerificationGateForInvocation({
    actionResolution: buildAcceptedToolActionResolution(),
    brainToolExecution: buildToolExecution({
      observation: null,
    }),
    actionClaimGuard: buildActionClaimGuard(),
  });

  assert.equal(gate.status, 'failed');
  assert.equal(gate.verificationOutcome, 'not_verified');
  assert.match(gate.reason, /not fully satisfied/u);
  assert.match(gate.warnings[0], /tool-observation-record/u);
});

test('evaluateVerificationGateForInvocation degrades when persisted artifact exists without inline preview', () => {
  const gate = evaluateVerificationGateForInvocation({
    actionResolution: buildAcceptedToolActionResolution(),
    brainToolExecution: buildToolExecution({
      observation: {
        kind: 'brain_tool_observation',
        version: 1,
        toolId: 'mas.system.inspect',
        toolRunId: 'tool-run-001',
        status: 'succeeded',
        summary: 'MAS system inspection completed.',
        dataPreview: null,
        resultEvidence: {
          inlineDataIncluded: false,
          fullResultArtifactPersisted: true,
        },
      },
    }),
    actionClaimGuard: buildActionClaimGuard(),
  });

  assert.equal(gate.status, 'degraded');
  assert.equal(gate.verificationOutcome, 'partially_verified');
  assert.match(gate.reason, /bounded inline verification evidence is incomplete/u);
  assert.match(gate.warnings[0], /tool-observation-preview/u);
});

test('evaluateVerificationGateForInvocation fails when unsupported mutation claim is present', () => {
  const gate = evaluateVerificationGateForInvocation({
    actionResolution: buildAcceptedToolActionResolution(),
    brainToolExecution: buildToolExecution(),
    actionClaimGuard: buildActionClaimGuard({
      status: 'unsupported',
      claimCount: 1,
      supportedClaimCount: 0,
      unsupportedClaimCount: 1,
      claims: [
        {
          claimId: 'claim-001',
          claimType: 'state_mutation',
          evidenceStatus: 'unsupported',
          reason: 'Mutation claim is not supported by runtime evidence.',
          metadata: {
            targetType: 'tool',
            targetId: 'mas.system.inspect',
          },
        },
      ],
    }),
  });

  assert.equal(gate.status, 'failed');
  assert.equal(gate.claimSupportSummary.unsupportedClaims, 1);
  assert.match(gate.warnings[0], /unsupported-claim-001/u);
});
