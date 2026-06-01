import { readFile } from 'node:fs/promises';
import { resolveBoundedChildPath } from '../contracts/shared/bounded-path-contract.js';
import { assertIntentResolution } from '../contracts/actions/intent-resolution-contract.js';
import { resolveBrainToolRequestForInvocation } from '../tools/resolve-brain-tool-request-for-invocation.js';
import { resolveBrainWorkflowRequestForInvocation } from '../workflows/resolve-brain-workflow-request-for-invocation.js';
import {
  buildSemanticNoActionIntent,
  classifyActionIntentForInvocation,
} from './classify-action-intent-for-invocation.js';
import { classifyActionIntentWithProvider } from './provider-backed-action-intent-classifier.js';
import { readActionAffordancesForInvocation } from './read-action-affordances-for-invocation.js';
import { resolveActionForInvocation } from './resolve-action-for-invocation.js';

const SEMANTIC_INTENT_RUNTIME_VERSION = 1;
const MAX_RECENT_CONVERSATION_TURNS = 8;
const MAX_TURN_TEXT_LENGTH = 360;

const EXPLICIT_RESOLUTION_CONSUMING_STATUSES = new Set([
  'accepted',
  'plan_only',
  'approval_required',
  'denied',
  'invalid',
]);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function uniqueStrings(values) {
  const seenValues = new Set();
  const normalizedValues = [];

  for (const value of values) {
    if (!isNonEmptyString(value)) {
      continue;
    }

    const normalizedValue = value.trim();

    if (seenValues.has(normalizedValue)) {
      continue;
    }

    seenValues.add(normalizedValue);
    normalizedValues.push(normalizedValue);
  }

  return normalizedValues;
}

function samePreparedProvider(left, right) {
  if (!left || !right) {
    return false;
  }

  return left.providerId === right.providerId
    && left.modelId === right.modelId
    && left.credentialReferenceId === right.credentialReferenceId;
}

function resolveSemanticClassifierFailureCategory(classificationResult) {
  return classificationResult?.providerFailureCategory
    ?? classificationResult?.providerClassifierAudit?.providerFailureCategory
    ?? classificationResult?.providerClassifierAudit?.providerResponse?.providerFailure?.category
    ?? null;
}

function tagProviderClassifierAttempts(providerClassifierAudit, preparedProvider, phase) {
  if (!Array.isArray(providerClassifierAudit?.attempts)) {
    return [];
  }

  return providerClassifierAudit.attempts.map((attempt) => {
    return {
      ...attempt,
      providerId: preparedProvider?.providerId ?? null,
      modelId: preparedProvider?.modelId ?? null,
      phase,
    };
  });
}

function mergeSemanticClassifierProviderResults({
  primaryResult,
  fallbackResult,
  primaryPreparedProvider,
  fallbackPreparedProvider,
}) {
  const primaryAudit = primaryResult?.providerClassifierAudit ?? null;
  const fallbackAudit = fallbackResult?.providerClassifierAudit ?? null;
  const fallbackSucceeded = fallbackResult?.status === 'completed';

  return {
    ...fallbackResult,
    warnings: fallbackSucceeded
      ? [
        ...(fallbackResult?.warnings ?? []),
      ]
      : uniqueStrings([
        ...(primaryResult?.warnings ?? []),
        ...(fallbackResult?.warnings ?? []),
      ]),
    providerClassifierAudit: fallbackAudit
      ? {
        ...fallbackAudit,
        attempts: [
          ...tagProviderClassifierAttempts(primaryAudit, primaryPreparedProvider, 'primary'),
          ...tagProviderClassifierAttempts(fallbackAudit, fallbackPreparedProvider, 'fallback'),
        ],
        providerFailureCategory: fallbackSucceeded
          ? null
          : (fallbackAudit.providerFailureCategory ?? primaryAudit?.providerFailureCategory ?? null),
        failureKind: fallbackSucceeded
          ? null
          : (fallbackAudit.failureKind ?? primaryAudit?.failureKind ?? null),
        fallbackModeUsed: fallbackSucceeded
          ? 'fallback_provider'
          : (fallbackAudit.fallbackModeUsed ?? 'safe_clarification'),
        warnings: uniqueStrings([
          ...(primaryAudit?.warnings ?? []),
          ...(fallbackAudit?.warnings ?? []),
        ]),
      }
      : primaryAudit,
  };
}

function shouldRetrySemanticClassificationWithFallback({
  primaryResult,
  primaryPreparedProvider,
  fallbackPreparedProvider,
}) {
  if (!primaryPreparedProvider || primaryPreparedProvider.status !== 'ready') {
    return false;
  }

  if (!fallbackPreparedProvider || fallbackPreparedProvider.status !== 'ready') {
    return false;
  }

  if (samePreparedProvider(primaryPreparedProvider, fallbackPreparedProvider)) {
    return false;
  }

  if (primaryResult?.status === 'completed') {
    return false;
  }

  if (primaryResult?.failureKind !== 'provider_failure') {
    return false;
  }

  return resolveSemanticClassifierFailureCategory(primaryResult) === 'empty_output';
}

function truncateText(value, maxLength = MAX_TURN_TEXT_LENGTH) {
  if (!isNonEmptyString(value)) {
    return '';
  }

  const normalizedValue = value.trim();

  if (normalizedValue.length <= maxLength) {
    return normalizedValue;
  }

  return `${normalizedValue.slice(0, maxLength - 3)}...`;
}

function normalizeMode(mode) {
  if (mode === undefined || mode === null) {
    return 'disabled';
  }

  if (!isNonEmptyString(mode)) {
    throw new Error('Semantic intent runtime mode must be a non-empty string.');
  }

  const normalizedMode = mode.trim();

  if (!['disabled', 'adapter', 'provider'].includes(normalizedMode)) {
    throw new Error(`Semantic intent runtime mode is invalid: ${normalizedMode}`);
  }

  return normalizedMode;
}

function explicitResolutionConsumesRequest(resolution) {
  return EXPLICIT_RESOLUTION_CONSUMING_STATUSES.has(resolution?.status);
}

function createSyntheticBrainOutput({ outputText }) {
  return {
    executionType: 'probabilistic_brain',
    providerId: 'semantic-intent-runtime',
    modelId: 'semantic-intent-orchestrator',
    requestType: 'runtime_action_envelope',
    status: 'completed',
    outputText,
    finishReason: 'semantic_intent_runtime',
    providerResponseId: 'semantic-intent-runtime',
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
    },
    warnings: [],
  };
}

function normalizeRuntimeInput(value) {
  return isPlainObject(value) ? { ...value } : {};
}

function buildSyntheticToolRequestFromCandidate({
  candidate,
  invocationId,
}) {
  return {
    kind: 'brain_tool_request',
    version: 1,
    toolRequestId: `semantic-tool-${invocationId}`,
    toolId: candidate.targetId,
    input: normalizeRuntimeInput(candidate.metadata.runtimeInput),
    purpose: `Semantic intent runtime selected tool ${candidate.targetId}: ${candidate.reason}`,
    expectedSideEffectLevel: candidate.sideEffectLevel,
  };
}

function buildSyntheticWorkflowRequestFromCandidate({
  candidate,
  invocationId,
}) {
  return {
    kind: 'brain_workflow_request',
    version: 1,
    workflowRequestId: `semantic-workflow-${invocationId}`,
    workflowId: candidate.targetId,
    input: normalizeRuntimeInput(candidate.metadata.runtimeInput),
    purpose: `Semantic intent runtime selected workflow ${candidate.targetId}: ${candidate.reason}`,
    expectedSideEffectLevel: candidate.sideEffectLevel,
  };
}

function resolveSyntheticToolRequest({
  toolRequest,
  toolReadinessEvaluation,
}) {
  return resolveBrainToolRequestForInvocation({
    brainOutput: createSyntheticBrainOutput({
      outputText: JSON.stringify(toolRequest),
    }),
    toolReadinessEvaluation,
  });
}

function resolveSyntheticWorkflowRequest({
  workflowRequest,
  workflowRuntimeDefinitions,
}) {
  return resolveBrainWorkflowRequestForInvocation({
    brainOutput: createSyntheticBrainOutput({
      outputText: JSON.stringify(workflowRequest),
    }),
    workflowRuntimeDefinitions,
  });
}

function toIntentResolutionFromActionResolution({
  semanticIntentClassification,
  actionResolution,
}) {
  const actionIntent = semanticIntentClassification?.actionIntent ?? null;

  if (!actionIntent) {
    return assertIntentResolution({
      kind: 'intent_resolution',
      version: 1,
      status: 'skipped',
      intentId: null,
      intentType: null,
      source: 'none',
      confidence: null,
      target: null,
      runtimeAction: 'none',
      reason: 'Semantic intent runtime did not produce an action intent.',
      evidence: [],
      warnings: [],
    });
  }

  if (
    (actionResolution.status === 'accepted' || actionResolution.status === 'plan_only')
    && actionResolution.selectedCandidate
  ) {
    return assertIntentResolution({
      kind: 'intent_resolution',
      version: 1,
      status: 'resolved',
      intentId: actionIntent.intentId,
      intentType: actionIntent.intentType,
      source: 'semantic_classifier',
      confidence: toLegacyIntentConfidence(actionIntent.confidence),
      target: {
        targetType: actionResolution.selectedCandidate.targetType,
        targetId: actionResolution.selectedCandidate.targetId,
      },
      runtimeAction: actionResolution.runtimeAction,
      reason: actionResolution.reason,
      evidence: actionIntent.evidence,
      warnings: actionResolution.warnings,
    });
  }

  if (['ambiguous', 'needs_clarification'].includes(actionResolution.status)) {
    return assertIntentResolution({
      kind: 'intent_resolution',
      version: 1,
      status: 'ambiguous',
      intentId: actionIntent.intentId,
      intentType: actionIntent.intentType,
      source: 'semantic_classifier',
      confidence: toLegacyIntentConfidence(actionIntent.confidence),
      target: null,
      runtimeAction: 'ask_clarification',
      reason: actionResolution.reason,
      evidence: actionIntent.evidence,
      warnings: actionResolution.warnings,
    });
  }

  if (actionResolution.status === 'denied') {
    return assertIntentResolution({
      kind: 'intent_resolution',
      version: 1,
      status: 'blocked',
      intentId: actionIntent.intentId,
      intentType: actionIntent.intentType,
      source: 'semantic_classifier',
      confidence: toLegacyIntentConfidence(actionIntent.confidence),
      target: actionResolution.selectedCandidate
        ? {
          targetType: actionResolution.selectedCandidate.targetType,
          targetId: actionResolution.selectedCandidate.targetId,
        }
        : null,
      runtimeAction: 'reject',
      reason: actionResolution.reason,
      evidence: actionIntent.evidence,
      warnings: actionResolution.warnings,
    });
  }

  return assertIntentResolution({
    kind: 'intent_resolution',
    version: 1,
    status: 'no_intent',
    intentId: null,
    intentType: null,
    source: 'none',
    confidence: null,
    target: null,
    runtimeAction: 'none',
    reason: actionResolution.reason,
    evidence: [],
    warnings: actionResolution.warnings,
  });
}

function toLegacyIntentConfidence(confidence) {
  if (confidence === 'exact') {
    return 'high';
  }

  if (['high', 'medium', 'low'].includes(confidence)) {
    return confidence;
  }

  return null;
}

function buildSkippedRuntime({
  mode,
  reason,
  request,
  toolRequestResolution,
  workflowRequestResolution,
}) {
  const actionResolution = resolveActionForInvocation({
    request,
    toolRequestResolution,
    workflowRequestResolution,
  });

  return {
    kind: 'semantic_intent_runtime',
    version: SEMANTIC_INTENT_RUNTIME_VERSION,
    status: 'skipped',
    mode,
    reason,
    actionAffordanceReadResult: null,
    semanticIntentClassification: null,
    providerClassifierAudit: null,
    actionResolution,
    intentResolution: assertIntentResolution({
      kind: 'intent_resolution',
      version: 1,
      status: 'skipped',
      intentId: null,
      intentType: null,
      source: 'none',
      confidence: null,
      target: null,
      runtimeAction: 'none',
      reason,
      evidence: [],
      warnings: [],
    }),
    toolRequestResolution,
    workflowRequestResolution,
    conversationContextSummary: null,
    warnings: [],
  };
}

async function readRecentConversationTurns({
  masRootPath,
  conversationContext,
}) {
  if (!conversationContext?.conversationId) {
    return {
      conversationContextSummary: null,
      warnings: [],
    };
  }

  const turnsRecordPath = conversationContext.turnsRecordPath
    ?? resolveBoundedChildPath({
      parentRootPath: masRootPath,
      childRootPath: `memory/state/conversations/${conversationContext.conversationId}/turns.json`,
      description: 'Semantic intent runtime conversation turns path',
    });

  try {
    const turns = JSON.parse(await readFile(turnsRecordPath, 'utf8'));
    const normalizedTurns = Array.isArray(turns) ? turns : [];
    const recentTurns = normalizedTurns.slice(-MAX_RECENT_CONVERSATION_TURNS).map((turn) => {
      return {
        sequenceNumber: turn.sequenceNumber ?? null,
        role: turn.role ?? null,
        speakerId: turn.speaker?.speakerId ?? null,
        speakerType: turn.speaker?.speakerType ?? null,
        invocationId: turn.invocationId ?? null,
        text: truncateText(turn.content?.text),
        runtimeReferences: Array.isArray(turn.runtimeReferences)
          ? turn.runtimeReferences.map((reference) => {
            return {
              referenceType: reference.referenceType,
              referenceId: reference.referenceId,
            };
          })
          : [],
      };
    });

    return {
      conversationContextSummary: {
        conversationId: conversationContext.conversationId,
        resolutionType: conversationContext.resolutionType ?? null,
        totalTurnCount: normalizedTurns.length,
        includedTurnCount: recentTurns.length,
        recentTurns,
      },
      warnings: [],
    };
  } catch (error) {
    return {
      conversationContextSummary: {
        conversationId: conversationContext.conversationId,
        resolutionType: conversationContext.resolutionType ?? null,
        totalTurnCount: null,
        includedTurnCount: 0,
        recentTurns: [],
      },
      warnings: [
        `Semantic intent runtime could not read conversation turns: ${error.message}`,
      ],
    };
  }
}

function buildClassifierRequest({
  request,
  readiness,
  conversationContextSummary,
}) {
  return {
    originalInput: request.inputText,
    inputText: request.inputText,
    command: request.command,
    conversationId: request.conversationId ?? null,
    metadata: {
      operationalIdentityId: readiness?.operationalIdentityDefinition?.operationalIdentityId ?? null,
      operationalDisplayName: readiness?.operationalIdentityDefinition?.displayName ?? null,
      primaryCognitiveIdentityId: readiness?.activeCognitiveSet?.primaryCognitiveIdentityId ?? null,
      secondaryCognitiveIdentityIds: readiness?.activeCognitiveSet?.secondaryCognitiveIdentityIds ?? [],
      conversationContext: conversationContextSummary,
    },
  };
}

async function classifySemanticIntent({
  mode,
  request,
  actionAffordances,
  classifierAdapter,
  classifierId,
  preparedProvider,
  fallbackPreparedProvider,
  secretResolution,
  fetchImplementation,
}) {
  if (mode === 'adapter') {
    return classifyActionIntentForInvocation({
      request,
      actionAffordances,
      classifierAdapter,
      classifierId,
    });
  }

  if (mode === 'provider') {
    const primaryPreparedProvider = preparedProvider?.status === 'ready'
      ? preparedProvider
      : null;
    const secondaryPreparedProvider = (
      fallbackPreparedProvider?.status === 'ready'
      && !samePreparedProvider(preparedProvider, fallbackPreparedProvider)
    )
      ? fallbackPreparedProvider
      : null;
    const effectivePreparedProvider = primaryPreparedProvider ?? secondaryPreparedProvider;

    if (!effectivePreparedProvider) {
      const actionIntent = buildSemanticNoActionIntent({
        request,
        reason: 'No ready provider was available for semantic intent classification.',
        summary: 'The runtime could not classify the request semantically because no classifier provider was ready.',
        warnings: [
          'Semantic intent runtime skipped provider-backed classification because no ready provider was available.',
        ],
      });

      return {
        kind: 'semantic_intent_classification_result',
        version: 1,
        status: 'skipped',
        classifierId,
        classifierRequest: null,
        actionIntent,
        providerClassifierAudit: null,
        warnings: actionIntent.warnings,
      };
    }

    const primaryResult = await classifyActionIntentWithProvider({
      request,
      actionAffordances,
      preparedProvider: effectivePreparedProvider,
      secretResolution,
      fetchImplementation,
      classifierId,
    });

    if (!shouldRetrySemanticClassificationWithFallback({
      primaryResult,
      primaryPreparedProvider,
      fallbackPreparedProvider: secondaryPreparedProvider,
    })) {
      return primaryResult;
    }

    const fallbackResult = await classifyActionIntentWithProvider({
      request,
      actionAffordances,
      preparedProvider: secondaryPreparedProvider,
      secretResolution,
      fetchImplementation,
      classifierId,
    });

    return mergeSemanticClassifierProviderResults({
      primaryResult,
      fallbackResult,
      primaryPreparedProvider,
      fallbackPreparedProvider: secondaryPreparedProvider,
    });
  }

  return null;
}

function shouldSynthesizeRuntimeEnvelope(actionResolution) {
  return actionResolution.status === 'accepted'
    && actionResolution.executionAllowed
    && ['tool', 'workflow'].includes(actionResolution.selectedCandidate?.targetType);
}

function synthesizeRuntimeEnvelopeFromSemanticAction({
  actionResolution,
  invocationId,
  toolReadinessEvaluation,
  workflowRuntimeDefinitions,
}) {
  if (!shouldSynthesizeRuntimeEnvelope(actionResolution)) {
    return {
      toolRequestResolution: null,
      workflowRequestResolution: null,
    };
  }

  const candidate = actionResolution.selectedCandidate;

  if (candidate.targetType === 'tool') {
    const toolRequest = buildSyntheticToolRequestFromCandidate({
      candidate,
      invocationId,
    });

    return {
      toolRequestResolution: resolveSyntheticToolRequest({
        toolRequest,
        toolReadinessEvaluation,
      }),
      workflowRequestResolution: null,
    };
  }

  const workflowRequest = buildSyntheticWorkflowRequestFromCandidate({
    candidate,
    invocationId,
  });

  return {
    toolRequestResolution: null,
    workflowRequestResolution: resolveSyntheticWorkflowRequest({
      workflowRequest,
      workflowRuntimeDefinitions,
    }),
  };
}

export async function runSemanticIntentRuntimeForInvocation({
  invocationId,
  masRootPath = null,
  request,
  readiness,
  toolRequestResolution = null,
  workflowRequestResolution = null,
  workflowRuntimeDefinitions = [],
  mode = 'disabled',
  classifierAdapter = null,
  classifierId = 'semantic-intent-runtime-classifier',
  preparedProvider = null,
  fallbackPreparedProvider = null,
  secretResolution = null,
  fetchImplementation = null,
  actionAffordanceReadResult = null,
  skipReason = null,
} = {}) {
  const normalizedMode = normalizeMode(mode);
  const normalizedSkipReason = isNonEmptyString(skipReason)
    ? skipReason.trim()
    : null;

  if (normalizedMode === 'disabled') {
    return buildSkippedRuntime({
      mode: normalizedMode,
      reason: 'Semantic intent runtime is disabled for this invocation.',
      request,
      toolRequestResolution,
      workflowRequestResolution,
    });
  }

  if (normalizedSkipReason) {
    return buildSkippedRuntime({
      mode: normalizedMode,
      reason: normalizedSkipReason,
      request,
      toolRequestResolution,
      workflowRequestResolution,
    });
  }

  if (
    explicitResolutionConsumesRequest(toolRequestResolution)
    || explicitResolutionConsumesRequest(workflowRequestResolution)
  ) {
    return buildSkippedRuntime({
      mode: normalizedMode,
      reason: 'Semantic intent runtime skipped because an explicit tool or workflow request already consumed the invocation.',
      request,
      toolRequestResolution,
      workflowRequestResolution,
    });
  }

  const conversationRead = await readRecentConversationTurns({
    masRootPath,
    conversationContext: readiness?.conversationContext,
  });
  const affordanceReadResult = actionAffordanceReadResult
    ?? await readActionAffordancesForInvocation({
      masRootPath,
      toolReadinessEvaluation: readiness?.toolReadiness ?? null,
    });
  const classifierRequest = buildClassifierRequest({
    request,
    readiness,
    conversationContextSummary: conversationRead.conversationContextSummary,
  });
  const semanticIntentClassification = await classifySemanticIntent({
    mode: normalizedMode,
    request: classifierRequest,
    actionAffordances: affordanceReadResult.actionAffordances,
    classifierAdapter,
    classifierId,
    preparedProvider,
    fallbackPreparedProvider,
    secretResolution,
    fetchImplementation,
  });
  const actionResolution = resolveActionForInvocation({
    request,
    toolRequestResolution,
    workflowRequestResolution,
    semanticIntentClassification,
  });
  const synthesizedResolutions = synthesizeRuntimeEnvelopeFromSemanticAction({
    actionResolution,
    invocationId,
    toolReadinessEvaluation: readiness?.toolReadiness ?? null,
    workflowRuntimeDefinitions,
  });
  const resolvedToolRequestResolution = synthesizedResolutions.toolRequestResolution
    ?? toolRequestResolution;
  const resolvedWorkflowRequestResolution = synthesizedResolutions.workflowRequestResolution
    ?? workflowRequestResolution;
  const effectiveActionResolution = (
    synthesizedResolutions.toolRequestResolution?.status === 'denied'
    || synthesizedResolutions.workflowRequestResolution?.status === 'denied'
  )
    ? resolveActionForInvocation({
      request,
      toolRequestResolution: resolvedToolRequestResolution,
      workflowRequestResolution: resolvedWorkflowRequestResolution,
      semanticIntentClassification,
    })
    : actionResolution;
  const intentResolution = toIntentResolutionFromActionResolution({
    semanticIntentClassification,
    actionResolution: effectiveActionResolution,
  });
  const warnings = uniqueStrings([
    ...conversationRead.warnings,
    ...(affordanceReadResult.warnings ?? []),
    ...(semanticIntentClassification?.warnings ?? []),
    ...(effectiveActionResolution.warnings ?? []),
  ]);

  return {
    kind: 'semantic_intent_runtime',
    version: SEMANTIC_INTENT_RUNTIME_VERSION,
    status: semanticIntentClassification?.status ?? 'skipped',
    mode: normalizedMode,
    reason: effectiveActionResolution.reason,
    actionAffordanceReadResult: affordanceReadResult,
    semanticIntentClassification,
    providerClassifierAudit: semanticIntentClassification?.providerClassifierAudit ?? null,
    actionResolution: effectiveActionResolution,
    intentResolution,
    toolRequestResolution: resolvedToolRequestResolution,
    workflowRequestResolution: resolvedWorkflowRequestResolution,
    conversationContextSummary: conversationRead.conversationContextSummary,
    warnings,
  };
}
