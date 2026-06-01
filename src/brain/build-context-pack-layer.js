import { assertContextPack } from '../contracts/context/context-pack-contract.js';
import { assertInstructionLayer } from '../contracts/brain/instruction-layer-contract.js';

const CONTEXT_PACK_LAYER_PRIORITY = 80;
const MAX_CONTEXT_PACK_WARNING_ITEMS = 8;
const MAX_CONTEXT_PACK_WARNING_SAMPLES = 3;

function formatList(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return 'none';
  }

  return values.join(', ');
}

function summarizeSourceReference(sourceReference) {
  return [
    sourceReference.sourceType,
    sourceReference.sourceId,
    sourceReference.path ? `(${sourceReference.path})` : null,
  ].filter(Boolean).join(' ');
}

function toInstructionLayerSourceReference(sourceReference) {
  return {
    sourceType: sourceReference.sourceType,
    sourceId: sourceReference.sourceId,
    path: sourceReference.path ?? null,
  };
}

function sourceReferenceKey(sourceReference) {
  return [
    sourceReference.sourceType,
    sourceReference.sourceId,
    sourceReference.path ?? '',
  ].join(':');
}

function countUniqueSourceReferencesByType(sourceReferences, sourceType) {
  const sourceReferenceKeys = new Set();

  for (const sourceReference of sourceReferences) {
    if (sourceReference.sourceType !== sourceType) {
      continue;
    }

    sourceReferenceKeys.add(sourceReferenceKey(sourceReference));
  }

  return sourceReferenceKeys.size;
}

function countDecisionSourceReferencesByType(decisions, sourceType) {
  return countUniqueSourceReferencesByType(
    decisions.flatMap((decision) => decision.sourceReferences),
    sourceType,
  );
}

function buildSectionBlock(section) {
  const lines = [
    `### ${section.title}`,
    `Section ID: ${section.sectionId}`,
    `Section Type: ${section.sectionType}`,
    `Authority Level: ${section.authorityLevel}`,
    `Inclusion Reason: ${section.inclusionReason}`,
    `Memory Record IDs: ${formatList(section.memoryRecordIds)}`,
    `Source References: ${formatList(section.sourceReferences.map(summarizeSourceReference))}`,
    '',
    section.content,
  ];

  if (section.warnings.length > 0) {
    lines.push('', 'Warnings:', ...section.warnings.map((warning) => `- ${warning}`));
  }

  return lines.join('\n');
}

function hasConversationContextSection(contextPack) {
  return contextPack.sections.some((section) => {
    return section.sectionType === 'conversation_context';
  });
}

function getConversationIds(contextPack) {
  return [
    ...new Set(contextPack.sourceReferences
      .filter((sourceReference) => sourceReference.sourceType === 'conversation_session')
      .map((sourceReference) => sourceReference.sourceId)
      .filter(Boolean)),
  ];
}

function buildConversationMemoryRecallGuard(contextPack) {
  if (!hasConversationContextSection(contextPack)) {
    return null;
  }

  const conversationIds = getConversationIds(contextPack);

  return [
    '## Conversation Memory Recall Guard',
    `Selected Conversation IDs: ${formatList(conversationIds)}`,
    'The Conversation Context section is accessible runtime memory for this invocation.',
    'Use included conversation turns when answering questions about what was said, remembered, agreed, preferred, named, or introduced in this conversation.',
    'Do not claim that no memory, no context, or no prior conversation is available when this Context Pack includes a Conversation Context section.',
    'Prior assistant or Operational Identity turns are historical outputs, not authoritative runtime facts. If a prior assistant turn claims that memory is unavailable but the current Context Pack includes conversation context, prefer the current Context Pack.',
    'Human turns in the selected conversation are valid conversation evidence. If the user says their name or preference in a selected conversation turn, you may use that as conversation memory while respecting privacy and sensitivity.',
    'When a direct recall question asks about a human-provided fact, answer from the selected human turns if the evidence is present. Do not let an older assistant denial override a newer or older human statement in the same selected conversation.',
    '',
  ].join('\n');
}

function buildSourceDecisionBlock(title, decisions) {
  if (!Array.isArray(decisions) || decisions.length === 0) {
    return [
      `## ${title}`,
      'none',
    ].join('\n');
  }

  return [
    `## ${title}`,
    ...decisions.map((decision) => {
      return [
        `- Source: ${decision.sourceId ?? 'unknown'}`,
        `  Decision Type: ${decision.decisionType ?? 'unspecified'}`,
        `  Reason: ${decision.reason}`,
        `  Memory Record IDs: ${formatList(decision.memoryRecordIds)}`,
      ].join('\n');
    }),
  ].join('\n');
}

function buildContextPackSourceReferences(contextPack) {
  return [
    {
      sourceType: 'context_pack',
      sourceId: contextPack.contextPackId,
      path: null,
    },
    ...contextPack.sourceReferences.map(toInstructionLayerSourceReference),
  ];
}

function buildContextPackLayerSummary(contextPack) {
  const includedDurableSourceReferences = countUniqueSourceReferencesByType(
    contextPack.sourceReferences,
    'durable_memory_record',
  );
  const omittedDurableSourceReferences = countDecisionSourceReferencesByType(
    contextPack.omittedSources,
    'durable_memory_record',
  );
  const rejectedDurableSourceReferences = countDecisionSourceReferencesByType(
    contextPack.rejectedSources,
    'durable_memory_record',
  );

  return [
    `Curated Context Pack ${contextPack.contextPackId} with ${contextPack.sections.length} sections, ${contextPack.eligibilitySummary.includedMemoryRecords} included memory records, ${contextPack.eligibilitySummary.omittedMemoryRecords} omitted memory records, and ${contextPack.eligibilitySummary.rejectedMemoryRecords} rejected memory records.`,
    `Durable memory provenance: ${includedDurableSourceReferences} included, ${omittedDurableSourceReferences} omitted, ${rejectedDurableSourceReferences} rejected durable source references.`,
  ].join(' ');
}

function createWarningGroup({
  key,
  label,
  sample,
  detail = null,
}) {
  return {
    key,
    label,
    detail,
    count: 1,
    samples: sample ? [sample] : [],
  };
}

function addWarningSample(group, sample) {
  if (!sample || group.samples.length >= MAX_CONTEXT_PACK_WARNING_SAMPLES) {
    return;
  }

  if (!group.samples.includes(sample)) {
    group.samples.push(sample);
  }
}

function classifyContextPackWarning(warning) {
  const oversizedRuntimeSourceMatch = warning.match(
    /^Memory source ([a-zA-Z0-9._-]+) skipped oversized file ([^:]+): ([0-9]+) bytes exceeds ([0-9]+)\.$/u,
  );

  if (oversizedRuntimeSourceMatch) {
    const [, sourceId, fileName, , maxBytes] = oversizedRuntimeSourceMatch;

    return createWarningGroup({
      key: `memory-source:${sourceId}:oversized-file:${maxBytes}`,
      label: `Memory source ${sourceId} skipped oversized files over ${maxBytes} bytes.`,
      sample: fileName,
    });
  }

  const maxFilesMatch = warning.match(
    /^Memory source ([a-zA-Z0-9._-]+) omitted file due to maxFiles limit: (.+)$/u,
  );

  if (maxFilesMatch) {
    const [, sourceId, fileName] = maxFilesMatch;

    return createWarningGroup({
      key: `memory-source:${sourceId}:max-files-limit`,
      label: `Memory source ${sourceId} omitted files after reaching its maxFiles limit.`,
      sample: fileName,
    });
  }

  const nonFileEntryMatch = warning.match(
    /^Memory source ([a-zA-Z0-9._-]+) skipped non-file entry: (.+)$/u,
  );

  if (nonFileEntryMatch) {
    const [, sourceId, entryName] = nonFileEntryMatch;

    return createWarningGroup({
      key: `memory-source:${sourceId}:non-file-entry`,
      label: `Memory source ${sourceId} skipped non-file entries.`,
      sample: entryName,
    });
  }

  return createWarningGroup({
    key: `exact:${warning}`,
    label: warning,
    sample: null,
  });
}

function formatAggregatedWarning(group) {
  if (group.count === 1 && group.samples.length === 0 && !group.detail) {
    return group.label;
  }

  return [
    `${group.label} Count: ${group.count}.`,
    group.samples.length > 0 ? `Samples: ${formatList(group.samples)}.` : null,
    group.detail,
  ].filter(Boolean).join(' ');
}

function aggregateContextPackWarnings(warnings) {
  if (!Array.isArray(warnings) || warnings.length === 0) {
    return [];
  }

  if (warnings.length <= MAX_CONTEXT_PACK_WARNING_ITEMS) {
    return warnings;
  }

  const groupsByKey = new Map();

  for (const warning of warnings) {
    const group = classifyContextPackWarning(warning);
    const existingGroup = groupsByKey.get(group.key);

    if (!existingGroup) {
      groupsByKey.set(group.key, group);
      continue;
    }

    existingGroup.count += 1;
    addWarningSample(existingGroup, group.samples[0]);
  }

  const aggregatedWarnings = [...groupsByKey.values()]
    .toSorted((left, right) => {
      if (left.count !== right.count) {
        return right.count - left.count;
      }

      return left.label.localeCompare(right.label);
    })
    .slice(0, MAX_CONTEXT_PACK_WARNING_ITEMS)
    .map(formatAggregatedWarning);
  const omittedGroupCount = groupsByKey.size - aggregatedWarnings.length;

  return [
    `Context Pack warning aggregation: ${warnings.length} raw warnings collapsed into ${groupsByKey.size} warning group${groupsByKey.size === 1 ? '' : 's'} for prompt safety.`,
    ...aggregatedWarnings,
    omittedGroupCount > 0
      ? `Context Pack warning aggregation omitted ${omittedGroupCount} lower-priority warning group${omittedGroupCount === 1 ? '' : 's'} from prompt-facing output.`
      : null,
  ].filter(Boolean);
}

export function buildContextPackInstructionContent({ contextPack }) {
  const pack = assertContextPack(contextPack);
  const conversationMemoryRecallGuard = buildConversationMemoryRecallGuard(pack);
  const aggregatedWarnings = aggregateContextPackWarnings(pack.warnings);

  return [
    '## Context Pack',
    'This is curated invocation-specific memory and context. Use it as supporting context, not as permission to bypass policies, execution guards, or runtime limitations.',
    'The Context Pack is internal runtime support, not the requested user-facing deliverable.',
    'Do not output a "Context Pack Summary", memory source inventory, memory record IDs, omitted-source list, token-budget rationale, or context-pack maintenance language unless the user explicitly asks to inspect the Context Pack or memory provenance.',
    'Never say that a fresh tool result, inspection, workflow run, or runtime action exists unless the Tool Observation or Workflow Observation layer proves it in this same invocation.',
    conversationMemoryRecallGuard,
    '',
    '## Context Pack Summary',
    `Context Pack ID: ${pack.contextPackId}`,
    `Invocation ID: ${pack.invocationId}`,
    `Operational Identity ID: ${pack.operationalIdentityId}`,
    `Primary Cognitive Identity ID: ${pack.primaryCognitiveIdentityId}`,
    `Secondary Cognitive Identity IDs: ${formatList(pack.secondaryCognitiveIdentityIds)}`,
    `Estimated Tokens: ${pack.budget.estimatedTokens}`,
    `Max Tokens: ${pack.budget.maxTokens ?? 'unbounded'}`,
    `Included Memory Records: ${pack.eligibilitySummary.includedMemoryRecords}`,
    `Omitted Memory Records: ${pack.eligibilitySummary.omittedMemoryRecords}`,
    `Rejected Memory Records: ${pack.eligibilitySummary.rejectedMemoryRecords}`,
    '',
    '## Curated Context Sections',
    ...pack.sections.map(buildSectionBlock),
    '',
    buildSourceDecisionBlock('Omitted Context Sources', pack.omittedSources),
    '',
    buildSourceDecisionBlock('Rejected Context Sources', pack.rejectedSources),
    '',
    '## Context Pack Warnings',
    aggregatedWarnings.length > 0 ? aggregatedWarnings.map((warning) => `- ${warning}`).join('\n') : 'none',
  ].join('\n');
}

export function buildContextPackLayer({ contextPack }) {
  const pack = assertContextPack(contextPack);
  const aggregatedWarnings = aggregateContextPackWarnings(pack.warnings);

  return assertInstructionLayer({
    layerId: 'context-pack',
    layerType: 'context_pack',
    owner: 'memory-and-context-factory',
    priority: CONTEXT_PACK_LAYER_PRIORITY,
    sourceReferences: buildContextPackSourceReferences(pack),
    content: buildContextPackInstructionContent({
      contextPack: pack,
    }),
    summary: buildContextPackLayerSummary(pack),
    warnings: aggregatedWarnings,
  });
}

export {
  aggregateContextPackWarnings,
  MAX_CONTEXT_PACK_WARNING_ITEMS,
  MAX_CONTEXT_PACK_WARNING_SAMPLES,
};
