import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFakeOpenRouterSecretProbe } from '../helpers/fake-secret-probes.js';
import {
  OPENMAS_OS_ACTION_KINDS,
  assertOpenMasOsActionResult,
} from '../../src/contracts/os/openmas-os-action-request-contract.js';
import {
  createOsActionGate,
  evaluateOsActionRequest,
} from '../../src/os/actions/os-action-gate.js';

const NOW = '2026-05-15T10:00:00-05:00';

function createDelegateRequest(overrides = {}) {
  return {
    kind: OPENMAS_OS_ACTION_KINDS.request,
    schemaVersion: 1,
    actionRequestId: 'os_action_request_delegate_001',
    actionType: 'delegate',
    requestedBy: {
      type: 'operational_identity',
      id: 'alfred',
    },
    conversationId: 'os-m2-delegation-smoke',
    parentContext: {
      jobId: 'job_alfred_parent',
      processId: 'process_alfred_parent',
      threadId: 'thread_alfred_parent',
    },
    payload: {
      targetOperationalIdentityId: 'bruce',
      task: 'Inspect the MAS and report findings.',
      command: 'ask',
      mode: 'probabilistic',
      contextRefs: [
        {
          sourceType: 'conversation_session',
          conversationId: 'os-m2-delegation-smoke',
          path: 'memory/state/conversations/os-m2-delegation-smoke/session.json',
        },
      ],
    },
    createdAt: NOW,
    ...overrides,
  };
}

function createScheduleDelegationRequest(overrides = {}) {
  return createDelegateRequest({
    actionRequestId: 'os_action_request_schedule_delegation_001',
    actionType: 'schedule_delegation',
    payload: {
      targetOperationalIdentityId: 'bruce',
      task: 'Inspect the MAS and report findings.',
      runAt: '2026-05-15T18:00:00-05:00',
    },
    ...overrides,
  });
}

function createGateOptions(overrides = {}) {
  return {
    allowedRequesters: [
      {
        type: 'operational_identity',
        id: 'alfred',
      },
    ],
    runtimeRequester: {
      type: 'operational_identity',
      id: 'alfred',
    },
    now: () => NOW,
    ...overrides,
  };
}

test('evaluateOsActionRequest accepts an allowed delegate request and returns an agent-friendly result', () => {
  const evaluation = evaluateOsActionRequest({
    request: createDelegateRequest(),
    ...createGateOptions(),
  });

  assert.equal(evaluation.status, 'accepted');
  assert.equal(evaluation.accepted, true);
  assert.equal(evaluation.actionRequest.actionType, 'delegate');
  assert.equal(evaluation.actionResult.status, 'accepted');
  assert.equal(evaluation.actionResult.payload.runtimeAction, 'route_to_delegate_handler');
  assert.equal(evaluation.actionResult.payload.executionPerformed, false);
  assert.equal(evaluation.actionResult.payload.targetOperationalIdentityId, 'bruce');
  assert.equal(evaluation.actionResult.payload.parentProcessId, 'process_alfred_parent');
  assert.equal(evaluation.actionResult.payload.contextRefCount, 1);
});

test('evaluateOsActionRequest fails closed when the request is invalid without leaking unsafe payloads', () => {
  const evaluation = evaluateOsActionRequest({
    request: createDelegateRequest({
      actionType: 'restart_everything',
      payload: {
        targetOperationalIdentityId: 'bruce',
        task: `Use ${buildFakeOpenRouterSecretProbe('secretvalue1234567890')} while inspecting.`,
      },
    }),
    ...createGateOptions(),
  });

  assert.equal(evaluation.status, 'rejected');
  assert.equal(evaluation.accepted, false);
  assert.equal(evaluation.actionRequest, null);
  assert.equal(evaluation.actionResult.actionType, 'invalid_request');
  assert.equal(evaluation.actionResult.payload.reasonCode, 'invalid_request');
  assert.doesNotMatch(JSON.stringify(evaluation.actionResult), new RegExp(buildFakeOpenRouterSecretProbe('secretvalue'), 'u'));
  assert.doesNotThrow(() => assertOpenMasOsActionResult(evaluation.actionResult));
});

test('evaluateOsActionRequest rejects valid requests unless the requester is explicitly allowed', () => {
  const evaluation = evaluateOsActionRequest({
    request: createDelegateRequest(),
    now: () => NOW,
  });

  assert.equal(evaluation.status, 'rejected');
  assert.equal(evaluation.accepted, false);
  assert.equal(evaluation.actionResult.payload.reasonCode, 'requester_not_allowed');
  assert.match(evaluation.actionResult.reason, /not explicitly allowed/u);
});

test('evaluateOsActionRequest rejects runtime requester mismatch before routing to handlers', () => {
  const evaluation = evaluateOsActionRequest({
    request: createDelegateRequest(),
    ...createGateOptions({
      runtimeRequester: {
        type: 'operational_identity',
        id: 'bruce',
      },
    }),
  });

  assert.equal(evaluation.status, 'rejected');
  assert.equal(evaluation.accepted, false);
  assert.equal(evaluation.actionResult.payload.reasonCode, 'runtime_requester_mismatch');
  assert.match(evaluation.actionResult.reason, /does not match/u);
});

test('evaluateOsActionRequest blocks delegation when parent Process and Thread context are missing', () => {
  const evaluation = evaluateOsActionRequest({
    request: createDelegateRequest({
      parentContext: null,
    }),
    ...createGateOptions(),
  });

  assert.equal(evaluation.status, 'blocked');
  assert.equal(evaluation.accepted, false);
  assert.equal(evaluation.actionResult.payload.reasonCode, 'parent_context_required');
  assert.equal(evaluation.actionResult.payload.missingContext.processId, true);
  assert.equal(evaluation.actionResult.payload.missingContext.threadId, true);
});

test('evaluateOsActionRequest accepts future scheduled delegation and blocks past scheduled delegation', () => {
  const accepted = evaluateOsActionRequest({
    request: createScheduleDelegationRequest(),
    ...createGateOptions(),
  });

  assert.equal(accepted.status, 'accepted');
  assert.equal(accepted.actionResult.payload.runtimeAction, 'route_to_schedule_delegation_handler');
  assert.equal(accepted.actionResult.payload.runAt, '2026-05-15T18:00:00-05:00');

  const blocked = evaluateOsActionRequest({
    request: createScheduleDelegationRequest({
      payload: {
        targetOperationalIdentityId: 'bruce',
        task: 'Inspect the MAS and report findings.',
        runAt: '2026-05-15T09:00:00-05:00',
      },
    }),
    ...createGateOptions(),
  });

  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.accepted, false);
  assert.equal(blocked.actionResult.payload.reasonCode, 'scheduled_time_not_future');
});

test('evaluateOsActionRequest allows barely due scheduled delegation when missedRunPolicy is delay', () => {
  const evaluation = evaluateOsActionRequest({
    request: createScheduleDelegationRequest({
      payload: {
        targetOperationalIdentityId: 'bruce',
        task: 'Inspect the MAS and report findings.',
        runAt: '2026-05-15T09:59:15-05:00',
        missedRunPolicy: 'delay',
      },
    }),
    ...createGateOptions(),
  });

  assert.equal(evaluation.status, 'accepted');
  assert.equal(evaluation.accepted, true);
  assert.equal(evaluation.actionResult.payload.runAtAlreadyDue, true);
  assert.equal(evaluation.actionResult.payload.missedRunPolicy, 'delay');
  assert.equal(evaluation.actionResult.warnings.length, 1);
});

test('evaluateOsActionRequest rejects self-delegation and disallowed action types', () => {
  const selfDelegation = evaluateOsActionRequest({
    request: createDelegateRequest({
      payload: {
        targetOperationalIdentityId: 'alfred',
        task: 'Inspect the MAS and report findings.',
      },
    }),
    ...createGateOptions(),
  });

  assert.equal(selfDelegation.status, 'rejected');
  assert.equal(selfDelegation.actionResult.payload.reasonCode, 'self_delegation_not_allowed');

  const disallowedActionType = evaluateOsActionRequest({
    request: createScheduleDelegationRequest(),
    ...createGateOptions({
      allowedActionTypes: ['delegate'],
    }),
  });

  assert.equal(disallowedActionType.status, 'rejected');
  assert.equal(disallowedActionType.actionResult.payload.reasonCode, 'action_type_not_allowed');
});

test('OsActionGate class reuses gate configuration across evaluations', () => {
  const gate = createOsActionGate(createGateOptions());
  const evaluation = gate.evaluate(createDelegateRequest());

  assert.equal(evaluation.status, 'accepted');
  assert.equal(evaluation.actionResult.payload.runtimeAction, 'route_to_delegate_handler');
});
