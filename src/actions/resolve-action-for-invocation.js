import { assertActionResolution } from '../contracts/actions/action-resolution-contract.js';
import {
  APPROVAL_REQUIRED_SIDE_EFFECT_LEVELS,
  assertActionCandidate,
  assertActionIntent,
} from '../contracts/actions/action-intent-contract.js';
import { assertBrainToolRequestResolution } from '../contracts/brain/brain-tool-request-contract.js';
import { assertBrainWorkflowRequestResolution } from '../contracts/brain/brain-workflow-request-contract.js';
import { buildHighQualityClarificationRequest } from './build-clarification-request-quality.js';
import { evaluateActionResolutionPolicy } from './evaluate-action-resolution-policy.js';

const COMMAND_RESOLUTION_CONSUMING_STATUSES = new Set([
  'accepted',
  'approval_required',
  'denied',
  'invalid',
  'blocked',
]);

const COMMAND_RESOLUTION_ACCEPTED_STATUSES = new Set([
  'accepted',
  'resolved',
]);

const COMMAND_RESOLUTION_IGNORED_STATUSES = new Set([
  'no_command',
  'skipped',
  'no_request',
]);

const PLAN_PREVIEW_SIGNAL_PATTERNS = [
  /\bplan\b/iu,
  /\bpreview\b/iu,
  /\boutline\b/iu,
  /\bbefore\s+(?:acting|execution|executing)\b/iu,
  /\bplan\s+de\b/iu,
  /\bantes\s+de\s+ejecutar\b/iu,
  /\bplano\s+de\b/iu,
  /\bantes\s+de\s+executar\b/iu,
];

const EXECUTE_NOW_SIGNAL_PATTERNS = [
  /\bexecute\b/iu,
  /\brun\b/iu,
  /\bperform\b/iu,
  /\binspect\s+now\b/iu,
  /\brealiza\b/iu,
  /\bejecuta\b/iu,
  /\bhaz\b/iu,
  /\bprocede\b/iu,
  /\badelante\b/iu,
  /\binspecciona\s+ahora\b/iu,
];

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

function matchesAnyPattern(value, patterns) {
  if (!isNonEmptyString(value)) {
    return false;
  }

  return patterns.some((pattern) => pattern.test(value));
}

function getRequestInputText(request) {
  if (!isPlainObject(request)) {
    return null;
  }

  return [
    request.originalInput,
    request.inputText,
    request.input,
  ].find(isNonEmptyString) ?? null;
}

function normalizeSafeIdentifier(value, fallbackValue) {
  const normalizedValue = isNonEmptyString(value)
    ? value.trim().replace(/[^a-zA-Z0-9._-]+/gu, '-').replace(/^-+|-+$/gu, '')
    : '';

  return normalizedValue.length > 0 ? normalizedValue : fallbackValue;
}

function sideEffectRequiresApproval(sideEffectLevel) {
  return APPROVAL_REQUIRED_SIDE_EFFECT_LEVELS.has(sideEffectLevel);
}

function buildCandidate({
  candidateId,
  actionType,
  targetType,
  targetId,
  source,
  sideEffectLevel,
  requiresApproval,
  reason,
  matchedSignals = [],
  warnings = [],
  metadata = {},
}) {
  return assertActionCandidate({
    kind: 'action_candidate',
    version: 1,
    candidateId: normalizeSafeIdentifier(candidateId, 'candidate-action-001'),
    actionType,
    targetType,
    targetId,
    source,
    confidence: 'exact',
    confidenceScore: null,
    sideEffectLevel,
    requiresApproval: requiresApproval || sideEffectRequiresApproval(sideEffectLevel),
    reason,
    matchedSignals,
    missingContext: [],
    warnings,
    metadata,
  });
}

function buildCandidateFromToolResolution(resolution) {
  if (!resolution.toolRequest) {
    return null;
  }

  return buildCandidate({
    candidateId: `candidate-tool-${resolution.toolRequest.toolRequestId}`,
    actionType: 'tool_execution',
    targetType: 'tool',
    targetId: resolution.toolRequest.toolId,
    source: 'explicit_envelope',
    sideEffectLevel: resolution.toolRequest.expectedSideEffectLevel,
    requiresApproval: resolution.approvalRequired,
    reason: resolution.reason,
    matchedSignals: [
      `brain_tool_request:${resolution.toolRequest.toolRequestId}`,
      `tool:${resolution.toolRequest.toolId}`,
    ],
    warnings: resolution.warnings,
    metadata: {
      requestKind: resolution.toolRequest.kind,
      toolRequestId: resolution.toolRequest.toolRequestId,
      requestedToolId: resolution.requestedToolId,
      readinessStatus: resolution.toolReadinessVerdict?.status ?? null,
    },
  });
}

function buildCandidateFromWorkflowResolution(resolution) {
  if (!resolution.workflowRequest) {
    return null;
  }

  return buildCandidate({
    candidateId: `candidate-workflow-${resolution.workflowRequest.workflowRequestId}`,
    actionType: 'workflow_execution',
    targetType: 'workflow',
    targetId: resolution.workflowRequest.workflowId,
    source: 'explicit_envelope',
    sideEffectLevel: resolution.workflowRequest.expectedSideEffectLevel,
    requiresApproval: sideEffectRequiresApproval(resolution.workflowRequest.expectedSideEffectLevel),
    reason: resolution.reason,
    matchedSignals: [
      `brain_workflow_request:${resolution.workflowRequest.workflowRequestId}`,
      `workflow:${resolution.workflowRequest.workflowId}`,
    ],
    warnings: resolution.warnings,
    metadata: {
      requestKind: resolution.workflowRequest.kind,
      workflowRequestId: resolution.workflowRequest.workflowRequestId,
      requestedWorkflowId: resolution.requestedWorkflowId,
      readinessStatus: 'ready',
    },
  });
}

function runtimeActionForCandidate(candidate) {
  if (candidate.targetType === 'tool') {
    return 'queue_tool_request';
  }

  if (candidate.targetType === 'workflow') {
    return 'queue_workflow_request';
  }

  if (candidate.targetType === 'command') {
    return 'execute_command';
  }

  if (candidate.targetType === 'channel') {
    return 'queue_channel_delivery';
  }

  if (candidate.targetType === 'memory') {
    return 'memory_recall';
  }

  if (candidate.targetType === 'handoff') {
    return 'handoff';
  }

  return 'answer_only';
}

function buildNoActionResolution({
  reason,
  evidence = [],
  decisionTrace = [],
  warnings = [],
  metadata = {},
}) {
  return assertActionResolution({
    kind: 'action_resolution',
    version: 1,
    status: 'no_action',
    source: 'none',
    runtimeAction: 'answer_only',
    actionIntent: null,
    selectedCandidate: null,
    clarificationRequest: null,
    executionAllowed: false,
    approvalRequired: false,
    reason,
    evidence,
    decisionTrace,
    warnings,
    metadata,
  });
}

function buildDeniedResolution({
  source,
  reason,
  selectedCandidate = null,
  actionIntent = null,
  evidence = [],
  decisionTrace = [],
  warnings = [],
  metadata = {},
}) {
  return assertActionResolution({
    kind: 'action_resolution',
    version: 1,
    status: 'denied',
    source,
    runtimeAction: 'reject',
    actionIntent,
    selectedCandidate,
    clarificationRequest: null,
    executionAllowed: false,
    approvalRequired: false,
    reason,
    evidence,
    decisionTrace,
    warnings,
    metadata,
  });
}

function buildAcceptedResolution({
  source,
  selectedCandidate,
  actionIntent = null,
  reason,
  evidence = [],
  decisionTrace = [],
  warnings = [],
  metadata = {},
}) {
  return assertActionResolution({
    kind: 'action_resolution',
    version: 1,
    status: 'accepted',
    source,
    runtimeAction: runtimeActionForCandidate(selectedCandidate),
    actionIntent,
    selectedCandidate,
    clarificationRequest: null,
    executionAllowed: true,
    approvalRequired: false,
    reason,
    evidence,
    decisionTrace,
    warnings,
    metadata,
  });
}

function buildPlanOnlyResolution({
  source,
  selectedCandidate,
  actionIntent = null,
  reason,
  previewApprovalRequired = false,
  previewRuntimeAction = null,
  evidence = [],
  decisionTrace = [],
  warnings = [],
  metadata = {},
}) {
  return assertActionResolution({
    kind: 'action_resolution',
    version: 1,
    status: 'plan_only',
    source,
    runtimeAction: 'answer_only',
    actionIntent,
    selectedCandidate,
    clarificationRequest: null,
    executionAllowed: false,
    approvalRequired: false,
    reason,
    evidence,
    decisionTrace,
    warnings,
    metadata: {
      ...metadata,
      planMode: 'preview_only',
      previewApprovalRequired,
      previewRuntimeAction: previewRuntimeAction ?? runtimeActionForCandidate(selectedCandidate),
    },
  });
}

function buildApprovalRequiredResolution({
  source,
  selectedCandidate,
  actionIntent = null,
  reason,
  evidence = [],
  decisionTrace = [],
  warnings = [],
  metadata = {},
}) {
  return assertActionResolution({
    kind: 'action_resolution',
    version: 1,
    status: 'approval_required',
    source,
    runtimeAction: 'request_human_approval',
    actionIntent,
    selectedCandidate,
    clarificationRequest: null,
    executionAllowed: false,
    approvalRequired: true,
    reason,
    evidence,
    decisionTrace,
    warnings,
    metadata,
  });
}

function buildClarificationResolution({
  status,
  source,
  actionIntent = null,
  clarificationRequest,
  reason,
  evidence = [],
  decisionTrace = [],
  warnings = [],
  metadata = {},
}) {
  return assertActionResolution({
    kind: 'action_resolution',
    version: 1,
    status,
    source,
    runtimeAction: 'ask_clarification',
    actionIntent,
    selectedCandidate: null,
    clarificationRequest,
    executionAllowed: false,
    approvalRequired: false,
    reason,
    evidence,
    decisionTrace,
    warnings,
    metadata,
  });
}

function mergePolicyDecisionFields({
  decisionTrace = [],
  evidence = [],
  warnings = [],
  metadata = {},
  policyDecision,
}) {
  return {
    evidence: [
      ...evidence,
      ...policyDecision.evidence,
    ],
    decisionTrace: [
      ...decisionTrace,
      ...policyDecision.decisionTrace,
    ],
    warnings: [
      ...warnings,
      ...policyDecision.warnings,
    ],
    metadata: {
      ...metadata,
      actionPolicy: policyDecision.metadata,
    },
  };
}

function buildResolutionFromPolicyDecision({
  policyDecision,
  source,
  selectedCandidate,
  actionIntent = null,
  reason,
  evidence = [],
  decisionTrace = [],
  warnings = [],
  metadata = {},
}) {
  const mergedFields = mergePolicyDecisionFields({
    evidence,
    decisionTrace,
    warnings,
    metadata,
    policyDecision,
  });
  const policyReason = policyDecision.reason || reason;

  if (policyDecision.status === 'accepted') {
    return buildAcceptedResolution({
      source,
      selectedCandidate,
      actionIntent,
      reason: policyReason,
      ...mergedFields,
    });
  }

  if (policyDecision.status === 'approval_required') {
    return buildApprovalRequiredResolution({
      source,
      selectedCandidate,
      actionIntent,
      reason: policyReason,
      ...mergedFields,
    });
  }

  if (policyDecision.status === 'needs_clarification') {
    return buildClarificationResolution({
      status: 'needs_clarification',
      source,
      actionIntent,
      clarificationRequest: policyDecision.clarificationRequest,
      reason: policyReason,
      ...mergedFields,
    });
  }

  return buildDeniedResolution({
    source,
    selectedCandidate,
    actionIntent,
    reason: policyReason,
    ...mergedFields,
  });
}

function buildMultipleExplicitEnvelopeResolution({
  resolutions,
  request = null,
}) {
  const candidates = resolutions
    .map((resolution) => resolution.selectedCandidate)
    .filter((candidate) => candidate !== null);
  const targetSummary = resolutions
    .map((resolution) => {
      return resolution.selectedCandidate
        ? `${resolution.selectedCandidate.targetType}:${resolution.selectedCandidate.targetId}`
        : resolution.metadata.sourceKind;
    });

  const clarificationRequest = buildHighQualityClarificationRequest({
    clarificationId: 'clarification-multiple-explicit-envelopes-001',
    reasonCategory: 'multiple_candidates',
    existingQuestion: 'Multiple explicit runtime action requests were detected. Please choose one action or restate the request with a single tool/workflow target.',
    candidates,
    missingContext: [
      'single_runtime_action_selection',
    ],
    warnings: resolutions.flatMap((resolution) => resolution.warnings),
    request,
  });

  return buildClarificationResolution({
    status: 'ambiguous',
    source: 'explicit_envelope',
    clarificationRequest,
    reason: 'Multiple explicit tool/workflow envelopes were present, so the runtime did not choose one implicitly.',
    evidence: targetSummary.map((target) => `Explicit action source detected: ${target}.`),
    decisionTrace: [
      'Explicit envelope precedence was reached.',
      'More than one explicit envelope consumed the request.',
      'Execution was stopped until one action is selected.',
    ],
    warnings: resolutions.flatMap((resolution) => resolution.warnings),
    metadata: {
      explicitResolutionCount: resolutions.length,
      targetSummary,
    },
  });
}

function buildPlanPreviewResolutionFromExplicitEnvelope({
  resolution,
  semanticIntentClassification = null,
}) {
  if (!resolution?.selectedCandidate) {
    return resolution;
  }

  const previewRuntimeAction = resolution.runtimeAction;
  const previewApprovalRequired = resolution.status === 'approval_required'
    || resolution.approvalRequired === true;
  const semanticIntent = getSemanticActionIntent(semanticIntentClassification)?.actionIntent ?? null;

  return buildPlanOnlyResolution({
    source: resolution.source,
    selectedCandidate: resolution.selectedCandidate,
    actionIntent: semanticIntent,
    reason: 'The request asked for a governed plan preview, so runtime execution was not started in this invocation.',
    previewApprovalRequired,
    previewRuntimeAction,
    evidence: [
      ...resolution.evidence,
      'The user request was interpreted as a preview-only planning request.',
    ],
    decisionTrace: [
      ...resolution.decisionTrace,
      'Plan-preview guard converted explicit envelope execution into a governed preview-only path.',
    ],
    warnings: resolution.warnings,
    metadata: {
      ...resolution.metadata,
      sourceKind: 'explicit_envelope_preview_guard',
      previewOnlyRequest: true,
    },
  });
}

function buildResolutionFromToolRequestResolution(toolRequestResolution, request = null) {
  if (toolRequestResolution === undefined || toolRequestResolution === null) {
    return null;
  }

  const resolution = assertBrainToolRequestResolution(toolRequestResolution);

  if (resolution.status === 'no_request') {
    return null;
  }

  const selectedCandidate = buildCandidateFromToolResolution(resolution);
  const evidence = [
    `Brain tool request status: ${resolution.status}.`,
  ];

  if (selectedCandidate) {
    evidence.push(`Requested tool: ${selectedCandidate.targetId}.`);
  }

  const commonFields = {
    source: 'explicit_envelope',
    selectedCandidate,
    reason: resolution.reason,
    evidence,
    decisionTrace: [
      'Explicit brain tool envelope evaluated before semantic classification.',
      `Brain tool request resolution status is ${resolution.status}.`,
    ],
    warnings: resolution.warnings,
    metadata: {
      sourceKind: 'brain_tool_request_resolution',
      sourceStatus: resolution.status,
      requestedToolId: resolution.requestedToolId,
      autoExecutionPerformed: resolution.autoExecutionPerformed,
    },
  };

  if (resolution.status === 'accepted') {
    return buildResolutionFromPolicyDecision({
      ...commonFields,
      policyDecision: evaluateActionResolutionPolicy({
        candidate: selectedCandidate,
        request,
      }),
    });
  }

  if (resolution.status === 'approval_required') {
    return buildApprovalRequiredResolution(commonFields);
  }

  return buildDeniedResolution(commonFields);
}

function buildResolutionFromWorkflowRequestResolution(workflowRequestResolution, request = null) {
  if (workflowRequestResolution === undefined || workflowRequestResolution === null) {
    return null;
  }

  const resolution = assertBrainWorkflowRequestResolution(workflowRequestResolution);

  if (resolution.status === 'no_request') {
    return null;
  }

  const selectedCandidate = buildCandidateFromWorkflowResolution(resolution);
  const evidence = [
    `Brain workflow request status: ${resolution.status}.`,
  ];

  if (selectedCandidate) {
    evidence.push(`Requested workflow: ${selectedCandidate.targetId}.`);
  }

  const commonFields = {
    source: 'explicit_envelope',
    selectedCandidate,
    reason: resolution.reason,
    evidence,
    decisionTrace: [
      'Explicit brain workflow envelope evaluated before semantic classification.',
      `Brain workflow request resolution status is ${resolution.status}.`,
    ],
    warnings: resolution.warnings,
    metadata: {
      sourceKind: 'brain_workflow_request_resolution',
      sourceStatus: resolution.status,
      requestedWorkflowId: resolution.requestedWorkflowId,
      autoExecutionPerformed: resolution.autoExecutionPerformed,
    },
  };

  if (resolution.status === 'accepted') {
    return buildResolutionFromPolicyDecision({
      ...commonFields,
      policyDecision: evaluateActionResolutionPolicy({
        candidate: selectedCandidate,
        request,
      }),
    });
  }

  return buildDeniedResolution(commonFields);
}

function buildResolutionFromDeterministicCommand(commandResolution, request = null) {
  if (commandResolution === undefined || commandResolution === null) {
    return null;
  }

  if (!isPlainObject(commandResolution)) {
    throw new Error('Deterministic command resolution must be an object when provided.');
  }

  const status = isNonEmptyString(commandResolution.status)
    ? commandResolution.status.trim()
    : 'no_command';

  if (COMMAND_RESOLUTION_IGNORED_STATUSES.has(status)) {
    return null;
  }

  if (!COMMAND_RESOLUTION_CONSUMING_STATUSES.has(status) && !COMMAND_RESOLUTION_ACCEPTED_STATUSES.has(status)) {
    throw new Error(`Deterministic command resolution status is invalid: ${status}`);
  }

  const command = isNonEmptyString(commandResolution.command)
    ? commandResolution.command.trim()
    : 'command';
  const sideEffectLevel = isNonEmptyString(commandResolution.sideEffectLevel)
    ? commandResolution.sideEffectLevel.trim()
    : 'read_only';
  const requiresApproval = commandResolution.approvalRequired === true
    || status === 'approval_required'
    || sideEffectRequiresApproval(sideEffectLevel);
  const selectedCandidate = buildCandidate({
    candidateId: `candidate-command-${command}`,
    actionType: 'command_execution',
    targetType: 'command',
    targetId: normalizeSafeIdentifier(command, 'command'),
    source: 'explicit_command',
    sideEffectLevel,
    requiresApproval,
    reason: isNonEmptyString(commandResolution.reason)
      ? commandResolution.reason.trim()
      : `Deterministic command ${command} was selected.`,
    matchedSignals: [
      `command:${command}`,
    ],
    warnings: Array.isArray(commandResolution.warnings) ? commandResolution.warnings : [],
    metadata: {
      sourceKind: 'deterministic_command_resolution',
      sourceStatus: status,
      command,
      readinessStatus: status === 'approval_required' ? 'approval_required' : 'ready',
    },
  });
  const commonFields = {
    source: 'explicit_command',
    selectedCandidate,
    reason: selectedCandidate.reason,
    evidence: [
      `Deterministic command status: ${status}.`,
      `Command: ${command}.`,
    ],
    decisionTrace: [
      'No explicit tool/workflow envelope consumed the request.',
      'Deterministic command resolution was evaluated before semantic classification.',
      `Deterministic command resolution status is ${status}.`,
    ],
    warnings: selectedCandidate.warnings,
    metadata: {
      sourceKind: 'deterministic_command_resolution',
      sourceStatus: status,
      command,
    },
  };

  if (status === 'approval_required') {
    return buildApprovalRequiredResolution(commonFields);
  }

  if (COMMAND_RESOLUTION_ACCEPTED_STATUSES.has(status)) {
    return buildResolutionFromPolicyDecision({
      ...commonFields,
      policyDecision: evaluateActionResolutionPolicy({
        candidate: selectedCandidate,
        request,
      }),
    });
  }

  return buildDeniedResolution(commonFields);
}

function getSemanticActionIntent(semanticIntentClassification) {
  if (semanticIntentClassification === undefined || semanticIntentClassification === null) {
    return null;
  }

  if (!isPlainObject(semanticIntentClassification)) {
    throw new Error('Semantic intent classification must be an object when provided.');
  }

  if (semanticIntentClassification.kind === 'action_intent') {
    return {
      actionIntent: assertActionIntent(semanticIntentClassification),
      classificationStatus: null,
      warnings: semanticIntentClassification.warnings ?? [],
    };
  }

  if (semanticIntentClassification.kind !== 'semantic_intent_classification_result') {
    throw new Error('Semantic intent classification must be an action intent or semantic classification result.');
  }

  return {
    actionIntent: assertActionIntent(semanticIntentClassification.actionIntent),
    classificationStatus: isNonEmptyString(semanticIntentClassification.status)
      ? semanticIntentClassification.status.trim()
      : null,
    warnings: Array.isArray(semanticIntentClassification.warnings)
      ? semanticIntentClassification.warnings
      : [],
  };
}

function semanticClassificationRequestsPlanPreview(semanticIntentClassification) {
  try {
    return getSemanticActionIntent(semanticIntentClassification)?.actionIntent?.understanding?.requestType === 'plan_request';
  } catch {
    return false;
  }
}

function requestLooksLikePreviewOnlyPlan(request) {
  const inputText = getRequestInputText(request);

  if (!matchesAnyPattern(inputText, PLAN_PREVIEW_SIGNAL_PATTERNS)) {
    return false;
  }

  return !matchesAnyPattern(inputText, EXECUTE_NOW_SIGNAL_PATTERNS);
}

function shouldTreatRequestAsPreviewOnlyPlan({
  request = null,
  semanticIntentClassification = null,
}) {
  return semanticClassificationRequestsPlanPreview(semanticIntentClassification)
    || requestLooksLikePreviewOnlyPlan(request);
}

function getSelectedCandidate(actionIntent) {
  if (!actionIntent.selectedCandidateId) {
    return null;
  }

  return actionIntent.candidates.find((candidate) => {
    return candidate.candidateId === actionIntent.selectedCandidateId;
  }) ?? null;
}

function buildResolutionFromSemanticIntentClassification(semanticIntentClassification, request = null) {
  const semanticResult = getSemanticActionIntent(semanticIntentClassification);

  if (!semanticResult) {
    return null;
  }

  const { actionIntent, classificationStatus, warnings } = semanticResult;
  const decisionTrace = [
    'No explicit envelope or deterministic command consumed the request.',
    'Semantic intent classification was evaluated as an advisory action source.',
    `Semantic action intent status is ${actionIntent.status}.`,
  ];

  if (classificationStatus) {
    decisionTrace.push(`Semantic classifier result status is ${classificationStatus}.`);
  }

  if (actionIntent.status === 'no_action') {
    return assertActionResolution({
      kind: 'action_resolution',
      version: 1,
      status: 'no_action',
      source: actionIntent.source,
      runtimeAction: 'answer_only',
      actionIntent,
      selectedCandidate: null,
      clarificationRequest: null,
      executionAllowed: false,
      approvalRequired: false,
      reason: actionIntent.reason,
      evidence: actionIntent.evidence,
      decisionTrace,
      warnings: uniqueStrings([
        ...warnings,
        ...actionIntent.warnings,
      ]),
      metadata: {
        sourceKind: 'semantic_intent_classification',
        classificationStatus,
      },
    });
  }

  if (actionIntent.status === 'ambiguous' || actionIntent.status === 'needs_clarification') {
    return buildClarificationResolution({
      status: actionIntent.status,
      source: actionIntent.source,
      actionIntent,
      clarificationRequest: actionIntent.clarificationRequest,
      reason: actionIntent.reason,
      evidence: actionIntent.evidence,
      decisionTrace,
      warnings: uniqueStrings([
        ...warnings,
        ...actionIntent.warnings,
      ]),
      metadata: {
        sourceKind: 'semantic_intent_classification',
        classificationStatus,
      },
    });
  }

  const selectedCandidate = getSelectedCandidate(actionIntent);

  if (!selectedCandidate) {
    return buildClarificationResolution({
      status: 'needs_clarification',
      source: actionIntent.source,
      actionIntent,
      clarificationRequest: buildHighQualityClarificationRequest({
        clarificationId: 'clarification-semantic-selected-candidate-missing-001',
        reasonCategory: 'unsupported_request',
        existingQuestion: 'The runtime could not safely select the requested action. Please restate the request with a single explicit target.',
        candidates: [],
        missingContext: [
          'selected_action_candidate',
        ],
      warnings: [
        'Semantic action intent did not include a usable selected candidate.',
      ],
      request,
    }),
      reason: 'Semantic classification did not provide a usable selected candidate.',
      evidence: actionIntent.evidence,
      decisionTrace,
      warnings: uniqueStrings([
        ...warnings,
        ...actionIntent.warnings,
        'Semantic action intent did not include a usable selected candidate.',
      ]),
      metadata: {
        sourceKind: 'semantic_intent_classification',
        classificationStatus,
      },
    });
  }

  const readinessStatus = isNonEmptyString(selectedCandidate.metadata?.readinessStatus)
    ? selectedCandidate.metadata.readinessStatus.trim()
    : null;
  const commonFields = {
    source: actionIntent.source,
    selectedCandidate,
    actionIntent,
    reason: actionIntent.reason,
    evidence: actionIntent.evidence,
    decisionTrace: readinessStatus
      ? [...decisionTrace, `Selected candidate readiness status is ${readinessStatus}.`]
      : decisionTrace,
    warnings: uniqueStrings([
      ...warnings,
      ...actionIntent.warnings,
      ...selectedCandidate.warnings,
    ]),
    metadata: {
      sourceKind: 'semantic_intent_classification',
      classificationStatus,
      readinessStatus,
    },
  };
  const policyDecision = evaluateActionResolutionPolicy({
    candidate: selectedCandidate,
    readinessStatus,
    request,
  });

  if (actionIntent.understanding.requestType === 'plan_request') {
    const mergedFields = mergePolicyDecisionFields({
      evidence: commonFields.evidence,
      decisionTrace: commonFields.decisionTrace,
      warnings: commonFields.warnings,
      metadata: commonFields.metadata,
      policyDecision,
    });
    const policyReason = policyDecision.reason || actionIntent.reason;
    const previewCanProceedWithoutExecution = (
      policyDecision.status === 'denied'
      && policyDecision.metadata?.reasonCategory === 'readiness_denied'
    ) || (
      policyDecision.status === 'needs_clarification'
      && (
        policyDecision.metadata?.reasonCategory === 'readiness_unverified'
        || policyDecision.metadata?.reasonCategory === 'unsupported_readiness_status'
      )
    );

    if (policyDecision.status === 'needs_clarification' && !previewCanProceedWithoutExecution) {
      return buildClarificationResolution({
        status: 'needs_clarification',
        source: actionIntent.source,
        actionIntent,
        clarificationRequest: policyDecision.clarificationRequest,
        reason: policyReason,
        ...mergedFields,
      });
    }

    if (policyDecision.status === 'denied' && !previewCanProceedWithoutExecution) {
      return buildDeniedResolution({
        source: actionIntent.source,
        selectedCandidate,
        actionIntent,
        reason: policyReason,
        ...mergedFields,
      });
    }

    return buildPlanOnlyResolution({
      source: actionIntent.source,
      selectedCandidate,
      actionIntent,
      reason: policyReason,
      previewApprovalRequired: policyDecision.status === 'approval_required',
      previewRuntimeAction: runtimeActionForCandidate(selectedCandidate),
      evidence: mergedFields.evidence,
      decisionTrace: [
        ...mergedFields.decisionTrace,
        ...(previewCanProceedWithoutExecution
          ? ['Execution readiness is currently blocked or unverified, but a governed preview-only plan can still be provided without executing the target.']
          : []),
        'The request asked for a governed plan preview, so execution was not started in this invocation.',
      ],
      warnings: mergedFields.warnings,
      metadata: {
        ...mergedFields.metadata,
        previewExecutionReadinessStatus: policyDecision.status,
        previewExecutionReasonCategory: policyDecision.metadata?.reasonCategory ?? null,
      },
    });
  }

  return buildResolutionFromPolicyDecision({
    ...commonFields,
    policyDecision,
  });
}

function assertOptionalApprovalResumeResolution(actionResolution) {
  if (actionResolution === undefined || actionResolution === null) {
    return null;
  }

  const resolution = assertActionResolution(actionResolution);

  if (resolution.status === 'no_action') {
    return null;
  }

  if (resolution.source !== 'human_approval_resume') {
    throw new Error('Approval resume action resolution must use source "human_approval_resume".');
  }

  return resolution;
}

export function resolveActionForInvocation({
  request = null,
  approvalResumeActionResolution = null,
  toolRequestResolution = null,
  workflowRequestResolution = null,
  deterministicCommandResolution = null,
  semanticIntentClassification = null,
} = {}) {
  const approvalResumeResolution = assertOptionalApprovalResumeResolution(
    approvalResumeActionResolution,
  );

  if (approvalResumeResolution) {
    return approvalResumeResolution;
  }

  const explicitEnvelopeResolutions = [
    buildResolutionFromToolRequestResolution(toolRequestResolution, request),
    buildResolutionFromWorkflowRequestResolution(workflowRequestResolution, request),
  ].filter((resolution) => resolution !== null);

  if (explicitEnvelopeResolutions.length > 1) {
    return buildMultipleExplicitEnvelopeResolution({
      resolutions: explicitEnvelopeResolutions,
      request,
    });
  }

  if (explicitEnvelopeResolutions.length === 1) {
    if (shouldTreatRequestAsPreviewOnlyPlan({ request, semanticIntentClassification })) {
      return buildPlanPreviewResolutionFromExplicitEnvelope({
        resolution: explicitEnvelopeResolutions[0],
        semanticIntentClassification,
      });
    }

    return explicitEnvelopeResolutions[0];
  }

  const commandResolution = buildResolutionFromDeterministicCommand(
    deterministicCommandResolution,
    request,
  );

  if (commandResolution) {
    return commandResolution;
  }

  const semanticResolution = buildResolutionFromSemanticIntentClassification(
    semanticIntentClassification,
    request,
  );

  if (semanticResolution) {
    return semanticResolution;
  }

  return buildNoActionResolution({
    reason: 'No executable action source was available for this invocation.',
    evidence: [],
    decisionTrace: [
      'No approval resume action was present.',
      'No explicit tool/workflow envelope consumed the request.',
      'No deterministic command resolution consumed the request.',
      'No semantic intent classification was provided.',
      'Answer-only no-action fallback selected.',
    ],
    metadata: {
      hasRequest: isPlainObject(request),
    },
  });
}
