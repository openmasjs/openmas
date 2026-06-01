import path from 'node:path';
import { assertChannelDeliveryResult } from '../contracts/channels/channel-delivery-result-contract.js';
import { ensureDirectory } from '../persistence/ensure-directory.js';
import { writeJsonFile } from '../persistence/write-json-file.js';

const SAFE_FILE_TOKEN_PATTERN = /^[a-zA-Z0-9._-]+$/u;
const SENSITIVE_KEY_PATTERN = /(api[_-]?key|authorization|bearer|credential|password|private[_-]?key|secret|token)/iu;
const SENSITIVE_VALUE_PATTERNS = [
  /sk-or-v1-[a-zA-Z0-9._-]+/gu,
  /AIza[a-zA-Z0-9._-]+/gu,
  /Bearer\s+[a-zA-Z0-9._-]+/gu,
];

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function toSafeFileToken(value, description) {
  if (!isNonEmptyString(value)) {
    throw new Error(`${description} must be a non-empty string.`);
  }

  const normalizedValue = value.trim();

  if (!SAFE_FILE_TOKEN_PATTERN.test(normalizedValue)) {
    throw new Error(`${description} contains unsafe filesystem characters: ${normalizedValue}`);
  }

  return normalizedValue;
}

function redactString(value) {
  let redactedValue = value;
  let redactionApplied = false;

  for (const pattern of SENSITIVE_VALUE_PATTERNS) {
    redactedValue = redactedValue.replace(pattern, () => {
      redactionApplied = true;
      return '[REDACTED]';
    });
  }

  return {
    value: redactedValue,
    redactionApplied,
  };
}

function redactValue(value, { currentKey = '' } = {}) {
  if (SENSITIVE_KEY_PATTERN.test(currentKey)) {
    return {
      value: '[REDACTED]',
      redactionApplied: true,
    };
  }

  if (typeof value === 'string') {
    return redactString(value);
  }

  if (value === null || typeof value === 'number' || typeof value === 'boolean') {
    return {
      value,
      redactionApplied: false,
    };
  }

  if (Array.isArray(value)) {
    let redactionApplied = false;
    const redactedItems = value.map((entry) => {
      const redactedEntry = redactValue(entry, { currentKey });
      redactionApplied = redactionApplied || redactedEntry.redactionApplied;
      return redactedEntry.value;
    });

    return {
      value: redactedItems,
      redactionApplied,
    };
  }

  if (isPlainObject(value)) {
    let redactionApplied = false;
    const redactedObject = {};

    for (const [key, childValue] of Object.entries(value)) {
      const redactedChild = redactValue(childValue, { currentKey: key });
      redactedObject[key] = redactedChild.value;
      redactionApplied = redactionApplied || redactedChild.redactionApplied;
    }

    return {
      value: redactedObject,
      redactionApplied,
    };
  }

  return {
    value: null,
    redactionApplied: true,
  };
}

export function redactChannelDeliveryResultForPersistence(deliveryResult) {
  return redactValue(deliveryResult);
}

export async function persistChannelDeliveryResultForInvocation({
  masRootPath,
  deliveryResult,
  redactor = redactChannelDeliveryResultForPersistence,
  persistedAt = new Date().toISOString(),
} = {}) {
  if (!isNonEmptyString(masRootPath)) {
    throw new Error('Channel delivery result persistence requires a non-empty masRootPath.');
  }

  if (typeof redactor !== 'function') {
    throw new Error('Channel delivery result persistence redactor must be a function.');
  }

  const normalizedDeliveryResult = assertChannelDeliveryResult(deliveryResult);
  const redactedOutcome = redactor(normalizedDeliveryResult);

  if (!isPlainObject(redactedOutcome) || !('value' in redactedOutcome) || typeof redactedOutcome.redactionApplied !== 'boolean') {
    throw new Error('Channel delivery result persistence redactor must return { value, redactionApplied }.');
  }

  const redactedDeliveryResult = assertChannelDeliveryResult(redactedOutcome.value);
  const deliveryFileToken = toSafeFileToken(
    redactedDeliveryResult.deliveryId,
    'Channel delivery result persistence deliveryId',
  );
  const stateDirectoryPath = path.join(masRootPath, 'memory', 'state');
  const auditRecordPath = path.join(stateDirectoryPath, `channel-delivery-${deliveryFileToken}.json`);
  const auditRecord = {
    kind: 'channel_delivery_audit_record',
    version: 1,
    deliveryResult: redactedDeliveryResult,
    redaction: {
      strategy: 'default_sensitive_key_and_value_redaction',
      redactionApplied: redactedOutcome.redactionApplied,
    },
    persistedAt,
  };

  await ensureDirectory(stateDirectoryPath);
  await writeJsonFile(auditRecordPath, auditRecord);

  return {
    targetType: 'mas-memory',
    auditRecordPath,
    auditRecord,
  };
}
