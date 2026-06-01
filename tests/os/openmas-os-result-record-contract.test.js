import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFakeOpenRouterSecretProbe } from '../helpers/fake-secret-probes.js';
import {
  OPENMAS_OS_RESULT_RECORD_KINDS,
  OPENMAS_OS_RESULT_RECORD_RESULT_KINDS,
  OPENMAS_OS_RESULT_RECORD_STATUSES,
  assertOpenMasOsResultRecord,
  assertOpenMasOsResultSummary,
  createOpenMasOsResultSummaryFromRecord,
} from '../../src/contracts/os/openmas-os-result-record-contract.js';

const NOW = '2026-05-23T10:00:00-05:00';
const LATER = '2026-05-23T10:00:07-05:00';

function createResultRecord(overrides = {}) {
  return {
    kind: OPENMAS_OS_RESULT_RECORD_KINDS.resultRecord,
    schemaVersion: 1,
    resultId: 'result_process_bruce_inspection_001',
    resultKind: 'process_result',
    producer: {
      type: 'process',
      id: 'process_bruce_inspection_001',
      operationalIdentityId: 'bruce',
      activeCognitiveIdentityId: 'evaluation-audit-steward',
    },
    lineage: {
      jobId: 'job_bruce_inspection_001',
      processId: 'process_bruce_inspection_001',
      threadId: 'thread_bruce_inspection_001',
      parentProcessId: 'process_alfred_delegate_001',
      systemCallId: 'syscall_delegate_001',
      toolRunId: 'tool-run-001',
      conversationId: 'alfred-admin',
    },
    status: 'completed',
    phase: 'terminal',
    completion: {
      startedAt: NOW,
      completedAt: LATER,
      durationMs: 7000,
      exitClass: 'success',
    },
    summary: 'Bruce completed the delegated runtime inspection.',
    artifactRefs: [
      'memory/artifacts/probabilistic-brain-invocation-001.md',
      {
        referenceType: 'invocation_report',
        path: 'memory/artifacts/probabilistic-brain-invocation-001.md',
      },
    ],
    toolRunRefs: [
      'tool-run-001',
    ],
    workflowRunRefs: [],
    childResultRefs: [],
    warnings: [],
    failure: null,
    verification: {
      status: 'passed',
      grounded: true,
      details: {
        evidence: 'tool observation was grounded',
      },
    },
    visibility: {
      safeForHumanSummary: true,
      safeForAgentContext: true,
    },
    metadata: {
      responseMode: 'wait_for_result',
    },
    createdAt: LATER,
    ...overrides,
  };
}

function createWarning(overrides = {}) {
  return {
    source: {
      type: 'tool_runtime',
      id: 'tool-run-001',
    },
    severity: 'info',
    message: 'Tool memory writeback candidates are disabled by tool policy.',
    affectsResultTrust: false,
    requiresHumanAction: false,
    details: {},
    ...overrides,
  };
}

function createFailure(overrides = {}) {
  return {
    class: 'tool_failure',
    message: 'Tool mas.system.inspect failed.',
    recoverable: true,
    retryable: false,
    reasonCode: 'tool_runtime_error',
    source: {
      type: 'tool_run',
      id: 'tool-run-001',
    },
    failedAt: LATER,
    details: {
      exitStatus: 'failed',
    },
    ...overrides,
  };
}

function createResultSummary(overrides = {}) {
  return {
    kind: OPENMAS_OS_RESULT_RECORD_KINDS.resultSummary,
    schemaVersion: 1,
    resultId: 'result_process_bruce_inspection_001',
    resultKind: 'process_result',
    status: 'completed',
    producerLabel: 'Bruce',
    summary: 'Bruce completed the delegated runtime inspection.',
    artifactRefs: [
      'memory/artifacts/probabilistic-brain-invocation-001.md',
    ],
    childResultRefs: [],
    warningCount: 0,
    failure: null,
    verificationStatus: 'passed',
    createdAt: LATER,
    ...overrides,
  };
}

test('assertOpenMasOsResultRecord accepts the canonical completed process result shape', () => {
  const result = assertOpenMasOsResultRecord(createResultRecord({
    resultId: ' result_process_bruce_inspection_001 ',
  }));

  assert.equal(result.kind, OPENMAS_OS_RESULT_RECORD_KINDS.resultRecord);
  assert.equal(result.resultId, 'result_process_bruce_inspection_001');
  assert.equal(result.resultKind, 'process_result');
  assert.equal(result.producer.operationalIdentityId, 'bruce');
  assert.equal(result.producer.activeCognitiveIdentityId, 'evaluation-audit-steward');
  assert.equal(result.status, 'completed');
  assert.equal(result.phase, 'terminal');
  assert.equal(result.completion.durationMs, 7000);
  assert.equal(result.artifactRefs.length, 2);
  assert.deepEqual(result.toolRunRefs, ['tool-run-001']);
  assert.equal(result.verification.status, 'passed');
  assert.equal(result.visibility.safeForAgentContext, true);
});

test('assertOpenMasOsResultRecord accepts every v1 result status and result kind', () => {
  for (const status of OPENMAS_OS_RESULT_RECORD_STATUSES) {
    const phase = ['completed', 'completed_with_warnings', 'failed', 'denied', 'expired', 'cancelled', 'skipped'].includes(status)
      ? 'terminal'
      : 'running';
    const warnings = status === 'completed_with_warnings'
      ? [createWarning()]
      : [];
    const failure = status === 'failed'
      ? createFailure()
      : null;

    const result = assertOpenMasOsResultRecord(createResultRecord({
      resultId: `result_status_${status}`,
      status,
      phase,
      warnings,
      failure,
      completion: phase === 'terminal'
        ? {
          completedAt: LATER,
          exitClass: status === 'failed' ? 'failure' : 'unknown',
        }
        : {},
    }));

    assert.equal(result.status, status);
  }

  for (const resultKind of OPENMAS_OS_RESULT_RECORD_RESULT_KINDS) {
    const result = assertOpenMasOsResultRecord(createResultRecord({
      resultId: `result_kind_${resultKind}`,
      resultKind,
    }));

    assert.equal(result.resultKind, resultKind);
  }
});

test('assertOpenMasOsResultRecord accepts foreground admission as a non-terminal async result', () => {
  const result = assertOpenMasOsResultRecord(createResultRecord({
    resultId: 'result_foreground_admission_bruce_001',
    resultKind: 'foreground_admission_result',
    status: 'accepted',
    phase: 'admission',
    completion: {},
    summary: 'Bruce accepted foreground work and the caller received a work reference.',
    metadata: {
      responseMode: 'submit_and_return',
      workReference: {
        jobId: 'job_bruce_inspection_001',
      },
    },
  }));

  assert.equal(result.resultKind, 'foreground_admission_result');
  assert.equal(result.status, 'accepted');
  assert.equal(result.phase, 'admission');
  assert.equal(result.completion.completedAt, null);
  assert.equal(result.metadata.responseMode, 'submit_and_return');
});

test('assertOpenMasOsResultRecord rejects unsupported states, unsafe ids, and unsafe references', () => {
  assert.throws(
    () => assertOpenMasOsResultRecord(createResultRecord({
      resultKind: 'chat_claim_result',
    })),
    /resultKind is invalid/u,
  );

  assert.throws(
    () => assertOpenMasOsResultRecord(createResultRecord({
      status: 'probably_done',
    })),
    /status is invalid/u,
  );

  assert.throws(
    () => assertOpenMasOsResultRecord(createResultRecord({
      resultId: '../result',
    })),
    /unsafe characters/u,
  );

  assert.throws(
    () => assertOpenMasOsResultRecord(createResultRecord({
      artifactRefs: [
        '../secrets/provider-key.txt',
      ],
    })),
    /bounded OpenMAS reference/u,
  );

  assert.throws(
    () => assertOpenMasOsResultRecord(createResultRecord({
      metadata: {
        apiKey: buildFakeOpenRouterSecretProbe('secretvalue'),
      },
    })),
    /raw secret-like field/u,
  );
});

test('assertOpenMasOsResultRecord enforces warning semantics', () => {
  const result = assertOpenMasOsResultRecord(createResultRecord({
    status: 'completed_with_warnings',
    warnings: [
      createWarning(),
    ],
    completion: {
      completedAt: LATER,
      exitClass: 'warnings',
    },
  }));

  assert.equal(result.status, 'completed_with_warnings');
  assert.equal(result.warnings[0].severity, 'info');
  assert.equal(result.warnings[0].affectsResultTrust, false);

  assert.throws(
    () => assertOpenMasOsResultRecord(createResultRecord({
      status: 'completed_with_warnings',
      warnings: [],
    })),
    /must include at least one warning/u,
  );

  assert.throws(
    () => assertOpenMasOsResultRecord(createResultRecord({
      status: 'completed',
      warnings: [
        createWarning(),
      ],
    })),
    /Use "completed_with_warnings"/u,
  );

  assert.throws(
    () => assertOpenMasOsResultRecord(createResultRecord({
      status: 'completed_with_warnings',
      warnings: [
        createWarning({
          severity: 'loud',
        }),
      ],
    })),
    /severity is invalid/u,
  );
});

test('assertOpenMasOsResultRecord enforces failure semantics', () => {
  const result = assertOpenMasOsResultRecord(createResultRecord({
    status: 'failed',
    phase: 'terminal',
    failure: createFailure(),
    completion: {
      completedAt: LATER,
      exitClass: 'failure',
    },
  }));

  assert.equal(result.status, 'failed');
  assert.equal(result.failure.class, 'tool_failure');
  assert.equal(result.failure.recoverable, true);

  assert.throws(
    () => assertOpenMasOsResultRecord(createResultRecord({
      status: 'failed',
      failure: null,
    })),
    /must include failure details/u,
  );

  assert.throws(
    () => assertOpenMasOsResultRecord(createResultRecord({
      status: 'completed',
      failure: createFailure(),
    })),
    /must not include failure details/u,
  );

  assert.throws(
    () => assertOpenMasOsResultRecord(createResultRecord({
      status: 'failed',
      failure: createFailure({
        class: 'mystery_failure',
      }),
    })),
    /class is invalid/u,
  );
});

test('assertOpenMasOsResultRecord rejects non-terminal status for terminal phase', () => {
  assert.throws(
    () => assertOpenMasOsResultRecord(createResultRecord({
      status: 'running',
      phase: 'terminal',
    })),
    /phase "terminal" must use a terminal status/u,
  );
});

test('assertOpenMasOsResultSummary accepts compact summaries and preserves child result refs', () => {
  const summary = assertOpenMasOsResultSummary(createResultSummary({
    childResultRefs: [
      'result_child_bruce_001',
    ],
  }));

  assert.equal(summary.kind, OPENMAS_OS_RESULT_RECORD_KINDS.resultSummary);
  assert.equal(summary.resultId, 'result_process_bruce_inspection_001');
  assert.equal(summary.producerLabel, 'Bruce');
  assert.deepEqual(summary.childResultRefs, ['result_child_bruce_001']);
});

test('assertOpenMasOsResultSummary enforces compact warning and failure semantics', () => {
  assert.throws(
    () => assertOpenMasOsResultSummary(createResultSummary({
      status: 'completed_with_warnings',
      warningCount: 0,
    })),
    /warningCount greater than 0/u,
  );

  assert.throws(
    () => assertOpenMasOsResultSummary(createResultSummary({
      status: 'completed',
      warningCount: 1,
    })),
    /Use "completed_with_warnings"/u,
  );

  assert.throws(
    () => assertOpenMasOsResultSummary(createResultSummary({
      status: 'failed',
      failure: null,
    })),
    /must include failure details/u,
  );
});

test('createOpenMasOsResultSummaryFromRecord derives a safe summary from a Result Record', () => {
  const summary = createOpenMasOsResultSummaryFromRecord(createResultRecord({
    childResultRefs: [
      'result_child_bruce_001',
    ],
  }));

  assert.equal(summary.kind, OPENMAS_OS_RESULT_RECORD_KINDS.resultSummary);
  assert.equal(summary.resultId, 'result_process_bruce_inspection_001');
  assert.equal(summary.status, 'completed');
  assert.equal(summary.producerLabel, 'bruce');
  assert.equal(summary.warningCount, 0);
  assert.deepEqual(summary.childResultRefs, ['result_child_bruce_001']);
});
