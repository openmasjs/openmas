import { randomUUID } from 'node:crypto';
import {
  OPENMAS_OS_KINDS,
  OPENMAS_OS_SCHEMA_VERSION,
  OPENMAS_OS_WAIT_REASONS,
  assertOpenMasOsThread,
  assertSafeOsSerializableValue,
} from '../../contracts/os/openmas-os-runtime-contract.js';
import { createLocalRuntimeAdapter } from '../adapters/local-runtime-adapter.js';
import { createSafeFailureSummary } from '../failure-summary.js';

const DEFAULT_LOCAL_DISPATCHER_CAPACITY = 1;
const NULL_DUE_AT_SORT_VALUE = '9999-12-31T23:59:59.999Z';

const DISPATCH_RESULT_STATUSES = new Set([
  'completed',
  'failed',
  'blocked',
]);

const SECRET_VALUE_REDACTION_PATTERNS = Object.freeze([
  /sk-(?:or-)?[a-zA-Z0-9_-]{8,}/gu,
  /AIza[a-zA-Z0-9_-]{10,}/gu,
  /xox[baprs]-[a-zA-Z0-9-]{8,}/gu,
  /Bearer\s+[a-zA-Z0-9._~+/-]{12,}/giu,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/gu,
]);

const SAFE_LOCAL_RUNTIME_IDENTIFIER_PATTERN = /^[a-zA-Z0-9._-]+$/u;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function assertNonEmptyString(value, description) {
  if (!isNonEmptyString(value)) {
    throw new Error(`${description} must be a non-empty string.`);
  }

  return value.trim();
}

function assertSafeIdentifier(value, description) {
  const normalizedValue = assertNonEmptyString(value, description);

  if (!SAFE_LOCAL_RUNTIME_IDENTIFIER_PATTERN.test(normalizedValue)) {
    throw new Error(`${description} contains unsafe characters: ${normalizedValue}`);
  }

  return normalizedValue;
}

function assertIntegerInRange(value, description, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${description} must be an integer between ${min} and ${max}.`);
  }

  return value;
}

function defaultNow() {
  return new Date().toISOString();
}

function normalizeNow(now) {
  if (now === undefined || now === null) {
    return defaultNow;
  }

  if (typeof now !== 'function') {
    throw new Error('OpenMAS OS local scheduler now must be a function when provided.');
  }

  return now;
}

function createSystemActor() {
  return {
    type: 'system',
    id: 'openmas-os',
  };
}

function createEventId() {
  return `event_${randomUUID()}`;
}

function assertAdapter(adapter) {
  if (!adapter || typeof adapter !== 'object') {
    throw new Error('OpenMAS OS local scheduler requires a runtime adapter.');
  }

  for (const methodName of [
    'loadThread',
    'persistThread',
    'loadProcess',
    'listThreads',
    'appendEvent',
  ]) {
    if (typeof adapter[methodName] !== 'function') {
      throw new Error(`OpenMAS OS runtime adapter must implement ${methodName}.`);
    }
  }

  return adapter;
}

function createAdapter({ adapter = null, projectRootPath = null, osRootPath = null } = {}) {
  return adapter ?? createLocalRuntimeAdapter({ projectRootPath, osRootPath });
}

function redactSecretLikeValues(value) {
  const stringValue = String(value ?? '');
  let redactedValue = stringValue;

  for (const pattern of SECRET_VALUE_REDACTION_PATTERNS) {
    redactedValue = redactedValue.replace(pattern, '[redacted-secret]');
  }

  return redactedValue.slice(0, 1000);
}

function createSafeErrorMessage(error, fallbackMessage = 'OpenMAS OS dispatch failed.') {
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

function createSafePayload(payload, description) {
  if (payload === undefined || payload === null) {
    return {};
  }

  try {
    return assertSafeOsSerializableValue(payload, description);
  } catch (error) {
    return {
      omitted: true,
      reason: 'unsafe_payload',
      errorMessage: createSafeErrorMessage(error, 'OpenMAS OS omitted unsafe dispatch payload.'),
    };
  }
}

function normalizeWaitReason(waitReason) {
  if (!isNonEmptyString(waitReason)) {
    return 'waiting_for_event';
  }

  const normalizedWaitReason = waitReason.trim();

  if (!OPENMAS_OS_WAIT_REASONS.has(normalizedWaitReason)) {
    return 'waiting_for_event';
  }

  return normalizedWaitReason;
}

function normalizeDispatchResult(executionResult, executorError = null) {
  if (executorError) {
    return {
      threadStatus: 'failed',
      eventType: 'thread.failed',
      waitReason: null,
      completedAt: true,
      payload: {
        status: 'failed',
        errorName: createSafeErrorName(executorError),
        errorMessage: createSafeErrorMessage(executorError),
      },
    };
  }

  const result = isPlainObject(executionResult) ? executionResult : {};
  const resultStatus = isNonEmptyString(result.status) ? result.status.trim() : 'completed';

  if (!DISPATCH_RESULT_STATUSES.has(resultStatus)) {
    return {
      threadStatus: 'failed',
      eventType: 'thread.failed',
      waitReason: null,
      completedAt: true,
      payload: {
        status: 'failed',
        errorName: 'InvalidDispatchResult',
        errorMessage: `OpenMAS OS dispatcher received unsupported executor status "${redactSecretLikeValues(resultStatus)}".`,
      },
    };
  }

  if (resultStatus === 'blocked') {
    const waitReason = normalizeWaitReason(result.waitReason);

    return {
      threadStatus: 'blocked',
      eventType: 'thread.blocked',
      waitReason,
      completedAt: false,
      payload: {
        status: 'blocked',
        waitReason,
        resultPayload: createSafePayload(result.payload, 'OpenMAS OS blocked dispatch payload'),
      },
    };
  }

  if (resultStatus === 'failed') {
    return {
      threadStatus: 'failed',
      eventType: 'thread.failed',
      waitReason: null,
      completedAt: true,
      payload: {
        status: 'failed',
        errorName: isNonEmptyString(result.errorName)
          ? redactSecretLikeValues(result.errorName)
          : 'DispatchExecutorFailure',
        errorMessage: createSafeErrorMessage(
          result.errorMessage ?? result.message,
          'OpenMAS OS dispatch executor reported failure.',
        ),
        resultPayload: createSafePayload(result.payload, 'OpenMAS OS failed dispatch payload'),
      },
    };
  }

  return {
    threadStatus: 'completed',
    eventType: 'thread.completed',
    waitReason: null,
    completedAt: true,
    payload: {
      status: 'completed',
      resultPayload: createSafePayload(result.payload, 'OpenMAS OS completed dispatch payload'),
    },
  };
}

function normalizeDueAt(dueAt) {
  return isNonEmptyString(dueAt) ? dueAt.trim() : NULL_DUE_AT_SORT_VALUE;
}

function normalizeReadyThreadRef(threadRef) {
  if (!isPlainObject(threadRef)) {
    throw new Error('OpenMAS OS ready Thread reference must be an object.');
  }

  return {
    threadId: assertSafeIdentifier(threadRef.threadId, 'OpenMAS OS ready Thread reference threadId'),
    processId: assertSafeIdentifier(threadRef.processId, 'OpenMAS OS ready Thread reference processId'),
    jobId: assertSafeIdentifier(threadRef.jobId, 'OpenMAS OS ready Thread reference jobId'),
    priority: assertIntegerInRange(threadRef.priority ?? 50, 'OpenMAS OS ready Thread reference priority', {
      min: 0,
      max: 1000000,
    }),
    dueAt: isNonEmptyString(threadRef.dueAt) ? threadRef.dueAt.trim() : null,
    createdAt: assertNonEmptyString(threadRef.createdAt, 'OpenMAS OS ready Thread reference createdAt'),
  };
}

function compareReadyThreadRefs(left, right) {
  if (left.priority !== right.priority) {
    return right.priority - left.priority;
  }

  const dueAtComparison = normalizeDueAt(left.dueAt).localeCompare(normalizeDueAt(right.dueAt));

  if (dueAtComparison !== 0) {
    return dueAtComparison;
  }

  const createdAtComparison = left.createdAt.localeCompare(right.createdAt);

  if (createdAtComparison !== 0) {
    return createdAtComparison;
  }

  return left.threadId.localeCompare(right.threadId);
}

async function appendThreadLifecycleEvent({
  adapter,
  eventType,
  source = createSystemActor(),
  thread,
  occurredAt,
  payload = {},
}) {
  return adapter.appendEvent({
    kind: OPENMAS_OS_KINDS.event,
    schemaVersion: OPENMAS_OS_SCHEMA_VERSION,
    eventId: createEventId(),
    eventType,
    source,
    targetRef: {
      type: 'thread',
      id: thread.threadId,
    },
    jobId: thread.jobId,
    processId: thread.processId,
    threadId: thread.threadId,
    occurredAt,
    payload,
  });
}

export function createReadyThreadRef(thread) {
  const normalizedThread = assertOpenMasOsThread(thread);

  if (normalizedThread.status !== 'ready') {
    throw new Error(`OpenMAS OS Thread ${normalizedThread.threadId} must be ready before it can be queued.`);
  }

  return normalizeReadyThreadRef({
    threadId: normalizedThread.threadId,
    processId: normalizedThread.processId,
    jobId: normalizedThread.jobId,
    priority: normalizedThread.priority,
    dueAt: normalizedThread.dueAt,
    createdAt: normalizedThread.createdAt,
  });
}

export class LocalReadyThreadQueue {
  constructor({ initialThreads = [] } = {}) {
    this.refsByThreadId = new Map();

    for (const thread of initialThreads) {
      this.enqueue(thread);
    }
  }

  get size() {
    return this.refsByThreadId.size;
  }

  clear() {
    this.refsByThreadId.clear();
  }

  enqueue(threadOrRef) {
    const readyThreadRef = isPlainObject(threadOrRef) && threadOrRef.kind === OPENMAS_OS_KINDS.thread
      ? createReadyThreadRef(threadOrRef)
      : normalizeReadyThreadRef(threadOrRef);

    this.refsByThreadId.set(readyThreadRef.threadId, readyThreadRef);
    return readyThreadRef;
  }

  peek() {
    return this.toArray()[0] ?? null;
  }

  dequeue() {
    const readyThreadRef = this.peek();

    if (readyThreadRef) {
      this.refsByThreadId.delete(readyThreadRef.threadId);
    }

    return readyThreadRef;
  }

  toArray() {
    return [...this.refsByThreadId.values()].sort(compareReadyThreadRefs);
  }
}

export function createLocalReadyThreadQueue(options = {}) {
  return new LocalReadyThreadQueue(options);
}

export async function synchronizeReadyThreadQueue({
  adapter = null,
  projectRootPath = null,
  osRootPath = null,
  queue = createLocalReadyThreadQueue(),
} = {}) {
  const runtimeAdapter = assertAdapter(createAdapter({ adapter, projectRootPath, osRootPath }));
  const readyThreads = await runtimeAdapter.listThreads({ status: 'ready' });

  queue.clear();

  for (const readyThread of readyThreads) {
    queue.enqueue(readyThread);
  }

  return queue;
}

export async function selectNextReadyThread({
  adapter = null,
  projectRootPath = null,
  osRootPath = null,
  queue = null,
} = {}) {
  if (queue) {
    if (queue.size === 0) {
      await synchronizeReadyThreadQueue({ adapter, projectRootPath, osRootPath, queue });
    }

    return queue.peek();
  }

  const synchronizedQueue = await synchronizeReadyThreadQueue({
    adapter,
    projectRootPath,
    osRootPath,
  });

  return synchronizedQueue.peek();
}

export async function dispatchThread({
  adapter = null,
  projectRootPath = null,
  osRootPath = null,
  threadRef,
  executor,
  now = undefined,
  source = createSystemActor(),
} = {}) {
  const runtimeAdapter = assertAdapter(createAdapter({ adapter, projectRootPath, osRootPath }));
  const readyThreadRef = normalizeReadyThreadRef(threadRef);
  const nowFn = normalizeNow(now);

  if (typeof executor !== 'function') {
    throw new Error('OpenMAS OS dispatcher requires an executor function.');
  }

  const loadedThread = await runtimeAdapter.loadThread(readyThreadRef.threadId);

  if (loadedThread.status !== 'ready') {
    return {
      dispatched: false,
      status: 'not_ready',
      reason: `OpenMAS OS Thread ${loadedThread.threadId} is ${loadedThread.status}.`,
      thread: loadedThread,
      threadRef: readyThreadRef,
    };
  }

  const owningProcess = await runtimeAdapter.loadProcess(loadedThread.processId);

  if (owningProcess.status === 'suspended') {
    return {
      dispatched: false,
      status: 'process_suspended',
      reason: `OpenMAS OS Process ${owningProcess.processId} is suspended.`,
      process: owningProcess,
      thread: loadedThread,
      threadRef: readyThreadRef,
    };
  }

  const startedAt = nowFn();
  const runningThread = await runtimeAdapter.persistThread({
    ...loadedThread,
    status: 'running',
    waitReason: null,
    startedAt: loadedThread.startedAt ?? startedAt,
    updatedAt: startedAt,
    completedAt: null,
  });

  await appendThreadLifecycleEvent({
    adapter: runtimeAdapter,
    eventType: 'thread.started',
    source,
    thread: runningThread,
    occurredAt: startedAt,
    payload: {
      status: runningThread.status,
      previousStatus: loadedThread.status,
    },
  });

  let executionResult;
  let executorError = null;

  try {
    executionResult = await executor({
      adapter: runtimeAdapter,
      thread: runningThread,
      threadRef: readyThreadRef,
      startedAt,
    });
  } catch (error) {
    executorError = error;
  }

  const finishedAt = nowFn();
  const dispatchResult = normalizeDispatchResult(executionResult, executorError);
  const failureSummary = dispatchResult.threadStatus === 'failed'
    ? createSafeFailureSummary({
      reasonCode: 'dispatch_failed',
      reason: 'OpenMAS OS Thread dispatch failed.',
      message: dispatchResult.payload?.errorMessage,
      errorName: dispatchResult.payload?.errorName,
      source: 'openmas-os-local-dispatcher',
      failedAt: finishedAt,
    })
    : null;
  const finalThread = await runtimeAdapter.persistThread({
    ...runningThread,
    status: dispatchResult.threadStatus,
    waitReason: dispatchResult.waitReason,
    updatedAt: finishedAt,
    completedAt: dispatchResult.completedAt ? finishedAt : null,
    failedAt: dispatchResult.threadStatus === 'failed' ? finishedAt : null,
    failureSummary,
  });

  await appendThreadLifecycleEvent({
    adapter: runtimeAdapter,
    eventType: dispatchResult.eventType,
    source,
    thread: finalThread,
    occurredAt: finishedAt,
    payload: dispatchResult.threadStatus === 'failed'
      ? {
        ...dispatchResult.payload,
        failedAt: finishedAt,
        failureSummary,
      }
      : dispatchResult.payload,
  });

  return {
    dispatched: true,
    status: finalThread.status,
    thread: finalThread,
    startedThread: runningThread,
    threadRef: readyThreadRef,
    result: dispatchResult,
  };
}

export class LocalDispatcher {
  constructor({
    adapter = null,
    projectRootPath = null,
    osRootPath = null,
    capacity = DEFAULT_LOCAL_DISPATCHER_CAPACITY,
    now = undefined,
  } = {}) {
    this.adapter = assertAdapter(createAdapter({ adapter, projectRootPath, osRootPath }));
    this.capacity = assertIntegerInRange(capacity, 'OpenMAS OS local dispatcher capacity', { min: 1 });
    this.now = normalizeNow(now);
    this.activeDispatchCount = 0;
  }

  get activeCount() {
    return this.activeDispatchCount;
  }

  get availableCapacity() {
    return Math.max(0, this.capacity - this.activeDispatchCount);
  }

  async dispatch(threadRef, executor, options = {}) {
    const readyThreadRef = normalizeReadyThreadRef(threadRef);

    if (this.activeDispatchCount >= this.capacity) {
      return {
        dispatched: false,
        status: 'capacity_exhausted',
        reason: 'OpenMAS OS local dispatcher has no available execution slot.',
        activeCount: this.activeDispatchCount,
        capacity: this.capacity,
        threadRef: readyThreadRef,
      };
    }

    this.activeDispatchCount += 1;

    try {
      return await dispatchThread({
        adapter: this.adapter,
        threadRef: readyThreadRef,
        executor,
        now: options.now ?? this.now,
        source: options.source ?? createSystemActor(),
      });
    } finally {
      this.activeDispatchCount -= 1;
    }
  }
}

export function createLocalDispatcher(options = {}) {
  return new LocalDispatcher(options);
}

export async function runSchedulerTick({
  adapter = null,
  projectRootPath = null,
  osRootPath = null,
  queue = null,
  dispatcher = null,
  executor,
  capacity = DEFAULT_LOCAL_DISPATCHER_CAPACITY,
  now = undefined,
} = {}) {
  const runtimeAdapter = assertAdapter(createAdapter({ adapter, projectRootPath, osRootPath }));
  const readyThreadQueue = queue ?? createLocalReadyThreadQueue();

  if (readyThreadQueue.size === 0) {
    await synchronizeReadyThreadQueue({
      adapter: runtimeAdapter,
      queue: readyThreadQueue,
    });
  }

  const selectedThreadRef = readyThreadQueue.dequeue();

  if (!selectedThreadRef) {
    return {
      dispatched: false,
      status: 'idle',
      reason: 'no_ready_threads',
      queueSize: 0,
    };
  }

  const localDispatcher = dispatcher ?? createLocalDispatcher({
    adapter: runtimeAdapter,
    capacity,
    now,
  });

  const dispatchResult = await localDispatcher.dispatch(selectedThreadRef, executor, {
    now: now === undefined ? undefined : now,
  });

  if (!dispatchResult.dispatched && ['capacity_exhausted', 'process_suspended'].includes(dispatchResult.status)) {
    readyThreadQueue.enqueue(selectedThreadRef);
  }

  return {
    ...dispatchResult,
    selectedThreadRef,
    queueSize: readyThreadQueue.size,
  };
}

export {
  DEFAULT_LOCAL_DISPATCHER_CAPACITY,
  compareReadyThreadRefs,
};
