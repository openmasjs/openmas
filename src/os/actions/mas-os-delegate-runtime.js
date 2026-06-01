import { randomUUID } from 'node:crypto';
import {
  OPENMAS_OS_SYSTEM_CALL_KINDS,
  OPENMAS_OS_SYSTEM_CALL_SCHEMA_VERSION,
} from '../../contracts/os/openmas-os-system-call-contract.js';
import {
  DEFAULT_WAIT_INTERVAL_MS,
  DEFAULT_WAIT_TIMEOUT_MS,
  submitOpenMasOsSystemCall,
} from '../system-calls/system-call-client.js';

// User-mode OS affordance: submit a System Call, never materialize kernel state directly.
const DEFAULT_SYSTEM_CALL_TTL_MS = 30 * 60 * 1000;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function defaultNow() {
  return new Date().toISOString();
}

function normalizeNow(now) {
  return typeof now === 'function' ? now : defaultNow;
}

function normalizeArray(value) {
  if (value === undefined || value === null) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function normalizePositiveInteger(value, fallback, description) {
  if (value === undefined || value === null) {
    return fallback;
  }

  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${description} must be an integer greater than or equal to 1.`);
  }

  return value;
}

function normalizeBoolean(value, fallback = false) {
  if (value === undefined || value === null) {
    return fallback;
  }

  return value === true;
}

function normalizeDelegatedCommand(command) {
  if (!isNonEmptyString(command)) {
    return 'ask';
  }

  const normalizedCommand = command.trim();

  if (
    normalizedCommand === 'delegate'
    || normalizedCommand === 'mas.os.delegate'
    || normalizedCommand === 'mas-os-delegate'
  ) {
    return 'ask';
  }

  return normalizedCommand;
}

function normalizeParentContext(input) {
  if (isPlainObject(input.parentContext)) {
    return {
      jobId: input.parentContext.jobId ?? null,
      processId: input.parentContext.processId ?? null,
      threadId: input.parentContext.threadId ?? null,
    };
  }

  return {
    jobId: input.parentJobId ?? null,
    processId: input.parentProcessId ?? null,
    threadId: input.parentThreadId ?? null,
  };
}

function assertParentContext(input) {
  const parentContext = normalizeParentContext(input);

  if (!isNonEmptyString(parentContext.processId) || !isNonEmptyString(parentContext.threadId)) {
    throw new Error('mas.os.delegate requires parentContext.processId and parentContext.threadId.');
  }

  return parentContext;
}

function addMillisecondsToTimestamp(timestamp, milliseconds) {
  const timestampMs = Date.parse(timestamp);

  if (!Number.isFinite(timestampMs)) {
    return null;
  }

  return new Date(timestampMs + milliseconds).toISOString();
}

function createSystemCallId(input) {
  if (isNonEmptyString(input.systemCallId)) {
    return input.systemCallId.trim();
  }

  return `syscall_delegate_${randomUUID()}`;
}

function createActionRequestId({ input, invocationId }) {
  if (isNonEmptyString(input.actionRequestId)) {
    return input.actionRequestId.trim();
  }

  return `os_action_request_${invocationId}_${randomUUID()}`;
}

function createIdempotencyKey({ input, systemCallId }) {
  if (isNonEmptyString(input.idempotencyKey)) {
    return input.idempotencyKey.trim();
  }

  return `delegate:${systemCallId}`;
}

function buildDelegateSystemCall({
  input,
  operationalIdentityId,
  invocationId,
  toolRunId,
  nowTimestamp,
}) {
  const systemCallId = createSystemCallId(input);
  const actionRequestId = createActionRequestId({
    input,
    invocationId,
  });
  const parentContext = assertParentContext(input);

  return {
    kind: OPENMAS_OS_SYSTEM_CALL_KINDS.systemCall,
    schemaVersion: OPENMAS_OS_SYSTEM_CALL_SCHEMA_VERSION,
    systemCallId,
    operation: 'delegate',
    status: 'pending',
    requestedAt: nowTimestamp,
    requestedBy: {
      type: 'operational_identity',
      id: operationalIdentityId,
    },
    correlation: {
      invocationId,
      actionRequestId,
      toolRunId: isNonEmptyString(toolRunId) ? toolRunId.trim() : null,
      workflowRunId: null,
      conversationId: input.conversationId ?? null,
      jobId: parentContext.jobId,
      processId: parentContext.processId,
      threadId: parentContext.threadId,
    },
    idempotencyKey: createIdempotencyKey({
      input,
      systemCallId,
    }),
    expiresAt: input.expiresAt ?? addMillisecondsToTimestamp(nowTimestamp, DEFAULT_SYSTEM_CALL_TTL_MS),
    payload: {
      requesterOperationalIdentityId: operationalIdentityId,
      targetOperationalIdentityId: input.targetOperationalIdentityId,
      reason: input.reason ?? null,
      parentContext,
      child: {
        input: input.task,
        command: normalizeDelegatedCommand(input.command),
        mode: input.mode ?? 'probabilistic',
        conversationId: input.conversationId ?? null,
        priority: input.priority ?? 50,
        contextRefs: normalizeArray(input.contextRefs),
        artifactRefs: normalizeArray(input.artifactRefs),
        expectedOutput: input.expectedOutput ?? null,
      },
    },
  };
}

function summarizeSystemCallResult(result) {
  if (!result) {
    return null;
  }

  return {
    systemCallId: result.systemCallId,
    operation: result.operation,
    status: result.status,
    processedAt: result.processedAt,
    processedBy: result.processedBy,
    allowed: result.decision.allowed,
    reason: result.decision.reason,
    summary: result.summary,
    effects: result.effects,
    details: {
      idempotencyKey: result.details.idempotencyKey ?? null,
      delegationId: result.details.delegationId ?? null,
      authorizationRuleId: result.details.authorizationRuleId ?? null,
      parentProcessId: result.details.parentProcessId ?? null,
      parentThreadId: result.details.parentThreadId ?? null,
      parentProcessStatus: result.details.parentProcessStatus ?? null,
      parentThreadStatus: result.details.parentThreadStatus ?? null,
      childJobId: result.details.childJobId ?? null,
      childJobStatus: result.details.childJobStatus ?? null,
      targetOperationalIdentityId: result.details.targetOperationalIdentityId ?? null,
      childConversationId: result.details.childConversationId ?? null,
      conversationHandoff: result.details.conversationHandoff ?? null,
      reasonCode: result.details.reasonCode ?? null,
    },
  };
}

function buildPendingOutcome({ submission }) {
  const waitTimedOut = submission.wait.status === 'timeout';

  return {
    status: 'succeeded',
    summary: `OpenMAS OS delegation system call ${submission.systemCallId} was submitted and is pending kernel processing.`,
    data: {
      delegated: false,
      osAction: {
        actionType: 'delegate',
        status: 'submitted',
        runtimeAction: 'system_call_submitted',
      },
      systemCall: {
        systemCallId: submission.systemCallId,
        operation: submission.operation,
        status: 'pending',
        state: submission.state,
        systemCallPath: submission.systemCallPath,
        wait: submission.wait,
        result: null,
      },
      delegation: null,
      evidence: {
        runtimeAction: 'system_call_submitted',
        executionPerformed: false,
        eventTypes: [],
      },
      nextSafeActions: [
        'Keep the OpenMAS OS service running so it can process the pending delegation system call.',
        'Use openmas-os-service --status to inspect pending, completed, denied, or failed system calls.',
      ],
    },
    warnings: waitTimedOut
      ? [`OpenMAS OS did not publish a result for system call ${submission.systemCallId} within ${submission.wait.timeoutMs} ms.`]
      : [],
    errors: [],
  };
}

function buildCompletedOutcome({ submission, result }) {
  const details = result.details;

  return {
    status: 'succeeded',
    summary: result.summary,
    data: {
      delegated: true,
      osAction: {
        actionType: 'delegate',
        status: 'accepted',
        runtimeAction: 'system_call_completed',
        reason: result.decision.reason,
      },
      systemCall: {
        systemCallId: submission.systemCallId,
        operation: submission.operation,
        status: result.status,
        state: 'completed',
        systemCallPath: submission.systemCallPath,
        wait: submission.wait,
        result: summarizeSystemCallResult(result),
      },
      delegation: {
        delegationId: details.delegationId,
        authorizationRuleId: details.authorizationRuleId,
        parentProcessId: details.parentProcessId,
        parentThreadId: details.parentThreadId,
        parentProcessStatus: details.parentProcessStatus,
        parentThreadStatus: details.parentThreadStatus,
        childJobId: details.childJobId,
        childJobStatus: details.childJobStatus,
        targetOperationalIdentityId: details.targetOperationalIdentityId,
        childConversationId: details.childConversationId,
        conversationHandoff: details.conversationHandoff ?? null,
      },
      evidence: {
        runtimeAction: 'system_call_completed',
        executionPerformed: true,
        eventTypes: [
          'delegation.requested',
          'job.created',
          'thread.blocked',
          'process.blocked',
        ],
      },
      nextSafeActions: [
        'Dispatch the child Job when the OS service or scheduler is ready.',
        'Resume the parent Process when the child reports completion.',
      ],
    },
    warnings: result.warnings,
    errors: [],
  };
}

function buildDeniedOutcome({ submission, result }) {
  return {
    status: result.status === 'failed' ? 'failed' : result.status === 'denied' ? 'denied' : 'unavailable',
    summary: result.summary,
    data: {
      delegated: false,
      osAction: {
        actionType: 'delegate',
        status: result.status,
        runtimeAction: 'system_call_completed',
        reason: result.decision.reason,
        reasonCode: result.details.reasonCode ?? null,
      },
      systemCall: {
        systemCallId: submission.systemCallId,
        operation: submission.operation,
        status: result.status,
        state: result.status,
        systemCallPath: submission.systemCallPath,
        wait: submission.wait,
        result: summarizeSystemCallResult(result),
      },
      delegation: result.details.delegationId
        ? {
          delegationId: result.details.delegationId,
          status: result.details.delegationStatus ?? result.status,
          reason: result.decision.reason,
        }
        : null,
      nextSafeActions: [
        'Inspect the system call result for the denial or failure reason.',
        'Adjust delegation policy or parent runtime state before retrying if appropriate.',
      ],
    },
    warnings: result.warnings,
    errors: result.status === 'failed' ? [result.decision.reason] : [],
  };
}

function buildOutcomeFromSubmission(submission) {
  const { result } = submission;

  if (!result) {
    return buildPendingOutcome({
      submission,
    });
  }

  if (result.status === 'completed' || result.status === 'accepted') {
    return buildCompletedOutcome({
      submission,
      result,
    });
  }

  return buildDeniedOutcome({
    submission,
    result,
  });
}

export async function executeMasOsDelegate({
  input = {},
  projectRootPath,
  operationalIdentityId,
  invocationId,
  toolRunId = null,
  now = defaultNow,
} = {}) {
  if (!isPlainObject(input)) {
    throw new Error('mas.os.delegate input must be an object.');
  }

  if (Object.hasOwn(input, 'agentId')) {
    throw new Error('mas.os.delegate input must not include agentId. Delegate to an Operational Identity; OpenMAS resolves cognition internally.');
  }

  if (!isNonEmptyString(projectRootPath)) {
    throw new Error('mas.os.delegate requires projectRootPath.');
  }

  if (!isNonEmptyString(operationalIdentityId)) {
    throw new Error('mas.os.delegate requires operationalIdentityId.');
  }

  if (!isNonEmptyString(invocationId)) {
    throw new Error('mas.os.delegate requires invocationId.');
  }

  const nowFn = normalizeNow(now);
  const nowTimestamp = nowFn();
  const waitForResult = normalizeBoolean(input.waitForResult, false);
  const waitTimeoutMs = normalizePositiveInteger(
    input.waitTimeoutMs,
    DEFAULT_WAIT_TIMEOUT_MS,
    'mas.os.delegate waitTimeoutMs',
  );
  const waitIntervalMs = normalizePositiveInteger(
    input.waitIntervalMs,
    DEFAULT_WAIT_INTERVAL_MS,
    'mas.os.delegate waitIntervalMs',
  );
  const systemCall = buildDelegateSystemCall({
    input,
    operationalIdentityId,
    invocationId,
    toolRunId,
    nowTimestamp,
  });
  const submission = await submitOpenMasOsSystemCall({
    projectRootPath,
    systemCall,
    waitForResult,
    waitTimeoutMs,
    waitIntervalMs,
  });

  return buildOutcomeFromSubmission(submission);
}
