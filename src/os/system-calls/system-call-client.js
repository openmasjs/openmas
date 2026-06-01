import { readFile } from 'node:fs/promises';
import {
  assertOpenMasOsSystemCall,
} from '../../contracts/os/openmas-os-system-call-contract.js';
import { createLocalSystemCallInbox } from './local-system-call-inbox.js';

const DEFAULT_WAIT_TIMEOUT_MS = 5000;
const DEFAULT_WAIT_INTERVAL_MS = 100;

function defaultSleep(delayMs) {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

function defaultNowMs() {
  return Date.now();
}

function isNotFoundError(error) {
  return error instanceof Error && /was not found/u.test(error.message);
}

function normalizeSleep(sleep) {
  if (sleep === undefined || sleep === null) {
    return defaultSleep;
  }

  if (typeof sleep !== 'function') {
    throw new Error('OpenMAS OS System Call Client sleep must be a function when provided.');
  }

  return sleep;
}

function normalizeNowMs(nowMs) {
  if (nowMs === undefined || nowMs === null) {
    return defaultNowMs;
  }

  if (typeof nowMs !== 'function') {
    throw new Error('OpenMAS OS System Call Client nowMs must be a function when provided.');
  }

  return nowMs;
}

function normalizeNonNegativeInteger(value, description) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${description} must be an integer greater than or equal to 0.`);
  }

  return value;
}

function normalizePositiveInteger(value, description) {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${description} must be an integer greater than or equal to 1.`);
  }

  return value;
}

async function readJsonFile(filePath, description) {
  let rawContent;

  try {
    rawContent = await readFile(filePath, 'utf8');
  } catch (error) {
    throw new Error(`${description} could not be read: ${error.message}`);
  }

  try {
    return JSON.parse(rawContent);
  } catch (error) {
    throw new Error(`${description} could not be parsed as JSON: ${error.message}`);
  }
}

export async function readOpenMasOsSystemCallFile(filePath) {
  return assertOpenMasOsSystemCall(await readJsonFile(
    filePath,
    'OpenMAS OS System Call file',
  ));
}

export async function waitForOpenMasOsSystemCallResult({
  inbox,
  systemCallId,
  timeoutMs = DEFAULT_WAIT_TIMEOUT_MS,
  intervalMs = DEFAULT_WAIT_INTERVAL_MS,
  sleep = defaultSleep,
  nowMs = defaultNowMs,
} = {}) {
  const safeTimeoutMs = normalizeNonNegativeInteger(
    timeoutMs,
    'OpenMAS OS System Call Client wait timeoutMs',
  );
  const safeIntervalMs = normalizePositiveInteger(
    intervalMs,
    'OpenMAS OS System Call Client wait intervalMs',
  );
  const sleepFn = normalizeSleep(sleep);
  const nowMsFn = normalizeNowMs(nowMs);
  const startedAtMs = nowMsFn();

  while (nowMsFn() - startedAtMs <= safeTimeoutMs) {
    try {
      const result = await inbox.loadSystemCallResult(systemCallId);

      return {
        status: 'result_available',
        result,
        waitedMs: Math.max(0, nowMsFn() - startedAtMs),
      };
    } catch (error) {
      if (!isNotFoundError(error)) {
        throw error;
      }
    }

    if (safeTimeoutMs === 0) {
      break;
    }

    await sleepFn(safeIntervalMs);
  }

  return {
    status: 'timeout',
    result: null,
    waitedMs: Math.max(0, nowMsFn() - startedAtMs),
  };
}

export async function submitOpenMasOsSystemCall({
  projectRootPath = null,
  osRootPath = null,
  systemCall,
  waitForResult = false,
  waitTimeoutMs = DEFAULT_WAIT_TIMEOUT_MS,
  waitIntervalMs = DEFAULT_WAIT_INTERVAL_MS,
  sleep = defaultSleep,
  nowMs = defaultNowMs,
} = {}) {
  const inbox = createLocalSystemCallInbox({
    projectRootPath,
    osRootPath,
  });
  const normalizedSystemCall = assertOpenMasOsSystemCall(systemCall);
  const submission = await inbox.submitSystemCall(normalizedSystemCall);
  const wait = waitForResult
    ? await waitForOpenMasOsSystemCallResult({
      inbox,
      systemCallId: normalizedSystemCall.systemCallId,
      timeoutMs: waitTimeoutMs,
      intervalMs: waitIntervalMs,
      sleep,
      nowMs,
    })
    : {
      status: 'not_requested',
      result: null,
      waitedMs: 0,
    };

  return {
    kind: 'openmas_os_system_call_submission_result',
    version: 1,
    status: wait.result ? wait.result.status : 'pending',
    submitted: true,
    projectRootPath,
    osRootPath,
    systemCallId: normalizedSystemCall.systemCallId,
    operation: normalizedSystemCall.operation,
    requestedAt: normalizedSystemCall.requestedAt,
    requestedBy: normalizedSystemCall.requestedBy,
    state: submission.state,
    systemCallPath: submission.systemCallPath,
    wait: {
      status: wait.status,
      waitedMs: wait.waitedMs,
      timeoutMs: waitForResult ? waitTimeoutMs : 0,
    },
    result: wait.result,
  };
}

export async function submitOpenMasOsSystemCallFile({
  systemCallFilePath,
  ...options
} = {}) {
  const systemCall = await readOpenMasOsSystemCallFile(systemCallFilePath);

  return submitOpenMasOsSystemCall({
    ...options,
    systemCall,
  });
}

export {
  DEFAULT_WAIT_INTERVAL_MS,
  DEFAULT_WAIT_TIMEOUT_MS,
};
