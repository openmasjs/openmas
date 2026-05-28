import test from 'node:test';
import assert from 'node:assert/strict';
import { assertIntentResolution } from '../../src/contracts/intent-resolution-contract.js';

test('assertIntentResolution accepts resolved preview-only tool intents without synthesizing execution', () => {
  const resolution = assertIntentResolution({
    kind: 'intent_resolution',
    version: 1,
    status: 'resolved',
    intentId: 'admin.mas.inspect.plan',
    intentType: 'administrative_plan_preview',
    source: 'semantic_classifier',
    confidence: 'high',
    target: {
      targetType: 'tool',
      targetId: 'mas.system.inspect',
    },
    runtimeAction: 'answer_only',
    reason: 'The runtime resolved the request to a governed inspection target, but this invocation only previews the plan.',
    evidence: [
      'A known inspection affordance was selected for a preview-only planning request.',
    ],
    warnings: [],
  });

  assert.equal(resolution.status, 'resolved');
  assert.equal(resolution.target.targetType, 'tool');
  assert.equal(resolution.runtimeAction, 'answer_only');
});

test('assertIntentResolution still rejects unsupported runtime actions for resolved tool intents', () => {
  assert.throws(
    () => assertIntentResolution({
      kind: 'intent_resolution',
      version: 1,
      status: 'resolved',
      intentId: 'admin.mas.inspect',
      intentType: 'administrative_diagnostic',
      source: 'semantic_classifier',
      confidence: 'high',
      target: {
        targetType: 'tool',
        targetId: 'mas.system.inspect',
      },
      runtimeAction: 'ask_clarification',
      reason: 'Invalid runtime action for a resolved tool target.',
      evidence: [],
      warnings: [],
    }),
    /Resolved tool intent must use queue_tool_request or answer_only runtimeAction\./,
  );
});
