const DEFAULT_MAX_EVIDENCE_ITEMS = 4;
const DEFAULT_MAX_GUIDANCE_ITEMS = 3;
const DEFAULT_MAX_WARNINGS = 3;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function yesNo(value) {
  return value ? 'yes' : 'no';
}

function valueOrFallback(value, fallback = 'n/a') {
  return isNonEmptyString(value) ? value.trim() : fallback;
}

function formatCandidateTarget(candidate) {
  if (!candidate) {
    return 'n/a';
  }

  return `${valueOrFallback(candidate.targetType)}:${valueOrFallback(candidate.targetId)}`;
}

function resolveHumanOutcome({
  actionResolution,
  actionResultAssessment,
}) {
  if (actionResultAssessment?.approvalPaused || actionResolution?.status === 'approval_required') {
    return 'paused_for_approval';
  }

  if (
    actionResultAssessment?.clarificationRequired
    || actionResolution?.status === 'needs_clarification'
    || actionResolution?.status === 'ambiguous'
  ) {
    return 'asked_for_clarification';
  }

  if (actionResultAssessment?.executionObserved) {
    return 'acted';
  }

  if (actionResolution?.status === 'denied' || actionResolution?.status === 'no_capability') {
    return 'rejected';
  }

  if (actionResolution?.status === 'accepted') {
    return 'action_selected';
  }

  if (
    actionResolution?.status === 'no_action'
    || actionResolution?.runtimeAction === 'answer_only'
    || actionResultAssessment?.status === 'not_applicable'
  ) {
    return 'answered_only';
  }

  return 'not_evaluated';
}

function pushClarificationLines(lines, clarificationRequest) {
  if (!clarificationRequest) {
    return;
  }

  lines.push('  Clarification Request:');
  lines.push(`    Reason: ${valueOrFallback(clarificationRequest.reasonCategory)}`);
  lines.push(`    Blocking Execution: ${yesNo(clarificationRequest.blockingExecution)}`);
  lines.push(`    Question: ${valueOrFallback(clarificationRequest.question)}`);

  if (Array.isArray(clarificationRequest.candidateIds) && clarificationRequest.candidateIds.length > 0) {
    lines.push(`    Candidate IDs: ${clarificationRequest.candidateIds.join(', ')}`);
  }

  if (Array.isArray(clarificationRequest.missingContext) && clarificationRequest.missingContext.length > 0) {
    lines.push(`    Missing Context: ${clarificationRequest.missingContext.join(', ')}`);
  }
}

function pushActionClaimGuardLines(lines, actionClaimGuard, {
  maxWarnings,
}) {
  if (!actionClaimGuard) {
    return;
  }

  lines.push(
    `  Action Claim Guard: ${valueOrFallback(actionClaimGuard.status)} | claims=${actionClaimGuard.claimCount ?? 0} supported=${actionClaimGuard.supportedClaimCount ?? 0} unsupported=${actionClaimGuard.unsupportedClaimCount ?? 0}`,
  );

  if (Array.isArray(actionClaimGuard.claims) && actionClaimGuard.claims.length > 0) {
    for (const claim of actionClaimGuard.claims.slice(0, maxWarnings)) {
      lines.push(
        `    Claim ${valueOrFallback(claim.claimId)}: ${valueOrFallback(claim.evidenceStatus)} | ${valueOrFallback(claim.claimType)} | ${valueOrFallback(claim.reason)}`,
      );
    }
  }

  if (Array.isArray(actionClaimGuard.warnings) && actionClaimGuard.warnings.length > 0) {
    for (const warning of actionClaimGuard.warnings.slice(0, maxWarnings)) {
      lines.push(`    Claim Warning: ${warning}`);
    }

    const hiddenWarningCount = actionClaimGuard.warnings.length - maxWarnings;

    if (hiddenWarningCount > 0) {
      lines.push(`    Claim Warning: ${hiddenWarningCount} additional warning(s) omitted from CLI summary.`);
    }
  }
}

function pushActionResultAssessmentLines(lines, actionResultAssessment, {
  maxEvidenceItems,
  maxGuidanceItems,
}) {
  if (!actionResultAssessment) {
    return;
  }

  lines.push(
    `  Result Assessment: ${valueOrFallback(actionResultAssessment.status)} | fulfillment=${valueOrFallback(actionResultAssessment.requestFulfillment)} | executionObserved=${yesNo(actionResultAssessment.executionObserved)}`,
  );
  lines.push(
    `  Result Controls: approvalPaused=${yesNo(actionResultAssessment.approvalPaused)} | clarificationRequired=${yesNo(actionResultAssessment.clarificationRequired)} | grounded=${yesNo(actionResultAssessment.finalAnswerAssessment?.answerGroundedInEvidence)}`,
  );
  lines.push(`  Result Reason: ${valueOrFallback(actionResultAssessment.reason)}`);

  if (Array.isArray(actionResultAssessment.evidence) && actionResultAssessment.evidence.length > 0) {
    lines.push('  Evidence:');

    for (const evidenceItem of actionResultAssessment.evidence.slice(0, maxEvidenceItems)) {
      const targetLabel = evidenceItem.targetId ? ` target=${evidenceItem.targetId}` : '';
      const runLabel = evidenceItem.runId ? ` run=${evidenceItem.runId}` : '';

      lines.push(
        `    - ${valueOrFallback(evidenceItem.evidenceType)} | status=${valueOrFallback(evidenceItem.status)}${targetLabel}${runLabel} | ${valueOrFallback(evidenceItem.summary)}`,
      );
    }

    const hiddenEvidenceCount = actionResultAssessment.evidence.length - maxEvidenceItems;

    if (hiddenEvidenceCount > 0) {
      lines.push(`    - ${hiddenEvidenceCount} additional evidence item(s) omitted from CLI summary.`);
    }
  }

  if (Array.isArray(actionResultAssessment.recommendedNextActions) && actionResultAssessment.recommendedNextActions.length > 0) {
    lines.push('  Recommended Next Actions:');

    for (const nextAction of actionResultAssessment.recommendedNextActions.slice(0, maxGuidanceItems)) {
      lines.push(`    - ${nextAction}`);
    }
  }
}

function hasActionRuntimeData(output) {
  return Boolean(
    output?.actionResolution
    || output?.actionClaimGuard
    || output?.actionResultAssessment
    || output?.humanApprovalRequest
    || output?.humanApprovalState,
  );
}

export function formatActionRuntimeUxForCli(output, {
  maxEvidenceItems = DEFAULT_MAX_EVIDENCE_ITEMS,
  maxGuidanceItems = DEFAULT_MAX_GUIDANCE_ITEMS,
  maxWarnings = DEFAULT_MAX_WARNINGS,
} = {}) {
  if (!isPlainObject(output) || !hasActionRuntimeData(output)) {
    return [];
  }

  const actionResolution = output.actionResolution ?? null;
  const actionClaimGuard = output.actionClaimGuard ?? null;
  const actionResultAssessment = output.actionResultAssessment ?? null;
  const selectedCandidate = actionResolution?.selectedCandidate ?? null;
  const clarificationRequest = actionResolution?.clarificationRequest ?? null;
  const lines = [
    'Action Runtime:',
    `  Outcome: ${resolveHumanOutcome({ actionResolution, actionResultAssessment })}`,
  ];

  if (actionResolution) {
    lines.push(
      `  Action Resolution: ${valueOrFallback(actionResolution.status)} | runtime=${valueOrFallback(actionResolution.runtimeAction)} | source=${valueOrFallback(actionResolution.source)}`,
    );
    lines.push(
      `  Selected Target: ${formatCandidateTarget(selectedCandidate)} | action=${valueOrFallback(selectedCandidate?.actionType)} | sideEffect=${valueOrFallback(selectedCandidate?.sideEffectLevel)}`,
    );
    lines.push(
      `  Execution Gate: allowed=${yesNo(actionResolution.executionAllowed)} | approvalRequired=${yesNo(actionResolution.approvalRequired)}`,
    );
    lines.push(`  Resolution Reason: ${valueOrFallback(actionResolution.reason)}`);
  }

  pushClarificationLines(lines, clarificationRequest);
  pushActionClaimGuardLines(lines, actionClaimGuard, {
    maxWarnings,
  });
  pushActionResultAssessmentLines(lines, actionResultAssessment, {
    maxEvidenceItems,
    maxGuidanceItems,
  });

  if (output.humanApprovalRequest || output.humanApprovalState) {
    lines.push(
      `  Human Approval: request=${valueOrFallback(output.humanApprovalRequest?.approvalRequestId)} | state=${valueOrFallback(output.humanApprovalState?.status)}`,
    );
  }

  return lines;
}
