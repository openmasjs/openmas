import { randomUUID } from 'node:crypto';
import {
  OPENMAS_OS_KINDS,
  OPENMAS_OS_SCHEMA_VERSION,
  OPENMAS_OS_TERMINAL_PROCESS_STATUSES,
  assertOpenMasOsJob,
} from '../contracts/os/openmas-os-runtime-contract.js';
import {
  OPENMAS_OS_RESULT_RECORD_KINDS,
  OPENMAS_OS_RESULT_RECORD_SCHEMA_VERSION,
} from '../contracts/os/openmas-os-result-record-contract.js';
import { runAgentInvocation } from '../invocation/run-agent-invocation.js';
import { createLocalRuntimeAdapter } from './adapters/local-runtime-adapter.js';
import {
  createSafeErrorMessage,
  createSafeFailureSummaryFromInvocationResult,
} from './failure-summary.js';

function createSystemActor() {
  return {
    type: 'system',
    id: 'openmas-os',
  };
}

const TERMINAL_THREAD_STATUSES = new Set([
  'completed',
  'failed',
  'cancelled',
]);

export class OpenMasOsJobClaimError extends Error {
  constructor(message, {
    jobId,
    reasonCode,
    currentStatus = null,
  }) {
    super(message);
    this.name = 'OpenMasOsJobClaimError';
    this.jobId = jobId;
    this.reasonCode = reasonCode;
    this.currentStatus = currentStatus;
  }
}

export function isOpenMasOsJobClaimError(error) {
  return error instanceof OpenMasOsJobClaimError
    || error?.name === 'OpenMasOsJobClaimError';
}

function createEventId() {
  return `event_${randomUUID()}`;
}

function createRuntimeId(prefix) {
  return `${prefix}_${randomUUID()}`;
}

function defaultNow() {
  return new Date().toISOString();
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function firstNonEmptyString(values) {
  for (const value of values) {
    if (isNonEmptyString(value)) {
      return value.trim();
    }
  }

  return null;
}

function assertAdapter(adapter) {
  if (!adapter || typeof adapter !== 'object') {
    throw new Error('OpenMAS OS manual job execution requires a runtime adapter.');
  }

  for (const methodName of [
    'persistJob',
    'loadJob',
    'persistProcess',
    'persistThread',
    'appendEvent',
  ]) {
    if (typeof adapter[methodName] !== 'function') {
      throw new Error(`OpenMAS OS runtime adapter must implement ${methodName}.`);
    }
  }

  return adapter;
}

function assertResultRecordAdapter(adapter) {
  if (typeof adapter.persistResultRecord !== 'function') {
    throw new Error('OpenMAS OS runtime adapter must implement persistResultRecord for foreground Result materialization.');
  }

  return adapter;
}

function assertJobClaimAdapter(adapter) {
  if (typeof adapter.claimReadyJob !== 'function') {
    throw new Error('OpenMAS OS runtime adapter must implement claimReadyJob for Job execution.');
  }

  return adapter;
}

function createAdapter({ adapter = null, projectRootPath = null, osRootPath = null } = {}) {
  return adapter ?? createLocalRuntimeAdapter({ projectRootPath, osRootPath });
}

function normalizeNow(now) {
  if (typeof now === 'function') {
    return now;
  }

  return defaultNow;
}

function resolveInputText(inputRef) {
  if (!inputRef || inputRef.type === 'none') {
    return '';
  }

  if (inputRef.type === 'inline_text') {
    return inputRef.text ?? '';
  }

  throw new Error(`OpenMAS OS manual job execution does not support inputRef type "${inputRef.type}" yet.`);
}

function assertRunnableJob(job) {
  if (job.status !== 'ready') {
    throw new Error(`OpenMAS OS Job ${job.jobId} must be ready before runJobNow can execute it.`);
  }

  if (job.program.type !== 'agent_invocation') {
    throw new Error(`OpenMAS OS manual job execution only supports agent_invocation programs in this slice. Received: ${job.program.type}`);
  }
}

function assertClaimedReadyJob({
  claimResult,
  jobId,
}) {
  if (claimResult.claimed) {
    return claimResult.job;
  }

  if (claimResult.reason === 'job_claim_locked') {
    throw new OpenMasOsJobClaimError(
      `OpenMAS OS Job ${jobId} is already being claimed by another executor.`,
      {
        jobId,
        reasonCode: 'job_claim_locked',
        currentStatus: claimResult.job?.status ?? null,
      },
    );
  }

  throw new OpenMasOsJobClaimError(
    `OpenMAS OS Job ${jobId} must be ready before runJobNow can execute it.`
    + ` Current status: "${claimResult.job?.status ?? 'unknown'}".`,
    {
      jobId,
      reasonCode: claimResult.reason ?? 'job_not_claimed',
      currentStatus: claimResult.job?.status ?? null,
    },
  );
}

function resolveBrainToolExecution(invocationResult) {
  return invocationResult?.output?.brainToolExecution ?? invocationResult?.brainToolExecution ?? null;
}

function isSuccessfulDelegateToolExecution(toolExecution) {
  return toolExecution?.executionPerformed === true
    && toolExecution?.requestedToolId === 'mas.os.delegate'
    && toolExecution?.toolResultStatus === 'succeeded';
}

function delegationToolSubmittedSystemCall(invocationResult) {
  const toolExecution = resolveBrainToolExecution(invocationResult);
  const dataPreview = toolExecution?.observation?.dataPreview ?? null;

  return isSuccessfulDelegateToolExecution(toolExecution)
    && dataPreview?.systemCall?.operation === 'delegate'
    && dataPreview?.systemCall?.status === 'pending';
}

function delegationToolSucceeded(invocationResult) {
  const toolExecution = resolveBrainToolExecution(invocationResult);
  const dataPreview = toolExecution?.observation?.dataPreview ?? null;

  if (!isSuccessfulDelegateToolExecution(toolExecution)) {
    return false;
  }

  if (dataPreview?.systemCall?.operation === 'delegate') {
    return dataPreview.delegated === true;
  }

  return true;
}

function mapInvocationStatusToTerminalState(invocationResult) {
  if (delegationToolSubmittedSystemCall(invocationResult)) {
    return {
      jobStatus: 'active',
      processStatus: 'blocked',
      threadStatus: 'blocked',
      threadWaitReason: 'waiting_for_system_call',
      eventSuffix: null,
      terminal: false,
    };
  }

  if (delegationToolSucceeded(invocationResult)) {
    return {
      jobStatus: 'active',
      processStatus: 'blocked',
      threadStatus: 'blocked',
      threadWaitReason: 'waiting_for_child_process',
      eventSuffix: null,
      terminal: false,
    };
  }

  if (invocationResult.status === 'completed') {
    return {
      jobStatus: 'completed',
      processStatus: 'completed',
      threadStatus: 'completed',
      threadWaitReason: null,
      eventSuffix: 'completed',
      terminal: true,
    };
  }

  if (invocationResult.status === 'blocked') {
    return {
      jobStatus: 'failed',
      processStatus: 'failed',
      threadStatus: 'failed',
      threadWaitReason: null,
      eventSuffix: 'failed',
      terminal: true,
      failureReasonCode: 'unsupported_foreground_resource_wait',
      failureReason: 'OpenMAS OS cannot preserve a foreground resource wait until a supported resource wake path exists.',
    };
  }

  return {
    jobStatus: 'failed',
    processStatus: 'failed',
    threadStatus: 'failed',
    threadWaitReason: null,
    eventSuffix: 'failed',
    terminal: true,
  };
}

function isNonTerminalDelegationWaitMapping(statusMapping) {
  return statusMapping.terminal === false
    && statusMapping.jobStatus === 'active'
    && statusMapping.processStatus === 'blocked'
    && statusMapping.threadStatus === 'blocked'
    && [
      'waiting_for_system_call',
      'waiting_for_child_process',
    ].includes(statusMapping.threadWaitReason);
}

function runtimeStateAlreadyAdvanced({
  currentJob,
  currentProcess,
  currentThread,
  statusMapping,
}) {
  if (!isNonTerminalDelegationWaitMapping(statusMapping)) {
    return false;
  }

  if (currentJob.status !== 'active') {
    return true;
  }

  if (OPENMAS_OS_TERMINAL_PROCESS_STATUSES.has(currentProcess.status)) {
    return true;
  }

  if (TERMINAL_THREAD_STATUSES.has(currentThread.status)) {
    return true;
  }

  if (currentProcess.status === 'ready' || currentThread.status === 'ready') {
    return true;
  }

  return currentProcess.status === 'blocked'
    && currentThread.status === 'blocked'
    && currentThread.waitReason === 'waiting_for_child_process'
    && statusMapping.threadWaitReason === 'waiting_for_system_call';
}

function buildArtifactRefsFromInvocationResult(invocationResult) {
  if (!invocationResult?.persistence) {
    return [];
  }

  const artifactRefs = [];

  if (invocationResult.persistence.invocationSessionRecordPath) {
    artifactRefs.push({
      artifactId: `invocation_session_${invocationResult.invocationId}`,
      artifactKind: 'invocation_session',
      path: invocationResult.persistence.invocationSessionRecordPath,
    });
  }

  if (invocationResult.persistence.invocationReportPath) {
    artifactRefs.push({
      artifactId: `invocation_report_${invocationResult.invocationId}`,
      artifactKind: 'invocation_report',
      path: invocationResult.persistence.invocationReportPath,
    });
  }

  return artifactRefs;
}

function uniqueNonEmptyStrings(values) {
  const seenValues = new Set();
  const uniqueValues = [];

  for (const value of values) {
    if (!isNonEmptyString(value)) {
      continue;
    }

    const normalizedValue = value.trim();

    if (seenValues.has(normalizedValue)) {
      continue;
    }

    seenValues.add(normalizedValue);
    uniqueValues.push(normalizedValue);
  }

  return uniqueValues;
}

function calculateDurationMs(startedAt, finishedAt) {
  const startedAtMs = Date.parse(startedAt);
  const finishedAtMs = Date.parse(finishedAt);

  if (Number.isNaN(startedAtMs) || Number.isNaN(finishedAtMs)) {
    return null;
  }

  return Math.max(0, finishedAtMs - startedAtMs);
}

function invocationWarningsAffectResultTrust(invocationResult) {
  const verificationGate = invocationResult?.verificationGate
    ?? invocationResult?.output?.verificationGate
    ?? null;

  return verificationGate?.status === 'failed'
    || verificationGate?.verificationOutcome === 'not_verified'
    || invocationResult?.output?.actionResultAssessment?.answerGroundedInEvidence === false;
}

function shouldMaterializeForegroundResult({
  job,
  parentProcessId,
}) {
  return parentProcessId === null
    && job.trigger?.type === 'immediate';
}

function buildForegroundResultId({
  processId,
  phase,
}) {
  return `result_foreground_${phase}_${processId}`;
}

function resolveForegroundResponseMode(invocationOptions) {
  return firstNonEmptyString([
    invocationOptions?.responseMode,
    'wait_for_result',
  ]);
}

function buildForegroundResultProducer(processState) {
  return {
    type: 'process',
    id: processState.processId,
    operationalIdentityId: processState.operationalIdentityId,
    activeCognitiveIdentityId: processState.activeCognitiveIdentityId,
  };
}

function buildForegroundResultLineage({
  job,
  processState,
  thread,
  invocationResult = null,
  toolRunRefs = [],
  workflowRunRefs = [],
}) {
  return {
    jobId: job.jobId,
    processId: processState.processId,
    threadId: thread.threadId,
    parentProcessId: processState.parentProcessId,
    invocationId: invocationResult?.invocationId ?? null,
    toolRunId: toolRunRefs[0] ?? null,
    workflowRunId: workflowRunRefs[0] ?? null,
    conversationId: job.conversationId,
  };
}

function resolveBrainWorkflowExecution(invocationResult) {
  return invocationResult?.output?.brainWorkflowExecution
    ?? invocationResult?.brainWorkflowExecution
    ?? null;
}

function collectToolRunRefsFromInvocationResult(invocationResult) {
  const brainToolExecution = resolveBrainToolExecution(invocationResult);
  const observation = brainToolExecution?.observation ?? null;

  return uniqueNonEmptyStrings([
    invocationResult?.output?.toolRunId,
    invocationResult?.toolRunId,
    brainToolExecution?.toolRunId,
    observation?.toolRunId,
    invocationResult?.workCycle?.metadata?.toolRunId,
  ]);
}

function collectWorkflowRunRefsFromInvocationResult(invocationResult) {
  const brainWorkflowExecution = resolveBrainWorkflowExecution(invocationResult);
  const observation = brainWorkflowExecution?.observation ?? null;

  return uniqueNonEmptyStrings([
    invocationResult?.output?.workflowRunId,
    invocationResult?.workflowRunId,
    brainWorkflowExecution?.workflowRunId,
    observation?.workflowRunId,
    invocationResult?.workCycle?.metadata?.workflowRunId,
  ]);
}

function buildResultWarningsFromInvocationResult(invocationResult) {
  const warnings = Array.isArray(invocationResult?.warnings)
    ? invocationResult.warnings
    : [];
  const affectsResultTrust = invocationWarningsAffectResultTrust(invocationResult);

  return warnings.map((warning, index) => {
    const message = typeof warning === 'string'
      ? warning
      : firstNonEmptyString([
        warning?.message,
        warning?.reason,
        JSON.stringify(warning),
      ]);

    return {
      source: {
        type: 'agent_invocation',
        id: invocationResult?.invocationId ?? null,
      },
      severity: warning?.severity ?? 'warning',
      message: message ?? `Invocation warning ${index + 1}.`,
      affectsResultTrust: warning?.affectsResultTrust ?? affectsResultTrust,
      requiresHumanAction: warning?.requiresHumanAction ?? false,
      details: typeof warning === 'string'
        ? {}
        : {
          warning,
        },
    };
  });
}

function mapInvocationCompletionToResultStatus({
  statusMapping,
  warnings,
}) {
  if (statusMapping.processStatus === 'completed') {
    return warnings.length > 0
      ? 'completed_with_warnings'
      : 'completed';
  }

  if (statusMapping.processStatus === 'failed') {
    return 'failed';
  }

  if (statusMapping.processStatus === 'cancelled') {
    return 'cancelled';
  }

  return 'unknown';
}

function mapResultStatusToExitClass(status) {
  if (status === 'completed') {
    return 'success';
  }

  if (status === 'completed_with_warnings') {
    return 'warnings';
  }

  if (status === 'failed') {
    return 'failure';
  }

  if (status === 'cancelled') {
    return 'cancelled';
  }

  return 'unknown';
}

function buildResultFailure({
  failureSummary,
  invocationResult,
  failedAt,
}) {
  if (!failureSummary) {
    return null;
  }

  return {
    class: 'brain_failure',
    message: failureSummary.message ?? invocationResult?.message ?? 'OpenMAS OS Job invocation failed.',
    recoverable: failureSummary.reasonCode === 'unsupported_foreground_resource_wait',
    retryable: failureSummary.reasonCode === 'unsupported_foreground_resource_wait',
    reasonCode: failureSummary.reasonCode ?? 'invocation_failed',
    source: {
      type: 'agent_invocation',
      id: invocationResult?.invocationId ?? null,
    },
    failedAt,
    details: {
      reason: failureSummary.reason ?? null,
      source: failureSummary.source ?? 'openmas-os-run-job-now',
      invocationStatus: invocationResult?.status ?? null,
    },
  };
}

function mapVerificationGateStatus(verificationGate) {
  if (!verificationGate) {
    return 'unknown';
  }

  if (verificationGate.status === 'degraded') {
    return 'warning';
  }

  if (verificationGate.status === 'passed') {
    return 'passed';
  }

  if (verificationGate.status === 'failed') {
    return 'failed';
  }

  if (verificationGate.status === 'not_applicable') {
    return 'not_applicable';
  }

  if (verificationGate.verificationOutcome === 'verified') {
    return 'passed';
  }

  if (verificationGate.verificationOutcome === 'not_verified') {
    return 'failed';
  }

  if (verificationGate.verificationOutcome === 'partially_verified') {
    return 'warning';
  }

  return 'unknown';
}

function buildResultVerification(invocationResult) {
  const verificationGate = invocationResult?.verificationGate
    ?? invocationResult?.output?.verificationGate
    ?? null;

  return {
    status: mapVerificationGateStatus(verificationGate),
    grounded: verificationGate
      ? verificationGate.executionObserved ?? null
      : null,
    details: verificationGate
      ? {
        gateStatus: verificationGate.status ?? null,
        verificationOutcome: verificationGate.verificationOutcome ?? null,
        reason: verificationGate.reason ?? null,
      }
      : {},
  };
}

function buildForegroundAdmissionResultRecord({
  job,
  processState,
  thread,
  startedAt,
  invocationOptions,
}) {
  const responseMode = resolveForegroundResponseMode(invocationOptions);

  return {
    kind: OPENMAS_OS_RESULT_RECORD_KINDS.resultRecord,
    schemaVersion: OPENMAS_OS_RESULT_RECORD_SCHEMA_VERSION,
    resultId: buildForegroundResultId({
      processId: processState.processId,
      phase: 'admission',
    }),
    resultKind: 'foreground_admission_result',
    producer: buildForegroundResultProducer(processState),
    lineage: buildForegroundResultLineage({
      job,
      processState,
      thread,
    }),
    status: 'accepted',
    phase: 'admission',
    completion: {
      startedAt,
      completedAt: null,
      durationMs: null,
      exitClass: null,
    },
    summary: `OpenMAS OS accepted foreground Job ${job.jobId} and started Process ${processState.processId}.`,
    artifactRefs: [],
    toolRunRefs: [],
    workflowRunRefs: [],
    childResultRefs: [],
    warnings: [],
    failure: null,
    verification: {
      status: 'unknown',
      grounded: null,
      details: {},
    },
    visibility: {
      safeForHumanSummary: true,
      safeForAgentContext: true,
    },
    metadata: {
      responseMode,
      workReference: {
        jobId: job.jobId,
        processId: processState.processId,
        threadId: thread.threadId,
      },
    },
    createdAt: startedAt,
  };
}

function buildForegroundCompletionResultRecord({
  job,
  processState,
  thread,
  invocationResult,
  statusMapping,
  failureSummary,
  artifactRefs,
  startedAt,
  finishedAt,
  invocationOptions,
  recoveryStatus = null,
}) {
  const toolRunRefs = collectToolRunRefsFromInvocationResult(invocationResult);
  const workflowRunRefs = collectWorkflowRunRefsFromInvocationResult(invocationResult);
  const warnings = buildResultWarningsFromInvocationResult(invocationResult);
  const status = mapInvocationCompletionToResultStatus({
    statusMapping,
    warnings,
  });
  const responseMode = resolveForegroundResponseMode(invocationOptions);

  return {
    kind: OPENMAS_OS_RESULT_RECORD_KINDS.resultRecord,
    schemaVersion: OPENMAS_OS_RESULT_RECORD_SCHEMA_VERSION,
    resultId: buildForegroundResultId({
      processId: processState.processId,
      phase: 'completion',
    }),
    resultKind: 'foreground_completion_result',
    producer: buildForegroundResultProducer(processState),
    lineage: buildForegroundResultLineage({
      job,
      processState,
      thread,
      invocationResult,
      toolRunRefs,
      workflowRunRefs,
    }),
    status,
    phase: 'terminal',
    completion: {
      startedAt,
      completedAt: finishedAt,
      durationMs: calculateDurationMs(startedAt, finishedAt),
      exitClass: mapResultStatusToExitClass(status),
    },
    summary: firstNonEmptyString([
      invocationResult?.message,
      `OpenMAS OS foreground Job ${job.jobId} finished with status ${status}.`,
    ]),
    artifactRefs,
    toolRunRefs,
    workflowRunRefs,
    childResultRefs: [],
    warnings,
    failure: buildResultFailure({
      failureSummary,
      invocationResult,
      failedAt: finishedAt,
    }),
    verification: buildResultVerification(invocationResult),
    visibility: {
      safeForHumanSummary: true,
      safeForAgentContext: true,
    },
    metadata: {
      responseMode,
      invocationStatus: invocationResult?.status ?? null,
      command: job.program.command ?? null,
      mode: job.program.mode ?? null,
      triggerType: job.trigger?.type ?? null,
      actionResultAssessment: invocationResult?.output?.actionResultAssessment ?? null,
      ...(recoveryStatus ? {
        recovery: {
          status: recoveryStatus,
        },
      } : {}),
    },
    createdAt: finishedAt,
  };
}

function isResultRecordAlreadyExistsError(error) {
  return error instanceof Error && /OpenMAS OS Result Record .+ already exists/u.test(error.message);
}

function isResultRecordNotFoundError(error) {
  return error instanceof Error && /was not found/u.test(error.message);
}

async function resultRecordExists({
  adapter,
  resultId,
}) {
  try {
    await adapter.loadResultRecord(resultId);
    return true;
  } catch (error) {
    if (isResultRecordNotFoundError(error)) {
      return false;
    }

    throw error;
  }
}

async function persistResultRecordIfMissing({
  adapter,
  resultRecord,
}) {
  try {
    return await adapter.persistResultRecord(resultRecord);
  } catch (error) {
    if (isResultRecordAlreadyExistsError(error)) {
      return adapter.loadResultRecord(resultRecord.resultId);
    }

    throw error;
  }
}

function buildRecoveredForegroundInvocationResult(processState) {
  const failed = processState.status === 'failed';
  const failedMessage = processState.failureSummary?.message
    ?? 'OpenMAS OS recovered failed foreground work from durable terminal Process state.';

  return {
    invocationId: null,
    status: failed ? 'failed' : 'completed',
    message: failed
      ? failedMessage
      : 'OpenMAS OS recovered completed foreground evidence from durable terminal Process state.',
    warnings: processState.warnings ?? [],
    errors: failed ? [failedMessage] : [],
    persistence: null,
  };
}

export async function recoverUnlinkedForegroundCompletionResults({
  adapter = null,
  projectRootPath = null,
  osRootPath = null,
  now = defaultNow,
  isJobActive = null,
} = {}) {
  const runtimeAdapter = assertAdapter(createAdapter({ adapter, projectRootPath, osRootPath }));

  for (const methodName of [
    'listProcesses',
    'listThreads',
    'loadResultRecord',
  ]) {
    if (typeof runtimeAdapter[methodName] !== 'function') {
      throw new Error(`OpenMAS OS runtime adapter must implement ${methodName} for foreground Result recovery.`);
    }
  }

  const jobIsActive = typeof isJobActive === 'function' ? isJobActive : () => false;
  const recoveredAt = normalizeNow(now)();
  const terminalProcesses = (await runtimeAdapter.listProcesses())
    .filter((processState) => {
      return processState.parentProcessId === null
        && ['completed', 'failed'].includes(processState.status);
    });
  const recovery = {
    status: 'completed',
    observedAt: recoveredAt,
    scannedProcessCount: terminalProcesses.length,
    candidateCount: 0,
    recoveredCount: 0,
    activeExecutionSkippedCount: 0,
    legacySkippedCount: 0,
    failedCount: 0,
    recovered: [],
    failures: [],
  };

  for (const processState of terminalProcesses) {
    try {
      let job = await runtimeAdapter.loadJob(processState.jobId);
      const incompleteTerminalCommit = job.status === 'active';

      if (!shouldMaterializeForegroundResult({
        job,
        parentProcessId: processState.parentProcessId,
      })) {
        continue;
      }

      if (jobIsActive(job.jobId)) {
        recovery.activeExecutionSkippedCount += 1;
        continue;
      }

      if (job.status === 'active') {
        job = await runtimeAdapter.persistJob({
          ...job,
          status: processState.status,
          updatedAt: recoveredAt,
          failedAt: processState.status === 'failed'
            ? processState.failedAt ?? recoveredAt
            : null,
          failureSummary: processState.status === 'failed'
            ? processState.failureSummary ?? null
            : null,
        });
      }

      if (!['completed', 'failed'].includes(job.status)) {
        continue;
      }

      const resultId = buildForegroundResultId({
        processId: processState.processId,
        phase: 'completion',
      });

      try {
        await runtimeAdapter.loadResultRecord(resultId);
        continue;
      } catch (error) {
        if (!isResultRecordNotFoundError(error)) {
          throw error;
        }
      }

      const hasForegroundProvenance = incompleteTerminalCommit
        || job.failureSummary?.reasonCode === 'stale_running_cli_invocation_recovered'
        || await resultRecordExists({
          adapter: runtimeAdapter,
          resultId: buildForegroundResultId({
            processId: processState.processId,
            phase: 'admission',
          }),
        });

      if (!hasForegroundProvenance) {
        recovery.legacySkippedCount += 1;
        continue;
      }

      const thread = (await runtimeAdapter.listThreads({ processId: processState.processId }))
        .filter((candidate) => TERMINAL_THREAD_STATUSES.has(candidate.status))
        .sort((left, right) => {
          return (right.completedAt ?? right.failedAt ?? right.updatedAt)
            .localeCompare(left.completedAt ?? left.failedAt ?? left.updatedAt);
        })[0] ?? null;

      if (!thread) {
        continue;
      }

      recovery.candidateCount += 1;
      const invocationResult = buildRecoveredForegroundInvocationResult(processState);
      const statusMapping = mapInvocationStatusToTerminalState(invocationResult);
      const finishedAt = processState.completedAt ?? processState.failedAt ?? processState.updatedAt;
      const resultRecord = await persistResultRecordIfMissing({
        adapter: assertResultRecordAdapter(runtimeAdapter),
        resultRecord: buildForegroundCompletionResultRecord({
          job,
          processState,
          thread,
          invocationResult,
          statusMapping,
          failureSummary: processState.failureSummary ?? job.failureSummary ?? null,
          artifactRefs: processState.artifactRefs ?? [],
          startedAt: processState.startedAt,
          finishedAt,
          invocationOptions: {},
          recoveryStatus: 'recovered_terminal_foreground_result',
        }),
      });

      await appendLifecycleEvent({
        adapter: runtimeAdapter,
        eventType: 'foreground.completion_result.recovered',
        source: createSystemActor(),
        targetType: 'process',
        targetId: processState.processId,
        jobId: job.jobId,
        processId: processState.processId,
        threadId: thread.threadId,
        occurredAt: recoveredAt,
        payload: {
          resultId: resultRecord.resultId,
          recoveryStatus: 'recovered_terminal_foreground_result',
        },
      });

      recovery.recovered.push({
        jobId: job.jobId,
        processId: processState.processId,
        resultId: resultRecord.resultId,
        resultStatus: resultRecord.status,
      });
      recovery.recoveredCount += 1;
    } catch (error) {
      recovery.failedCount += 1;
      recovery.failures.push({
        processId: processState.processId,
        jobId: processState.jobId,
        errorMessage: createSafeErrorMessage(error, 'Foreground Result recovery failed.'),
      });
    }
  }

  if (recovery.failedCount > 0) {
    recovery.status = 'completed_with_failures';
  }

  return recovery;
}

function resolveActiveCognitiveIdentityIdForOsProcess({ invocationResult }) {
  return firstNonEmptyString([
    invocationResult?.readiness?.activeCognitiveSet?.primaryCognitiveIdentityId,
    invocationResult?.workCycle?.primaryCognitiveIdentityId,
    invocationResult?.primaryCognitiveIdentityId,
  ]);
}

function buildInvocationOptionsFromJob({
  job,
  projectRootPath,
  invocationOptions,
  processState,
  thread,
}) {
  const options = {
    ...invocationOptions,
    projectRootPath,
    operationalIdentityId: job.assignedOperationalIdentityId,
    invocationMode: job.program.mode,
    command: job.program.command,
    inputText: resolveInputText(job.inputRef),
    requestedBy: job.createdBy.id,
    osRuntimeContext: {
      jobId: job.jobId,
      processId: processState.processId,
      threadId: thread.threadId,
      parentProcessId: processState.parentProcessId,
      source: 'openmas-os-run-job-now',
    },
  };

  if (job.conversationId) {
    options.conversationRef = job.conversationId;
  }

  return options;
}

async function appendLifecycleEvent({
  adapter,
  eventType,
  source,
  targetType,
  targetId,
  jobId = null,
  processId = null,
  threadId = null,
  occurredAt,
  payload = {},
}) {
  return adapter.appendEvent({
    kind: OPENMAS_OS_KINDS.event,
    schemaVersion: OPENMAS_OS_SCHEMA_VERSION,
    eventId: createEventId(),
    eventType,
    source,
    targetRef: {
      type: targetType,
      id: targetId,
    },
    jobId,
    processId,
    threadId,
    occurredAt,
    payload,
  });
}

export async function createJob({
  adapter = null,
  projectRootPath = null,
  osRootPath = null,
  job,
  now = defaultNow,
} = {}) {
  const runtimeAdapter = assertAdapter(createAdapter({ adapter, projectRootPath, osRootPath }));
  const nowFn = normalizeNow(now);
  const normalizedJob = assertOpenMasOsJob(job);
  const persistedJob = await runtimeAdapter.persistJob(normalizedJob);

  await appendLifecycleEvent({
    adapter: runtimeAdapter,
    eventType: 'job.created',
    source: persistedJob.createdBy,
    targetType: 'job',
    targetId: persistedJob.jobId,
    jobId: persistedJob.jobId,
    occurredAt: nowFn(),
    payload: {
      status: persistedJob.status,
      assignedOperationalIdentityId: persistedJob.assignedOperationalIdentityId,
      programType: persistedJob.program.type,
    },
  });

  return persistedJob;
}

export async function admitJob({
  adapter = null,
  projectRootPath = null,
  osRootPath = null,
  jobId,
  now = defaultNow,
} = {}) {
  const runtimeAdapter = assertAdapter(createAdapter({ adapter, projectRootPath, osRootPath }));
  const nowFn = normalizeNow(now);
  const job = await runtimeAdapter.loadJob(jobId);

  if (!['draft', 'admitted'].includes(job.status)) {
    throw new Error(`OpenMAS OS Job ${job.jobId} cannot be admitted from status "${job.status}".`);
  }

  const admittedJob = await runtimeAdapter.persistJob({
    ...job,
    status: 'ready',
    updatedAt: nowFn(),
  });

  await appendLifecycleEvent({
    adapter: runtimeAdapter,
    eventType: 'job.admitted',
    source: createSystemActor(),
    targetType: 'job',
    targetId: admittedJob.jobId,
    jobId: admittedJob.jobId,
    occurredAt: admittedJob.updatedAt,
    payload: {
      status: admittedJob.status,
    },
  });

  return admittedJob;
}

export async function runJobNow({
  adapter = null,
  projectRootPath,
  osRootPath = null,
  jobId,
  parentProcessId = null,
  now = defaultNow,
  invocationRunner = runAgentInvocation,
  invocationOptions = {},
} = {}) {
  const runtimeAdapter = assertAdapter(createAdapter({ adapter, projectRootPath, osRootPath }));
  const jobClaimAdapter = assertJobClaimAdapter(runtimeAdapter);
  const nowFn = normalizeNow(now);
  const loadedJob = await runtimeAdapter.loadJob(jobId);

  assertRunnableJob(loadedJob);

  const processId = createRuntimeId('process');
  const threadId = createRuntimeId('thread');
  const startedAt = nowFn();
  const activeJob = assertClaimedReadyJob({
    claimResult: await jobClaimAdapter.claimReadyJob({
      jobId: loadedJob.jobId,
      claimedAt: startedAt,
      ownerId: 'runJobNow',
    }),
    jobId: loadedJob.jobId,
  });

  await appendLifecycleEvent({
    adapter: runtimeAdapter,
    eventType: 'job.activated',
    source: createSystemActor(),
    targetType: 'job',
    targetId: activeJob.jobId,
    jobId: activeJob.jobId,
    occurredAt: startedAt,
    payload: {
      status: activeJob.status,
    },
  });

  let processState = await runtimeAdapter.persistProcess({
    kind: OPENMAS_OS_KINDS.process,
    schemaVersion: OPENMAS_OS_SCHEMA_VERSION,
    processId,
    jobId: activeJob.jobId,
    status: 'running',
    operationalIdentityId: activeJob.assignedOperationalIdentityId,
    activeCognitiveIdentityId: null,
    currentThreadId: threadId,
    parentProcessId: parentProcessId ?? null,
    childProcessIds: [],
    conversationId: activeJob.conversationId,
    memoryContextRefs: [],
    artifactRefs: [],
    credentialReferenceIds: [],
    pendingApprovalRefs: [],
    warnings: [],
    createdAt: startedAt,
    startedAt,
    updatedAt: startedAt,
    completedAt: null,
  });

  await appendLifecycleEvent({
    adapter: runtimeAdapter,
    eventType: 'process.created',
    source: createSystemActor(),
    targetType: 'process',
    targetId: processId,
    jobId: activeJob.jobId,
    processId,
    occurredAt: startedAt,
    payload: {
      status: processState.status,
      operationalIdentityId: processState.operationalIdentityId,
      parentProcessId: processState.parentProcessId,
    },
  });

  let thread = await runtimeAdapter.persistThread({
    kind: OPENMAS_OS_KINDS.thread,
    schemaVersion: OPENMAS_OS_SCHEMA_VERSION,
    threadId,
    processId,
    jobId: activeJob.jobId,
    status: 'running',
    threadType: 'agent_invocation',
    priority: activeJob.priority,
    attempt: 1,
    waitReason: null,
    dueAt: null,
    createdAt: startedAt,
    startedAt,
    updatedAt: startedAt,
    completedAt: null,
  });

  await appendLifecycleEvent({
    adapter: runtimeAdapter,
    eventType: 'thread.created',
    source: createSystemActor(),
    targetType: 'thread',
    targetId: threadId,
    jobId: activeJob.jobId,
    processId,
    threadId,
    occurredAt: startedAt,
    payload: {
      status: thread.status,
      threadType: thread.threadType,
    },
  });
  await appendLifecycleEvent({
    adapter: runtimeAdapter,
    eventType: 'thread.started',
    source: createSystemActor(),
    targetType: 'thread',
    targetId: threadId,
    jobId: activeJob.jobId,
    processId,
    threadId,
    occurredAt: startedAt,
    payload: {
      status: thread.status,
    },
  });

  const shouldMaterializeForegroundResults = shouldMaterializeForegroundResult({
    job: activeJob,
    parentProcessId: parentProcessId ?? null,
  });
  const resultRecordAdapter = shouldMaterializeForegroundResults
    ? assertResultRecordAdapter(runtimeAdapter)
    : null;
  const foregroundAdmissionResult = shouldMaterializeForegroundResults
    ? await resultRecordAdapter.persistResultRecord(buildForegroundAdmissionResultRecord({
      job: activeJob,
      processState,
      thread,
      startedAt,
      invocationOptions,
    }))
    : null;

  let invocationResult;

  try {
    invocationResult = await invocationRunner(buildInvocationOptionsFromJob({
      job: activeJob,
      projectRootPath,
      invocationOptions,
      processState,
      thread,
    }));
  } catch (error) {
    const safeMessage = createSafeErrorMessage(error, 'OpenMAS OS invocation runner failed.');

    invocationResult = {
      invocationId: createRuntimeId('invocation_failure'),
      status: 'failed',
      message: safeMessage,
      warnings: [],
      errors: [safeMessage],
      persistence: null,
    };
  }

  const finishedAt = nowFn();
  const statusMapping = mapInvocationStatusToTerminalState(invocationResult);
  const failureSummary = statusMapping.eventSuffix === 'failed' || invocationResult.status === 'failed'
    ? createSafeFailureSummaryFromInvocationResult({
      invocationResult,
      failedAt: finishedAt,
      source: 'openmas-os-run-job-now',
      reasonCode: statusMapping.failureReasonCode ?? 'invocation_failed',
      reason: statusMapping.failureReason ?? 'OpenMAS OS Job invocation failed.',
    })
    : null;
  const artifactRefs = buildArtifactRefsFromInvocationResult(invocationResult);
  const warnings = invocationResult.warnings ?? [];
  const currentJob = await runtimeAdapter.loadJob(activeJob.jobId);
  const currentProcessState = await runtimeAdapter.loadProcess(processState.processId);
  const currentThreadId = currentProcessState.currentThreadId ?? thread.threadId;
  const currentThread = await runtimeAdapter.loadThread(currentThreadId);

  if (runtimeStateAlreadyAdvanced({
    currentJob,
    currentProcess: currentProcessState,
    currentThread,
    statusMapping,
  })) {
    await appendLifecycleEvent({
      adapter: runtimeAdapter,
      eventType: 'job.finalization_skipped',
      source: createSystemActor(),
      targetType: 'job',
      targetId: currentJob.jobId,
      jobId: currentJob.jobId,
      processId: currentProcessState.processId,
      threadId: currentThread.threadId,
      occurredAt: finishedAt,
      payload: {
        reason: 'runtime_state_already_advanced',
        requestedJobStatus: statusMapping.jobStatus,
        requestedProcessStatus: statusMapping.processStatus,
        requestedThreadStatus: statusMapping.threadStatus,
        requestedThreadWaitReason: statusMapping.threadWaitReason,
        currentJobStatus: currentJob.status,
        currentProcessStatus: currentProcessState.status,
        currentThreadStatus: currentThread.status,
        currentThreadWaitReason: currentThread.waitReason,
        invocationId: invocationResult.invocationId,
        invocationStatus: invocationResult.status,
        authoritativeStateChanged: false,
        ...(failureSummary ? {
          failedAt: finishedAt,
          failureSummary,
        } : {}),
      },
    });

    return {
      job: currentJob,
      process: currentProcessState,
      thread: currentThread,
      invocationResult,
      foregroundAdmissionResult,
      foregroundCompletionResult: null,
    };
  }

  thread = await runtimeAdapter.persistThread({
    ...thread,
    status: statusMapping.threadStatus,
    waitReason: statusMapping.threadWaitReason,
    updatedAt: finishedAt,
    completedAt: statusMapping.terminal
      ? finishedAt
      : null,
    failedAt: statusMapping.threadStatus === 'failed' ? finishedAt : null,
    failureSummary: statusMapping.threadStatus === 'failed' ? failureSummary : null,
  });

  processState = await runtimeAdapter.persistProcess({
    ...processState,
    status: statusMapping.processStatus,
    activeCognitiveIdentityId: resolveActiveCognitiveIdentityIdForOsProcess({
      invocationResult,
    }),
    currentThreadId: statusMapping.terminal
      ? null
      : thread.threadId,
    artifactRefs,
    warnings,
    updatedAt: finishedAt,
    completedAt: statusMapping.terminal
      ? finishedAt
      : null,
    failedAt: statusMapping.processStatus === 'failed' ? finishedAt : null,
    failureSummary: statusMapping.processStatus === 'failed' ? failureSummary : null,
  });

  const job = await runtimeAdapter.persistJob({
    ...activeJob,
    status: statusMapping.jobStatus,
    updatedAt: finishedAt,
    failedAt: statusMapping.jobStatus === 'failed' ? finishedAt : null,
    failureSummary: statusMapping.jobStatus === 'failed' ? failureSummary : null,
  });

  if (statusMapping.eventSuffix) {
    await appendLifecycleEvent({
      adapter: runtimeAdapter,
      eventType: `thread.${statusMapping.eventSuffix}`,
      source: createSystemActor(),
      targetType: 'thread',
      targetId: thread.threadId,
      jobId: job.jobId,
      processId: processState.processId,
      threadId: thread.threadId,
      occurredAt: finishedAt,
      payload: {
        status: thread.status,
        invocationId: invocationResult.invocationId,
        invocationStatus: invocationResult.status,
        ...(failureSummary ? {
          failedAt: thread.failedAt,
          failureSummary,
        } : {}),
      },
    });
    await appendLifecycleEvent({
      adapter: runtimeAdapter,
      eventType: `process.${statusMapping.eventSuffix}`,
      source: createSystemActor(),
      targetType: 'process',
      targetId: processState.processId,
      jobId: job.jobId,
      processId: processState.processId,
      occurredAt: finishedAt,
      payload: {
        status: processState.status,
        invocationId: invocationResult.invocationId,
        invocationStatus: invocationResult.status,
        ...(failureSummary ? {
          failedAt: processState.failedAt,
          failureSummary,
        } : {}),
      },
    });
    await appendLifecycleEvent({
      adapter: runtimeAdapter,
      eventType: `job.${statusMapping.eventSuffix}`,
      source: createSystemActor(),
      targetType: 'job',
      targetId: job.jobId,
      jobId: job.jobId,
      processId: processState.processId,
      threadId: thread.threadId,
      occurredAt: finishedAt,
      payload: {
        status: job.status,
        invocationId: invocationResult.invocationId,
        invocationStatus: invocationResult.status,
        ...(failureSummary ? {
          failedAt: job.failedAt,
          failureSummary,
        } : {}),
      },
    });
  }

  const foregroundCompletionResult = shouldMaterializeForegroundResults && statusMapping.terminal
    ? await resultRecordAdapter.persistResultRecord(buildForegroundCompletionResultRecord({
      job,
      processState,
      thread,
      invocationResult,
      statusMapping,
      failureSummary,
      artifactRefs,
      startedAt,
      finishedAt,
      invocationOptions,
    }))
    : null;

  return {
    job,
    process: processState,
    thread,
    invocationResult,
    foregroundAdmissionResult,
    foregroundCompletionResult,
  };
}
