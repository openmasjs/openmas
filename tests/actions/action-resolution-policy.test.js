import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateActionResolutionPolicy } from '../../src/actions/evaluate-action-resolution-policy.js';

function buildCandidate(overrides = {}) {
  return {
    kind: 'action_candidate',
    version: 1,
    candidateId: 'candidate-mas-inspect-001',
    actionType: 'tool_execution',
    targetType: 'tool',
    targetId: 'mas.system.inspect',
    source: 'semantic_classifier',
    confidence: 'high',
    confidenceScore: 0.92,
    sideEffectLevel: 'read_only',
    requiresApproval: false,
    reason: 'The request maps to the MAS inspection tool.',
    matchedSignals: [
      'semantic-mas-inspection',
    ],
    missingContext: [],
    warnings: [],
    metadata: {
      displayName: 'MAS System Inspect',
      readinessStatus: 'ready',
    },
    ...overrides,
  };
}

test('evaluateActionResolutionPolicy accepts high-confidence ready read-only candidates', () => {
  const decision = evaluateActionResolutionPolicy({
    candidate: buildCandidate(),
  });

  assert.equal(decision.kind, 'action_resolution_policy_decision');
  assert.equal(decision.status, 'accepted');
  assert.equal(decision.executionAllowed, true);
  assert.equal(decision.approvalRequired, false);
  assert.equal(decision.metadata.reasonCategory, 'policy_accepted');
});

test('evaluateActionResolutionPolicy asks clarification for medium-confidence candidates', () => {
  const decision = evaluateActionResolutionPolicy({
    request: {
      originalInput: 'Hola Alfred, podrias revisar el MAS por favor?',
    },
    candidate: buildCandidate({
      confidence: 'medium',
      confidenceScore: 0.7,
    }),
  });

  assert.equal(decision.status, 'needs_clarification');
  assert.equal(decision.executionAllowed, false);
  assert.equal(decision.clarificationRequest.reasonCategory, 'low_confidence');
  assert.deepEqual(decision.clarificationRequest.candidateIds, [
    'candidate-mas-inspect-001',
  ]);
  assert.match(decision.clarificationRequest.question, /MAS System Inspect/);
  assert.doesNotMatch(decision.clarificationRequest.question, /confidence|runtime|readiness|policy/iu);
  assert.equal(decision.clarificationRequest.metadata.kind, 'action_clarification_metadata');
  assert.equal(decision.clarificationRequest.metadata.localizationMode, 'runtime_localized');
  assert.equal(decision.clarificationRequest.metadata.optionHints.length, 1);
  assert.equal(decision.clarificationRequest.metadata.locale, 'es');
});

test('evaluateActionResolutionPolicy asks clarification for high-confidence candidates below score threshold', () => {
  const decision = evaluateActionResolutionPolicy({
    candidate: buildCandidate({
      confidence: 'high',
      confidenceScore: 0.72,
    }),
  });

  assert.equal(decision.status, 'needs_clarification');
  assert.equal(decision.metadata.reasonCategory, 'low_confidence');
});

test('evaluateActionResolutionPolicy asks clarification when readiness is missing or not evaluated', () => {
  const missingReadinessDecision = evaluateActionResolutionPolicy({
    candidate: buildCandidate({
      metadata: {},
    }),
  });
  const notEvaluatedDecision = evaluateActionResolutionPolicy({
    candidate: buildCandidate({
      metadata: {
        readinessStatus: 'not_evaluated',
      },
    }),
  });

  assert.equal(missingReadinessDecision.status, 'needs_clarification');
  assert.equal(missingReadinessDecision.clarificationRequest.reasonCategory, 'permission_unclear');
  assert.equal(notEvaluatedDecision.status, 'needs_clarification');
  assert.equal(notEvaluatedDecision.metadata.reasonCategory, 'readiness_unverified');
});

test('evaluateActionResolutionPolicy can defer not-evaluated workflow readiness to downstream workflow gating', () => {
  const decision = evaluateActionResolutionPolicy({
    candidate: buildCandidate({
      actionType: 'workflow_execution',
      targetType: 'workflow',
      targetId: 'mas-health-review',
      metadata: {
        readinessStatus: 'not_evaluated',
      },
    }),
  });

  assert.equal(decision.status, 'accepted');
  assert.equal(decision.executionAllowed, true);
  assert.equal(decision.metadata.readinessDeferredToWorkflowRuntime, true);
  assert.match(decision.decisionTrace.join('\n'), /deferred to downstream workflow request resolution/u);
});

test('evaluateActionResolutionPolicy denies unavailable or denied candidates', () => {
  const decision = evaluateActionResolutionPolicy({
    candidate: buildCandidate({
      metadata: {
        readinessStatus: 'unavailable',
      },
    }),
  });

  assert.equal(decision.status, 'denied');
  assert.equal(decision.executionAllowed, false);
  assert.equal(decision.approvalRequired, false);
  assert.equal(decision.metadata.reasonCategory, 'readiness_denied');
});

test('evaluateActionResolutionPolicy requires approval for risky side effects', () => {
  const decision = evaluateActionResolutionPolicy({
    candidate: buildCandidate({
      candidateId: 'candidate-whatsapp-publish-001',
      actionType: 'channel_delivery',
      targetType: 'channel',
      targetId: 'alfred-whatsapp',
      sideEffectLevel: 'publish_external',
      requiresApproval: true,
      metadata: {
        readinessStatus: 'ready',
      },
    }),
  });

  assert.equal(decision.status, 'approval_required');
  assert.equal(decision.executionAllowed, false);
  assert.equal(decision.approvalRequired, true);
  assert.equal(decision.metadata.reasonCategory, 'approval_required');
});

test('evaluateActionResolutionPolicy asks clarification for semantic write_internal candidates without runtime input', () => {
  const decision = evaluateActionResolutionPolicy({
    candidate: buildCandidate({
      candidateId: 'candidate-schedule-delegation-001',
      targetId: 'mas.os.schedule_delegation',
      sideEffectLevel: 'write_internal',
      reason: 'The request maps to scheduled delegation.',
      metadata: {
        readinessStatus: 'ready',
      },
    }),
  });

  assert.equal(decision.status, 'needs_clarification');
  assert.equal(decision.executionAllowed, false);
  assert.equal(decision.approvalRequired, false);
  assert.equal(decision.metadata.reasonCategory, 'structured_runtime_input_missing');
  assert.equal(decision.clarificationRequest.reasonCategory, 'unsupported_request');
  assert.deepEqual(decision.clarificationRequest.missingContext, [
    'structured_runtime_input',
  ]);
});

test('evaluateActionResolutionPolicy accepts semantic write_internal candidates with explicit runtime input', () => {
  const decision = evaluateActionResolutionPolicy({
    candidate: buildCandidate({
      candidateId: 'candidate-schedule-delegation-001',
      targetId: 'mas.os.schedule_delegation',
      sideEffectLevel: 'write_internal',
      reason: 'The request maps to scheduled delegation.',
      metadata: {
        readinessStatus: 'ready',
        runtimeInput: {
          targetOperationalIdentityId: 'bruce',
          task: 'Inspect the MAS.',
          runAt: '2026-05-21T18:00:00-05:00',
          parentContext: {
            jobId: 'job-parent-001',
            processId: 'process-parent-001',
            threadId: 'thread-parent-001',
          },
        },
      },
    }),
  });

  assert.equal(decision.status, 'accepted');
  assert.equal(decision.executionAllowed, true);
  assert.equal(decision.metadata.reasonCategory, 'policy_accepted');
});

test('evaluateActionResolutionPolicy can relax readiness verification for future controlled adapters', () => {
  const decision = evaluateActionResolutionPolicy({
    candidate: buildCandidate({
      metadata: {},
    }),
    policyOverrides: {
      requireVerifiedReadiness: false,
    },
  });

  assert.equal(decision.status, 'accepted');
  assert.equal(decision.metadata.requireVerifiedReadiness, false);
});
