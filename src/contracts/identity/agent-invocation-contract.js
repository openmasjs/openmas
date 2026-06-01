const AGENT_INVOCATION_STATUSES = new Set([
  'ready',
  'blocked',
  'failed',
]);

const AGENT_INVOCATION_MODES = new Set([
  'preflight',
  'deterministic',
  'probabilistic',
]);

const SAFE_CONVERSATION_REFERENCE_PATTERN = /^[a-z0-9._-]+$/u;
const SAFE_OS_RUNTIME_IDENTIFIER_PATTERN = /^[a-zA-Z0-9._-]+$/u;

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeOptionalConversationReference(value, description) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  if (!isNonEmptyString(value)) {
    throw new Error(`${description} must be a non-empty string when provided.`);
  }

  const normalizedValue = value.trim();

  if (!SAFE_CONVERSATION_REFERENCE_PATTERN.test(normalizedValue)) {
    throw new Error(`${description} contains unsafe characters: ${normalizedValue}`);
  }

  return normalizedValue;
}

function normalizeOptionalOsIdentifier(value, description) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  if (!isNonEmptyString(value)) {
    throw new Error(`${description} must be a non-empty string when provided.`);
  }

  const normalizedValue = value.trim();

  if (!SAFE_OS_RUNTIME_IDENTIFIER_PATTERN.test(normalizedValue)) {
    throw new Error(`${description} contains unsafe characters: ${normalizedValue}`);
  }

  return normalizedValue;
}

function normalizeOptionalOsRuntimeContext(value) {
  if (value === undefined || value === null) {
    return null;
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Agent Invocation osRuntimeContext must be an object when provided.');
  }

  return {
    jobId: normalizeOptionalOsIdentifier(value.jobId, 'Agent Invocation osRuntimeContext jobId'),
    processId: normalizeOptionalOsIdentifier(value.processId, 'Agent Invocation osRuntimeContext processId'),
    threadId: normalizeOptionalOsIdentifier(value.threadId, 'Agent Invocation osRuntimeContext threadId'),
    parentProcessId: normalizeOptionalOsIdentifier(
      value.parentProcessId,
      'Agent Invocation osRuntimeContext parentProcessId',
    ),
    source: isNonEmptyString(value.source) ? value.source.trim() : 'openmas-os',
  };
}

export function createAgentInvocationRequest(input = {}) {
  const normalizedOperationalIdentityId = isNonEmptyString(input.operationalIdentityId)
    ? input.operationalIdentityId.trim()
    : null;

  if (!normalizedOperationalIdentityId) {
    throw new Error('Agent Invocation request must include a non-empty operationalIdentityId.');
  }

  if (Object.hasOwn(input, 'agentId')) {
    throw new Error('Agent Invocation request must not include agentId. Invoke an Operational Identity; OpenMAS resolves cognition internally.');
  }

  const invocationMode = isNonEmptyString(input.invocationMode)
    ? input.invocationMode.trim()
    : 'preflight';

  if (!AGENT_INVOCATION_MODES.has(invocationMode)) {
    throw new Error(`Agent Invocation request contains an invalid invocationMode: ${invocationMode}`);
  }

  const conversationRef = normalizeOptionalConversationReference(
    input.conversationRef,
    'Agent Invocation conversationRef',
  );
  const createConversationName = normalizeOptionalConversationReference(
    input.createConversationName,
    'Agent Invocation createConversationName',
  );

  if (conversationRef && createConversationName) {
    throw new Error('Agent Invocation request cannot include both conversationRef and createConversationName.');
  }

  return {
    operationalIdentityId: normalizedOperationalIdentityId,
    requestedBy: input.requestedBy ?? 'system',
    invocationMode,
    command: input.command ?? 'status',
    inputText: input.inputText ?? '',
    conversationRef,
    createConversationName,
    conversationId: normalizeOptionalConversationReference(
      input.conversationId,
      'Agent Invocation conversationId',
    ),
    osRuntimeContext: normalizeOptionalOsRuntimeContext(input.osRuntimeContext),
  };
}

export function assertAgentInvocationReadiness(result) {
  if (!result || typeof result !== 'object') {
    throw new Error('Agent Invocation readiness result must be an object.');
  }

  if (!AGENT_INVOCATION_STATUSES.has(result.status)) {
    throw new Error(`Agent Invocation readiness contains an invalid status: ${result.status}`);
  }

  if (!result.request || !isNonEmptyString(result.request.operationalIdentityId)) {
    throw new Error('Agent Invocation readiness must include a valid operationalIdentityId target.');
  }

  if (!Array.isArray(result.warnings)) {
    throw new Error('Agent Invocation readiness must include a warnings array.');
  }

  if (!Array.isArray(result.errors)) {
    throw new Error('Agent Invocation readiness must include an errors array.');
  }

  return result;
}
