import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  mkdir,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises';

const TRANSIENT_FILE_OPERATION_MAX_ATTEMPTS = 25;
const TRANSIENT_FILE_OPERATION_RETRY_DELAY_MS = 10;

function isTransientFileAccessError(error) {
  return error && ['EACCES', 'EBUSY', 'EPERM'].includes(error.code);
}

function isNotFoundError(error) {
  return error && error.code === 'ENOENT';
}

function wait(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

export async function removeFileWithTransientRetry({
  filePath,
  removeFile = unlink,
  waitForRetry = wait,
  maxAttempts = TRANSIENT_FILE_OPERATION_MAX_ATTEMPTS,
  retryDelayMs = TRANSIENT_FILE_OPERATION_RETRY_DELAY_MS,
  ignoreNotFound = false,
} = {}) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      await removeFile(filePath);
      return true;
    } catch (error) {
      if (ignoreNotFound && isNotFoundError(error)) {
        return false;
      }

      if (!isTransientFileAccessError(error) || attempt === maxAttempts - 1) {
        throw error;
      }

      await waitForRetry(retryDelayMs * (attempt + 1));
    }
  }

  return false;
}

async function removeFileIfPresent(filePath, removeFile = unlink) {
  await removeFileWithTransientRetry({
    filePath,
    removeFile,
    ignoreNotFound: true,
  });
}

export async function publishMutableJsonSnapshot({
  filePath,
  data,
  renameFile = rename,
  waitForRetry = wait,
  maxAttempts = TRANSIENT_FILE_OPERATION_MAX_ATTEMPTS,
  retryDelayMs = TRANSIENT_FILE_OPERATION_RETRY_DELAY_MS,
} = {}) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${randomUUID()}.tmp`,
  );

  await writeFile(temporaryPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');

  try {
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        await renameFile(temporaryPath, filePath);
        return filePath;
      } catch (error) {
        if (!isTransientFileAccessError(error) || attempt === maxAttempts - 1) {
          throw error;
        }

        await waitForRetry(retryDelayMs * (attempt + 1));
      }
    }
  } finally {
    await removeFileIfPresent(temporaryPath);
  }

  return filePath;
}

export {
  TRANSIENT_FILE_OPERATION_MAX_ATTEMPTS,
  TRANSIENT_FILE_OPERATION_RETRY_DELAY_MS,
};
