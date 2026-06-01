import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  createLocalAsyncDispatchExecutor,
  runOpenMasOsServiceTick,
} from './local-os-service.js';
import {
  DEFAULT_HEARTBEAT_INTERVAL_MS,
  DEFAULT_MAX_DISPATCHED_JOBS_PER_TICK,
  DEFAULT_MAX_SYSTEM_CALLS_PER_TICK,
  DEFAULT_STALE_AFTER_MS,
  DEFAULT_TICK_INTERVAL_MS,
  createOpenMasOsRuntimeLoopController,
  runOpenMasOsRuntimeLoop,
} from './local-os-runtime-loop.js';
import {
  claimKernelLock,
  isKernelLockStale,
  readKernelLock,
  refreshKernelLock,
  releaseKernelLock,
} from './kernel-lock.js';
import {
  buildServiceHealthSummary,
  buildServiceState,
  readServiceHeartbeat,
  readServiceState,
  writeServiceHealthSnapshot,
} from './service-health.js';
import {
  OPENMAS_OS_KINDS,
  OPENMAS_OS_SCHEMA_VERSION,
  assertSafeOsSerializableValue,
} from '../../contracts/os/openmas-os-runtime-contract.js';
import {
  createOpenMasOsResultSummaryFromRecord,
} from '../../contracts/os/openmas-os-result-record-contract.js';
import { createLocalRuntimeAdapter } from '../adapters/local-runtime-adapter.js';
import {
  LOCAL_SYSTEM_CALL_STATES,
  createLocalSystemCallInbox,
} from '../system-calls/local-system-call-inbox.js';

const SERVICE_STATUS_RESULT_KIND = 'openmas_os_service_status_result';
const SERVICE_STATUS_RESULT_VERSION = 1;
const SERVICE_SYSTEM_CALL_SUBMISSION_RESULT_KIND = 'openmas_os_service_system_call_submission_result';
const SERVICE_SYSTEM_CALL_SUBMISSION_RESULT_VERSION = 1;
const SERVICE_HELP_RESULT_KIND = 'openmas_os_service_help_result';
const SERVICE_HELP_RESULT_VERSION = 1;
const SYSTEM_CALL_STATUS_SUMMARY_KIND = 'openmas_os_system_call_status_summary';
const DEFAULT_RECENT_SYSTEM_CALL_RESULT_LIMIT = 5;
const DEFAULT_RECENT_OS_RESULT_RECORD_LIMIT = 5;
const DEFAULT_BLOCKED_WAIT_LIMIT = 5;
const DEFAULT_STALE_SYSTEM_CALL_AFTER_MS = 30000;
const DEFAULT_SYSTEM_CALL_WAIT_TIMEOUT_MS = 5000;
const DEFAULT_SYSTEM_CALL_WAIT_INTERVAL_MS = 100;
const CLOSED_OUTPUT_STREAM = Symbol('openmas_os_service_closed_output_stream');
const SECRET_VALUE_REDACTION_PATTERNS = Object.freeze([
  /sk-(?:or-)?[a-zA-Z0-9_-]{8,}/gu,
  /AIza[a-zA-Z0-9_-]{10,}/gu,
  /xox[baprs]-[a-zA-Z0-9-]{8,}/gu,
  /Bearer\s+[a-zA-Z0-9._~+/-]{12,}/giu,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/gu,
]);

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function createServiceId() {
  return `openmas_os_service_${randomUUID()}`;
}

function defaultNow() {
  return new Date().toISOString();
}

function normalizeNow(now) {
  return typeof now === 'function' ? now : defaultNow;
}

function parsePositiveInteger(value, description) {
  if (!isNonEmptyString(value)) {
    throw new Error(`Missing value for ${description}`);
  }

  const normalizedValue = Number(value);

  if (!Number.isInteger(normalizedValue) || normalizedValue < 1) {
    throw new Error(`${description} must be an integer greater than or equal to 1.`);
  }

  return normalizedValue;
}

function readOptionValue({ argv, index, optionName }) {
  if (!argv[index + 1]) {
    throw new Error(`Missing value for ${optionName}`);
  }

  return {
    value: argv[index + 1],
    nextIndex: index + 1,
  };
}

function assertSingleCliMode(options, mode) {
  if (options.mode && options.mode !== mode) {
    throw new Error('Use only one of --tick, --watch, --status, --submit-system-call, or --help.');
  }

  options.mode = mode;
}

export function parseOpenMasOsServiceCliArgs(argv) {
  const options = {
    mode: null,
    projectRootPath: process.cwd(),
    json: false,
    quiet: false,
    tickIntervalMs: DEFAULT_TICK_INTERVAL_MS,
    maxDispatchedJobs: DEFAULT_MAX_DISPATCHED_JOBS_PER_TICK,
    staleAfterMs: DEFAULT_STALE_AFTER_MS,
    serviceId: null,
    systemCallPath: null,
    waitForResult: false,
    waitTimeoutMs: DEFAULT_SYSTEM_CALL_WAIT_TIMEOUT_MS,
    waitIntervalMs: DEFAULT_SYSTEM_CALL_WAIT_INTERVAL_MS,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === '--tick') {
      assertSingleCliMode(options, 'tick');
      continue;
    }

    if (argument === '--watch') {
      assertSingleCliMode(options, 'watch');
      continue;
    }

    if (argument === '--status') {
      assertSingleCliMode(options, 'status');
      continue;
    }

    if (argument === '--help' || argument === '-h') {
      assertSingleCliMode(options, 'help');
      continue;
    }

    if (argument === '--submit-system-call') {
      const parsedValue = readOptionValue({ argv, index, optionName: '--submit-system-call' });
      assertSingleCliMode(options, 'submit_system_call');
      options.systemCallPath = parsedValue.value;
      index = parsedValue.nextIndex;
      continue;
    }

    if (argument.startsWith('--submit-system-call=')) {
      assertSingleCliMode(options, 'submit_system_call');
      options.systemCallPath = argument.slice('--submit-system-call='.length);
      continue;
    }

    if (argument === '--json') {
      options.json = true;
      continue;
    }

    if (argument === '--quiet') {
      options.quiet = true;
      continue;
    }

    if (argument === '--project-root') {
      const parsedValue = readOptionValue({ argv, index, optionName: '--project-root' });
      options.projectRootPath = parsedValue.value;
      index = parsedValue.nextIndex;
      continue;
    }

    if (argument.startsWith('--project-root=')) {
      options.projectRootPath = argument.slice('--project-root='.length);
      continue;
    }

    if (argument === '--interval') {
      const parsedValue = readOptionValue({ argv, index, optionName: '--interval' });
      options.tickIntervalMs = parsePositiveInteger(parsedValue.value, '--interval');
      index = parsedValue.nextIndex;
      continue;
    }

    if (argument.startsWith('--interval=')) {
      options.tickIntervalMs = parsePositiveInteger(
        argument.slice('--interval='.length),
        '--interval',
      );
      continue;
    }

    if (argument === '--max-dispatched-jobs') {
      const parsedValue = readOptionValue({ argv, index, optionName: '--max-dispatched-jobs' });
      options.maxDispatchedJobs = parsePositiveInteger(
        parsedValue.value,
        '--max-dispatched-jobs',
      );
      index = parsedValue.nextIndex;
      continue;
    }

    if (argument.startsWith('--max-dispatched-jobs=')) {
      options.maxDispatchedJobs = parsePositiveInteger(
        argument.slice('--max-dispatched-jobs='.length),
        '--max-dispatched-jobs',
      );
      continue;
    }

    if (argument === '--service-id') {
      const parsedValue = readOptionValue({ argv, index, optionName: '--service-id' });
      options.serviceId = parsedValue.value;
      index = parsedValue.nextIndex;
      continue;
    }

    if (argument.startsWith('--service-id=')) {
      options.serviceId = argument.slice('--service-id='.length);
      continue;
    }

    if (argument === '--wait') {
      options.waitForResult = true;
      continue;
    }

    if (argument === '--wait-timeout-ms') {
      const parsedValue = readOptionValue({ argv, index, optionName: '--wait-timeout-ms' });
      options.waitTimeoutMs = parsePositiveInteger(parsedValue.value, '--wait-timeout-ms');
      index = parsedValue.nextIndex;
      continue;
    }

    if (argument.startsWith('--wait-timeout-ms=')) {
      options.waitTimeoutMs = parsePositiveInteger(
        argument.slice('--wait-timeout-ms='.length),
        '--wait-timeout-ms',
      );
      continue;
    }

    if (argument === '--wait-interval-ms') {
      const parsedValue = readOptionValue({ argv, index, optionName: '--wait-interval-ms' });
      options.waitIntervalMs = parsePositiveInteger(parsedValue.value, '--wait-interval-ms');
      index = parsedValue.nextIndex;
      continue;
    }

    if (argument.startsWith('--wait-interval-ms=')) {
      options.waitIntervalMs = parsePositiveInteger(
        argument.slice('--wait-interval-ms='.length),
        '--wait-interval-ms',
      );
      continue;
    }

    throw new Error(`Unsupported argument: ${argument}`);
  }

  if (options.mode === null) {
    throw new Error('OpenMAS OS Service requires --tick, --watch, --status, --submit-system-call, or --help.');
  }

  if (options.mode === 'submit_system_call' && !isNonEmptyString(options.systemCallPath)) {
    throw new Error('--submit-system-call requires a non-empty file path.');
  }

  if (options.mode !== 'watch' && options.tickIntervalMs !== DEFAULT_TICK_INTERVAL_MS) {
    throw new Error('--interval is only supported with --watch.');
  }

  if (options.mode !== 'watch' && options.quiet) {
    throw new Error('--quiet is only supported with --watch.');
  }

  if (
    !['tick', 'watch'].includes(options.mode)
    && options.maxDispatchedJobs !== DEFAULT_MAX_DISPATCHED_JOBS_PER_TICK
  ) {
    throw new Error('--max-dispatched-jobs is only supported with --tick or --watch.');
  }

  if (options.mode !== 'watch' && options.serviceId !== null) {
    throw new Error('--service-id is only supported with --watch.');
  }

  if (options.systemCallPath !== null && options.mode !== 'submit_system_call') {
    throw new Error('--submit-system-call is only supported as its own command mode.');
  }

  if (options.mode !== 'submit_system_call') {
    if (options.waitForResult) {
      throw new Error('--wait is only supported with --submit-system-call.');
    }

    if (options.waitTimeoutMs !== DEFAULT_SYSTEM_CALL_WAIT_TIMEOUT_MS) {
      throw new Error('--wait-timeout-ms is only supported with --submit-system-call.');
    }

    if (options.waitIntervalMs !== DEFAULT_SYSTEM_CALL_WAIT_INTERVAL_MS) {
      throw new Error('--wait-interval-ms is only supported with --submit-system-call.');
    }
  }

  return options;
}

function isClosedOutputError(error) {
  return error?.code === 'EPIPE' || error?.code === 'ERR_STREAM_DESTROYED';
}

function markOutputStreamClosed(stream) {
  if (stream && (typeof stream === 'object' || typeof stream === 'function')) {
    stream[CLOSED_OUTPUT_STREAM] = true;
  }
}

function isOutputStreamClosed(stream) {
  return Boolean(
    stream?.[CLOSED_OUTPUT_STREAM]
    || stream?.destroyed
    || stream?.writableDestroyed
  );
}

function writeLine(stream, line = '') {
  if (isOutputStreamClosed(stream)) {
    return;
  }

  try {
    stream.write(`${line}\n`);
  } catch (error) {
    if (isClosedOutputError(error)) {
      markOutputStreamClosed(stream);
      return;
    }

    throw error;
  }
}

function installOpenMasOsServiceOutputHandlers({
  stdout,
  controller,
}) {
  if (!stdout || typeof stdout.on !== 'function') {
    return {
      uninstall: () => {},
    };
  }

  const handleOutputError = (error) => {
    if (isClosedOutputError(error)) {
      markOutputStreamClosed(stdout);
      controller.requestStop('stdout_closed');
      return;
    }

    throw error;
  };

  stdout.on('error', handleOutputError);

  return {
    uninstall: () => {
      if (typeof stdout.off === 'function') {
        stdout.off('error', handleOutputError);
      } else if (typeof stdout.removeListener === 'function') {
        stdout.removeListener('error', handleOutputError);
      }
    },
  };
}

function createSignalShutdownReason(signalName) {
  return `signal_${String(signalName ?? 'unknown').toLowerCase()}`;
}

function createSignalShutdownMessage(signalName) {
  return `OpenMAS OS Service received ${signalName}. Graceful shutdown requested.`;
}

function isTransientMutablePublicationError(error) {
  return error && ['EACCES', 'EBUSY', 'EPERM'].includes(error.code);
}

function maybeWriteShutdownNotice({ stdout, json, signalName }) {
  if (!json) {
    writeLine(stdout, createSignalShutdownMessage(signalName));
  }
}

function installOpenMasOsServiceSignalHandlers({
  signalTarget,
  controller,
  stdout,
  json,
  onSignal,
}) {
  if (!signalTarget) {
    return {
      uninstall: () => {},
      waitForSignals: async () => {},
    };
  }

  const addListener = typeof signalTarget.on === 'function'
    ? signalTarget.on.bind(signalTarget)
    : typeof signalTarget.addListener === 'function'
      ? signalTarget.addListener.bind(signalTarget)
      : null;
  const removeListener = typeof signalTarget.off === 'function'
    ? signalTarget.off.bind(signalTarget)
    : typeof signalTarget.removeListener === 'function'
      ? signalTarget.removeListener.bind(signalTarget)
      : null;

  if (!addListener || !removeListener) {
    throw new Error('OpenMAS OS service signalTarget must support on/off or addListener/removeListener.');
  }

  const signalTasks = [];
  const handler = (signalName) => {
    const reason = createSignalShutdownReason(signalName);

    controller.requestStop(reason);
    maybeWriteShutdownNotice({
      stdout,
      json,
      signalName,
    });

    if (onSignal) {
      const signalTask = Promise.resolve(onSignal({
        signalName,
        reason,
      }));

      signalTasks.push(signalTask);
    }
  };
  const sigintHandler = () => handler('SIGINT');
  const sigtermHandler = () => handler('SIGTERM');

  addListener('SIGINT', sigintHandler);
  addListener('SIGTERM', sigtermHandler);

  return {
    uninstall: () => {
      removeListener('SIGINT', sigintHandler);
      removeListener('SIGTERM', sigtermHandler);
    },
    waitForSignals: async () => {
      await Promise.all(signalTasks);
    },
  };
}

function createSignalAwareSleep({ controller }) {
  return async (delayMs) => {
    if (controller.stopRequested) {
      return;
    }

    await new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timeout);
        clearInterval(interval);
        resolve();
      };
      const timeout = setTimeout(finish, delayMs);
      const interval = setInterval(() => {
        if (!controller.stopRequested) {
          return;
        }

        finish();
      }, 25);
    });
  };
}

function calculateDurationMs({ startedAt, observedAt }) {
  if (!startedAt || !observedAt) {
    return null;
  }

  const startedAtMs = Date.parse(startedAt);
  const observedAtMs = Date.parse(observedAt);

  if (Number.isNaN(startedAtMs) || Number.isNaN(observedAtMs)) {
    return null;
  }

  return Math.max(0, observedAtMs - startedAtMs);
}

function formatDurationMs(durationMs) {
  if (durationMs === null || durationMs === undefined) {
    return 'unknown';
  }

  const totalSeconds = Math.floor(durationMs / 1000);

  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }

  const totalMinutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (totalMinutes < 60) {
    return seconds === 0 ? `${totalMinutes}m` : `${totalMinutes}m ${seconds}s`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}

function formatStatusValue(value, fallback = 'none') {
  return value === null || value === undefined || value === '' ? fallback : String(value);
}

function redactSecretLikeValues(value) {
  const stringValue = String(value ?? '');
  let redactedValue = stringValue;

  for (const pattern of SECRET_VALUE_REDACTION_PATTERNS) {
    redactedValue = redactedValue.replace(pattern, '[redacted-secret]');
  }

  return redactedValue.slice(0, 1000);
}

function createSafeErrorMessage(error, fallbackMessage = 'OpenMAS OS service status failed.') {
  if (error instanceof Error && isNonEmptyString(error.message)) {
    return redactSecretLikeValues(error.message);
  }

  if (isNonEmptyString(error)) {
    return redactSecretLikeValues(error);
  }

  return fallbackMessage;
}

function createSafeErrorName(error) {
  if (error instanceof Error && isNonEmptyString(error.name)) {
    return redactSecretLikeValues(error.name);
  }

  return 'Error';
}

function calculateAgeMs({ timestamp, observedAt }) {
  if (!timestamp || !observedAt) {
    return null;
  }

  const timestampMs = Date.parse(timestamp);
  const observedAtMs = Date.parse(observedAt);

  if (Number.isNaN(timestampMs) || Number.isNaN(observedAtMs)) {
    return null;
  }

  return Math.max(0, observedAtMs - timestampMs);
}

function isExpiredAt({ expiresAt, observedAt }) {
  if (!expiresAt) {
    return false;
  }

  const expiresAtMs = Date.parse(expiresAt);
  const observedAtMs = Date.parse(observedAt);

  return !Number.isNaN(expiresAtMs)
    && !Number.isNaN(observedAtMs)
    && expiresAtMs <= observedAtMs;
}

function summarizePrincipal(principal) {
  if (!principal) {
    return null;
  }

  return {
    type: principal.type ?? null,
    id: principal.id ?? null,
  };
}

function summarizeSystemCallSnapshot({
  systemCall,
  storageState,
  observedAt,
  staleAfterMs,
}) {
  const ageMs = calculateAgeMs({
    timestamp: systemCall.requestedAt,
    observedAt,
  });

  return {
    systemCallId: systemCall.systemCallId,
    operation: systemCall.operation,
    storageState,
    status: systemCall.status,
    requestedAt: systemCall.requestedAt,
    requestedBy: summarizePrincipal(systemCall.requestedBy),
    expiresAt: systemCall.expiresAt,
    ageMs,
    stale: ageMs !== null && ageMs >= staleAfterMs,
    expired: isExpiredAt({
      expiresAt: systemCall.expiresAt,
      observedAt,
    }),
    correlation: {
      invocationId: systemCall.correlation?.invocationId ?? null,
      actionRequestId: systemCall.correlation?.actionRequestId ?? null,
      toolRunId: systemCall.correlation?.toolRunId ?? null,
      workflowRunId: systemCall.correlation?.workflowRunId ?? null,
      conversationId: systemCall.correlation?.conversationId ?? null,
      jobId: systemCall.correlation?.jobId ?? null,
      processId: systemCall.correlation?.processId ?? null,
      threadId: systemCall.correlation?.threadId ?? null,
    },
  };
}

function summarizeSystemCallResult(result) {
  return {
    systemCallId: result.systemCallId,
    operation: result.operation,
    status: result.status,
    processedAt: result.processedAt,
    processedBy: result.processedBy,
    allowed: result.decision.allowed,
    reason: redactSecretLikeValues(result.decision.reason),
    summary: redactSecretLikeValues(result.summary),
    effects: {
      createdJobIds: result.effects.createdJobIds,
      createdTimerIds: result.effects.createdTimerIds,
      createdSignalIds: result.effects.createdSignalIds,
      createdProcessIds: result.effects.createdProcessIds,
      createdThreadIds: result.effects.createdThreadIds,
      eventIds: result.effects.eventIds,
    },
  };
}

function summarizeSubmittedSystemCall(systemCall) {
  return {
    systemCallId: systemCall.systemCallId,
    operation: systemCall.operation,
    status: systemCall.status,
    requestedAt: systemCall.requestedAt,
    requestedBy: summarizePrincipal(systemCall.requestedBy),
    expiresAt: systemCall.expiresAt,
    idempotencyKey: systemCall.idempotencyKey,
    correlation: {
      invocationId: systemCall.correlation?.invocationId ?? null,
      actionRequestId: systemCall.correlation?.actionRequestId ?? null,
      toolRunId: systemCall.correlation?.toolRunId ?? null,
      workflowRunId: systemCall.correlation?.workflowRunId ?? null,
      conversationId: systemCall.correlation?.conversationId ?? null,
      jobId: systemCall.correlation?.jobId ?? null,
      processId: systemCall.correlation?.processId ?? null,
      threadId: systemCall.correlation?.threadId ?? null,
    },
  };
}

async function readJsonInputFile(filePath, description) {
  let rawValue;

  try {
    rawValue = await readFile(filePath, 'utf8');
  } catch (error) {
    throw new Error(`${description} could not be read: ${createSafeErrorMessage(error)}`);
  }

  try {
    return JSON.parse(rawValue);
  } catch (error) {
    throw new Error(`${description} could not be parsed as JSON: ${createSafeErrorMessage(error)}`);
  }
}

async function sleepMs(delayMs) {
  await new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

async function waitForSystemCallResult({
  inbox,
  systemCallId,
  timeoutMs,
  intervalMs,
}) {
  const startedAtMs = Date.now();

  for (;;) {
    if (await inbox.hasSystemCallResult(systemCallId)) {
      return inbox.loadSystemCallResult(systemCallId);
    }

    const elapsedMs = Date.now() - startedAtMs;

    if (elapsedMs >= timeoutMs) {
      break;
    }

    await sleepMs(Math.min(intervalMs, timeoutMs - elapsedMs));
  }

  if (await inbox.hasSystemCallResult(systemCallId)) {
    return inbox.loadSystemCallResult(systemCallId);
  }

  return null;
}

function buildSystemCallSubmissionNextAction({ result, waited }) {
  if (result) {
    return `System Call ${result.systemCallId} has result status ${result.status}.`;
  }

  if (waited) {
    return 'System Call is still pending. Keep the OpenMAS OS service running or tick it again.';
  }

  return 'System Call is pending. Start or tick the OpenMAS OS service to process it.';
}

function buildSystemCallSubmissionResult({
  projectRootPath,
  submission,
  result,
  waitRequested,
  waitTimeoutMs,
  waitIntervalMs,
}) {
  return assertSafeOsSerializableValue({
    kind: SERVICE_SYSTEM_CALL_SUBMISSION_RESULT_KIND,
    version: SERVICE_SYSTEM_CALL_SUBMISSION_RESULT_VERSION,
    mode: 'submit_system_call',
    projectRootPath,
    systemCall: summarizeSubmittedSystemCall(submission.systemCall),
    submission: {
      status: 'submitted',
      state: submission.state,
      systemCallPath: submission.systemCallPath,
    },
    wait: {
      requested: waitRequested,
      timeoutMs: waitTimeoutMs,
      intervalMs: waitIntervalMs,
      status: result
        ? 'result_available'
        : waitRequested
          ? 'timed_out'
          : 'not_requested',
    },
    result: result ? summarizeSystemCallResult(result) : null,
    nextRecommendedAction: buildSystemCallSubmissionNextAction({
      result,
      waited: waitRequested,
    }),
  }, 'OpenMAS OS service System Call submission result');
}

function printSystemCallSubmissionHumanSummary(result, stdout) {
  writeLine(stdout, 'OpenMAS OS System Call Submission');
  writeLine(stdout, `Status: ${result.submission.status}`);
  writeLine(stdout, `System Call: ${result.systemCall.systemCallId}`);
  writeLine(stdout, `Operation: ${result.systemCall.operation}`);
  writeLine(stdout, `State: ${result.submission.state}`);
  writeLine(stdout, `Wait: ${result.wait.status}`);

  if (result.result) {
    writeLine(stdout, `Result: ${result.result.status}`);
    writeLine(stdout, `Summary: ${result.result.summary}`);
  } else {
    writeLine(stdout, 'Result: pending');
  }

  writeLine(stdout, `Next Action: ${result.nextRecommendedAction}`);
}

function sortSystemCallResultsNewestFirst(left, right) {
  const timestampComparison = right.processedAt.localeCompare(left.processedAt);

  if (timestampComparison !== 0) {
    return timestampComparison;
  }

  return right.systemCallId.localeCompare(left.systemCallId);
}

function sortSystemCallSnapshotsOldestFirst(left, right) {
  const timestampComparison = left.requestedAt.localeCompare(right.requestedAt);

  if (timestampComparison !== 0) {
    return timestampComparison;
  }

  return left.systemCallId.localeCompare(right.systemCallId);
}

function createSystemCallReadError({ scope, error }) {
  return {
    scope,
    message: createSafeErrorMessage(error, `OpenMAS OS could not read ${scope}.`),
  };
}

async function readSystemCallsForState({
  inbox,
  state,
  observedAt,
  staleAfterMs,
}) {
  let systemCallIds;

  try {
    systemCallIds = await inbox.listSystemCallIds(state);
  } catch (error) {
    return {
      state,
      systemCalls: [],
      summaries: [],
      readError: createSystemCallReadError({
        scope: `system-calls/${state}`,
        error,
      }),
      readErrors: [
        createSystemCallReadError({
          scope: `system-calls/${state}`,
          error,
        }),
      ],
    };
  }

  const systemCalls = [];
  const readErrors = [];

  for (const systemCallId of systemCallIds) {
    try {
      systemCalls.push(await inbox.loadSystemCall(systemCallId, state));
    } catch (error) {
      readErrors.push(createSystemCallReadError({
        scope: `system-calls/${state}/${systemCallId}`,
        error,
      }));
    }
  }

  systemCalls.sort(sortSystemCallSnapshotsOldestFirst);

  return {
    state,
    systemCalls,
    summaries: systemCalls.map((systemCall) => {
      return summarizeSystemCallSnapshot({
        systemCall,
        storageState: state,
        observedAt,
        staleAfterMs,
      });
    }),
    readError: readErrors[0] ?? null,
    readErrors,
  };
}

async function readSystemCallResultsForStatus({ inbox }) {
  try {
    const results = await inbox.listSystemCallResults();

    return {
      results,
      summaries: results
        .map(summarizeSystemCallResult)
        .sort(sortSystemCallResultsNewestFirst),
      readError: null,
    };
  } catch (error) {
    return {
      results: [],
      summaries: [],
      readError: createSystemCallReadError({
        scope: 'system-calls/results',
        error,
      }),
    };
  }
}

function buildSystemCallCurrentStatus({
  readErrors,
  stateCounts,
  pendingSummaries,
  processingSummaries,
}) {
  const stalePendingCount = pendingSummaries.filter((systemCall) => systemCall.stale).length;
  const expiredPendingCount = pendingSummaries.filter((systemCall) => systemCall.expired).length;
  const staleProcessingCount = processingSummaries.filter((systemCall) => systemCall.stale).length;
  const pendingCount = stateCounts.pending ?? 0;
  const processingCount = stateCounts.processing ?? 0;
  const attentionCount = readErrors.length
    + stalePendingCount
    + expiredPendingCount
    + staleProcessingCount;
  let status = 'clear';
  let summary = 'No pending or processing System Calls.';

  if (readErrors.length > 0) {
    status = 'degraded';
    summary = 'System Call storage could not be fully read.';
  } else if (attentionCount > 0) {
    status = 'attention_required';
    summary = 'System Call queues need admin attention.';
  } else if (pendingCount > 0 || processingCount > 0) {
    status = 'active';
    summary = 'System Calls are pending or processing.';
  }

  return {
    status,
    summary,
    attentionRequired: attentionCount > 0,
    readErrorCount: readErrors.length,
    pendingCount,
    processingCount,
    stalePendingCount,
    expiredPendingCount,
    staleProcessingCount,
  };
}

async function buildSystemCallStatusSummary({
  projectRootPath,
  observedAt,
  staleAfterMs = DEFAULT_STALE_SYSTEM_CALL_AFTER_MS,
  recentResultLimit = DEFAULT_RECENT_SYSTEM_CALL_RESULT_LIMIT,
}) {
  const inbox = createLocalSystemCallInbox({ projectRootPath });
  const stateReads = await Promise.all(
    LOCAL_SYSTEM_CALL_STATES.map((state) => {
      return readSystemCallsForState({
        inbox,
        state,
        observedAt,
        staleAfterMs,
      });
    }),
  );
  const resultRead = await readSystemCallResultsForStatus({ inbox });
  const readErrors = [
    ...stateReads.flatMap((stateRead) => stateRead.readErrors ?? [stateRead.readError].filter(Boolean)),
    resultRead.readError,
  ].filter(Boolean);
  const currentQueueReadErrors = readErrors.filter((readError) => {
    return readError.scope === 'system-calls/pending'
      || readError.scope.startsWith('system-calls/pending/')
      || readError.scope === 'system-calls/processing'
      || readError.scope.startsWith('system-calls/processing/');
  });
  const historicalReadErrors = readErrors.filter((readError) => {
    return !currentQueueReadErrors.includes(readError);
  });
  const summariesByState = Object.fromEntries(
    stateReads.map((stateRead) => {
      return [stateRead.state, stateRead.summaries];
    }),
  );
  const stateCounts = Object.fromEntries(
    LOCAL_SYSTEM_CALL_STATES.map((state) => {
      return [state, summariesByState[state]?.length ?? 0];
    }),
  );
  const pendingSummaries = summariesByState.pending ?? [];
  const processingSummaries = summariesByState.processing ?? [];
  const oldestPending = [...pendingSummaries]
    .sort((left, right) => left.requestedAt.localeCompare(right.requestedAt))
    .slice(0, 5);
  const latestFailedResult = resultRead.summaries
    .find((result) => result.status === 'failed') ?? null;
  const lastFailure = latestFailedResult === null
    ? null
    : {
      systemCallId: latestFailedResult.systemCallId,
      operation: latestFailedResult.operation,
      status: latestFailedResult.status,
      processedAt: latestFailedResult.processedAt,
      summary: latestFailedResult.summary,
      reason: latestFailedResult.reason,
    };
  const current = buildSystemCallCurrentStatus({
    readErrors: currentQueueReadErrors,
    stateCounts,
    pendingSummaries,
    processingSummaries,
  });
  const history = {
    status: historicalReadErrors.length > 0 ? 'degraded' : 'readable',
    malformedCount: historicalReadErrors.length,
    readErrors: historicalReadErrors,
    resultCount: resultRead.summaries.length,
    completedCount: stateCounts.completed,
    deniedCount: stateCounts.denied,
    failedCount: stateCounts.failed,
    expiredCount: stateCounts.expired,
    cancelledCount: stateCounts.cancelled,
    lastFailure,
  };

  return assertSafeOsSerializableValue({
    kind: SYSTEM_CALL_STATUS_SUMMARY_KIND,
    version: 1,
    status: readErrors.length > 0 ? 'degraded' : 'readable',
    observedAt,
    staleAfterMs,
    stateCounts,
    resultCount: resultRead.summaries.length,
    pending: {
      count: stateCounts.pending,
      staleCount: pendingSummaries.filter((systemCall) => systemCall.stale).length,
      expiredCount: pendingSummaries.filter((systemCall) => systemCall.expired).length,
      oldestAgeMs: oldestPending[0]?.ageMs ?? null,
      oldest: oldestPending,
    },
    processing: {
      count: stateCounts.processing,
      staleCount: processingSummaries.filter((systemCall) => systemCall.stale).length,
      oldestAgeMs: [...processingSummaries]
        .sort((left, right) => left.requestedAt.localeCompare(right.requestedAt))[0]?.ageMs ?? null,
      active: processingSummaries.slice(0, 5),
    },
    terminal: {
      completedCount: stateCounts.completed,
      deniedCount: stateCounts.denied,
      failedCount: stateCounts.failed,
      expiredCount: stateCounts.expired,
      cancelledCount: stateCounts.cancelled,
    },
    recentResults: resultRead.summaries.slice(0, recentResultLimit),
    current,
    history,
    lastSystemCallFailure: lastFailure,
    lastSystemCallError: lastFailure,
    readErrors,
  }, 'OpenMAS OS System Call status summary');
}

async function buildResultRecordStatusSummary({
  projectRootPath,
  recentResultLimit = DEFAULT_RECENT_OS_RESULT_RECORD_LIMIT,
}) {
  const adapter = createLocalRuntimeAdapter({ projectRootPath });
  const inspection = await adapter.inspectResultRecords({
    limit: recentResultLimit,
  });

  return assertSafeOsSerializableValue({
    kind: 'openmas_os_result_record_status_summary',
    version: 1,
    status: inspection.readErrors.length > 0 ? 'degraded' : 'readable',
    malformedCount: inspection.readErrors.length,
    readErrors: inspection.readErrors,
    recent: inspection.records.map((record) => {
      return createOpenMasOsResultSummaryFromRecord(record);
    }),
  }, 'OpenMAS OS Result Record status summary');
}

function buildBlockedWaitReasonCounts(waits) {
  const counts = new Map();

  for (const wait of waits) {
    const waitReason = wait.waitReason ?? 'unknown';
    counts.set(waitReason, (counts.get(waitReason) ?? 0) + 1);
  }

  return Object.fromEntries(
    [...counts.entries()].sort(([left], [right]) => left.localeCompare(right)),
  );
}

function findTerminalDelegationSystemCallResultForWait({
  systemCallResults,
  processState,
  thread,
}) {
  return systemCallResults.find((result) => {
    return result.operation === 'delegate'
      && ['denied', 'failed', 'expired', 'cancelled'].includes(result.status)
      && result.correlation?.processId === processState.processId
      && result.correlation?.threadId === thread.threadId;
  }) ?? null;
}

function classifyBlockedWaitAttention({
  processState,
  job,
  thread,
  terminalSystemCallResult,
}) {
  if (!thread) {
    return 'blocked_process_current_thread_missing';
  }

  if (!job) {
    return 'blocked_process_job_missing';
  }

  if (
    thread.status !== 'blocked'
    || thread.processId !== processState.processId
    || thread.jobId !== processState.jobId
    || job.jobId !== processState.jobId
  ) {
    return 'blocked_process_lineage_inconsistent';
  }

  if (thread.waitReason === 'waiting_for_resource') {
    return 'unsupported_foreground_resource_wait';
  }

  if (thread.waitReason === 'waiting_for_system_call' && terminalSystemCallResult) {
    return 'terminal_delegation_system_call_caller_stranded';
  }

  return null;
}

async function buildBlockedWaitStatusSummary({
  projectRootPath,
  observedAt,
  limit = DEFAULT_BLOCKED_WAIT_LIMIT,
}) {
  const adapter = createLocalRuntimeAdapter({ projectRootPath });
  const inbox = createLocalSystemCallInbox({ projectRootPath });
  const readErrors = [];
  let blockedProcesses = [];
  let systemCallResults = [];

  try {
    blockedProcesses = await adapter.listProcesses({ status: 'blocked' });
  } catch (error) {
    readErrors.push(createSystemCallReadError({
      scope: 'scheduler/processes/blocked',
      error,
    }));
  }

  try {
    systemCallResults = await inbox.listSystemCallResults();
  } catch (error) {
    readErrors.push(createSystemCallReadError({
      scope: 'system-calls/results',
      error,
    }));
  }

  const waits = [];

  for (const processState of blockedProcesses) {
    let job = null;
    let thread = null;

    try {
      job = await adapter.loadJob(processState.jobId);
    } catch (error) {
      readErrors.push(createSystemCallReadError({
        scope: `scheduler/jobs/${processState.jobId}`,
        error,
      }));
    }

    if (isNonEmptyString(processState.currentThreadId)) {
      try {
        thread = await adapter.loadThread(processState.currentThreadId);
      } catch (error) {
        readErrors.push(createSystemCallReadError({
          scope: `scheduler/threads/${processState.currentThreadId}`,
          error,
        }));
      }
    }

    const terminalSystemCallResult = thread
      ? findTerminalDelegationSystemCallResultForWait({
        systemCallResults,
        processState,
        thread,
      })
      : null;
    const attentionReason = classifyBlockedWaitAttention({
      processState,
      job,
      thread,
      terminalSystemCallResult,
    });
    const updatedAt = thread?.updatedAt ?? processState.updatedAt ?? job?.updatedAt ?? null;
    const ageMs = updatedAt
      ? calculateDurationMs({
        startedAt: updatedAt,
        observedAt,
      })
      : null;

    waits.push({
      jobId: processState.jobId,
      processId: processState.processId,
      threadId: thread?.threadId ?? processState.currentThreadId ?? null,
      waitReason: thread?.waitReason ?? null,
      updatedAt,
      ageMs,
      attentionRequired: attentionReason !== null,
      attentionReason,
      terminalSystemCallId: terminalSystemCallResult?.systemCallId ?? null,
      terminalSystemCallStatus: terminalSystemCallResult?.status ?? null,
    });
  }

  waits.sort((left, right) => {
    return (right.ageMs ?? -1) - (left.ageMs ?? -1)
      || left.processId.localeCompare(right.processId);
  });

  const attentionCount = waits.filter((wait) => wait.attentionRequired).length;
  const status = readErrors.length > 0
    ? 'degraded'
    : attentionCount > 0
      ? 'attention_required'
      : waits.length > 0
        ? 'active'
        : 'clear';

  return assertSafeOsSerializableValue({
    kind: 'openmas_os_blocked_wait_status_summary',
    version: 1,
    status,
    attentionRequired: readErrors.length > 0 || attentionCount > 0,
    count: waits.length,
    attentionCount,
    reasonCounts: buildBlockedWaitReasonCounts(waits),
    oldestAgeMs: waits[0]?.ageMs ?? null,
    oldest: waits.slice(0, limit),
    readErrors,
  }, 'OpenMAS OS blocked wait status summary');
}

function resolveStatusLockSummary(lock, lockFreshness) {
  if (!lock) {
    return {
      status: 'missing',
      stale: null,
      ageMs: null,
      ownerServiceId: null,
      lockId: null,
      refreshedAt: null,
      expiresAt: null,
    };
  }

  const stale = Boolean(lockFreshness?.stale);

  return {
    status: stale ? 'stale' : 'fresh',
    stale,
    ageMs: lockFreshness?.ageMs ?? null,
    ownerServiceId: lock.serviceId,
    lockId: lock.lockId,
    refreshedAt: lock.refreshedAt,
    expiresAt: lock.expiresAt,
  };
}

function resolveStatusNextRecommendedAction({
  healthSummary,
  lockSummary,
  systemCalls,
  blockedWaits,
}) {
  const currentSystemCalls = systemCalls?.current ?? null;

  if (currentSystemCalls?.status === 'degraded') {
    return 'Inspect current pending or processing System Call storage; it could not be fully read.';
  }

  if (currentSystemCalls?.status === 'attention_required') {
    return 'Inspect current System Call queue; stale or expired work requires attention.';
  }

  if (blockedWaits?.status === 'degraded') {
    return 'Inspect blocked scheduler waits; scheduler state could not be fully read.';
  }

  if (blockedWaits?.status === 'attention_required') {
    return 'Inspect blocked scheduler waits; one or more waits require attention.';
  }

  if (lockSummary.status === 'fresh' && !healthSummary.heartbeatStale) {
    if (currentSystemCalls?.status === 'active') {
      return 'Service is healthy and processing current System Call work.';
    }

    if (healthSummary.activeAsyncExecutionCount > 0) {
      return `Service is healthy; ${healthSummary.activeAsyncExecutionCount} asynchronous execution(s) active.`;
    }

    return 'Service is healthy.';
  }

  if (lockSummary.status === 'fresh') {
    return 'Fresh lock exists; another service is already active.';
  }

  if (lockSummary.status === 'stale' && healthSummary.heartbeatStale) {
    return 'Existing lock is stale; recovery can start safely.';
  }

  if (lockSummary.status === 'stale') {
    if (healthSummary.status === 'ticking') {
      return 'Service is ticking with a fresh heartbeat; wait for the active tick to finish before recovery.';
    }

    return 'Kernel lock refresh is overdue, but owner heartbeat is fresh; recovery is blocked.';
  }

  if (healthSummary.status === 'stopped') {
    return 'Start the service with --watch.';
  }

  if (healthSummary.heartbeatStale) {
    return 'Service heartbeat is stale or missing.';
  }

  return 'Service is healthy.';
}

function resolveStatusLockOperatorState({ healthSummary, lockSummary }) {
  if (lockSummary.status === 'missing') {
    return {
      status: 'missing',
      label: 'missing',
      recoverySafe: false,
      reasonCode: 'kernel_lock_missing',
      summary: 'No kernel lock file is present.',
    };
  }

  if (lockSummary.status === 'fresh') {
    return {
      status: 'fresh',
      label: 'fresh',
      recoverySafe: false,
      reasonCode: 'kernel_lock_fresh',
      summary: 'Kernel lock refresh is current.',
    };
  }

  if (lockSummary.status === 'stale' && !healthSummary.heartbeatStale) {
    const activeTick = healthSummary.status === 'ticking';

    return {
      status: activeTick
        ? 'refresh_overdue_active_tick_heartbeat_fresh'
        : 'refresh_overdue_owner_heartbeat_fresh',
      label: activeTick
        ? 'refresh overdue (active tick heartbeat fresh)'
        : 'refresh overdue (owner heartbeat fresh)',
      recoverySafe: false,
      reasonCode: 'owner_heartbeat_fresh',
      summary: 'Kernel lock refresh is overdue, but the owner heartbeat is fresh. Recovery must not start.',
    };
  }

  if (lockSummary.status === 'stale') {
    return {
      status: 'stale_recovery_safe',
      label: 'stale (recovery safe)',
      recoverySafe: true,
      reasonCode: 'kernel_lock_and_heartbeat_stale',
      summary: 'Kernel lock and owner heartbeat are stale; recovery can start safely.',
    };
  }

  return {
    status: 'unknown',
    label: lockSummary.status,
    recoverySafe: false,
    reasonCode: 'kernel_lock_status_unknown',
    summary: 'Kernel lock status could not be classified.',
  };
}

function buildStatusSummary({
  projectRootPath,
  observedAt,
  heartbeat,
  state,
  lockSummary,
  healthSummary,
  systemCalls,
  blockedWaits,
}) {
  const startedAt = state?.startedAt ?? heartbeat?.startedAt ?? null;
  const stoppedAt = healthSummary.status === 'stopped'
    ? state?.stoppedAt ?? state?.updatedAt ?? heartbeat?.lastHeartbeatAt ?? null
    : null;
  const uptimeObservedAt = stoppedAt ?? observedAt;
  const uptimeMs = calculateDurationMs({
    startedAt,
    observedAt: uptimeObservedAt,
  });
  const lockOperatorState = resolveStatusLockOperatorState({
    healthSummary,
    lockSummary,
  });

  return assertSafeOsSerializableValue({
    kind: 'openmas_os_service_status_summary',
    version: 1,
    projectRootPath,
    observedAt,
    status: healthSummary.status,
    serviceId: healthSummary.serviceId ?? lockSummary.ownerServiceId,
    pid: state?.pid ?? heartbeat?.pid ?? null,
    hostname: state?.hostname ?? heartbeat?.hostname ?? null,
    lock: {
      ...lockSummary,
      operatorStatus: lockOperatorState.status,
      operatorLabel: lockOperatorState.label,
      recoverySafe: lockOperatorState.recoverySafe,
      reasonCode: lockOperatorState.reasonCode,
      summary: lockOperatorState.summary,
    },
    heartbeatPresent: healthSummary.heartbeatPresent,
    statePresent: healthSummary.statePresent,
    lastHeartbeatAt: heartbeat?.lastHeartbeatAt ?? null,
    heartbeatAgeMs: healthSummary.heartbeatAgeMs,
    heartbeatStale: healthSummary.heartbeatStale,
    lastTickStatus: healthSummary.lastTickStatus,
    activeTick: healthSummary.activeTick,
    activeTickAgeMs: healthSummary.activeTickAgeMs,
    tickCount: healthSummary.tickCount,
    failedTickCount: healthSummary.failedTickCount,
    skippedTickCount: healthSummary.skippedTickCount,
    activeAsyncExecutionCount: healthSummary.activeAsyncExecutionCount,
    asyncMaxConcurrentExecutions: healthSummary.asyncMaxConcurrentExecutions,
    systemCallProcessedCount: healthSummary.systemCallProcessedCount,
    systemCallFailedCount: healthSummary.systemCallFailedCount,
    startedAt,
    stoppedAt,
    uptimeMs,
    nextRecommendedAction: resolveStatusNextRecommendedAction({
      healthSummary,
      lockSummary,
      systemCalls,
      blockedWaits,
    }),
  }, 'OpenMAS OS service status summary');
}

async function buildOpenMasOsServiceStatus({
  projectRootPath,
  now,
}) {
  const nowFn = normalizeNow(now);
  const observedAt = nowFn();
  const [
    lock,
    heartbeat,
    state,
  ] = await Promise.all([
    readKernelLock({ projectRootPath }),
    readServiceHeartbeat({ projectRootPath }),
    readServiceState({ projectRootPath }),
  ]);
  const lockFreshness = lock
    ? isKernelLockStale({
      lock,
      now: () => observedAt,
    })
    : null;
  const lockSummary = resolveStatusLockSummary(lock, lockFreshness);
  const healthSummary = buildServiceHealthSummary({
    heartbeat,
    state,
    now: () => observedAt,
  });
  const [systemCalls, resultRecords, blockedWaits] = await Promise.all([
    buildSystemCallStatusSummary({
      projectRootPath,
      observedAt,
      staleAfterMs: state?.config?.staleAfterMs ?? DEFAULT_STALE_SYSTEM_CALL_AFTER_MS,
    }),
    buildResultRecordStatusSummary({
      projectRootPath,
    }),
    buildBlockedWaitStatusSummary({
      projectRootPath,
      observedAt,
    }),
  ]);
  const summary = buildStatusSummary({
    projectRootPath,
    observedAt,
    heartbeat,
    state,
    lockSummary,
    healthSummary,
    systemCalls,
    blockedWaits,
  });

  return assertSafeOsSerializableValue({
    kind: SERVICE_STATUS_RESULT_KIND,
    version: SERVICE_STATUS_RESULT_VERSION,
    mode: 'status',
    projectRootPath,
    summary,
    health: healthSummary,
    lock,
    heartbeat,
    state,
    systemCalls,
    resultRecords,
    blockedWaits,
  }, 'OpenMAS OS service status result');
}

function printStatusHumanSummary(result, stdout) {
  const { summary } = result;
  const lastFailure = result.systemCalls.history?.lastFailure
    ?? result.systemCalls.lastSystemCallFailure
    ?? null;

  writeLine(stdout, 'OpenMAS OS Service Status');
  writeLine(stdout, `Status: ${summary.status}`);
  writeLine(stdout, `Project Root: ${summary.projectRootPath}`);
  writeLine(stdout, `Service ID: ${formatStatusValue(summary.serviceId)}`);
  writeLine(stdout, `PID: ${formatStatusValue(summary.pid)}`);
  writeLine(stdout, `Kernel Lock: ${summary.lock.operatorLabel ?? summary.lock.status}`);
  writeLine(stdout, `Lock Owner: ${formatStatusValue(summary.lock.ownerServiceId)}`);
  writeLine(stdout, `Lock Age: ${formatDurationMs(summary.lock.ageMs)}`);
  writeLine(stdout, `Kernel Lock Recovery Safe: ${summary.lock.recoverySafe}`);
  writeLine(stdout, `Last Heartbeat: ${formatStatusValue(summary.lastHeartbeatAt)}`);
  writeLine(stdout, `Heartbeat Age: ${formatDurationMs(summary.heartbeatAgeMs)}`);
  writeLine(stdout, `Heartbeat Stale: ${summary.heartbeatStale}`);
  writeLine(stdout, `Last Tick: ${formatStatusValue(summary.lastTickStatus)}`);
  if (summary.activeTick) {
    writeLine(
      stdout,
      `Active Tick: #${summary.activeTick.tickIndex} since ${summary.activeTick.startedAt}`
      + ` (age ${formatDurationMs(summary.activeTickAgeMs)})`,
    );
  }
  writeLine(stdout, `Tick Count: ${summary.tickCount}`);
  writeLine(stdout, `Failed Ticks: ${summary.failedTickCount}`);
  writeLine(stdout, `Skipped Ticks: ${summary.skippedTickCount}`);
  writeLine(
    stdout,
    `Async Executions Active: ${summary.activeAsyncExecutionCount}`
    + `/${summary.asyncMaxConcurrentExecutions}`,
  );
  writeLine(stdout, `System Calls Processed: ${summary.systemCallProcessedCount}`);
  writeLine(stdout, `System Calls Failed: ${summary.systemCallFailedCount}`);
  writeLine(stdout, `System Calls Pending: ${result.systemCalls.stateCounts.pending}`);
  writeLine(stdout, `System Calls Processing: ${result.systemCalls.stateCounts.processing}`);
  writeLine(
    stdout,
    `System Call Queue Health: ${result.systemCalls.current.status}`
    + ` (${result.systemCalls.current.summary})`,
  );
  writeLine(
    stdout,
    `Current Queue Stale Pending/Expired Pending/Stale Processing:`
    + ` ${result.systemCalls.current.stalePendingCount}`
    + `/${result.systemCalls.current.expiredPendingCount}`
    + `/${result.systemCalls.current.staleProcessingCount}`,
  );
  writeLine(stdout, `Historical System Call Results: ${result.systemCalls.history.resultCount}`);
  if (result.systemCalls.history.malformedCount > 0) {
    writeLine(
      stdout,
      `Historical System Call Evidence: ${result.systemCalls.history.status}`
      + ` (${result.systemCalls.history.malformedCount} malformed/unreadable record(s));`
      + ' current queue health is reported separately.',
    );
  }
  writeLine(
    stdout,
    `Historical System Calls Denied/Failed/Expired: ${result.systemCalls.terminal.deniedCount}`
    + `/${result.systemCalls.terminal.failedCount}/${result.systemCalls.terminal.expiredCount}`,
  );
  writeLine(
    stdout,
    `Last Historical System Call Failure: ${lastFailure?.systemCallId ?? 'none'}`,
  );
  writeLine(stdout, `Blocked Waits: ${result.blockedWaits.count}`);
  writeLine(stdout, `Blocked Wait Health: ${result.blockedWaits.status}`);
  writeLine(
    stdout,
    `Blocked Wait Reasons: ${Object.entries(result.blockedWaits.reasonCounts)
      .map(([reason, count]) => `${reason}=${count}`)
      .join(', ') || 'none'}`,
  );
  writeLine(stdout, `Oldest Blocked Wait: ${formatDurationMs(result.blockedWaits.oldestAgeMs)}`);
  for (const wait of result.blockedWaits.oldest.filter((candidate) => candidate.attentionRequired)) {
    writeLine(
      stdout,
      `- Blocked Wait Attention: ${wait.processId}`
      + ` thread=${wait.threadId ?? 'none'}`
      + ` reason=${wait.waitReason ?? 'unknown'}`
      + ` attention=${wait.attentionReason}`,
    );
  }
  writeLine(stdout, `Recent Result Records: ${result.resultRecords.recent.length}`);
  for (const resultSummary of result.resultRecords.recent) {
    writeLine(
      stdout,
      `- Result: ${resultSummary.resultKind} ${resultSummary.resultId}`
      + ` -> ${resultSummary.status}`,
    );
  }
  if (result.resultRecords.malformedCount > 0) {
    writeLine(
      stdout,
      `Result Record Evidence: ${result.resultRecords.status}`
      + ` (${result.resultRecords.malformedCount} malformed/unreadable record(s))`,
    );
  }
  writeLine(stdout, `Uptime: ${formatDurationMs(summary.uptimeMs)}`);
  writeLine(stdout, `Next Action: ${summary.nextRecommendedAction}`);
}

function printTickHumanSummary(result, stdout) {
  const systemCalls = result.systemCalls ?? {};

  writeLine(stdout, 'OpenMAS OS Service Tick');
  writeLine(stdout, `Status: ${result.status}`);
  writeLine(stdout, `Tick: ${result.tickId}`);
  writeLine(stdout, `System Calls: ${systemCalls.processedCount ?? 0}`);
  writeLine(
    stdout,
    `System Call Results: completed=${systemCalls.completedCount ?? 0}`
    + ` denied=${systemCalls.deniedCount ?? 0}`
    + ` failed=${systemCalls.failedCount ?? 0}`
    + ` expired=${systemCalls.expiredCount ?? 0}`
    + ` cancelled=${systemCalls.cancelledCount ?? 0}`,
  );
  writeLine(stdout, `Released Jobs: ${result.release.releasedCount}`);
  writeLine(stdout, `Pending Timers: ${result.release.pendingCount}`);
  writeLine(stdout, `Recovered Invocations: ${result.recovery?.recoveredCount ?? 0}`);
  writeLine(stdout, `Recovered Parent Waits: ${result.parentWaitRecovery?.recoveredCount ?? 0}`);
  writeLine(stdout, `Dispatches: ${result.dispatches.length}`);
  writeLine(stdout, `Settled Async Dispatches: ${result.settledDispatches?.length ?? 0}`);

  for (const systemCallResult of systemCalls.results ?? []) {
    writeLine(
      stdout,
      `- syscall ${systemCallResult.operation}: ${systemCallResult.systemCallId}`
      + ` -> ${systemCallResult.status} (${systemCallResult.finalState})`,
    );
  }

  for (const dispatch of result.dispatches) {
    if (dispatch.executionMode === 'asynchronous' && dispatch.status === 'queued') {
      writeLine(
        stdout,
        `- ${dispatch.dispatchType}: ${dispatch.jobId} -> queued for asynchronous execution`,
      );
      continue;
    }

    writeLine(
      stdout,
      `- ${dispatch.dispatchType}: ${dispatch.jobId} -> ${dispatch.jobStatus}`
      + ` (${dispatch.processStatus}/${dispatch.threadStatus})`,
    );

    if (dispatch.parentNotification) {
      writeLine(
        stdout,
        `  Parent Signal: ${dispatch.parentNotification.status}`
        + ` notified=${dispatch.parentNotification.notified}`,
      );
    } else if (dispatch.parentCompletion) {
      writeLine(
        stdout,
        `  Parent Completion: ${dispatch.parentCompletion.mode}`
        + ` status=${dispatch.parentCompletion.status}`,
      );
    }
  }
}

function printWatchStartupSummary({
  stdout,
  projectRootPath,
  serviceId,
  tickIntervalMs,
  maxDispatchedJobs,
  lockClaim,
  quiet,
}) {
  writeLine(stdout, 'OpenMAS OS Service Watch');
  writeLine(stdout, 'Status: running');
  writeLine(stdout, `Service ID: ${serviceId}`);
  writeLine(stdout, `Project Root: ${projectRootPath}`);
  writeLine(stdout, `Interval: ${tickIntervalMs} ms`);
  writeLine(stdout, `Max Dispatched Jobs: ${maxDispatchedJobs}`);
  writeLine(stdout, `Async Executor Capacity: ${maxDispatchedJobs}`);
  writeLine(stdout, `Kernel Lock: ${lockClaim.status}`);
  if (quiet) {
    writeLine(stdout, 'Tick Output: quiet');
  }
}

function printWatchTickSummary(result, stdout) {
  const recoveredCount = (result.recovery?.recoveredCount ?? 0)
    + (result.parentWaitRecovery?.recoveredCount ?? 0);

  writeLine(
    stdout,
    `Tick: ${result.tickId} status=${result.status}`
    + ` syscalls=${result.systemCalls?.processedCount ?? 0}`
    + ` completed=${result.systemCalls?.completedCount ?? 0}`
    + ` denied=${result.systemCalls?.deniedCount ?? 0}`
    + ` failed=${result.systemCalls?.failedCount ?? 0}`
    + ` released=${result.release.releasedCount}`
    + ` recovered=${recoveredCount}`
    + ` dispatches=${result.dispatches.length}`
    + ` settled=${result.settledDispatches?.length ?? 0}`
    + ` workers=${result.asyncExecution?.activeCount ?? 0}`,
  );
}

function printWatchStopSummary(result, stdout) {
  writeLine(stdout, 'OpenMAS OS Service Watch Stopped');
  writeLine(stdout, `Status: ${result.status}`);
  writeLine(stdout, `Stop Reason: ${result.stopReason}`);
  writeLine(stdout, `Ticks: ${result.stats.tickCount}`);
  writeLine(stdout, `Failed Ticks: ${result.stats.failedTickCount}`);
  writeLine(stdout, `Skipped Ticks: ${result.stats.skippedTickCount}`);
}

async function appendServiceRuntimeEvent({
  projectRootPath,
  serviceId,
  eventType,
  occurredAt,
  payload = {},
}) {
  const adapter = createLocalRuntimeAdapter({ projectRootPath });

  return adapter.appendEvent({
    kind: OPENMAS_OS_KINDS.event,
    schemaVersion: OPENMAS_OS_SCHEMA_VERSION,
    eventId: `event_${randomUUID()}`,
    eventType,
    source: {
      type: 'system',
      id: 'openmas-os-service',
    },
    targetRef: null,
    jobId: null,
    processId: null,
    threadId: null,
    occurredAt,
    payload: assertSafeOsSerializableValue({
      serviceId,
      ...payload,
    }, `OpenMAS OS service ${eventType} Event payload`),
  });
}

async function appendServiceShutdownEvent({
  projectRootPath,
  serviceId,
  occurredAt,
  signalName,
  reason,
}) {
  return appendServiceRuntimeEvent({
    projectRootPath,
    serviceId,
    eventType: 'os.service.shutdown.requested',
    occurredAt,
    payload: {
      signalName,
      reason,
    },
  });
}

async function appendServiceTickSkippedEvent({
  projectRootPath,
  serviceId,
  skippedTick,
}) {
  return appendServiceRuntimeEvent({
    projectRootPath,
    serviceId,
    eventType: 'os.service.tick.skipped',
    occurredAt: skippedTick.occurredAt,
    payload: {
      activeTickIndex: skippedTick.activeTickIndex,
      skippedTickCount: skippedTick.skippedTickCount,
      reason: skippedTick.reason,
    },
  });
}

async function appendServiceTickFailedEvent({
  projectRootPath,
  serviceId,
  occurredAt,
  lastError,
  snapshot,
}) {
  return appendServiceRuntimeEvent({
    projectRootPath,
    serviceId,
    eventType: 'os.service.tick.failed',
    occurredAt,
    payload: {
      tickCount: snapshot.stats.tickCount,
      failedTickCount: snapshot.stats.failedTickCount,
      lastTickId: snapshot.lastTick?.tickId ?? null,
      error: lastError,
    },
  });
}

async function appendServiceHealthPublicationDeferredEvent({
  projectRootPath,
  serviceId,
  occurredAt,
  phase,
  errorCode,
}) {
  return appendServiceRuntimeEvent({
    projectRootPath,
    serviceId,
    eventType: 'os.service.health.publication.deferred',
    occurredAt,
    payload: {
      phase,
      errorCode,
    },
  });
}

async function appendServiceHealthPublicationRecoveredEvent({
  projectRootPath,
  serviceId,
  occurredAt,
  deferredPublication,
}) {
  return appendServiceRuntimeEvent({
    projectRootPath,
    serviceId,
    eventType: 'os.service.health.publication.recovered',
    occurredAt,
    payload: {
      deferredAt: deferredPublication.occurredAt,
      deferredPhase: deferredPublication.phase,
      errorCode: deferredPublication.errorCode,
    },
  });
}

async function appendServiceRecoveryCompletedEvent({
  projectRootPath,
  serviceId,
  occurredAt,
  startupRecovery,
  lockClaim,
}) {
  return appendServiceRuntimeEvent({
    projectRootPath,
    serviceId,
    eventType: 'os.service.recovery.completed',
    occurredAt,
    payload: {
      reason: lockClaim.reason ?? startupRecovery.reason,
      previousServiceId: lockClaim.previousLock?.serviceId ?? startupRecovery.lock?.serviceId ?? null,
      previousLockId: lockClaim.previousLock?.lockId ?? startupRecovery.lock?.lockId ?? null,
      recoveredLockId: lockClaim.lock?.lockId ?? null,
      recoveredFromLockId: lockClaim.lock?.recoveredFromLockId ?? null,
      lockAgeMs: startupRecovery.lock?.ageMs ?? null,
      heartbeatPresent: startupRecovery.heartbeat !== null,
      heartbeatStale: startupRecovery.heartbeat?.heartbeatStale ?? null,
      heartbeatAgeMs: startupRecovery.heartbeat?.heartbeatAgeMs ?? null,
      previousStateStatus: startupRecovery.state?.status ?? null,
    },
  });
}

function createLockSummary(lock, claimStatus) {
  if (!lock) {
    return null;
  }

  return {
    lockId: lock.lockId,
    serviceId: lock.serviceId,
    status: lock.status,
    claimStatus,
    refreshedAt: lock.refreshedAt,
  };
}

function createStartupRecoveryLockSummary(lock, freshness) {
  if (!lock) {
    return null;
  }

  return {
    lockId: lock.lockId,
    serviceId: lock.serviceId,
    pid: lock.pid,
    hostname: lock.hostname,
    refreshedAt: lock.refreshedAt,
    staleAfterMs: lock.staleAfterMs,
    expiresAt: lock.expiresAt,
    stale: freshness?.stale ?? null,
    ageMs: freshness?.ageMs ?? null,
  };
}

function createStartupRecoveryHeartbeatSummary(heartbeat, healthSummary) {
  if (!heartbeat) {
    return null;
  }

  return {
    serviceId: heartbeat.serviceId,
    status: heartbeat.status,
    lastHeartbeatAt: heartbeat.lastHeartbeatAt,
    staleAfterMs: heartbeat.staleAfterMs,
    heartbeatAgeMs: healthSummary.heartbeatAgeMs,
    heartbeatStale: healthSummary.heartbeatStale,
    lastTickStatus: heartbeat.lastTickStatus,
    tickCount: heartbeat.tickCount,
    failedTickCount: heartbeat.failedTickCount,
    skippedTickCount: heartbeat.skippedTickCount,
  };
}

function createStartupRecoveryStateSummary(state) {
  if (!state) {
    return null;
  }

  return {
    serviceId: state.serviceId,
    status: state.status,
    updatedAt: state.updatedAt,
    stoppedAt: state.stoppedAt,
    stopRequested: state.stopRequested,
    stopReason: state.stopReason,
  };
}

function heartbeatMatchesKernelLock({ heartbeat, lock }) {
  if (!heartbeat || !lock) {
    return false;
  }

  return heartbeat.serviceId === lock.serviceId
    && (!heartbeat.projectRootPath || !lock.projectRootPath
      || path.resolve(heartbeat.projectRootPath) === path.resolve(lock.projectRootPath));
}

async function inspectOpenMasOsServiceStartupRecovery({
  projectRootPath,
  now,
}) {
  const nowFn = normalizeNow(now);
  const observedAt = nowFn();
  const [
    lock,
    heartbeat,
    state,
  ] = await Promise.all([
    readKernelLock({ projectRootPath }),
    readServiceHeartbeat({ projectRootPath }),
    readServiceState({ projectRootPath }),
  ]);
  const lockFreshness = lock
    ? isKernelLockStale({
      lock,
      now: () => observedAt,
    })
    : null;
  const healthSummary = buildServiceHealthSummary({
    heartbeat,
    state,
    now: () => observedAt,
  });
  const freshMatchingHeartbeat = Boolean(
    lock
      && lockFreshness?.stale
      && heartbeatMatchesKernelLock({ heartbeat, lock })
      && !healthSummary.heartbeatStale,
  );
  const status = !lock
    ? 'no_lock'
    : !lockFreshness.stale
      ? 'fresh_lock'
      : freshMatchingHeartbeat
        ? 'stale_lock_fresh_heartbeat'
        : 'recovery_needed';
  const reason = status === 'no_lock'
    ? 'no_kernel_lock'
    : status === 'fresh_lock'
      ? 'fresh_kernel_lock_exists'
      : status === 'stale_lock_fresh_heartbeat'
        ? 'fresh_owner_heartbeat_exists'
        : 'stale_kernel_lock_without_fresh_owner_heartbeat';

  return assertSafeOsSerializableValue({
    kind: 'openmas_os_service_startup_recovery_inspection',
    version: 1,
    status,
    reason,
    observedAt,
    projectRootPath,
    lock: createStartupRecoveryLockSummary(lock, lockFreshness),
    heartbeat: createStartupRecoveryHeartbeatSummary(heartbeat, healthSummary),
    state: createStartupRecoveryStateSummary(state),
    freshMatchingHeartbeat,
  }, 'OpenMAS OS service startup recovery inspection');
}

function createServiceHealthConfig({ options, runtimeLoopOptions }) {
  return {
    tickIntervalMs: options.tickIntervalMs,
    heartbeatIntervalMs: runtimeLoopOptions.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS,
    maxDispatchedJobsPerTick: options.maxDispatchedJobs,
    maxSystemCallsPerTick: runtimeLoopOptions.maxSystemCallsPerTick ?? DEFAULT_MAX_SYSTEM_CALLS_PER_TICK,
    staleAfterMs: options.staleAfterMs,
  };
}

function createInitialServiceState({
  serviceId,
  projectRootPath,
  startedAt,
  config,
  lock,
}) {
  return buildServiceState({
    serviceId,
    status: 'starting',
    projectRootPath,
    startedAt,
    updatedAt: startedAt,
    config,
    lock,
  });
}

function applyAsyncExecutionSnapshotToLastTick(lastTick, asyncExecution) {
  if (!lastTick || !asyncExecution) {
    return lastTick;
  }

  return {
    ...lastTick,
    asyncActiveExecutionCount: asyncExecution.activeCount ?? 0,
    asyncMaxConcurrentExecutions: asyncExecution.maxConcurrentExecutions ?? 0,
  };
}

function createServiceStateFromLoopSnapshot({
  snapshot,
  projectRootPath,
  lock,
  updatedAt,
  status = snapshot.status,
  asyncExecution = null,
}) {
  return buildServiceState({
    serviceId: snapshot.serviceId,
    status,
    projectRootPath,
    startedAt: snapshot.startedAt,
    updatedAt,
    config: snapshot.config,
    stats: snapshot.stats,
    lastTick: applyAsyncExecutionSnapshotToLastTick(snapshot.lastTick, asyncExecution),
    activeTick: snapshot.activeTick,
    lastError: snapshot.lastError,
    stopRequested: snapshot.stopRequested,
    stopReason: snapshot.stopReason,
    lock,
  });
}

function createServiceStateFromLoopResult({
  loopResult,
  projectRootPath,
  lock,
  status = loopResult.status,
  stoppedAt = loopResult.stoppedAt,
  asyncExecution = null,
}) {
  return buildServiceState({
    serviceId: loopResult.serviceId,
    status,
    projectRootPath,
    startedAt: loopResult.startedAt,
    updatedAt: stoppedAt,
    stoppedAt: status === 'stopping' ? null : stoppedAt,
    config: loopResult.config,
    stats: loopResult.stats,
    lastTick: applyAsyncExecutionSnapshotToLastTick(loopResult.lastTick, asyncExecution),
    lastError: loopResult.lastError,
    stopRequested: true,
    stopReason: loopResult.stopReason,
    lock,
  });
}

function createTerminalWatchResult({
  loopResult,
  stoppedAt,
  asyncExecution,
}) {
  return {
    ...loopResult,
    stoppedAt,
    lastTick: applyAsyncExecutionSnapshotToLastTick(loopResult.lastTick, asyncExecution),
  };
}

function createFailedWatchServiceState({
  serviceId,
  projectRootPath,
  startedAt,
  failedAt,
  config,
  lock,
  error,
  previousState = null,
}) {
  return buildServiceState({
    serviceId,
    status: 'failed',
    projectRootPath,
    startedAt,
    updatedAt: failedAt,
    stoppedAt: failedAt,
    config,
    stats: previousState?.stats ?? {},
    lastTick: previousState?.lastTick ?? null,
    activeTick: null,
    lastError: {
      name: createSafeErrorName(error),
      message: createSafeErrorMessage(error, 'OpenMAS OS service watch failed.'),
    },
    stopRequested: true,
    stopReason: 'service_failed',
    lock,
  });
}

function resolveShutdownDrainMaintenanceIntervalMs(config) {
  return Math.max(1, Math.min(
    config.tickIntervalMs,
    config.heartbeatIntervalMs,
    Math.max(1, Math.floor(config.staleAfterMs / 3)),
  ));
}

function createShutdownDrainWaiter(drainTask) {
  let drained = false;
  let drainError = null;
  let wakeCurrentWait = null;

  drainTask.then(
    () => {
      drained = true;
      wakeCurrentWait?.();
    },
    (error) => {
      drainError = error;
      wakeCurrentWait?.();
    },
  );

  return async (delayMs) => {
    if (drainError) {
      throw drainError;
    }

    if (drained) {
      return 'drained';
    }

    await new Promise((resolve) => {
      const timeoutId = setTimeout(() => {
        wakeCurrentWait = null;
        resolve();
      }, delayMs);

      wakeCurrentWait = () => {
        clearTimeout(timeoutId);
        wakeCurrentWait = null;
        resolve();
      };
    });

    if (drainError) {
      throw drainError;
    }

    return drained ? 'drained' : 'maintenance';
  };
}

function createSingleTickStats(tickResult) {
  const status = tickResult.status ?? 'failed';
  const systemCalls = tickResult.systemCalls ?? {};

  return {
    tickCount: 1,
    idleTickCount: status === 'idle' ? 1 : 0,
    completedTickCount: status === 'completed' ? 1 : 0,
    completedWithFailuresTickCount: status === 'completed_with_failures' ? 1 : 0,
    failedTickCount: !['idle', 'completed', 'completed_with_failures'].includes(status) ? 1 : 0,
    skippedTickCount: 0,
    systemCallProcessedCount: systemCalls.processedCount ?? 0,
    systemCallCompletedCount: systemCalls.completedCount ?? 0,
    systemCallDeniedCount: systemCalls.deniedCount ?? 0,
    systemCallFailedCount: systemCalls.failedCount ?? 0,
    systemCallExpiredCount: systemCalls.expiredCount ?? 0,
    systemCallCancelledCount: systemCalls.cancelledCount ?? 0,
  };
}

function createSingleTickLastTick(tickResult) {
  const dispatches = Array.isArray(tickResult.dispatches) ? tickResult.dispatches : [];

  return {
    tickId: tickResult.tickId ?? null,
    status: tickResult.status ?? 'unknown',
    startedAt: tickResult.startedAt ?? null,
    finishedAt: tickResult.finishedAt ?? null,
    systemCallProcessedCount: tickResult.systemCalls?.processedCount ?? 0,
    systemCallCompletedCount: tickResult.systemCalls?.completedCount ?? 0,
    systemCallDeniedCount: tickResult.systemCalls?.deniedCount ?? 0,
    systemCallFailedCount: tickResult.systemCalls?.failedCount ?? 0,
    systemCallExpiredCount: tickResult.systemCalls?.expiredCount ?? 0,
    systemCallCancelledCount: tickResult.systemCalls?.cancelledCount ?? 0,
    releasedCount: tickResult.release?.releasedCount ?? 0,
    pendingCount: tickResult.release?.pendingCount ?? 0,
    readyCandidateCount: tickResult.readyWork?.candidateCount ?? 0,
    dispatchedCount: tickResult.readyWork?.dispatchedCount ?? dispatches.length,
    deferredCount: tickResult.readyWork?.deferredCount ?? 0,
    settledDispatchCount: tickResult.settledDispatches?.length ?? 0,
    asyncActiveExecutionCount: tickResult.asyncExecution?.activeCount ?? 0,
    asyncMaxConcurrentExecutions: tickResult.asyncExecution?.maxConcurrentExecutions ?? 0,
    failedDispatchCount: dispatches
      .filter((dispatch) => dispatch.status === 'failed' || dispatch.dispatched === false)
      .length,
  };
}

function createServiceStateFromSingleTickResult({
  tickResult,
  serviceId,
  projectRootPath,
  config,
  lock,
  observedAt,
}) {
  const startedAt = tickResult.startedAt ?? observedAt;
  const stoppedAt = tickResult.finishedAt ?? observedAt;

  return buildServiceState({
    serviceId,
    status: 'stopped',
    projectRootPath,
    startedAt,
    updatedAt: stoppedAt,
    stoppedAt,
    config,
    stats: createSingleTickStats(tickResult),
    lastTick: createSingleTickLastTick(tickResult),
    stopRequested: true,
    stopReason: 'one_shot_tick_completed',
    lock,
  });
}

function createServiceStateFromFailedSingleTick({
  error,
  serviceId,
  projectRootPath,
  config,
  lock,
  startedAt,
  failedAt,
}) {
  return buildServiceState({
    serviceId,
    status: 'stopped',
    projectRootPath,
    startedAt,
    updatedAt: failedAt,
    stoppedAt: failedAt,
    config,
    stats: {
      tickCount: 1,
      idleTickCount: 0,
      completedTickCount: 0,
      completedWithFailuresTickCount: 0,
      failedTickCount: 1,
      skippedTickCount: 0,
      systemCallProcessedCount: 0,
      systemCallCompletedCount: 0,
      systemCallDeniedCount: 0,
      systemCallFailedCount: 0,
      systemCallExpiredCount: 0,
      systemCallCancelledCount: 0,
    },
    lastTick: {
      tickId: null,
      status: 'failed',
      startedAt,
      finishedAt: failedAt,
      systemCallProcessedCount: 0,
      systemCallCompletedCount: 0,
      systemCallDeniedCount: 0,
      systemCallFailedCount: 0,
      systemCallExpiredCount: 0,
      systemCallCancelledCount: 0,
      releasedCount: 0,
      pendingCount: 0,
      readyCandidateCount: 0,
      dispatchedCount: 0,
      deferredCount: 0,
      failedDispatchCount: 0,
    },
    lastError: {
      name: createSafeErrorName(error),
      message: createSafeErrorMessage(error, 'OpenMAS OS service tick failed.'),
    },
    stopRequested: true,
    stopReason: 'one_shot_tick_failed',
    lock,
  });
}

function buildOpenMasOsServiceHelp() {
  return {
    kind: SERVICE_HELP_RESULT_KIND,
    version: SERVICE_HELP_RESULT_VERSION,
    mode: 'help',
    usage: 'node ./bin/openmas-os-service.js <mode> [options]',
    modes: [
      {
        name: '--watch',
        description: 'Run the singleton OpenMAS OS service loop.',
      },
      {
        name: '--tick',
        description: 'Run one kernel tick and then stop.',
      },
      {
        name: '--status',
        description: 'Inspect service health, lock state, and System Call queues.',
      },
      {
        name: '--submit-system-call <file>',
        description: 'Submit a System Call JSON file to the local kernel inbox.',
      },
      {
        name: '--help',
        description: 'Print this help text without touching kernel state.',
      },
    ],
    options: [
      '--project-root <path>',
      '--json',
      '--quiet                         watch only, suppress per-tick human output',
      '--interval <ms>                 watch only',
      '--max-dispatched-jobs <count>   tick/watch only',
      '--service-id <id>               watch only',
      '--wait                          submit-system-call only',
      '--wait-timeout-ms <ms>          submit-system-call only',
      '--wait-interval-ms <ms>         submit-system-call only',
    ],
    examples: [
      'node ./bin/openmas-os-service.js --watch --interval 1000',
      'node ./bin/openmas-os-service.js --status',
      'node ./bin/openmas-os-service.js --submit-system-call ./syscall.json --wait',
    ],
  };
}

function printHelpHumanSummary(result, stdout) {
  writeLine(stdout, 'OpenMAS OS Service');
  writeLine(stdout, `Usage: ${result.usage}`);
  writeLine(stdout);
  writeLine(stdout, 'Modes:');

  for (const mode of result.modes) {
    writeLine(stdout, `  ${mode.name} - ${mode.description}`);
  }

  writeLine(stdout);
  writeLine(stdout, 'Options:');

  for (const option of result.options) {
    writeLine(stdout, `  ${option}`);
  }

  writeLine(stdout);
  writeLine(stdout, 'Examples:');

  for (const example of result.examples) {
    writeLine(stdout, `  ${example}`);
  }
}

async function runHelpCommand({ options, stdout }) {
  const result = buildOpenMasOsServiceHelp();

  if (options.json) {
    writeLine(stdout, JSON.stringify(result, null, 2));
  } else {
    printHelpHumanSummary(result, stdout);
  }

  return {
    mode: 'help',
    exitCode: 0,
    result,
  };
}

async function runTickCommand({
  options,
  projectRootPath,
  stdout,
  serviceTickRunner,
  serviceId,
  now,
}) {
  const nowFn = normalizeNow(now);
  const startupRecovery = await inspectOpenMasOsServiceStartupRecovery({
    projectRootPath,
    now: nowFn,
  });

  if (startupRecovery.status === 'stale_lock_fresh_heartbeat') {
    throw new Error(
      'OpenMAS OS Service cannot run --tick because the existing service heartbeat is still fresh.'
      + ` owner=${startupRecovery.lock?.serviceId ?? 'unknown'}`,
    );
  }

  const lockClaim = await claimKernelLock({
    projectRootPath,
    serviceId,
    staleAfterMs: options.staleAfterMs,
    now: nowFn,
  });

  if (!lockClaim.claimed) {
    throw new Error(
      'OpenMAS OS Service cannot run --tick because another service owns a fresh kernel lock.'
      + ` owner=${lockClaim.lock?.serviceId ?? 'unknown'}`,
    );
  }

  let lockRelease = null;
  let result = null;
  let tickError = null;
  const healthConfig = createServiceHealthConfig({ options, runtimeLoopOptions: {} });
  const tickStartedAt = nowFn();

  try {
    result = await serviceTickRunner({
      projectRootPath,
      serviceId,
      maxDispatchedJobs: options.maxDispatchedJobs,
    });
  } catch (error) {
    tickError = error;
  } finally {
    lockRelease = await releaseKernelLock({
      projectRootPath,
      serviceId,
      lockId: lockClaim.lock.lockId,
      now: nowFn,
    });
  }

  if (tickError) {
    const failedAt = nowFn();

    await writeServiceHealthSnapshot({
      projectRootPath,
      state: createServiceStateFromFailedSingleTick({
        error: tickError,
        serviceId,
        projectRootPath,
        config: healthConfig,
        lock: createLockSummary(lockRelease.lock, lockRelease.status),
        startedAt: tickStartedAt,
        failedAt,
      }),
      lastHeartbeatAt: failedAt,
    });

    throw tickError;
  }

  const observedAt = result.finishedAt ?? result.startedAt ?? nowFn();

  await writeServiceHealthSnapshot({
    projectRootPath,
    state: createServiceStateFromSingleTickResult({
      tickResult: result,
      serviceId,
      projectRootPath,
      config: healthConfig,
      lock: createLockSummary(lockRelease.lock, lockRelease.status),
      observedAt,
    }),
    lastHeartbeatAt: observedAt,
  });

  if (options.json) {
    writeLine(stdout, JSON.stringify(result, null, 2));
  } else {
    printTickHumanSummary(result, stdout);
  }

  return {
    mode: 'tick',
    exitCode: 0,
    result,
    serviceId,
    lockClaim,
    lockRelease,
  };
}

async function runSubmitSystemCallCommand({
  options,
  projectRootPath,
  cwd,
  stdout,
}) {
  const systemCallInputPath = path.resolve(cwd, options.systemCallPath);
  const systemCall = await readJsonInputFile(
    systemCallInputPath,
    `OpenMAS OS System Call input ${systemCallInputPath}`,
  );
  const inbox = createLocalSystemCallInbox({ projectRootPath });
  const submission = await inbox.submitSystemCall(systemCall);
  const systemCallId = submission.systemCall.systemCallId;
  const result = options.waitForResult
    ? await waitForSystemCallResult({
      inbox,
      systemCallId,
      timeoutMs: options.waitTimeoutMs,
      intervalMs: options.waitIntervalMs,
    })
    : null;
  const commandResult = buildSystemCallSubmissionResult({
    projectRootPath,
    submission,
    result,
    waitRequested: options.waitForResult,
    waitTimeoutMs: options.waitTimeoutMs,
    waitIntervalMs: options.waitIntervalMs,
  });

  if (options.json) {
    writeLine(stdout, JSON.stringify(commandResult, null, 2));
  } else {
    printSystemCallSubmissionHumanSummary(commandResult, stdout);
  }

  return {
    mode: 'submit_system_call',
    exitCode: 0,
    result: commandResult,
  };
}

async function runStatusCommand({
  options,
  projectRootPath,
  stdout,
  now,
}) {
  const result = await buildOpenMasOsServiceStatus({
    projectRootPath,
    now,
  });

  if (options.json) {
    writeLine(stdout, JSON.stringify(result, null, 2));
  } else {
    printStatusHumanSummary(result, stdout);
  }

  return {
    mode: 'status',
    exitCode: 0,
    result,
  };
}

async function runWatchCommand({
  options,
  projectRootPath,
  stdout,
  serviceId,
  runtimeLoopRunner,
  now,
  runtimeLoopOptions,
  signalTarget,
  healthSnapshotWriter,
}) {
  const nowFn = normalizeNow(now);
  const controller = runtimeLoopOptions.controller ?? createOpenMasOsRuntimeLoopController();
  const runtimeLoopSleep = runtimeLoopOptions.sleep ?? createSignalAwareSleep({ controller });
  const runtimeLoopOnSignal = runtimeLoopOptions.onSignal;
  const outputHandlers = installOpenMasOsServiceOutputHandlers({
    stdout,
    controller,
  });
  let signalHandlers = {
    uninstall: () => {},
    waitForSignals: async () => {},
  };
  let claimedLockForCleanup = null;
  let claimedLockReleased = false;

  try {
  const startupRecovery = await inspectOpenMasOsServiceStartupRecovery({
    projectRootPath,
    now: nowFn,
  });

  if (startupRecovery.status === 'stale_lock_fresh_heartbeat') {
    throw new Error(
      'OpenMAS OS Service cannot recover a stale kernel lock because the existing service heartbeat is still fresh.'
      + ` owner=${startupRecovery.lock?.serviceId ?? 'unknown'}`,
    );
  }

  const lockClaim = await claimKernelLock({
    projectRootPath,
    serviceId,
    staleAfterMs: options.staleAfterMs,
    now: nowFn,
  });

  if (!lockClaim.claimed) {
    throw new Error(
      'OpenMAS OS Service cannot start because another service owns a fresh kernel lock.'
      + ` owner=${lockClaim.lock?.serviceId ?? 'unknown'}`,
    );
  }
  claimedLockForCleanup = lockClaim;

  if (!options.json) {
    printWatchStartupSummary({
      stdout,
      projectRootPath,
      serviceId,
      tickIntervalMs: options.tickIntervalMs,
      maxDispatchedJobs: options.maxDispatchedJobs,
      lockClaim,
      quiet: options.quiet,
    });
  }

  let loopResult = null;
  const asyncDispatchExecutor = runtimeLoopOptions.asyncDispatchExecutor
    ?? createLocalAsyncDispatchExecutor({
      maxConcurrentExecutions: options.maxDispatchedJobs,
    });
  let currentLockSummary = createLockSummary(lockClaim.lock, lockClaim.status);
  const healthConfig = createServiceHealthConfig({ options, runtimeLoopOptions });
  const shutdownDrainMaintenanceIntervalMs = resolveShutdownDrainMaintenanceIntervalMs(healthConfig);
  const runtimeLoopOnLifecycleEvent = runtimeLoopOptions.onLifecycleEvent;
  const runtimeLoopOnTickResult = runtimeLoopOptions.onTickResult;
  const runtimeLoopOnTickError = runtimeLoopOptions.onTickError;
  const runtimeLoopOnTickSkipped = runtimeLoopOptions.onTickSkipped;
  const recoverTerminalResultPublicationsOnStart = runtimeLoopOptions.recoverTerminalResultPublicationsOnStart
    ?? (
      lockClaim.status === 'recovered'
      || (startupRecovery.state !== null && startupRecovery.state.status !== 'stopped')
    );
  const startedAt = nowFn();
  let healthWriteQueue = Promise.resolve();
  let deferredHealthPublication = null;
  const writeQueuedServiceHealthSnapshot = (input) => {
    const healthWriteTask = healthWriteQueue
      .catch(() => {})
      .then(() => healthSnapshotWriter(input));

    healthWriteQueue = healthWriteTask;
    return healthWriteTask;
  };
  const writeLiveServiceHealthSnapshot = async ({ phase, ...input }) => {
    try {
      const publication = await writeQueuedServiceHealthSnapshot(input);

      if (deferredHealthPublication !== null) {
        const recoveredAt = nowFn();
        const recoveredPublication = deferredHealthPublication;
        deferredHealthPublication = null;

        await appendServiceHealthPublicationRecoveredEvent({
          projectRootPath,
          serviceId,
          occurredAt: recoveredAt,
          deferredPublication: recoveredPublication,
        }).catch(() => {});

        if (!options.json) {
          writeLine(stdout, 'Health Publication: recovered.');
        }
      }

      return publication;
    } catch (error) {
      if (!isTransientMutablePublicationError(error)) {
        throw error;
      }

      if (deferredHealthPublication === null) {
        deferredHealthPublication = {
          occurredAt: nowFn(),
          phase,
          errorCode: error.code,
        };

        await appendServiceHealthPublicationDeferredEvent({
          projectRootPath,
          serviceId,
          occurredAt: deferredHealthPublication.occurredAt,
          phase,
          errorCode: error.code,
        }).catch(() => {});

        if (!options.json) {
          writeLine(stdout, `Health Publication: deferred after transient ${error.code}; retrying.`);
        }
      }

      return null;
    }
  };

  signalHandlers = installOpenMasOsServiceSignalHandlers({
    signalTarget,
    controller,
    stdout,
    json: options.json,
    onSignal: async ({ signalName, reason }) => {
      const occurredAt = nowFn();

      await appendServiceShutdownEvent({
        projectRootPath,
        serviceId,
        occurredAt,
        signalName,
        reason,
      });
      await writeLiveServiceHealthSnapshot({
        phase: 'signal_stopping',
        projectRootPath,
        state: buildServiceState({
          serviceId,
          status: 'stopping',
          projectRootPath,
          startedAt,
          updatedAt: occurredAt,
          config: healthConfig,
          stopRequested: true,
          stopReason: reason,
          lock: currentLockSummary,
        }),
        lastHeartbeatAt: occurredAt,
      });

      if (runtimeLoopOnSignal) {
        await runtimeLoopOnSignal({
          signalName,
          reason,
        });
      }
    },
  });

  if (lockClaim.status === 'recovered') {
    const recoveredAt = nowFn();

    await appendServiceRecoveryCompletedEvent({
      projectRootPath,
      serviceId,
      occurredAt: recoveredAt,
      startupRecovery,
      lockClaim,
    });
    await writeQueuedServiceHealthSnapshot({
      projectRootPath,
      state: buildServiceState({
        serviceId,
        status: 'recovering',
        projectRootPath,
        startedAt,
        updatedAt: recoveredAt,
        config: healthConfig,
        stopRequested: false,
        stopReason: null,
        lock: currentLockSummary,
      }),
      lastHeartbeatAt: recoveredAt,
    });
  }

  await writeQueuedServiceHealthSnapshot({
    projectRootPath,
    state: createInitialServiceState({
      serviceId,
      projectRootPath,
      startedAt,
      config: healthConfig,
      lock: currentLockSummary,
    }),
    lastHeartbeatAt: startedAt,
  });

  let loopFailure = null;

  try {
    loopResult = await runtimeLoopRunner({
      ...runtimeLoopOptions,
      projectRootPath,
      serviceId,
      controller,
      sleep: runtimeLoopSleep,
      tickIntervalMs: options.tickIntervalMs,
      maxDispatchedJobsPerTick: options.maxDispatchedJobs,
      staleAfterMs: options.staleAfterMs,
      recoverTerminalResultPublicationsOnStart,
      asyncDispatchExecutor,
      now: nowFn,
      onLifecycleEvent: async (event, snapshot) => {
        const quiescing = event.status === 'stopping' || event.status === 'stopped';

        await writeLiveServiceHealthSnapshot({
          phase: `lifecycle_${event.status}`,
          projectRootPath,
          state: createServiceStateFromLoopSnapshot({
            snapshot,
            projectRootPath,
            lock: currentLockSummary,
            updatedAt: event.occurredAt ?? nowFn(),
            status: quiescing ? 'stopping' : snapshot.status,
            asyncExecution: quiescing ? asyncDispatchExecutor.snapshot?.() : null,
          }),
          lastHeartbeatAt: event.occurredAt ?? nowFn(),
        });

        if (runtimeLoopOnLifecycleEvent) {
          await runtimeLoopOnLifecycleEvent(event, snapshot);
        }
      },
      onTickResult: async (tickResult) => {
        const refresh = await refreshKernelLock({
          projectRootPath,
          serviceId,
          lockId: lockClaim.lock.lockId,
          now: nowFn,
        });
        currentLockSummary = createLockSummary(refresh.lock, refresh.status);

        if (!options.json && !options.quiet) {
          printWatchTickSummary(tickResult, stdout);
        }

        if (runtimeLoopOnTickResult) {
          await runtimeLoopOnTickResult(tickResult);
        }
      },
      onTickError: async (lastError, snapshot) => {
        const failureObservedAt = nowFn();

        await appendServiceTickFailedEvent({
          projectRootPath,
          serviceId,
          occurredAt: failureObservedAt,
          lastError,
          snapshot,
        }).catch(() => {});
        await writeLiveServiceHealthSnapshot({
          phase: 'tick_error',
          projectRootPath,
          state: createServiceStateFromLoopSnapshot({
            snapshot,
            projectRootPath,
            lock: currentLockSummary,
            updatedAt: failureObservedAt,
          }),
          lastHeartbeatAt: failureObservedAt,
        });

        if (runtimeLoopOnTickError) {
          await runtimeLoopOnTickError(lastError, snapshot);
        }
      },
      onTickSkipped: async (skippedTick, snapshot) => {
        await appendServiceTickSkippedEvent({
          projectRootPath,
          serviceId,
          skippedTick,
        });
        await writeLiveServiceHealthSnapshot({
          phase: 'tick_skipped',
          projectRootPath,
          state: createServiceStateFromLoopSnapshot({
            snapshot,
            projectRootPath,
            lock: currentLockSummary,
            updatedAt: skippedTick.occurredAt ?? nowFn(),
          }),
          lastHeartbeatAt: skippedTick.occurredAt ?? nowFn(),
        });

        if (runtimeLoopOnTickSkipped) {
          await runtimeLoopOnTickSkipped(skippedTick, snapshot);
        }
      },
    });
  } catch (error) {
    loopFailure = error;
    throw error;
  } finally {
    asyncDispatchExecutor.stopAccepting?.();
    let asyncExecution = asyncDispatchExecutor.snapshot?.() ?? null;
    const publishShutdownDrainHealth = async () => {
      const refresh = await refreshKernelLock({
        projectRootPath,
        serviceId,
        lockId: lockClaim.lock.lockId,
        now: nowFn,
      });

      if (!refresh.refreshed) {
        throw new Error(
          'OpenMAS OS Service lost its kernel lock while draining asynchronous executions.'
          + ` status=${refresh.status}`,
        );
      }

      currentLockSummary = createLockSummary(refresh.lock, refresh.status);
      const observedAt = nowFn();
      asyncExecution = asyncDispatchExecutor.snapshot?.() ?? asyncExecution;

      if (loopResult) {
        await writeLiveServiceHealthSnapshot({
          phase: 'shutdown_drain',
          projectRootPath,
          state: createServiceStateFromLoopResult({
            loopResult,
            projectRootPath,
            lock: currentLockSummary,
            status: 'stopping',
            stoppedAt: observedAt,
            asyncExecution,
          }),
          lastHeartbeatAt: observedAt,
        });
      }
    };

    if ((asyncExecution?.activeCount ?? 0) > 0) {
      await publishShutdownDrainHealth();
      const drainTask = Promise.resolve(asyncDispatchExecutor.waitForIdle?.());
      const waitForDrainMaintenance = createShutdownDrainWaiter(drainTask);
      let drained = false;

      while (!drained) {
        const outcome = await waitForDrainMaintenance(shutdownDrainMaintenanceIntervalMs);

        if (outcome === 'drained') {
          drained = true;
          continue;
        }

        await publishShutdownDrainHealth();
      }

      await drainTask;
    } else {
      await asyncDispatchExecutor.waitForIdle?.();
    }

    asyncExecution = asyncDispatchExecutor.snapshot?.() ?? asyncExecution;
    signalHandlers.uninstall();
    await signalHandlers.waitForSignals();
    const release = await releaseKernelLock({
      projectRootPath,
      serviceId,
      lockId: lockClaim.lock.lockId,
      now: nowFn,
    });
    claimedLockReleased = release.released
      || release.reason === 'lock_missing'
      || release.reason === 'lock_owned_by_another_service';
    currentLockSummary = createLockSummary(release.lock, release.status);
    const stoppedAt = nowFn();

    if (loopResult) {
      loopResult = createTerminalWatchResult({
        loopResult,
        stoppedAt,
        asyncExecution,
      });
    } else if (loopFailure) {
      let previousState = null;

      try {
        previousState = await readServiceState({ projectRootPath });
      } catch {
        previousState = null;
      }

      try {
        await writeQueuedServiceHealthSnapshot({
          projectRootPath,
          state: createFailedWatchServiceState({
            serviceId,
            projectRootPath,
            startedAt,
            failedAt: stoppedAt,
            config: healthConfig,
            lock: currentLockSummary,
            error: loopFailure,
            previousState,
          }),
          lastHeartbeatAt: stoppedAt,
        });
      } catch {
        // Preserve the original service failure when final health publication also fails.
      }
    }
  }

  await writeQueuedServiceHealthSnapshot({
    projectRootPath,
    state: createServiceStateFromLoopResult({
      loopResult,
      projectRootPath,
      lock: currentLockSummary,
    }),
    lastHeartbeatAt: loopResult.stoppedAt,
  });

  if (options.json) {
    writeLine(stdout, JSON.stringify({
      mode: 'watch',
      serviceId,
      projectRootPath,
      lockClaim,
      result: loopResult,
    }, null, 2));
  } else {
    printWatchStopSummary(loopResult, stdout);
  }

  return {
    mode: 'watch',
    exitCode: 0,
    serviceId,
    lockClaim,
    result: loopResult,
  };
  } finally {
    if (claimedLockForCleanup !== null && !claimedLockReleased) {
      await releaseKernelLock({
        projectRootPath,
        serviceId,
        lockId: claimedLockForCleanup.lock.lockId,
        now: nowFn,
        audit: false,
      });
    }

    await Promise.resolve();
    outputHandlers.uninstall();
  }
}

export async function runOpenMasOsServiceCommand({
  argv,
  cwd = process.cwd(),
  stdout = process.stdout,
  signalTarget = process,
  serviceTickRunner = runOpenMasOsServiceTick,
  runtimeLoopRunner = runOpenMasOsRuntimeLoop,
  now,
  runtimeLoopOptions = {},
  serviceHealthSnapshotWriter = writeServiceHealthSnapshot,
} = {}) {
  const options = parseOpenMasOsServiceCliArgs(argv);
  const projectRootPath = path.resolve(cwd, options.projectRootPath);
  const serviceId = options.serviceId ?? createServiceId();
  const nowFn = typeof now === 'function' ? now : undefined;

  if (options.mode === 'help') {
    return runHelpCommand({
      options,
      stdout,
    });
  }

  if (options.mode === 'submit_system_call') {
    return runSubmitSystemCallCommand({
      options,
      projectRootPath,
      cwd,
      stdout,
    });
  }

  if (options.mode === 'tick') {
    return runTickCommand({
      options,
      projectRootPath,
      stdout,
      serviceTickRunner,
      serviceId,
      now: nowFn,
    });
  }

  if (options.mode === 'status') {
    return runStatusCommand({
      options,
      projectRootPath,
      stdout,
      now: nowFn,
    });
  }

  return runWatchCommand({
    options,
    projectRootPath,
    stdout,
    serviceId,
    runtimeLoopRunner,
    now: nowFn,
    runtimeLoopOptions,
    signalTarget,
    healthSnapshotWriter: serviceHealthSnapshotWriter,
  });
}

export function printOpenMasOsServiceError(error, stderr = process.stderr) {
  writeLine(stderr, 'OpenMAS OS Service failed');
  writeLine(stderr, `Error: ${createSafeErrorMessage(error, 'OpenMAS OS service command failed.')}`);
}
