import test from 'node:test';
import assert from 'node:assert/strict';
import { assertChannelMessageRequest } from '../../src/contracts/channel-message-contract.js';
import {
  assertChannelDeliveryRequest,
  assertChannelDeliveryState,
  isChannelDeliveryTerminal,
} from '../../src/contracts/channel-delivery-state-contract.js';
import { createChannelDeliveryRequest } from '../../src/channels/create-channel-delivery-request.js';

const VALID_REQUESTED_AT = '2026-04-17T10:00:00.000Z';

function buildChannelResource(overrides = {}) {
  return {
    kind: 'resource_definition',
    version: 1,
    resourceId: 'instagram-community-channel',
    resourceType: 'channel',
    displayName: 'Instagram Community Channel',
    ownershipScope: 'shared',
    lifecycleState: 'active',
    description: 'Shared Instagram channel for community replies.',
    ...overrides,
  };
}

function buildMessageRequest(overrides = {}) {
  return {
    kind: 'channel_message_request',
    version: 1,
    messageRequestId: 'message-request-001',
    invocationId: 'invocation-001',
    operationalIdentityId: 'maria',
    requestedBy: 'cli',
    requestedAt: VALID_REQUESTED_AT,
    channelResourceId: 'instagram-community-channel',
    channelType: 'instagram',
    recipient: {
      recipientType: 'thread',
      recipientId: 'thread-001',
      displayName: 'Customer complaint thread',
    },
    conversationThreadId: 'thread-001',
    content: {
      contentType: 'text',
      body: 'Thanks for telling us. A human will review this response before publication.',
      attachments: [],
    },
    purpose: 'Draft a safe reply to a community complaint.',
    sideEffectLevel: 'publish_external',
    approvalRequired: true,
    metadata: {
      source: 'community-management',
    },
    ...overrides,
  };
}

test('assertChannelMessageRequest accepts a valid outbound channel message request', () => {
  const request = assertChannelMessageRequest(buildMessageRequest());

  assert.equal(request.kind, 'channel_message_request');
  assert.equal(request.channelResourceId, 'instagram-community-channel');
  assert.equal(request.channelType, 'instagram');
  assert.equal(request.recipient.recipientType, 'thread');
  assert.equal(request.content.contentType, 'text');
  assert.equal(request.sideEffectLevel, 'publish_external');
  assert.equal(request.approvalRequired, true);
});

test('assertChannelMessageRequest rejects publish messages that do not require approval', () => {
  assert.throws(
    () => assertChannelMessageRequest(buildMessageRequest({
      approvalRequired: false,
    })),
    /must require approval/u,
  );
});

test('createChannelDeliveryRequest builds approval-required delivery state without sending', () => {
  const delivery = createChannelDeliveryRequest({
    channelResource: buildChannelResource(),
    messageRequest: buildMessageRequest(),
    requestedAt: VALID_REQUESTED_AT,
  });

  const normalizedDelivery = assertChannelDeliveryRequest(delivery);

  assert.equal(normalizedDelivery.kind, 'channel_delivery_request');
  assert.equal(normalizedDelivery.deliveryRequestId, 'channel-delivery-message-request-001');
  assert.equal(normalizedDelivery.adapterExecutionAttempted, false);
  assert.equal(normalizedDelivery.deliveryState.status, 'approval_required');
  assert.equal(normalizedDelivery.deliveryState.approvalRequired, true);
  assert.equal(normalizedDelivery.deliveryState.executionAuthorized, false);
  assert.equal(normalizedDelivery.deliveryState.executionBlocked, true);
  assert.equal(normalizedDelivery.deliveryState.adapterExecutionAttempted, false);
  assert.equal(normalizedDelivery.deliveryState.providerMessageId, null);
  assert.equal(isChannelDeliveryTerminal(normalizedDelivery.deliveryState), false);
});

test('createChannelDeliveryRequest rejects non-channel resources', () => {
  assert.throws(
    () => createChannelDeliveryRequest({
      channelResource: buildChannelResource({
        resourceId: 'mas-filesystem',
        resourceType: 'storage',
        displayName: 'MAS Filesystem',
      }),
      messageRequest: buildMessageRequest({
        channelResourceId: 'mas-filesystem',
      }),
      requestedAt: VALID_REQUESTED_AT,
    }),
    /requires a channel resource/u,
  );
});

test('createChannelDeliveryRequest blocks inactive channel resources without adapter execution', () => {
  const delivery = createChannelDeliveryRequest({
    channelResource: buildChannelResource({
      lifecycleState: 'suspended',
    }),
    messageRequest: buildMessageRequest(),
    requestedAt: VALID_REQUESTED_AT,
  });

  assert.equal(delivery.deliveryState.status, 'blocked');
  assert.equal(delivery.deliveryState.executionAuthorized, false);
  assert.equal(delivery.deliveryState.executionBlocked, true);
  assert.equal(delivery.deliveryState.adapterExecutionAttempted, false);
  assert.match(delivery.deliveryState.errors[0], /not active/u);
  assert.equal(isChannelDeliveryTerminal(delivery.deliveryState), true);
});

test('channel delivery state stores only a safe summary, never raw message body or secret-looking values', () => {
  const secretProbe = 'sk-or-v1-test-secret-that-must-not-be-in-state';
  const messageRequest = buildMessageRequest({
    content: {
      contentType: 'text',
      body: `Please do not publish this credential: ${secretProbe}`,
      attachments: [
        {
          attachmentId: 'complaint-screenshot',
          referenceType: 'artifact_reference',
          referenceId: 'artifact-complaint-001',
          mimeType: 'image/png',
          displayName: 'Complaint screenshot',
        },
      ],
    },
  });
  const delivery = createChannelDeliveryRequest({
    channelResource: buildChannelResource(),
    messageRequest,
    requestedAt: VALID_REQUESTED_AT,
  });
  const stateJson = JSON.stringify(delivery.deliveryState);

  assert.equal(stateJson.includes(secretProbe), false);
  assert.equal(stateJson.includes(messageRequest.content.body), false);
  assert.equal(delivery.deliveryState.safeMessageSummary.bodyLength, messageRequest.content.body.length);
  assert.match(delivery.deliveryState.safeMessageSummary.bodySha256, /^[a-f0-9]{64}$/u);
  assert.equal(delivery.deliveryState.safeMessageSummary.attachmentCount, 1);
  assert.match(delivery.deliveryState.warnings[0], /secret-like content/u);
});

test('assertChannelDeliveryState rejects sent states without adapter evidence', () => {
  assert.throws(
    () => assertChannelDeliveryState({
      kind: 'channel_delivery_state',
      version: 1,
      deliveryId: 'delivery-001',
      deliveryRequestId: 'channel-delivery-001',
      messageRequestId: 'message-request-001',
      invocationId: 'invocation-001',
      channelResourceId: 'instagram-community-channel',
      channelType: 'instagram',
      operationalIdentityId: 'maria',
      status: 'sent',
      approvalRequired: true,
      approvalRequestId: 'approval-001',
      executionAuthorized: false,
      executionBlocked: true,
      adapterExecutionAttempted: false,
      providerMessageId: null,
      safeMessageSummary: {
        contentType: 'text',
        bodyLength: 10,
        bodySha256: 'a'.repeat(64),
        attachmentCount: 0,
      },
      audit: {
        requestedBy: 'cli',
        createdAt: VALID_REQUESTED_AT,
        updatedAt: VALID_REQUESTED_AT,
        approvedAt: VALID_REQUESTED_AT,
        queuedAt: null,
        sentAt: null,
        failedAt: null,
        cancelledAt: null,
      },
      warnings: [],
      errors: [],
    }),
    /must be authorized, unblocked, and adapter-attempted/u,
  );
});
