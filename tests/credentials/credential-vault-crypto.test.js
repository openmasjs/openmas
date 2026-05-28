import test from 'node:test';
import assert from 'node:assert/strict';
import { generateMasterKey } from '../../src/credentials/generate-master-key.js';
import { encryptCredentialVault } from '../../src/credentials/encrypt-credential-vault.js';
import { decryptCredentialVault } from '../../src/credentials/decrypt-credential-vault.js';

// --- generateMasterKey Tests ---

test('generateMasterKey returns a 64-character hexadecimal string', () => {
  const key = generateMasterKey();

  assert.equal(typeof key, 'string');
  assert.equal(key.length, 64);
});

test('generateMasterKey returns only valid lowercase hexadecimal characters', () => {
  const key = generateMasterKey();

  assert.match(key, /^[0-9a-f]{64}$/);
});

test('generateMasterKey returns a different key on each call', () => {
  const key1 = generateMasterKey();
  const key2 = generateMasterKey();

  assert.notEqual(key1, key2);
});

// --- encryptCredentialVault + decryptCredentialVault Roundtrip Tests ---

test('encrypt then decrypt returns the original plaintext', () => {
  const key = generateMasterKey();
  const plaintext = JSON.stringify({ 'gemini-api-key': 'AIzaSy123', 'openrouter-api-key': 'sk-or-v1-abc' });

  const encrypted = encryptCredentialVault(plaintext, key);
  const decrypted = decryptCredentialVault(encrypted, key);

  assert.equal(decrypted, plaintext);
});

test('encrypt then decrypt works with an empty JSON object', () => {
  const key = generateMasterKey();
  const plaintext = JSON.stringify({});

  const encrypted = encryptCredentialVault(plaintext, key);
  const decrypted = decryptCredentialVault(encrypted, key);

  assert.equal(decrypted, plaintext);
});

test('encrypt then decrypt works with a large vault containing many secrets', () => {
  const key = generateMasterKey();
  const credentials = {};

  for (let i = 0; i < 100; i++) {
    credentials[`secret-${i}`] = `value-${i}-${'x'.repeat(200)}`;
  }

  const plaintext = JSON.stringify(credentials, null, 2);
  const encrypted = encryptCredentialVault(plaintext, key);
  const decrypted = decryptCredentialVault(encrypted, key);

  assert.equal(decrypted, plaintext);

  const parsed = JSON.parse(decrypted);
  assert.equal(Object.keys(parsed).length, 100);
  assert.equal(parsed['secret-0'], `value-0-${'x'.repeat(200)}`);
});

test('encrypt then decrypt works with unicode content', () => {
  const key = generateMasterKey();
  const plaintext = JSON.stringify({
    'slack-bot-token': 'token-with-émojis-🔐🔑',
    'japanese-key': 'テスト秘密鍵',
    'arabic-key': 'مفتاح-سري',
  });

  const encrypted = encryptCredentialVault(plaintext, key);
  const decrypted = decryptCredentialVault(encrypted, key);

  assert.equal(decrypted, plaintext);

  const parsed = JSON.parse(decrypted);
  assert.equal(parsed['slack-bot-token'], 'token-with-émojis-🔐🔑');
  assert.equal(parsed['japanese-key'], 'テスト秘密鍵');
  assert.equal(parsed['arabic-key'], 'مفتاح-سري');
});

test('encrypt then decrypt preserves all key-value pairs', () => {
  const key = generateMasterKey();
  const credentials = {
    'openrouter-api-key': 'sk-or-v1-abc123def456',
    'gemini-api-key': 'AIzaSyA1B2C3D4E5F6',
    'ollama-api-key': 'ollama-cloud-key-xyz',
    'chatgpt-api-key': 'sk-proj-abc123',
    'claude-api-key': 'sk-ant-api03-abc123',
    'alfred-whatsapp-token': 'EAABsbCS1IDBAO',
    'maria-instagram-token': 'IGQVJWZArV2',
  };

  const plaintext = JSON.stringify(credentials, null, 2);
  const encrypted = encryptCredentialVault(plaintext, key);
  const decrypted = decryptCredentialVault(encrypted, key);

  const parsed = JSON.parse(decrypted);

  assert.deepEqual(parsed, credentials);
});

// --- Encryption Output Properties ---

test('each encryption produces a different output due to random IV', () => {
  const key = generateMasterKey();
  const plaintext = JSON.stringify({ 'api-key': 'same-value' });

  const encrypted1 = encryptCredentialVault(plaintext, key);
  const encrypted2 = encryptCredentialVault(plaintext, key);

  assert.ok(!encrypted1.equals(encrypted2), 'Two encryptions of the same plaintext should produce different outputs.');
});

test('encrypted output is at least 31 bytes (3 header + 12 IV + 16 AuthTag)', () => {
  const key = generateMasterKey();
  const plaintext = JSON.stringify({ a: '1' });

  const encrypted = encryptCredentialVault(plaintext, key);

  assert.ok(encrypted.length >= 31, `Encrypted output should be at least 31 bytes but was ${encrypted.length} bytes.`);
});

test('encrypted output starts with the OpenMAS vault magic bytes and version', () => {
  const key = generateMasterKey();
  const plaintext = JSON.stringify({ 'api-key': 'value' });

  const encrypted = encryptCredentialVault(plaintext, key);

  assert.equal(encrypted[0], 0x4F, 'First magic byte should be 0x4F (O)');
  assert.equal(encrypted[1], 0x4D, 'Second magic byte should be 0x4D (M)');
  assert.equal(encrypted[2], 0x01, 'Version byte should be 0x01');
});

test('encrypted output is a Buffer', () => {
  const key = generateMasterKey();
  const plaintext = JSON.stringify({});

  const encrypted = encryptCredentialVault(plaintext, key);

  assert.ok(Buffer.isBuffer(encrypted));
});

// --- Decryption Error Handling ---

test('decryption with a wrong key throws an error', () => {
  const correctKey = generateMasterKey();
  const wrongKey = generateMasterKey();
  const plaintext = JSON.stringify({ 'api-key': 'secret-value' });

  const encrypted = encryptCredentialVault(plaintext, correctKey);

  assert.throws(
    () => decryptCredentialVault(encrypted, wrongKey),
    /master key may be incorrect/,
  );
});

test('decryption with a corrupted buffer throws an error', () => {
  const key = generateMasterKey();
  const plaintext = JSON.stringify({ 'api-key': 'secret-value' });

  const encrypted = encryptCredentialVault(plaintext, key);

  // Corrupt the auth tag (offset by 3-byte header)
  encrypted[18] = encrypted[18] ^ 0xff;

  assert.throws(
    () => decryptCredentialVault(encrypted, key),
    /master key may be incorrect|corrupted/,
  );
});

test('decryption with a truncated buffer throws an error', () => {
  const key = generateMasterKey();

  const truncatedBuffer = Buffer.alloc(10);

  assert.throws(
    () => decryptCredentialVault(truncatedBuffer, key),
    /too short/,
  );
});

test('decryption with an empty buffer throws an error', () => {
  const key = generateMasterKey();

  const emptyBuffer = Buffer.alloc(0);

  assert.throws(
    () => decryptCredentialVault(emptyBuffer, key),
    /too short/,
  );
});

// --- Input Validation ---

test('encryptCredentialVault rejects non-string plaintext', () => {
  const key = generateMasterKey();

  assert.throws(
    () => encryptCredentialVault(123, key),
    /must be a string/,
  );
});

test('encryptCredentialVault rejects non-string master key', () => {
  assert.throws(
    () => encryptCredentialVault('{}', 12345),
    /64-character hexadecimal/,
  );
});

test('encryptCredentialVault rejects master key with wrong length', () => {
  assert.throws(
    () => encryptCredentialVault('{}', 'abcdef'),
    /64-character hexadecimal/,
  );
});

test('decryptCredentialVault rejects non-Buffer input', () => {
  const key = generateMasterKey();

  assert.throws(
    () => decryptCredentialVault('not-a-buffer', key),
    /must be a Buffer/,
  );
});

test('decryptCredentialVault rejects master key with wrong length', () => {
  const buffer = Buffer.from([0x4F, 0x4D, 0x01, ...Buffer.alloc(28)]);

  assert.throws(
    () => decryptCredentialVault(buffer, 'short-key'),
    /64-character hexadecimal/,
  );
});

test('decryptCredentialVault rejects a file without the OpenMAS magic header', () => {
  const key = generateMasterKey();
  const badHeader = Buffer.alloc(40);
  badHeader[0] = 0xFF;
  badHeader[1] = 0xFF;
  badHeader[2] = 0x01;

  assert.throws(
    () => decryptCredentialVault(badHeader, key),
    /does not have the expected OpenMAS vault header/,
  );
});

test('decryptCredentialVault rejects an unsupported vault format version', () => {
  const key = generateMasterKey();
  const futureVersion = Buffer.alloc(40);
  futureVersion[0] = 0x4F;
  futureVersion[1] = 0x4D;
  futureVersion[2] = 0x99;

  assert.throws(
    () => decryptCredentialVault(futureVersion, key),
    /Unsupported credential vault format version: 153/,
  );
});
