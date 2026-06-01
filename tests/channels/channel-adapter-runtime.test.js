import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile } from 'node:fs/promises';
import { assertChannelAdapter } from '../../src/channels/base-channel-adapter.js';
import { resolveChannelAdapter } from '../../src/channels/resolve-channel-adapter.js';
import { executeChannelDeliveryRequest } from '../../src/channels/execute-channel-delivery-request.js';
import { createChannelDeliveryRequest } from '../../src/channels/create-channel-delivery-request.js';
import { assertChannelDeliveryRequest } from '../../src/contracts/channels/channel-delivery-state-contract.js';
import { assertChannelDeliveryResult } from '../../src/contracts/channels/channel-delivery-result-contract.js';
import { persistChannelDeliveryResultForInvocation } from '../../src/channels/persist-channel-delivery-result-for-invocation.js';

const VALID_REQUESTED_AT = '2026-04-17T10:00:00.000Z';
const VALID_COMPLETED_AT = '2026-04-17T10:00:01.000Z';
const SECRET_VALUE = 'instagram-channel-secret-value';

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
      body: 'Thanks for telling us. A human reviewed and approved this response.',
      attachments: [],
    },
    purpose: 'Publish a reviewed community reply.',
    sideEffectLevel: 'publish_external',
    approvalRequired: true,
    metadata: {
      source: 'community-management',
    },
    ...overrides,
  };
}

function buildApprovedDeliveryRequest({
  messageRequest = buildMessageRequest(),
  channelResource = buildChannelResource(),
  approvalRequestId = 'approval-001',
} = {}) {
  const deliveryRequest = createChannelDeliveryRequest({
    channelResource,
    messageRequest,
    requestedAt: VALID_REQUESTED_AT,
  });

  return assertChannelDeliveryRequest({
    ...deliveryRequest,
    deliveryState: {
      ...deliveryRequest.deliveryState,
      status: 'queued',
      approvalRequestId,
      executionAuthorized: true,
      executionBlocked: false,
      audit: {
        ...deliveryRequest.deliveryState.audit,
        approvedAt: VALID_REQUESTED_AT,
        queuedAt: VALID_REQUESTED_AT,
        updatedAt: VALID_REQUESTED_AT,
      },
    },
  });
}

function buildPreparedChannel(overrides = {}) {
  return {
    resourceId: 'instagram-community-channel',
    accessMode: 'publish',
    credentialReferenceId: 'instagram-channel-token',
    secretResolutionStatus: 'resolved',
    status: 'ready',
    reason: 'Channel is ready for delivery through a resolved credential reference.',
    ...overrides,
  };
}

function buildSecretResolution({
  credentialReferenceId = 'instagram-channel-token',
  secretValue = SECRET_VALUE,
} = {}) {
  return {
    resolvedCredentialReferences: [
      {
        resourceId: 'instagram-community-channel',
        credentialReferenceId,
        credentialType: 'access_token',
        resolutionStatus: 'resolved',
        reason: 'resolved',
        hasSecretValue: true,
      },
    ],
    summary: {
      totalReferenced: 1,
      resolved: 1,
      unresolved: 0,
      missingDefinitions: 0,
    },
    warnings: [],
    secretValueByReferenceId: new Map([
      [credentialReferenceId, secretValue],
    ]),
  };
}

test('resolveChannelAdapter returns the mock adapter for supported channel types', () => {
  const adapter = resolveChannelAdapter({
    adapterId: 'mock-channel-adapter',
    channelType: 'instagram',
  });
  const normalizedAdapter = assertChannelAdapter(adapter);

  assert.equal(normalizedAdapter.adapterId, 'mock-channel-adapter');
  assert.equal(normalizedAdapter.supportedChannelTypes.includes('instagram'), true);
  assert.equal(typeof normalizedAdapter.execute, 'function');
});

test('resolveChannelAdapter rejects unknown adapters and unsupported channel types', () => {
  assert.throws(
    () => resolveChannelAdapter({
      adapterId: 'real-instagram-adapter',
      channelType: 'instagram',
    }),
    /No channel adapter is registered/u,
  );

  assert.throws(
    () => resolveChannelAdapter({
      adapterId: 'mock-channel-adapter',
      channelType: 'carrier-pigeon',
    }),
    /does not support channelType/u,
  );
});

test('executeChannelDeliveryRequest executes only queued approved delivery through the mock adapter', async () => {
  const deliveryRequest = buildApprovedDeliveryRequest();
  const result = await executeChannelDeliveryRequest({
    preparedChannel: buildPreparedChannel(),
    deliveryRequest,
    secretResolution: buildSecretResolution(),
    startedAt: VALID_REQUESTED_AT,
    completedAt: VALID_COMPLETED_AT,
  });
  const normalizedResult = assertChannelDeliveryResult(result);
  const serializedResult = JSON.stringify(normalizedResult);

  assert.equal(normalizedResult.status, 'simulated');
  assert.equal(normalizedResult.adapterId, 'mock-channel-adapter');
  assert.equal(normalizedResult.deliveryEvidence.adapterExecutionAttempted, true);
  assert.equal(normalizedResult.deliveryEvidence.externalSendAttempted, false);
  assert.equal(normalizedResult.deliveryEvidence.externalDeliveryConfirmed, false);
  assert.equal(normalizedResult.audit.approvalRequestId, 'approval-001');
  assert.equal(serializedResult.includes(SECRET_VALUE), false);
  assert.equal(serializedResult.includes(deliveryRequest.messageRequest.content.body), false);
});

test('executeChannelDeliveryRequest refuses approval-required delivery state before approval resume', async () => {
  const deliveryRequest = createChannelDeliveryRequest({
    channelResource: buildChannelResource(),
    messageRequest: buildMessageRequest(),
    requestedAt: VALID_REQUESTED_AT,
  });

  await assert.rejects(
    () => executeChannelDeliveryRequest({
      preparedChannel: buildPreparedChannel(),
      deliveryRequest,
      secretResolution: buildSecretResolution(),
      startedAt: VALID_REQUESTED_AT,
      completedAt: VALID_COMPLETED_AT,
    }),
    /requires delivery state "queued"/u,
  );
});

test('executeChannelDeliveryRequest enforces prepared channel resource and secret readiness', async () => {
  const deliveryRequest = buildApprovedDeliveryRequest();

  await assert.rejects(
    () => executeChannelDeliveryRequest({
      preparedChannel: buildPreparedChannel({
        status: 'not_ready',
        reason: 'Credential Reference is unresolved.',
      }),
      deliveryRequest,
      secretResolution: buildSecretResolution(),
      startedAt: VALID_REQUESTED_AT,
      completedAt: VALID_COMPLETED_AT,
    }),
    /Prepared channel is not ready/u,
  );

  await assert.rejects(
    () => executeChannelDeliveryRequest({
      preparedChannel: buildPreparedChannel({
        resourceId: 'wrong-channel',
      }),
      deliveryRequest,
      secretResolution: buildSecretResolution(),
      startedAt: VALID_REQUESTED_AT,
      completedAt: VALID_COMPLETED_AT,
    }),
    /does not match delivery resource/u,
  );

  await assert.rejects(
    () => executeChannelDeliveryRequest({
      preparedChannel: buildPreparedChannel({
        credentialReferenceId: 'missing-token',
      }),
      deliveryRequest,
      secretResolution: buildSecretResolution(),
      startedAt: VALID_REQUESTED_AT,
      completedAt: VALID_COMPLETED_AT,
    }),
    /secret is not available/u,
  );
});

test('persistChannelDeliveryResultForInvocation stores safe delivery audit without raw body or secret', async () => {
  const deliveryRequest = buildApprovedDeliveryRequest({
    messageRequest: buildMessageRequest({
      content: {
        contentType: 'text',
        body: `Approved response. Internal credential must never persist: ${SECRET_VALUE}`,
        attachments: [],
      },
    }),
  });
  const result = await executeChannelDeliveryRequest({
    preparedChannel: buildPreparedChannel(),
    deliveryRequest,
    secretResolution: buildSecretResolution(),
    startedAt: VALID_REQUESTED_AT,
    completedAt: VALID_COMPLETED_AT,
  });
  const temporaryRootPath = await mkdtemp(path.join(os.tmpdir(), 'openmas-channel-delivery-'));
  const persisted = await persistChannelDeliveryResultForInvocation({
    masRootPath: temporaryRootPath,
    deliveryResult: result,
    persistedAt: VALID_COMPLETED_AT,
  });
  const auditRecord = JSON.parse(await readFile(persisted.auditRecordPath, 'utf8'));
  const serializedAuditRecord = JSON.stringify(auditRecord);

  assert.equal(auditRecord.kind, 'channel_delivery_audit_record');
  assert.equal(auditRecord.deliveryResult.status, 'simulated');
  assert.equal(auditRecord.deliveryResult.deliveryEvidence.externalSendAttempted, false);
  assert.equal(serializedAuditRecord.includes(SECRET_VALUE), false);
  assert.equal(serializedAuditRecord.includes(deliveryRequest.messageRequest.content.body), false);
});
