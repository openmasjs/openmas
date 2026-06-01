import path from 'node:path';
import { assertInstructionLayer } from '../contracts/brain/instruction-layer-contract.js';

const TOOL_OBSERVATION_LAYER_PRIORITY = 75;
const MAX_DATA_PREVIEW_CHARACTERS = 2000;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function assertBrainToolObservation(observation) {
  if (!isPlainObject(observation)) {
    throw new Error('Tool Observation layer requires a brain tool observation object.');
  }

  const requiredFields = [
    'kind',
    'toolId',
    'toolRunId',
    'status',
    'summary',
  ];

  for (const field of requiredFields) {
    if (!isNonEmptyString(observation[field])) {
      throw new Error(`Tool Observation layer requires observation.${field}.`);
    }
  }

  if (observation.kind !== 'brain_tool_observation') {
    throw new Error(`Tool Observation layer received unsupported observation kind: ${observation.kind}.`);
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

function formatJsonPreview(value, maxCharacters = MAX_DATA_PREVIEW_CHARACTERS) {
  if (value === null || value === undefined) {
    return 'null';
  }

  const serializedValue = JSON.stringify(value, null, 2);

  if (serializedValue.length <= maxCharacters) {
    return serializedValue;
  }

  return [
    serializedValue.slice(0, maxCharacters).trimEnd(),
    '',
    `... [TRUNCATED: data preview exceeded ${maxCharacters} characters]`,
  ].join('\n');
}

function formatList(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return 'none';
  }

  return values.map((value) => {
    return `- ${value}`;
  }).join('\n');
}

function getNestedValue(source, pathSegments) {
  let current = source;

  for (const pathSegment of pathSegments) {
    if (!isPlainObject(current) || !(pathSegment in current)) {
      return null;
    }

    current = current[pathSegment];
  }

  return current;
}

function getStringArray(source, pathSegments) {
  const value = getNestedValue(source, pathSegments);

  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item) => {
    return isNonEmptyString(item);
  }).map((item) => {
    return item.trim();
  });
}

function getLifecycleCounts(source, pathSegments) {
  const value = getNestedValue(source, pathSegments);

  if (!isPlainObject(value)) {
    return null;
  }

  return {
    active: Number.isInteger(value.active) ? value.active : 0,
    draft: Number.isInteger(value.draft) ? value.draft : 0,
    disabled: Number.isInteger(value.disabled) ? value.disabled : 0,
    unknown: Number.isInteger(value.unknown) ? value.unknown : 0,
  };
}

function getIntegerValue(source, pathSegments) {
  const value = getNestedValue(source, pathSegments);

  return Number.isInteger(value) ? value : null;
}

function formatInlineList(values) {
  return values.length > 0 ? values.join(', ') : 'none';
}

function formatCount(value) {
  return Number.isInteger(value) ? String(value) : 'not reported';
}

function buildGeneralToolEvidenceFidelityGuard() {
  return [
    '## General Tool Evidence Fidelity Guard',
    'The final answer must preserve tool evidence exactly, especially numeric counts, lifecycle labels, readiness labels, and status labels.',
    '',
    '### General Evidence Rules',
    '- Repeat numbers with the same meaning and label used by the observation.',
    '- Do not merge counts from different fields into one combined count unless the observation explicitly provides that combined field.',
    '- Do not rename lifecycle evidence as readiness evidence. Lifecycle active is not the same as runtime ready.',
    '- Do not rename inventory evidence as execution evidence. Installed, configured, or registered does not mean executed.',
    '- Translate for the human if needed, but preserve the exact evidence meaning across languages. Natural phrasing is allowed; semantic drift is not.',
    '- If a count, status, or readiness value is not reported, say it was not reported instead of inferring it.',
    '- If the user asks for an action after the observation, explain what the observation proves first, then propose the next governed runtime step.',
  ].join('\n');
}

function buildMasSystemInspectEvidenceSharpGuard(observation) {
  if (observation.toolId !== 'mas.system.inspect') {
    return null;
  }

  const dataPreview = isPlainObject(observation.dataPreview) ? observation.dataPreview : {};
  const registeredCognitiveIdentityIds = getStringArray(dataPreview, [
    'sections',
    'cognitiveIdentities',
    'registeredCognitiveIdentityIds',
  ]);
  const activeOperationalIdentityIds = getStringArray(dataPreview, [
    'sections',
    'operationalIdentities',
    'activeOperationalIdentityIds',
  ]);
  const activeResourceIds = getStringArray(dataPreview, [
    'sections',
    'resources',
    'activeResourceIds',
  ]);
  const draftResourceIds = getStringArray(dataPreview, [
    'sections',
    'resources',
    'draftResourceIds',
  ]);
  const activeToolIds = getStringArray(dataPreview, [
    'sections',
    'tools',
    'activeToolIds',
  ]);
  const activeWorkflowRuntimeIds = getStringArray(dataPreview, [
    'sections',
    'workflows',
    'activeWorkflowRuntimeIds',
  ]);
  const resourceLifecycleCounts = getLifecycleCounts(dataPreview, [
    'sections',
    'resources',
    'lifecycleCounts',
  ]);
  const overviewCounts = getNestedValue(dataPreview, [
    'diagnosticSummary',
    'counts',
  ]) ?? getNestedValue(dataPreview, [
    'sections',
    'overview',
    'counts',
  ]) ?? {};
  const registeredCognitiveIdentityCount = getIntegerValue(overviewCounts, ['registeredCognitiveIdentities']) ?? registeredCognitiveIdentityIds.length;
  const configuredOperationalIdentityCount = getIntegerValue(overviewCounts, ['configuredOperationalIdentities']);
  const activeOperationalIdentityCount = getIntegerValue(overviewCounts, ['activeOperationalIdentities'])
    ?? activeOperationalIdentityIds.length;
  const resourceCount = getIntegerValue(overviewCounts, ['resources']);
  const activeResourceCount = getIntegerValue(overviewCounts, ['activeResources'])
    ?? resourceLifecycleCounts?.active
    ?? activeResourceIds.length;
  const draftResourceCount = resourceLifecycleCounts?.draft ?? draftResourceIds.length;
  const installedToolCount = getIntegerValue(overviewCounts, ['installedTools']);
  const activeToolCount = getIntegerValue(overviewCounts, ['activeTools']) ?? activeToolIds.length;
  const installedWorkflowCount = getIntegerValue(overviewCounts, ['installedWorkflows']);
  const activeWorkflowRuntimeCount = getIntegerValue(overviewCounts, ['activeWorkflowRuntimes'])
    ?? activeWorkflowRuntimeIds.length;

  return [
    '## Evidence-Sharp Answer Guard',
    'This tool is an inventory and diagnostic reader. It proves bounded MAS metadata, not broad operational readiness.',
    'Use the exact terms below in the final answer. Do not upgrade weaker evidence into stronger claims.',
    'Never merge counts across categories. For example, do not combine resource lifecycle counts with operational identity counts.',
    '',
    '### Required Vocabulary Discipline',
    '- Say "registered cognitive identities", not "active agents", unless a runtime activity signal explicitly proves activity.',
    '- Say "configured operational identities" or "active lifecycle operational identities", not "running workers" or "resident agents".',
    '- Say "installed tools" or "active tool definitions", not "ready tools", unless the Tool Runtime readiness verdict proves readiness.',
    '- Say "installed workflows" or "active workflow runtimes", not "completed workflows" or "available workflows", unless workflow runtime evidence proves execution or availability.',
    '- Active workflow runtime means an installed workflow runtime definition is active. It does not mean a workflow is currently running, in progress, or executing.',
    '- Do not paraphrase "active workflow runtimes" as "active workflow executions", "running workflows", "workflow activity", or similar execution language.',
    '- Say "draft resources" for resources with draft lifecycle. Draft resources are not ready, active, or available for use.',
    '- Do not say "all components are active", "everything is ready", or "no issues" when draft, disabled, denied, unavailable, warning, or not-evaluated evidence exists.',
    '- If the final answer groups resources as "available", include only active resources there and list draft resources separately.',
    '',
    '### Exact Count Labels To Preserve',
    `Registered Cognitive Identity Count: ${formatCount(registeredCognitiveIdentityCount)}`,
    `Configured Operational Identity Count: ${formatCount(configuredOperationalIdentityCount)}`,
    `Active Lifecycle Operational Identity Count: ${formatCount(activeOperationalIdentityCount)}`,
    `Total Resource Count: ${formatCount(resourceCount)}`,
    `Active Resource Count: ${formatCount(activeResourceCount)}`,
    `Draft Resource Count: ${formatCount(draftResourceCount)}`,
    `Installed Tool Definition Count: ${formatCount(installedToolCount)}`,
    `Active Tool Definition Count: ${formatCount(activeToolCount)}`,
    `Installed Workflow Count: ${formatCount(installedWorkflowCount)}`,
    `Active Workflow Runtime Count: ${formatCount(activeWorkflowRuntimeCount)}`,
    '',
    '### Evidence Snapshot To Preserve',
    `Registered Cognitive Identities: ${formatInlineList(registeredCognitiveIdentityIds)}`,
    `Active Lifecycle Operational Identities: ${formatInlineList(activeOperationalIdentityIds)}`,
    `Active Lifecycle Resources: ${formatInlineList(activeResourceIds)}`,
    `Draft Resources: ${formatInlineList(draftResourceIds)}`,
    `Active Tool Definitions: ${formatInlineList(activeToolIds)}`,
    `Active Workflow Runtimes: ${formatInlineList(activeWorkflowRuntimeIds)}`,
    resourceLifecycleCounts
      ? `Resource Lifecycle Counts: active=${resourceLifecycleCounts.active}, draft=${resourceLifecycleCounts.draft}, disabled=${resourceLifecycleCounts.disabled}, unknown=${resourceLifecycleCounts.unknown}`
      : 'Resource Lifecycle Counts: not reported',
    '',
    '### Recommended Framing',
    '- Good: "The MAS inspection completed successfully. The inventory shows 6 active resources and 2 draft resources."',
    '- Bad: "All components are active" when draft resources exist.',
    '- Good: "Alfred WhatsApp is configured as a draft resource, so it should not be treated as ready for use."',
    '- Bad: "Alfred WhatsApp is available" when its lifecycle is draft.',
  ].join('\n');
}

function buildEvidenceSharpAnswerGuard(observation) {
  return [
    buildGeneralToolEvidenceFidelityGuard(observation),
    buildMasSystemInspectEvidenceSharpGuard(observation),
  ].filter(isNonEmptyString).join('\n\n');
}

function formatArtifactReferences(artifactReferences) {
  if (!Array.isArray(artifactReferences) || artifactReferences.length === 0) {
    return 'none';
  }

  return artifactReferences.map((artifactReference) => {
    return [
      `- Artifact ID: ${artifactReference.artifactId ?? 'n/a'}`,
      `  Kind: ${artifactReference.artifactKind ?? 'n/a'}`,
      `  Path: ${artifactReference.path ?? 'n/a'}`,
      `  Summary: ${artifactReference.summary ?? 'n/a'}`,
    ].join('\n');
  }).join('\n');
}

function buildSourceReferences({
  observation,
  brainToolExecution,
  masRootPath,
}) {
  const auditRecordPath = toMasRelativePath({
    masRootPath,
    filePath: brainToolExecution?.toolAuditRecordPath ?? null,
  });

  return [
    {
      sourceType: 'framework_runtime',
      sourceId: 'openmas-tool-observation-layer',
      path: 'src/brain/build-tool-observation-layer.js',
    },
    {
      sourceType: 'tool_run_audit_record',
      sourceId: `${observation.toolId}:${observation.toolRunId}`,
      path: auditRecordPath,
    },
    ...(Array.isArray(observation.artifactReferences)
      ? observation.artifactReferences.map((artifactReference) => {
        return {
          sourceType: 'tool_result_artifact',
          sourceId: artifactReference.artifactId ?? `${observation.toolRunId}:artifact`,
          path: artifactReference.path ?? null,
        };
      })
      : []),
  ];
}

function buildToolObservationContent({
  observation,
  brainToolExecution,
  auditRecordPath,
}) {
  const resultEvidence = observation.resultEvidence ?? {};
  const evidenceSharpAnswerGuard = buildEvidenceSharpAnswerGuard(observation);

  return [
    '## Tool Observation',
    'This layer contains bounded runtime evidence from a tool that has already executed through the OpenMAS Tool Runtime.',
    'Use this observation to produce the final user-facing answer for the current request.',
    'Do not claim any tool, workflow, approval, or external action beyond what this observation proves.',
    'Keep audit metadata, conversation participants, and human names separate from tool inventory data.',
    'Do not describe requestedBy, CLI users, or conversation participants as registered agents, tools, workflows, resources, or operational identities unless the observation data explicitly lists them in that exact inventory field.',
    'Do not emit another brain_tool_request envelope in this follow-up pass.',
    '',
    '## Executed Tool',
    `Tool ID: ${observation.toolId}`,
    `Tool Run ID: ${observation.toolRunId}`,
    `Tool Request ID: ${brainToolExecution?.toolRequestId ?? 'n/a'}`,
    `Tool Status: ${observation.status}`,
    `Tool Summary: ${observation.summary}`,
    `Audit Record Path: ${auditRecordPath ?? 'n/a'}`,
    '',
    '## Result Evidence',
    `Inline Data Included: ${resultEvidence.inlineDataIncluded ? 'yes' : 'no'}`,
    `Full Result Artifact Persisted: ${resultEvidence.fullResultArtifactPersisted ? 'yes' : 'no'}`,
    `Full Result Artifact Reason: ${resultEvidence.fullResultArtifactReason ?? 'n/a'}`,
    `Data Size Bytes: ${resultEvidence.dataSizeBytes ?? 'n/a'}`,
    `Redaction Applied: ${resultEvidence.redactionApplied ? 'yes' : 'no'}`,
    '',
    evidenceSharpAnswerGuard,
    evidenceSharpAnswerGuard ? '' : null,
    '## Data Preview',
    formatJsonPreview(observation.dataPreview),
    '',
    '## Artifact References',
    formatArtifactReferences(observation.artifactReferences),
    '',
    '## Tool Warnings',
    formatList(observation.warnings),
    '',
    '## Tool Errors',
    formatList(observation.errors),
  ].filter((line) => {
    return line !== null;
  }).join('\n');
}

export function buildToolObservationLayer({
  brainToolExecution,
  masRootPath = null,
} = {}) {
  const observation = assertBrainToolObservation(brainToolExecution?.observation);
  const auditRecordPath = toMasRelativePath({
    masRootPath,
    filePath: brainToolExecution?.toolAuditRecordPath ?? null,
  });

  return assertInstructionLayer({
    layerId: 'tool-observation',
    layerType: 'tool_observation',
    owner: 'tool-and-workflow-runtime',
    priority: TOOL_OBSERVATION_LAYER_PRIORITY,
    sourceReferences: buildSourceReferences({
      observation,
      brainToolExecution,
      masRootPath,
    }),
    content: buildToolObservationContent({
      observation,
      brainToolExecution,
      auditRecordPath,
    }),
    summary: `Runtime observation for ${observation.toolId} run ${observation.toolRunId}: ${observation.status}.`,
    warnings: brainToolExecution?.warnings ?? [],
  });
}

export {
  MAX_DATA_PREVIEW_CHARACTERS,
  TOOL_OBSERVATION_LAYER_PRIORITY,
};
