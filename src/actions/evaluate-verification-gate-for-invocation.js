import { assertVerificationGate } from '../contracts/actions/verification-gate-contract.js';

const VERIFICATION_RELEVANT_CLAIM_TYPES = new Set([
  'tool_or_workflow_execution',
  'completed_action',
  'state_mutation',
]);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function uniqueStrings(values) {
  return [...new Set(values.filter(isNonEmptyString).map((value) => value.trim()))];
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

function buildRequirement({
  requirementId,
  evidenceType,
  targetType = null,
  targetId = null,
  required = true,
  present = false,
  verified = false,
  source = null,
  reason,
  metadata = {},
}) {
  return {
    requirementId,
    evidenceType,
    targetType,
    targetId,
    required,
    present,
    verified,
    source,
    reason,
    metadata,
  };
}

function buildToolObservationRequirements(brainToolExecution) {
  if (brainToolExecution?.executionPerformed !== true) {
    return [];
  }

  const observation = isPlainObject(brainToolExecution.observation)
    ? brainToolExecution.observation
    : null;
  const observationPresent = observation !== null;
  const observationVerified = observationPresent && isNonEmptyString(observation.status);
  const requirements = [
    buildRequirement({
      requirementId: 'tool-observation-record',
      evidenceType: 'tool_observation',
      targetType: 'tool',
      targetId: brainToolExecution.requestedToolId ?? observation?.toolId ?? null,
      present: observationPresent,
      verified: observationVerified,
      source: observation?.toolRunId ?? brainToolExecution.toolRunId ?? null,
      reason: observationPresent
        ? 'Tool execution has a matching runtime observation record.'
        : 'Successful tool execution requires a matching runtime observation record.',
    }),
  ];

  if (!observationPresent) {
    return requirements;
  }

  const previewPresent = observation.dataPreview !== null && observation.dataPreview !== undefined;
  const artifactPersisted = observation.resultEvidence?.fullResultArtifactPersisted === true;
  const shouldRequirePreview = artifactPersisted || previewPresent;

  if (shouldRequirePreview) {
    requirements.push(buildRequirement({
      requirementId: 'tool-observation-preview',
      evidenceType: 'observation_preview',
      targetType: 'tool',
      targetId: observation.toolId ?? brainToolExecution.requestedToolId ?? null,
      present: previewPresent,
      verified: previewPresent,
      source: previewPresent
        ? 'tool_observation.dataPreview'
        : 'tool_result_snapshot',
      reason: previewPresent
        ? 'Bounded tool observation preview evidence is available inline for verification.'
        : 'Tool observation references a persisted full result artifact, but no bounded inline preview evidence is available for verification.',
      metadata: {
        fullResultArtifactPersisted: artifactPersisted,
      },
    }));
  }

  return requirements;
}

function buildWorkflowObservationRequirements(brainWorkflowExecution) {
  if (brainWorkflowExecution?.executionPerformed !== true) {
    return [];
  }

  const observation = isPlainObject(brainWorkflowExecution.observation)
    ? brainWorkflowExecution.observation
    : null;

  return [
    buildRequirement({
      requirementId: 'workflow-observation-record',
      evidenceType: 'workflow_observation',
      targetType: 'workflow',
      targetId: brainWorkflowExecution.requestedWorkflowId ?? observation?.workflowId ?? null,
      present: observation !== null,
      verified: observation !== null && isNonEmptyString(observation.status),
      source: observation?.workflowRunId ?? brainWorkflowExecution.workflowRunId ?? null,
      reason: observation
        ? 'Workflow execution has a matching runtime observation record.'
        : 'Successful workflow execution requires a matching runtime observation record.',
    }),
  ];
}

function buildUnsupportedClaimRequirements(actionClaimGuard) {
  const unsupportedClaims = Array.isArray(actionClaimGuard?.claims)
    ? actionClaimGuard.claims.filter((claim) => {
      return claim.evidenceStatus === 'unsupported'
        && VERIFICATION_RELEVANT_CLAIM_TYPES.has(claim.claimType);
    })
    : [];

  return unsupportedClaims.map((claim, index) => {
    return buildRequirement({
      requirementId: `unsupported-claim-${String(index + 1).padStart(3, '0')}`,
      evidenceType: claim.claimType === 'state_mutation'
        ? 'state_mutation'
        : claim.claimType === 'completed_action'
          ? 'observation_preview'
          : 'tool_observation',
      targetType: claim.metadata?.targetType ?? null,
      targetId: claim.metadata?.targetId ?? null,
      present: false,
      verified: false,
      source: claim.claimId ?? null,
      reason: claim.reason ?? 'A verification-relevant action claim is unsupported by runtime evidence.',
      metadata: {
        claimId: claim.claimId,
        claimType: claim.claimType,
      },
    });
  });
}

function buildClaimSupportSummary(actionClaimGuard, requirements) {
  const totalClaims = Array.isArray(actionClaimGuard?.claims)
    ? actionClaimGuard.claims.length
    : 0;
  const relevantClaims = requirements.filter((requirement) => {
    return requirement.metadata?.claimType;
  });
  const unsupportedClaims = relevantClaims.length;

  return {
    totalClaims,
    relevantClaims: relevantClaims.length,
    supportedClaims: 0,
    unsupportedClaims,
  };
}

function buildRequirementSummary(requirements) {
  const requiredRequirements = requirements.filter((requirement) => requirement.required);
  const failedRequiredRequirements = requiredRequirements.filter((requirement) => !requirement.verified);
  const degradedRequirements = requiredRequirements.filter((requirement) => {
    return requirement.verified === false
      && requirement.evidenceType === 'observation_preview'
      && requirement.present === false
      && requirement.metadata?.fullResultArtifactPersisted === true;
  });

  return {
    totalRequired: requiredRequirements.length,
    failedRequiredCount: failedRequiredRequirements.length,
    degradedCount: degradedRequirements.length,
    hasFailures: failedRequiredRequirements.length > degradedRequirements.length
      || failedRequiredRequirements.some((requirement) => requirement.evidenceType !== 'observation_preview'),
    hasDegradationOnly: failedRequiredRequirements.length > 0
      && failedRequiredRequirements.length === degradedRequirements.length,
  };
}

export function evaluateVerificationGateForInvocation({
  actionResolution = null,
  brainToolExecution = null,
  brainWorkflowExecution = null,
  actionClaimGuard = null,
} = {}) {
  const requestedAction = buildRequestedAction(actionResolution);
  const toolRequirements = buildToolObservationRequirements(brainToolExecution);
  const workflowRequirements = buildWorkflowObservationRequirements(brainWorkflowExecution);
  const unsupportedClaimRequirements = buildUnsupportedClaimRequirements(actionClaimGuard);
  const evidenceRequirements = [
    ...toolRequirements,
    ...workflowRequirements,
    ...unsupportedClaimRequirements,
  ];
  const claimSupportSummary = buildClaimSupportSummary(actionClaimGuard, unsupportedClaimRequirements);
  const executionObserved = brainToolExecution?.executionPerformed === true
    || brainWorkflowExecution?.executionPerformed === true;
  const requirementSummary = buildRequirementSummary(evidenceRequirements);

  let status = 'not_applicable';
  let verificationOutcome = 'not_applicable';
  let reason = 'No runtime verification gate was required for this invocation.';
  let recommendedNextActions = [];

  if (requirementSummary.hasFailures) {
    status = 'failed';
    verificationOutcome = 'not_verified';
    reason = 'Verification requirements were not fully satisfied by runtime evidence.';
    recommendedNextActions = [
      'Inspect the persisted runtime observation and audit artifacts before relying on the final answer.',
      'Retry only after the missing verification evidence is restored or the unsupported runtime claim is removed.',
    ];
  } else if (requirementSummary.hasDegradationOnly) {
    status = 'degraded';
    verificationOutcome = 'partially_verified';
    reason = 'Runtime execution was observed, but bounded inline verification evidence is incomplete.';
    recommendedNextActions = [
      'Review the persisted artifact referenced by the runtime observation before relying on exact details in the final answer.',
      'Keep the final summary within the evidence that was actually surfaced inline for verification.',
    ];
  } else if (evidenceRequirements.length > 0) {
    status = 'passed';
    verificationOutcome = 'verified';
    reason = 'Runtime verification requirements were satisfied by persisted execution evidence.';
    recommendedNextActions = [
      'Use the persisted runtime observation and report as the authoritative audit evidence for this invocation.',
    ];
  }

  const warnings = uniqueStrings(
    evidenceRequirements
      .filter((requirement) => requirement.required && !requirement.verified)
      .map((requirement) => {
        return `Verification gate requirement ${requirement.requirementId} is not satisfied: ${requirement.reason}`;
      }),
  );

  return assertVerificationGate({
    kind: 'verification_gate',
    version: 1,
    status,
    verificationOutcome,
    requestedAction,
    executionObserved,
    evidenceRequirements,
    claimSupportSummary,
    reason,
    recommendedNextActions,
    warnings,
    metadata: {
      toolExecutionPerformed: brainToolExecution?.executionPerformed === true,
      workflowExecutionPerformed: brainWorkflowExecution?.executionPerformed === true,
    },
  });
}
