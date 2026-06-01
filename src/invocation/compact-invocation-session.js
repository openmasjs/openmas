const DEFAULT_PREVIEW_MAX_LENGTH = 240;
const DEFAULT_WARNING_LIMIT = 8;

function getJsonSizeBytes(value) {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

function truncateText(value, maxLength = DEFAULT_PREVIEW_MAX_LENGTH) {
  if (typeof value !== 'string') {
    return null;
  }

  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength)}...`;
}

function compactWarnings(warnings, limit = DEFAULT_WARNING_LIMIT) {
  if (!Array.isArray(warnings)) {
    return [];
  }

  if (warnings.length <= limit) {
    return warnings;
  }

  return [
    ...warnings.slice(0, limit),
    `Compacted ${warnings.length - limit} additional warning(s). See invocation diagnostics for the full warning list.`,
  ];
}

function compactInstructionLayerSummary(instructionLayerSummary) {
  if (!instructionLayerSummary) {
    return null;
  }

  return {
    ...instructionLayerSummary,
    warnings: compactWarnings(instructionLayerSummary.warnings),
  };
}

function compactPromptProvenanceLayer(layer, { retainSourceReferences }) {
  const compactedLayer = {
    layerId: layer.layerId,
    layerType: layer.layerType,
    owner: layer.owner,
    priority: layer.priority,
    sourceReferenceCount: Array.isArray(layer.sourceReferences) ? layer.sourceReferences.length : 0,
    contentLength: layer.contentLength,
    contentSha256: layer.contentSha256,
    summary: layer.summary,
    warningCount: Array.isArray(layer.warnings) ? layer.warnings.length : 0,
    warnings: compactWarnings(layer.warnings),
  };

  if (retainSourceReferences) {
    compactedLayer.sourceReferences = layer.sourceReferences ?? [];
  }

  return compactedLayer;
}

function compactPromptProvenance(promptProvenance, { retainSourceReferences = false } = {}) {
  if (!promptProvenance) {
    return null;
  }

  return {
    kind: promptProvenance.kind,
    version: promptProvenance.version,
    promptFactoryVersion: promptProvenance.promptFactoryVersion,
    promptProfileId: promptProvenance.promptProfileId,
    promptStackVersionId: promptProvenance.promptStackVersionId,
    assemblyStatus: promptProvenance.assemblyStatus,
    providerId: promptProvenance.providerId,
    modelId: promptProvenance.modelId,
    requestType: promptProvenance.requestType,
    assembly: promptProvenance.assembly,
    includedLayerCount: promptProvenance.includedLayerCount,
    omittedLayerCount: promptProvenance.omittedLayerCount,
    includedLayers: (promptProvenance.includedLayers ?? []).map((layer) => {
      return compactPromptProvenanceLayer(layer, { retainSourceReferences });
    }),
    omittedLayers: (promptProvenance.omittedLayers ?? []).map((layer) => {
      const compactedLayer = {
        layerId: layer.layerId,
        layerType: layer.layerType,
        reason: layer.reason,
        sourceReferenceCount: Array.isArray(layer.sourceReferences) ? layer.sourceReferences.length : 0,
      };

      if (retainSourceReferences) {
        compactedLayer.sourceReferences = layer.sourceReferences ?? [];
      }

      return compactedLayer;
    }),
    warningCount: Array.isArray(promptProvenance.warnings) ? promptProvenance.warnings.length : 0,
    warnings: compactWarnings(promptProvenance.warnings),
  };
}

function compactBrainOutput(brainOutput) {
  if (!brainOutput) {
    return null;
  }

  return {
    kind: brainOutput.kind,
    version: brainOutput.version,
    providerId: brainOutput.providerId,
    modelId: brainOutput.modelId,
    requestType: brainOutput.requestType,
    status: brainOutput.status,
    providerResponseStatus: brainOutput.providerResponseStatus,
    providerResponseId: brainOutput.providerResponseId,
    finishReason: brainOutput.finishReason,
    usage: brainOutput.usage,
    outputTextLength: typeof brainOutput.outputText === 'string' ? brainOutput.outputText.length : 0,
    outputTextPreview: truncateText(brainOutput.outputText),
    warningCount: Array.isArray(brainOutput.warnings) ? brainOutput.warnings.length : 0,
    warnings: compactWarnings(brainOutput.warnings),
    errorCode: brainOutput.errorCode ?? null,
    errorMessage: brainOutput.errorMessage ?? null,
    providerFailure: brainOutput.providerFailure
      ? {
        category: brainOutput.providerFailure.category,
        retryable: brainOutput.providerFailure.retryable,
        httpStatusCode: brainOutput.providerFailure.httpStatusCode,
        providerErrorStatus: brainOutput.providerFailure.providerErrorStatus,
        diagnosticSummary: brainOutput.providerFailure.diagnosticSummary,
      }
      : null,
  };
}

function compactProviderResponse(providerResponse) {
  if (!providerResponse) {
    return null;
  }

  return {
    kind: providerResponse.kind,
    version: providerResponse.version,
    providerId: providerResponse.providerId,
    modelId: providerResponse.modelId,
    requestType: providerResponse.requestType,
    status: providerResponse.status,
    providerResponseId: providerResponse.providerResponseId,
    finishReason: providerResponse.finishReason,
    usage: providerResponse.usage,
    outputTextLength: typeof providerResponse.outputText === 'string' ? providerResponse.outputText.length : 0,
    outputTextPreview: truncateText(providerResponse.outputText),
    warningCount: Array.isArray(providerResponse.warnings) ? providerResponse.warnings.length : 0,
    warnings: compactWarnings(providerResponse.warnings),
    errorCode: providerResponse.errorCode ?? null,
    errorMessage: providerResponse.errorMessage ?? null,
    providerFailure: providerResponse.providerFailure
      ? {
        category: providerResponse.providerFailure.category,
        retryable: providerResponse.providerFailure.retryable,
        httpStatusCode: providerResponse.providerFailure.httpStatusCode,
        providerErrorStatus: providerResponse.providerFailure.providerErrorStatus,
        diagnosticSummary: providerResponse.providerFailure.diagnosticSummary,
      }
      : null,
  };
}

function compactProviderRetryExecution(providerRetryExecution) {
  if (!providerRetryExecution) {
    return null;
  }

  return {
    kind: providerRetryExecution.kind,
    version: providerRetryExecution.version,
    providerId: providerRetryExecution.providerId,
    modelId: providerRetryExecution.modelId,
    requestType: providerRetryExecution.requestType,
    totalAttempts: providerRetryExecution.totalAttempts,
    stoppedReason: providerRetryExecution.stoppedReason,
    retryPolicy: providerRetryExecution.retryPolicy
      ? {
        maxAttempts: providerRetryExecution.retryPolicy.maxAttempts,
        retryableFailureCategories: providerRetryExecution.retryPolicy.retryableFailureCategories,
        backoffStrategyKind: providerRetryExecution.retryPolicy.backoffStrategy?.kind ?? null,
        baseDelayMs: providerRetryExecution.retryPolicy.backoffStrategy?.baseDelayMs ?? null,
        maxDelayMs: providerRetryExecution.retryPolicy.backoffStrategy?.maxDelayMs ?? null,
        maxElapsedMs: providerRetryExecution.retryPolicy.maxElapsedMs,
        allowFallbackProvider: providerRetryExecution.retryPolicy.allowFallbackProvider,
        appliesToRequestTypes: providerRetryExecution.retryPolicy.appliesToRequestTypes,
      }
      : null,
    attempts: Array.isArray(providerRetryExecution.attempts)
      ? providerRetryExecution.attempts.map((attempt) => {
        return {
          attemptNumber: attempt.attemptNumber,
          status: attempt.status,
          providerResponseStatus: attempt.providerResponseStatus,
          providerResponseId: attempt.providerResponseId,
          finishReason: attempt.finishReason,
          errorCode: attempt.errorCode,
          errorMessage: attempt.errorMessage,
          providerFailureCategory: attempt.providerFailureCategory,
          retryableFailure: attempt.retryableFailure,
          retryDecision: attempt.retryDecision
            ? {
              shouldRetry: attempt.retryDecision.shouldRetry,
              stopReason: attempt.retryDecision.stopReason,
              reason: attempt.retryDecision.reason,
              recommendedBackoffMs: attempt.retryDecision.recommendedBackoffMs,
            }
            : null,
        };
      })
      : [],
  };
}

function compactFallbackDecisionTrace(fallbackDecisionTrace) {
  if (!fallbackDecisionTrace) {
    return null;
  }

  return {
    kind: fallbackDecisionTrace.kind,
    version: fallbackDecisionTrace.version,
    status: fallbackDecisionTrace.status,
    policyAllowsFallback: fallbackDecisionTrace.policyAllowsFallback,
    fallbackConfigured: fallbackDecisionTrace.fallbackConfigured,
    fallbackReady: fallbackDecisionTrace.fallbackReady,
    fallbackAttempted: fallbackDecisionTrace.fallbackAttempted,
    fallbackUsed: fallbackDecisionTrace.fallbackUsed,
    fallbackSucceeded: fallbackDecisionTrace.fallbackSucceeded,
    primaryProviderId: fallbackDecisionTrace.primaryProviderId,
    primaryProviderStatus: fallbackDecisionTrace.primaryProviderStatus,
    primaryFailureCategory: fallbackDecisionTrace.primaryFailureCategory,
    fallbackProviderId: fallbackDecisionTrace.fallbackProviderId,
    fallbackProviderStatus: fallbackDecisionTrace.fallbackProviderStatus,
    fallbackFailureCategory: fallbackDecisionTrace.fallbackFailureCategory,
    finalProviderId: fallbackDecisionTrace.finalProviderId,
    decisionReason: fallbackDecisionTrace.decisionReason,
    semanticClassifierImpact: fallbackDecisionTrace.semanticClassifierImpact
      ? {
        status: fallbackDecisionTrace.semanticClassifierImpact.status,
        providerId: fallbackDecisionTrace.semanticClassifierImpact.providerId,
        failureCategory: fallbackDecisionTrace.semanticClassifierImpact.failureCategory,
        fallbackModeUsed: fallbackDecisionTrace.semanticClassifierImpact.fallbackModeUsed,
        summary: fallbackDecisionTrace.semanticClassifierImpact.summary,
      }
      : null,
    warnings: compactWarnings(fallbackDecisionTrace.warnings),
  };
}

function compactBrainExecutionAttempt(attempt) {
  const originalSizeBytes = getJsonSizeBytes(attempt);
  const compactedAttempt = {
    ...attempt,
    instructionLayerSummary: compactInstructionLayerSummary(attempt.instructionLayerSummary),
    promptProvenance: compactPromptProvenance(attempt.promptProvenance),
    brainOutput: compactBrainOutput(attempt.brainOutput),
    providerResponse: compactProviderResponse(attempt.providerResponse),
    providerRetryExecution: compactProviderRetryExecution(attempt.providerRetryExecution),
  };
  const compactedSizeBytes = getJsonSizeBytes(compactedAttempt);

  return {
    ...compactedAttempt,
    compaction: {
      kind: 'brain_execution_attempt_compaction',
      version: 1,
      strategy: 'retain_operational_metadata_and_move_diagnostics_to_internal_artifact',
      originalSizeBytes,
      compactedSizeBytes,
    },
  };
}

function compactBrainExecution(brainExecution, compactionReference) {
  if (!brainExecution?.attempts) {
    return brainExecution ?? null;
  }

  const compactedBrainExecution = {
    ...brainExecution,
    attempts: brainExecution.attempts.map((attempt) => {
      return compactBrainExecutionAttempt(attempt);
    }),
  };

  return {
    ...compactedBrainExecution,
    compaction: {
      kind: 'brain_execution_compaction',
      version: 1,
      strategy: 'compact_attempt_diagnostics',
      diagnosticsArtifactPath: compactionReference.diagnosticsArtifactPath,
      originalSizeBytes: getJsonSizeBytes(brainExecution),
      compactedSizeBytes: getJsonSizeBytes(compactedBrainExecution),
      attemptCount: brainExecution.attempts.length,
      compactedAt: compactionReference.compactedAt,
    },
  };
}

function compactExecutionOutput(output) {
  if (!output || output.executionType !== 'probabilistic_brain') {
    return output ?? null;
  }

  return {
    kind: output.kind,
    version: output.version,
    executionType: output.executionType,
    providerId: output.providerId,
    modelId: output.modelId,
    requestType: output.requestType,
    status: output.status,
    providerResponseStatus: output.providerResponseStatus,
    providerResponseId: output.providerResponseId,
    finishReason: output.finishReason,
    usage: output.usage,
    outputTextLength: typeof output.outputText === 'string' ? output.outputText.length : 0,
    outputTextPreview: truncateText(output.outputText),
    fallbackDecisionTrace: compactFallbackDecisionTrace(output.fallbackDecisionTrace),
    intentResolution: output.intentResolution
      ? {
        status: output.intentResolution.status,
        intentId: output.intentResolution.intentId,
        actionType: output.intentResolution.actionType,
        requestedToolId: output.intentResolution.requestedToolId ?? null,
        requestedWorkflowId: output.intentResolution.requestedWorkflowId ?? null,
      }
      : null,
    actionResolution: output.actionResolution
      ? {
        status: output.actionResolution.status,
        source: output.actionResolution.source,
        runtimeAction: output.actionResolution.runtimeAction,
        selectedTargetType: output.actionResolution.selectedCandidate?.targetType ?? null,
        selectedTargetId: output.actionResolution.selectedCandidate?.targetId ?? null,
        executionAllowed: output.actionResolution.executionAllowed,
        approvalRequired: output.actionResolution.approvalRequired,
      }
      : null,
    semanticIntentRuntime: output.semanticIntentRuntime
      ? {
        status: output.semanticIntentRuntime.status,
        mode: output.semanticIntentRuntime.mode,
        classifierId: output.semanticIntentRuntime.semanticIntentClassification?.classifierId ?? null,
        classifierFailureKind: output.semanticIntentRuntime.providerClassifierAudit?.failureKind
          ?? output.semanticIntentRuntime.semanticIntentClassification?.failureKind
          ?? null,
        classifierProviderFailureCategory: output.semanticIntentRuntime.providerClassifierAudit?.providerFailureCategory
          ?? output.semanticIntentRuntime.semanticIntentClassification?.providerFailureCategory
          ?? null,
        actionAffordanceCount: output.semanticIntentRuntime.actionAffordanceReadResult?.summary?.total ?? null,
        selectedTargetType: output.semanticIntentRuntime.actionResolution?.selectedCandidate?.targetType ?? null,
        selectedTargetId: output.semanticIntentRuntime.actionResolution?.selectedCandidate?.targetId ?? null,
        warningCount: Array.isArray(output.semanticIntentRuntime.warnings)
          ? output.semanticIntentRuntime.warnings.length
          : 0,
      }
      : null,
    toolRequestResolution: output.toolRequestResolution
      ? {
        status: output.toolRequestResolution.status,
        requestedToolId: output.toolRequestResolution.requestedToolId,
        action: output.toolRequestResolution.action,
        autoExecutionPerformed: output.toolRequestResolution.autoExecutionPerformed,
      }
      : null,
    brainToolExecution: output.brainToolExecution
      ? {
        status: output.brainToolExecution.status,
        requestedToolId: output.brainToolExecution.requestedToolId,
        executionPerformed: output.brainToolExecution.executionPerformed,
        toolRunId: output.brainToolExecution.toolRunId,
        toolResultStatus: output.brainToolExecution.toolResultStatus,
        toolAuditRecordPath: output.brainToolExecution.toolAuditRecordPath,
      }
      : null,
    workflowRequestResolution: output.workflowRequestResolution
      ? {
        status: output.workflowRequestResolution.status,
        requestedWorkflowId: output.workflowRequestResolution.requestedWorkflowId,
        action: output.workflowRequestResolution.action,
        autoExecutionPerformed: output.workflowRequestResolution.autoExecutionPerformed,
      }
      : null,
    brainWorkflowExecution: output.brainWorkflowExecution
      ? {
        status: output.brainWorkflowExecution.status,
        requestedWorkflowId: output.brainWorkflowExecution.requestedWorkflowId,
        executionPerformed: output.brainWorkflowExecution.executionPerformed,
        workflowRunId: output.brainWorkflowExecution.workflowRunId,
        workflowRunStatus: output.brainWorkflowExecution.workflowRunStatus,
      }
      : null,
    actionClaimGuard: output.actionClaimGuard
      ? {
        status: output.actionClaimGuard.status,
        claimCount: output.actionClaimGuard.claimCount,
        supportedClaimCount: output.actionClaimGuard.supportedClaimCount,
        unsupportedClaimCount: output.actionClaimGuard.unsupportedClaimCount,
        warningCount: Array.isArray(output.actionClaimGuard.warnings)
          ? output.actionClaimGuard.warnings.length
          : 0,
        warnings: compactWarnings(output.actionClaimGuard.warnings),
      }
      : null,
    verificationGate: output.verificationGate
      ? {
        status: output.verificationGate.status,
        verificationOutcome: output.verificationGate.verificationOutcome,
        executionObserved: output.verificationGate.executionObserved,
        requirementCount: output.verificationGate.evidenceRequirements?.length ?? 0,
        unsupportedRelevantClaims: output.verificationGate.claimSupportSummary?.unsupportedClaims ?? 0,
        reason: truncateText(output.verificationGate.reason),
        warningCount: Array.isArray(output.verificationGate.warnings)
          ? output.verificationGate.warnings.length
          : 0,
        warnings: compactWarnings(output.verificationGate.warnings),
      }
      : null,
    actionResultAssessment: output.actionResultAssessment
      ? {
        status: output.actionResultAssessment.status,
        requestFulfillment: output.actionResultAssessment.requestFulfillment,
        executionObserved: output.actionResultAssessment.executionObserved,
        approvalPaused: output.actionResultAssessment.approvalPaused,
        clarificationRequired: output.actionResultAssessment.clarificationRequired,
        answerGroundedInEvidence: output.actionResultAssessment.finalAnswerAssessment?.answerGroundedInEvidence ?? null,
        unsupportedClaimCount: output.actionResultAssessment.finalAnswerAssessment?.unsupportedClaimCount ?? 0,
        reason: truncateText(output.actionResultAssessment.reason),
        warningCount: Array.isArray(output.actionResultAssessment.warnings)
          ? output.actionResultAssessment.warnings.length
          : 0,
        warnings: compactWarnings(output.actionResultAssessment.warnings),
      }
      : null,
    errorCode: output.errorCode ?? null,
    errorMessage: output.errorMessage ?? null,
    providerFailure: output.providerFailure
      ? {
        category: output.providerFailure.category,
        retryable: output.providerFailure.retryable,
        httpStatusCode: output.providerFailure.httpStatusCode,
        providerErrorStatus: output.providerFailure.providerErrorStatus,
        diagnosticSummary: output.providerFailure.diagnosticSummary,
      }
      : null,
  };
}

function buildInvocationDiagnosticsArtifact({
  invocationSession,
  diagnosticsArtifactPath,
  compactedAt,
}) {
  if (!invocationSession.brainExecution?.attempts) {
    return null;
  }

  return {
    kind: 'invocation_diagnostics_artifact',
    version: 1,
    invocationId: invocationSession.invocationId,
    operationalIdentityId: invocationSession.operationalIdentityId,
    primaryCognitiveIdentityId: invocationSession.primaryCognitiveIdentityId,
    executionType: invocationSession.executionType,
    createdAt: compactedAt,
    relativePath: diagnosticsArtifactPath,
    contents: {
      brainExecution: invocationSession.brainExecution,
      providerResponse: invocationSession.providerResponse,
      promptProvenance: invocationSession.promptProvenance,
      instructionLayerSummary: invocationSession.instructionLayerSummary,
      promptBudgetReport: invocationSession.promptBudgetReport,
      promptProfileSelection: invocationSession.promptProfileSelection,
      output: invocationSession.output,
    },
  };
}

export function compactInvocationSessionForPersistence({
  invocationSession,
  diagnosticsArtifactPath,
  compactedAt = new Date().toISOString(),
}) {
  const diagnosticsArtifact = buildInvocationDiagnosticsArtifact({
    invocationSession,
    diagnosticsArtifactPath,
    compactedAt,
  });

  if (!diagnosticsArtifact) {
    return {
      invocationSession,
      diagnosticsArtifact: null,
    };
  }

  const compactedSessionWithoutTopLevelMetadata = {
    ...invocationSession,
    brainExecution: compactBrainExecution(invocationSession.brainExecution, {
      diagnosticsArtifactPath,
      compactedAt,
    }),
    instructionLayerSummary: compactInstructionLayerSummary(invocationSession.instructionLayerSummary),
    promptProvenance: compactPromptProvenance(invocationSession.promptProvenance, {
      retainSourceReferences: true,
    }),
    providerResponse: compactProviderResponse(invocationSession.providerResponse),
    output: compactExecutionOutput(invocationSession.output),
  };

  return {
    invocationSession: {
      ...compactedSessionWithoutTopLevelMetadata,
      invocationSessionCompaction: {
        kind: 'invocation_session_compaction',
        version: 1,
        status: 'applied',
        strategy: 'compact_persisted_session_and_preserve_full_diagnostics',
        diagnosticsArtifactPath,
        originalSizeBytes: getJsonSizeBytes(invocationSession),
        compactedSizeBytes: getJsonSizeBytes(compactedSessionWithoutTopLevelMetadata),
        compactedAt,
      },
    },
    diagnosticsArtifact,
  };
}
