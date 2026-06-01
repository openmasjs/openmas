import test from 'node:test';
import assert from 'node:assert/strict';
import { assertIdentityCommandExecutionOutcome } from '../../src/contracts/identity/identity-command-contract.js';

test('assertIdentityCommandExecutionOutcome accepts a valid MAS-owned command outcome', () => {
  const outcome = assertIdentityCommandExecutionOutcome({
    message: 'Hello from a MAS-owned command.',
    reportKind: 'welcome_report',
    reportContent: '# Welcome Report\n',
    outputPayload: {
      command: 'hello',
      speakerLabel: 'Alfred',
    },
  });

  assert.equal(outcome.message, 'Hello from a MAS-owned command.');
  assert.equal(outcome.reportKind, 'welcome_report');
  assert.equal(outcome.reportContent, '# Welcome Report\n');
  assert.deepEqual(outcome.outputPayload, {
    command: 'hello',
    speakerLabel: 'Alfred',
  });
});

test('assertIdentityCommandExecutionOutcome rejects outcomes without a reportKind', () => {
  assert.throws(
    () => assertIdentityCommandExecutionOutcome({
      message: 'Missing report kind.',
      reportContent: '# Missing Report Kind\n',
      outputPayload: {},
    }),
    /must include a non-empty reportKind/,
  );
});

test('assertIdentityCommandExecutionOutcome rejects outcomes without an object outputPayload', () => {
  assert.throws(
    () => assertIdentityCommandExecutionOutcome({
      message: 'Invalid output payload.',
      reportKind: 'invalid_payload_report',
      reportContent: '# Invalid Payload\n',
      outputPayload: 'not-an-object',
    }),
    /must include an object outputPayload/,
  );
});
