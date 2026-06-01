import { randomUUID } from 'node:crypto';
import {
  OPENMAS_OS_ACTION_KINDS,
  OPENMAS_OS_ACTION_RESULT_ACTION_TYPES,
  OPENMAS_OS_ACTION_SCHEMA_VERSION,
  OPENMAS_OS_ACTION_TYPES,
  assertOpenMasOsActionRequest,
  assertOpenMasOsActionResult,
} from '../../contracts/os/openmas-os-action-request-contract.js';
import {
  evaluateDelegationPolicy,
  getDelegationPolicyAllowedRequesters,
} from '../delegation/delegation-policy.js';

const SECRET_VALUE_REDACTION_PATTERNS = Object.freeze([
  /sk-(?:or-)?[a-zA-Z0-9_-]{8,}/gu,
  /AIza[a-zA-Z0-9_-]{10,}/gu,
  /xox[baprs]-[a-zA-Z0-9-]{8,}/gu,
  /Bearer\s+[a-zA-Z0-9._~+/-]{12,}/giu,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/gu,
]);

const SAFE_IDENTIFIER_PATTERN = /^[a-zA-Z0-9._-]+$/u;
const SCHEDULE_DELEGATION_DELAY_GRACE_MS = 120000;

function defaultNow() {
  return new Date().toISOString();
}

function normalizeNow(now) {
  if (now === undefined || now === null) {
    return defaultNow;
  }

  if (typeof now !== 'function') {
    throw new Error('OpenMAS OS Action Gate now must be a function when provided.');
  }

  return now;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function redactSecretLikeValues(value) {
  const stringValue = String(value ?? '');
  let redactedValue = stringValue;

  for (const pattern of SECRET_VALUE_REDACTION_PATTERNS) {
    redactedValue = redactedValue.replace(pattern, '[redacted-secret]');
  }

  return redactedValue.slice(0, 1000);
}

function createSafeErrorMessage(error, fallbackMessage = 'OpenMAS OS Action Gate rejected the request.') {
  if (error instanceof Error && isNonEmptyString(error.message)) {
    return redactSecretLikeValues(error.message);
  }

  if (isNonEmptyString(error)) {
    return redactSecretLikeValues(error);
  }

  return fallbackMessage;
}

function safeIdentifierOrFallback(value, fallback) {
  if (!isNonEmptyString(value)) {
    return fallback;
  }

  const normalizedValue = value.trim();

  return SAFE_IDENTIFIER_PATTERN.test(normalizedValue) ? normalizedValue : fallback;
}

function resolveRawActionRequestId(request) {
  return isPlainObject(request)
    ? safeIdentifierOrFallback(request.actionRequestId, `invalid_action_request_${randomUUID()}`)
    : `invalid_action_request_${randomUUID()}`;
}

function resolveRawActionType(request) {
  if (!isPlainObject(request) || !isNonEmptyString(request.actionType)) {
    return 'invalid_request';
  }

  const normalizedActionType = request.actionType.trim();

  return OPENMAS_OS_ACTION_RESULT_ACTION_TYPES.has(normalizedActionType)
    ? normalizedActionType
    : 'invalid_request';
}

function createSystemActor() {
  return {
    type: 'system',
    id: 'openmas-os',
  };
}

function normalizeRuntimeRequester(runtimeRequester) {
  if (runtimeRequester === undefined || runtimeRequester === null) {
    return null;
  }

  if (!isPlainObject(runtimeRequester)) {
    throw new Error('OpenMAS OS Action Gate runtimeRequester must be an actor object when provided.');
  }

  return {
    type: safeIdentifierOrFallback(runtimeRequester.type, 'invalid'),
    id: safeIdentifierOrFallback(runtimeRequester.id, 'invalid'),
  };
}

function matchesAllowedRequester(allowedRequester, requestedBy) {
  if (typeof allowedRequester === 'string') {
    return requestedBy.id === allowedRequester;
  }

  if (!isPlainObject(allowedRequester)) {
    return false;
  }

  const allowedType = allowedRequester.type ?? requestedBy.type;
  const allowedId = allowedRequester.id ?? allowedRequester.operationalIdentityId;

  return (allowedType === '*' || allowedType === requestedBy.type)
    && (allowedId === '*' || allowedId === requestedBy.id);
}

function isRequesterAllowed({ requestedBy, allowedRequesters, allowedRequesterTypes }) {
  if (!allowedRequesterTypes.includes(requestedBy.type)) {
    return {
      allowed: false,
      reasonCode: 'requester_type_not_allowed',
      reason: `Requester type "${requestedBy.type}" is not allowed to initiate OpenMAS OS actions in this gate.`,
    };
  }

  if (!Array.isArray(allowedRequesters) || allowedRequesters.length === 0) {
    return {
      allowed: false,
      reasonCode: 'requester_not_allowed',
      reason: `Requester ${requestedBy.type}:${requestedBy.id} is not explicitly allowed to initiate OpenMAS OS actions.`,
    };
  }

  if (allowedRequesters.some((allowedRequester) => matchesAllowedRequester(allowedRequester, requestedBy))) {
    return {
      allowed: true,
      reasonCode: 'requester_allowed',
      reason: 'Requester is explicitly allowed to initiate OpenMAS OS actions.',
    };
  }

  return {
    allowed: false,
    reasonCode: 'requester_not_allowed',
    reason: `Requester ${requestedBy.type}:${requestedBy.id} is not explicitly allowed to initiate OpenMAS OS actions.`,
  };
}

function evaluateRuntimeRequester({ actionRequest, runtimeRequester }) {
  if (!runtimeRequester) {
    return {
      allowed: true,
      reasonCode: 'runtime_requester_not_provided',
      reason: 'No runtime requester was provided for cross-checking.',
    };
  }

  if (
    runtimeRequester.type === actionRequest.requestedBy.type
    && runtimeRequester.id === actionRequest.requestedBy.id
  ) {
    return {
      allowed: true,
      reasonCode: 'runtime_requester_matches',
      reason: 'Runtime requester matches the OS Action Request requester.',
    };
  }

  return {
    allowed: false,
    reasonCode: 'runtime_requester_mismatch',
    reason: `Runtime requester ${runtimeRequester.type}:${runtimeRequester.id} does not match request requester ${actionRequest.requestedBy.type}:${actionRequest.requestedBy.id}.`,
  };
}

function createActionResult({
  actionRequest = null,
  actionRequestId,
  actionType,
  status,
  reason,
  payload = {},
  warnings = [],
  nowTimestamp,
  actionResultId = null,
}) {
  const resolvedActionRequestId = actionRequest?.actionRequestId ?? actionRequestId;
  const resolvedActionType = actionRequest?.actionType ?? actionType;

  return assertOpenMasOsActionResult({
    kind: OPENMAS_OS_ACTION_KINDS.result,
    schemaVersion: OPENMAS_OS_ACTION_SCHEMA_VERSION,
    actionResultId: actionResultId ?? `os_action_result_${resolvedActionRequestId}`,
    actionRequestId: resolvedActionRequestId,
    actionType: resolvedActionType,
    status,
    createdBy: createSystemActor(),
    reason,
    payload,
    evidenceRefs: [],
    warnings,
    createdAt: nowTimestamp,
    updatedAt: nowTimestamp,
    completedAt: ['completed', 'failed', 'cancelled', 'rejected'].includes(status) ? nowTimestamp : null,
  });
}

function createRejectedInvalidRequestResult({ request, error, nowTimestamp }) {
  const actionRequestId = resolveRawActionRequestId(request);
  const errorMessage = createSafeErrorMessage(error);

  return createActionResult({
    actionRequestId,
    actionType: resolveRawActionType(request),
    status: 'rejected',
    reason: `OpenMAS OS Action Request rejected: ${errorMessage}`,
    payload: {
      decision: 'rejected',
      reasonCode: 'invalid_request',
      errorMessage,
      nextSafeActions: [
        'Correct the OS Action Request envelope and retry.',
        'Ask the Operational Identity to restate the request with a supported OS action.',
      ],
    },
    nowTimestamp,
  });
}

function createRejectedResult({ actionRequest, reasonCode, reason, nowTimestamp }) {
  return createActionResult({
    actionRequest,
    status: 'rejected',
    reason,
    payload: {
      decision: 'rejected',
      reasonCode,
      nextSafeActions: [
        'Do not execute the OS action.',
        'Ask for administrator configuration or clarification when appropriate.',
      ],
    },
    nowTimestamp,
  });
}

function createRejectedPolicyResult({ actionRequest, policyDecision, nowTimestamp }) {
  return createActionResult({
    actionRequest,
    status: 'rejected',
    reason: policyDecision.reason,
    payload: {
      decision: 'rejected',
      reasonCode: policyDecision.reasonCode,
      policyEffect: policyDecision.effect,
      matchedRule: policyDecision.matchedRule,
      nextSafeActions: [
        'Do not execute the OS action.',
        'Ask an administrator to author or update the OpenMAS delegation policy when this delegation should be allowed.',
      ],
    },
    nowTimestamp,
  });
}

function createBlockedResult({ actionRequest, reasonCode, reason, payload = {}, nowTimestamp }) {
  return createActionResult({
    actionRequest,
    status: 'blocked',
    reason,
    payload: {
      decision: 'blocked',
      reasonCode,
      ...payload,
    },
    nowTimestamp,
  });
}

function createAcceptedResult({ actionRequest, payload = {}, warnings = [], nowTimestamp }) {
  return createActionResult({
    actionRequest,
    status: 'accepted',
    reason: `OpenMAS OS Action Request ${actionRequest.actionType} accepted by the OS Action Gate.`,
    payload: {
      decision: 'accepted',
      reasonCode: 'accepted_by_os_action_gate',
      runtimeAction: `route_to_${actionRequest.actionType}_handler`,
      executionPerformed: false,
      ...payload,
    },
    warnings,
    nowTimestamp,
  });
}

function hasRunnableParentContext(actionRequest) {
  return isNonEmptyString(actionRequest.parentContext?.processId)
    && isNonEmptyString(actionRequest.parentContext?.threadId);
}

function assertTargetIsNotRequester(actionRequest) {
  if (actionRequest.payload.targetOperationalIdentityId === actionRequest.requestedBy.id) {
    return {
      allowed: false,
      reasonCode: 'self_delegation_not_allowed',
      reason: `Requester ${actionRequest.requestedBy.id} cannot delegate an OS action to itself.`,
    };
  }

  return {
    allowed: true,
  };
}

function evaluateConfiguredDelegationPolicy({ actionRequest, delegationPolicy, nowTimestamp }) {
  if (delegationPolicy === undefined || delegationPolicy === null) {
    return {
      actionResult: null,
      policyDecision: null,
    };
  }

  let policyDecision;

  try {
    policyDecision = evaluateDelegationPolicy({
      actionRequest,
      delegationPolicy,
    });
  } catch (error) {
    return {
      actionResult: createRejectedResult({
        actionRequest,
        reasonCode: 'invalid_delegation_policy',
        reason: `OpenMAS delegation policy rejected the request because the policy is invalid: ${createSafeErrorMessage(error)}`,
        nowTimestamp,
      }),
      policyDecision: null,
    };
  }

  if (!policyDecision.authorized) {
    return {
      actionResult: createRejectedPolicyResult({
        actionRequest,
        policyDecision,
        nowTimestamp,
      }),
      policyDecision,
    };
  }

  return {
    actionResult: null,
    policyDecision,
  };
}

function evaluateDelegateRequest({ actionRequest, nowTimestamp, delegationPolicy = null }) {
  const selfDelegation = assertTargetIsNotRequester(actionRequest);

  if (!selfDelegation.allowed) {
    return createRejectedResult({
      actionRequest,
      reasonCode: selfDelegation.reasonCode,
      reason: selfDelegation.reason,
      nowTimestamp,
    });
  }

  const policyEvaluation = evaluateConfiguredDelegationPolicy({
    actionRequest,
    delegationPolicy,
    nowTimestamp,
  });

  if (policyEvaluation.actionResult) {
    return policyEvaluation.actionResult;
  }

  if (!hasRunnableParentContext(actionRequest)) {
    return createBlockedResult({
      actionRequest,
      reasonCode: 'parent_context_required',
      reason: 'Delegation requires a parent Process and Thread context before execution.',
      payload: {
        missingContext: {
          processId: actionRequest.parentContext.processId === null,
          threadId: actionRequest.parentContext.threadId === null,
        },
        nextSafeActions: [
          'Run this OS action from an OS-managed parent Process.',
          'Create parent OS context before attempting delegation.',
        ],
      },
      nowTimestamp,
    });
  }

  return createAcceptedResult({
    actionRequest,
    payload: {
      targetOperationalIdentityId: actionRequest.payload.targetOperationalIdentityId,
      command: actionRequest.payload.command,
      mode: actionRequest.payload.mode,
      parentProcessId: actionRequest.parentContext.processId,
      parentThreadId: actionRequest.parentContext.threadId,
      contextRefCount: actionRequest.payload.contextRefs.length,
      artifactRefCount: actionRequest.payload.artifactRefs.length,
      delegationPolicyRuleId: policyEvaluation.policyDecision?.matchedRule?.ruleId ?? null,
    },
    nowTimestamp,
  });
}

function evaluateScheduleDelegationRequest({ actionRequest, nowTimestamp, delegationPolicy = null }) {
  const selfDelegation = assertTargetIsNotRequester(actionRequest);

  if (!selfDelegation.allowed) {
    return createRejectedResult({
      actionRequest,
      reasonCode: selfDelegation.reasonCode,
      reason: selfDelegation.reason,
      nowTimestamp,
    });
  }

  const policyEvaluation = evaluateConfiguredDelegationPolicy({
    actionRequest,
    delegationPolicy,
    nowTimestamp,
  });

  if (policyEvaluation.actionResult) {
    return policyEvaluation.actionResult;
  }

  const runAtTimestamp = Date.parse(actionRequest.payload.runAt);
  const nowTime = Date.parse(nowTimestamp);

  if (!Number.isNaN(nowTime) && runAtTimestamp <= nowTime) {
    const latenessMs = nowTime - runAtTimestamp;

    if (
      actionRequest.payload.missedRunPolicy === 'delay'
      && latenessMs <= SCHEDULE_DELEGATION_DELAY_GRACE_MS
    ) {
      return createAcceptedResult({
        actionRequest,
        payload: {
          targetOperationalIdentityId: actionRequest.payload.targetOperationalIdentityId,
          command: actionRequest.payload.command,
          mode: actionRequest.payload.mode,
          runAt: actionRequest.payload.runAt,
          missedRunPolicy: actionRequest.payload.missedRunPolicy,
          runAtAlreadyDue: true,
          latenessMs,
          contextRefCount: actionRequest.payload.contextRefs.length,
          artifactRefCount: actionRequest.payload.artifactRefs.length,
          delegationPolicyRuleId: policyEvaluation.policyDecision?.matchedRule?.ruleId ?? null,
        },
        warnings: [
          'Scheduled delegation runAt is already due; missedRunPolicy delay allows the OpenMAS OS service to run it on the next eligible tick.',
        ],
        nowTimestamp,
      });
    }

    return createBlockedResult({
      actionRequest,
      reasonCode: 'scheduled_time_not_future',
      reason: 'Scheduled delegation requires a future runAt timestamp.',
      payload: {
        runAt: actionRequest.payload.runAt,
        now: nowTimestamp,
        nextSafeActions: [
          'Provide a future ISO timestamp with timezone.',
          'Use immediate delegation when the work should run now.',
        ],
      },
      nowTimestamp,
    });
  }

  return createAcceptedResult({
    actionRequest,
    payload: {
      targetOperationalIdentityId: actionRequest.payload.targetOperationalIdentityId,
      command: actionRequest.payload.command,
      mode: actionRequest.payload.mode,
      runAt: actionRequest.payload.runAt,
      missedRunPolicy: actionRequest.payload.missedRunPolicy,
      contextRefCount: actionRequest.payload.contextRefs.length,
      artifactRefCount: actionRequest.payload.artifactRefs.length,
      delegationPolicyRuleId: policyEvaluation.policyDecision?.matchedRule?.ruleId ?? null,
    },
    nowTimestamp,
  });
}

function dispatchToActionHandler({ actionRequest, nowTimestamp, actionHandlers, delegationPolicy }) {
  const customHandler = actionHandlers?.[actionRequest.actionType];

  if (typeof customHandler === 'function') {
    return customHandler({
      actionRequest,
      nowTimestamp,
      createAcceptedResult,
      createBlockedResult,
      createRejectedResult,
    });
  }

  if (actionRequest.actionType === 'delegate') {
    return evaluateDelegateRequest({
      actionRequest,
      nowTimestamp,
      delegationPolicy,
    });
  }

  if (actionRequest.actionType === 'schedule_delegation') {
    return evaluateScheduleDelegationRequest({
      actionRequest,
      nowTimestamp,
      delegationPolicy,
    });
  }

  return createRejectedResult({
    actionRequest,
    reasonCode: 'unsupported_action_type',
    reason: `OpenMAS OS Action Gate does not support actionType ${actionRequest.actionType}.`,
    nowTimestamp,
  });
}

export function evaluateOsActionRequest({
  request,
  runtimeRequester = null,
  allowedRequesters = [],
  allowedRequesterTypes = ['operational_identity'],
  allowedActionTypes = [...OPENMAS_OS_ACTION_TYPES],
  actionHandlers = {},
  delegationPolicy = null,
  now = defaultNow,
} = {}) {
  const nowFn = normalizeNow(now);
  const nowTimestamp = nowFn();
  let actionRequest;

  try {
    actionRequest = assertOpenMasOsActionRequest(request);
  } catch (error) {
    const actionResult = createRejectedInvalidRequestResult({
      request,
      error,
      nowTimestamp,
    });

    return {
      status: actionResult.status,
      accepted: false,
      actionRequest: null,
      actionResult,
    };
  }

  const normalizedRuntimeRequester = normalizeRuntimeRequester(runtimeRequester);
  let effectiveAllowedRequesters = allowedRequesters;

  if (
    (!Array.isArray(effectiveAllowedRequesters) || effectiveAllowedRequesters.length === 0)
    && delegationPolicy !== undefined
    && delegationPolicy !== null
  ) {
    try {
      effectiveAllowedRequesters = getDelegationPolicyAllowedRequesters(delegationPolicy);
    } catch (error) {
      const actionResult = createRejectedResult({
        actionRequest,
        reasonCode: 'invalid_delegation_policy',
        reason: `OpenMAS OS Action Gate could not derive allowed requesters because the delegation policy is invalid: ${createSafeErrorMessage(error)}`,
        nowTimestamp,
      });

      return {
        status: actionResult.status,
        accepted: false,
        actionRequest,
        actionResult,
      };
    }
  }

  const runtimeRequesterDecision = evaluateRuntimeRequester({
    actionRequest,
    runtimeRequester: normalizedRuntimeRequester,
  });

  if (!runtimeRequesterDecision.allowed) {
    const actionResult = createRejectedResult({
      actionRequest,
      reasonCode: runtimeRequesterDecision.reasonCode,
      reason: runtimeRequesterDecision.reason,
      nowTimestamp,
    });

    return {
      status: actionResult.status,
      accepted: false,
      actionRequest,
      actionResult,
    };
  }

  if (!allowedActionTypes.includes(actionRequest.actionType)) {
    const actionResult = createRejectedResult({
      actionRequest,
      reasonCode: 'action_type_not_allowed',
      reason: `Action type ${actionRequest.actionType} is not allowed in this OpenMAS OS Action Gate.`,
      nowTimestamp,
    });

    return {
      status: actionResult.status,
      accepted: false,
      actionRequest,
      actionResult,
    };
  }

  const requesterDecision = isRequesterAllowed({
    requestedBy: actionRequest.requestedBy,
    allowedRequesters: effectiveAllowedRequesters,
    allowedRequesterTypes,
  });

  if (!requesterDecision.allowed) {
    const actionResult = createRejectedResult({
      actionRequest,
      reasonCode: requesterDecision.reasonCode,
      reason: requesterDecision.reason,
      nowTimestamp,
    });

    return {
      status: actionResult.status,
      accepted: false,
      actionRequest,
      actionResult,
    };
  }

  const actionResult = dispatchToActionHandler({
    actionRequest,
    nowTimestamp,
    actionHandlers,
    delegationPolicy,
  });

  return {
    status: actionResult.status,
    accepted: actionResult.status === 'accepted',
    actionRequest,
    actionResult,
  };
}

export class OsActionGate {
  constructor({
    runtimeRequester = null,
    allowedRequesters = [],
    allowedRequesterTypes = ['operational_identity'],
    allowedActionTypes = [...OPENMAS_OS_ACTION_TYPES],
    actionHandlers = {},
    delegationPolicy = null,
    now = defaultNow,
  } = {}) {
    this.runtimeRequester = runtimeRequester;
    this.allowedRequesters = allowedRequesters;
    this.allowedRequesterTypes = allowedRequesterTypes;
    this.allowedActionTypes = allowedActionTypes;
    this.actionHandlers = actionHandlers;
    this.delegationPolicy = delegationPolicy;
    this.now = normalizeNow(now);
  }

  evaluate(request) {
    return evaluateOsActionRequest({
      request,
      runtimeRequester: this.runtimeRequester,
      allowedRequesters: this.allowedRequesters,
      allowedRequesterTypes: this.allowedRequesterTypes,
      allowedActionTypes: this.allowedActionTypes,
      actionHandlers: this.actionHandlers,
      delegationPolicy: this.delegationPolicy,
      now: this.now,
    });
  }
}

export function createOsActionGate(options = {}) {
  return new OsActionGate(options);
}

export {
  SCHEDULE_DELEGATION_DELAY_GRACE_MS,
};
