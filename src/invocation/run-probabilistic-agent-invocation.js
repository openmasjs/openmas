import { assembleBrainInputForInvocation } from '../brain/assemble-brain-input-for-invocation.js';
import { normalizeProviderResponseToBrainOutput } from '../brain/normalize-provider-response-to-brain-output.js';
import { createHumanApprovalRuntimeForToolRequest } from '../approvals/create-human-approval-runtime-for-tool-request.js';
import { assertBrainToolRequestResolution } from '../contracts/brain/brain-tool-request-contract.js';
import { assertBrainWorkflowRequestResolution } from '../contracts/brain/brain-workflow-request-contract.js';
import {
  DEFAULT_PROVIDER_RETRY_POLICY,
  assertProviderRetryPolicy,
} from '../contracts/providers/provider-retry-policy-contract.js';
import { assertProviderResponse } from '../contracts/providers/provider-response-contract.js';
import { executeProviderRequest } from '../providers/execute-provider-request.js';
import { executeProviderRequestWithRetry } from '../providers/execute-provider-request-with-retry.js';
import { buildProviderFallbackDecisionTrace } from '../providers/build-provider-fallback-decision-trace.js';
import { executeAcceptedBrainToolRequest } from '../tools/execute-accepted-brain-tool-request.js';
import { resolveBrainToolRequestForInvocation } from '../tools/resolve-brain-tool-request-for-invocation.js';
import { executeAcceptedBrainWorkflowRequest } from '../workflows/execute-accepted-brain-workflow-request.js';
import { resolveBrainWorkflowRequestForInvocation } from '../workflows/resolve-brain-workflow-request-for-invocation.js';
import { readWorkflowRuntimeDefinitions } from '../workflows/read-workflow-runtime-definitions.js';
import { resolveActionForInvocation } from '../actions/resolve-action-for-invocation.js';
import { runSemanticIntentRuntimeForInvocation } from '../actions/run-semantic-intent-runtime-for-invocation.js';
import { evaluateActionClaimGuardForInvocation } from '../actions/evaluate-action-claim-guard-for-invocation.js';
import { evaluateVerificationGateForInvocation } from '../actions/evaluate-verification-gate-for-invocation.js';
import { evaluateActionResultAssessmentForInvocation } from '../actions/evaluate-action-result-assessment-for-invocation.js';
import { extractActionClaimReportFromOutputText } from '../actions/action-claim-report-envelope.js';
import { buildAgentExecutionPlanForInvocation } from '../plans/build-agent-execution-plan-for-invocation.js';
import { coordinatePlanExecutionForInvocation } from '../plans/coordinate-plan-execution-for-invocation.js';
import { governPlanPreviewOutput } from './govern-plan-preview-output.js';
import { governVisibleBrainOutput } from './govern-visible-brain-output.js';

function summarizeBrainInput(brainInput) {
  return {
    providerId: brainInput.providerId,
    modelId: brainInput.modelId,
    operationalIdentityId: brainInput.operationalIdentityId,
    operationalDisplayName: brainInput.operationalDisplayName,
    primaryCognitiveIdentityId: brainInput.primaryCognitiveIdentityId,
    secondaryCognitiveIdentityIds: brainInput.secondaryCognitiveIdentityIds,
    command: brainInput.command,
    requestedBy: brainInput.requestedBy,
    promptProfileId: brainInput.promptProfileId,
    promptStackVersionId: brainInput.promptStackVersionId,
    inputTextLength: brainInput.inputText.length,
    systemInstructionsLength: brainInput.systemInstructions.length,
    userInputLength: brainInput.userInput.length,
    messageCount: brainInput.messages.length,
  };
}

function summarizeProviderRequest(providerRequest) {
  return {
    providerId: providerRequest.providerId,
    modelId: providerRequest.modelId,
    requestType: providerRequest.requestType,
    messageCount: providerRequest.messages.length,
    temperature: providerRequest.temperature,
    maxOutputTokens: providerRequest.maxOutputTokens,
  };
}

function formatAttemptLabel(attempt) {
  return `${attempt.brainRole}/${attempt.passKind}`;
}

function buildReportContent({
  request,
  readiness,
  brainOutput,
  brainExecution,
  fallbackDecisionTrace = null,
  intentResolution = null,
  actionResolution = null,
  toolRequestResolution = null,
  brainToolExecution = null,
  workflowRequestResolution = null,
  brainWorkflowExecution = null,
  semanticIntentRuntime = null,
  actionClaimGuard = null,
  verificationGate = null,
  actionResultAssessment = null,
  humanApprovalRuntime = null,
  executionPlan = null,
  planExecutionCoordination = null,
}) {
  const displayName = readiness.operationalIdentityDefinition?.displayName ?? readiness.resolvedPrimaryCognitiveIdentityId;
  const statusLabel = brainOutput.status === 'completed' ? 'Completed' : 'Failed';
  const outputSection = brainOutput.status === 'completed'
    ? brainOutput.outputText
    : brainOutput.errorMessage;
  const toolWritebackRequest = brainToolExecution?.memoryWritebackRequest ?? null;
  const workflowWritebackRequest = brainWorkflowExecution?.memoryWritebackRequest ?? null;
  const toolWritebackCandidateCount = toolWritebackRequest?.memoryWrites?.length ?? 0;
  const workflowWritebackCandidateCount = workflowWritebackRequest?.memoryWrites?.length ?? 0;
  const writebackRequiresApproval = Boolean(
    toolWritebackRequest?.requiresHumanApproval
    || workflowWritebackRequest?.requiresHumanApproval,
  );

  return [
    '# Probabilistic Brain Invocation Report',
    '',
    `Status: ${statusLabel}`,
    `Operational Identity: ${readiness.operationalIdentityDefinition?.operationalIdentityId ?? 'n/a'}`,
    `Display Name: ${displayName}`,
    `Primary Cognitive Identity: ${readiness.activeCognitiveSet.primaryCognitiveIdentityId}`,
    `Provider: ${brainOutput.providerId}`,
    `Model: ${brainOutput.modelId}`,
    `Command: ${request.command}`,
    `Final Brain Role: ${brainExecution.finalBrainRole}`,
    `Fallback Used: ${brainExecution.fallbackUsed ? 'yes' : 'no'}`,
    '',
    brainOutput.status === 'completed' ? '## Answer' : '## Failure',
    '',
    outputSection,
    '',
    '## Usage Accounting',
    '',
    `Input Tokens: ${brainOutput.usage.inputTokens ?? 'n/a'}`,
    `Output Tokens: ${brainOutput.usage.outputTokens ?? 'n/a'}`,
    `Total Tokens: ${brainOutput.usage.totalTokens ?? 'n/a'}`,
    '',
    '## Brain Execution Attempts',
    '',
    ...brainExecution.attempts.map((attempt) => {
      return `- ${formatAttemptLabel(attempt)}: ${attempt.status} (${attempt.providerId ?? 'n/a'} / ${attempt.modelId ?? 'n/a'}) - ${attempt.reason}`;
    }),
    '',
    '## Provider Metadata',
    '',
    `Finish Reason: ${brainOutput.finishReason ?? 'n/a'}`,
    `Provider Response ID: ${brainOutput.providerResponseId ?? 'n/a'}`,
    `Failure Category: ${brainOutput.providerFailure?.category ?? 'n/a'}`,
    `Failure Retryable: ${brainOutput.providerFailure ? (brainOutput.providerFailure.retryable ? 'yes' : 'no') : 'n/a'}`,
    `Failure Diagnostic: ${brainOutput.providerFailure?.diagnosticSummary ?? 'n/a'}`,
    `Provider Attempts: ${brainExecution.attempts.at(-1)?.providerRetryExecution?.totalAttempts ?? 'n/a'}`,
    `Retry Stop Reason: ${brainExecution.attempts.at(-1)?.providerRetryExecution?.stoppedReason ?? 'n/a'}`,
    '',
    '## Fallback Decision Trace',
    '',
    `Status: ${fallbackDecisionTrace?.status ?? 'n/a'}`,
    `Policy Allows Fallback: ${fallbackDecisionTrace ? (fallbackDecisionTrace.policyAllowsFallback ? 'yes' : 'no') : 'n/a'}`,
    `Primary Provider: ${fallbackDecisionTrace?.primaryProviderId ?? 'n/a'}`,
    `Primary Status: ${fallbackDecisionTrace?.primaryProviderStatus ?? 'n/a'}`,
    `Primary Failure Category: ${fallbackDecisionTrace?.primaryFailureCategory ?? 'n/a'}`,
    `Fallback Provider: ${fallbackDecisionTrace?.fallbackProviderId ?? 'n/a'}`,
    `Fallback Status: ${fallbackDecisionTrace?.fallbackProviderStatus ?? 'n/a'}`,
    `Fallback Failure Category: ${fallbackDecisionTrace?.fallbackFailureCategory ?? 'n/a'}`,
    `Fallback Attempted: ${fallbackDecisionTrace ? (fallbackDecisionTrace.fallbackAttempted ? 'yes' : 'no') : 'n/a'}`,
    `Fallback Used: ${fallbackDecisionTrace ? (fallbackDecisionTrace.fallbackUsed ? 'yes' : 'no') : 'n/a'}`,
    `Fallback Succeeded: ${fallbackDecisionTrace ? (fallbackDecisionTrace.fallbackSucceeded ? 'yes' : 'no') : 'n/a'}`,
    `Decision Reason: ${fallbackDecisionTrace?.decisionReason ?? 'n/a'}`,
    `Semantic Classifier Impact: ${fallbackDecisionTrace?.semanticClassifierImpact?.summary ?? 'n/a'}`,
    '',
    '## Semantic Intent Runtime',
    '',
    `Status: ${semanticIntentRuntime?.status ?? 'not_evaluated'}`,
    `Mode: ${semanticIntentRuntime?.mode ?? 'n/a'}`,
    `Classifier: ${semanticIntentRuntime?.semanticIntentClassification?.classifierId ?? 'n/a'}`,
    `Classifier Failure Kind: ${semanticIntentRuntime?.providerClassifierAudit?.failureKind ?? semanticIntentRuntime?.semanticIntentClassification?.failureKind ?? 'n/a'}`,
    `Classifier Provider Failure Category: ${semanticIntentRuntime?.providerClassifierAudit?.providerFailureCategory ?? semanticIntentRuntime?.semanticIntentClassification?.providerFailureCategory ?? 'n/a'}`,
    `Affordances: ${semanticIntentRuntime?.actionAffordanceReadResult?.summary?.total ?? 'n/a'}`,
    `Conversation Turns: ${semanticIntentRuntime?.conversationContextSummary?.includedTurnCount ?? 'n/a'}`,
    `Reason: ${semanticIntentRuntime?.reason ?? 'n/a'}`,
    '',
    '## Intent Resolution',
    '',
    `Status: ${intentResolution?.status ?? 'not_evaluated'}`,
    `Intent: ${intentResolution?.intentId ?? 'n/a'}`,
    `Intent Type: ${intentResolution?.intentType ?? 'n/a'}`,
    `Source: ${intentResolution?.source ?? 'n/a'}`,
    `Confidence: ${intentResolution?.confidence ?? 'n/a'}`,
    `Target: ${intentResolution?.target ? `${intentResolution.target.targetType}:${intentResolution.target.targetId}` : 'n/a'}`,
    `Runtime Action: ${intentResolution?.runtimeAction ?? 'n/a'}`,
    `Reason: ${intentResolution?.reason ?? 'n/a'}`,
    '',
    '## Action Resolution',
    '',
    `Status: ${actionResolution?.status ?? 'not_evaluated'}`,
    `Source: ${actionResolution?.source ?? 'n/a'}`,
    `Runtime Action: ${actionResolution?.runtimeAction ?? 'n/a'}`,
    `Selected Target: ${actionResolution?.selectedCandidate ? `${actionResolution.selectedCandidate.targetType}:${actionResolution.selectedCandidate.targetId}` : 'n/a'}`,
    `Execution Allowed: ${actionResolution?.executionAllowed ? 'yes' : 'no'}`,
    `Approval Required: ${actionResolution?.approvalRequired ? 'yes' : 'no'}`,
    `Reason: ${actionResolution?.reason ?? 'n/a'}`,
    '',
    '## Execution Plan',
    '',
    `Plan Present: ${executionPlan ? 'yes' : 'no'}`,
    `Plan ID: ${executionPlan?.planId ?? 'n/a'}`,
    `Goal: ${executionPlan?.goal ?? 'n/a'}`,
    `Step Count: ${executionPlan?.steps?.length ?? 0}`,
    `Required Tools: ${executionPlan?.requiredTools?.join(', ') || 'none'}`,
    `Required Workflows: ${executionPlan?.requiredWorkflows?.join(', ') || 'none'}`,
    `Required Approvals: ${executionPlan?.requiredApprovals?.length ?? 0}`,
    '',
    '## Plan Execution Coordination',
    '',
    `Status: ${planExecutionCoordination?.status ?? 'not_evaluated'}`,
    `Runtime Action: ${planExecutionCoordination?.runtimeAction ?? 'n/a'}`,
    `Selected Step: ${planExecutionCoordination?.selectedStepId ?? 'n/a'}`,
    `Selected Target: ${planExecutionCoordination?.selectedTargetType && planExecutionCoordination?.selectedTargetId ? `${planExecutionCoordination.selectedTargetType}:${planExecutionCoordination.selectedTargetId}` : 'n/a'}`,
    `Execution Allowed: ${planExecutionCoordination ? (planExecutionCoordination.executionAllowed ? 'yes' : 'no') : 'n/a'}`,
    `Execution Blocked: ${planExecutionCoordination ? (planExecutionCoordination.executionBlocked ? 'yes' : 'no') : 'n/a'}`,
    `Approval Required: ${planExecutionCoordination ? (planExecutionCoordination.approvalRequired ? 'yes' : 'no') : 'n/a'}`,
    `Approval Request ID: ${planExecutionCoordination?.approvalRequestId ?? 'n/a'}`,
    `Reason: ${planExecutionCoordination?.reason ?? 'n/a'}`,
    '',
    '## Brain Tool Request',
    '',
    `Status: ${toolRequestResolution?.status ?? 'not_evaluated'}`,
    `Requested Tool: ${toolRequestResolution?.requestedToolId ?? 'n/a'}`,
    `Runtime Action: ${toolRequestResolution?.runtimeAction ?? 'n/a'}`,
    `Execution Allowed: ${toolRequestResolution?.executionAllowed ? 'yes' : 'no'}`,
    `Approval Required: ${toolRequestResolution?.approvalRequired ? 'yes' : 'no'}`,
    `Auto Execution Performed: ${toolRequestResolution?.autoExecutionPerformed ? 'yes' : 'no'}`,
    `Reason: ${toolRequestResolution?.reason ?? 'n/a'}`,
    '',
    '## Brain Tool Execution',
    '',
    `Status: ${brainToolExecution?.status ?? 'not_evaluated'}`,
    `Execution Performed: ${brainToolExecution?.executionPerformed ? 'yes' : 'no'}`,
    `Tool Run ID: ${brainToolExecution?.toolRunId ?? 'n/a'}`,
    `Tool Result Status: ${brainToolExecution?.toolResultStatus ?? 'n/a'}`,
    `Continuation Policy: ${brainToolExecution?.continuationPolicy ?? 'n/a'}`,
    `Audit Record Path: ${brainToolExecution?.toolAuditRecordPath ?? 'n/a'}`,
    `Reason: ${brainToolExecution?.reason ?? 'n/a'}`,
    '',
    '## Tool Observation',
    '',
    `Observation Status: ${brainToolExecution?.observation?.status ?? 'n/a'}`,
    `Observation Summary: ${brainToolExecution?.observation?.summary ?? 'n/a'}`,
    `Artifact References: ${brainToolExecution?.observation?.artifactReferences?.length ?? 0}`,
    '',
    '## Brain Workflow Request',
    '',
    `Status: ${workflowRequestResolution?.status ?? 'not_evaluated'}`,
    `Requested Workflow: ${workflowRequestResolution?.requestedWorkflowId ?? 'n/a'}`,
    `Runtime Action: ${workflowRequestResolution?.runtimeAction ?? 'n/a'}`,
    `Execution Allowed: ${workflowRequestResolution?.executionAllowed ? 'yes' : 'no'}`,
    `Auto Execution Performed: ${workflowRequestResolution?.autoExecutionPerformed ? 'yes' : 'no'}`,
    `Reason: ${workflowRequestResolution?.reason ?? 'n/a'}`,
    '',
    '## Brain Workflow Execution',
    '',
    `Status: ${brainWorkflowExecution?.status ?? 'not_evaluated'}`,
    `Execution Performed: ${brainWorkflowExecution?.executionPerformed ? 'yes' : 'no'}`,
    `Workflow Run ID: ${brainWorkflowExecution?.workflowRunId ?? 'n/a'}`,
    `Workflow Run Status: ${brainWorkflowExecution?.workflowRunStatus ?? 'n/a'}`,
    `Workflow State Path: ${brainWorkflowExecution?.workflowRunStateRecordPath ?? 'n/a'}`,
    `Reason: ${brainWorkflowExecution?.reason ?? 'n/a'}`,
    '',
    '## Workflow Observation',
    '',
    `Observation Status: ${brainWorkflowExecution?.observation?.status ?? 'n/a'}`,
    `Observation Summary: ${brainWorkflowExecution?.observation?.summary ?? 'n/a'}`,
    `Step Summaries: ${brainWorkflowExecution?.observation?.stepSummaries?.length ?? 0}`,
    '',
    '## Tool Observation Follow-up',
    '',
    `Follow-up Performed: ${brainExecution.toolObservationFollowupPerformed ? 'yes' : 'no'}`,
    '',
    '## Workflow Observation Follow-up',
    '',
    `Follow-up Performed: ${brainExecution.workflowObservationFollowupPerformed ? 'yes' : 'no'}`,
    `Final Pass Kind: ${brainExecution.finalPassKind ?? 'n/a'}`,
    `Final Provider: ${brainExecution.finalProviderId ?? 'n/a'}`,
    `Final Model: ${brainExecution.finalModelId ?? 'n/a'}`,
    '',
    '## Action Claim Guard',
    '',
    `Status: ${actionClaimGuard?.status ?? 'not_evaluated'}`,
    `Claim Count: ${actionClaimGuard?.claimCount ?? 0}`,
    `Supported Claims: ${actionClaimGuard?.supportedClaimCount ?? 0}`,
    `Unsupported Claims: ${actionClaimGuard?.unsupportedClaimCount ?? 0}`,
    `Warnings: ${actionClaimGuard?.warnings?.length ?? 0}`,
    ...(actionClaimGuard?.warnings?.length > 0
      ? actionClaimGuard.warnings.map((warning) => `- ${warning}`)
      : ['- none']),
    '',
    '## Verification Gate',
    '',
    `Status: ${verificationGate?.status ?? 'not_evaluated'}`,
    `Verification Outcome: ${verificationGate?.verificationOutcome ?? 'n/a'}`,
    `Execution Observed: ${verificationGate ? (verificationGate.executionObserved ? 'yes' : 'no') : 'n/a'}`,
    `Requirement Count: ${verificationGate?.evidenceRequirements?.length ?? 0}`,
    `Unsupported Relevant Claims: ${verificationGate?.claimSupportSummary?.unsupportedClaims ?? 0}`,
    `Reason: ${verificationGate?.reason ?? 'n/a'}`,
    'Verification Warnings:',
    ...(verificationGate?.warnings?.length > 0
      ? verificationGate.warnings.map((warning) => `- ${warning}`)
      : ['- none']),
    '',
    '## Action Result Assessment',
    '',
    `Status: ${actionResultAssessment?.status ?? 'not_evaluated'}`,
    `Request Fulfillment: ${actionResultAssessment?.requestFulfillment ?? 'n/a'}`,
    `Execution Observed: ${actionResultAssessment?.executionObserved ? 'yes' : 'no'}`,
    `Approval Paused: ${actionResultAssessment?.approvalPaused ? 'yes' : 'no'}`,
    `Clarification Required: ${actionResultAssessment?.clarificationRequired ? 'yes' : 'no'}`,
    `Answer Grounded In Evidence: ${actionResultAssessment?.finalAnswerAssessment?.answerGroundedInEvidence ? 'yes' : 'no'}`,
    `Reason: ${actionResultAssessment?.reason ?? 'n/a'}`,
    'Final Answer Guidance:',
    ...(actionResultAssessment?.finalAnswerGuidance?.length > 0
      ? actionResultAssessment.finalAnswerGuidance.map((guidance) => `- ${guidance}`)
      : ['- none']),
    'Recommended Next Actions:',
    ...(actionResultAssessment?.recommendedNextActions?.length > 0
      ? actionResultAssessment.recommendedNextActions.map((nextAction) => `- ${nextAction}`)
      : ['- none']),
    '',
    '## Human Approval',
    '',
    `Approval Request ID: ${humanApprovalRuntime?.approvalRequest?.approvalRequestId ?? 'n/a'}`,
    `Approval State: ${humanApprovalRuntime?.approvalState?.status ?? 'n/a'}`,
    `Execution Blocked: ${humanApprovalRuntime?.approvalState?.executionBlocked ? 'yes' : 'no'}`,
    `Execution Authorized: ${humanApprovalRuntime?.approvalState?.executionAuthorized ? 'yes' : 'no'}`,
    '',
    '## Memory Writeback Candidates',
    '',
    `Tool Candidate Count: ${toolWritebackCandidateCount}`,
    `Tool Writeback Path: ${brainToolExecution?.memoryWritebackPersistence?.recordPath ?? 'n/a'}`,
    `Workflow Candidate Count: ${workflowWritebackCandidateCount}`,
    `Workflow Writeback Path: ${brainWorkflowExecution?.memoryWritebackPersistence?.recordPath ?? 'n/a'}`,
    `Requires Human Approval: ${writebackRequiresApproval ? 'yes' : 'no'}`,
    'Durable Memory Mutation: no',
    '',
  ].join('\n');
}

function markResolutionAfterBrainToolExecution({
  toolRequestResolution,
  brainToolExecution,
}) {
  if (
    toolRequestResolution?.status !== 'accepted'
    || brainToolExecution?.executionPerformed !== true
  ) {
    return toolRequestResolution;
  }

  return assertBrainToolRequestResolution({
    ...toolRequestResolution,
    autoExecutionPerformed: true,
    reason: `${toolRequestResolution.reason} Runtime execution was performed for tool run ${brainToolExecution.toolRunId}.`,
  });
}

function markResolutionAfterBrainWorkflowExecution({
  workflowRequestResolution,
  brainWorkflowExecution,
}) {
  if (
    workflowRequestResolution?.status !== 'accepted'
    || brainWorkflowExecution?.executionPerformed !== true
  ) {
    return workflowRequestResolution;
  }

  return assertBrainWorkflowRequestResolution({
    ...workflowRequestResolution,
    autoExecutionPerformed: true,
    reason: `${workflowRequestResolution.reason} Runtime execution was performed for workflow run ${brainWorkflowExecution.workflowRunId}.`,
  });
}

function updateFinalAttemptToolResolution({
  brainExecution,
  toolRequestResolution,
}) {
  return {
    ...brainExecution,
    attempts: brainExecution.attempts.map((attempt) => {
      if (attempt.brainRole !== brainExecution.finalBrainRole) {
        return attempt;
      }

      return {
        ...attempt,
        toolRequestResolution,
      };
    }),
  };
}

function updateFinalAttemptWorkflowResolution({
  brainExecution,
  workflowRequestResolution,
}) {
  return {
    ...brainExecution,
    attempts: brainExecution.attempts.map((attempt) => {
      if (attempt.brainRole !== brainExecution.finalBrainRole) {
        return attempt;
      }

      return {
        ...attempt,
        workflowRequestResolution,
      };
    }),
  };
}

function assertOperationalIdentityPrerequisite({ readiness }) {
  if (!readiness.operationalIdentityDefinition) {
    throw new Error('Probabilistic invocation requires an Operational Identity.');
  }
}

function buildAttemptRecord({
  brainRole,
  passKind = 'initial_reasoning',
  preparedProvider,
  status,
  reason,
  brainInputSummary = null,
  providerRequestSummary = null,
  instructionLayerSummary = null,
  promptProfileSelection = null,
  promptBudgetReport = null,
  promptProvenance = null,
  brainOutput = null,
  providerResponse = null,
  providerRetryExecution = null,
  toolRequestResolution = null,
  workflowRequestResolution = null,
  humanApprovalRuntime = null,
}) {
  return {
    brainRole,
    passKind,
    brainId: preparedProvider?.brainId ?? null,
    providerId: preparedProvider?.providerId ?? null,
    modelId: preparedProvider?.modelId ?? null,
    providerPreparationStatus: preparedProvider?.status ?? null,
    credentialReferenceId: preparedProvider?.credentialReferenceId ?? null,
    status,
    reason,
    brainInputSummary,
    providerRequestSummary,
    instructionLayerSummary,
    promptProfileSelection,
    promptBudgetReport,
    promptProvenance,
    brainOutput,
    providerResponse,
    providerRetryExecution,
    toolRequestResolution,
    workflowRequestResolution,
    humanApprovalRuntime,
  };
}

function resolveBrainReferenceForRole({ readiness, brainRole }) {
  if (brainRole === 'primary') {
    return readiness.brainSelection?.selectedBrain ?? null;
  }

  if (brainRole === 'fallback') {
    return readiness.brainSelection?.fallbackBrain ?? null;
  }

  throw new Error(`Unsupported brain role: ${brainRole}`);
}

function resolvePreparedProviderForRole({ readiness, brainRole }) {
  if (brainRole === 'primary') {
    return readiness.providerPreparation?.selectedBrainProvider ?? null;
  }

  if (brainRole === 'fallback') {
    return readiness.providerPreparation?.fallbackBrainProvider ?? null;
  }

  throw new Error(`Unsupported brain role: ${brainRole}`);
}

const INVALID_ACTION_CLAIM_ENVELOPE_WARNING_PATTERN = /Action claim report envelope was invalid and was ignored:/u;
const MULTIPLE_ACTION_CLAIM_ENVELOPE_WARNING_PATTERN = /Action claim report envelope appeared multiple times;/u;

export function filterBenignNonExecutionClaimEnvelopeWarnings({
  warnings,
  actionResolution,
  brainToolExecution,
  brainWorkflowExecution,
}) {
  if (!Array.isArray(warnings) || warnings.length === 0) {
    return warnings;
  }

  if (!['no_action', 'plan_only'].includes(actionResolution?.status)) {
    return warnings;
  }

  if (brainToolExecution?.executionPerformed === true || brainWorkflowExecution?.executionPerformed === true) {
    return warnings;
  }

  const filteredWarnings = warnings.filter((warning) => {
    return !INVALID_ACTION_CLAIM_ENVELOPE_WARNING_PATTERN.test(warning)
      && !MULTIPLE_ACTION_CLAIM_ENVELOPE_WARNING_PATTERN.test(warning);
  });

  return filteredWarnings.length === warnings.length ? warnings : filteredWarnings;
}

export function shouldPerformProviderToolObservationFollowup(brainToolExecution) {
  return brainToolExecution?.continuationPolicy === 'continue_with_provider';
}

function buildKernelOwnedToolAcknowledgement(brainToolExecution) {
  const dataPreview = brainToolExecution.observation?.dataPreview ?? null;

  if (brainToolExecution.requestedToolId === 'mas.os.delegate') {
    if (dataPreview?.delegated === true) {
      return 'Delegation was accepted by the OpenMAS OS kernel. The parent is waiting for the delegated child Result Record.';
    }

    return 'Delegation was submitted to the OpenMAS OS kernel. No delegated child Result Record exists yet.';
  }

  if (brainToolExecution.requestedToolId === 'mas.os.schedule_delegation') {
    const runAt = dataPreview?.delegation?.runAt ?? null;

    if (dataPreview?.scheduled === true) {
      return runAt
        ? `Scheduled delegation was accepted by the OpenMAS OS kernel for ${runAt}. The scheduled child has not completed yet.`
        : 'Scheduled delegation was accepted by the OpenMAS OS kernel. The scheduled child has not completed yet.';
    }

    return 'Scheduled delegation was submitted to the OpenMAS OS kernel. The scheduled child has not run yet.';
  }

  return brainToolExecution.observation?.summary
    ?? `OpenMAS OS tool ${brainToolExecution.requestedToolId} completed with kernel-owned runtime evidence.`;
}

function applyKernelOwnedToolAcknowledgement({
  brainOutput,
  brainToolExecution,
}) {
  return {
    ...brainOutput,
    outputText: buildKernelOwnedToolAcknowledgement(brainToolExecution),
  };
}

async function executeBrainProviderAttempt({
  brainRole,
  passKind = 'initial_reasoning',
  invocationId,
  bootResult,
  readiness,
  request,
  fetchImplementation,
  providerRetryPolicy = DEFAULT_PROVIDER_RETRY_POLICY,
  brainToolExecution = null,
  brainWorkflowExecution = null,
  resolveToolRequests = true,
}) {
  const preparedProvider = resolvePreparedProviderForRole({
    readiness,
    brainRole,
  });
  const brainReference = resolveBrainReferenceForRole({
    readiness,
    brainRole,
  });

  if (!preparedProvider || !brainReference) {
    return buildAttemptRecord({
      brainRole,
      passKind,
      preparedProvider,
      status: 'not_ready',
      reason: `No ${brainRole} brain provider is configured for this invocation.`,
    });
  }

  if (preparedProvider.status !== 'ready') {
    return buildAttemptRecord({
      brainRole,
      passKind,
      preparedProvider,
      status: 'not_ready',
      reason: preparedProvider.reason,
    });
  }

  const {
    brainInput,
    providerRequest,
    instructionLayerSummary,
    promptProfileSelection,
    promptBudgetReport,
    promptProvenance,
    workflowRuntimeDefinitions,
  } = await assembleBrainInputForInvocation({
    bootResult,
    readiness,
    request,
    invocationId,
    brainReference,
    brainToolExecution,
    brainWorkflowExecution,
  });

  const providerRetryExecution = await executeProviderRequestWithRetry({
    preparedProvider,
    providerRequest,
    secretResolution: readiness.secretResolution,
    fetchImplementation,
    executeProviderRequestImplementation: executeProviderRequest,
    retryPolicy: providerRetryPolicy,
  });
  const providerResponse = assertProviderResponse(providerRetryExecution.finalProviderResponse);

  const brainOutput = normalizeProviderResponseToBrainOutput({
    providerResponse,
  });
  const toolRequestResolution = resolveToolRequests
    ? resolveBrainToolRequestForInvocation({
      brainOutput,
      toolReadinessEvaluation: readiness.toolReadiness,
    })
    : null;
  const workflowRequestResolution = resolveToolRequests
    ? resolveBrainWorkflowRequestForInvocation({
      brainOutput,
      workflowRuntimeDefinitions,
    })
    : null;
  const humanApprovalRuntime = resolveToolRequests
    ? createHumanApprovalRuntimeForToolRequest({
      invocationId,
      operationalIdentityId: readiness.operationalIdentityDefinition.operationalIdentityId,
      requestedBy: request.requestedBy,
      toolRequestResolution,
    })
    : null;

  return buildAttemptRecord({
    brainRole,
    passKind,
    preparedProvider,
    status: brainOutput.status,
    reason: brainOutput.status === 'completed'
      ? (
          providerRetryExecution.totalAttempts > 1
            ? `Brain provider ${brainOutput.providerId} completed successfully after ${providerRetryExecution.totalAttempts} provider attempt(s).`
            : `Brain provider ${brainOutput.providerId} completed successfully.`
        )
      : brainOutput.errorMessage,
    brainInputSummary: summarizeBrainInput(brainInput),
    providerRequestSummary: summarizeProviderRequest(providerRequest),
    instructionLayerSummary,
    promptProfileSelection,
    promptBudgetReport,
    promptProvenance,
    brainOutput,
    providerResponse,
    providerRetryExecution,
    toolRequestResolution,
    workflowRequestResolution,
    humanApprovalRuntime,
  });
}

function selectFinalAttempt({ primaryAttempt, fallbackAttempt }) {
  if (primaryAttempt.status === 'completed') {
    return {
      finalAttempt: primaryAttempt,
      fallbackReason: null,
    };
  }

  if (fallbackAttempt && fallbackAttempt.status === 'completed') {
    return {
      finalAttempt: fallbackAttempt,
      fallbackReason: primaryAttempt.reason,
    };
  }

  if (fallbackAttempt && fallbackAttempt.status === 'failed') {
    return {
      finalAttempt: fallbackAttempt,
      fallbackReason: primaryAttempt.reason,
    };
  }

  return {
    finalAttempt: primaryAttempt,
    fallbackReason: null,
  };
}

function buildBrainExecution({
  primaryAttempt,
  fallbackAttempt,
  finalAttempt,
  fallbackReason,
}) {
  const attempts = [primaryAttempt];

  if (fallbackAttempt) {
    attempts.push(fallbackAttempt);
  }

  return {
    kind: 'brain_execution',
    version: 1,
    fallbackUsed: finalAttempt.brainRole === 'fallback',
    fallbackSucceeded: finalAttempt.brainRole === 'fallback' && finalAttempt.status === 'completed',
    fallbackAttempted: Boolean(fallbackAttempt),
    fallbackReason,
    finalBrainRole: finalAttempt.brainRole,
    finalPassKind: finalAttempt.passKind,
    finalProviderId: finalAttempt.providerId,
    finalModelId: finalAttempt.modelId,
    toolObservationFollowupPerformed: attempts.some((attempt) => {
      return attempt.passKind === 'tool_observation_followup';
    }),
    workflowObservationFollowupPerformed: attempts.some((attempt) => {
      return attempt.passKind === 'workflow_observation_followup';
    }),
    attempts,
  };
}

function appendObservationFollowupAttempt({
  brainExecution,
  followupAttempt,
}) {
  const attempts = [
    ...brainExecution.attempts,
    followupAttempt,
  ];

  return {
    ...brainExecution,
    finalBrainRole: followupAttempt.brainRole,
    finalPassKind: followupAttempt.passKind,
    finalProviderId: followupAttempt.providerId,
    finalModelId: followupAttempt.modelId,
    toolObservationFollowupPerformed: brainExecution.toolObservationFollowupPerformed
      || followupAttempt.passKind === 'tool_observation_followup',
    workflowObservationFollowupPerformed: brainExecution.workflowObservationFollowupPerformed
      || followupAttempt.passKind === 'workflow_observation_followup',
    attempts,
  };
}

export async function runProbabilisticAgentInvocation({
  invocationId,
  bootResult,
  readiness,
  request,
  fetchImplementation,
  providerRetryPolicy = DEFAULT_PROVIDER_RETRY_POLICY,
  semanticIntentRuntimeMode = 'disabled',
  semanticIntentClassifierAdapter = null,
  semanticIntentClassifierId = 'semantic-intent-runtime-classifier',
}) {
  assertOperationalIdentityPrerequisite({ readiness });
  const normalizedProviderRetryPolicy = assertProviderRetryPolicy(providerRetryPolicy);

  const primaryAttempt = await executeBrainProviderAttempt({
    brainRole: 'primary',
    invocationId,
    bootResult,
    readiness,
    request,
    fetchImplementation,
    providerRetryPolicy: normalizedProviderRetryPolicy,
  });

  const shouldAttemptFallback = normalizedProviderRetryPolicy.allowFallbackProvider
    && primaryAttempt.status !== 'completed'
    && Boolean(readiness.providerPreparation?.fallbackBrainProvider)
    && Boolean(readiness.brainSelection?.fallbackBrain);

  const fallbackAttempt = shouldAttemptFallback
      ? await executeBrainProviderAttempt({
        brainRole: 'fallback',
        invocationId,
        bootResult,
        readiness,
        request,
        fetchImplementation,
        providerRetryPolicy: normalizedProviderRetryPolicy,
      })
    : null;

  const {
    finalAttempt,
    fallbackReason,
  } = selectFinalAttempt({
    primaryAttempt,
    fallbackAttempt,
  });

  let brainExecution = buildBrainExecution({
    primaryAttempt,
    fallbackAttempt,
    finalAttempt,
    fallbackReason,
  });

  let {
    brainOutput,
    providerResponse,
    toolRequestResolution,
    workflowRequestResolution,
    humanApprovalRuntime,
  } = finalAttempt;

  const workflowRuntimeResolution = await readWorkflowRuntimeDefinitions({
    masRootPath: bootResult.masRootPath,
  });
  const preparedClassifierProvider = resolvePreparedProviderForRole({
    readiness,
    brainRole: finalAttempt.brainRole,
  });
  const semanticIntentSkipReason = finalAttempt.status === 'completed'
    ? null
    : `Semantic intent runtime skipped because the final brain provider attempt did not complete: ${finalAttempt.reason ?? finalAttempt.status}.`;
  let semanticIntentRuntime = await runSemanticIntentRuntimeForInvocation({
    invocationId,
    masRootPath: bootResult.masRootPath,
    request,
    readiness,
    toolRequestResolution,
    workflowRequestResolution,
    workflowRuntimeDefinitions: workflowRuntimeResolution.workflowRuntimeDefinitions,
    mode: semanticIntentRuntimeMode,
    classifierAdapter: semanticIntentClassifierAdapter,
    classifierId: semanticIntentClassifierId,
    preparedProvider: preparedClassifierProvider,
    fallbackPreparedProvider: finalAttempt.brainRole === 'primary'
      ? readiness.providerPreparation?.fallbackBrainProvider ?? null
      : null,
    secretResolution: readiness.secretResolution,
    fetchImplementation,
    skipReason: semanticIntentSkipReason,
  });
  const useSemanticRuntime = semanticIntentRuntime.mode !== 'disabled';
  const intentResolutionResult = {
    intentResolution: semanticIntentRuntime.intentResolution,
    intentApplied: false,
    toolRequestResolution: semanticIntentRuntime.toolRequestResolution,
    workflowRequestResolution: semanticIntentRuntime.workflowRequestResolution,
  };
  const intentResolution = intentResolutionResult.intentResolution;

  toolRequestResolution = intentResolutionResult.toolRequestResolution;
  workflowRequestResolution = intentResolutionResult.workflowRequestResolution;
  const actionResolution = resolveActionForInvocation({
    request,
    toolRequestResolution,
    workflowRequestResolution,
    semanticIntentClassification: useSemanticRuntime
      ? semanticIntentRuntime.semanticIntentClassification
      : null,
  });
  humanApprovalRuntime = createHumanApprovalRuntimeForToolRequest({
    invocationId,
    operationalIdentityId: readiness.operationalIdentityDefinition.operationalIdentityId,
    requestedBy: request.requestedBy,
    toolRequestResolution,
  });

  if (intentResolutionResult.intentApplied) {
    brainExecution = updateFinalAttemptToolResolution({
      brainExecution,
      toolRequestResolution,
    });
    brainExecution = updateFinalAttemptWorkflowResolution({
      brainExecution,
      workflowRequestResolution,
    });
  }

  const executionPlan = buildAgentExecutionPlanForInvocation({
    invocationId,
    request,
    actionResolution,
    toolRequestResolution,
    workflowRequestResolution,
    semanticIntentRuntime,
    knownToolIds: (readiness.toolRegistry?.toolDefinitions ?? []).map((toolDefinition) => {
      return toolDefinition.toolId;
    }),
    knownWorkflowIds: workflowRuntimeResolution.workflowRuntimeDefinitions.map((workflowRuntimeDefinition) => {
      return workflowRuntimeDefinition.workflowId;
    }),
  });
  const planExecutionCoordination = coordinatePlanExecutionForInvocation({
    executionPlan,
    actionResolution,
    toolRequestResolution,
    workflowRequestResolution,
    humanApprovalRuntime,
  });
  const coordinatedToolRequestResolution = planExecutionCoordination?.toolRequestResolution ?? toolRequestResolution;
  const coordinatedWorkflowRequestResolution = planExecutionCoordination?.workflowRequestResolution ?? workflowRequestResolution;
  const shouldExecuteToolRequest = planExecutionCoordination?.status === 'ready'
    && planExecutionCoordination.runtimeAction === 'queue_tool_request';
  const shouldExecuteWorkflowRequest = planExecutionCoordination?.status === 'ready'
    && planExecutionCoordination.runtimeAction === 'queue_workflow_request';
  const brainToolExecution = shouldExecuteToolRequest
    ? await executeAcceptedBrainToolRequest({
      masRootPath: bootResult.masRootPath,
      invocationId,
      operationalIdentityId: readiness.operationalIdentityDefinition.operationalIdentityId,
      requestedBy: request.requestedBy,
      osRuntimeContext: request.osRuntimeContext ?? null,
      toolRequestResolution: coordinatedToolRequestResolution,
      toolDefinitions: readiness.toolRegistry?.toolDefinitions ?? [],
    })
    : {
      kind: 'brain_tool_execution_result',
      version: 1,
      status: 'not_executed',
      executionPerformed: false,
      requestedToolId: coordinatedToolRequestResolution?.requestedToolId ?? null,
      toolRequestId: coordinatedToolRequestResolution?.toolRequest?.toolRequestId ?? null,
      toolRunId: null,
      toolResultStatus: null,
      toolAuditRecordPath: null,
      toolResultSnapshotPath: null,
      memoryWritebackRequest: null,
      memoryWritebackPersistence: null,
      observation: null,
      reason: planExecutionCoordination
        ? `Brain tool request was not executed because plan execution coordination status is ${planExecutionCoordination.status}.`
        : 'Brain tool request was not executed because no plan execution coordination was required.',
      warnings: [],
      errors: [],
    };

  toolRequestResolution = markResolutionAfterBrainToolExecution({
    toolRequestResolution: coordinatedToolRequestResolution,
    brainToolExecution,
  });

  brainExecution = updateFinalAttemptToolResolution({
    brainExecution,
    toolRequestResolution,
  });
  const executedBrainToolRequest = brainToolExecution.executionPerformed
    ? toolRequestResolution.toolRequest
    : null;
  let brainWorkflowExecution = null;
  let executedBrainWorkflowRequest = null;

  if (!brainToolExecution.executionPerformed && shouldExecuteWorkflowRequest) {
    brainWorkflowExecution = await executeAcceptedBrainWorkflowRequest({
      masRootPath: bootResult.masRootPath,
      invocationId,
      operationalIdentityId: readiness.operationalIdentityDefinition.operationalIdentityId,
      requestedBy: request.requestedBy,
      workflowRequestResolution: coordinatedWorkflowRequestResolution,
      toolDefinitions: readiness.toolRegistry?.toolDefinitions ?? [],
      resolvedBindings: readiness.resolvedBindings?.resolvedBindings ?? [],
      permissionEvaluation: readiness.permissionEvaluation ?? null,
      secretResolution: readiness.secretResolution ?? null,
    });

    workflowRequestResolution = markResolutionAfterBrainWorkflowExecution({
      workflowRequestResolution: coordinatedWorkflowRequestResolution,
      brainWorkflowExecution,
    });

    brainExecution = updateFinalAttemptWorkflowResolution({
      brainExecution,
      workflowRequestResolution,
    });
    executedBrainWorkflowRequest = brainWorkflowExecution.executionPerformed
      ? workflowRequestResolution.workflowRequest
      : null;
  } else if (!brainToolExecution.executionPerformed) {
    brainWorkflowExecution = {
      kind: 'brain_workflow_execution_result',
      version: 1,
      status: 'not_executed',
      executionPerformed: false,
      requestedWorkflowId: coordinatedWorkflowRequestResolution?.requestedWorkflowId ?? null,
      workflowRequestId: coordinatedWorkflowRequestResolution?.workflowRequest?.workflowRequestId ?? null,
      workflowRunId: null,
      workflowRunStatus: null,
      workflowRunStateRecordPath: null,
      memoryWritebackRequest: null,
      memoryWritebackPersistence: null,
      observation: null,
      reason: planExecutionCoordination
        ? `Brain workflow request was not executed because plan execution coordination status is ${planExecutionCoordination.status}.`
        : 'Brain workflow request was not executed because no plan execution coordination was required.',
      warnings: [],
      errors: [],
    };
  }

  if (brainToolExecution.executionPerformed && brainToolExecution.observation) {
    if (shouldPerformProviderToolObservationFollowup(brainToolExecution)) {
      const followupAttempt = await executeBrainProviderAttempt({
        brainRole: finalAttempt.brainRole,
        passKind: 'tool_observation_followup',
        invocationId,
        bootResult,
        readiness,
        request,
        fetchImplementation,
        providerRetryPolicy: normalizedProviderRetryPolicy,
        brainToolExecution,
        resolveToolRequests: false,
      });

      brainExecution = appendObservationFollowupAttempt({
        brainExecution,
        followupAttempt,
      });
      brainOutput = followupAttempt.brainOutput;
      providerResponse = followupAttempt.providerResponse;
    } else {
      brainOutput = applyKernelOwnedToolAcknowledgement({
        brainOutput,
        brainToolExecution,
      });
    }
  } else if (brainWorkflowExecution?.executionPerformed && brainWorkflowExecution.observation) {
    const followupAttempt = await executeBrainProviderAttempt({
      brainRole: finalAttempt.brainRole,
      passKind: 'workflow_observation_followup',
      invocationId,
      bootResult,
      readiness,
      request,
      fetchImplementation,
      providerRetryPolicy: normalizedProviderRetryPolicy,
      brainWorkflowExecution,
      resolveToolRequests: false,
    });

    brainExecution = appendObservationFollowupAttempt({
      brainExecution,
      followupAttempt,
    });
    brainOutput = followupAttempt.brainOutput;
    providerResponse = followupAttempt.providerResponse;
  }

  const governedPlanPreview = governPlanPreviewOutput({
    request,
    brainOutput,
    providerResponse,
    actionResolution,
    executionPlan,
    planExecutionCoordination,
    brainToolExecution,
    brainWorkflowExecution,
  });
  brainOutput = governedPlanPreview.brainOutput;
  providerResponse = governedPlanPreview.providerResponse ?? providerResponse;

  const filteredBrainWarnings = filterBenignNonExecutionClaimEnvelopeWarnings({
    warnings: brainOutput?.warnings ?? [],
    actionResolution,
    brainToolExecution,
    brainWorkflowExecution,
  });
  const filteredProviderWarnings = filterBenignNonExecutionClaimEnvelopeWarnings({
    warnings: providerResponse?.warnings ?? [],
    actionResolution,
    brainToolExecution,
    brainWorkflowExecution,
  });

  if (Array.isArray(brainOutput?.warnings) && filteredBrainWarnings !== brainOutput.warnings) {
    brainOutput = {
      ...brainOutput,
      warnings: filteredBrainWarnings,
    };
  }

  if (Array.isArray(providerResponse?.warnings) && filteredProviderWarnings !== providerResponse.warnings) {
    providerResponse = {
      ...providerResponse,
      warnings: filteredProviderWarnings,
    };
  }

  const extractedActionClaimReport = extractActionClaimReportFromOutputText(
    providerResponse?.outputText ?? null,
  );
  const actionClaimGuard = evaluateActionClaimGuardForInvocation({
    outputText: brainOutput.outputText,
    actionClaimReport: extractedActionClaimReport.actionClaimReport,
    actionResolution,
    brainToolExecution,
    brainWorkflowExecution,
  });
  const verificationGate = evaluateVerificationGateForInvocation({
    actionResolution,
    brainToolExecution,
    brainWorkflowExecution,
    actionClaimGuard,
  });
  const governedVisibleOutput = governVisibleBrainOutput({
    request,
    brainOutput,
    actionResolution,
    executionPlan,
  });
  brainOutput = governedVisibleOutput.brainOutput;
  const actionResultAssessment = evaluateActionResultAssessmentForInvocation({
    request,
    brainOutput,
    actionResolution,
    toolRequestResolution,
    brainToolExecution,
    workflowRequestResolution,
    brainWorkflowExecution,
    humanApprovalRuntime,
    actionClaimGuard,
    verificationGate,
  });
  const fallbackDecisionTrace = buildProviderFallbackDecisionTrace({
    readiness,
    primaryAttempt,
    fallbackAttempt,
    selectedFinalAttempt: finalAttempt,
    providerRetryPolicy: normalizedProviderRetryPolicy,
    semanticIntentRuntime,
  });

  const executionStatus = brainOutput.status === 'completed' ? 'completed' : 'failed';
  let executionMessage = brainOutput.status === 'completed'
    ? `${readiness.operationalIdentityDefinition.displayName} answered through ${brainOutput.providerId}.`
    : `Provider ${brainOutput.providerId} failed: ${brainOutput.errorMessage}`;

  if (
    brainToolExecution.executionPerformed
    && brainOutput.status === 'completed'
    && brainToolExecution.continuationPolicy !== 'continue_with_provider'
  ) {
    executionMessage = `${readiness.operationalIdentityDefinition.displayName} returned kernel-owned acknowledgement after executing ${brainToolExecution.requestedToolId}.`;
  } else if (brainToolExecution.executionPerformed && brainOutput.status === 'completed') {
    executionMessage = `${readiness.operationalIdentityDefinition.displayName} answered after executing ${brainToolExecution.requestedToolId} through ${brainOutput.providerId}.`;
  } else if (brainToolExecution.executionPerformed && brainOutput.status !== 'completed') {
    executionMessage = `${readiness.operationalIdentityDefinition.displayName} executed ${brainToolExecution.requestedToolId}, but the tool observation follow-up failed: ${brainOutput.errorMessage}`;
  } else if (brainWorkflowExecution?.executionPerformed && brainOutput.status === 'completed') {
    executionMessage = `${readiness.operationalIdentityDefinition.displayName} answered after running workflow ${brainWorkflowExecution.requestedWorkflowId} through ${brainOutput.providerId}.`;
  } else if (brainWorkflowExecution?.executionPerformed && brainOutput.status !== 'completed') {
    executionMessage = `${readiness.operationalIdentityDefinition.displayName} ran workflow ${brainWorkflowExecution.requestedWorkflowId}, but the workflow observation follow-up failed: ${brainOutput.errorMessage}`;
  } else if (brainExecution.fallbackSucceeded) {
    executionMessage = `${readiness.operationalIdentityDefinition.displayName} answered through ${brainOutput.providerId} after fallback from ${primaryAttempt.providerId}.`;
  } else if (brainOutput.status !== 'completed' && fallbackDecisionTrace.status === 'fallback_failed') {
    executionMessage = `${readiness.operationalIdentityDefinition.displayName} failed after primary provider ${fallbackDecisionTrace.primaryProviderId} and fallback provider ${fallbackDecisionTrace.fallbackProviderId} both failed.`;
  } else if (brainOutput.status !== 'completed' && fallbackDecisionTrace.status === 'skipped_fallback_not_ready') {
    executionMessage = `${readiness.operationalIdentityDefinition.displayName} failed because primary provider ${fallbackDecisionTrace.primaryProviderId} failed and fallback provider ${fallbackDecisionTrace.fallbackProviderId} was not ready.`;
  } else if (brainOutput.status !== 'completed' && fallbackDecisionTrace.status === 'skipped_policy_disallowed') {
    executionMessage = `${readiness.operationalIdentityDefinition.displayName} failed because primary provider ${fallbackDecisionTrace.primaryProviderId} failed and fallback was disabled by policy.`;
  } else if (brainOutput.status !== 'completed' && fallbackDecisionTrace.status === 'skipped_fallback_not_configured') {
    executionMessage = `${readiness.operationalIdentityDefinition.displayName} failed because primary provider ${fallbackDecisionTrace.primaryProviderId} failed and no fallback provider was configured for this invocation.`;
  }

  return {
    commandModulePath: null,
    executionStatus,
    brainExecution,
    fallbackDecisionTrace,
    brainInputSummary: brainExecution.attempts.at(-1).brainInputSummary,
    providerRequestSummary: brainExecution.attempts.at(-1).providerRequestSummary,
    instructionLayerSummary: brainExecution.attempts.at(-1).instructionLayerSummary,
    promptProfileSelection: brainExecution.attempts.at(-1).promptProfileSelection,
    promptBudgetReport: brainExecution.attempts.at(-1).promptBudgetReport,
    promptProvenance: brainExecution.attempts.at(-1).promptProvenance,
    brainOutput,
    providerResponse,
    intentResolution,
    actionResolution,
    toolRequestResolution,
    executedBrainToolRequest,
    brainToolExecution,
    brainToolObservation: brainToolExecution.observation,
    workflowRequestResolution,
    executedBrainWorkflowRequest,
    brainWorkflowExecution,
    brainWorkflowObservation: brainWorkflowExecution?.observation ?? null,
    semanticIntentRuntime,
    actionClaimGuard,
    verificationGate,
    actionResultAssessment,
    humanApprovalRuntime,
    executionOutcome: {
      message: executionMessage,
      reportKind: 'probabilistic_brain_invocation',
      reportContent: buildReportContent({
        request,
        readiness,
        brainOutput,
        brainExecution,
        fallbackDecisionTrace,
        intentResolution,
        actionResolution,
        toolRequestResolution,
        brainToolExecution,
        workflowRequestResolution,
        brainWorkflowExecution,
        semanticIntentRuntime,
        actionClaimGuard,
        verificationGate,
        actionResultAssessment,
        humanApprovalRuntime,
        executionPlan,
        planExecutionCoordination,
      }),
      outputPayload: {
        ...brainOutput,
        fallbackDecisionTrace,
        intentResolution,
        actionResolution,
        toolRequestResolution,
        executedBrainToolRequest,
        brainToolExecution,
        brainToolObservation: brainToolExecution.observation,
        workflowRequestResolution,
        executedBrainWorkflowRequest,
        brainWorkflowExecution,
        brainWorkflowObservation: brainWorkflowExecution?.observation ?? null,
        semanticIntentRuntime,
        actionClaimGuard,
        verificationGate,
        actionResultAssessment,
        executionPlan,
        planExecutionCoordination,
        humanApprovalRequest: humanApprovalRuntime?.approvalRequest ?? null,
        humanApprovalState: humanApprovalRuntime?.approvalState ?? null,
        approvalRequiredToolResult: humanApprovalRuntime?.approvalRequiredToolResult ?? null,
      },
    },
    executionPlan,
    planExecutionCoordination,
  };
}
