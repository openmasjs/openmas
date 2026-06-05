import {
  buildLocalizedInvocationNextStep,
  resolveActionRuntimeLocale,
} from '../localization/action-runtime-localization.js';

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeOptionalString(value) {
  return isNonEmptyString(value) ? value.trim() : null;
}

function getConversationContinuation(conversationRuntime) {
  const conversationId = normalizeOptionalString(conversationRuntime?.conversationId);

  if (!conversationId) {
    return null;
  }

  return `Continue the conversation with --conversation ${conversationId} when you want a follow-up.`;
}

function getPendingToolApprovalId(humanApprovalRuntime) {
  if (humanApprovalRuntime?.approvalState?.status !== 'pending') {
    return null;
  }

  return normalizeOptionalString(humanApprovalRuntime.approvalState.approvalRequestId)
    ?? normalizeOptionalString(humanApprovalRuntime.approvalRequest?.approvalRequestId);
}

function getWorkflowApprovalIds(brainWorkflowExecution) {
  if (brainWorkflowExecution?.workflowRunStatus !== 'waiting_for_approval') {
    return [];
  }

  return brainWorkflowExecution.observation?.approvalRequests ?? [];
}

function appendConversationGuidance(nextStep, conversationRuntime) {
  const conversationGuidance = getConversationContinuation(conversationRuntime);

  if (!conversationGuidance) {
    return nextStep;
  }

  return `${nextStep} ${conversationGuidance}`;
}

function resolveCredentialVaultEnvironmentForNextStep(readiness) {
  return normalizeOptionalString(readiness?.secretResolution?.credentialVaultEnvironment) ?? 'development';
}

function buildBlockedNextStep({ request, readiness }) {
  const locale = resolveActionRuntimeLocale({
    request,
  });

  if (request?.invocationMode === 'probabilistic') {
    return buildLocalizedInvocationNextStep({
      locale,
      scenario: 'blocked',
      params: {
        credentialVaultEnvironment: resolveCredentialVaultEnvironmentForNextStep(readiness),
      },
    });
  }

  return buildLocalizedInvocationNextStep({
    locale,
    scenario: 'blocked_generic',
  });
}

function buildFailedNextStep({
  request,
  brainOutput,
  fallbackDecisionTrace,
  brainToolExecution,
  brainWorkflowExecution,
}) {
  const locale = resolveActionRuntimeLocale({
    request,
  });

  if (brainToolExecution?.executionPerformed && brainToolExecution.toolResultStatus === 'failed') {
    return buildLocalizedInvocationNextStep({
      locale,
      scenario: 'failed_tool',
      params: {
        requestedToolId: brainToolExecution.requestedToolId,
      },
    });
  }

  if (brainWorkflowExecution?.executionPerformed && brainWorkflowExecution.workflowRunStatus === 'failed') {
    return buildLocalizedInvocationNextStep({
      locale,
      scenario: 'failed_workflow',
      params: {
        requestedWorkflowId: brainWorkflowExecution.requestedWorkflowId,
      },
    });
  }

  if (fallbackDecisionTrace?.status === 'fallback_failed') {
    return buildLocalizedInvocationNextStep({
      locale,
      scenario: 'fallback_failed',
      params: {
        primaryProviderId: fallbackDecisionTrace.primaryProviderId,
        primaryFailureCategory: fallbackDecisionTrace.primaryFailureCategory,
        fallbackProviderId: fallbackDecisionTrace.fallbackProviderId,
        fallbackFailureCategory: fallbackDecisionTrace.fallbackFailureCategory,
      },
    });
  }

  if (fallbackDecisionTrace?.status === 'skipped_fallback_not_ready') {
    return buildLocalizedInvocationNextStep({
      locale,
      scenario: 'skipped_fallback_not_ready',
      params: {
        primaryProviderId: fallbackDecisionTrace.primaryProviderId,
        primaryFailureCategory: fallbackDecisionTrace.primaryFailureCategory,
        fallbackProviderId: fallbackDecisionTrace.fallbackProviderId,
      },
    });
  }

  if (fallbackDecisionTrace?.status === 'skipped_fallback_not_configured') {
    return buildLocalizedInvocationNextStep({
      locale,
      scenario: 'skipped_fallback_not_configured',
      params: {
        primaryProviderId: fallbackDecisionTrace.primaryProviderId,
        primaryFailureCategory: fallbackDecisionTrace.primaryFailureCategory,
      },
    });
  }

  if (fallbackDecisionTrace?.status === 'skipped_policy_disallowed') {
    return buildLocalizedInvocationNextStep({
      locale,
      scenario: 'skipped_policy_disallowed',
      params: {
        primaryProviderId: fallbackDecisionTrace.primaryProviderId,
        primaryFailureCategory: fallbackDecisionTrace.primaryFailureCategory,
      },
    });
  }

  const providerId = normalizeOptionalString(brainOutput?.providerId);

  if (providerId) {
    return buildLocalizedInvocationNextStep({
      locale,
      scenario: 'provider_failure',
      params: {
        providerId,
        failureCategory: normalizeOptionalString(brainOutput?.providerFailure?.category),
      },
    });
  }

  return 'Inspect the invocation failure, fix the reported root cause, then rerun the invocation.';
}

function buildToolNextStep({
  toolRequestResolution,
  brainToolExecution,
}) {
  const locale = resolveActionRuntimeLocale();
  const requestedToolId = normalizeOptionalString(toolRequestResolution?.requestedToolId)
    ?? normalizeOptionalString(brainToolExecution?.requestedToolId)
    ?? 'the requested tool';

  if (toolRequestResolution?.status === 'approval_required') {
    return buildLocalizedInvocationNextStep({
      locale,
      scenario: 'tool_approval_required',
      params: {
        requestedToolId,
      },
    });
  }

  if (toolRequestResolution?.status === 'denied' || toolRequestResolution?.status === 'invalid') {
    return buildLocalizedInvocationNextStep({
      locale,
      scenario: 'tool_not_executed',
      params: {
        requestedToolId,
      },
    });
  }

  if (!brainToolExecution?.executionPerformed) {
    return null;
  }

  if (brainToolExecution.toolResultStatus === 'failed') {
    return buildLocalizedInvocationNextStep({
      locale,
      scenario: 'tool_failed',
      params: {
        requestedToolId,
      },
    });
  }

  return buildLocalizedInvocationNextStep({
    locale,
    scenario: 'tool_succeeded',
    params: {
      requestedToolId,
    },
  });
}

function buildWorkflowNextStep({
  workflowRequestResolution,
  brainWorkflowExecution,
}) {
  const locale = resolveActionRuntimeLocale();
  const requestedWorkflowId = normalizeOptionalString(workflowRequestResolution?.requestedWorkflowId)
    ?? normalizeOptionalString(brainWorkflowExecution?.requestedWorkflowId)
    ?? 'the requested workflow';

  if (workflowRequestResolution?.status === 'denied' || workflowRequestResolution?.status === 'invalid') {
    return buildLocalizedInvocationNextStep({
      locale,
      scenario: 'workflow_not_executed',
      params: {
        requestedWorkflowId,
      },
    });
  }

  if (!brainWorkflowExecution?.executionPerformed) {
    return null;
  }

  if (brainWorkflowExecution.workflowRunStatus === 'waiting_for_approval') {
    const approvalIds = getWorkflowApprovalIds(brainWorkflowExecution);

    return buildLocalizedInvocationNextStep({
      locale,
      scenario: 'workflow_waiting_approval',
      params: {
        requestedWorkflowId,
        approvalIds,
      },
    });
  }

  if (brainWorkflowExecution.workflowRunStatus === 'waiting_for_external_event') {
    return buildLocalizedInvocationNextStep({
      locale,
      scenario: 'workflow_waiting_external',
      params: {
        requestedWorkflowId,
      },
    });
  }

  if (brainWorkflowExecution.workflowRunStatus === 'failed') {
    return buildLocalizedInvocationNextStep({
      locale,
      scenario: 'workflow_failed',
      params: {
        requestedWorkflowId,
      },
    });
  }

  return buildLocalizedInvocationNextStep({
    locale,
    scenario: 'workflow_succeeded',
    params: {
      requestedWorkflowId,
    },
  });
}

function buildCompletedNextStep({
  request,
  conversationRuntime,
  brainOutput,
  fallbackDecisionTrace,
  toolRequestResolution,
  brainToolExecution,
  workflowRequestResolution,
  brainWorkflowExecution,
  semanticIntentRuntime,
  actionResultAssessment,
  humanApprovalRuntime,
}) {
  const locale = resolveActionRuntimeLocale({
    request,
  });
  const classifierProviderAudit = semanticIntentRuntime?.providerClassifierAudit ?? null;
  const conversationGuidance = getConversationContinuation(conversationRuntime);

  if (actionResultAssessment?.status === 'clarification_required') {
    if (classifierProviderAudit?.status === 'failed') {
      const classifierProviderId = normalizeOptionalString(
        classifierProviderAudit.providerRequest?.providerId
        ?? classifierProviderAudit.providerResponse?.providerId,
      ) ?? 'the semantic classifier provider';
      const classifierFailureKind = normalizeOptionalString(
        classifierProviderAudit.failureKind,
      );
      const failureCategory = normalizeOptionalString(
        classifierProviderAudit.attempts?.at(-1)?.failureCategory,
      );

      if (classifierFailureKind === 'classification_failure') {
        return buildLocalizedInvocationNextStep({
          locale,
          scenario: 'clarification_classifier_output_failure',
          params: {
            classifierProviderId,
            conversationGuidance,
          },
        });
      }

      return buildLocalizedInvocationNextStep({
        locale,
        scenario: 'clarification_classifier_provider_failure',
        params: {
          classifierProviderId,
          failureCategory,
          conversationGuidance,
        },
      });
    }

    return buildLocalizedInvocationNextStep({
      locale,
      scenario: 'clarification_required',
      params: {
        conversationGuidance,
      },
    });
  }

  if (actionResultAssessment?.status === 'no_execution') {
    return buildLocalizedInvocationNextStep({
      locale,
      scenario: 'no_execution',
      params: {
        conversationGuidance,
      },
    });
  }

  if (actionResultAssessment?.status === 'partial_success') {
    return buildLocalizedInvocationNextStep({
      locale,
      scenario: 'partial_success',
      params: {
        conversationGuidance,
      },
    });
  }

  const pendingToolApprovalId = getPendingToolApprovalId(humanApprovalRuntime);

  if (pendingToolApprovalId) {
    return buildLocalizedInvocationNextStep({
      locale,
      scenario: 'pending_tool_approval',
      params: {
        pendingToolApprovalId,
        conversationGuidance,
      },
    });
  }

  const toolNextStep = buildToolNextStep({
    toolRequestResolution,
    brainToolExecution,
  });

  if (toolNextStep) {
    return appendConversationGuidance(toolNextStep, conversationRuntime);
  }

  const workflowNextStep = buildWorkflowNextStep({
    workflowRequestResolution,
    brainWorkflowExecution,
  });

  if (workflowNextStep) {
    return appendConversationGuidance(workflowNextStep, conversationRuntime);
  }

  if (conversationGuidance) {
    if (fallbackDecisionTrace?.status === 'fallback_succeeded') {
      return buildLocalizedInvocationNextStep({
        locale,
        scenario: 'completed_fallback_conversation',
        params: {
          primaryProviderId: fallbackDecisionTrace.primaryProviderId,
          fallbackProviderId: fallbackDecisionTrace.fallbackProviderId,
          conversationGuidance,
        },
      });
    }

    return buildLocalizedInvocationNextStep({
      locale,
      scenario: 'completed_conversation',
      params: {
        conversationGuidance,
      },
    });
  }

  if (request?.invocationMode === 'probabilistic') {
    if (fallbackDecisionTrace?.status === 'fallback_succeeded') {
      return buildLocalizedInvocationNextStep({
        locale,
        scenario: 'completed_fallback',
        params: {
          primaryProviderId: fallbackDecisionTrace.primaryProviderId,
          fallbackProviderId: fallbackDecisionTrace.fallbackProviderId,
        },
      });
    }

    const providerId = normalizeOptionalString(brainOutput?.providerId) ?? 'the selected brain provider';
    return buildLocalizedInvocationNextStep({
      locale,
      scenario: 'completed_probabilistic',
      params: {
        providerId,
      },
    });
  }

  return buildLocalizedInvocationNextStep({
    locale,
    scenario: 'completed_deterministic',
  });
}

export function buildInvocationNextStep({
  status,
  request = null,
  conversationRuntime = null,
  readiness = null,
  brainOutput = null,
  brainExecution = null,
  fallbackDecisionTrace = null,
  toolRequestResolution = null,
  brainToolExecution = null,
  workflowRequestResolution = null,
  brainWorkflowExecution = null,
  semanticIntentRuntime = null,
  actionResultAssessment = null,
  humanApprovalRuntime = null,
} = {}) {
  if (status === 'completed') {
    return buildCompletedNextStep({
      request,
      conversationRuntime,
      readiness,
      brainOutput,
      brainExecution,
      fallbackDecisionTrace,
      toolRequestResolution,
      brainToolExecution,
      workflowRequestResolution,
      brainWorkflowExecution,
      semanticIntentRuntime,
      actionResultAssessment,
      humanApprovalRuntime,
    });
  }

  if (status === 'blocked') {
    return buildBlockedNextStep({
      request,
      readiness,
    });
  }

  return buildFailedNextStep({
    request,
    brainOutput,
    fallbackDecisionTrace,
    brainToolExecution,
    brainWorkflowExecution,
  });
}
