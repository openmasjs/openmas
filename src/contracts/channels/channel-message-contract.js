const CHANNEL_TYPES = new Set([
  'whatsapp',
  'instagram',
  'facebook_messenger',
  'telegram',
  'email',
  'sms',
  'slack',
  'discord',
  'generic',
]);

const CHANNEL_RECIPIENT_TYPES = new Set([
  'thread',
  'user',
  'room',
  'phone_number',
  'email_address',
  'external_id',
]);

const CHANNEL_MESSAGE_CONTENT_TYPES = new Set([
  'text',
  'markdown',
  'html',
  'template',
]);

const CHANNEL_MESSAGE_SIDE_EFFECT_LEVELS = new Set([
  'publish_external',
]);

const CHANNEL_ATTACHMENT_REFERENCE_TYPES = new Set([
  'artifact_reference',
  'external_url',
  'media_reference',
]);

const SAFE_CHANNEL_ID_PATTERN = /^[a-zA-Z0-9._-]+$/u;
const MAX_CHANNEL_MESSAGE_BODY_LENGTH = 16000;
const MAX_CHANNEL_MESSAGE_METADATA_BYTES = 8192;
const SECRET_LIKE_KEY_PATTERN = /(secret|token|api[_-]?key|authorization|credential|password)/iu;

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

  if (!SAFE_CHANNEL_ID_PATTERN.test(normalizedValue)) {
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

function assertRequiredString(value, description) {
  if (!isNonEmptyString(value)) {
    throw new Error(`${description} must be a non-empty string.`);
  }

  return value.trim();
}

function assertBoolean(value, description) {
  if (typeof value !== 'boolean') {
    throw new Error(`${description} must be a boolean.`);
  }

  return value;
}

function normalizeJsonValue(value, description) {
  if (
    value === null
    || typeof value === 'string'
    || typeof value === 'number'
    || typeof value === 'boolean'
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry, index) => {
      return normalizeJsonValue(entry, `${description}[${index}]`);
    });
  }

  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => {
        if (!isNonEmptyString(key)) {
          throw new Error(`${description} contains an empty metadata key.`);
        }

        if (SECRET_LIKE_KEY_PATTERN.test(key)) {
          throw new Error(`${description} must not include secret-like metadata keys. Use resource credential references instead.`);
        }

        return [key, normalizeJsonValue(entry, `${description}.${key}`)];
      }),
    );
  }

  throw new Error(`${description} must be JSON-serializable.`);
}

function assertSafeMetadata(metadata) {
  if (metadata === undefined || metadata === null) {
    return {};
  }

  if (!isPlainObject(metadata)) {
    throw new Error('Channel message request metadata must be an object when provided.');
  }

  const normalizedMetadata = normalizeJsonValue(metadata, 'Channel message request metadata');
  const metadataBytes = Buffer.byteLength(JSON.stringify(normalizedMetadata), 'utf8');

  if (metadataBytes > MAX_CHANNEL_MESSAGE_METADATA_BYTES) {
    throw new Error(`Channel message request metadata exceeds ${MAX_CHANNEL_MESSAGE_METADATA_BYTES} bytes.`);
  }

  return normalizedMetadata;
}

function assertChannelRecipient(recipient) {
  if (!isPlainObject(recipient)) {
    throw new Error('Channel message request recipient must be an object.');
  }

  if (!isNonEmptyString(recipient.recipientId)) {
    throw new Error('Channel message request recipient must include a non-empty recipientId.');
  }

  return {
    recipientType: assertEnumValue(
      recipient.recipientType,
      CHANNEL_RECIPIENT_TYPES,
      'Channel message request recipient recipientType',
    ),
    recipientId: recipient.recipientId.trim(),
    displayName: assertNullableString(
      recipient.displayName,
      'Channel message request recipient displayName',
    ),
  };
}

function assertChannelAttachmentReference(attachment, index) {
  const description = `Channel message request content attachments[${index}]`;

  if (!isPlainObject(attachment)) {
    throw new Error(`${description} must be an object.`);
  }

  return {
    attachmentId: assertSafeIdentifier(attachment.attachmentId, `${description} attachmentId`),
    referenceType: assertEnumValue(
      attachment.referenceType,
      CHANNEL_ATTACHMENT_REFERENCE_TYPES,
      `${description} referenceType`,
    ),
    referenceId: assertSafeIdentifier(attachment.referenceId, `${description} referenceId`),
    mimeType: assertNullableString(attachment.mimeType, `${description} mimeType`),
    displayName: assertNullableString(attachment.displayName, `${description} displayName`),
  };
}

function assertChannelAttachmentReferences(attachments) {
  if (attachments === undefined || attachments === null) {
    return [];
  }

  if (!Array.isArray(attachments)) {
    throw new Error('Channel message request content attachments must be an array when provided.');
  }

  const seenAttachmentIds = new Set();

  return attachments.map((attachment, index) => {
    const normalizedAttachment = assertChannelAttachmentReference(attachment, index);

    if (seenAttachmentIds.has(normalizedAttachment.attachmentId)) {
      throw new Error(`Channel message request content attachments contains a duplicated attachmentId: ${normalizedAttachment.attachmentId}`);
    }

    seenAttachmentIds.add(normalizedAttachment.attachmentId);
    return normalizedAttachment;
  });
}

function assertChannelMessageContent(content) {
  if (!isPlainObject(content)) {
    throw new Error('Channel message request content must be an object.');
  }

  if (!isNonEmptyString(content.body)) {
    throw new Error('Channel message request content must include a non-empty body.');
  }

  const body = content.body.trim();

  if (body.length > MAX_CHANNEL_MESSAGE_BODY_LENGTH) {
    throw new Error(`Channel message request content body exceeds ${MAX_CHANNEL_MESSAGE_BODY_LENGTH} characters.`);
  }

  return {
    contentType: assertEnumValue(
      content.contentType,
      CHANNEL_MESSAGE_CONTENT_TYPES,
      'Channel message request content contentType',
    ),
    body,
    attachments: assertChannelAttachmentReferences(content.attachments),
  };
}

export function assertChannelMessageRequest(request) {
  if (!isPlainObject(request)) {
    throw new Error('Channel message request must be an object.');
  }

  if (request.kind !== 'channel_message_request') {
    throw new Error('Channel message request must include kind "channel_message_request".');
  }

  if (request.version !== 1) {
    throw new Error('Channel message request version must be 1.');
  }

  const sideEffectLevel = assertEnumValue(
    request.sideEffectLevel ?? 'publish_external',
    CHANNEL_MESSAGE_SIDE_EFFECT_LEVELS,
    'Channel message request sideEffectLevel',
  );
  const approvalRequired = assertBoolean(
    request.approvalRequired ?? true,
    'Channel message request approvalRequired',
  );

  if (sideEffectLevel === 'publish_external' && approvalRequired !== true) {
    throw new Error('Channel message request with sideEffectLevel "publish_external" must require approval.');
  }

  return {
    kind: 'channel_message_request',
    version: 1,
    messageRequestId: assertSafeIdentifier(
      request.messageRequestId,
      'Channel message request messageRequestId',
    ),
    invocationId: assertNullableString(request.invocationId, 'Channel message request invocationId'),
    operationalIdentityId: assertSafeIdentifier(
      request.operationalIdentityId,
      'Channel message request operationalIdentityId',
    ),
    requestedBy: assertSafeIdentifier(request.requestedBy, 'Channel message request requestedBy'),
    requestedAt: assertRequiredString(request.requestedAt, 'Channel message request requestedAt'),
    channelResourceId: assertSafeIdentifier(
      request.channelResourceId,
      'Channel message request channelResourceId',
    ),
    channelType: assertEnumValue(request.channelType, CHANNEL_TYPES, 'Channel message request channelType'),
    recipient: assertChannelRecipient(request.recipient),
    conversationThreadId: assertNullableString(
      request.conversationThreadId,
      'Channel message request conversationThreadId',
    ),
    content: assertChannelMessageContent(request.content),
    purpose: assertNullableString(request.purpose, 'Channel message request purpose'),
    sideEffectLevel,
    approvalRequired,
    metadata: assertSafeMetadata(request.metadata),
  };
}

export {
  CHANNEL_ATTACHMENT_REFERENCE_TYPES,
  CHANNEL_MESSAGE_CONTENT_TYPES,
  CHANNEL_MESSAGE_SIDE_EFFECT_LEVELS,
  CHANNEL_RECIPIENT_TYPES,
  CHANNEL_TYPES,
  MAX_CHANNEL_MESSAGE_BODY_LENGTH,
};
