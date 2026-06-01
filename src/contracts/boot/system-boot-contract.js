const SYSTEM_BOOT_STATUSES = new Set([
  'ready',
  'degraded',
  'blocked',
  'failed',
]);

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function createSystemBootRequest(input = {}) {
  return {
    projectRootPath: input.projectRootPath,
    masRootHint: input.masRootHint ?? 'instance',
    strict: input.strict ?? false,
    requestedBy: input.requestedBy ?? 'system',
  };
}

export function assertSystemBootResult(result) {
  if (!result || typeof result !== 'object') {
    throw new Error('System Boot result must be an object.');
  }

  if (!SYSTEM_BOOT_STATUSES.has(result.status)) {
    throw new Error(`System Boot result contains an invalid status: ${result.status}`);
  }

  if (!isNonEmptyString(result.bootId)) {
    throw new Error('System Boot result must include a non-empty bootId.');
  }

  if (!Array.isArray(result.warnings)) {
    throw new Error('System Boot result must include a warnings array.');
  }

  if (!Array.isArray(result.errors)) {
    throw new Error('System Boot result must include an errors array.');
  }

  if (!isNonEmptyString(result.nextStep)) {
    throw new Error('System Boot result must include a non-empty nextStep.');
  }

  if (!result.invocationReadiness || typeof result.invocationReadiness !== 'object') {
    throw new Error('System Boot result must include an invocationReadiness object.');
  }

  if (typeof result.invocationReadiness.allowed !== 'boolean') {
    throw new Error('System Boot invocationReadiness.allowed must be a boolean.');
  }

  if (!isNonEmptyString(result.invocationReadiness.reason)) {
    throw new Error('System Boot invocationReadiness.reason must be a non-empty string.');
  }

  return result;
}

export function isBootReadyForAgentInvocation(result) {
  assertSystemBootResult(result);
  return result.invocationReadiness.allowed;
}
