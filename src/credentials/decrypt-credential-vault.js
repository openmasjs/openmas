import { createDecipheriv } from 'node:crypto';

const VAULT_MAGIC = Buffer.from([0x4F, 0x4D]);
const VAULT_FORMAT_VERSION = 0x01;
const HEADER_LENGTH = 3;
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const MINIMUM_ENCRYPTED_LENGTH = HEADER_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH;

export function decryptCredentialVault(encryptedBuffer, masterKeyHex) {
  if (!Buffer.isBuffer(encryptedBuffer)) {
    throw new Error('Encrypted credential vault content must be a Buffer.');
  }

  if (encryptedBuffer.length < MINIMUM_ENCRYPTED_LENGTH) {
    throw new Error(
      `Encrypted credential vault content is too short (${encryptedBuffer.length} bytes). `
      + `Minimum expected length is ${MINIMUM_ENCRYPTED_LENGTH} bytes `
      + `(${HEADER_LENGTH} header + ${IV_LENGTH} IV + ${AUTH_TAG_LENGTH} AuthTag).`,
    );
  }

  const magic = encryptedBuffer.subarray(0, 2);

  if (!magic.equals(VAULT_MAGIC)) {
    throw new Error(
      'Invalid credential vault file. The file does not have the expected OpenMAS vault header. '
      + 'The file may be corrupted or not an OpenMAS credential vault.',
    );
  }

  const formatVersion = encryptedBuffer[2];

  if (formatVersion !== VAULT_FORMAT_VERSION) {
    throw new Error(
      `Unsupported credential vault format version: ${formatVersion}. `
      + `This version of OpenMAS supports vault format version ${VAULT_FORMAT_VERSION}.`,
    );
  }

  if (typeof masterKeyHex !== 'string' || masterKeyHex.length !== 64) {
    throw new Error('Master key must be a 64-character hexadecimal string.');
  }

  const key = Buffer.from(masterKeyHex, 'hex');
  const iv = encryptedBuffer.subarray(HEADER_LENGTH, HEADER_LENGTH + IV_LENGTH);
  const authTag = encryptedBuffer.subarray(
    HEADER_LENGTH + IV_LENGTH,
    HEADER_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH,
  );
  const ciphertext = encryptedBuffer.subarray(HEADER_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH);

  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  let decrypted;

  try {
    decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
  } catch {
    throw new Error(
      'Failed to decrypt the credential vault. The master key may be incorrect or the vault file may be corrupted.',
    );
  }

  return decrypted.toString('utf8');
}
