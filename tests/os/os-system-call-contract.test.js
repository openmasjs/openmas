import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFakeOpenRouterSecretProbe } from '../helpers/fake-secret-probes.js';
import {
  OPENMAS_OS_SYSTEM_CALL_KINDS,
  OPENMAS_OS_SYSTEM_CALL_OPERATIONS,
  OPENMAS_OS_SYSTEM_CALL_RESULT_STATUSES,
  OPENMAS_OS_SYSTEM_CALL_STATUSES,
  assertOpenMasOsSystemCall,
  assertOpenMasOsSystemCallResult,
} from '../../src/contracts/openmas-os-system-call-contract.js';

const NOW = '2026-05-19T10:00:00-05:00';
const LATER = '2026-05-19T10:10:00-05:00';

function createBaseSystemCall(overrides = {}) {
  return {
    kind: OPENMAS_OS_SYSTEM_CALL_KINDS.systemCall,
    schemaVersion: 1,
    systemCallId: 'syscall_delegate_001',
    operation: 'delegate',
    status: 'pending',
    requestedAt: NOW,
    requestedBy: {
      type: 'operational_identity',
      operationalIdentityId: 'alfred',
    },
    correlation: {
      invocationId: 'agent-invocation-001',
      actionRequestId: 'os_action_request_delegate_001',
      toolRunId: 'tool-run-001',
      conversationId: 'alfred-admin',
    },
    idempotencyKey: 'delegate:alfred:bruce:001',
    expiresAt: LATER,
    payload: {
      requesterOperationalIdentityId: 'alfred',
      targetOperationalIdentityId: 'bruce',
      reason: 'Bruce is the evaluation specialist.',
      child: {
        input: 'Inspect the MAS and report findings.',
        command: 'ask',
        mode: 'probabilistic',
        conversationId: 'alfred-admin',
        priority: 25,
        contextRefs: [
          {
            sourceType: 'conversation_session',
            conversationId: 'alfred-admin',
          },
        ],
        artifactRefs: [],
        expectedOutput: {
          format: 'short_audit_summary',
        },
      },
    },
    ...overrides,
  };
}

function createSystemCallForOperation(operation, overrides = {}) {
  const base = createBaseSystemCall({
    systemCallId: `syscall_${operation}_001`,
    operation,
    idempotencyKey: operation === 'inspect_status' ? null : `${operation}:test:001`,
  });

  if (operation === 'submit_job') {
    base.payload = {
      assignedOperationalIdentityId: 'alfred',
      program: {
        type: 'agent_invocation',
        command: 'ask',
        mode: 'probabilistic',
      },
      inputRef: {
        type: 'inline_text',
        text: 'Generate a short status report.',
      },
      conversationId: 'alfred-admin',
      priority: 30,
      policies: {
        requiresApproval: false,
      },
    };
  }

  if (operation === 'schedule_job') {
    base.payload = {
      assignedOperationalIdentityId: 'bruce',
      program: {
        type: 'agent_invocation',
        command: 'ask',
        mode: 'probabilistic',
      },
      inputRef: {
        type: 'inline_text',
        text: 'Inspect the MAS and report findings.',
      },
      runAt: '2026-05-19T18:00:00-05:00',
      missedRunPolicy: 'delay',
    };
  }

  if (operation === 'schedule_delegation') {
    base.payload = {
      requesterOperationalIdentityId: 'alfred',
      targetOperationalIdentityId: 'bruce',
      runAt: '2026-05-19T18:00:00-05:00',
      missedRunPolicy: 'delay',
      child: {
        input: 'Inspect the MAS and report findings.',
      },
    };
  }

  if (operation === 'signal') {
    base.payload = {
      signalType: 'cancel',
      targetType: 'job',
      targetId: 'job_bruce_child_001',
      reason: 'Operator cancelled the job.',
      payload: {
        source: 'admin_console',
      },
    };
  }

  if (operation === 'cancel_job') {
    base.payload = {
      jobId: 'job_bruce_child_001',
      reason: 'Operator cancelled the job.',
    };
  }

  if (operation === 'inspect_status') {
    base.payload = {
      scope: 'service',
      includeRecentResults: true,
    };
  }

  return {
    ...base,
    ...overrides,
  };
}

function createSystemCallResult(overrides = {}) {
  return {
    kind: OPENMAS_OS_SYSTEM_CALL_KINDS.result,
    schemaVersion: 1,
    systemCallId: 'syscall_schedule_delegation_001',
    operation: 'schedule_delegation',
    status: 'completed',
    processedAt: '2026-05-19T10:00:01-05:00',
    processedBy: {
      serviceId: 'openmas_os_service_local',
      tickId: 'os_service_tick_001',
    },
    decision: {
      allowed: true,
      reason: 'Delegation policy allows alfred to schedule ask work for bruce.',
      policyRefs: [
        {
          policyId: 'delegation-policy-v1',
        },
      ],
    },
    effects: {
      createdJobIds: [
        'job_bruce_child_001',
      ],
      createdTimerIds: [
        'timer_job_bruce_child_001',
      ],
      createdSignalIds: [],
      createdProcessIds: [],
      createdThreadIds: [],
      eventIds: [
        'event_system_call_completed_001',
      ],
    },
    summary: 'OpenMAS OS scheduled delegation alfred -> bruce.',
    correlation: {
      invocationId: 'agent-invocation-001',
      toolRunId: 'tool-run-001',
    },
    evidenceRefs: [
      {
        referenceType: 'event',
        referenceId: 'event_system_call_completed_001',
      },
    ],
    warnings: [],
    details: {
      childJobId: 'job_bruce_child_001',
    },
    ...overrides,
  };
}

test('assertOpenMasOsSystemCall accepts and normalizes a scheduled delegation request', () => {
  const systemCall = assertOpenMasOsSystemCall(createSystemCallForOperation('schedule_delegation', {
    systemCallId: ' syscall_schedule_delegation_001 ',
    idempotencyKey: 'schedule_delegation:alfred:bruce:2026-05-19T18:00:00-05:00',
    payload: {
      requesterOperationalIdentityId: 'alfred',
      targetOperationalIdentityId: 'bruce',
      runAt: '2026-05-19T18:00:00-05:00',
      child: {
        input: 'Inspect the MAS and report findings.',
      },
    },
  }));

  assert.equal(systemCall.kind, OPENMAS_OS_SYSTEM_CALL_KINDS.systemCall);
  assert.equal(systemCall.systemCallId, 'syscall_schedule_delegation_001');
  assert.equal(systemCall.operation, 'schedule_delegation');
  assert.equal(systemCall.status, 'pending');
  assert.equal(systemCall.requestedBy.type, 'operational_identity');
  assert.equal(systemCall.requestedBy.id, 'alfred');
  assert.equal(systemCall.payload.requesterOperationalIdentityId, 'alfred');
  assert.equal(systemCall.payload.targetOperationalIdentityId, 'bruce');
  assert.equal(systemCall.payload.child.command, 'ask');
  assert.equal(systemCall.payload.child.mode, 'probabilistic');
  assert.equal(systemCall.payload.child.priority, 50);
  assert.equal(systemCall.payload.missedRunPolicy, 'delay');
});

test('assertOpenMasOsSystemCall accepts every Slice 4.1 operation at contract level', () => {
  for (const operation of OPENMAS_OS_SYSTEM_CALL_OPERATIONS) {
    const systemCall = assertOpenMasOsSystemCall(createSystemCallForOperation(operation));

    assert.equal(systemCall.operation, operation);
    assert.equal(systemCall.status, 'pending');
  }
});

test('assertOpenMasOsSystemCall rejects unsupported operations, unsafe ids, and missing idempotency for mutations', () => {
  assert.throws(
    () => assertOpenMasOsSystemCall(createBaseSystemCall({
      operation: 'write_kernel_state_directly',
    })),
    /operation is invalid/u,
  );

  assert.throws(
    () => assertOpenMasOsSystemCall(createBaseSystemCall({
      systemCallId: '../syscall',
    })),
    /unsafe characters/u,
  );

  assert.throws(
    () => assertOpenMasOsSystemCall(createBaseSystemCall({
      idempotencyKey: null,
    })),
    /must include idempotencyKey/u,
  );

  assert.throws(
    () => assertOpenMasOsSystemCall(createBaseSystemCall({
      idempotencyKey: 'delegate/alfred/bruce',
    })),
    /idempotencyKey contains unsafe characters/u,
  );
});

test('assertOpenMasOsSystemCall rejects ambiguous timestamps, unsafe payloads, and unsupported payload shapes', () => {
  assert.throws(
    () => assertOpenMasOsSystemCall(createSystemCallForOperation('schedule_delegation', {
      payload: {
        requesterOperationalIdentityId: 'alfred',
        targetOperationalIdentityId: 'bruce',
        runAt: '2026-05-19T18:00:00',
        child: {
          input: 'Inspect the MAS.',
        },
      },
    })),
    /explicit ISO timestamp/u,
  );

  assert.throws(
    () => assertOpenMasOsSystemCall(createSystemCallForOperation('delegate', {
      payload: {
        requesterOperationalIdentityId: 'alfred',
        targetOperationalIdentityId: 'bruce',
        child: {
          input: `Use ${buildFakeOpenRouterSecretProbe('secretvalue1234567890')} while inspecting.`,
        },
      },
    })),
    /secret-like value/u,
  );

  assert.throws(
    () => assertOpenMasOsSystemCall(createSystemCallForOperation('delegate', {
      payload: {
        requesterOperationalIdentityId: 'alfred',
        targetOperationalIdentityId: 'bruce',
        child: {
          input: 'Inspect the MAS.',
        },
        apiKey: buildFakeOpenRouterSecretProbe('secretvalue1234567890'),
      },
    })),
    /raw secret-like field/u,
  );

  assert.throws(
    () => assertOpenMasOsSystemCall(createSystemCallForOperation('delegate', {
      payload: {
        requesterOperationalIdentityId: 'alfred',
        targetOperationalIdentityId: 'bruce',
      },
    })),
    /child must be an object/u,
  );

  assert.throws(
    () => assertOpenMasOsSystemCall(createSystemCallForOperation('delegate', {
      payload: {
        requesterOperationalIdentityId: 'alfred',
        targetOperationalIdentityId: 'bruce',
        child: {
          input: 'Inspect the MAS.',
          agentId: 'evaluation-audit-steward',
        },
      },
    })),
    /must not include agentId/u,
  );

  assert.throws(
    () => assertOpenMasOsSystemCall(createSystemCallForOperation('submit_job', {
      payload: {
        assignedOperationalIdentityId: 'alfred',
        program: {
          type: 'agent_invocation',
          command: 'ask',
          mode: 'probabilistic',
          agentId: 'system-steward',
        },
        inputRef: {
          type: 'inline_text',
          text: 'Generate a short status report.',
        },
      },
    })),
    /must not include agentId/u,
  );

  assert.throws(
    () => assertOpenMasOsSystemCall(createSystemCallForOperation('inspect_status', {
      payload: {
        scope: 'job',
      },
    })),
    /targetId is required/u,
  );
});

test('assertOpenMasOsSystemCallResult accepts completed results with explicit kernel effects', () => {
  const result = assertOpenMasOsSystemCallResult(createSystemCallResult());

  assert.equal(result.kind, OPENMAS_OS_SYSTEM_CALL_KINDS.result);
  assert.equal(result.status, 'completed');
  assert.equal(result.decision.allowed, true);
  assert.deepEqual(result.effects.createdJobIds, [
    'job_bruce_child_001',
  ]);
  assert.deepEqual(result.effects.createdTimerIds, [
    'timer_job_bruce_child_001',
  ]);
  assert.equal(result.correlation.invocationId, 'agent-invocation-001');
});

test('assertOpenMasOsSystemCallResult rejects contradictory or unsafe result records', () => {
  assert.throws(
    () => assertOpenMasOsSystemCallResult(createSystemCallResult({
      status: 'denied',
      decision: {
        allowed: false,
        reason: 'Delegation policy denied the request.',
      },
    })),
    /must not include created effects/u,
  );

  assert.throws(
    () => assertOpenMasOsSystemCallResult(createSystemCallResult({
      status: 'completed',
      decision: {
        allowed: false,
        reason: 'Contradictory result.',
      },
      effects: {},
    })),
    /decision.allowed=true/u,
  );

  assert.throws(
    () => assertOpenMasOsSystemCallResult(createSystemCallResult({
      operation: 'invalid_request',
      status: 'completed',
      effects: {},
    })),
    /invalid_request/u,
  );

  assert.throws(
    () => assertOpenMasOsSystemCallResult(createSystemCallResult({
      status: 'failed',
      effects: {
        createdJobIds: [
          'job_should_not_exist',
        ],
      },
    })),
    /must not include created effects/u,
  );

  assert.throws(
    () => assertOpenMasOsSystemCallResult(createSystemCallResult({
      details: {
        accessToken: 'Bearer verysecretaccesstoken',
      },
    })),
    /raw secret-like field/u,
  );
});

test('OS System Call constants expose the Milestone 4 vocabulary', () => {
  assert.equal(OPENMAS_OS_SYSTEM_CALL_OPERATIONS.has('submit_job'), true);
  assert.equal(OPENMAS_OS_SYSTEM_CALL_OPERATIONS.has('schedule_delegation'), true);
  assert.equal(OPENMAS_OS_SYSTEM_CALL_STATUSES.has('processing'), true);
  assert.equal(OPENMAS_OS_SYSTEM_CALL_RESULT_STATUSES.has('denied'), true);
  assert.equal(OPENMAS_OS_SYSTEM_CALL_RESULT_STATUSES.has('completed'), true);
});
