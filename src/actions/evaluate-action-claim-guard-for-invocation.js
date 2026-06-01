import { assertActionClaimReport } from '../contracts/actions/action-claim-report-contract.js';
import { extractActionClaimReportFromOutputText } from './action-claim-report-envelope.js';

const ACTION_CLAIM_GUARD_VERSION = 2;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function buildRuntimeEvidenceSummary({
  actionResolution = null,
  brainToolExecution = null,
  brainWorkflowExecution = null,
  channelDeliveryResult = null,
}) {
  const toolExecutionPerformed = brainToolExecution?.executionPerformed === true;
  const workflowExecutionPerformed = brainWorkflowExecution?.executionPerformed === true;
  const channelDeliveryEvidence = channelDeliveryResult?.deliveryEvidence ?? null;
  const channelDeliveryAttempted = channelDeliveryEvidence?.adapterExecutionAttempted === true
    || channelDeliveryEvidence?.externalSendAttempted === true;
  const channelDeliveryConfirmed = channelDeliveryEvidence?.externalDeliveryConfirmed === true;

  return {
    actionResolutionStatus: actionResolution?.status ?? 'not_evaluated',
    actionResolutionRuntimeAction: actionResolution?.runtimeAction ?? null,
    selectedTargetType: actionResolution?.selectedCandidate?.targetType ?? null,
    selectedTargetId: actionResolution?.selectedCandidate?.targetId ?? null,
    selectedTargetSideEffectLevel: actionResolution?.selectedCandidate?.sideEffectLevel ?? null,
    selectedRuntimeActionExists: [
      'accepted',
      'approval_required',
    ].includes(actionResolution?.status),
    toolExecutionPerformed,
    toolId: brainToolExecution?.requestedToolId ?? null,
    toolRunId: brainToolExecution?.toolRunId ?? null,
    toolStatus: brainToolExecution?.toolResultStatus ?? null,
    toolObservationStatus: brainToolExecution?.observation?.status ?? null,
    toolExecutionSucceeded: toolExecutionPerformed && [
      brainToolExecution?.toolResultStatus,
      brainToolExecution?.observation?.status,
    ].includes('succeeded'),
    workflowExecutionPerformed,
    workflowId: brainWorkflowExecution?.requestedWorkflowId ?? null,
    workflowRunId: brainWorkflowExecution?.workflowRunId ?? null,
    workflowStatus: brainWorkflowExecution?.workflowRunStatus ?? null,
    workflowObservationStatus: brainWorkflowExecution?.observation?.status ?? null,
    workflowExecutionSucceeded: workflowExecutionPerformed && [
      brainWorkflowExecution?.workflowRunStatus,
      brainWorkflowExecution?.observation?.status,
    ].includes('succeeded'),
    channelDeliveryStatus: channelDeliveryResult?.status ?? null,
    channelDeliveryAttempted,
    channelDeliveryConfirmed,
    channelDeliverySimulated: channelDeliveryEvidence?.simulated === true,
    channelDeliveryEvidence: channelDeliveryEvidence
      ? {
        adapterExecutionAttempted: channelDeliveryEvidence.adapterExecutionAttempted,
        externalSendAttempted: channelDeliveryEvidence.externalSendAttempted,
        externalDeliveryConfirmed: channelDeliveryEvidence.externalDeliveryConfirmed,
        simulated: channelDeliveryEvidence.simulated,
      }
      : null,
  };
}

function createMatchedEvidence({
  evidenceType,
  targetId = null,
  runId = null,
  status = null,
  summary,
}) {
  return {
    evidenceType,
    targetId,
    runId,
    status,
    summary,
  };
}

function resolveSupportedEvidence({
  claim,
  evidenceSummary,
}) {
  if (claim.claimType === 'external_delivery') {
    if (evidenceSummary.channelDeliveryConfirmed) {
      return {
        evidenceStatus: 'supported',
        reason: 'The claim is supported by confirmed channel delivery evidence.',
        matchedEvidence: [
          createMatchedEvidence({
            evidenceType: 'channel_delivery',
            targetId: claim.targetId ?? evidenceSummary.selectedTargetId,
            status: evidenceSummary.channelDeliveryStatus,
            summary: 'Channel delivery evidence confirms external delivery.',
          }),
        ],
      };
    }

    return {
      evidenceStatus: 'unsupported',
      reason: 'External delivery claims require confirmed channel delivery evidence.',
      matchedEvidence: [],
    };
  }

  if (claim.claimType === 'state_mutation') {
    return {
      evidenceStatus: 'unsupported',
      reason: 'State mutation claims require explicit mutation evidence. Tool observations and memory writeback candidates are not durable mutation evidence.',
      matchedEvidence: [],
    };
  }

  if (claim.claimType === 'tool_or_workflow_execution') {
    if (evidenceSummary.toolExecutionPerformed) {
      return {
        evidenceStatus: 'supported',
        reason: 'The claim is supported by tool execution evidence.',
        matchedEvidence: [
          createMatchedEvidence({
            evidenceType: 'tool_execution',
            targetId: claim.targetId ?? evidenceSummary.toolId,
            runId: evidenceSummary.toolRunId,
            status: evidenceSummary.toolStatus,
            summary: 'A runtime tool execution was performed.',
          }),
        ],
      };
    }

    if (evidenceSummary.workflowExecutionPerformed) {
      return {
        evidenceStatus: 'supported',
        reason: 'The claim is supported by workflow execution evidence.',
        matchedEvidence: [
          createMatchedEvidence({
            evidenceType: 'workflow_execution',
            targetId: claim.targetId ?? evidenceSummary.workflowId,
            runId: evidenceSummary.workflowRunId,
            status: evidenceSummary.workflowStatus,
            summary: 'A runtime workflow execution was performed.',
          }),
        ],
      };
    }

    return {
      evidenceStatus: 'unsupported',
      reason: 'Tool or workflow execution claims require actual runtime execution evidence.',
      matchedEvidence: [],
    };
  }

  if (claim.claimType === 'completed_action') {
    if (evidenceSummary.toolExecutionSucceeded) {
      return {
        evidenceStatus: 'supported',
        reason: 'The completed-action claim is supported by successful tool observation evidence.',
        matchedEvidence: [
          createMatchedEvidence({
            evidenceType: 'tool_observation',
            targetId: claim.targetId ?? evidenceSummary.toolId,
            runId: evidenceSummary.toolRunId,
            status: evidenceSummary.toolObservationStatus,
            summary: 'A successful tool observation is available.',
          }),
        ],
      };
    }

    if (evidenceSummary.workflowExecutionSucceeded) {
      return {
        evidenceStatus: 'supported',
        reason: 'The completed-action claim is supported by successful workflow observation evidence.',
        matchedEvidence: [
          createMatchedEvidence({
            evidenceType: 'workflow_observation',
            targetId: claim.targetId ?? evidenceSummary.workflowId,
            runId: evidenceSummary.workflowRunId,
            status: evidenceSummary.workflowObservationStatus,
            summary: 'A successful workflow observation is available.',
          }),
        ],
      };
    }

    return {
      evidenceStatus: 'unsupported',
      reason: 'Completed-action claims require successful tool or workflow observation evidence.',
      matchedEvidence: [],
    };
  }

  if (claim.claimType === 'future_action') {
    if (evidenceSummary.selectedRuntimeActionExists) {
      return {
        evidenceStatus: 'supported',
        reason: 'The future-action claim is backed by a selected runtime action or approval path.',
        matchedEvidence: [
          createMatchedEvidence({
            evidenceType: 'action_resolution',
            targetId: claim.targetId ?? evidenceSummary.selectedTargetId,
            status: evidenceSummary.actionResolutionStatus,
            summary: `Runtime action ${evidenceSummary.actionResolutionRuntimeAction} is selected.`,
          }),
        ],
      };
    }

    return {
      evidenceStatus: 'unsupported',
      reason: 'Future-action claims require a selected runtime action or approval path.',
      matchedEvidence: [],
    };
  }

  return {
    evidenceStatus: 'unsupported',
    reason: `Unsupported claim type cannot be verified: ${claim.claimType}.`,
    matchedEvidence: [],
  };
}

function evaluateClaim({
  claim,
  evidenceSummary,
  source,
}) {
  const evidenceResolution = resolveSupportedEvidence({
    claim,
    evidenceSummary,
  });
  const warnings = evidenceResolution.evidenceStatus === 'supported'
    ? []
    : [
      `Unsupported action claim detected: "${claim.summary}" requires ${claim.evidenceRequirement}, but no matching runtime evidence exists.`,
    ];

  return {
    kind: 'action_claim',
    version: 1,
    claimId: claim.claimId,
    claimType: claim.claimType,
    actionSurface: claim.actionSurface,
    text: claim.summary,
    evidenceRequirement: claim.evidenceRequirement,
    evidenceStatus: evidenceResolution.evidenceStatus,
    reason: evidenceResolution.reason,
    matchedEvidence: evidenceResolution.matchedEvidence,
    warnings,
    metadata: {
      source,
      targetType: claim.targetType ?? evidenceSummary.selectedTargetType,
      targetId: claim.targetId ?? evidenceSummary.selectedTargetId,
      ...claim.metadata,
    },
  };
}

function buildStructuredClaimsFromReport(actionClaimReport) {
  return actionClaimReport.claims.map((claim) => {
    return {
      ...claim,
      metadata: isPlainObject(claim.metadata) ? { ...claim.metadata } : {},
    };
  });
}

function buildSyntheticStructuredClaimsFromEvidence(evidenceSummary) {
  const claims = [];

  if (evidenceSummary.selectedRuntimeActionExists && !evidenceSummary.toolExecutionPerformed && !evidenceSummary.workflowExecutionPerformed) {
    claims.push({
      kind: 'action_claim_declaration',
      version: 1,
      claimId: `synthetic-claim-${String(claims.length + 1).padStart(3, '0')}`,
      claimType: 'future_action',
      actionSurface: 'generic',
      evidenceRequirement: 'selected_runtime_action',
      summary: 'A runtime action was selected for execution or approval.',
      targetType: evidenceSummary.selectedTargetType,
      targetId: evidenceSummary.selectedTargetId,
      metadata: {},
    });
  }

  if (evidenceSummary.toolExecutionPerformed || evidenceSummary.workflowExecutionPerformed) {
    claims.push({
      kind: 'action_claim_declaration',
      version: 1,
      claimId: `synthetic-claim-${String(claims.length + 1).padStart(3, '0')}`,
      claimType: 'tool_or_workflow_execution',
      actionSurface: 'tool_or_workflow',
      evidenceRequirement: 'tool_or_workflow_execution',
      summary: 'A runtime tool or workflow execution was observed.',
      targetType: evidenceSummary.toolExecutionPerformed ? 'tool' : 'workflow',
      targetId: evidenceSummary.toolExecutionPerformed ? evidenceSummary.toolId : evidenceSummary.workflowId,
      metadata: {},
    });
  }

  if (evidenceSummary.toolExecutionSucceeded || evidenceSummary.workflowExecutionSucceeded) {
    claims.push({
      kind: 'action_claim_declaration',
      version: 1,
      claimId: `synthetic-claim-${String(claims.length + 1).padStart(3, '0')}`,
      claimType: 'completed_action',
      actionSurface: 'generic',
      evidenceRequirement: 'successful_runtime_observation',
      summary: 'A runtime action completed successfully and produced observation evidence.',
      targetType: evidenceSummary.toolExecutionSucceeded ? 'tool' : 'workflow',
      targetId: evidenceSummary.toolExecutionSucceeded ? evidenceSummary.toolId : evidenceSummary.workflowId,
      metadata: {},
    });
  }

  if (evidenceSummary.channelDeliveryConfirmed) {
    claims.push({
      kind: 'action_claim_declaration',
      version: 1,
      claimId: `synthetic-claim-${String(claims.length + 1).padStart(3, '0')}`,
      claimType: 'external_delivery',
      actionSurface: 'channel',
      evidenceRequirement: 'channel_delivery',
      summary: 'External channel delivery was confirmed by runtime evidence.',
      targetType: evidenceSummary.selectedTargetType,
      targetId: evidenceSummary.selectedTargetId,
      metadata: {},
    });
  }

  return claims;
}

function summarizeGuardStatus(claims) {
  if (claims.length === 0) {
    return 'no_claims';
  }

  const supportedClaimCount = claims.filter((claim) => claim.evidenceStatus === 'supported').length;

  if (supportedClaimCount === claims.length) {
    return 'supported';
  }

  if (supportedClaimCount === 0) {
    return 'unsupported';
  }

  return 'mixed';
}

function assertOptionalActionClaimReport(actionClaimReport) {
  if (actionClaimReport === undefined || actionClaimReport === null) {
    return null;
  }

  return assertActionClaimReport(actionClaimReport);
}

function shouldSuppressBenignNoActionClaimWarnings({
  extractedClaimReport,
  evidenceSummary,
}) {
  if (!Array.isArray(extractedClaimReport?.warnings) || extractedClaimReport.warnings.length === 0) {
    return false;
  }

  if (extractedClaimReport.actionClaimReport !== null) {
    return false;
  }

  return evidenceSummary.actionResolutionStatus === 'no_action'
    && evidenceSummary.toolExecutionPerformed !== true
    && evidenceSummary.workflowExecutionPerformed !== true
    && evidenceSummary.channelDeliveryAttempted !== true;
}

export function evaluateActionClaimGuardForInvocation({
  outputText,
  actionClaimReport = null,
  actionResolution = null,
  brainToolExecution = null,
  brainWorkflowExecution = null,
  channelDeliveryResult = null,
} = {}) {
  const evidenceSummary = buildRuntimeEvidenceSummary({
    actionResolution,
    brainToolExecution,
    brainWorkflowExecution,
    channelDeliveryResult,
  });
  const extractedClaimReport = actionClaimReport
    ? {
      visibleOutputText: outputText,
      actionClaimReport: assertOptionalActionClaimReport(actionClaimReport),
      warnings: [],
    }
    : extractActionClaimReportFromOutputText(outputText);
  const normalizedActionClaimReport = extractedClaimReport.actionClaimReport;
  const declaredClaims = normalizedActionClaimReport
    ? buildStructuredClaimsFromReport(normalizedActionClaimReport)
    : buildSyntheticStructuredClaimsFromEvidence(evidenceSummary);
  const claims = declaredClaims.map((claim) => {
    return evaluateClaim({
      claim,
      evidenceSummary,
      source: normalizedActionClaimReport ? 'structured_action_claim_report' : 'runtime_evidence_synthesis',
    });
  });
  const supportedClaimCount = claims.filter((claim) => claim.evidenceStatus === 'supported').length;
  const unsupportedClaimCount = claims.length - supportedClaimCount;
  const extractedWarnings = shouldSuppressBenignNoActionClaimWarnings({
    extractedClaimReport,
    evidenceSummary,
  })
    ? []
    : extractedClaimReport.warnings;
  const warnings = [
    ...extractedWarnings,
    ...claims.flatMap((claim) => claim.warnings),
  ];

  return {
    kind: 'action_claim_guard',
    version: ACTION_CLAIM_GUARD_VERSION,
    status: summarizeGuardStatus(claims),
    claimCount: claims.length,
    supportedClaimCount,
    unsupportedClaimCount,
    claims,
    evidenceSummary,
    actionClaimReport: normalizedActionClaimReport,
    visibleOutputText: extractedClaimReport.visibleOutputText,
    warnings,
  };
}

export {
  ACTION_CLAIM_GUARD_VERSION,
};
