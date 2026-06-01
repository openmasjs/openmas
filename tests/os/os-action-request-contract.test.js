import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFakeOpenRouterSecretProbe } from '../helpers/fake-secret-probes.js';
import {
  OPENMAS_OS_ACTION_KINDS,
  OPENMAS_OS_ACTION_RESULT_STATUSES,
  OPENMAS_OS_ACTION_TYPES,
  assertOpenMasOsActionRequest,
  assertOpenMasOsActionResult,
} from '../../src/contracts/os/openmas-os-action-request-contract.js';

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
      priority: 25,
      reason: 'Bruce is the evaluation specialist.',
      contextRefs: [
        {
          sourceType: 'conversation_session',
          conversationId: 'os-m2-delegation-smoke',
          path: 'memory/state/conversations/os-m2-delegation-smoke/session.json',
        },
      ],
      artifactRefs: [],
      expectedOutput: {
        format: 'short_audit_summary',
      },
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
      missedRunPolicy: 'skip',
    },
    ...overrides,
  });
}

function createActionResult(overrides = {}) {
  return {
    kind: OPENMAS_OS_ACTION_KINDS.result,
    schemaVersion: 1,
    actionResultId: 'os_action_result_delegate_001',
    actionRequestId: 'os_action_request_delegate_001',
    actionType: 'delegate',
    status: 'accepted',
    createdBy: {
      type: 'system',
      id: 'openmas-os',
    },
    reason: 'Delegation request accepted by policy.',
    payload: {
      childJobId: 'job_bruce_child_001',
      parentProcessId: 'process_alfred_parent',
    },
    evidenceRefs: [
      {
        referenceType: 'event',
        referenceId: 'event_delegation_requested_001',
      },
    ],
    warnings: [],
    createdAt: NOW,
    updatedAt: NOW,
    completedAt: null,
    ...overrides,
  };
}

test('assertOpenMasOsActionRequest accepts and normalizes a delegate request', () => {
  const request = assertOpenMasOsActionRequest(createDelegateRequest({
    actionRequestId: ' os_action_request_delegate_001 ',
    payload: {
      targetOperationalIdentityId: 'bruce',
      task: 'Inspect the MAS and report findings.',
    },
  }));

  assert.equal(request.kind, OPENMAS_OS_ACTION_KINDS.request);
  assert.equal(request.actionRequestId, 'os_action_request_delegate_001');
  assert.equal(request.actionType, 'delegate');
  assert.equal(request.requestedBy.id, 'alfred');
  assert.equal(request.payload.targetOperationalIdentityId, 'bruce');
  assert.equal(request.payload.command, 'ask');
  assert.equal(request.payload.mode, 'probabilistic');
  assert.equal(request.payload.priority, 50);
  assert.deepEqual(request.payload.contextRefs, []);
});

test('assertOpenMasOsActionRequest accepts scheduled delegation with explicit timestamp and safe defaults', () => {
  const request = assertOpenMasOsActionRequest(createScheduleDelegationRequest());

  assert.equal(request.actionType, 'schedule_delegation');
  assert.equal(request.payload.runAt, '2026-05-15T18:00:00-05:00');
  assert.equal(request.payload.missedRunPolicy, 'skip');
  assert.equal(request.payload.command, 'ask');
  assert.equal(request.payload.mode, 'probabilistic');
});

test('assertOpenMasOsActionRequest rejects unsupported action types, unsafe ids, and missing delegation fields', () => {
  assert.throws(
    () => assertOpenMasOsActionRequest(createDelegateRequest({
      actionType: 'restart_the_world',
    })),
    /actionType is invalid/u,
  );

  assert.throws(
    () => assertOpenMasOsActionRequest(createDelegateRequest({
      requestedBy: {
        type: 'operational_identity',
        id: '../alfred',
      },
    })),
    /unsafe characters/u,
  );

  assert.throws(
    () => assertOpenMasOsActionRequest(createDelegateRequest({
      payload: {
        task: 'Inspect the MAS.',
      },
    })),
    /targetOperationalIdentityId/u,
  );

  assert.throws(
    () => assertOpenMasOsActionRequest(createDelegateRequest({
      payload: {
        targetOperationalIdentityId: 'bruce',
      },
    })),
    /task/u,
  );

  assert.throws(
    () => assertOpenMasOsActionRequest(createDelegateRequest({
      payload: {
        targetOperationalIdentityId: 'bruce',
        task: 'Inspect the MAS.',
        agentId: 'evaluation-audit-steward',
      },
    })),
    /must not include agentId/u,
  );
});

test('assertOpenMasOsActionRequest rejects ambiguous scheduled times and raw secret-like payloads', () => {
  assert.throws(
    () => assertOpenMasOsActionRequest(createScheduleDelegationRequest({
      payload: {
        targetOperationalIdentityId: 'bruce',
        task: 'Inspect the MAS.',
        runAt: '2026-05-15T18:00:00',
      },
    })),
    /explicit ISO timestamp/u,
  );

  assert.throws(
    () => assertOpenMasOsActionRequest(createDelegateRequest({
      payload: {
        targetOperationalIdentityId: 'bruce',
        task: `Use ${buildFakeOpenRouterSecretProbe('secretvalue1234567890')} while inspecting.`,
      },
    })),
    /secret-like value/u,
  );

  assert.throws(
    () => assertOpenMasOsActionRequest(createDelegateRequest({
      payload: {
        targetOperationalIdentityId: 'bruce',
        task: 'Inspect the MAS.',
        apiKey: buildFakeOpenRouterSecretProbe('secretvalue1234567890'),
      },
    })),
    /raw secret-like field/u,
  );
});

test('assertOpenMasOsActionResult accepts safe result evidence and rejects unsafe result state', () => {
  const result = assertOpenMasOsActionResult(createActionResult());

  assert.equal(result.kind, OPENMAS_OS_ACTION_KINDS.result);
  assert.equal(result.status, 'accepted');
  assert.equal(result.payload.childJobId, 'job_bruce_child_001');
  assert.equal(result.evidenceRefs[0].referenceType, 'event');

  assert.throws(
    () => assertOpenMasOsActionResult(createActionResult({
      status: 'maybe',
    })),
    /status is invalid/u,
  );

  assert.throws(
    () => assertOpenMasOsActionResult(createActionResult({
      payload: {
        accessToken: 'Bearer verysecretaccesstoken',
      },
    })),
    /raw secret-like field/u,
  );
});

test('OS Action Request constants expose the Milestone 2 vocabulary', () => {
  assert.equal(OPENMAS_OS_ACTION_TYPES.has('delegate'), true);
  assert.equal(OPENMAS_OS_ACTION_TYPES.has('schedule_delegation'), true);
  assert.equal(OPENMAS_OS_ACTION_RESULT_STATUSES.has('accepted'), true);
  assert.equal(OPENMAS_OS_ACTION_RESULT_STATUSES.has('completed'), true);
});
