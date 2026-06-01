import test from 'node:test';
import assert from 'node:assert/strict';
import {
  shouldPerformProviderToolObservationFollowup,
} from '../../src/invocation/run-probabilistic-agent-invocation.js';

test('yielding OS affordances do not run a competing provider observation follow-up', () => {
  assert.equal(shouldPerformProviderToolObservationFollowup({
    continuationPolicy: 'yield_to_kernel',
  }), false);
  assert.equal(shouldPerformProviderToolObservationFollowup({
    continuationPolicy: 'return_kernel_acknowledgement',
  }), false);
});

test('ordinary tool observations retain their provider-backed follow-up', () => {
  assert.equal(shouldPerformProviderToolObservationFollowup({
    continuationPolicy: 'continue_with_provider',
  }), true);
});
