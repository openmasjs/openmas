import { assertChannelProviderPreparation } from '../contracts/providers/provider-integration-contract.js';
import { assertChannelDeliveryRequest } from '../contracts/channels/channel-delivery-state-contract.js';
import { assertChannelDeliveryResult } from '../contracts/channels/channel-delivery-result-contract.js';
import { resolveChannelAdapter } from './resolve-channel-adapter.js';

function resolveSecretValue({ secretResolution, credentialReferenceId }) {
  if (!secretResolution || !(secretResolution.secretValueByReferenceId instanceof Map)) {
    throw new Error('Channel delivery execution requires secretResolution.secretValueByReferenceId.');
  }

  const secretValue = secretResolution.secretValueByReferenceId.get(credentialReferenceId);

  if (typeof secretValue !== 'string' || secretValue.length === 0) {
    throw new Error(`Channel delivery secret is not available for credentialReferenceId: ${credentialReferenceId}`);
  }

  return secretValue;
}

function assertExecutableDeliveryState(deliveryState) {
  if (deliveryState.status !== 'queued') {
    throw new Error(`Channel delivery execution requires delivery state "queued". Received: ${deliveryState.status}.`);
  }

  if (!deliveryState.executionAuthorized || deliveryState.executionBlocked) {
    throw new Error('Channel delivery execution requires authorized and unblocked delivery state.');
  }

  if (deliveryState.adapterExecutionAttempted) {
    throw new Error('Channel delivery execution refuses delivery states that already attempted adapter execution.');
  }

  if (!deliveryState.approvalRequestId) {
    throw new Error('Channel delivery execution requires an approvalRequestId.');
  }
}

export async function executeChannelDeliveryRequest({
  preparedChannel,
  deliveryRequest,
  secretResolution,
  adapterId = 'mock-channel-adapter',
  startedAt = new Date().toISOString(),
  completedAt = new Date().toISOString(),
} = {}) {
  const normalizedPreparedChannel = assertChannelProviderPreparation(preparedChannel);
  const normalizedDeliveryRequest = assertChannelDeliveryRequest(deliveryRequest);

  if (normalizedPreparedChannel.status !== 'ready') {
    throw new Error(`Prepared channel is not ready: ${normalizedPreparedChannel.reason}`);
  }

  if (normalizedPreparedChannel.accessMode !== 'publish') {
    throw new Error(`Prepared channel must use publish access for delivery execution. Received: ${normalizedPreparedChannel.accessMode}.`);
  }

  if (normalizedPreparedChannel.resourceId !== normalizedDeliveryRequest.channelResourceSummary.resourceId) {
    throw new Error(
      `Prepared channel ${normalizedPreparedChannel.resourceId} does not match delivery resource ${normalizedDeliveryRequest.channelResourceSummary.resourceId}.`,
    );
  }

  if (!normalizedPreparedChannel.credentialReferenceId) {
    throw new Error(`Prepared channel ${normalizedPreparedChannel.resourceId} does not define a credentialReferenceId.`);
  }

  assertExecutableDeliveryState(normalizedDeliveryRequest.deliveryState);

  const secretValue = resolveSecretValue({
    secretResolution,
    credentialReferenceId: normalizedPreparedChannel.credentialReferenceId,
  });
  const adapter = resolveChannelAdapter({
    adapterId,
    channelType: normalizedDeliveryRequest.messageRequest.channelType,
  });
  const result = await adapter.execute({
    deliveryRequest: normalizedDeliveryRequest,
    preparedChannel: normalizedPreparedChannel,
    secretValue,
    startedAt,
    completedAt,
  });

  return assertChannelDeliveryResult(result);
}
