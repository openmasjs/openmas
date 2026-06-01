import path from 'node:path';
import { assertInstructionLayer } from '../contracts/brain/instruction-layer-contract.js';

const WORKFLOW_OBSERVATION_LAYER_PRIORITY = 76;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function assertBrainWorkflowObservation(observation) {
  if (!isPlainObject(observation)) {
    throw new Error('Workflow Observation layer requires a brain workflow observation object.');
  }

  const requiredFields = [
    'kind',
    'workflowId',
    'workflowRunId',
    'status',
    'summary',
  ];

  for (const field of requiredFields) {
    if (!isNonEmptyString(observation[field])) {
      throw new Error(`Workflow Observation layer requires observation.${field}.`);
    }
  }

  if (observation.kind !== 'brain_workflow_observation') {
    throw new Error(`Workflow Observation layer received unsupported observation kind: ${observation.kind}.`);
  }

  return observation;
}

function normalizePathForPrompt(value) {
  return value.replaceAll('\\', '/');
}

function toMasRelativePath({ masRootPath, filePath }) {
  if (!isNonEmptyString(filePath)) {
    return null;
  }

  if (!isNonEmptyString(masRootPath) || !path.isAbsolute(filePath)) {
    return normalizePathForPrompt(filePath.trim());
  }

  const relativePath = path.relative(masRootPath, filePath);

  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    return normalizePathForPrompt(filePath.trim());
  }

  return normalizePathForPrompt(relativePath);
}

function formatList(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return 'none';
  }

  return values.map((value) => {
    return `- ${value}`;
  }).join('\n');
}

function buildWorkflowEvidenceSharpGuard(observation) {
  return [
    '## Workflow Evidence-Sharp Answer Guard',
    'This workflow observation proves only what the executed workflow run and its recorded steps observed.',
    'Translate for the human if needed, but preserve exact evidence meaning across languages.',
    '',
    '### Required Evidence Discipline',
    '- Workflow Status describes this workflow run, not the entire MAS.',
    '- Completed Steps means those workflow steps finished; it does not mean unrelated system areas were verified.',
    '- Blocked Steps and Approval Requests must remain visible when they exist. Do not summarize a paused or blocked workflow as completed.',
    '- Tool Run IDs and Step Summaries are audit evidence. Use them to support claims, not to infer broader success than the workflow summary states.',
    '- Do not say "no anomalies", "everything is healthy", "no adjustments required", or similar broad conclusions unless the workflow summary or step evidence explicitly says that.',
    '- If a workflow includes an inventory-reading step, preserve the exact inventory semantics from that step instead of rewriting them as live execution or readiness claims.',
    '',
    '### Recommended Framing',
    `- Good: "Workflow ${observation.workflowId} completed with status ${observation.status}."`,
    '- Good: "The workflow observation shows which steps completed and which evidence was recorded."',
    '- Bad: "The whole MAS is healthy" when the workflow only observed a bounded subset of evidence.',
  ].join('\n');
}

function formatStepSummaries(stepSummaries, masRootPath) {
  if (!Array.isArray(stepSummaries) || stepSummaries.length === 0) {
    return 'none';
  }

  return stepSummaries.map((step) => {
    return [
      `### Step ${step.stepId}`,
      `Step Type: ${step.stepType}`,
      `Tool ID: ${step.toolId ?? 'n/a'}`,
      `Status: ${step.status}`,
      `Reason: ${step.reason}`,
      `Approval Request ID: ${step.approvalRequestId ?? 'n/a'}`,
      `Tool Run ID: ${step.toolRunId ?? 'n/a'}`,
      `Tool Result Status: ${step.toolResultStatus ?? 'n/a'}`,
      `Tool Audit Record Path: ${toMasRelativePath({
        masRootPath,
        filePath: step.toolAuditRecordPath,
      }) ?? 'n/a'}`,
      `Tool Result Snapshot Path: ${toMasRelativePath({
        masRootPath,
        filePath: step.toolResultSnapshotPath,
      }) ?? 'n/a'}`,
    ].join('\n');
  }).join('\n\n');
}

function buildSourceReferences({
  observation,
  masRootPath,
}) {
  return [
    {
      sourceType: 'framework_runtime',
      sourceId: 'openmas-workflow-observation-layer',
      path: 'src/brain/build-workflow-observation-layer.js',
    },
    {
      sourceType: 'workflow_run_state',
      sourceId: observation.workflowRunId,
      path: toMasRelativePath({
        masRootPath,
        filePath: observation.workflowRunStateRecordPath,
      }),
    },
    ...observation.stepSummaries
      .filter((step) => isNonEmptyString(step.toolAuditRecordPath))
      .map((step) => {
        return {
          sourceType: 'tool_run_audit_record',
          sourceId: `${step.toolId}:${step.toolRunId}`,
          path: toMasRelativePath({
            masRootPath,
            filePath: step.toolAuditRecordPath,
          }),
        };
      }),
  ];
}

function buildWorkflowObservationContent({
  observation,
  masRootPath,
}) {
  const evidenceSharpGuard = buildWorkflowEvidenceSharpGuard(observation);

  return [
    '## Workflow Observation',
    'This layer contains bounded runtime evidence from a workflow that has already run through the OpenMAS Workflow Runtime.',
    'Use this observation to produce the final user-facing answer for the current request.',
    'Do not claim any tool, workflow, approval, external action, or state mutation beyond what this observation proves.',
    'Do not emit another brain_workflow_request or brain_tool_request envelope in this follow-up pass.',
    '',
    '## Executed Workflow',
    `Workflow ID: ${observation.workflowId}`,
    `Workflow Run ID: ${observation.workflowRunId}`,
    `Workflow Status: ${observation.status}`,
    `Workflow Summary: ${observation.summary}`,
    `Workflow Run State Path: ${toMasRelativePath({
      masRootPath,
      filePath: observation.workflowRunStateRecordPath,
    }) ?? 'n/a'}`,
    '',
    evidenceSharpGuard,
    '',
    '## Workflow State',
    'Completed Steps:',
    formatList(observation.completedSteps),
    '',
    'Blocked Steps:',
    formatList(observation.blockedSteps),
    '',
    'Failed Steps:',
    formatList(observation.failedSteps),
    '',
    'Approval Requests:',
    formatList(observation.approvalRequests),
    '',
    'Tool Run IDs:',
    formatList(observation.toolRunIds),
    '',
    '## Step Summaries',
    formatStepSummaries(observation.stepSummaries, masRootPath),
    '',
    '## Workflow Warnings',
    formatList(observation.warnings),
    '',
    '## Workflow Errors',
    formatList(observation.errors),
  ].join('\n');
}

export function buildWorkflowObservationLayer({
  brainWorkflowExecution,
  masRootPath = null,
} = {}) {
  const observation = assertBrainWorkflowObservation(brainWorkflowExecution?.observation);

  return assertInstructionLayer({
    layerId: 'workflow-observation',
    layerType: 'workflow_observation',
    owner: 'tool-and-workflow-runtime',
    priority: WORKFLOW_OBSERVATION_LAYER_PRIORITY,
    sourceReferences: buildSourceReferences({
      observation,
      masRootPath,
    }),
    content: buildWorkflowObservationContent({
      observation,
      masRootPath,
    }),
    summary: `Runtime observation for workflow ${observation.workflowId} run ${observation.workflowRunId}: ${observation.status}.`,
    warnings: brainWorkflowExecution?.warnings ?? [],
  });
}

export {
  WORKFLOW_OBSERVATION_LAYER_PRIORITY,
};
