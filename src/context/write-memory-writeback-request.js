import path from 'node:path';
import { assertMemoryWritebackRequest } from '../contracts/memory/memory-writeback-contract.js';
import { ensureDirectory } from '../persistence/ensure-directory.js';
import { writeJsonFile } from '../persistence/write-json-file.js';

const SAFE_RECORD_ID_PATTERN = /^[a-zA-Z0-9._-]+$/u;

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function assertSafeRecordId(value, description) {
  if (!isNonEmptyString(value)) {
    throw new Error(`${description} must be a non-empty string.`);
  }

  const normalizedValue = value.trim();

  if (!SAFE_RECORD_ID_PATTERN.test(normalizedValue)) {
    throw new Error(`${description} contains unsafe filesystem characters: ${normalizedValue}`);
  }

  return normalizedValue;
}

export async function writeMemoryWritebackRequest({
  masRootPath,
  memoryWritebackRequest,
  recordId = null,
} = {}) {
  if (!isNonEmptyString(masRootPath)) {
    throw new Error('Memory writeback request persistence requires a non-empty masRootPath.');
  }

  const normalizedRequest = assertMemoryWritebackRequest(memoryWritebackRequest);
  const safeRecordId = assertSafeRecordId(
    recordId ?? normalizedRequest.invocationId,
    'Memory writeback request persistence recordId',
  );
  const stateDirectoryPath = path.join(masRootPath, 'memory', 'state');
  const recordPath = path.join(stateDirectoryPath, `memory-writeback-${safeRecordId}.json`);
  const relativePath = `memory/state/memory-writeback-${safeRecordId}.json`;

  await ensureDirectory(stateDirectoryPath);
  await writeJsonFile(recordPath, normalizedRequest);

  return {
    targetType: 'mas-memory',
    recordPath,
    relativePath,
    writeCount: normalizedRequest.memoryWrites.length,
    requiresHumanApproval: normalizedRequest.requiresHumanApproval,
  };
}
