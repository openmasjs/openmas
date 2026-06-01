import { assertInstructionLayer } from '../contracts/brain/instruction-layer-contract.js';

const OPENMAS_OS_CONTEXT_LAYER_PRIORITY = 62;

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasExecutableOsContext(osRuntimeContext) {
  return isNonEmptyString(osRuntimeContext?.jobId)
    && isNonEmptyString(osRuntimeContext?.processId)
    && isNonEmptyString(osRuntimeContext?.threadId);
}

function formatNullableValue(value) {
  return isNonEmptyString(value) ? value.trim() : null;
}

function buildParentContext(osRuntimeContext) {
  return {
    jobId: formatNullableValue(osRuntimeContext.jobId),
    processId: formatNullableValue(osRuntimeContext.processId),
    threadId: formatNullableValue(osRuntimeContext.threadId),
  };
}

export function buildOpenMasOsContextInstructionContent({
  osRuntimeContext,
  conversationId = null,
} = {}) {
  const parentContext = buildParentContext(osRuntimeContext);
  const delegateInputFragment = {
    kind: 'brain_tool_request',
    version: 1,
    toolRequestId: 'tool-request-001',
    toolId: 'mas.os.delegate',
    input: {
      targetOperationalIdentityId: 'target-operational-identity-id',
      task: 'Task for the target Operational Identity.',
      command: 'ask',
      mode: 'probabilistic',
      parentContext,
    },
    purpose: 'Explain why this delegation is needed for the current user request.',
    expectedSideEffectLevel: 'write_internal',
  };
  const scheduledDelegationInputFragment = {
    kind: 'brain_tool_request',
    version: 1,
    toolRequestId: 'tool-request-001',
    toolId: 'mas.os.schedule_delegation',
    input: {
      targetOperationalIdentityId: 'target-operational-identity-id',
      task: 'Task for the target Operational Identity.',
      runAt: '2026-05-21T18:00:00-05:00',
      missedRunPolicy: 'delay',
      command: 'ask',
      mode: 'probabilistic',
      parentContext,
    },
    purpose: 'Explain why this future delegation is needed for the current user request.',
    expectedSideEffectLevel: 'write_internal',
  };
  const parentContextFragment = {
    parentContext,
  };

  if (isNonEmptyString(conversationId)) {
    delegateInputFragment.input.conversationId = conversationId.trim();
    scheduledDelegationInputFragment.input.conversationId = conversationId.trim();
    parentContextFragment.conversationId = conversationId.trim();
  }

  return [
    '## OpenMAS OS Runtime Context',
    'This invocation is running inside a real OpenMAS OS Job, Process, and Thread.',
    'Treat these identifiers as runtime facts. Do not derive OS identifiers from conversation ids, invocation ids, memory ids, or user text.',
    'OpenMAS communication is asynchronous: submitting or scheduling delegated work is not the same as receiving its completion result.',
    'Never claim that delegated or scheduled child work completed unless a child Result Record is present in the runtime evidence supplied to this invocation.',
    '',
    '### Current OS Execution Context',
    `Job ID: ${parentContext.jobId}`,
    `Process ID: ${parentContext.processId}`,
    `Thread ID: ${parentContext.threadId}`,
    `Parent Process ID: ${formatNullableValue(osRuntimeContext.parentProcessId) ?? 'none'}`,
    `Conversation ID: ${isNonEmptyString(conversationId) ? conversationId.trim() : 'none'}`,
    '',
    '### OS Tool Request Guidance',
    'When requesting an OpenMAS OS tool that requires parent execution context, include this parentContext exactly.',
    'Emit at most one brain_tool_request envelope for the current answer. If the request is for later, emit only mas.os.schedule_delegation. If the request is for now, emit only mas.os.delegate.',
    'The immediate delegation and scheduled delegation examples below are alternatives; never output both envelopes in the same answer.',
    'Parent context fragment:',
    JSON.stringify(parentContextFragment, null, 2),
    '',
    'For mas.os.delegate, emit a brain_tool_request with toolId "mas.os.delegate".',
    'Use mas.os.delegate only when another Operational Identity should perform the delegated task now.',
    'After delegation submission, say it was submitted or accepted and that its result is pending until runtime evidence provides a child Result Record.',
    'mas.os.delegate is a tool, not a workflow. Never use workflowId, workflowRequestId, or mas-os-delegate for this affordance.',
    'Use this exact envelope shape and replace only the targetOperationalIdentityId, task, and purpose values:',
    JSON.stringify(delegateInputFragment, null, 2),
    '',
    'For mas.os.schedule_delegation, emit a brain_tool_request with toolId "mas.os.schedule_delegation".',
    'Use mas.os.schedule_delegation when another Operational Identity should perform a one-shot delegated task later at an explicit time.',
    'After scheduled submission, say the work is scheduled, never that the scheduled child has already executed or completed.',
    'mas.os.schedule_delegation is a tool, not a workflow. Never use workflowId, workflowRequestId, or mas-os-schedule-delegation for this affordance.',
    'The runAt field must be an explicit ISO timestamp with timezone. Do not invent a missing date, time, or timezone; ask for clarification instead.',
    'The child command is usually "ask"; do not put mas.os.schedule_delegation in the child command field.',
    'Use missedRunPolicy "delay" for near-future AI-native scheduling so provider latency can still run on the next eligible OS tick.',
    'Use this exact envelope shape and replace only the targetOperationalIdentityId, task, runAt, and purpose values:',
    JSON.stringify(scheduledDelegationInputFragment, null, 2),
    'Do not invent or rename these fields.',
  ].join('\n');
}

export function buildOpenMasOsContextLayer({
  osRuntimeContext = null,
  conversationId = null,
} = {}) {
  if (!hasExecutableOsContext(osRuntimeContext)) {
    return null;
  }

  return assertInstructionLayer({
    layerId: 'openmas-os-runtime-context',
    layerType: 'runtime_context',
    owner: 'openmas-os',
    priority: OPENMAS_OS_CONTEXT_LAYER_PRIORITY,
    sourceReferences: [
      {
        sourceType: 'openmas_os_runtime_context',
        sourceId: `${osRuntimeContext.jobId}:${osRuntimeContext.processId}:${osRuntimeContext.threadId}`,
        path: null,
      },
    ],
    content: buildOpenMasOsContextInstructionContent({
      osRuntimeContext,
      conversationId,
    }),
    summary: 'Current OpenMAS OS Job, Process, Thread, and parentContext guidance for OS affordances.',
    warnings: [],
  });
}

export {
  OPENMAS_OS_CONTEXT_LAYER_PRIORITY,
};
