import { assertResourceLifecycleState } from '../access/resource-contract.js';
import { assertChannelMessageRequest } from './channel-message-contract.js';

const CHANNEL_DELIVERY_STATUSES = new Set([
  'draft',
  'approval_required',
  'approved',
  'queued',
  'sent',
  'failed',
  'blocked',
  'cancelled',
]);

const CHANNEL_DELIVERY_TERMINAL_STATUSES = new Set([
  'sent',
  'failed',
  'blocked',
  'cancelled',
]);

const SAFE_CHANNEL_DELIVERY_ID_PATTERN = /^[a-zA-Z0-9._-]+$/u;
const SHA_256_PATTERN = /^[a-f0-9]{64}$/u;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function assertEnumValue(value, allowedValues, description) {
  if (!isNonEmptyString(value)) {
    throw new Error(`${description} must be a non-empty string.`);
  }

  const normalizedValue = value.trim();

  if (!allowedValues.has(normalizedValue)) {
    throw new Error(`${description} is invalid: ${normalizedValue}`);
  }

  return normalizedValue;
}

function assertSafeIdentifier(value, description) {
  if (!isNonEmptyString(value)) {
    throw new Error(`${description} must be a non-empty string.`);
  }

  const normalizedValue = value.trim();

  if (!SAFE_CHANNEL_DELIVERY_ID_PATTERN.test(normalizedValue)) {
    throw new Error(`${description} contains unsafe characters: ${normalizedValue}`);
  }

  return normalizedValue;
}

function assertNullableSafeIdentifier(value, description) {
  if (value === undefined || value === null) {
    return null;
  }

  return assertSafeIdentifier(value, description);
}

function assertNullableString(value, description) {
  if (value === undefined || value === null) {
    return null;
  }

  if (!isNonEmptyString(value)) {
    throw new Error(`${description} must be a non-empty string when provided.`);
  }

  return value.trim();
}

function assertRequiredString(value, description) {
  if (!isNonEmptyString(value)) {
    throw new Error(`${description} must be a non-empty string.`);
  }

  return value.trim();
}

function assertStringArray(values, description) {
  if (!Array.isArray(values)) {
    throw new Error(`${description} must be an array.`);
  }

  const seenValues = new Set();

  return values.map((value, index) => {
    if (!isNonEmptyString(value)) {
      throw new Error(`${description}[${index}] must be a non-empty string.`);
    }

    const normalizedValue = value.trim();

    if (seenValues.has(normalizedValue)) {
      throw new Error(`${description} contains a duplicated value: ${normalizedValue}`);
    }

    seenValues.add(normalizedValue);
    return normalizedValue;
  });
}

function assertBoolean(value, description) {
  if (typeof value !== 'boolean') {
    throw new Error(`${description} must be a boolean.`);
  }

  return value;
}

function assertNonNegativeInteger(value, description) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${description} must be a non-negative integer.`);
  }

  return value;
}

function assertSha256(value, description) {
  if (!isNonEmptyString(value)) {
    throw new Error(`${description} must be a non-empty string.`);
  }

  const normalizedValue = value.trim().toLowerCase();

  if (!SHA_256_PATTERN.test(normalizedValue)) {
    throw new Error(`${description} must be a lowercase SHA-256 hex digest.`);
  }

  return normalizedValue;
}

function assertSafeMessageSummary(summary) {
  if (!isPlainObject(summary)) {
    throw new Error('Channel delivery state safeMessageSummary must be an object.');
  }

  return {
    contentType: assertNullableString(
      summary.contentType,
      'Channel delivery state safeMessageSummary contentType',
    ),
    bodyLength: assertNonNegativeInteger(
      summary.bodyLength,
      'Channel delivery state safeMessageSummary bodyLength',
    ),
    bodySha256: assertSha256(
      summary.bodySha256,
      'Channel delivery state safeMessageSummary bodySha256',
    ),
    attachmentCount: assertNonNegativeInteger(
      summary.attachmentCount,
      'Channel delivery state safeMessageSummary attachmentCount',
    ),
  };
}

function assertDeliveryAudit(audit) {
  if (!isPlainObject(audit)) {
    throw new Error('Channel delivery state audit must be an object.');
  }

  return {
    requestedBy: assertSafeIdentifier(audit.requestedBy, 'Channel delivery state audit requestedBy'),
    createdAt: assertRequiredString(audit.createdAt, 'Channel delivery state audit createdAt'),
    updatedAt: assertRequiredString(audit.updatedAt, 'Channel delivery state audit updatedAt'),
    approvedAt: assertNullableString(audit.approvedAt, 'Channel delivery state audit approvedAt'),
    queuedAt: assertNullableString(audit.queuedAt, 'Channel delivery state audit queuedAt'),
    sentAt: assertNullableString(audit.sentAt, 'Channel delivery state audit sentAt'),
    failedAt: assertNullableString(audit.failedAt, 'Channel delivery state audit failedAt'),
    cancelledAt: assertNullableString(audit.cancelledAt, 'Channel delivery state audit cancelledAt'),
  };
}

function assertDeliveryStateConsistency(state) {
  if (state.status === 'approval_required') {
    if (state.approvalRequired !== true) {
      throw new Error('Channel delivery state with status "approval_required" must require approval.');
    }

    if (state.executionAuthorized || !state.executionBlocked) {
      throw new Error('Channel delivery state with status "approval_required" must block execution.');
    }

    if (state.adapterExecutionAttempted) {
      throw new Error('Channel delivery state with status "approval_required" must not attempt adapter execution.');
    }
  }

  if (state.status === 'approved' && !state.approvalRequestId) {
    throw new Error('Channel delivery state with status "approved" must include approvalRequestId.');
  }

  if (state.status === 'queued') {
    if (!state.executionAuthorized || state.executionBlocked) {
      throw new Error('Channel delivery state with status "queued" must authorize execution.');
    }

    if (state.approvalRequired && !state.approvalRequestId) {
      throw new Error('Channel delivery state with status "queued" and approvalRequired true must include approvalRequestId.');
    }
  }

  if (state.status === 'sent') {
    if (!state.executionAuthorized || state.executionBlocked || !state.adapterExecutionAttempted) {
      throw new Error('Channel delivery state with status "sent" must be authorized, unblocked, and adapter-attempted.');
    }

    if (!state.providerMessageId || !state.audit.sentAt) {
      throw new Error('Channel delivery state with status "sent" must include providerMessageId and audit.sentAt.');
    }

    if (state.approvalRequired && !state.approvalRequestId) {
      throw new Error('Channel delivery state with status "sent" and approvalRequired true must include approvalRequestId.');
    }
  }

  if (state.status === 'failed' && (state.errors.length === 0 || !state.audit.failedAt)) {
    throw new Error('Channel delivery state with status "failed" must include errors and audit.failedAt.');
  }

  if (state.status === 'blocked' && state.errors.length === 0) {
    throw new Error('Channel delivery state with status "blocked" must include at least one error.');
  }

  if (state.providerMessageId && state.status !== 'sent') {
    throw new Error('Channel delivery state providerMessageId is only allowed when status is "sent".');
  }
}

function assertChannelResourceSummary(summary) {
  if (!isPlainObject(summary)) {
    throw new Error('Channel delivery request channelResourceSummary must be an object.');
  }

  return {
    resourceId: assertSafeIdentifier(
      summary.resourceId,
      'Channel delivery request channelResourceSummary resourceId',
    ),
    resourceType: assertEnumValue(
      summary.resourceType,
      new Set(['channel']),
      'Channel delivery request channelResourceSummary resourceType',
    ),
    displayName: assertNullableString(
      summary.displayName,
      'Channel delivery request channelResourceSummary displayName',
    ),
    ownershipScope: assertNullableString(
      summary.ownershipScope,
      'Channel delivery request channelResourceSummary ownershipScope',
    ),
    lifecycleState: assertResourceLifecycleState(summary.lifecycleState),
  };
}

export function assertChannelDeliveryState(state) {
  if (!isPlainObject(state)) {
    throw new Error('Channel delivery state must be an object.');
  }

  if (state.kind !== 'channel_delivery_state') {
    throw new Error('Channel delivery state must include kind "channel_delivery_state".');
  }

  if (state.version !== 1) {
    throw new Error('Channel delivery state version must be 1.');
  }

  const normalizedState = {
    kind: 'channel_delivery_state',
    version: 1,
    deliveryId: assertSafeIdentifier(state.deliveryId, 'Channel delivery state deliveryId'),
    deliveryRequestId: assertSafeIdentifier(
      state.deliveryRequestId,
      'Channel delivery state deliveryRequestId',
    ),
    messageRequestId: assertSafeIdentifier(
      state.messageRequestId,
      'Channel delivery state messageRequestId',
    ),
    invocationId: assertNullableSafeIdentifier(state.invocationId, 'Channel delivery state invocationId'),
    channelResourceId: assertSafeIdentifier(
      state.channelResourceId,
      'Channel delivery state channelResourceId',
    ),
    channelType: assertNullableString(state.channelType, 'Channel delivery state channelType'),
    operationalIdentityId: assertSafeIdentifier(
      state.operationalIdentityId,
      'Channel delivery state operationalIdentityId',
    ),
    status: assertEnumValue(state.status, CHANNEL_DELIVERY_STATUSES, 'Channel delivery state status'),
    approvalRequired: assertBoolean(state.approvalRequired, 'Channel delivery state approvalRequired'),
    approvalRequestId: assertNullableSafeIdentifier(
      state.approvalRequestId,
      'Channel delivery state approvalRequestId',
    ),
    executionAuthorized: assertBoolean(
      state.executionAuthorized,
      'Channel delivery state executionAuthorized',
    ),
    executionBlocked: assertBoolean(state.executionBlocked, 'Channel delivery state executionBlocked'),
    adapterExecutionAttempted: assertBoolean(
      state.adapterExecutionAttempted,
      'Channel delivery state adapterExecutionAttempted',
    ),
    providerMessageId: assertNullableString(state.providerMessageId, 'Channel delivery state providerMessageId'),
    safeMessageSummary: assertSafeMessageSummary(state.safeMessageSummary),
    audit: assertDeliveryAudit(state.audit),
    warnings: assertStringArray(state.warnings ?? [], 'Channel delivery state warnings'),
    errors: assertStringArray(state.errors ?? [], 'Channel delivery state errors'),
  };

  assertDeliveryStateConsistency(normalizedState);

  return normalizedState;
}

export function assertChannelDeliveryRequest(request) {
  if (!isPlainObject(request)) {
    throw new Error('Channel delivery request must be an object.');
  }

  if (request.kind !== 'channel_delivery_request') {
    throw new Error('Channel delivery request must include kind "channel_delivery_request".');
  }

  if (request.version !== 1) {
    throw new Error('Channel delivery request version must be 1.');
  }

  const deliveryRequest = {
    kind: 'channel_delivery_request',
    version: 1,
    deliveryRequestId: assertSafeIdentifier(
      request.deliveryRequestId,
      'Channel delivery request deliveryRequestId',
    ),
    messageRequest: assertChannelMessageRequest(request.messageRequest),
    channelResourceSummary: assertChannelResourceSummary(request.channelResourceSummary),
    deliveryState: assertChannelDeliveryState(request.deliveryState),
    adapterExecutionAttempted: assertBoolean(
      request.adapterExecutionAttempted,
      'Channel delivery request adapterExecutionAttempted',
    ),
    warnings: assertStringArray(request.warnings ?? [], 'Channel delivery request warnings'),
  };

  if (deliveryRequest.messageRequest.channelResourceId !== deliveryRequest.channelResourceSummary.resourceId) {
    throw new Error('Channel delivery request message channelResourceId must match channelResourceSummary resourceId.');
  }

  if (deliveryRequest.messageRequest.messageRequestId !== deliveryRequest.deliveryState.messageRequestId) {
    throw new Error('Channel delivery request messageRequestId must match deliveryState messageRequestId.');
  }

  if (deliveryRequest.deliveryRequestId !== deliveryRequest.deliveryState.deliveryRequestId) {
    throw new Error('Channel delivery request deliveryRequestId must match deliveryState deliveryRequestId.');
  }

  if (deliveryRequest.adapterExecutionAttempted !== deliveryRequest.deliveryState.adapterExecutionAttempted) {
    throw new Error('Channel delivery request adapterExecutionAttempted must match deliveryState adapterExecutionAttempted.');
  }

  return deliveryRequest;
}

export function isChannelDeliveryTerminal(state) {
  return CHANNEL_DELIVERY_TERMINAL_STATUSES.has(assertChannelDeliveryState(state).status);
}

export {
  CHANNEL_DELIVERY_STATUSES,
  CHANNEL_DELIVERY_TERMINAL_STATUSES,
};
