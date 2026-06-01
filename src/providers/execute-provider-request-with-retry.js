import { assertProviderRetryPolicy } from '../contracts/providers/provider-retry-policy-contract.js';
import { assertProviderRequest } from '../contracts/providers/provider-request-contract.js';
import { assertProviderResponse } from '../contracts/providers/provider-response-contract.js';
import { createProviderExecutionFailureResponse } from './create-provider-execution-failure-response.js';
import { executeProviderRequest } from './execute-provider-request.js';
import { resolveProviderRetryDecision } from './resolve-provider-retry-decision.js';

function assertOptionalFunction(value, description) {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== 'function') {
    throw new Error(`${description} must be a function when provided.`);
  }

  return value;
}

function assertOptionalAbortSignal(value) {
  if (value === undefined || value === null) {
    return null;
  }

  if (
    typeof value !== 'object'
    || typeof value.aborted !== 'boolean'
    || typeof value.addEventListener !== 'function'
    || typeof value.removeEventListener !== 'function'
  ) {
    throw new Error('Provider retry abortSignal must be an AbortSignal when provided.');
  }

  return value;
}

function createAbortError(message) {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

async function executeProviderRequestAttemptWithDeadline({
  executeProviderRequestImplementation,
  preparedProvider,
  providerRequest,
  secretResolution,
  fetchImplementation,
  abortSignal,
  requestTimeoutMs,
}) {
  const attemptController = new AbortController();
  const forwardExternalAbort = () => {
    attemptController.abort(
      abortSignal?.reason ?? createAbortError('Provider request was cancelled.'),
    );
  };

  if (abortSignal?.aborted) {
    forwardExternalAbort();
  } else {
    abortSignal?.addEventListener('abort', forwardExternalAbort, { once: true });
  }

  const timeoutHandle = setTimeout(() => {
    attemptController.abort(
      createAbortError(`Provider request timed out after ${requestTimeoutMs} ms.`),
    );
  }, requestTimeoutMs);

  timeoutHandle.unref?.();

  let rejectOnAbort;
  const abortPromise = new Promise((resolve, reject) => {
    rejectOnAbort = () => {
      reject(
        attemptController.signal.reason
        ?? createAbortError('Provider request was cancelled.'),
      );
    };

    if (attemptController.signal.aborted) {
      rejectOnAbort();
      return;
    }

    attemptController.signal.addEventListener('abort', rejectOnAbort, { once: true });
  });

  try {
    return await Promise.race([
      executeProviderRequestImplementation({
        preparedProvider,
        providerRequest,
        secretResolution,
        fetchImplementation,
        abortSignal: attemptController.signal,
      }),
      abortPromise,
    ]);
  } finally {
    clearTimeout(timeoutHandle);
    abortSignal?.removeEventListener('abort', forwardExternalAbort);
    attemptController.signal.removeEventListener('abort', rejectOnAbort);
  }
}

function buildAttemptRecord({
  attemptNumber,
  providerResponse,
  retryDecision,
}) {
  return {
    attemptNumber,
    status: providerResponse.status,
    providerResponseStatus: providerResponse.status,
    providerResponseId: providerResponse.providerResponseId,
    finishReason: providerResponse.finishReason,
    errorCode: providerResponse.errorCode,
    errorMessage: providerResponse.errorMessage,
    providerFailureCategory: providerResponse.providerFailure?.category ?? null,
    retryableFailure: providerResponse.providerFailure?.retryable ?? false,
    retryDecision,
  };
}

export async function executeProviderRequestWithRetry({
  preparedProvider,
  providerRequest,
  secretResolution,
  fetchImplementation = null,
  executeProviderRequestImplementation = executeProviderRequest,
  retryPolicy = null,
  currentTimeMsImplementation = () => Date.now(),
  abortSignal = null,
}) {
  const normalizedProviderRequest = assertProviderRequest(providerRequest);
  const normalizedRetryPolicy = assertProviderRetryPolicy(retryPolicy);
  const normalizedExecuteProviderRequest = assertOptionalFunction(
    executeProviderRequestImplementation,
    'Provider retry executeProviderRequestImplementation',
  ) ?? executeProviderRequest;
  const now = assertOptionalFunction(
    currentTimeMsImplementation,
    'Provider retry currentTimeMsImplementation',
  ) ?? (() => Date.now());
  const normalizedAbortSignal = assertOptionalAbortSignal(abortSignal);

  const startedAtMs = now();
  const attempts = [];
  let finalProviderResponse = null;
  let stoppedReason = 'no_attempt';

  for (let attemptNumber = 1; attemptNumber <= normalizedRetryPolicy.maxAttempts; attemptNumber += 1) {
    let providerResponse;

    try {
      providerResponse = assertProviderResponse(await executeProviderRequestAttemptWithDeadline({
        executeProviderRequestImplementation: normalizedExecuteProviderRequest,
        preparedProvider,
        providerRequest: normalizedProviderRequest,
        secretResolution,
        fetchImplementation,
        abortSignal: normalizedAbortSignal,
        requestTimeoutMs: normalizedRetryPolicy.requestTimeoutMs,
      }));
    } catch (error) {
      providerResponse = createProviderExecutionFailureResponse({
        preparedProvider,
        providerRequest: normalizedProviderRequest,
        error,
      });
    }

    finalProviderResponse = providerResponse;

    if (providerResponse.status === 'completed') {
      attempts.push(buildAttemptRecord({
        attemptNumber,
        providerResponse,
        retryDecision: null,
      }));
      stoppedReason = 'completed';
      break;
    }

    const elapsedMs = Math.max(0, now() - startedAtMs);
    const retryDecision = resolveProviderRetryDecision({
      retryPolicy: normalizedRetryPolicy,
      requestType: normalizedProviderRequest.requestType,
      providerFailure: providerResponse.providerFailure,
      attemptNumber,
      elapsedMs,
    });

    attempts.push(buildAttemptRecord({
      attemptNumber,
      providerResponse,
      retryDecision,
    }));

    if (!retryDecision.shouldRetry) {
      stoppedReason = retryDecision.stopReason;
      break;
    }

    stoppedReason = 'retrying';
  }

  return {
    kind: 'provider_retry_execution',
    version: 1,
    providerId: normalizedProviderRequest.providerId,
    modelId: normalizedProviderRequest.modelId,
    requestType: normalizedProviderRequest.requestType,
    retryPolicy: normalizedRetryPolicy,
    totalAttempts: attempts.length,
    stoppedReason,
    finalProviderResponse,
    attempts,
  };
}
