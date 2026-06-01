import { CHANNEL_TYPES } from '../contracts/channels/channel-message-contract.js';

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function assertSupportedChannelTypes(values) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error('Channel adapter must include a non-empty supportedChannelTypes array.');
  }

  const seenValues = new Set();

  return values.map((value, index) => {
    if (!isNonEmptyString(value)) {
      throw new Error(`Channel adapter supportedChannelTypes[${index}] must be a non-empty string.`);
    }

    const normalizedValue = value.trim();

    if (!CHANNEL_TYPES.has(normalizedValue)) {
      throw new Error(`Channel adapter supportedChannelTypes[${index}] is invalid: ${normalizedValue}`);
    }

    if (seenValues.has(normalizedValue)) {
      throw new Error(`Channel adapter supportedChannelTypes contains a duplicated value: ${normalizedValue}`);
    }

    seenValues.add(normalizedValue);
    return normalizedValue;
  });
}

export function assertChannelAdapter(adapter) {
  if (!adapter || typeof adapter !== 'object' || Array.isArray(adapter)) {
    throw new Error('Channel adapter must be an object.');
  }

  if (!isNonEmptyString(adapter.adapterId)) {
    throw new Error('Channel adapter must include a non-empty adapterId.');
  }

  if (typeof adapter.execute !== 'function') {
    throw new Error(`Channel adapter ${adapter.adapterId} must expose an execute function.`);
  }

  return {
    adapterId: adapter.adapterId.trim(),
    supportedChannelTypes: assertSupportedChannelTypes(adapter.supportedChannelTypes),
    execute: adapter.execute,
  };
}
