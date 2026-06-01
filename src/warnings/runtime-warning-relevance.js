const DEFAULT_MAX_EXAMPLES_PER_CATEGORY = 3;

const SEVERITY_ORDER = {
  action_required: 0,
  review: 1,
  info: 2,
};

const RELEVANCE_ORDER = [
  'request_impacting',
  'environment_advisory',
];

const RELEVANCE_DEFINITIONS = {
  request_impacting: {
    label: 'Request-Impacting Warnings',
    summaryLabel: 'Request Impacting',
  },
  environment_advisory: {
    label: 'Environment Advisories',
    summaryLabel: 'Environment Advisories',
  },
};

const CATEGORY_ORDER = [
  'approval',
  'permissions_access',
  'provider_secrets',
  'memory_context',
  'structure_configuration',
  'tools_workflows',
  'boot_preflight',
  'general',
];

const CATEGORY_DEFINITIONS = {
  approval: {
    label: 'Human Approval',
    defaultSeverity: 'action_required',
    adminAction: 'Review the pending/denied approval state before expecting execution to continue.',
    patterns: [
      /human approval/iu,
      /approval_required/iu,
      /requires approval/iu,
      /pending approval/iu,
      /waiting_for_approval/iu,
    ],
  },
  permissions_access: {
    label: 'Permissions & Access',
    defaultSeverity: 'action_required',
    adminAction: 'Review Operational Identity bindings, permissions.json, access modes, and resource lifecycle states.',
    patterns: [
      /permission denied/iu,
      /no allow rule found/iu,
      /defaultEffect/iu,
      /dedicated resource/iu,
      /dedicated to/iu,
      /binding state is not active/iu,
      /resource lifecycle state is not active/iu,
      /does not satisfy/iu,
      /access mode/iu,
      /belongs to a different operational identity/iu,
    ],
  },
  provider_secrets: {
    label: 'Provider & Credential Readiness',
    defaultSeverity: 'action_required',
    adminAction: 'Verify provider configuration, Credential Vault readiness, credential references, and API key readiness.',
    patterns: [
      /credential reference/iu,
      /secret is missing/iu,
      /secret values?/iu,
      /unresolved/iu,
      /missing env var/iu,
      /api key/iu,
      /provider .+ failed/iu,
      /openrouter/iu,
      /gemini/iu,
      /ollama/iu,
    ],
  },
  memory_context: {
    label: 'Memory & Context',
    defaultSeverity: 'review',
    adminAction: 'Review memory source policy, context budget, file size limits, and durable-memory eligibility.',
    patterns: [
      /memory source/iu,
      /context pack/iu,
      /context section omitted/iu,
      /durable memory/iu,
      /runtime-state/iu,
      /runtime-artifacts/iu,
      /oversized/iu,
      /omitted file/iu,
      /stale/iu,
      /expired/iu,
      /superseded/iu,
      /artifact body/iu,
      /writeback/iu,
    ],
  },
  tools_workflows: {
    label: 'Tools & Workflows',
    defaultSeverity: 'review',
    adminAction: 'Review tool/workflow readiness, runtime state, executor availability, and side-effect policies.',
    patterns: [
      /tool /iu,
      /tool\./iu,
      /workflow/iu,
      /executor/iu,
      /runtime action/iu,
      /runtime evidence/iu,
      /action claim/iu,
      /action result assessment/iu,
      /unsupported action claim/iu,
      /sideEffectLevel/iu,
      /step /iu,
    ],
  },
  structure_configuration: {
    label: 'Structure & Configuration',
    defaultSeverity: 'review',
    adminAction: 'Review file/folder layout, registries, definitions, root paths, and malformed configuration records.',
    patterns: [
      /required .* missing/iu,
      /component is missing/iu,
      /does not exist/iu,
      /not found/iu,
      /invalid/iu,
      /must match/iu,
      /rootPath/iu,
      /registry/iu,
      /definition/iu,
      /skipped invalid/iu,
      /non-directory entry/iu,
      /non-file entry/iu,
      /unsupported file extension/iu,
    ],
  },
  boot_preflight: {
    label: 'Boot & Preflight',
    defaultSeverity: 'review',
    adminAction: 'Review boot/preflight warnings before assuming the MAS instance is fully healthy.',
    patterns: [
      /boot/iu,
      /preflight/iu,
      /optional project component/iu,
      /degraded/iu,
    ],
  },
  general: {
    label: 'General Runtime Warning',
    defaultSeverity: 'review',
    adminAction: 'Inspect the persisted session and report for the full warning context.',
    patterns: [],
  },
};

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeWarnings(warnings) {
  if (!Array.isArray(warnings)) {
    return [];
  }

  return warnings
    .filter(isNonEmptyString)
    .map((warning) => warning.trim());
}

function normalizeIdentifier(value) {
  return isNonEmptyString(value) ? value.trim() : null;
}

function normalizeSourceReferenceIdentifier(value) {
  const normalizedValue = normalizeIdentifier(value);

  if (!normalizedValue) {
    return null;
  }

  const withoutTrailingPunctuation = normalizedValue.replace(/[.,;:]+$/u, '');

  return withoutTrailingPunctuation.length > 0 ? withoutTrailingPunctuation : null;
}

function isGenericSourceReference({ sourceType, sourceId }) {
  if (sourceType === 'tool' || sourceType === 'workflow') {
    return [
      'policy',
      'runtime',
      'readiness',
      'state',
    ].includes(sourceId);
  }

  return false;
}

function addIdentifier(targetSet, value) {
  const normalizedValue = normalizeIdentifier(value);

  if (normalizedValue) {
    targetSet.add(normalizedValue);
  }
}

function addMany(targetSet, values) {
  if (!Array.isArray(values)) {
    return;
  }

  for (const value of values) {
    addIdentifier(targetSet, value);
  }
}

function isExpectedRuntimePolicyNotice(warning) {
  return /runtime memory writeback candidates? (are disabled|is disabled) by (tool|workflow) policy/iu.test(warning)
    || /does not allow runtime memory writeback candidates/iu.test(warning);
}

function pickCategoryId(warning) {
  if (isExpectedRuntimePolicyNotice(warning)) {
    return 'tools_workflows';
  }

  for (const categoryId of CATEGORY_ORDER) {
    if (categoryId === 'general') {
      continue;
    }

    const definition = CATEGORY_DEFINITIONS[categoryId];

    if (definition.patterns.some((pattern) => pattern.test(warning))) {
      return categoryId;
    }
  }

  return 'general';
}

function resolveSeverity({ categoryId, warning }) {
  const normalizedWarning = warning.toLowerCase();

  if (isExpectedRuntimePolicyNotice(normalizedWarning)) {
    return 'info';
  }

  if (
    normalizedWarning.includes('skipped')
    || normalizedWarning.includes('omitted')
    || normalizedWarning.includes('artifact body was intentionally not included')
  ) {
    return categoryId === 'memory_context' ? 'info' : CATEGORY_DEFINITIONS[categoryId].defaultSeverity;
  }

  if (
    normalizedWarning.includes('failed')
    || normalizedWarning.includes('denied')
    || normalizedWarning.includes('blocked')
    || normalizedWarning.includes('missing')
    || normalizedWarning.includes('unresolved')
    || normalizedWarning.includes('not resolved')
    || normalizedWarning.includes('not active')
    || normalizedWarning.includes('requires approval')
  ) {
    return 'action_required';
  }

  return CATEGORY_DEFINITIONS[categoryId].defaultSeverity;
}

function collectMatchedBindingReferences(actionContext, verdict) {
  if (!verdict?.matchedBindings) {
    return;
  }

  for (const matchedBinding of verdict.matchedBindings) {
    addIdentifier(actionContext.requestedResourceIds, matchedBinding.resourceId);
    addIdentifier(actionContext.requestedCredentialReferenceIds, matchedBinding.credentialReferenceId);
  }
}

function collectToolContext(actionContext, resolution) {
  if (!resolution) {
    return;
  }

  addIdentifier(actionContext.requestedToolIds, resolution.requestedToolId);
  addIdentifier(actionContext.requestedToolIds, resolution.toolId);
  addIdentifier(actionContext.requestedToolIds, resolution.toolRequest?.toolId);
  collectMatchedBindingReferences(actionContext, resolution.toolReadinessVerdict);
}

function collectWorkflowContext(actionContext, resolution) {
  if (!resolution) {
    return;
  }

  addIdentifier(actionContext.requestedWorkflowIds, resolution.requestedWorkflowId);
  addIdentifier(actionContext.requestedWorkflowIds, resolution.workflowId);
  addIdentifier(actionContext.requestedWorkflowIds, resolution.workflowRequest?.workflowId);

  for (const step of resolution.workflowRuntimeDefinition?.steps ?? []) {
    if (step.stepType === 'tool_call') {
      addIdentifier(actionContext.requestedToolIds, step.toolId);
    }
  }
}

function collectProviderContext(actionContext, runtimeContext) {
  const output = runtimeContext.output ?? runtimeContext;
  const readiness = runtimeContext.readiness ?? {};
  const providerPreparation = readiness.providerPreparation ?? {};

  addIdentifier(actionContext.requestedProviderIds, output?.providerId);
  addIdentifier(actionContext.requestedProviderIds, output?.providerResponse?.providerId);
  addIdentifier(actionContext.requestedProviderIds, output?.brainOutput?.providerId);

  const selectedProvider = providerPreparation.selectedBrainProvider ?? null;
  const fallbackProvider = providerPreparation.fallbackBrainProvider ?? null;

  if (!output?.providerId && selectedProvider) {
    addIdentifier(actionContext.requestedProviderIds, selectedProvider.providerId);
    addIdentifier(actionContext.requestedResourceIds, selectedProvider.resourceId);
    addIdentifier(actionContext.requestedCredentialReferenceIds, selectedProvider.credentialReferenceId);
  }

  const finalProviderId = output?.brainExecution?.finalProviderId
    ?? runtimeContext.brainExecution?.finalProviderId
    ?? null;

  addIdentifier(actionContext.requestedProviderIds, finalProviderId);

  for (const preparedProvider of [selectedProvider, fallbackProvider]) {
    if (!preparedProvider) {
      continue;
    }

    if (
      preparedProvider.providerId === output?.providerId
      || preparedProvider.providerId === finalProviderId
      || !output?.providerId
    ) {
      addIdentifier(actionContext.requestedResourceIds, preparedProvider.resourceId);
      addIdentifier(actionContext.requestedCredentialReferenceIds, preparedProvider.credentialReferenceId);
    }
  }
}

function collectSelectedActionContext(actionContext, runtimeContext) {
  const output = runtimeContext.output ?? runtimeContext;
  const actionResolution = runtimeContext.actionResolution ?? output?.actionResolution ?? null;
  const selectedCandidate = actionResolution?.selectedCandidate ?? null;

  if (!selectedCandidate) {
    return;
  }

  actionContext.selectedAction = {
    targetType: selectedCandidate.targetType,
    targetId: selectedCandidate.targetId,
    actionType: selectedCandidate.actionType,
    runtimeAction: actionResolution.runtimeAction ?? null,
    source: actionResolution.source ?? null,
  };

  if (selectedCandidate.targetType === 'tool') {
    addIdentifier(actionContext.requestedToolIds, selectedCandidate.targetId);
  } else if (selectedCandidate.targetType === 'workflow') {
    addIdentifier(actionContext.requestedWorkflowIds, selectedCandidate.targetId);
  } else if (
    selectedCandidate.targetType === 'resource'
    || selectedCandidate.targetType === 'channel'
    || selectedCandidate.targetType === 'provider'
  ) {
    addIdentifier(actionContext.requestedResourceIds, selectedCandidate.targetId);
  }
}

function normalizeActionContextReferences(runtimeContext = null) {
  const actionContext = {
    selectedAction: null,
    requestedResourceIds: new Set(),
    requestedToolIds: new Set(),
    requestedWorkflowIds: new Set(),
    requestedProviderIds: new Set(),
    requestedCredentialReferenceIds: new Set(),
  };

  if (!runtimeContext) {
    return serializeActionContextReferences(actionContext);
  }

  const output = runtimeContext.output ?? runtimeContext;

  addMany(actionContext.requestedResourceIds, runtimeContext.requestedResourceIds);
  addMany(actionContext.requestedToolIds, runtimeContext.requestedToolIds);
  addMany(actionContext.requestedWorkflowIds, runtimeContext.requestedWorkflowIds);
  addMany(actionContext.requestedProviderIds, runtimeContext.requestedProviderIds);
  addMany(actionContext.requestedCredentialReferenceIds, runtimeContext.requestedCredentialReferenceIds);

  collectSelectedActionContext(actionContext, runtimeContext);
  collectToolContext(actionContext, runtimeContext.toolRequestResolution ?? output?.toolRequestResolution);
  collectToolContext(actionContext, runtimeContext.executedBrainToolRequest ?? output?.executedBrainToolRequest);

  addIdentifier(actionContext.requestedToolIds, runtimeContext.brainToolExecution?.requestedToolId);
  addIdentifier(actionContext.requestedToolIds, output?.brainToolExecution?.requestedToolId);
  addIdentifier(actionContext.requestedToolIds, runtimeContext.brainToolObservation?.toolId);
  addIdentifier(actionContext.requestedToolIds, output?.brainToolObservation?.toolId);

  collectWorkflowContext(actionContext, runtimeContext.workflowRequestResolution ?? output?.workflowRequestResolution);
  collectWorkflowContext(actionContext, runtimeContext.executedBrainWorkflowRequest ?? output?.executedBrainWorkflowRequest);

  addIdentifier(actionContext.requestedWorkflowIds, runtimeContext.brainWorkflowExecution?.requestedWorkflowId);
  addIdentifier(actionContext.requestedWorkflowIds, output?.brainWorkflowExecution?.requestedWorkflowId);
  addIdentifier(actionContext.requestedWorkflowIds, runtimeContext.brainWorkflowObservation?.workflowId);
  addIdentifier(actionContext.requestedWorkflowIds, output?.brainWorkflowObservation?.workflowId);

  collectProviderContext(actionContext, runtimeContext);

  return serializeActionContextReferences(actionContext);
}

function serializeActionContextReferences(actionContext) {
  return {
    selectedAction: actionContext.selectedAction,
    requestedResourceIds: [...actionContext.requestedResourceIds].sort(),
    requestedToolIds: [...actionContext.requestedToolIds].sort(),
    requestedWorkflowIds: [...actionContext.requestedWorkflowIds].sort(),
    requestedProviderIds: [...actionContext.requestedProviderIds].sort(),
    requestedCredentialReferenceIds: [...actionContext.requestedCredentialReferenceIds].sort(),
  };
}

function matchAllIdentifiers(warning, pattern) {
  return [...warning.matchAll(pattern)]
    .map((match) => normalizeIdentifier(match[1]))
    .filter((value) => value !== null);
}

function hasSourceReference(sourceReferences, sourceType, sourceId) {
  return sourceReferences.some((reference) => {
    return reference.sourceType === sourceType && reference.sourceId === sourceId;
  });
}

function addSourceReference(sourceReferences, sourceType, sourceId) {
  const normalizedSourceId = normalizeSourceReferenceIdentifier(sourceId);

  if (
    !normalizedSourceId
    || isGenericSourceReference({
      sourceType,
      sourceId: normalizedSourceId,
    })
    || hasSourceReference(sourceReferences, sourceType, normalizedSourceId)
  ) {
    return;
  }

  sourceReferences.push({
    sourceType,
    sourceId: normalizedSourceId,
  });
}

function inferProviderIdsFromWarning(warning) {
  const providerIds = new Set(matchAllIdentifiers(warning, /provider\s+([a-z0-9._:-]+)/giu));

  if (/openrouter/iu.test(warning)) {
    providerIds.add('openrouter-api');
  }

  if (/gemini/iu.test(warning)) {
    providerIds.add('gemini-api');
  }

  if (/ollama/iu.test(warning)) {
    providerIds.add('ollama-api');
  }

  return [...providerIds];
}

function extractSourceReferences({ warning, categoryId }) {
  const sourceReferences = [];

  for (const resourceId of matchAllIdentifiers(warning, /resource\s+([a-z0-9._:-]+)/giu)) {
    addSourceReference(sourceReferences, 'resource', resourceId);
  }

  for (const toolId of matchAllIdentifiers(warning, /tool\s+([a-z0-9._:-]+)/giu)) {
    addSourceReference(sourceReferences, 'tool', toolId);
  }

  for (const workflowId of matchAllIdentifiers(warning, /workflow\s+([a-z0-9._:-]+)/giu)) {
    addSourceReference(sourceReferences, 'workflow', workflowId);
  }

  for (const providerId of inferProviderIdsFromWarning(warning)) {
    addSourceReference(sourceReferences, 'provider', providerId);
  }

  for (const credentialReferenceId of matchAllIdentifiers(warning, /credential reference\s+([a-z0-9._:-]+)/giu)) {
    addSourceReference(sourceReferences, 'credential_reference', credentialReferenceId);
  }

  if (/action claim/iu.test(warning)) {
    addSourceReference(sourceReferences, 'action_claim_guard', 'action-claim-guard');
  }

  if (/action result assessment/iu.test(warning)) {
    addSourceReference(sourceReferences, 'action_result_assessment', 'action-result-assessment');
  }

  if (categoryId === 'memory_context' && sourceReferences.length === 0) {
    addSourceReference(sourceReferences, 'memory_context', 'memory-context');
  }

  if (categoryId === 'approval' && sourceReferences.length === 0) {
    addSourceReference(sourceReferences, 'human_approval', 'human-approval');
  }

  return sourceReferences;
}

function hasIntersectingReference({ sourceReferences, sourceType, contextIds }) {
  if (!Array.isArray(contextIds) || contextIds.length === 0) {
    return false;
  }

  const contextIdSet = new Set(contextIds);

  return sourceReferences.some((reference) => {
    return reference.sourceType === sourceType && contextIdSet.has(reference.sourceId);
  });
}

function hasOnlyKnownExternalReferences(sourceReferences, sourceTypes) {
  const sourceTypeSet = new Set(sourceTypes);
  const scopedReferences = sourceReferences.filter((reference) => {
    return sourceTypeSet.has(reference.sourceType);
  });

  return scopedReferences.length > 0 && scopedReferences.length === sourceReferences.length;
}

function resolveRelevance({
  categoryId,
  warning,
  sourceReferences,
  actionContextReferences,
  runtimeContext,
}) {
  if (!runtimeContext) {
    return 'request_impacting';
  }

  if (categoryId === 'approval') {
    return 'request_impacting';
  }

  if (
    sourceReferences.some((reference) => {
      return reference.sourceType === 'action_claim_guard'
        || reference.sourceType === 'action_result_assessment';
    })
  ) {
    return 'request_impacting';
  }

  if (categoryId === 'permissions_access') {
    const sourceTypes = ['resource'];
    const hasResourceContext = actionContextReferences.requestedResourceIds.length > 0;

    if (
      hasResourceContext
      && hasOnlyKnownExternalReferences(sourceReferences, sourceTypes)
      && !hasIntersectingReference({
        sourceReferences,
        sourceType: 'resource',
        contextIds: actionContextReferences.requestedResourceIds,
      })
    ) {
      return 'environment_advisory';
    }
  }

  if (categoryId === 'tools_workflows') {
    const knownToolOrWorkflowReferences = sourceReferences.filter((reference) => {
      return reference.sourceType === 'tool' || reference.sourceType === 'workflow';
    });
    const hasToolOrWorkflowContext = actionContextReferences.requestedToolIds.length > 0
      || actionContextReferences.requestedWorkflowIds.length > 0;

    if (
      hasToolOrWorkflowContext
      && knownToolOrWorkflowReferences.length > 0
      && !hasIntersectingReference({
        sourceReferences,
        sourceType: 'tool',
        contextIds: actionContextReferences.requestedToolIds,
      })
      && !hasIntersectingReference({
        sourceReferences,
        sourceType: 'workflow',
        contextIds: actionContextReferences.requestedWorkflowIds,
      })
    ) {
      return 'environment_advisory';
    }
  }

  if (categoryId === 'provider_secrets') {
    const providerOrCredentialReferences = sourceReferences.filter((reference) => {
      return reference.sourceType === 'provider' || reference.sourceType === 'credential_reference' || reference.sourceType === 'resource';
    });
    const hasProviderCredentialOrResourceContext = actionContextReferences.requestedProviderIds.length > 0
      || actionContextReferences.requestedCredentialReferenceIds.length > 0
      || actionContextReferences.requestedResourceIds.length > 0;

    if (
      hasProviderCredentialOrResourceContext
      && providerOrCredentialReferences.length > 0
      && !hasIntersectingReference({
        sourceReferences,
        sourceType: 'provider',
        contextIds: actionContextReferences.requestedProviderIds,
      })
      && !hasIntersectingReference({
        sourceReferences,
        sourceType: 'credential_reference',
        contextIds: actionContextReferences.requestedCredentialReferenceIds,
      })
      && !hasIntersectingReference({
        sourceReferences,
        sourceType: 'resource',
        contextIds: actionContextReferences.requestedResourceIds,
      })
    ) {
      return 'environment_advisory';
    }
  }

  if (
    isExpectedRuntimePolicyNotice(warning)
    && sourceReferences.length > 0
    && (
      actionContextReferences.requestedToolIds.length > 0
      || actionContextReferences.requestedWorkflowIds.length > 0
    )
    && !hasIntersectingReference({
      sourceReferences,
      sourceType: 'tool',
      contextIds: actionContextReferences.requestedToolIds,
    })
    && !hasIntersectingReference({
      sourceReferences,
      sourceType: 'workflow',
      contextIds: actionContextReferences.requestedWorkflowIds,
    })
  ) {
    return 'environment_advisory';
  }

  return 'request_impacting';
}

function compareSeverity(left, right) {
  return SEVERITY_ORDER[left] - SEVERITY_ORDER[right];
}

function compareRelevance(left, right) {
  return RELEVANCE_ORDER.indexOf(left) - RELEVANCE_ORDER.indexOf(right);
}

function summarizeSeverityCounts(classifiedWarnings) {
  return classifiedWarnings.reduce((counts, classifiedWarning) => {
    counts[classifiedWarning.severity] = (counts[classifiedWarning.severity] ?? 0) + 1;
    return counts;
  }, {
    action_required: 0,
    review: 0,
    info: 0,
  });
}

function summarizeRelevanceCounts(classifiedWarnings) {
  return classifiedWarnings.reduce((counts, classifiedWarning) => {
    counts[classifiedWarning.relevance] = (counts[classifiedWarning.relevance] ?? 0) + 1;
    return counts;
  }, {
    request_impacting: 0,
    environment_advisory: 0,
  });
}

function mergeGroupSourceReferences(group, sourceReferences) {
  for (const sourceReference of sourceReferences) {
    addSourceReference(group.sourceReferences, sourceReference.sourceType, sourceReference.sourceId);
  }
}

function buildCategoryGroups(classifiedWarnings) {
  const groupsByCategoryId = new Map();

  for (const classifiedWarning of classifiedWarnings) {
    const groupKey = `${classifiedWarning.relevance}:${classifiedWarning.categoryId}`;
    const existingGroup = groupsByCategoryId.get(groupKey);

    if (existingGroup) {
      existingGroup.warnings.push(classifiedWarning.warning);
      existingGroup.severity = compareSeverity(classifiedWarning.severity, existingGroup.severity) < 0
        ? classifiedWarning.severity
        : existingGroup.severity;
      mergeGroupSourceReferences(existingGroup, classifiedWarning.sourceReferences);
      continue;
    }

    const definition = CATEGORY_DEFINITIONS[classifiedWarning.categoryId];

    groupsByCategoryId.set(groupKey, {
      categoryId: classifiedWarning.categoryId,
      label: definition.label,
      relevance: classifiedWarning.relevance,
      relevanceLabel: RELEVANCE_DEFINITIONS[classifiedWarning.relevance].label,
      severity: classifiedWarning.severity,
      adminAction: definition.adminAction,
      sourceReferences: [...classifiedWarning.sourceReferences],
      actionContextReferences: classifiedWarning.actionContextReferences,
      warnings: [classifiedWarning.warning],
    });
  }

  return [...groupsByCategoryId.values()].sort((left, right) => {
    const relevanceComparison = compareRelevance(left.relevance, right.relevance);

    if (relevanceComparison !== 0) {
      return relevanceComparison;
    }

    const severityComparison = compareSeverity(left.severity, right.severity);

    if (severityComparison !== 0) {
      return severityComparison;
    }

    return CATEGORY_ORDER.indexOf(left.categoryId) - CATEGORY_ORDER.indexOf(right.categoryId);
  });
}

export function classifyRuntimeWarning(warning, {
  runtimeContext = null,
  actionContextReferences = null,
} = {}) {
  if (!isNonEmptyString(warning)) {
    throw new Error('Warning classification requires a non-empty warning string.');
  }

  const normalizedWarning = warning.trim();
  const categoryId = pickCategoryId(normalizedWarning);
  const definition = CATEGORY_DEFINITIONS[categoryId];
  const normalizedActionContextReferences = actionContextReferences ?? normalizeActionContextReferences(runtimeContext);
  const sourceReferences = extractSourceReferences({
    warning: normalizedWarning,
    categoryId,
  });
  const severity = resolveSeverity({
    categoryId,
    warning: normalizedWarning,
  });
  const relevance = resolveRelevance({
    categoryId,
    warning: normalizedWarning,
    sourceReferences,
    actionContextReferences: normalizedActionContextReferences,
    runtimeContext,
  });

  return {
    warning: normalizedWarning,
    categoryId,
    categoryLabel: definition.label,
    severity,
    relevance,
    relevanceLabel: RELEVANCE_DEFINITIONS[relevance].label,
    adminAction: definition.adminAction,
    sourceReferences,
    actionContextReferences: normalizedActionContextReferences,
  };
}

export function buildRuntimeWarningRelevance(warnings, {
  runtimeContext = null,
} = {}) {
  const normalizedWarnings = normalizeWarnings(warnings);
  const actionContextReferences = normalizeActionContextReferences(runtimeContext);
  const classifiedWarnings = normalizedWarnings.map((warning) => {
    return classifyRuntimeWarning(warning, {
      runtimeContext,
      actionContextReferences,
    });
  });

  return {
    kind: 'runtime_warning_relevance',
    version: 2,
    totalWarnings: classifiedWarnings.length,
    severityCounts: summarizeSeverityCounts(classifiedWarnings),
    relevanceCounts: summarizeRelevanceCounts(classifiedWarnings),
    requestImpactingWarnings: classifiedWarnings.filter((classifiedWarning) => {
      return classifiedWarning.relevance === 'request_impacting';
    }),
    environmentAdvisoryWarnings: classifiedWarnings.filter((classifiedWarning) => {
      return classifiedWarning.relevance === 'environment_advisory';
    }),
    classifiedWarnings,
    groups: buildCategoryGroups(classifiedWarnings),
    actionContextReferences,
  };
}

export function buildWarningTaxonomy(warnings, {
  runtimeContext = null,
} = {}) {
  const warningRelevance = buildRuntimeWarningRelevance(warnings, {
    runtimeContext,
  });

  return {
    kind: 'warning_taxonomy',
    version: 1,
    totalWarnings: warningRelevance.totalWarnings,
    severityCounts: warningRelevance.severityCounts,
    relevanceCounts: warningRelevance.relevanceCounts,
    groups: warningRelevance.groups,
  };
}

export function formatRuntimeWarningRelevanceForCli(warningRelevance, {
  maxExamplesPerCategory = DEFAULT_MAX_EXAMPLES_PER_CATEGORY,
} = {}) {
  if (!isPlainObject(warningRelevance)) {
    throw new Error('Runtime warning relevance formatter requires a warning relevance object.');
  }

  if (warningRelevance.totalWarnings === 0) {
    return [];
  }

  const lines = [
    'Warnings:',
    `  Total: ${warningRelevance.totalWarnings} | ${RELEVANCE_DEFINITIONS.request_impacting.summaryLabel}: ${warningRelevance.relevanceCounts.request_impacting} | ${RELEVANCE_DEFINITIONS.environment_advisory.summaryLabel}: ${warningRelevance.relevanceCounts.environment_advisory}`,
    `  Severity: Action Required: ${warningRelevance.severityCounts.action_required} | Review: ${warningRelevance.severityCounts.review} | Info: ${warningRelevance.severityCounts.info}`,
  ];

  for (const relevance of RELEVANCE_ORDER) {
    const groups = warningRelevance.groups.filter((group) => {
      return group.relevance === relevance;
    });

    if (groups.length === 0) {
      continue;
    }

    lines.push(`  ${RELEVANCE_DEFINITIONS[relevance].label}:`);

    for (const group of groups) {
      lines.push(`    ${group.label} [${group.severity}] (${group.warnings.length})`);
      lines.push(`      Admin Action: ${group.adminAction}`);

      const visibleWarnings = group.warnings.slice(0, maxExamplesPerCategory);
      const hiddenWarningCount = group.warnings.length - visibleWarnings.length;

      for (const warning of visibleWarnings) {
        lines.push(`      - ${warning}`);
      }

      if (hiddenWarningCount > 0) {
        lines.push(`      - ${hiddenWarningCount} additional warning(s) omitted from CLI summary; inspect the invocation session for full details.`);
      }
    }
  }

  return lines;
}

export function formatWarningTaxonomyForCli(warnings, {
  maxExamplesPerCategory = DEFAULT_MAX_EXAMPLES_PER_CATEGORY,
  runtimeContext = null,
} = {}) {
  return formatRuntimeWarningRelevanceForCli(
    buildRuntimeWarningRelevance(warnings, {
      runtimeContext,
    }),
    {
      maxExamplesPerCategory,
    },
  );
}

export const classifyWarning = classifyRuntimeWarning;
