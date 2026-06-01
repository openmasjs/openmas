import { assertActionResultAssessment } from '../contracts/actions/action-result-assessment-contract.js';
import {
  buildLocalizedActionResultAssessmentCopy,
  resolveActionRuntimeLocale,
} from '../localization/action-runtime-localization.js';

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function uniqueStrings(values) {
  return [...new Set(values.filter(isNonEmptyString).map((value) => value.trim()))];
}

function wasSuccessfulStatus(status) {
  return status === 'succeeded'
    || status === 'success'
    || status === 'completed';
}

function wasFailureStatus(status) {
  return status === 'failed'
    || status === 'cancelled'
    || status === 'timed_out'
    || status === 'unavailable'
    || status === 'denied';
}

function hasPendingToolApproval({
  toolRequestResolution,
  humanApprovalRuntime,
}) {
  return toolRequestResolution?.status === 'approval_required'
    || humanApprovalRuntime?.approvalState?.status === 'pending'
    || (humanApprovalRuntime?.approvalRequest !== null && humanApprovalRuntime?.approvalRequest !== undefined);
}

function hasPendingWorkflowApproval(brainWorkflowExecution) {
  return brainWorkflowExecution?.workflowRunStatus === 'waiting_for_approval';
}

function hasClarificationAction(actionResolution) {
  return actionResolution?.status === 'needs_clarification'
    || actionResolution?.status === 'ambiguous';
}

function hasDeniedOrInvalidAction({
  actionResolution,
  toolRequestResolution,
  workflowRequestResolution,
}) {
  return actionResolution?.status === 'denied'
    || actionResolution?.status === 'no_capability'
    || toolRequestResolution?.status === 'denied'
    || toolRequestResolution?.status === 'invalid'
    || workflowRequestResolution?.status === 'denied'
    || workflowRequestResolution?.status === 'invalid';
}

function buildRequestedAction(actionResolution) {
  const selectedCandidate = actionResolution?.selectedCandidate ?? null;

  if (!selectedCandidate) {
    return {
      actionType: null,
      targetType: null,
      targetId: null,
      runtimeAction: actionResolution?.runtimeAction ?? null,
      sideEffectLevel: null,
    };
  }

  return {
    actionType: selectedCandidate.actionType ?? null,
    targetType: selectedCandidate.targetType ?? null,
    targetId: selectedCandidate.targetId ?? null,
    runtimeAction: actionResolution?.runtimeAction ?? null,
    sideEffectLevel: selectedCandidate.sideEffectLevel ?? null,
  };
}

function buildEvidenceItem({
  evidenceType,
  targetId = null,
  runId = null,
  status = null,
  summary = null,
}) {
  return {
    evidenceType,
    targetId,
    runId,
    status,
    summary,
  };
}

function collectEvidence({
  actionResolution,
  toolRequestResolution,
  brainToolExecution,
  workflowRequestResolution,
  brainWorkflowExecution,
  humanApprovalRuntime,
  actionClaimGuard,
  verificationGate,
  brainOutput,
}) {
  const evidence = [];

  if (actionResolution) {
    evidence.push(buildEvidenceItem({
      evidenceType: 'action_resolution',
      targetId: actionResolution.selectedCandidate?.targetId ?? null,
      status: actionResolution.status,
      summary: actionResolution.reason,
    }));
  }

  if (toolRequestResolution) {
    evidence.push(buildEvidenceItem({
      evidenceType: 'tool_resolution',
      targetId: toolRequestResolution.requestedToolId,
      status: toolRequestResolution.status,
      summary: toolRequestResolution.reason,
    }));
  }

  if (brainToolExecution) {
    evidence.push(buildEvidenceItem({
      evidenceType: 'tool_execution',
      targetId: brainToolExecution.requestedToolId,
      runId: brainToolExecution.toolRunId,
      status: brainToolExecution.status,
      summary: brainToolExecution.reason,
    }));

    if (brainToolExecution.observation) {
      evidence.push(buildEvidenceItem({
        evidenceType: 'tool_observation',
        targetId: brainToolExecution.observation.toolId,
        runId: brainToolExecution.observation.toolRunId,
        status: brainToolExecution.observation.status,
        summary: brainToolExecution.observation.summary,
      }));
    }
  }

  if (workflowRequestResolution) {
    evidence.push(buildEvidenceItem({
      evidenceType: 'workflow_resolution',
      targetId: workflowRequestResolution.requestedWorkflowId,
      status: workflowRequestResolution.status,
      summary: workflowRequestResolution.reason,
    }));
  }

  if (brainWorkflowExecution) {
    evidence.push(buildEvidenceItem({
      evidenceType: 'workflow_execution',
      targetId: brainWorkflowExecution.requestedWorkflowId,
      runId: brainWorkflowExecution.workflowRunId,
      status: brainWorkflowExecution.status,
      summary: brainWorkflowExecution.reason,
    }));

    if (brainWorkflowExecution.observation) {
      evidence.push(buildEvidenceItem({
        evidenceType: 'workflow_observation',
        targetId: brainWorkflowExecution.observation.workflowId,
        runId: brainWorkflowExecution.observation.workflowRunId,
        status: brainWorkflowExecution.observation.status,
        summary: brainWorkflowExecution.observation.summary,
      }));
    }
  }

  if (humanApprovalRuntime?.approvalState) {
    evidence.push(buildEvidenceItem({
      evidenceType: 'human_approval',
      targetId: humanApprovalRuntime.approvalState.approvalRequestId,
      status: humanApprovalRuntime.approvalState.status,
      summary: humanApprovalRuntime.approvalState.reason,
    }));
  }

  if (actionClaimGuard) {
    evidence.push(buildEvidenceItem({
      evidenceType: 'action_claim_guard',
      status: actionClaimGuard.status,
      summary: `${actionClaimGuard.unsupportedClaimCount} unsupported action claim(s).`,
    }));
  }

  if (verificationGate) {
    evidence.push(buildEvidenceItem({
      evidenceType: 'verification_gate',
      status: verificationGate.status,
      summary: verificationGate.reason,
    }));
  }

  if (brainOutput) {
    evidence.push(buildEvidenceItem({
      evidenceType: 'brain_output',
      targetId: brainOutput.providerId,
      status: brainOutput.status,
      summary: brainOutput.status === 'completed'
        ? 'Brain output completed.'
        : brainOutput.errorMessage,
    }));
  }

  return evidence.filter((item) => {
    return isNonEmptyString(item.status) || isNonEmptyString(item.summary);
  });
}

function buildFinalAnswerAssessment(actionClaimGuard, verificationGate = null) {
  const unsupportedClaimCount = actionClaimGuard?.unsupportedClaimCount ?? 0;
  const claimGuardStatus = actionClaimGuard?.status ?? null;
  const verificationStatus = verificationGate?.status ?? null;

  return {
    answerGroundedInEvidence: unsupportedClaimCount === 0
      && verificationStatus !== 'failed'
      && verificationStatus !== 'degraded',
    claimGuardStatus,
    unsupportedClaimCount,
  };
}

function createAssessment({
  status,
  requestFulfillment,
  requestedAction,
  executionObserved,
  approvalPaused = false,
  clarificationRequired = false,
  finalAnswerAssessment,
  reason,
  evidence,
  finalAnswerGuidance,
  recommendedNextActions,
  warnings = [],
  metadata = {},
}) {
  return assertActionResultAssessment({
    kind: 'action_result_assessment',
    version: 1,
    status,
    requestFulfillment,
    requestedAction,
    executionObserved,
    approvalPaused,
    clarificationRequired,
    finalAnswerAssessment,
    reason,
    evidence,
    finalAnswerGuidance,
    recommendedNextActions,
    warnings,
    metadata,
  });
}

function buildUnsupportedClaimWarning(actionClaimGuard) {
  if (!actionClaimGuard || actionClaimGuard.unsupportedClaimCount === 0) {
    return null;
  }

  return `Action result assessment found ${actionClaimGuard.unsupportedClaimCount} unsupported action claim(s); final answer must be reviewed against runtime evidence.`;
}

function buildVerificationGateWarning(verificationGate) {
  if (!verificationGate || verificationGate.status === 'passed' || verificationGate.status === 'not_applicable') {
    return null;
  }

  return `Verification gate status is ${verificationGate.status}: ${verificationGate.reason}`;
}

function resolveToolExecutionStatus(brainToolExecution) {
  if (!brainToolExecution?.executionPerformed) {
    return null;
  }

  return brainToolExecution.toolResultStatus ?? brainToolExecution.observation?.status ?? null;
}

function resolveWorkflowExecutionStatus(brainWorkflowExecution) {
  if (!brainWorkflowExecution?.executionPerformed) {
    return null;
  }

  return brainWorkflowExecution.workflowRunStatus ?? brainWorkflowExecution.observation?.status ?? null;
}

function hasAnyExecution({
  brainToolExecution,
  brainWorkflowExecution,
}) {
  return brainToolExecution?.executionPerformed === true
    || brainWorkflowExecution?.executionPerformed === true;
}

function hasAnySuccessfulExecution({
  brainToolExecution,
  brainWorkflowExecution,
}) {
  const toolStatus = resolveToolExecutionStatus(brainToolExecution);
  const workflowStatus = resolveWorkflowExecutionStatus(brainWorkflowExecution);

  return wasSuccessfulStatus(toolStatus) || wasSuccessfulStatus(workflowStatus);
}

function hasAnyFailedExecution({
  brainToolExecution,
  brainWorkflowExecution,
}) {
  const toolStatus = resolveToolExecutionStatus(brainToolExecution);
  const workflowStatus = resolveWorkflowExecutionStatus(brainWorkflowExecution);

  return wasFailureStatus(toolStatus) || wasFailureStatus(workflowStatus);
}

function hasPartialWorkflowExecution(brainWorkflowExecution) {
  return brainWorkflowExecution?.executionPerformed === true
    && brainWorkflowExecution.workflowRunStatus === 'waiting_for_external_event';
}

export function evaluateActionResultAssessmentForInvocation({
  request = null,
  brainOutput = null,
  actionResolution = null,
  toolRequestResolution = null,
  brainToolExecution = null,
  workflowRequestResolution = null,
  brainWorkflowExecution = null,
  humanApprovalRuntime = null,
  actionClaimGuard = null,
  verificationGate = null,
} = {}) {
  const locale = resolveActionRuntimeLocale({
    request,
  });
  const requestedAction = buildRequestedAction(actionResolution);
  const evidence = collectEvidence({
    actionResolution,
    toolRequestResolution,
    brainToolExecution,
    workflowRequestResolution,
    brainWorkflowExecution,
    humanApprovalRuntime,
    actionClaimGuard,
    verificationGate,
    brainOutput,
  });
  const finalAnswerAssessment = buildFinalAnswerAssessment(actionClaimGuard, verificationGate);
  const unsupportedClaimWarning = buildUnsupportedClaimWarning(actionClaimGuard);
  const verificationGateWarning = buildVerificationGateWarning(verificationGate);
  const commonWarnings = uniqueStrings([
    unsupportedClaimWarning,
    verificationGateWarning,
  ]);
  const commonMetadata = {
    command: request?.command ?? null,
    inputTextLength: isNonEmptyString(request?.inputText) ? request.inputText.trim().length : 0,
    brainOutputStatus: brainOutput?.status ?? null,
    actionResolutionStatus: actionResolution?.status ?? null,
    toolRequestStatus: toolRequestResolution?.status ?? null,
    workflowRequestStatus: workflowRequestResolution?.status ?? null,
    verificationGateStatus: verificationGate?.status ?? null,
    verificationOutcome: verificationGate?.verificationOutcome ?? null,
  };

  if (brainOutput?.status === 'failed') {
    const localizedCopy = buildLocalizedActionResultAssessmentCopy({
      locale,
      scenario: 'brain_output_failed',
    });

    return createAssessment({
      status: 'failure',
      requestFulfillment: 'not_fulfilled',
      requestedAction,
      executionObserved: hasAnyExecution({ brainToolExecution, brainWorkflowExecution }),
      finalAnswerAssessment,
      reason: `Brain output failed: ${brainOutput.errorMessage}`,
      evidence,
      finalAnswerGuidance: localizedCopy.finalAnswerGuidance,
      recommendedNextActions: localizedCopy.recommendedNextActions,
      warnings: commonWarnings,
      metadata: commonMetadata,
    });
  }

  if (hasClarificationAction(actionResolution)) {
    const localizedCopy = buildLocalizedActionResultAssessmentCopy({
      locale,
      scenario: 'clarification_required',
      clarificationQuestion: actionResolution.clarificationRequest?.question ?? null,
    });

    return createAssessment({
      status: 'clarification_required',
      requestFulfillment: 'needs_clarification',
      requestedAction,
      executionObserved: false,
      clarificationRequired: true,
      finalAnswerAssessment,
      reason: actionResolution.reason,
      evidence,
      finalAnswerGuidance: localizedCopy.finalAnswerGuidance,
      recommendedNextActions: localizedCopy.recommendedNextActions,
      warnings: commonWarnings,
      metadata: commonMetadata,
    });
  }

  if (hasPendingToolApproval({ toolRequestResolution, humanApprovalRuntime }) || hasPendingWorkflowApproval(brainWorkflowExecution)) {
    const localizedCopy = buildLocalizedActionResultAssessmentCopy({
      locale,
      scenario: 'approval_pause',
    });

    return createAssessment({
      status: 'approval_pause',
      requestFulfillment: 'pending_approval',
      requestedAction,
      executionObserved: hasAnyExecution({ brainToolExecution, brainWorkflowExecution }),
      approvalPaused: true,
      finalAnswerAssessment,
      reason: 'Execution is paused until human approval is decided.',
      evidence,
      finalAnswerGuidance: localizedCopy.finalAnswerGuidance,
      recommendedNextActions: localizedCopy.recommendedNextActions,
      warnings: commonWarnings,
      metadata: commonMetadata,
    });
  }

  if (hasDeniedOrInvalidAction({
    actionResolution,
    toolRequestResolution,
    workflowRequestResolution,
  })) {
    const localizedCopy = buildLocalizedActionResultAssessmentCopy({
      locale,
      scenario: 'denied_or_invalid',
    });

    return createAssessment({
      status: 'no_execution',
      requestFulfillment: 'not_fulfilled',
      requestedAction,
      executionObserved: false,
      finalAnswerAssessment,
      reason: 'The requested action was denied or invalid, so no runtime execution was performed.',
      evidence,
      finalAnswerGuidance: localizedCopy.finalAnswerGuidance,
      recommendedNextActions: localizedCopy.recommendedNextActions,
      warnings: commonWarnings,
      metadata: commonMetadata,
    });
  }

  if (hasAnyFailedExecution({ brainToolExecution, brainWorkflowExecution })) {
    const localizedCopy = buildLocalizedActionResultAssessmentCopy({
      locale,
      scenario: 'execution_failed',
    });

    return createAssessment({
      status: hasAnySuccessfulExecution({ brainToolExecution, brainWorkflowExecution })
        ? 'partial_success'
        : 'failure',
      requestFulfillment: hasAnySuccessfulExecution({ brainToolExecution, brainWorkflowExecution })
        ? 'partially_fulfilled'
        : 'not_fulfilled',
      requestedAction,
      executionObserved: true,
      finalAnswerAssessment,
      reason: 'Runtime execution was observed, but at least one execution result failed.',
      evidence,
      finalAnswerGuidance: localizedCopy.finalAnswerGuidance,
      recommendedNextActions: localizedCopy.recommendedNextActions,
      warnings: commonWarnings,
      metadata: commonMetadata,
    });
  }

  if (hasPartialWorkflowExecution(brainWorkflowExecution)) {
    const localizedCopy = buildLocalizedActionResultAssessmentCopy({
      locale,
      scenario: 'workflow_waiting_external',
    });

    return createAssessment({
      status: 'partial_success',
      requestFulfillment: 'partially_fulfilled',
      requestedAction,
      executionObserved: true,
      finalAnswerAssessment,
      reason: 'Workflow execution started but is waiting for an external event.',
      evidence,
      finalAnswerGuidance: localizedCopy.finalAnswerGuidance,
      recommendedNextActions: localizedCopy.recommendedNextActions,
      warnings: commonWarnings,
      metadata: commonMetadata,
    });
  }

  if (hasAnySuccessfulExecution({ brainToolExecution, brainWorkflowExecution })) {
    if (verificationGate?.status === 'failed') {
      const localizedCopy = buildLocalizedActionResultAssessmentCopy({
        locale,
        scenario: 'partial_success_verification_failed',
      });

      return createAssessment({
        status: 'partial_success',
        requestFulfillment: 'partially_fulfilled',
        requestedAction,
        executionObserved: true,
        finalAnswerAssessment,
        reason: 'Runtime execution succeeded, but verification requirements were not fully satisfied.',
        evidence,
        finalAnswerGuidance: localizedCopy.finalAnswerGuidance,
        recommendedNextActions: localizedCopy.recommendedNextActions,
        warnings: commonWarnings,
        metadata: commonMetadata,
      });
    }

    if (verificationGate?.status === 'degraded') {
      const localizedCopy = buildLocalizedActionResultAssessmentCopy({
        locale,
        scenario: 'partial_success_verification_degraded',
      });

      return createAssessment({
        status: 'partial_success',
        requestFulfillment: 'partially_fulfilled',
        requestedAction,
        executionObserved: true,
        finalAnswerAssessment,
        reason: 'Runtime execution succeeded, but verification evidence was only partially available inline.',
        evidence,
        finalAnswerGuidance: localizedCopy.finalAnswerGuidance,
        recommendedNextActions: localizedCopy.recommendedNextActions,
        warnings: commonWarnings,
        metadata: commonMetadata,
      });
    }

    const unsupportedClaimCount = actionClaimGuard?.unsupportedClaimCount ?? 0;

    if (unsupportedClaimCount > 0) {
      const localizedCopy = buildLocalizedActionResultAssessmentCopy({
        locale,
        scenario: 'partial_success_unsupported_claims',
      });

      return createAssessment({
        status: 'partial_success',
        requestFulfillment: 'partially_fulfilled',
        requestedAction,
        executionObserved: true,
        finalAnswerAssessment,
        reason: 'Runtime execution succeeded, but the final answer contains unsupported action claims.',
        evidence,
        finalAnswerGuidance: localizedCopy.finalAnswerGuidance,
        recommendedNextActions: localizedCopy.recommendedNextActions,
        warnings: commonWarnings,
        metadata: commonMetadata,
      });
    }

    const localizedCopy = buildLocalizedActionResultAssessmentCopy({
      locale,
      scenario: 'success',
    });

    return createAssessment({
      status: 'success',
      requestFulfillment: 'fulfilled',
      requestedAction,
      executionObserved: true,
      finalAnswerAssessment,
      reason: 'Runtime execution succeeded and no unsupported action claims were detected.',
      evidence,
      finalAnswerGuidance: localizedCopy.finalAnswerGuidance,
      recommendedNextActions: localizedCopy.recommendedNextActions,
      warnings: commonWarnings,
      metadata: commonMetadata,
    });
  }

  if ((actionClaimGuard?.unsupportedClaimCount ?? 0) > 0) {
    const localizedCopy = buildLocalizedActionResultAssessmentCopy({
      locale,
      scenario: 'no_execution_unsupported_claims',
    });

    return createAssessment({
      status: 'no_execution',
      requestFulfillment: 'not_fulfilled',
      requestedAction,
      executionObserved: false,
      finalAnswerAssessment,
      reason: 'The final answer contains action claims, but no matching runtime execution evidence exists.',
      evidence,
      finalAnswerGuidance: localizedCopy.finalAnswerGuidance,
      recommendedNextActions: localizedCopy.recommendedNextActions,
      warnings: commonWarnings,
      metadata: commonMetadata,
    });
  }

  const localizedCopy = buildLocalizedActionResultAssessmentCopy({
    locale,
    scenario: 'not_applicable',
  });

  return createAssessment({
    status: 'not_applicable',
    requestFulfillment: 'not_applicable',
    requestedAction,
    executionObserved: false,
    finalAnswerAssessment,
    reason: 'No runtime action needed verification for this invocation.',
    evidence,
    finalAnswerGuidance: localizedCopy.finalAnswerGuidance,
    recommendedNextActions: localizedCopy.recommendedNextActions,
    warnings: commonWarnings,
    metadata: commonMetadata,
  });
}
