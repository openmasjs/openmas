import { assertChannelAdapter } from './base-channel-adapter.js';
import { mockChannelAdapter } from './adapters/mock-channel-adapter.js';

const CHANNEL_ADAPTER_BY_ID = new Map([
  ['mock-channel-adapter', mockChannelAdapter],
]);

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function resolveChannelAdapter({
  adapterId = 'mock-channel-adapter',
  channelType,
} = {}) {
  if (!isNonEmptyString(adapterId)) {
    throw new Error('Channel adapter resolution requires a non-empty adapterId.');
  }

  if (!isNonEmptyString(channelType)) {
    throw new Error('Channel adapter resolution requires a non-empty channelType.');
  }

  const normalizedAdapterId = adapterId.trim();
  const normalizedChannelType = channelType.trim();
  const adapter = CHANNEL_ADAPTER_BY_ID.get(normalizedAdapterId);

  if (!adapter) {
    throw new Error(`No channel adapter is registered for adapterId: ${normalizedAdapterId}`);
  }

  const normalizedAdapter = assertChannelAdapter(adapter);

  if (!normalizedAdapter.supportedChannelTypes.includes(normalizedChannelType)) {
    throw new Error(`Channel adapter ${normalizedAdapterId} does not support channelType: ${normalizedChannelType}`);
  }

  return normalizedAdapter;
}
