import {
  MAS_SYSTEM_INSPECT_TOOL_ID,
  detectMasInspectionIntent,
  normalizeText,
  resolveIntentForInvocation,
} from '../intents/resolve-intent-for-invocation.js';

function buildNoWorkflowRequestResolution() {
  return {
    kind: 'brain_workflow_request_resolution',
    version: 1,
    status: 'no_request',
    requestedWorkflowId: null,
    workflowRequest: null,
    workflowRuntimeDefinition: null,
    executionAllowed: false,
    autoExecutionPerformed: false,
    runtimeAction: 'none',
    reason: 'Explicit tool intent helper supplied no workflow request.',
    warnings: [],
  };
}

export function resolveExplicitToolIntentForInvocation({
  request,
  toolRequestResolution,
  toolReadinessEvaluation,
} = {}) {
  const result = resolveIntentForInvocation({
    request,
    toolRequestResolution,
    workflowRequestResolution: buildNoWorkflowRequestResolution(),
    toolReadinessEvaluation,
    workflowRuntimeDefinitions: [],
  });

  return {
    toolRequestResolution: result.toolRequestResolution,
    intentApplied: result.intentApplied,
    reason: result.intentResolution.reason,
  };
}

export function isExplicitMasInspectRequest(inputText) {
  return detectMasInspectionIntent(normalizeText(inputText)) !== null;
}

export {
  MAS_SYSTEM_INSPECT_TOOL_ID,
};
