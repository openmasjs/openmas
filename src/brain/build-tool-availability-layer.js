import { assertInstructionLayer } from '../contracts/brain/instruction-layer-contract.js';
import { assertToolDefinition } from '../contracts/tools/tool-definition-contract.js';
import { assertToolReadinessEvaluation } from '../contracts/tools/tool-readiness-contract.js';

const TOOL_AVAILABILITY_LAYER_PRIORITY = 65;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function formatList(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return 'none';
  }

  return values.join(', ');
}

function formatJson(value) {
  if (!isPlainObject(value) || Object.keys(value).length === 0) {
    return 'none';
  }

  return JSON.stringify(value);
}

function normalizeToolDefinition(toolDefinition) {
  const normalizedDefinition = assertToolDefinition(toolDefinition);

  return {
    ...normalizedDefinition,
    sourcePath: typeof toolDefinition.sourcePath === 'string' && toolDefinition.sourcePath.trim().length > 0
      ? toolDefinition.sourcePath.trim()
      : `instance/tools/${normalizedDefinition.toolId}/tool.json`,
  };
}

function createToolDefinitionMap(toolDefinitions) {
  if (!Array.isArray(toolDefinitions)) {
    throw new Error('Tool Availability layer toolDefinitions must be an array.');
  }

  return new Map(toolDefinitions.map((toolDefinition) => {
    const normalizedDefinition = normalizeToolDefinition(toolDefinition);

    return [normalizedDefinition.toolId, normalizedDefinition];
  }));
}

function sortVerdicts(verdicts) {
  return [...verdicts].toSorted((left, right) => {
    return left.toolId.localeCompare(right.toolId);
  });
}

function findToolDefinition({ toolDefinitionById, toolId }) {
  return toolDefinitionById.get(toolId) ?? null;
}

function formatMatchedBindings(bindings) {
  if (!Array.isArray(bindings) || bindings.length === 0) {
    return 'none';
  }

  return bindings.map((binding) => {
    const credentialStatus = binding.credentialReferenceId
      ? `credential reference ${binding.credentialReferenceId}: ${binding.secretResolutionStatus ?? 'unresolved'}`
      : 'no credential reference';

    return `${binding.resourceId} (${binding.resourceType}/${binding.accessMode}, ${credentialStatus})`;
  }).join('; ');
}

function buildToolMetadataLines({ verdict, toolDefinition }) {
  const displayName = toolDefinition?.displayName ?? verdict.toolId;
  const description = toolDefinition?.description ?? 'No description is available.';
  const sideEffectLevel = toolDefinition?.sideEffectLevel ?? 'unknown';
  const toolType = toolDefinition?.toolType ?? 'unknown';
  const requiredPermissionModes = toolDefinition?.requiredPermissionModes ?? [];
  const requiredResourceTypes = toolDefinition?.requiredResourceTypes ?? [];
  const requiredAccessModes = toolDefinition?.requiredAccessModes ?? [];
  const inputSchema = toolDefinition?.inputSchema ?? {};
  const outputSchema = toolDefinition?.outputSchema ?? {};
  const persistResult = toolDefinition?.artifactPolicy?.persistResult === true;
  const allowWritebackCandidates = toolDefinition?.memoryPolicy?.allowWritebackCandidates === true;

  return [
    `### ${displayName}`,
    `Tool ID: ${verdict.toolId}`,
    `Status: ${verdict.status}`,
    `Approval Required: ${verdict.approvalRequired ? 'yes' : 'no'}`,
    `Side Effect Level: ${sideEffectLevel}`,
    `Tool Type: ${toolType}`,
    `Description: ${description}`,
    `Required Permission Modes: ${formatList(requiredPermissionModes)}`,
    `Required Resource Types: ${formatList(requiredResourceTypes)}`,
    `Required Access Modes: ${formatList(requiredAccessModes)}`,
    `Input Schema: ${formatJson(inputSchema)}`,
    `Output Schema: ${formatJson(outputSchema)}`,
    `Matched Bindings: ${formatMatchedBindings(verdict.matchedBindings)}`,
    `Artifact Persistence Requested: ${persistResult ? 'yes' : 'no'}`,
    `Memory Writeback Candidates Allowed: ${allowWritebackCandidates ? 'yes' : 'no'}`,
    `Runtime Verdict: ${verdict.reason}`,
  ];
}

function buildToolBlocks({
  title,
  verdicts,
  toolDefinitionById,
}) {
  if (verdicts.length === 0) {
    return [
      `## ${title}`,
      'none',
    ].join('\n');
  }

  return [
    `## ${title}`,
    ...sortVerdicts(verdicts).flatMap((verdict) => {
      return [
        '',
        ...buildToolMetadataLines({
          verdict,
          toolDefinition: findToolDefinition({
            toolDefinitionById,
            toolId: verdict.toolId,
          }),
        }),
      ];
    }),
  ].join('\n');
}

function buildDeniedOrUnavailableBlock({
  verdicts,
}) {
  if (verdicts.length === 0) {
    return [
      '## Denied Or Unavailable Tools',
      'none',
    ].join('\n');
  }

  return [
    '## Denied Or Unavailable Tools',
    'These tools must not be used, simulated, or described as available in this invocation.',
    ...sortVerdicts(verdicts).map((verdict) => {
      return `- ${verdict.toolId}: ${verdict.status}. ${verdict.reason}`;
    }),
  ].join('\n');
}

function buildToolAvailabilitySourceReferences({
  toolDefinitions,
  toolReadinessEvaluation,
}) {
  return [
    {
      sourceType: 'framework_runtime',
      sourceId: 'openmas-tool-availability-layer',
      path: 'src/brain/build-tool-availability-layer.js',
    },
    {
      sourceType: 'tool_readiness_evaluation',
      sourceId: 'current-invocation-tool-readiness',
      path: null,
    },
    ...toolDefinitions.map((toolDefinition) => {
      const normalizedDefinition = normalizeToolDefinition(toolDefinition);

      return {
        sourceType: 'tool_definition',
        sourceId: `${normalizedDefinition.toolId}:tool.json`,
        path: normalizedDefinition.sourcePath,
      };
    }),
    ...toolReadinessEvaluation.warnings.map((warning, index) => {
      return {
        sourceType: 'tool_readiness_warning',
        sourceId: `tool-readiness-warning-${index + 1}`,
        path: null,
      };
    }),
  ];
}

function buildToolAvailabilitySummary(evaluation) {
  return [
    `${evaluation.summary.ready} ready`,
    `${evaluation.summary.approvalRequired} approval required`,
    `${evaluation.summary.denied} denied`,
    `${evaluation.summary.unavailable} unavailable`,
  ].join(', ');
}

export function buildToolAvailabilityInstructionContent({
  toolDefinitions = [],
  toolReadinessEvaluation,
}) {
  const evaluation = assertToolReadinessEvaluation(toolReadinessEvaluation);
  const toolDefinitionById = createToolDefinitionMap(toolDefinitions);
  const readyVerdicts = evaluation.evaluatedTools.filter((verdict) => {
    return verdict.status === 'ready';
  });
  const approvalRequiredVerdicts = evaluation.evaluatedTools.filter((verdict) => {
    return verdict.status === 'approval_required';
  });
  const deniedOrUnavailableVerdicts = evaluation.evaluatedTools.filter((verdict) => {
    return verdict.status === 'denied' || verdict.status === 'unavailable';
  });

  return [
    '## Tool Availability',
    'This layer lists tools evaluated by the runtime for the current invocation.',
    'Tool availability is runtime evidence, not execution, not permission escalation, and not proof that any action has been performed.',
    'The brain may only request tools through the runtime tool request path. The runtime remains the only authority that can execute, deny, or request human approval for a tool.',
    'Never claim that a tool was executed unless the runtime returns a tool result.',
    '',
    '## Tool Readiness Summary',
    `Total Evaluated: ${evaluation.summary.totalEvaluated}`,
    `Ready: ${evaluation.summary.ready}`,
    `Approval Required: ${evaluation.summary.approvalRequired}`,
    `Denied: ${evaluation.summary.denied}`,
    `Unavailable: ${evaluation.summary.unavailable}`,
    '',
    '## Brain Tool Request Envelope',
    'If you need a tool, respond with only a JSON object that matches this exact shape:',
    '{',
    '  "kind": "brain_tool_request",',
    '  "version": 1,',
    '  "toolRequestId": "tool-request-001",',
    '  "toolId": "tool.id.from.available.list",',
    '  "input": {},',
    '  "purpose": "Explain why this tool is needed for the current user request.",',
    '  "expectedSideEffectLevel": "read_only"',
    '}',
    'Hard output rule: when emitting a brain_tool_request, output only the raw JSON object. Do not include markdown fences, prose, headings, summaries, or explanations before or after it.',
    'JSON validity rule: the envelope must be syntactically valid JSON. Escape quotation marks inside string values or avoid quoted tool IDs inside the purpose text.',
    'Direct tool-use rule: when the user explicitly asks you to use a ready read-only tool, prefer emitting the envelope instead of explaining expected behavior.',
    'Plan/preview grounding rule: if the user asks for a plan before execution, only mention tool ids from this layer and describe them as candidate steps, not as already executed actions.',
    'Do not invent tool ids, artifact names, reports, logs, or filesystem paths that are not explicitly listed in the current invocation context.',
    'Do not claim the tool was executed. The runtime may accept, deny, or require human approval for the request.',
    'After emitting a tool request envelope, stop. Wait for the runtime tool observation before producing the final user-facing answer.',
    'For normal answers that do not need a tool, do not emit this envelope.',
    '',
    buildToolBlocks({
      title: 'Ready Tools',
      verdicts: readyVerdicts,
      toolDefinitionById,
    }),
    '',
    buildToolBlocks({
      title: 'Approval Required Tools',
      verdicts: approvalRequiredVerdicts,
      toolDefinitionById,
    }),
    '',
    buildDeniedOrUnavailableBlock({
      verdicts: deniedOrUnavailableVerdicts,
    }),
    '',
    '## Tool Availability Warnings',
    evaluation.warnings.length > 0 ? evaluation.warnings.map((warning) => `- ${warning}`).join('\n') : 'none',
  ].join('\n');
}

export function buildToolAvailabilityLayer({
  toolDefinitions = [],
  toolReadinessEvaluation = null,
  warnings = [],
} = {}) {
  if (!toolReadinessEvaluation) {
    return null;
  }

  const evaluation = assertToolReadinessEvaluation(toolReadinessEvaluation);

  if (evaluation.evaluatedTools.length === 0) {
    return null;
  }

  const normalizedToolDefinitions = toolDefinitions.map(normalizeToolDefinition);

  return assertInstructionLayer({
    layerId: 'tool-availability',
    layerType: 'tool_availability',
    owner: 'tool-and-workflow-runtime',
    priority: TOOL_AVAILABILITY_LAYER_PRIORITY,
    sourceReferences: buildToolAvailabilitySourceReferences({
      toolDefinitions: normalizedToolDefinitions,
      toolReadinessEvaluation: evaluation,
    }),
    content: buildToolAvailabilityInstructionContent({
      toolDefinitions: normalizedToolDefinitions,
      toolReadinessEvaluation: evaluation,
    }),
    summary: `Tool availability for this invocation: ${buildToolAvailabilitySummary(evaluation)}.`,
    warnings: [
      ...warnings,
      ...evaluation.warnings,
    ],
  });
}

export {
  TOOL_AVAILABILITY_LAYER_PRIORITY,
};
