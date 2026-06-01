import { assertInstructionLayer } from '../contracts/brain/instruction-layer-contract.js';

const RUNTIME_CORE_LAYER_PRIORITY = 10;

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function formatNullableValue(value) {
  return isNonEmptyString(value) ? value.trim() : 'not resolved';
}

function resolveFallbackBrain(readiness) {
  return readiness?.brainSelection?.fallbackBrain ?? null;
}

function buildProviderAwarenessLines({ brainReference, readiness }) {
  const fallbackBrain = resolveFallbackBrain(readiness);
  const fallbackIsConfigured = Boolean(fallbackBrain);
  const lines = [
    `Current Brain Provider: ${formatNullableValue(brainReference?.providerId)}`,
    `Current Brain Model: ${formatNullableValue(brainReference?.modelId)}`,
    `Fallback Brain Configured: ${fallbackIsConfigured ? 'yes' : 'no'}`,
  ];

  if (fallbackIsConfigured) {
    lines.push(`Fallback Brain Provider: ${formatNullableValue(fallbackBrain.providerId)}`);
    lines.push(`Fallback Brain Model: ${formatNullableValue(fallbackBrain.modelId)}`);
  }

  lines.push('Treat provider and fallback details as runtime execution facts, not as user-facing content unless the user asks or an audit/report requires them.');

  return lines;
}

function buildRuntimeCoreSourceReferences({ brainReference, readiness }) {
  const sourceReferences = [
    {
      sourceType: 'framework_runtime',
      sourceId: 'openmas-runtime-core',
      path: 'src/brain/build-runtime-core-layer.js',
    },
  ];

  if (isNonEmptyString(brainReference?.providerId) && isNonEmptyString(brainReference?.modelId)) {
    sourceReferences.push({
      sourceType: 'brain_reference',
      sourceId: `current:${brainReference.providerId.trim()}:${brainReference.modelId.trim()}`,
      path: null,
    });
  }

  const fallbackBrain = resolveFallbackBrain(readiness);

  if (isNonEmptyString(fallbackBrain?.providerId) && isNonEmptyString(fallbackBrain?.modelId)) {
    sourceReferences.push({
      sourceType: 'brain_reference',
      sourceId: `fallback:${fallbackBrain.providerId.trim()}:${fallbackBrain.modelId.trim()}`,
      path: null,
    });
  }

  return sourceReferences;
}

export function buildRuntimeCoreInstructionContent({
  brainReference = null,
  readiness = null,
} = {}) {
  return [
    '## Framework Runtime Core',
    'You are acting inside the OpenMAS Multi-Agent System Framework.',
    'Follow the active Operational Identity persona, the Primary Cognitive Identity, and the framework/runtime constraints.',
    'The Operational Identity is the acting AI Agent identity for this invocation. Cognitive Identities provide resolved expertise and must never be presented as your operational name or as the acting Agent.',
    'Treat runtime-resolved facts as the source of truth for this invocation.',
    '',
    '### Traceability Guidance',
    'Prefer clear, auditable answers. Separate observed runtime facts from assumptions or recommendations.',
    'When explaining system behavior, name the relevant MAS concepts and avoid vague claims.',
    '',
    '### Uncertainty Guidance',
    'If information is missing, unavailable, or not resolved by the runtime, say so explicitly.',
    'Do not fabricate files, permissions, resources, tools, memory, provider behavior, or system state.',
    '',
    '### Resource And Permission Caution',
    'Do not claim access to resources, tools, channels, secrets, or permissions that are not explicitly resolved by the runtime.',
    'If a requested action depends on unresolved or denied access, explain the limitation and suggest the next safe step.',
    '',
    '### Provider And Fallback Awareness',
    ...buildProviderAwarenessLines({
      brainReference,
      readiness,
    }),
  ].join('\n');
}

export function buildRuntimeCoreLayer({
  brainReference = null,
  readiness = null,
} = {}) {
  return assertInstructionLayer({
    layerId: 'framework-runtime-core',
    layerType: 'framework_runtime',
    owner: 'openmas-framework',
    priority: RUNTIME_CORE_LAYER_PRIORITY,
    sourceReferences: buildRuntimeCoreSourceReferences({
      brainReference,
      readiness,
    }),
    content: buildRuntimeCoreInstructionContent({
      brainReference,
      readiness,
    }),
    summary: 'Core runtime role, traceability, uncertainty, resource, permission, provider, and fallback guidance.',
    warnings: [],
  });
}
