import { assertBrainOutput } from '../contracts/brain/brain-output-contract.js';
import { assertBrainToolRequestResolution } from '../contracts/brain/brain-tool-request-contract.js';
import { assertToolReadinessEvaluation } from '../contracts/tools/tool-readiness-contract.js';
import { parseBrainToolRequestEnvelopeFromText } from './parse-brain-tool-request-envelope.js';

function findToolReadinessVerdict({ toolReadinessEvaluation, toolId }) {
  if (!toolReadinessEvaluation) {
    return null;
  }

  return toolReadinessEvaluation.evaluatedTools.find((verdict) => {
    return verdict.toolId === toolId;
  }) ?? null;
}

function buildNoRequestResolution(reason) {
  return assertBrainToolRequestResolution({
    kind: 'brain_tool_request_resolution',
    version: 1,
    status: 'no_request',
    requestedToolId: null,
    toolRequest: null,
    toolReadinessVerdict: null,
    executionAllowed: false,
    approvalRequired: false,
    autoExecutionPerformed: false,
    runtimeAction: 'none',
    reason,
    warnings: [],
  });
}

function buildInvalidResolution(parseResult) {
  return assertBrainToolRequestResolution({
    kind: 'brain_tool_request_resolution',
    version: 1,
    status: 'invalid',
    requestedToolId: null,
    toolRequest: null,
    toolReadinessVerdict: null,
    executionAllowed: false,
    approvalRequired: false,
    autoExecutionPerformed: false,
    runtimeAction: 'reject',
    reason: parseResult.reason,
    warnings: parseResult.warnings,
  });
}

function buildDeniedResolution({
  toolRequest,
  toolReadinessVerdict = null,
  reason,
  warnings = [],
}) {
  return assertBrainToolRequestResolution({
    kind: 'brain_tool_request_resolution',
    version: 1,
    status: 'denied',
    requestedToolId: toolRequest.toolId,
    toolRequest,
    toolReadinessVerdict,
    executionAllowed: false,
    approvalRequired: false,
    autoExecutionPerformed: false,
    runtimeAction: 'reject',
    reason,
    warnings,
  });
}

function buildAcceptedResolution({
  toolRequest,
  toolReadinessVerdict,
}) {
  return assertBrainToolRequestResolution({
    kind: 'brain_tool_request_resolution',
    version: 1,
    status: 'accepted',
    requestedToolId: toolRequest.toolId,
    toolRequest,
    toolReadinessVerdict,
    executionAllowed: true,
    approvalRequired: false,
    autoExecutionPerformed: false,
    runtimeAction: 'queue_for_execution',
    reason: `Brain tool request for ${toolRequest.toolId} was accepted for runtime execution.`,
    warnings: [],
  });
}

function buildApprovalRequiredResolution({
  toolRequest,
  toolReadinessVerdict,
}) {
  return assertBrainToolRequestResolution({
    kind: 'brain_tool_request_resolution',
    version: 1,
    status: 'approval_required',
    requestedToolId: toolRequest.toolId,
    toolRequest,
    toolReadinessVerdict,
    executionAllowed: false,
    approvalRequired: true,
    autoExecutionPerformed: false,
    runtimeAction: 'request_human_approval',
    reason: `Brain tool request for ${toolRequest.toolId} requires human approval before execution.`,
    warnings: [],
  });
}

function resolveParsedToolRequest({
  toolRequest,
  toolReadinessEvaluation,
}) {
  if (!toolReadinessEvaluation) {
    return buildDeniedResolution({
      toolRequest,
      reason: 'No tool readiness evaluation is available for this invocation.',
    });
  }

  const toolReadinessVerdict = findToolReadinessVerdict({
    toolReadinessEvaluation,
    toolId: toolRequest.toolId,
  });

  if (!toolReadinessVerdict) {
    return buildDeniedResolution({
      toolRequest,
      reason: `Tool ${toolRequest.toolId} was not evaluated as available for this invocation.`,
    });
  }

  if (toolReadinessVerdict.status === 'ready') {
    return buildAcceptedResolution({
      toolRequest,
      toolReadinessVerdict,
    });
  }

  if (toolReadinessVerdict.status === 'approval_required') {
    return buildApprovalRequiredResolution({
      toolRequest,
      toolReadinessVerdict,
    });
  }

  return buildDeniedResolution({
    toolRequest,
    toolReadinessVerdict,
    reason: `Tool ${toolRequest.toolId} cannot be used in this invocation: ${toolReadinessVerdict.reason}`,
  });
}

export function resolveBrainToolRequestForInvocation({
  brainOutput,
  toolReadinessEvaluation = null,
} = {}) {
  const normalizedBrainOutput = assertBrainOutput(brainOutput);
  const normalizedToolReadinessEvaluation = toolReadinessEvaluation === null || toolReadinessEvaluation === undefined
    ? null
    : assertToolReadinessEvaluation(toolReadinessEvaluation);

  if (normalizedBrainOutput.status !== 'completed') {
    return buildNoRequestResolution('Brain output did not complete, so no tool request was evaluated.');
  }

  const parseResult = parseBrainToolRequestEnvelopeFromText({
    outputText: normalizedBrainOutput.outputText,
  });

  if (parseResult.status === 'no_request') {
    return buildNoRequestResolution(parseResult.reason);
  }

  if (parseResult.status === 'invalid') {
    return buildInvalidResolution(parseResult);
  }

  return resolveParsedToolRequest({
    toolRequest: parseResult.toolRequest,
    toolReadinessEvaluation: normalizedToolReadinessEvaluation,
  });
}
