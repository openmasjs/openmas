import { assertInstructionLayer } from '../contracts/brain/instruction-layer-contract.js';

const EXECUTION_GUARDS_LAYER_PRIORITY = 70;

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function formatNullableValue(value) {
  return isNonEmptyString(value) ? value.trim() : 'not resolved';
}

function getOperationalIdentityId(readiness) {
  return readiness?.operationalIdentityDefinition?.operationalIdentityId ?? null;
}

function getFallbackBrain(readiness) {
  return readiness?.brainSelection?.fallbackBrain ?? null;
}

function buildPermissionEvaluationLines(readiness) {
  const permissionEvaluation = readiness?.permissionEvaluation ?? null;

  if (!permissionEvaluation) {
    return [
      'Permission Evaluation Status: not resolved for this invocation.',
      'Do not infer access. Treat unresolved permissions as unavailable unless another runtime layer explicitly says otherwise.',
    ];
  }

  const deniedBindings = permissionEvaluation.evaluatedBindings.filter((binding) => {
    return binding.effect === 'deny';
  });
  const lines = [
    'Permission Evaluation Status: resolved.',
    `Total Evaluated: ${permissionEvaluation.summary.totalEvaluated}`,
    `Allowed: ${permissionEvaluation.summary.allowed}`,
    `Denied: ${permissionEvaluation.summary.denied}`,
    `All Permitted: ${permissionEvaluation.allPermitted ? 'yes' : 'no'}`,
  ];

  if (deniedBindings.length === 0) {
    lines.push('Denied Bindings: none.');
  } else {
    lines.push('Denied Bindings:');

    for (const deniedBinding of deniedBindings) {
      lines.push(`- ${deniedBinding.resourceId} (${deniedBinding.accessMode}): ${deniedBinding.reason}`);
    }
  }

  lines.push('Use only runtime-usable bindings. Never imply that a denied, draft, inactive, missing, or unresolved resource can be used.');

  return lines;
}

function buildFallbackAwarenessLines({ brainReference, readiness }) {
  const fallbackBrain = getFallbackBrain(readiness);
  const lines = [
    `Current Brain Provider: ${formatNullableValue(brainReference?.providerId)}`,
    `Current Brain Model: ${formatNullableValue(brainReference?.modelId)}`,
    `Fallback Brain Configured: ${fallbackBrain ? 'yes' : 'no'}`,
  ];

  if (fallbackBrain) {
    lines.push(`Fallback Brain Provider: ${formatNullableValue(fallbackBrain.providerId)}`);
    lines.push(`Fallback Brain Model: ${formatNullableValue(fallbackBrain.modelId)}`);
  }

  lines.push('The runtime owns provider fallback. Do not pretend to execute a fallback yourself; simply answer through the brain selected for the current attempt.');

  return lines;
}

function buildRegisteredCognitiveIdentityLines(registeredCognitiveIdentities) {
  const liveCognitiveIdentityIds = Array.isArray(registeredCognitiveIdentities)
    ? registeredCognitiveIdentities
      .map((entry) => {
        return isNonEmptyString(entry?.cognitiveIdentityId) ? entry.cognitiveIdentityId.trim() : null;
      })
      .filter(Boolean)
      .toSorted((left, right) => left.localeCompare(right))
    : [];

  const lines = [];

  if (liveCognitiveIdentityIds.length === 0) {
    lines.push('Live Registered Cognitive Identities: not resolved for this invocation.');
  } else {
    lines.push(`Live Registered Cognitive Identities: ${liveCognitiveIdentityIds.join(', ')}.`);
  }

  lines.push('Recommend a specialist handoff only when the target cognitive identity is explicitly live in the MAS registry or current resolved context.');
  lines.push('If a specialist is not live yet, say that it is not currently available instead of routing to it as if it already exists.');
  lines.push('Treat labels such as audit_report, evidence_gap_report, and policy_compliance_report as descriptive shapes only unless a current tool, workflow, or contract explicitly exposes them.');
  lines.push('Do not promise concrete future filenames such as audit_report.json, evidence_gap_report.json, policy_compliance_report.json, improvement_roadmap.md, or health-review-<timestamp>.json unless the current runtime explicitly exposes those exact deliverables.');
  lines.push('When referencing runtime evidence paths, stay within canonical MAS locations such as instance/memory/state/agent-invocation-*.json, instance/memory/state/tool-run-*.json, instance/memory/state/workflows/workflow-run-*.json, instance/memory/artifacts/, and instance/cognitive-identities/....');

  return lines;
}

function buildExecutionGuardSourceReferences({ brainReference, readiness, registeredCognitiveIdentities }) {
  const sourceReferences = [
    {
      sourceType: 'framework_runtime',
      sourceId: 'openmas-execution-guards',
      path: 'src/brain/build-execution-guards-layer.js',
    },
    {
      sourceType: 'runtime_readiness',
      sourceId: 'agent-invocation-readiness',
      path: null,
    },
  ];
  const operationalIdentityId = getOperationalIdentityId(readiness);

  if (operationalIdentityId) {
    sourceReferences.push(
      {
        sourceType: 'operational_identity_permissions',
        sourceId: `${operationalIdentityId}:permissions.json`,
        path: `instance/operational-identities/${operationalIdentityId}/permissions.json`,
      },
      {
        sourceType: 'operational_identity_bindings',
        sourceId: `${operationalIdentityId}:bindings.json`,
        path: `instance/operational-identities/${operationalIdentityId}/bindings.json`,
      },
      {
        sourceType: 'resource_registry',
        sourceId: 'instance-resources',
        path: 'instance/registries/resources.json',
      },
    );
  }

  if (readiness?.permissionEvaluation) {
    sourceReferences.push({
      sourceType: 'permission_evaluation',
      sourceId: `${operationalIdentityId ?? 'unknown-operational-identity'}:permission-evaluation`,
      path: null,
    });
  }

  if (isNonEmptyString(brainReference?.providerId) && isNonEmptyString(brainReference?.modelId)) {
    sourceReferences.push({
      sourceType: 'brain_reference',
      sourceId: `current:${brainReference.providerId.trim()}:${brainReference.modelId.trim()}`,
      path: null,
    });
  }

  const fallbackBrain = getFallbackBrain(readiness);

  if (isNonEmptyString(fallbackBrain?.providerId) && isNonEmptyString(fallbackBrain?.modelId)) {
    sourceReferences.push({
      sourceType: 'brain_reference',
      sourceId: `fallback:${fallbackBrain.providerId.trim()}:${fallbackBrain.modelId.trim()}`,
      path: null,
    });
  }

  if (Array.isArray(registeredCognitiveIdentities) && registeredCognitiveIdentities.length > 0) {
    sourceReferences.push({
      sourceType: 'cognitive_identity_registry',
      sourceId: `cognitive-identities:${registeredCognitiveIdentities.length}`,
      path: 'instance/registries/cognitive-identities.json',
    });
  }

  return sourceReferences;
}

export function buildExecutionGuardsInstructionContent({
  brainReference = null,
  readiness = null,
  registeredCognitiveIdentities = [],
} = {}) {
  return [
    '## Execution Guards',
    'These are prompt-level guardrails for the current invocation. They do not replace runtime enforcement.',
    '',
    '### Stop Conditions',
    'Stop and explain the limitation when the request requires a resource, tool, secret, channel, permission, file, memory, or system state that is not resolved by the runtime.',
    'Stop and ask for human direction before destructive, irreversible, externally publishing, credential-related, or security-sensitive actions unless the runtime has explicitly prepared the required capability.',
    'Do not bypass, simulate, or ignore denied permissions, inactive bindings, missing secrets, unknown tools, or unavailable providers.',
    '',
    '### Escalation Behavior',
    'If the request is outside the active cognitive identity set, name the limitation and suggest the correct Operational Identity or next safe routing step when you can infer it from resolved context.',
    'If the request requires configuration, missing credentials, inactive resources, or unavailable permissions, explain the exact blocker and propose the smallest safe next action.',
    '',
    '### Confidence Caution',
    'Distinguish runtime facts from assumptions. If a fact is not present in the resolved invocation context, say that it is not currently available.',
    'Avoid overclaiming capabilities. Prefer precise uncertainty over confident fabrication.',
    'If the user asks for a plan, preview, or explanation before execution, keep the answer bounded to runtime-known affordances, artifacts, and paths that are explicitly present in the current invocation context.',
    'Do not present an operational plan as governed, executable, or fully validated unless the runtime has selected a valid plan path through known tool or workflow affordances.',
    'Do not invent tool ids, workflow ids, report names, filesystem paths, logs, providers, metrics, or evidence locations that are not explicitly present in the current invocation context.',
    'When a plan or preview cannot be fully grounded in known runtime affordances, label it as a bounded draft or ask for a narrower target instead of pretending it is a verified execution plan.',
    ...buildRegisteredCognitiveIdentityLines(registeredCognitiveIdentities),
    '',
    '### Hidden Action Claim Report',
    'When your visible answer includes execution, completion, delivery, mutation, or future-action claims, append exactly one hidden machine-readable action-claim report after the visible answer.',
    'Do not append any action-claim envelope for greetings, acknowledgments, capability explanations, or preview-only drafts that did not execute.',
    'Use this exact envelope format:',
    '<openmas-action-claims>{"kind":"action_claim_report","version":1,"claims":[{"kind":"action_claim_declaration","version":1,"claimId":"claim-001","claimType":"completed_action","actionSurface":"tool_or_workflow","evidenceRequirement":"successful_runtime_observation","summary":"The requested inspection completed successfully.","targetType":"tool","targetId":"mas.system.inspect","metadata":{}}]}</openmas-action-claims>',
    'The runtime strips this envelope before displaying the answer to humans.',
    'Include only claims that are actually asserted in the visible answer. If there are no execution-related claims, use an empty claims array.',
    'Each claim must be a kind "action_claim_declaration" record with claimId, claimType, actionSurface, evidenceRequirement, and summary.',
    'Do not use legacy shorthand such as claimType "execution" or an affordance id as actionSurface. Affordance ids belong in targetId.',
    'Do not declare a claim unless the visible answer really makes that claim.',
    '',
    '### Permission Caution',
    ...buildPermissionEvaluationLines(readiness),
    '',
    '### Provider And Fallback Awareness',
    ...buildFallbackAwarenessLines({
      brainReference,
      readiness,
    }),
  ].join('\n');
}

export function buildExecutionGuardsLayer({
  brainReference = null,
  readiness = null,
  registeredCognitiveIdentities = [],
} = {}) {
  return assertInstructionLayer({
    layerId: 'execution-guards',
    layerType: 'execution_guard',
    owner: 'openmas-framework',
    priority: EXECUTION_GUARDS_LAYER_PRIORITY,
    sourceReferences: buildExecutionGuardSourceReferences({
      brainReference,
      readiness,
      registeredCognitiveIdentities,
    }),
    content: buildExecutionGuardsInstructionContent({
      brainReference,
      readiness,
      registeredCognitiveIdentities,
    }),
    summary: 'Prompt-level stop conditions, escalation behavior, confidence caution, permission caution, and fallback awareness.',
    warnings: [],
  });
}
