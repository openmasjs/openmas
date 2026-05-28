import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateActionClaimGuardForInvocation } from '../../src/actions/evaluate-action-claim-guard-for-invocation.js';
import { buildActionClaimReportEnvelope } from '../../src/actions/action-claim-report-envelope.js';

function buildSuccessfulToolExecution() {
  return {
    kind: 'brain_tool_execution_result',
    version: 1,
    status: 'executed',
    executionPerformed: true,
    requestedToolId: 'mas.system.inspect',
    toolRequestId: 'tool-request-001',
    toolRunId: 'tool-run-001',
    toolResultStatus: 'succeeded',
    observation: {
      kind: 'brain_tool_observation',
      version: 1,
      toolId: 'mas.system.inspect',
      toolRunId: 'tool-run-001',
      status: 'succeeded',
      summary: 'MAS inspection completed through runtime evidence.',
    },
  };
}

function buildFailedToolExecution() {
  return {
    ...buildSuccessfulToolExecution(),
    toolResultStatus: 'failed',
    observation: {
      ...buildSuccessfulToolExecution().observation,
      status: 'failed',
      summary: 'MAS inspection failed through runtime evidence.',
    },
  };
}

function buildAcceptedActionResolution() {
  return {
    kind: 'action_resolution',
    version: 1,
    status: 'accepted',
    runtimeAction: 'queue_tool_request',
    selectedCandidate: {
      targetType: 'tool',
      targetId: 'mas.system.inspect',
      sideEffectLevel: 'read_only',
    },
  };
}

function buildNoActionResolution() {
  return {
    kind: 'action_resolution',
    version: 1,
    status: 'no_action',
    runtimeAction: 'answer_only',
    selectedCandidate: null,
  };
}

function buildActionClaimReport({
  claims,
}) {
  return {
    kind: 'action_claim_report',
    version: 1,
    claims,
  };
}

function buildClaim({
  claimId = 'claim-001',
  claimType = 'completed_action',
  actionSurface = 'generic',
  evidenceRequirement = 'successful_runtime_observation',
  summary = 'The MAS inspection completed successfully.',
  targetType = 'tool',
  targetId = 'mas.system.inspect',
  metadata = {},
} = {}) {
  return {
    kind: 'action_claim_declaration',
    version: 1,
    claimId,
    claimType,
    actionSurface,
    evidenceRequirement,
    summary,
    targetType,
    targetId,
    metadata,
  };
}

test('evaluateActionClaimGuardForInvocation returns no_claims for plain answer text without structured claims or runtime evidence', () => {
  const guard = evaluateActionClaimGuardForInvocation({
    outputText: 'I can help you understand the MAS whenever you are ready.',
  });

  assert.equal(guard.status, 'no_claims');
  assert.equal(guard.claimCount, 0);
  assert.deepEqual(guard.warnings, []);
});

test('evaluateActionClaimGuardForInvocation does not infer claims from plain natural-language success text', () => {
  const guard = evaluateActionClaimGuardForInvocation({
    outputText: 'I inspected the MAS already and everything is fine.',
  });

  assert.equal(guard.status, 'no_claims');
  assert.equal(guard.claimCount, 0);
  assert.deepEqual(guard.warnings, []);
});

test('evaluateActionClaimGuardForInvocation flags structured completed-action claims without runtime evidence', () => {
  const outputText = [
    'I inspected the MAS already and everything is fine.',
    buildActionClaimReportEnvelope(buildActionClaimReport({
      claims: [
        buildClaim(),
      ],
    })),
  ].join('\n');
  const guard = evaluateActionClaimGuardForInvocation({
    outputText,
  });

  assert.equal(guard.status, 'unsupported');
  assert.equal(guard.claimCount, 1);
  assert.equal(guard.unsupportedClaimCount, 1);
  assert.equal(guard.claims[0].claimType, 'completed_action');
  assert.match(guard.warnings[0], /Unsupported action claim detected/u);
  assert.match(guard.claims[0].reason, /successful tool or workflow observation/u);
  assert.equal(guard.visibleOutputText, 'I inspected the MAS already and everything is fine.');
});

test('evaluateActionClaimGuardForInvocation supports completed structured claims with successful tool evidence', () => {
  const guard = evaluateActionClaimGuardForInvocation({
    outputText: [
      'I inspected the MAS through verified runtime evidence.',
      buildActionClaimReportEnvelope(buildActionClaimReport({
        claims: [
          buildClaim(),
        ],
      })),
    ].join('\n'),
    brainToolExecution: buildSuccessfulToolExecution(),
  });

  assert.equal(guard.status, 'supported');
  assert.equal(guard.claimCount, 1);
  assert.equal(guard.supportedClaimCount, 1);
  assert.equal(guard.claims[0].matchedEvidence[0].evidenceType, 'tool_observation');
  assert.equal(guard.claims[0].matchedEvidence[0].runId, 'tool-run-001');
});

test('evaluateActionClaimGuardForInvocation normalizes legacy action claim report declarations safely', () => {
  const guard = evaluateActionClaimGuardForInvocation({
    outputText: [
      'I inspected the MAS through verified runtime evidence.',
      '<openmas-action-claims>{"kind":"action_claim_report","version":1,"claims":[{"claimId":"inspect-success","claimType":"execution","actionSurface":"mas.system.inspect","evidenceRequirement":"tool_status: succeeded","summary":"The inspection completed successfully."}]}</openmas-action-claims>',
    ].join('\n'),
    brainToolExecution: buildSuccessfulToolExecution(),
  });

  assert.equal(guard.status, 'supported');
  assert.equal(guard.claimCount, 1);
  assert.equal(guard.claims[0].claimType, 'completed_action');
  assert.equal(guard.claims[0].actionSurface, 'tool_or_workflow');
  assert.equal(guard.claims[0].metadata.legacyActionSurface, 'mas.system.inspect');
  assert.match(guard.warnings.join('\n'), /normalized for compatibility/u);
  assert.match(guard.warnings.join('\n'), /legacy claimType "execution" was normalized/u);
});

test('evaluateActionClaimGuardForInvocation rejects structured completed claims when the tool failed', () => {
  const guard = evaluateActionClaimGuardForInvocation({
    outputText: buildActionClaimReportEnvelope(buildActionClaimReport({
      claims: [
        buildClaim(),
      ],
    })),
    brainToolExecution: buildFailedToolExecution(),
  });

  assert.equal(guard.status, 'unsupported');
  assert.equal(guard.unsupportedClaimCount, 1);
  assert.match(guard.claims[0].reason, /successful tool or workflow observation/u);
});

test('evaluateActionClaimGuardForInvocation does not treat tool evidence as channel delivery evidence', () => {
  const guard = evaluateActionClaimGuardForInvocation({
    outputText: buildActionClaimReportEnvelope(buildActionClaimReport({
      claims: [
        buildClaim({
          claimType: 'external_delivery',
          actionSurface: 'channel',
          evidenceRequirement: 'channel_delivery',
          summary: 'The WhatsApp message was delivered to the user.',
          targetType: 'channel',
          targetId: 'alfred-whatsapp',
        }),
      ],
    })),
    brainToolExecution: buildSuccessfulToolExecution(),
  });

  assert.equal(guard.status, 'unsupported');
  assert.equal(guard.claims[0].claimType, 'external_delivery');
  assert.equal(guard.claims[0].matchedEvidence.length, 0);
  assert.match(guard.claims[0].reason, /channel delivery evidence/u);
});

test('evaluateActionClaimGuardForInvocation does not treat read-only tool observations as state mutation evidence', () => {
  const guard = evaluateActionClaimGuardForInvocation({
    outputText: buildActionClaimReportEnvelope(buildActionClaimReport({
      claims: [
        buildClaim({
          claimType: 'state_mutation',
          actionSurface: 'state',
          evidenceRequirement: 'state_mutation',
          summary: 'The MAS configuration was updated.',
          targetType: 'state',
          targetId: 'mas-runtime-state',
        }),
      ],
    })),
    brainToolExecution: buildSuccessfulToolExecution(),
  });

  assert.equal(guard.status, 'unsupported');
  assert.equal(guard.claims[0].claimType, 'state_mutation');
  assert.match(guard.claims[0].reason, /explicit mutation evidence/u);
});

test('evaluateActionClaimGuardForInvocation supports future-action claims only when a runtime action is selected', () => {
  const outputText = buildActionClaimReportEnvelope(buildActionClaimReport({
    claims: [
      buildClaim({
        claimType: 'future_action',
        evidenceRequirement: 'selected_runtime_action',
        summary: 'I will inspect the MAS now.',
      }),
    ],
  }));
  const unsupportedGuard = evaluateActionClaimGuardForInvocation({
    outputText,
  });
  const supportedGuard = evaluateActionClaimGuardForInvocation({
    outputText,
    actionResolution: buildAcceptedActionResolution(),
  });

  assert.equal(unsupportedGuard.status, 'unsupported');
  assert.equal(supportedGuard.status, 'supported');
  assert.equal(supportedGuard.claims[0].matchedEvidence[0].evidenceType, 'action_resolution');
});

test('evaluateActionClaimGuardForInvocation synthesizes supported claims from verified runtime evidence when no report exists', () => {
  const guard = evaluateActionClaimGuardForInvocation({
    outputText: 'Runtime observation received.',
    brainToolExecution: buildSuccessfulToolExecution(),
  });

  assert.equal(guard.status, 'supported');
  assert.equal(guard.claimCount, 2);
  assert.equal(guard.supportedClaimCount, 2);
  assert.equal(guard.claims.some((claim) => claim.claimType === 'tool_or_workflow_execution'), true);
  assert.equal(guard.claims.some((claim) => claim.claimType === 'completed_action'), true);
});

test('evaluateActionClaimGuardForInvocation reports invalid action claim envelopes as warnings and ignores them', () => {
  const guard = evaluateActionClaimGuardForInvocation({
    outputText: 'Visible answer.\n<openmas-action-claims>{"kind":"action_claim_report","version":1,</openmas-action-claims>',
  });

  assert.equal(guard.status, 'no_claims');
  assert.equal(guard.claimCount, 0);
  assert.match(guard.warnings[0], /invalid and was ignored/u);
  assert.equal(guard.visibleOutputText, 'Visible answer.');
});

test('evaluateActionClaimGuardForInvocation suppresses malformed action claim envelope warnings for harmless no-action turns', () => {
  const guard = evaluateActionClaimGuardForInvocation({
    outputText: 'Buenas tardes.\n<openmas-action-claims>{"kind":"action_claim_report","version":1,</openmas-action-claims>',
    actionResolution: buildNoActionResolution(),
  });

  assert.equal(guard.status, 'no_claims');
  assert.equal(guard.claimCount, 0);
  assert.deepEqual(guard.warnings, []);
  assert.equal(guard.visibleOutputText, 'Buenas tardes.');
});
