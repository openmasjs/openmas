import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {
  mkdtemp,
  readFile,
  readdir,
  rename,
} from 'node:fs/promises';
import {
  publishMutableJsonSnapshot,
  removeFileWithTransientRetry,
} from '../../src/os/service/mutable-json-publication.js';

async function createTemporaryRoot() {
  return mkdtemp(path.join(os.tmpdir(), 'openmas-mutable-json-publication-'));
}

function createFileError(code) {
  const error = new Error(`Injected ${code} mutable publication failure.`);
  error.code = code;
  return error;
}

test('publishMutableJsonSnapshot retries transient Windows replacement contention and cleans temporary files', async () => {
  const rootPath = await createTemporaryRoot();
  const filePath = path.join(rootPath, 'state.json');
  const delays = [];
  let attempts = 0;

  await publishMutableJsonSnapshot({
    filePath,
    data: {
      status: 'idle',
    },
    renameFile: async (sourcePath, destinationPath) => {
      attempts += 1;

      if (attempts < 3) {
        throw createFileError('EPERM');
      }

      return rename(sourcePath, destinationPath);
    },
    waitForRetry: async (delayMs) => {
      delays.push(delayMs);
    },
  });

  assert.equal(attempts, 3);
  assert.deepEqual(delays, [10, 20]);
  assert.deepEqual(JSON.parse(await readFile(filePath, 'utf8')), {
    status: 'idle',
  });
  assert.deepEqual(await readdir(rootPath), ['state.json']);
});

test('publishMutableJsonSnapshot fails fast for non-transient failures and removes abandoned temporary files', async () => {
  const rootPath = await createTemporaryRoot();
  const filePath = path.join(rootPath, 'heartbeat.json');
  let attempts = 0;
  let waits = 0;

  await assert.rejects(
    () => publishMutableJsonSnapshot({
      filePath,
      data: {
        status: 'idle',
      },
      renameFile: async () => {
        attempts += 1;
        throw createFileError('ENOSPC');
      },
      waitForRetry: async () => {
        waits += 1;
      },
    }),
    { code: 'ENOSPC' },
  );

  assert.equal(attempts, 1);
  assert.equal(waits, 0);
  assert.deepEqual(await readdir(rootPath), []);
});

test('publishMutableJsonSnapshot tolerates prolonged transient reader contention before publishing', async () => {
  const rootPath = await createTemporaryRoot();
  const filePath = path.join(rootPath, 'state.json');
  const delays = [];
  let attempts = 0;

  await publishMutableJsonSnapshot({
    filePath,
    data: {
      status: 'idle',
    },
    renameFile: async (sourcePath, destinationPath) => {
      attempts += 1;

      if (attempts < 10) {
        throw createFileError('EPERM');
      }

      return rename(sourcePath, destinationPath);
    },
    waitForRetry: async (delayMs) => {
      delays.push(delayMs);
    },
  });

  assert.equal(attempts, 10);
  assert.deepEqual(delays, [
    10, 20, 30, 40, 50, 60, 70, 80, 90,
  ]);
  assert.deepEqual(JSON.parse(await readFile(filePath, 'utf8')), {
    status: 'idle',
  });
});

test('removeFileWithTransientRetry tolerates transient Windows contention before removing ownership state', async () => {
  const delays = [];
  let attempts = 0;

  const removed = await removeFileWithTransientRetry({
    filePath: 'kernel-lock.json',
    removeFile: async () => {
      attempts += 1;

      if (attempts < 4) {
        throw createFileError('EPERM');
      }
    },
    waitForRetry: async (delayMs) => {
      delays.push(delayMs);
    },
  });

  assert.equal(removed, true);
  assert.equal(attempts, 4);
  assert.deepEqual(delays, [10, 20, 30]);
});
