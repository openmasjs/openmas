import test from 'node:test';
import assert from 'node:assert/strict';
import { filterBenignNonExecutionClaimEnvelopeWarnings } from '../../src/invocation/run-probabilistic-agent-invocation.js';

test('filterBenignNonExecutionClaimEnvelopeWarnings removes invalid and duplicate envelope warnings for safe plan previews', () => {
  const warnings = [
    'Action claim report envelope appeared multiple times; only the final envelope was evaluated.',
    'Action claim report envelope was invalid and was ignored: Action claim report must include kind "action_claim_report".',
    'Provider returned a retryable transient warning.',
  ];

  const result = filterBenignNonExecutionClaimEnvelopeWarnings({
    warnings,
    actionResolution: {
      status: 'plan_only',
    },
    brainToolExecution: {
      executionPerformed: false,
    },
    brainWorkflowExecution: {
      executionPerformed: false,
    },
  });

  assert.deepEqual(result, [
    'Provider returned a retryable transient warning.',
  ]);
});

test('filterBenignNonExecutionClaimEnvelopeWarnings removes invalid and duplicate envelope warnings for no_action turns', () => {
  const warnings = [
    'Action claim report envelope appeared multiple times; only the final envelope was evaluated.',
    'Action claim report envelope was invalid and was ignored: Unexpected token } in JSON at position 4',
  ];

  const result = filterBenignNonExecutionClaimEnvelopeWarnings({
    warnings,
    actionResolution: {
      status: 'no_action',
    },
    brainToolExecution: {
      executionPerformed: false,
    },
    brainWorkflowExecution: {
      executionPerformed: false,
    },
  });

  assert.deepEqual(result, []);
});

test('filterBenignNonExecutionClaimEnvelopeWarnings preserves envelope warnings when runtime execution happened', () => {
  const warnings = [
    'Action claim report envelope appeared multiple times; only the final envelope was evaluated.',
    'Action claim report envelope was invalid and was ignored: Unexpected token } in JSON at position 4',
  ];

  const result = filterBenignNonExecutionClaimEnvelopeWarnings({
    warnings,
    actionResolution: {
      status: 'plan_only',
    },
    brainToolExecution: {
      executionPerformed: true,
    },
    brainWorkflowExecution: {
      executionPerformed: false,
    },
  });

  assert.equal(result, warnings);
});
