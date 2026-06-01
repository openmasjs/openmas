import { MEMORY_AUTHORITY_LEVELS } from '../memory/memory-record-contract.js';
import { assertMemorySourceReferences } from '../memory/memory-source-reference-contract.js';

const CONTEXT_PACK_SECTION_TYPES = new Set([
  'invocation_summary',
  'recent_activity_summary',
  'durable_decisions',
  'relevant_artifacts',
  'domain_knowledge',
  'cognitive_identity_memory',
  'operational_identity_memory',
  'conversation_context',
  'policy_context',
  'task_state',
  'workflow_context',
  'relationship_context',
  'resource_context',
  'human_preferences',
  'evaluation_context',
  'open_questions',
  'risk_notes',
]);

const CONTEXT_SOURCE_DECISION_TYPES = new Set([
  'budget_omission',
  'lifecycle_omission',
  'approval_omission',
  'permission_rejection',
  'sensitivity_rejection',
  'privacy_rejection',
  'unsupported_source_type',
  'stale_source',
  'superseded_source',
  'expired_source',
  'invalid_source',
  'not_relevant',
]);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function assertEnumValue(value, allowedValues, description) {
  if (!isNonEmptyString(value)) {
    throw new Error(`${description} must be a non-empty string.`);
  }

  const normalizedValue = value.trim();

  if (!allowedValues.has(normalizedValue)) {
    throw new Error(`${description} is invalid: ${normalizedValue}`);
  }

  return normalizedValue;
}

function assertNonNegativeInteger(value, description) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${description} must be a non-negative integer.`);
  }

  return value;
}

function assertPositiveIntegerOrNull(value, description) {
  if (value === null || value === undefined) {
    return null;
  }

  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${description} must be a positive integer or null.`);
  }

  return value;
}

function assertStringArray(values, description) {
  if (!Array.isArray(values)) {
    throw new Error(`${description} must be an array.`);
  }

  const seenValues = new Set();

  return values.map((value, index) => {
    if (!isNonEmptyString(value)) {
      throw new Error(`${description}[${index}] must be a non-empty string.`);
    }

    const normalizedValue = value.trim();

    if (seenValues.has(normalizedValue)) {
      throw new Error(`${description} contains a duplicated value: ${normalizedValue}`);
    }

    seenValues.add(normalizedValue);
    return normalizedValue;
  });
}

function assertBudget(budget) {
  if (!isPlainObject(budget)) {
    throw new Error('Context Pack budget must be an object.');
  }

  const estimatedTokens = assertNonNegativeInteger(
    budget.estimatedTokens,
    'Context Pack budget estimatedTokens',
  );
  const maxTokens = assertPositiveIntegerOrNull(
    budget.maxTokens,
    'Context Pack budget maxTokens',
  );

  if (maxTokens !== null && estimatedTokens > maxTokens) {
    throw new Error('Context Pack budget estimatedTokens must not exceed maxTokens.');
  }

  return {
    estimatedTokens,
    maxTokens,
  };
}

function assertEligibilitySummary(eligibilitySummary) {
  if (!isPlainObject(eligibilitySummary)) {
    throw new Error('Context Pack eligibilitySummary must be an object.');
  }

  return {
    includedMemoryRecords: assertNonNegativeInteger(
      eligibilitySummary.includedMemoryRecords,
      'Context Pack eligibilitySummary includedMemoryRecords',
    ),
    omittedMemoryRecords: assertNonNegativeInteger(
      eligibilitySummary.omittedMemoryRecords,
      'Context Pack eligibilitySummary omittedMemoryRecords',
    ),
    rejectedMemoryRecords: assertNonNegativeInteger(
      eligibilitySummary.rejectedMemoryRecords,
      'Context Pack eligibilitySummary rejectedMemoryRecords',
    ),
  };
}

export function assertContextPackSection(section, index = null) {
  const description = Number.isInteger(index)
    ? `Context Pack sections[${index}]`
    : 'Context Pack section';

  if (!isPlainObject(section)) {
    throw new Error(`${description} must be an object.`);
  }

  if (!isNonEmptyString(section.sectionId)) {
    throw new Error(`${description} must include a non-empty sectionId.`);
  }

  if (!isNonEmptyString(section.title)) {
    throw new Error(`${description} must include a non-empty title.`);
  }

  if (!isNonEmptyString(section.content)) {
    throw new Error(`${description} must include non-empty content.`);
  }

  if (!isNonEmptyString(section.inclusionReason)) {
    throw new Error(`${description} must include a non-empty inclusionReason.`);
  }

  if (section.visibilityChecked !== true) {
    throw new Error(`${description} must include visibilityChecked: true.`);
  }

  return {
    sectionId: section.sectionId.trim(),
    sectionType: assertEnumValue(section.sectionType, CONTEXT_PACK_SECTION_TYPES, `${description} sectionType`),
    title: section.title.trim(),
    content: section.content.trim(),
    inclusionReason: section.inclusionReason.trim(),
    sourceReferences: assertMemorySourceReferences(section.sourceReferences ?? [], `${description} sourceReferences`),
    memoryRecordIds: assertStringArray(section.memoryRecordIds ?? [], `${description} memoryRecordIds`),
    visibilityChecked: true,
    authorityLevel: assertEnumValue(section.authorityLevel, MEMORY_AUTHORITY_LEVELS, `${description} authorityLevel`),
    priority: assertNonNegativeInteger(section.priority, `${description} priority`),
    estimatedTokens: assertNonNegativeInteger(section.estimatedTokens, `${description} estimatedTokens`),
    warnings: assertStringArray(section.warnings ?? [], `${description} warnings`),
  };
}

function assertSectionOrdering(sections) {
  for (let index = 1; index < sections.length; index += 1) {
    const previousSection = sections[index - 1];
    const currentSection = sections[index];

    if (currentSection.priority < previousSection.priority) {
      throw new Error('Context Pack sections must be ordered by ascending priority.');
    }

    if (
      currentSection.priority === previousSection.priority
      && currentSection.sectionId.localeCompare(previousSection.sectionId) < 0
    ) {
      throw new Error('Context Pack sections with the same priority must be ordered by sectionId.');
    }
  }
}

function assertContextSourceDecision(decision, index, description) {
  if (!isPlainObject(decision)) {
    throw new Error(`${description}[${index}] must be an object.`);
  }

  if (!isNonEmptyString(decision.reason)) {
    throw new Error(`${description}[${index}] must include a non-empty reason.`);
  }

  return {
    sourceId: isNonEmptyString(decision.sourceId) ? decision.sourceId.trim() : null,
    decisionType: decision.decisionType === undefined || decision.decisionType === null
      ? null
      : assertEnumValue(decision.decisionType, CONTEXT_SOURCE_DECISION_TYPES, `${description}[${index}] decisionType`),
    reason: decision.reason.trim(),
    memoryRecordIds: assertStringArray(decision.memoryRecordIds ?? [], `${description}[${index}] memoryRecordIds`),
    sourceReferences: assertMemorySourceReferences(decision.sourceReferences ?? [], `${description}[${index}] sourceReferences`),
    warnings: assertStringArray(decision.warnings ?? [], `${description}[${index}] warnings`),
  };
}

function assertContextSourceDecisions(decisions, description) {
  if (!Array.isArray(decisions)) {
    throw new Error(`${description} must be an array.`);
  }

  return decisions.map((decision, index) => {
    return assertContextSourceDecision(decision, index, description);
  });
}

export function assertContextPack(contextPack) {
  if (!isPlainObject(contextPack)) {
    throw new Error('Context Pack must be an object.');
  }

  if (contextPack.kind !== 'context_pack') {
    throw new Error('Context Pack must include kind "context_pack".');
  }

  if (!Number.isInteger(contextPack.version) || contextPack.version < 1) {
    throw new Error('Context Pack must include an integer version greater than or equal to 1.');
  }

  if (!isNonEmptyString(contextPack.contextPackId)) {
    throw new Error('Context Pack must include a non-empty contextPackId.');
  }

  if (!isNonEmptyString(contextPack.invocationId)) {
    throw new Error('Context Pack must include a non-empty invocationId.');
  }

  if (!isNonEmptyString(contextPack.operationalIdentityId)) {
    throw new Error('Context Pack must include a non-empty operationalIdentityId.');
  }

  if (!isNonEmptyString(contextPack.primaryCognitiveIdentityId)) {
    throw new Error('Context Pack must include a non-empty primaryCognitiveIdentityId.');
  }

  if (!Array.isArray(contextPack.sections)) {
    throw new Error('Context Pack must include a sections array.');
  }

  const sections = contextPack.sections.map((section, index) => {
    return assertContextPackSection(section, index);
  });
  const seenSectionIds = new Set();

  for (const section of sections) {
    if (seenSectionIds.has(section.sectionId)) {
      throw new Error(`Context Pack contains a duplicated sectionId: ${section.sectionId}`);
    }

    seenSectionIds.add(section.sectionId);
  }

  assertSectionOrdering(sections);

  return {
    kind: contextPack.kind,
    version: contextPack.version,
    contextPackId: contextPack.contextPackId.trim(),
    invocationId: contextPack.invocationId.trim(),
    operationalIdentityId: contextPack.operationalIdentityId.trim(),
    primaryCognitiveIdentityId: contextPack.primaryCognitiveIdentityId.trim(),
    secondaryCognitiveIdentityIds: assertStringArray(
      contextPack.secondaryCognitiveIdentityIds ?? [],
      'Context Pack secondaryCognitiveIdentityIds',
    ),
    sections,
    sourceReferences: assertMemorySourceReferences(contextPack.sourceReferences ?? [], 'Context Pack sourceReferences'),
    omittedSources: assertContextSourceDecisions(contextPack.omittedSources ?? [], 'Context Pack omittedSources'),
    rejectedSources: assertContextSourceDecisions(contextPack.rejectedSources ?? [], 'Context Pack rejectedSources'),
    budget: assertBudget(contextPack.budget),
    eligibilitySummary: assertEligibilitySummary(contextPack.eligibilitySummary),
    warnings: assertStringArray(contextPack.warnings ?? [], 'Context Pack warnings'),
  };
}

export {
  CONTEXT_PACK_SECTION_TYPES,
  CONTEXT_SOURCE_DECISION_TYPES,
};
