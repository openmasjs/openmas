const CHANNEL_DELIVERY_RESULT_STATUSES = new Set([
  'simulated',
  'failed',
  'blocked',
]);

const SAFE_DELIVERY_RESULT_ID_PATTERN = /^[a-zA-Z0-9._-]+$/u;

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

  if (!SAFE_DELIVERY_RESULT_ID_PATTERN.test(normalizedValue)) {
    throw new Error(`${description} contains unsafe characters: ${normalizedValue}`);
  }

  return normalizedValue;
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

function assertStringArray(values, description) {
  if (!Array.isArray(values)) {
    throw new Error(`${description} must be an array.`);
  }

  return values.map((value, index) => {
    if (!isNonEmptyString(value)) {
      throw new Error(`${description}[${index}] must be a non-empty string.`);
    }

    return value.trim();
  });
}

function assertDeliveryEvidence(evidence) {
  if (!isPlainObject(evidence)) {
    throw new Error('Channel delivery result deliveryEvidence must be an object.');
  }

  return {
    adapterExecutionAttempted: assertBoolean(
      evidence.adapterExecutionAttempted,
      'Channel delivery result deliveryEvidence adapterExecutionAttempted',
    ),
    externalSendAttempted: assertBoolean(
      evidence.externalSendAttempted,
      'Channel delivery result deliveryEvidence externalSendAttempted',
    ),
    externalDeliveryConfirmed: assertBoolean(
      evidence.externalDeliveryConfirmed,
      'Channel delivery result deliveryEvidence externalDeliveryConfirmed',
    ),
    simulated: assertBoolean(evidence.simulated, 'Channel delivery result deliveryEvidence simulated'),
  };
}

function assertSafeMessageSummary(summary) {
  if (!isPlainObject(summary)) {
    throw new Error('Channel delivery result safeMessageSummary must be an object.');
  }

  return {
    bodyLength: assertNonNegativeInteger(
      summary.bodyLength,
      'Channel delivery result safeMessageSummary bodyLength',
    ),
    attachmentCount: assertNonNegativeInteger(
      summary.attachmentCount,
      'Channel delivery result safeMessageSummary attachmentCount',
    ),
  };
}

function assertDeliveryResultAudit(audit) {
  if (!isPlainObject(audit)) {
    throw new Error('Channel delivery result audit must be an object.');
  }

  return {
    invocationId: assertNullableString(audit.invocationId, 'Channel delivery result audit invocationId'),
    operationalIdentityId: assertSafeIdentifier(
      audit.operationalIdentityId,
      'Channel delivery result audit operationalIdentityId',
    ),
    requestedBy: assertSafeIdentifier(audit.requestedBy, 'Channel delivery result audit requestedBy'),
    approvalRequestId: assertSafeIdentifier(
      audit.approvalRequestId,
      'Channel delivery result audit approvalRequestId',
    ),
    startedAt: assertNullableString(audit.startedAt, 'Channel delivery result audit startedAt'),
    completedAt: assertNullableString(audit.completedAt, 'Channel delivery result audit completedAt'),
  };
}

function assertDeliveryResultConsistency(result) {
  if (result.status === 'simulated') {
    if (!result.deliveryEvidence.simulated) {
      throw new Error('Simulated channel delivery results must include deliveryEvidence.simulated true.');
    }

    if (result.deliveryEvidence.externalSendAttempted || result.deliveryEvidence.externalDeliveryConfirmed) {
      throw new Error('Simulated channel delivery results must not claim external send or delivery confirmation.');
    }

    if (result.providerMessageId !== null) {
      throw new Error('Simulated channel delivery results must not include providerMessageId.');
    }
  }

  if ((result.status === 'failed' || result.status === 'blocked') && result.errors.length === 0) {
    throw new Error(`Channel delivery result with status "${result.status}" must include at least one error.`);
  }
}

export function assertChannelDeliveryResult(result) {
  if (!isPlainObject(result)) {
    throw new Error('Channel delivery result must be an object.');
  }

  if (result.kind !== 'channel_delivery_result') {
    throw new Error('Channel delivery result must include kind "channel_delivery_result".');
  }

  if (result.version !== 1) {
    throw new Error('Channel delivery result version must be 1.');
  }

  const normalizedResult = {
    kind: 'channel_delivery_result',
    version: 1,
    deliveryResultId: assertSafeIdentifier(
      result.deliveryResultId,
      'Channel delivery result deliveryResultId',
    ),
    deliveryRequestId: assertSafeIdentifier(
      result.deliveryRequestId,
      'Channel delivery result deliveryRequestId',
    ),
    deliveryId: assertSafeIdentifier(result.deliveryId, 'Channel delivery result deliveryId'),
    messageRequestId: assertSafeIdentifier(
      result.messageRequestId,
      'Channel delivery result messageRequestId',
    ),
    channelResourceId: assertSafeIdentifier(
      result.channelResourceId,
      'Channel delivery result channelResourceId',
    ),
    channelType: assertSafeIdentifier(result.channelType, 'Channel delivery result channelType'),
    adapterId: assertSafeIdentifier(result.adapterId, 'Channel delivery result adapterId'),
    status: assertEnumValue(result.status, CHANNEL_DELIVERY_RESULT_STATUSES, 'Channel delivery result status'),
    summary: isNonEmptyString(result.summary) ? result.summary.trim() : null,
    providerMessageId: assertNullableString(result.providerMessageId, 'Channel delivery result providerMessageId'),
    deliveryEvidence: assertDeliveryEvidence(result.deliveryEvidence),
    safeMessageSummary: assertSafeMessageSummary(result.safeMessageSummary),
    audit: assertDeliveryResultAudit(result.audit),
    warnings: assertStringArray(result.warnings ?? [], 'Channel delivery result warnings'),
    errors: assertStringArray(result.errors ?? [], 'Channel delivery result errors'),
  };

  assertDeliveryResultConsistency(normalizedResult);

  return normalizedResult;
}

export {
  CHANNEL_DELIVERY_RESULT_STATUSES,
};
