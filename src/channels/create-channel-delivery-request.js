import { createHash } from 'node:crypto';
import { assertResourceDefinition } from '../contracts/access/resource-contract.js';
import { assertChannelMessageRequest } from '../contracts/channels/channel-message-contract.js';
import {
  assertChannelDeliveryRequest,
  assertChannelDeliveryState,
} from '../contracts/channels/channel-delivery-state-contract.js';

const SECRET_LIKE_BODY_PATTERNS = [
  /\bBearer\s+[a-zA-Z0-9._-]+/u,
  /\bsk-[a-zA-Z0-9._-]+/u,
  /\bsk-or-v1-[a-zA-Z0-9._-]+/u,
  /\bAIza[a-zA-Z0-9._-]+/u,
  /\b(api[_-]?key|access[_-]?token|password)\s*[:=]/iu,
];

function createSha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function messageBodyLooksSecretLike(body) {
  return SECRET_LIKE_BODY_PATTERNS.some((pattern) => {
    return pattern.test(body);
  });
}

function buildDeliveryState({
  deliveryRequestId,
  messageRequest,
  channelResource,
  requestedAt,
  warnings,
}) {
  const resourceIsActive = channelResource.lifecycleState === 'active';
  const status = resourceIsActive ? 'approval_required' : 'blocked';
  const errors = resourceIsActive
    ? []
    : [`Channel resource ${channelResource.resourceId} is not active: ${channelResource.lifecycleState}.`];

  return assertChannelDeliveryState({
    kind: 'channel_delivery_state',
    version: 1,
    deliveryId: `delivery-${messageRequest.messageRequestId}`,
    deliveryRequestId,
    messageRequestId: messageRequest.messageRequestId,
    invocationId: messageRequest.invocationId,
    channelResourceId: messageRequest.channelResourceId,
    channelType: messageRequest.channelType,
    operationalIdentityId: messageRequest.operationalIdentityId,
    status,
    approvalRequired: messageRequest.approvalRequired,
    approvalRequestId: null,
    executionAuthorized: false,
    executionBlocked: true,
    adapterExecutionAttempted: false,
    providerMessageId: null,
    safeMessageSummary: {
      contentType: messageRequest.content.contentType,
      bodyLength: messageRequest.content.body.length,
      bodySha256: createSha256(messageRequest.content.body),
      attachmentCount: messageRequest.content.attachments.length,
    },
    audit: {
      requestedBy: messageRequest.requestedBy,
      createdAt: requestedAt,
      updatedAt: requestedAt,
      approvedAt: null,
      queuedAt: null,
      sentAt: null,
      failedAt: null,
      cancelledAt: null,
    },
    warnings,
    errors,
  });
}

export function createChannelDeliveryRequest({
  channelResource,
  messageRequest,
  requestedAt = new Date().toISOString(),
} = {}) {
  const normalizedChannelResource = assertResourceDefinition(channelResource);

  if (normalizedChannelResource.resourceType !== 'channel') {
    throw new Error(`Channel delivery requires a channel resource. Received: ${normalizedChannelResource.resourceType}.`);
  }

  const normalizedMessageRequest = assertChannelMessageRequest(messageRequest);

  if (normalizedMessageRequest.channelResourceId !== normalizedChannelResource.resourceId) {
    throw new Error('Channel delivery message channelResourceId must match the provided channel resource.');
  }

  const warnings = messageBodyLooksSecretLike(normalizedMessageRequest.content.body)
    ? ['Channel message body appears to contain secret-like content; delivery state stores only a hash and length.']
    : [];
  const deliveryRequestId = `channel-delivery-${normalizedMessageRequest.messageRequestId}`;
  const deliveryState = buildDeliveryState({
    deliveryRequestId,
    messageRequest: normalizedMessageRequest,
    channelResource: normalizedChannelResource,
    requestedAt,
    warnings,
  });

  return assertChannelDeliveryRequest({
    kind: 'channel_delivery_request',
    version: 1,
    deliveryRequestId,
    messageRequest: normalizedMessageRequest,
    channelResourceSummary: {
      resourceId: normalizedChannelResource.resourceId,
      resourceType: normalizedChannelResource.resourceType,
      displayName: normalizedChannelResource.displayName,
      ownershipScope: normalizedChannelResource.ownershipScope,
      lifecycleState: normalizedChannelResource.lifecycleState,
    },
    deliveryState,
    adapterExecutionAttempted: false,
    warnings,
  });
}
