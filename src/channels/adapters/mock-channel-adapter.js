import { assertChannelDeliveryRequest } from '../../contracts/channels/channel-delivery-state-contract.js';
import { assertChannelDeliveryResult } from '../../contracts/channels/channel-delivery-result-contract.js';
import { CHANNEL_TYPES } from '../../contracts/channels/channel-message-contract.js';

export const mockChannelAdapter = {
  adapterId: 'mock-channel-adapter',
  supportedChannelTypes: [...CHANNEL_TYPES],
  async execute({
    deliveryRequest,
    preparedChannel,
    secretValue,
    startedAt = new Date().toISOString(),
    completedAt = new Date().toISOString(),
  } = {}) {
    const normalizedDeliveryRequest = assertChannelDeliveryRequest(deliveryRequest);

    if (!preparedChannel || typeof preparedChannel !== 'object') {
      throw new Error('Mock channel adapter requires a preparedChannel object.');
    }

    if (preparedChannel.resourceId !== normalizedDeliveryRequest.channelResourceSummary.resourceId) {
      throw new Error('Mock channel adapter preparedChannel resourceId must match the delivery channel resource.');
    }

    if (typeof secretValue !== 'string' || secretValue.length === 0) {
      throw new Error('Mock channel adapter requires a resolved channel secret value.');
    }

    return assertChannelDeliveryResult({
      kind: 'channel_delivery_result',
      version: 1,
      deliveryResultId: `channel-delivery-result-${normalizedDeliveryRequest.deliveryState.deliveryId}`,
      deliveryRequestId: normalizedDeliveryRequest.deliveryRequestId,
      deliveryId: normalizedDeliveryRequest.deliveryState.deliveryId,
      messageRequestId: normalizedDeliveryRequest.messageRequest.messageRequestId,
      channelResourceId: normalizedDeliveryRequest.channelResourceSummary.resourceId,
      channelType: normalizedDeliveryRequest.messageRequest.channelType,
      adapterId: 'mock-channel-adapter',
      status: 'simulated',
      summary: `Simulated channel delivery for ${normalizedDeliveryRequest.messageRequest.channelType}. No external message was sent.`,
      providerMessageId: null,
      deliveryEvidence: {
        adapterExecutionAttempted: true,
        externalSendAttempted: false,
        externalDeliveryConfirmed: false,
        simulated: true,
      },
      safeMessageSummary: {
        bodyLength: normalizedDeliveryRequest.deliveryState.safeMessageSummary.bodyLength,
        attachmentCount: normalizedDeliveryRequest.deliveryState.safeMessageSummary.attachmentCount,
      },
      audit: {
        invocationId: normalizedDeliveryRequest.messageRequest.invocationId,
        operationalIdentityId: normalizedDeliveryRequest.messageRequest.operationalIdentityId,
        requestedBy: normalizedDeliveryRequest.messageRequest.requestedBy,
        approvalRequestId: normalizedDeliveryRequest.deliveryState.approvalRequestId,
        startedAt,
        completedAt,
      },
      warnings: [
        'Mock channel adapter executed in simulation mode. No external send was attempted.',
      ],
      errors: [],
    });
  },
};
