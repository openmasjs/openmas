import { randomBytes, createCipheriv } from 'node:crypto';

const VAULT_MAGIC = Buffer.from([0x4F, 0x4D]);
const VAULT_FORMAT_VERSION = 0x01;

export function encryptCredentialVault(plaintextContent, masterKeyHex) {
  if (typeof plaintextContent !== 'string') {
    throw new Error('Credential vault plaintext content must be a string.');
  }

  if (typeof masterKeyHex !== 'string' || masterKeyHex.length !== 64) {
    throw new Error('Master key must be a 64-character hexadecimal string.');
  }

  const key = Buffer.from(masterKeyHex, 'hex');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintextContent, 'utf8'),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();
  const versionByte = Buffer.from([VAULT_FORMAT_VERSION]);

  return Buffer.concat([VAULT_MAGIC, versionByte, iv, authTag, encrypted]);
}
