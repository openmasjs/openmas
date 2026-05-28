import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildToolObservationLayer } from '../../src/brain/build-tool-observation-layer.js';
import { buildToolObservationFollowupInput } from '../../src/brain/build-tool-observation-followup-input.js';
import { buildWorkflowObservationLayer } from '../../src/brain/build-workflow-observation-layer.js';
import { buildWorkflowObservationFollowupInput } from '../../src/brain/build-workflow-observation-followup-input.js';

const TEST_PROJECT_ROOT_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TOOL_OBSERVATION_PROJECT_ROOT_PATH = path.join(TEST_PROJECT_ROOT_PATH, 'tests', 'fixtures', 'openmas-tool-observation');
const TOOL_OBSERVATION_MAS_ROOT_PATH = path.join(TOOL_OBSERVATION_PROJECT_ROOT_PATH, 'instance');
const TOOL_AUDIT_RECORD_PATH = path.join(
  TOOL_OBSERVATION_MAS_ROOT_PATH,
  'memory',
  'state',
  'tool-run-tool-run-001.json',
);
const WORKFLOW_RUN_STATE_RECORD_PATH = path.join(
  TOOL_OBSERVATION_MAS_ROOT_PATH,
  'memory',
  'state',
  'workflows',
  'workflow-run-001.json',
);

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function normalizePathForPrompt(value) {
  return value.replaceAll('\\', '/');
}

function buildBrainToolExecution(overrides = {}) {
  return {
    kind: 'brain_tool_execution_result',
    version: 1,
    status: 'executed',
    executionPerformed: true,
    requestedToolId: 'mas.system.inspect',
    toolRequestId: 'tool-request-001',
    toolRunId: 'tool-run-001',
    toolResultStatus: 'succeeded',
    toolAuditRecordPath: TOOL_AUDIT_RECORD_PATH,
    toolResultSnapshotPath: null,
    observation: {
      kind: 'brain_tool_observation',
      version: 1,
      toolId: 'mas.system.inspect',
      toolRunId: 'tool-run-001',
      status: 'succeeded',
      summary: 'MAS system inspection completed.',
      dataPreview: {
        readiness: 'ready',
        apiKey: '[REDACTED]',
      },
      artifactReferences: [],
      resultEvidence: {
        dataSizeBytes: 120,
        inlineDataLimitBytes: 8192,
        inlineDataIncluded: true,
        fullResultArtifactPersisted: false,
        fullResultArtifactReason: null,
        redactionApplied: true,
      },
      warnings: [],
      errors: [],
      audit: {
        invocationId: 'invocation-001',
        operationalIdentityId: 'alfred',
        requestedBy: 'test-suite',
      },
    },
    reason: 'Executed.',
    warnings: [],
    errors: [],
    ...overrides,
  };
}

function buildMasSystemInspectExecution() {
  return buildBrainToolExecution({
    observation: {
      ...buildBrainToolExecution().observation,
      dataPreview: {
        diagnosticSummary: {
          counts: {
            registeredCognitiveIdentities: 2,
            configuredOperationalIdentities: 2,
            activeOperationalIdentities: 2,
            resources: 3,
            activeResources: 2,
            installedTools: 1,
            activeTools: 1,
            installedWorkflows: 1,
            activeWorkflowRuntimes: 1,
          },
        },
        sections: {
          cognitiveIdentities: {
            registeredCognitiveIdentityIds: [
              'community-manager',
              'system-steward',
            ],
          },
          operationalIdentities: {
            activeOperationalIdentityIds: [
              'alfred',
              'maria',
            ],
          },
          resources: {
            lifecycleCounts: {
              active: 2,
              draft: 1,
              disabled: 0,
              unknown: 0,
            },
            activeResourceIds: [
              'openrouter-api',
              'mas-filesystem',
            ],
            draftResourceIds: [
              'alfred-whatsapp',
            ],
          },
          tools: {
            activeToolIds: [
              'mas.system.inspect',
            ],
          },
          workflows: {
            activeWorkflowRuntimeIds: [
              'mas-health-review',
            ],
          },
        },
      },
    },
  });
}

function buildBrainWorkflowExecution(overrides = {}) {
  return {
    kind: 'brain_workflow_execution_result',
    version: 1,
    status: 'executed',
    executionPerformed: true,
    requestedWorkflowId: 'mas-health-review',
    workflowRequestId: 'workflow-request-001',
    workflowRunId: 'workflow-run-001',
    workflowRunStatus: 'succeeded',
    workflowRunStateRecordPath: WORKFLOW_RUN_STATE_RECORD_PATH,
    observation: {
      kind: 'brain_workflow_observation',
      version: 1,
      workflowId: 'mas-health-review',
      workflowRunId: 'workflow-run-001',
      status: 'succeeded',
      summary: 'MAS health review completed with one successful inspection step.',
      completedSteps: [
        'inspect-system',
      ],
      blockedSteps: [],
      failedSteps: [],
      approvalRequests: [],
      toolRunIds: [
        'tool-run-001',
      ],
      stepSummaries: [
        {
          stepId: 'inspect-system',
          stepType: 'tool_call',
          toolId: 'mas.system.inspect',
          status: 'succeeded',
          reason: 'Inspection completed successfully.',
          approvalRequestId: null,
          toolRunId: 'tool-run-001',
          toolResultStatus: 'succeeded',
          toolAuditRecordPath: TOOL_AUDIT_RECORD_PATH,
          toolResultSnapshotPath: null,
        },
      ],
      warnings: [],
      errors: [],
      workflowRunStateRecordPath: WORKFLOW_RUN_STATE_RECORD_PATH,
    },
    warnings: [],
    errors: [],
    ...overrides,
  };
}

test('buildToolObservationLayer creates bounded runtime evidence with audit provenance', () => {
  const layer = buildToolObservationLayer({
    brainToolExecution: buildBrainToolExecution(),
    masRootPath: TOOL_OBSERVATION_MAS_ROOT_PATH,
  });
  const auditSourceReference = layer.sourceReferences.find((sourceReference) => {
    return sourceReference.sourceType === 'tool_run_audit_record';
  });
  const serializedLayer = JSON.stringify(layer);

  assert.equal(layer.layerType, 'tool_observation');
  assert.equal(layer.owner, 'tool-and-workflow-runtime');
  assert.match(layer.content, /## Tool Observation/u);
  assert.match(layer.content, /Tool Run ID: tool-run-001/u);
  assert.match(layer.content, /MAS system inspection completed/u);
  assert.match(layer.content, /Audit Record Path: memory\/state\/tool-run-tool-run-001\.json/u);
  assert.match(layer.content, /\[REDACTED\]/u);
  assert.match(layer.content, /Keep audit metadata, conversation participants, and human names separate from tool inventory data/u);
  assert.match(layer.content, /Do not describe requestedBy, CLI users, or conversation participants as registered agents/u);
  assert.match(layer.content, /Do not emit another brain_tool_request envelope/u);
  assert.ok(auditSourceReference);
  assert.equal(auditSourceReference.path, 'memory/state/tool-run-tool-run-001.json');
  assert.doesNotMatch(
    normalizePathForPrompt(layer.content),
    new RegExp(escapeRegExp(normalizePathForPrompt(TEST_PROJECT_ROOT_PATH)), 'u'),
  );
  assert.doesNotMatch(serializedLayer, /SECRET_SHOULD_NOT_LEAK/u);
});

test('buildToolObservationLayer adds an evidence-sharp guard for MAS inspection summaries', () => {
  const layer = buildToolObservationLayer({
    brainToolExecution: buildMasSystemInspectExecution(),
    masRootPath: TOOL_OBSERVATION_MAS_ROOT_PATH,
  });

  assert.match(layer.content, /## Evidence-Sharp Answer Guard/u);
  assert.match(layer.content, /registered cognitive identities/u);
  assert.match(layer.content, /not "active agents"/u);
  assert.match(layer.content, /General Tool Evidence Fidelity Guard/u);
  assert.match(layer.content, /Do not merge counts from different fields into one combined count/u);
  assert.match(layer.content, /Registered Cognitive Identity Count: 2/u);
  assert.match(layer.content, /Configured Operational Identity Count: 2/u);
  assert.match(layer.content, /Total Resource Count: 3/u);
  assert.match(layer.content, /Active Resource Count: 2/u);
  assert.match(layer.content, /Draft Resource Count: 1/u);
  assert.match(layer.content, /Draft Resources: alfred-whatsapp/u);
  assert.match(layer.content, /Active Workflow Runtime Count: 1/u);
  assert.match(layer.content, /does not mean a workflow is currently running, in progress, or executing/u);
  assert.match(layer.content, /Do not paraphrase "active workflow runtimes" as "active workflow executions", "running workflows", "workflow activity"/u);
  assert.match(layer.content, /Resource Lifecycle Counts: active=2, draft=1, disabled=0, unknown=0/u);
  assert.match(layer.content, /Draft resources are not ready, active, or available for use/u);
  assert.match(layer.content, /Bad: "All components are active" when draft resources exist/u);
});

test('buildToolObservationFollowupInput preserves the original request and forbids another tool request', () => {
  const input = buildToolObservationFollowupInput({
    request: {
      command: 'ask',
      requestedBy: 'cli',
      inputText: 'Please inspect the MAS before answering.',
    },
    activeCognitiveSet: {
      primaryCognitiveIdentityId: 'system-steward',
      secondaryCognitiveIdentityIds: [],
    },
    brainToolObservation: buildBrainToolExecution().observation,
  });

  assert.match(input, /Please inspect the MAS before answering/u);
  assert.match(input, /Runtime Follow-up/u);
  assert.match(input, /tool run tool-run-001/u);
  assert.match(input, /Preserve exact evidence labels, lifecycle states, readiness states/u);
  assert.match(input, /Preserve exact numeric count labels/u);
  assert.match(input, /preserve exact evidence meaning across languages/u);
  assert.match(input, /Do not turn inventory labels into execution claims/u);
  assert.match(input, /Produce the final user-facing answer now/u);
  assert.match(input, /Do not emit another brain_tool_request envelope/u);
});

test('buildWorkflowObservationLayer adds an evidence-sharp guard for bounded workflow conclusions', () => {
  const layer = buildWorkflowObservationLayer({
    brainWorkflowExecution: buildBrainWorkflowExecution(),
    masRootPath: TOOL_OBSERVATION_MAS_ROOT_PATH,
  });

  assert.match(layer.content, /## Workflow Observation/u);
  assert.match(layer.content, /## Workflow Evidence-Sharp Answer Guard/u);
  assert.match(layer.content, /Workflow Status describes this workflow run, not the entire MAS/u);
  assert.match(layer.content, /Do not say "no anomalies", "everything is healthy", "no adjustments required"/u);
  assert.match(layer.content, /If a workflow includes an inventory-reading step, preserve the exact inventory semantics/u);
});

test('buildWorkflowObservationFollowupInput preserves workflow evidence boundaries for the final answer', () => {
  const input = buildWorkflowObservationFollowupInput({
    request: {
      command: 'ask',
      requestedBy: 'cli',
      inputText: 'Please run the MAS health review and explain the result.',
    },
    activeCognitiveSet: {
      primaryCognitiveIdentityId: 'system-steward',
      secondaryCognitiveIdentityIds: [],
    },
    brainWorkflowObservation: buildBrainWorkflowExecution().observation,
  });

  assert.match(input, /Please run the MAS health review and explain the result/u);
  assert.match(input, /Runtime Follow-up/u);
  assert.match(input, /workflow run workflow-run-001/u);
  assert.match(input, /Preserve exact workflow statuses, step outcomes, and uncertainty boundaries/u);
  assert.match(input, /do not upgrade bounded workflow evidence into broader system-health or readiness claims/u);
  assert.match(input, /Do not emit another brain_workflow_request or brain_tool_request envelope/u);
});
