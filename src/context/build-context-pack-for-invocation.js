import { assertContextPack } from '../contracts/context/context-pack-contract.js';
import { assertMemoryRecord } from '../contracts/memory/memory-record-contract.js';
import { collectMemoryRecordsForInvocation } from '../memory/collect-memory-records-for-invocation.js';
import { evaluateMemoryRetention } from '../memory/evaluate-memory-retention.js';
import { evaluateMemoryStaleness } from '../memory/evaluate-memory-staleness.js';
import {
  evaluateMemorySupersession,
  resolveSupersededMemoryRecords,
} from '../memory/resolve-superseded-memory-records.js';
import {
  estimateContextTokens,
  summarizeMemoryRecordForContext,
} from './summarize-memory-record-for-context.js';

const DEFAULT_MAX_SECTIONS = 8;
const DEFAULT_MAX_ESTIMATED_TOKENS = 1200;
const DEFAULT_MEMORY_CONTENT_LENGTH = 600;
const CONVERSATION_MEMORY_CONTENT_LENGTH = 1800;

const AUTHORITY_RANK = new Map([
  ['system_rule', 0],
  ['human_directive', 1],
  ['policy', 2],
  ['mas_guidance', 3],
  ['team_guidance', 4],
  ['operational_note', 5],
  ['runtime_evidence', 6],
]);

const SHARED_OPERATIONAL_VISIBILITIES = new Set([
  'shared_with_team',
  'shared_with_mas',
  'public_within_mas',
]);

const CONTENTFUL_MEMORY_TYPES = new Set([
  'professional_knowledge',
  'durable_decision',
  'preference',
  'domain_fact',
  'company_fact',
  'brand_rule',
  'policy_context',
  'task_state',
  'workflow_state',
  'conversation_summary',
  'relationship_note',
  'human_preference',
  'resource_context',
  'evaluation_finding',
  'risk_note',
  'hypothesis',
]);

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizePositiveInteger(value, fallback, description) {
  if (value === undefined || value === null) {
    return fallback;
  }

  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${description} must be a positive integer.`);
  }

  return value;
}

function normalizeMaxTokens(value) {
  if (value === undefined) {
    return DEFAULT_MAX_ESTIMATED_TOKENS;
  }

  if (value === null) {
    return null;
  }

  if (!Number.isInteger(value) || value <= 0) {
    throw new Error('maxEstimatedTokens must be a positive integer or null.');
  }

  return value;
}

function uniqueStrings(values) {
  return [...new Set(values.filter(isNonEmptyString).map((value) => value.trim()))];
}

function sourceReferenceKey(sourceReference) {
  return [
    sourceReference.sourceType,
    sourceReference.sourceId,
    sourceReference.path ?? '',
  ].join(':');
}

function uniqueSourceReferences(sourceReferences) {
  const seenKeys = new Set();
  const uniqueReferences = [];

  for (const sourceReference of sourceReferences) {
    const key = sourceReferenceKey(sourceReference);

    if (seenKeys.has(key)) {
      continue;
    }

    seenKeys.add(key);
    uniqueReferences.push(sourceReference);
  }

  return uniqueReferences;
}

function resolveOperationalIdentityId({ readiness, request }) {
  return readiness?.operationalIdentityDefinition?.operationalIdentityId
    ?? readiness?.resolvedOperationalIdentity?.operationalIdentityId
    ?? request?.operationalIdentityId
    ?? 'unknown-operational-identity';
}

function resolvePrimaryCognitiveIdentityId({ readiness }) {
  return readiness?.activeCognitiveSet?.primaryCognitiveIdentityId
    ?? readiness?.resolvedPrimaryCognitiveIdentityId
    ?? null;
}

function resolveSecondaryCognitiveIdentityIds({ readiness }) {
  return readiness?.activeCognitiveSet?.secondaryCognitiveIdentityIds ?? [];
}

function buildInvocationSummaryContent({
  bootResult,
  readiness,
  request,
  invocationId,
  operationalIdentityId,
  primaryCognitiveIdentityId,
  secondaryCognitiveIdentityIds,
}) {
  const selectedBrain = readiness?.brainSelection?.selectedBrain ?? null;
  const fallbackBrain = readiness?.brainSelection?.fallbackBrain ?? null;

  return [
    `Invocation ID: ${invocationId}`,
    `Command: ${request.command}`,
    `Invocation Mode: ${request.invocationMode}`,
    `Requested By: ${request.requestedBy}`,
    `Boot Status: ${bootResult?.status ?? 'unknown'}`,
    `Readiness Status: ${readiness?.status ?? 'unknown'}`,
    `Operational Identity: ${operationalIdentityId}`,
    `Operational Display Name: ${readiness?.operationalIdentityDefinition?.displayName ?? 'n/a'}`,
    `Primary Cognitive Identity: ${primaryCognitiveIdentityId}`,
    `Secondary Cognitive Identities: ${secondaryCognitiveIdentityIds.length > 0 ? secondaryCognitiveIdentityIds.join(', ') : 'none'}`,
    `Selected Brain: ${selectedBrain ? `${selectedBrain.providerId}/${selectedBrain.modelId}` : 'none'}`,
    `Fallback Brain: ${fallbackBrain ? `${fallbackBrain.providerId}/${fallbackBrain.modelId}` : 'none'}`,
  ].join('\n');
}

function createSection({
  sectionId,
  sectionType,
  title,
  content,
  inclusionReason,
  sourceReferences = [],
  memoryRecordIds = [],
  authorityLevel,
  priority,
  warnings = [],
}) {
  return {
    sectionId,
    sectionType,
    title,
    content,
    inclusionReason,
    sourceReferences: uniqueSourceReferences(sourceReferences),
    memoryRecordIds: uniqueStrings(memoryRecordIds),
    visibilityChecked: true,
    authorityLevel,
    priority,
    estimatedTokens: estimateContextTokens(content),
    warnings: uniqueStrings(warnings),
  };
}

function createDecisionForRecord({ record, decisionType, reason, warnings = [] }) {
  return {
    sourceId: record.sourceReferences[0]?.sourceId ?? record.memoryRecordId,
    decisionType,
    reason,
    memoryRecordIds: [record.memoryRecordId],
    sourceReferences: record.sourceReferences,
    warnings: uniqueStrings(warnings),
  };
}

function sortMemoryRecordsForContext(memoryRecords) {
  return [...memoryRecords].sort((left, right) => {
    const leftAuthorityRank = AUTHORITY_RANK.get(left.authorityLevel) ?? 99;
    const rightAuthorityRank = AUTHORITY_RANK.get(right.authorityLevel) ?? 99;

    if (leftAuthorityRank !== rightAuthorityRank) {
      return leftAuthorityRank - rightAuthorityRank;
    }

    const leftTimestamp = Date.parse(left.updatedAt ?? left.createdAt ?? 0);
    const rightTimestamp = Date.parse(right.updatedAt ?? right.createdAt ?? 0);

    if (!Number.isNaN(leftTimestamp) && !Number.isNaN(rightTimestamp) && leftTimestamp !== rightTimestamp) {
      return rightTimestamp - leftTimestamp;
    }

    return left.memoryRecordId.localeCompare(right.memoryRecordId);
  });
}

function isRuntimeReferenceRecord(record) {
  return record.memoryType === 'runtime_evidence' || record.memoryType === 'artifact_reference';
}

function evaluateMemoryEligibility({
  record,
  activeCognitiveIdentityIds,
  operationalIdentityId,
  now,
  supersessionResolution,
  includeExpiredMemory,
  includeStaleMemory,
  includeSupersededMemory,
}) {
  if (record.privacy.deletionState !== 'active') {
    return {
      effect: 'reject',
      decisionType: 'privacy_rejection',
      reason: `Memory record ${record.memoryRecordId} privacy deletionState is ${record.privacy.deletionState}.`,
      warnings: [`Privacy-protected memory rejected: ${record.memoryRecordId}`],
    };
  }

  if (record.privacy.redactionState !== 'not_required') {
    return {
      effect: 'reject',
      decisionType: 'privacy_rejection',
      reason: `Memory record ${record.memoryRecordId} privacy redactionState is ${record.privacy.redactionState}.`,
      warnings: [`Privacy-redacted memory rejected: ${record.memoryRecordId}`],
    };
  }

  const retentionEvaluation = evaluateMemoryRetention({
    memoryRecord: record,
    now,
    includeExpiredMemory,
  });

  if (retentionEvaluation.effect === 'omit') {
    return {
      effect: 'omit',
      decisionType: retentionEvaluation.decisionType,
      reason: retentionEvaluation.reason,
      warnings: retentionEvaluation.warnings,
    };
  }

  const supersessionEvaluation = evaluateMemorySupersession({
    memoryRecord: record,
    supersessionResolution,
    includeSupersededMemory,
  });

  if (supersessionEvaluation.effect === 'omit') {
    return {
      effect: 'omit',
      decisionType: supersessionEvaluation.decisionType,
      reason: supersessionEvaluation.reason,
      warnings: supersessionEvaluation.warnings,
    };
  }

  const stalenessEvaluation = evaluateMemoryStaleness({
    memoryRecord: record,
    now,
    includeStaleMemory,
  });

  if (stalenessEvaluation.effect === 'omit') {
    return {
      effect: 'omit',
      decisionType: stalenessEvaluation.decisionType,
      reason: stalenessEvaluation.reason,
      warnings: stalenessEvaluation.warnings,
    };
  }

  const lifecycleAllowedByExplicitOption = (
    (record.lifecycleStatus === 'expired' && includeExpiredMemory)
    || (record.lifecycleStatus === 'stale' && includeStaleMemory)
    || (record.lifecycleStatus === 'superseded' && includeSupersededMemory)
  );

  if (record.lifecycleStatus !== 'active' && !lifecycleAllowedByExplicitOption) {
    return {
      effect: 'omit',
      decisionType: 'lifecycle_omission',
      reason: `Memory record ${record.memoryRecordId} lifecycleStatus is ${record.lifecycleStatus}.`,
      warnings: [],
    };
  }

  if (record.approvalState === 'rejected') {
    return {
      effect: 'reject',
      decisionType: 'lifecycle_omission',
      reason: `Memory record ${record.memoryRecordId} approvalState is rejected.`,
      warnings: [],
    };
  }

  if (!['approved', 'not_required'].includes(record.approvalState)) {
    return {
      effect: 'omit',
      decisionType: 'approval_omission',
      reason: `Memory record ${record.memoryRecordId} approvalState is ${record.approvalState}; only approved or not_required memory can enter a context pack.`,
      warnings: [`Unapproved memory was omitted before prompt context assembly: ${record.memoryRecordId}`],
    };
  }

  const lifecycleWarnings = [
    ...retentionEvaluation.warnings,
    ...supersessionEvaluation.warnings,
    ...stalenessEvaluation.warnings,
  ];

  if (record.sensitivityLevel === 'secret_reference_only') {
    return {
      effect: 'reject',
      decisionType: 'sensitivity_rejection',
      reason: `Memory record ${record.memoryRecordId} is credential-reference-only and cannot enter a context pack.`,
      warnings: ['Secret-reference-only memory was rejected before prompt context assembly.'],
    };
  }

  if (record.scope === 'cognitive_identity') {
    if (!activeCognitiveIdentityIds.has(record.ownerId)) {
      return {
        effect: 'reject',
        decisionType: 'permission_rejection',
        reason: `Cognitive identity memory ${record.memoryRecordId} belongs to ${record.ownerId}, which is not active for this invocation.`,
        warnings: [],
      };
    }

    if (record.portability !== 'portable') {
      return {
        effect: 'reject',
        decisionType: 'permission_rejection',
        reason: `Cognitive identity memory ${record.memoryRecordId} is ${record.portability}, not portable.`,
        warnings: ['MAS-bound cognitive identity memory was rejected from portable expert context.'],
      };
    }

    return { effect: 'include', warnings: lifecycleWarnings };
  }

  if (record.scope === 'operational_identity') {
    if (record.ownerId === operationalIdentityId) {
      return { effect: 'include', warnings: lifecycleWarnings };
    }

    if (SHARED_OPERATIONAL_VISIBILITIES.has(record.visibility) && record.approvalState === 'approved') {
      return { effect: 'include', warnings: lifecycleWarnings };
    }

    return {
      effect: 'reject',
      decisionType: 'permission_rejection',
      reason: `Operational identity memory ${record.memoryRecordId} belongs to ${record.ownerId}, not ${operationalIdentityId}.`,
      warnings: ['Private operational identity memory was rejected for this invocation.'],
    };
  }

  if (record.scope === 'mas_instance') {
    if (record.visibility === 'restricted' && !isRuntimeReferenceRecord(record)) {
      return {
        effect: 'reject',
        decisionType: 'sensitivity_rejection',
        reason: `MAS memory record ${record.memoryRecordId} is restricted and is not a runtime reference.`,
        warnings: [],
      };
    }

    return { effect: 'include', warnings: lifecycleWarnings };
  }

  return {
    effect: 'omit',
    decisionType: 'not_relevant',
    reason: `Memory scope ${record.scope} is not selected by Context Pack Builder v1.`,
    warnings: [],
  };
}

function selectSectionTypeForRecord(record) {
  if (record.memoryType === 'conversation_summary') {
    return 'conversation_context';
  }

  if (record.memoryType === 'runtime_evidence') {
    return 'recent_activity_summary';
  }

  if (record.memoryType === 'durable_decision') {
    return 'durable_decisions';
  }

  if (record.memoryType === 'artifact_reference') {
    return 'relevant_artifacts';
  }

  if (record.memoryType === 'policy_context') {
    return 'policy_context';
  }

  if (record.scope === 'cognitive_identity') {
    return 'cognitive_identity_memory';
  }

  if (record.scope === 'operational_identity') {
    return record.memoryType === 'human_preference'
      ? 'human_preferences'
      : 'operational_identity_memory';
  }

  if (record.memoryType === 'resource_context') {
    return 'resource_context';
  }

  if (CONTENTFUL_MEMORY_TYPES.has(record.memoryType)) {
    return 'domain_knowledge';
  }

  return null;
}

function getSectionDefinition(sectionType) {
  const definitions = {
    recent_activity_summary: {
      sectionId: 'recent-activity-summary',
      title: 'Recent Activity Summary',
      inclusionReason: 'Recent invocation state can help maintain continuity without exposing full prior brain outputs.',
      authorityLevel: 'runtime_evidence',
      priority: 90,
    },
    relevant_artifacts: {
      sectionId: 'relevant-artifacts',
      title: 'Relevant Artifact References',
      inclusionReason: 'Recent artifacts are useful references, but their raw bodies are not included by default.',
      authorityLevel: 'runtime_evidence',
      priority: 100,
    },
    domain_knowledge: {
      sectionId: 'domain-knowledge',
      title: 'Domain Knowledge',
      inclusionReason: 'MAS-owned knowledge provides relevant organizational and domain context.',
      authorityLevel: 'mas_guidance',
      priority: 50,
    },
    cognitive_identity_memory: {
      sectionId: 'cognitive-identity-memory',
      title: 'Cognitive Identity Memory',
      inclusionReason: 'Portable expert memory for the active cognitive identity set is relevant to this invocation.',
      authorityLevel: 'team_guidance',
      priority: 60,
    },
    operational_identity_memory: {
      sectionId: 'operational-identity-memory',
      title: 'Operational Identity Memory',
      inclusionReason: 'Current operational identity memory preserves lived context for this MAS instance.',
      authorityLevel: 'operational_note',
      priority: 70,
    },
    conversation_context: {
      sectionId: 'conversation-context',
      title: 'Conversation Context',
      inclusionReason: 'Bounded conversation context preserves continuity without exposing unbounded raw chat history.',
      authorityLevel: 'runtime_evidence',
      priority: 75,
    },
    policy_context: {
      sectionId: 'policy-context',
      title: 'Policy Context',
      inclusionReason: 'Policy context has higher authority than ordinary memory and can constrain the answer.',
      authorityLevel: 'policy',
      priority: 20,
    },
    durable_decisions: {
      sectionId: 'durable-decisions',
      title: 'Durable Decisions',
      inclusionReason: 'Approved durable decisions preserve reviewed MAS decisions that can shape this invocation.',
      authorityLevel: 'mas_guidance',
      priority: 25,
    },
    human_preferences: {
      sectionId: 'human-preferences',
      title: 'Human Preferences',
      inclusionReason: 'Approved human preferences can improve interaction quality when visibility allows it.',
      authorityLevel: 'operational_note',
      priority: 80,
    },
    resource_context: {
      sectionId: 'resource-context-memory',
      title: 'Resource Context',
      inclusionReason: 'Resource memory can explain available non-secret operational context.',
      authorityLevel: 'operational_note',
      priority: 35,
    },
  };

  return definitions[sectionType] ?? null;
}

function createMemorySection({ sectionType, records }) {
  if (records.length === 0) {
    return null;
  }

  const definition = getSectionDefinition(sectionType);

  if (!definition) {
    return null;
  }

  const summaries = sortMemoryRecordsForContext(records).map((record) => {
    return summarizeMemoryRecordForContext(record, {
      includeContent: record.memoryType !== 'runtime_evidence' && record.memoryType !== 'artifact_reference',
      maxContentLength: record.memoryType === 'conversation_summary'
        ? CONVERSATION_MEMORY_CONTENT_LENGTH
        : DEFAULT_MEMORY_CONTENT_LENGTH,
    });
  });
  const content = summaries.map((summary) => summary.contextText).join('\n');

  return createSection({
    ...definition,
    sectionType,
    content,
    sourceReferences: uniqueSourceReferences(summaries.flatMap((summary) => summary.sourceReferences)),
    memoryRecordIds: summaries.map((summary) => summary.memoryRecordId),
    warnings: uniqueStrings(summaries.flatMap((summary) => summary.warnings)),
  });
}

function createResourceContextSection({ readiness }) {
  const usableBindings = readiness?.usableBindings ?? [];

  if (usableBindings.length === 0) {
    return null;
  }

  const lines = usableBindings.map((binding) => {
    return [
      `- Resource: ${binding.resourceDisplayName ?? binding.resourceId}`,
      `  Resource ID: ${binding.resourceId}`,
      `  Type: ${binding.resourceType}`,
      `  Access Mode: ${binding.accessMode}`,
      `  Ownership: ${binding.ownershipScope}`,
      `  Lifecycle: ${binding.resourceLifecycleState}`,
    ].join('\n');
  });

  return createSection({
    sectionId: 'resource-context',
    sectionType: 'resource_context',
    title: 'Resource Context',
    content: lines.join('\n'),
    inclusionReason: 'Usable bindings define what non-secret resources are available to the operational identity.',
    sourceReferences: [],
    memoryRecordIds: [],
    authorityLevel: 'operational_note',
    priority: 30,
    warnings: [],
  });
}

function createBudgetDecisionForRecords({ records, reason }) {
  return records.map((record) => {
    return createDecisionForRecord({
      record,
      decisionType: 'budget_omission',
      reason,
      warnings: ['Memory was omitted by Context Pack Builder budget controls.'],
    });
  });
}

function applySectionBudget({
  candidateSections,
  maxSections,
  maxEstimatedTokens,
}) {
  const sections = [];
  const omittedSources = [];
  const warnings = [];
  let estimatedTokens = 0;

  for (const candidate of candidateSections) {
    const { section } = candidate;

    if (sections.length >= maxSections) {
      omittedSources.push(...createBudgetDecisionForRecords({
        records: candidate.records,
        reason: `Context pack reached maxSections limit (${maxSections}) before section ${section.sectionId}.`,
      }));
      warnings.push(`Context section omitted by maxSections: ${section.sectionId}`);
      continue;
    }

    const nextEstimatedTokens = estimatedTokens + section.estimatedTokens;

    if (maxEstimatedTokens !== null && nextEstimatedTokens > maxEstimatedTokens) {
      omittedSources.push(...createBudgetDecisionForRecords({
        records: candidate.records,
        reason: `Context pack reached maxEstimatedTokens limit (${maxEstimatedTokens}) before section ${section.sectionId}.`,
      }));
      warnings.push(`Context section omitted by token budget: ${section.sectionId}`);
      continue;
    }

    sections.push(section);
    estimatedTokens = nextEstimatedTokens;
  }

  return {
    sections,
    omittedSources,
    warnings,
    estimatedTokens,
  };
}

async function resolveMemoryCollection({
  bootResult,
  readiness,
  memorySourceRegistry,
  memoryCollection,
}) {
  if (memoryCollection) {
    return {
      registryPath: memoryCollection.registryPath ?? null,
      registry: memoryCollection.registry ?? null,
      usedDefaultRegistry: memoryCollection.usedDefaultRegistry ?? false,
      sourceResults: memoryCollection.sourceResults ?? [],
      memoryRecords: memoryCollection.memoryRecords ?? [],
      warnings: memoryCollection.warnings ?? [],
      summary: memoryCollection.summary ?? null,
    };
  }

  if (!bootResult?.masRootPath) {
    throw new Error('Context Pack Builder requires bootResult.masRootPath when memoryCollection is not provided.');
  }

  return collectMemoryRecordsForInvocation({
    masRootPath: bootResult.masRootPath,
    memorySourceRegistry,
    readiness,
  });
}

function buildSectionCandidates({
  invocationSummarySection,
  resourceContextSection,
  recordsBySectionType,
}) {
  const candidates = [
    {
      section: invocationSummarySection,
      records: [],
    },
  ];

  if (resourceContextSection) {
    candidates.push({
      section: resourceContextSection,
      records: [],
    });
  }

  const sectionTypes = [
    'policy_context',
    'durable_decisions',
    'resource_context',
    'recent_activity_summary',
    'relevant_artifacts',
    'domain_knowledge',
    'cognitive_identity_memory',
    'operational_identity_memory',
    'conversation_context',
    'human_preferences',
  ];

  for (const sectionType of sectionTypes) {
    const records = recordsBySectionType.get(sectionType) ?? [];
    const section = createMemorySection({ sectionType, records });

    if (!section) {
      continue;
    }

    candidates.push({
      section,
      records,
    });
  }

  return candidates.toSorted((left, right) => {
    if (left.section.priority !== right.section.priority) {
      return left.section.priority - right.section.priority;
    }

    return left.section.sectionId.localeCompare(right.section.sectionId);
  });
}

export async function buildContextPackForInvocation({
  bootResult,
  readiness,
  request,
  invocationId,
  maxSections,
  maxEstimatedTokens,
  memorySourceRegistry = null,
  memoryCollection = null,
  now = new Date(),
  includeExpiredMemory = false,
  includeStaleMemory = false,
  includeSupersededMemory = false,
} = {}) {
  if (!isNonEmptyString(invocationId)) {
    throw new Error('Context Pack Builder requires a non-empty invocationId.');
  }

  if (!request) {
    throw new Error('Context Pack Builder requires an invocation request.');
  }

  const normalizedMaxSections = normalizePositiveInteger(maxSections, DEFAULT_MAX_SECTIONS, 'maxSections');
  const normalizedMaxEstimatedTokens = normalizeMaxTokens(maxEstimatedTokens);
  const operationalIdentityId = resolveOperationalIdentityId({ readiness, request });
  const primaryCognitiveIdentityId = resolvePrimaryCognitiveIdentityId({ readiness });

  if (!isNonEmptyString(primaryCognitiveIdentityId)) {
    throw new Error('Context Pack Builder requires a primary cognitive identity.');
  }

  const secondaryCognitiveIdentityIds = resolveSecondaryCognitiveIdentityIds({ readiness });
  const activeCognitiveIdentityIds = new Set([
    primaryCognitiveIdentityId,
    ...secondaryCognitiveIdentityIds,
  ]);
  const memoryCollectionResult = await resolveMemoryCollection({
    bootResult,
    readiness,
    memorySourceRegistry,
    memoryCollection,
  });
  const normalizedRecords = memoryCollectionResult.memoryRecords.map((record) => {
    return assertMemoryRecord(record);
  });
  const supersessionResolution = resolveSupersededMemoryRecords(normalizedRecords);
  const recordsBySectionType = new Map();
  const omittedSources = [];
  const rejectedSources = [];
  const warnings = [
    ...(memoryCollectionResult.warnings ?? []),
    ...supersessionResolution.warnings,
  ];

  for (const record of normalizedRecords) {
    const eligibility = evaluateMemoryEligibility({
      record,
      activeCognitiveIdentityIds,
      operationalIdentityId,
      now,
      supersessionResolution,
      includeExpiredMemory,
      includeStaleMemory,
      includeSupersededMemory,
    });

    if (eligibility.effect === 'omit') {
      omittedSources.push(createDecisionForRecord({
        record,
        decisionType: eligibility.decisionType,
        reason: eligibility.reason,
        warnings: eligibility.warnings,
      }));
      warnings.push(...(eligibility.warnings ?? []));
      continue;
    }

    if (eligibility.effect === 'reject') {
      rejectedSources.push(createDecisionForRecord({
        record,
        decisionType: eligibility.decisionType,
        reason: eligibility.reason,
        warnings: eligibility.warnings,
      }));
      warnings.push(...(eligibility.warnings ?? []));
      continue;
    }

    warnings.push(...(eligibility.warnings ?? []));

    const sectionType = selectSectionTypeForRecord(record);

    if (!sectionType) {
      omittedSources.push(createDecisionForRecord({
        record,
        decisionType: 'not_relevant',
        reason: `Memory record ${record.memoryRecordId} did not map to a Context Pack Builder v1 section.`,
      }));
      continue;
    }

    const records = recordsBySectionType.get(sectionType) ?? [];
    records.push(record);
    recordsBySectionType.set(sectionType, records);
  }

  const invocationSummaryContent = buildInvocationSummaryContent({
    bootResult,
    readiness,
    request,
    invocationId,
    operationalIdentityId,
    primaryCognitiveIdentityId,
    secondaryCognitiveIdentityIds,
  });
  const invocationSummarySection = createSection({
    sectionId: 'invocation-summary',
    sectionType: 'invocation_summary',
    title: 'Invocation Summary',
    content: invocationSummaryContent,
    inclusionReason: 'Invocation facts are required to anchor all selected memory and context.',
    sourceReferences: [],
    memoryRecordIds: [],
    authorityLevel: 'runtime_evidence',
    priority: 10,
    warnings: [],
  });

  if (normalizedMaxEstimatedTokens !== null && invocationSummarySection.estimatedTokens > normalizedMaxEstimatedTokens) {
    throw new Error('maxEstimatedTokens is too small to include the required invocation summary.');
  }

  const candidateSections = buildSectionCandidates({
    invocationSummarySection,
    resourceContextSection: createResourceContextSection({ readiness }),
    recordsBySectionType,
  });
  const budgetedSections = applySectionBudget({
    candidateSections,
    maxSections: normalizedMaxSections,
    maxEstimatedTokens: normalizedMaxEstimatedTokens,
  });
  const sections = budgetedSections.sections;
  const includedMemoryRecordIds = new Set(sections.flatMap((section) => section.memoryRecordIds));
  const budgetOmittedMemoryRecordIds = budgetedSections.omittedSources.flatMap((decision) => decision.memoryRecordIds);
  const allOmittedSources = [
    ...omittedSources,
    ...budgetedSections.omittedSources,
  ];
  const allWarnings = uniqueStrings([
    ...warnings,
    ...budgetedSections.warnings,
  ]);

  return assertContextPack({
    kind: 'context_pack',
    version: 1,
    contextPackId: `context-pack-${invocationId.trim()}`,
    invocationId: invocationId.trim(),
    operationalIdentityId,
    primaryCognitiveIdentityId,
    secondaryCognitiveIdentityIds,
    sections,
    sourceReferences: uniqueSourceReferences(sections.flatMap((section) => section.sourceReferences)),
    omittedSources: allOmittedSources,
    rejectedSources,
    budget: {
      estimatedTokens: budgetedSections.estimatedTokens,
      maxTokens: normalizedMaxEstimatedTokens,
    },
    eligibilitySummary: {
      includedMemoryRecords: includedMemoryRecordIds.size,
      omittedMemoryRecords: omittedSources.length + budgetOmittedMemoryRecordIds.length,
      rejectedMemoryRecords: rejectedSources.reduce((total, decision) => {
        return total + decision.memoryRecordIds.length;
      }, 0),
    },
    warnings: allWarnings,
  });
}
