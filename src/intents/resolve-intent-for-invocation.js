import { assertIntentResolution } from '../contracts/actions/intent-resolution-contract.js';
import { assertBrainToolRequestResolution } from '../contracts/brain/brain-tool-request-contract.js';
import { assertBrainWorkflowRequestResolution } from '../contracts/brain/brain-workflow-request-contract.js';
import { resolveBrainToolRequestForInvocation } from '../tools/resolve-brain-tool-request-for-invocation.js';
import { resolveBrainWorkflowRequestForInvocation } from '../workflows/resolve-brain-workflow-request-for-invocation.js';

const MAS_SYSTEM_INSPECT_TOOL_ID = 'mas.system.inspect';
const MAS_TOOLS_INSPECT_TOOL_ID = 'mas.tools.inspect';
const MAS_WORKFLOWS_INSPECT_TOOL_ID = 'mas.workflows.inspect';
const MAS_PERMISSIONS_INSPECT_TOOL_ID = 'mas.permissions.inspect';
const MAS_HEALTH_REVIEW_WORKFLOW_ID = 'mas-health-review';

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeText(value) {
  return typeof value === 'string'
    ? value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/gu, '')
      .toLowerCase()
      .replace(/\s+/gu, ' ')
      .trim()
    : '';
}

function createSyntheticBrainOutput({ outputText }) {
  return {
    executionType: 'probabilistic_brain',
    providerId: 'runtime-intent-resolution',
    modelId: 'deterministic-intent-router',
    requestType: 'chat_completion',
    status: 'completed',
    outputText,
    finishReason: 'runtime_intent_resolution',
    providerResponseId: 'runtime-intent-resolution',
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
    },
    warnings: [],
  };
}

function buildNoIntentResolution(reason) {
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
    reason,
    evidence: [],
    warnings: [],
  });
}

function buildSkippedResolution(reason) {
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
    reason,
    evidence: [],
    warnings: [],
  });
}

function buildResolvedToolIntent({
  intentId,
  intentType,
  confidence,
  targetId,
  reason,
  evidence,
  warnings = [],
}) {
  return assertIntentResolution({
    kind: 'intent_resolution',
    version: 1,
    status: 'resolved',
    intentId,
    intentType,
    source: 'runtime_pattern',
    confidence,
    target: {
      targetType: 'tool',
      targetId,
    },
    runtimeAction: 'queue_tool_request',
    reason,
    evidence,
    warnings,
  });
}

function buildResolvedWorkflowIntent({
  intentId,
  intentType,
  confidence,
  targetId,
  reason,
  evidence,
  warnings = [],
}) {
  return assertIntentResolution({
    kind: 'intent_resolution',
    version: 1,
    status: 'resolved',
    intentId,
    intentType,
    source: 'runtime_pattern',
    confidence,
    target: {
      targetType: 'workflow',
      targetId,
    },
    runtimeAction: 'queue_workflow_request',
    reason,
    evidence,
    warnings,
  });
}

function buildBlockedToolIntent({
  intentId,
  intentType,
  confidence,
  targetId,
  reason,
  evidence,
  warnings = [],
}) {
  return assertIntentResolution({
    kind: 'intent_resolution',
    version: 1,
    status: 'blocked',
    intentId,
    intentType,
    source: 'runtime_pattern',
    confidence,
    target: {
      targetType: 'tool',
      targetId,
    },
    runtimeAction: 'reject',
    reason,
    evidence,
    warnings,
  });
}

function buildBlockedWorkflowIntent({
  intentId,
  intentType,
  confidence,
  targetId,
  reason,
  evidence,
  warnings = [],
}) {
  return assertIntentResolution({
    kind: 'intent_resolution',
    version: 1,
    status: 'blocked',
    intentId,
    intentType,
    source: 'runtime_pattern',
    confidence,
    target: {
      targetType: 'workflow',
      targetId,
    },
    runtimeAction: 'reject',
    reason,
    evidence,
    warnings,
  });
}

function buildNoChangeResult({
  intentResolution,
  toolRequestResolution,
  workflowRequestResolution,
}) {
  return {
    intentResolution,
    intentApplied: false,
    toolRequestResolution,
    workflowRequestResolution,
  };
}

function containsAny(normalizedText, fragments) {
  return fragments.some((fragment) => {
    return normalizedText.includes(fragment);
  });
}

function hasMasSubject(normalizedText) {
  return /\bmas\b/u.test(normalizedText)
    || /\bsystem\b/u.test(normalizedText)
    || /\bsistema\b/u.test(normalizedText)
    || normalizedText.includes('multi agent')
    || normalizedText.includes('multi-agent');
}

function isRetrospectiveInspectionQuestion(normalizedText) {
  return containsAny(normalizedText, [
    'tell me if you inspected',
    'did you inspect',
    'if you inspected',
    'if you already inspected',
    'si ya inspeccionaste',
    'si lo inspeccionaste',
    'ya inspeccionaste',
    'hiciste la inspeccion',
  ]);
}

function hasAdminExplanationSignal(normalizedText) {
  return containsAny(normalizedText, [
    'explain',
    'describe',
    'what is',
    'what does',
    'how does',
    'how can',
    'why',
    'available',
    'readiness',
    'can use',
    'can you use',
    'what tools',
    'which tools',
    'puedes explicar',
    'explica',
    'explicar',
    'que es',
    'para que sirve',
    'como funciona',
    'por que',
    'porque',
    'disponible',
    'puedes usar',
    'puedo usar',
  ]);
}

function hasToolSubject(normalizedText) {
  return containsAny(normalizedText, [
    'tool',
    'tools',
    'capability',
    'capabilities',
    'herramienta',
    'herramientas',
    MAS_SYSTEM_INSPECT_TOOL_ID,
    MAS_TOOLS_INSPECT_TOOL_ID,
    MAS_WORKFLOWS_INSPECT_TOOL_ID,
    MAS_PERMISSIONS_INSPECT_TOOL_ID,
  ]);
}

function hasWorkflowSubject(normalizedText) {
  return containsAny(normalizedText, [
    'workflow',
    'workflows',
    'flow',
    'runtime',
    'flujo',
    'flujos',
    MAS_HEALTH_REVIEW_WORKFLOW_ID,
  ]);
}

function hasPermissionSubject(normalizedText) {
  return containsAny(normalizedText, [
    'permission',
    'permissions',
    'binding',
    'bindings',
    'access',
    'resource',
    'denied',
    'unavailable',
    'draft',
    'publish',
    'send',
    'permiso',
    'permisos',
    'acceso',
    'recurso',
    'denegado',
    'borrador',
    'publicar',
    'enviar',
    'whatsapp',
    'instagram',
  ]);
}

function inferToolInspectorInput(normalizedText) {
  if (
    normalizedText.includes(MAS_SYSTEM_INSPECT_TOOL_ID)
    || (
      hasMasSubject(normalizedText)
      && hasToolSubject(normalizedText)
      && containsAny(normalizedText, ['inspect', 'inspection', 'inspeccion'])
    )
  ) {
    return {
      toolId: MAS_SYSTEM_INSPECT_TOOL_ID,
    };
  }

  if (normalizedText.includes(MAS_TOOLS_INSPECT_TOOL_ID)) {
    return {
      toolId: MAS_TOOLS_INSPECT_TOOL_ID,
    };
  }

  if (normalizedText.includes(MAS_WORKFLOWS_INSPECT_TOOL_ID)) {
    return {
      toolId: MAS_WORKFLOWS_INSPECT_TOOL_ID,
    };
  }

  if (normalizedText.includes(MAS_PERMISSIONS_INSPECT_TOOL_ID)) {
    return {
      toolId: MAS_PERMISSIONS_INSPECT_TOOL_ID,
    };
  }

  return {};
}

function inferWorkflowInspectorInput(normalizedText) {
  if (
    normalizedText.includes(MAS_HEALTH_REVIEW_WORKFLOW_ID)
    || containsAny(normalizedText, ['health review', 'revision de salud', 'estado de salud'])
  ) {
    return {
      workflowId: MAS_HEALTH_REVIEW_WORKFLOW_ID,
    };
  }

  return {};
}

function inferPermissionInspectorInput({
  normalizedText,
  operationalIdentityId,
}) {
  const exactResourceMatch = normalizedText.match(/\b[a-z0-9]+-(?:whatsapp|instagram)\b/u);
  const input = {};

  if (exactResourceMatch) {
    input.resourceId = exactResourceMatch[0];
  } else if (normalizedText.includes('whatsapp') && operationalIdentityId) {
    input.resourceId = `${operationalIdentityId}-whatsapp`;
  } else if (normalizedText.includes('instagram') && operationalIdentityId) {
    input.resourceId = `${operationalIdentityId}-instagram`;
  }

  if (containsAny(normalizedText, ['publish', 'publicar', 'send', 'enviar'])) {
    input.accessMode = 'publish';
  }

  return input;
}

function detectAdminExplanationIntent({ request }) {
  const normalizedText = normalizeText(request?.inputText);

  if (normalizedText.length === 0 || !hasAdminExplanationSignal(normalizedText)) {
    return null;
  }

  if (hasPermissionSubject(normalizedText)) {
    return {
      intentId: 'admin.mas.permissions.inspect',
      intentType: 'administrative_permission_explanation',
      confidence: 'high',
      targetId: MAS_PERMISSIONS_INSPECT_TOOL_ID,
      input: inferPermissionInspectorInput({
        normalizedText,
        operationalIdentityId: request?.operationalIdentityId,
      }),
      evidence: ['User requested an explanation of permissions, resource access, bindings, or availability gates.'],
    };
  }

  if (hasWorkflowSubject(normalizedText)) {
    return {
      intentId: 'admin.mas.workflows.inspect',
      intentType: 'administrative_workflow_explanation',
      confidence: 'high',
      targetId: MAS_WORKFLOWS_INSPECT_TOOL_ID,
      input: inferWorkflowInspectorInput(normalizedText),
      evidence: ['User requested an explanation of workflow readiness or workflow availability.'],
    };
  }

  if (hasToolSubject(normalizedText)) {
    return {
      intentId: 'admin.mas.tools.inspect',
      intentType: 'administrative_tool_explanation',
      confidence: 'high',
      targetId: MAS_TOOLS_INSPECT_TOOL_ID,
      input: inferToolInspectorInput(normalizedText),
      evidence: ['User requested an explanation of tool readiness or tool availability.'],
    };
  }

  return null;
}

function detectMasHealthReviewIntent(inputText) {
  const normalizedText = normalizeText(inputText);

  if (!hasMasSubject(normalizedText)) {
    return null;
  }

  if (containsAny(normalizedText, [
    'mas-health-review',
    'health review',
    'deeper health review',
    'full health review',
    'comprehensive health review',
    'revision de salud',
    'revisar la salud',
    'estado de salud',
    'diagnostico profundo',
    'revision completa',
  ])) {
    return {
      intentId: 'admin.mas.health_review',
      intentType: 'administrative_health_review',
      confidence: 'high',
      evidence: ['User requested a MAS health review or a broader diagnostic workflow.'],
    };
  }

  return null;
}

function detectMasInspectionIntent(inputText) {
  const normalizedText = normalizeText(inputText);

  if (!hasMasSubject(normalizedText) || isRetrospectiveInspectionQuestion(normalizedText)) {
    return null;
  }

  if (containsAny(normalizedText, [
    'mas system inspect',
    'system inspect',
    'inspect the mas',
    'inspect mas',
    'inspect the system',
    'inspect system',
    'inspection of the mas',
    'inspecciona el mas',
    'inspeccionar el mas',
    'inspeccionando el mas',
    'inspeccion del mas',
    'revisar el mas',
    'revisando el mas',
    'diagnosticar el mas',
    'diagnostico del mas',
    'verificar el mas',
    'chequear el mas',
    'auditar el mas',
  ])) {
    return {
      intentId: 'admin.mas.inspect',
      intentType: 'administrative_inspection',
      confidence: 'high',
      evidence: ['User directly asked to inspect, review, diagnose, verify, or audit the MAS/system.'],
    };
  }

  return null;
}

function selectRuntimeIntent({ request }) {
  const normalizedInputText = normalizeText(request?.inputText);

  if (normalizedInputText.length === 0) {
    return null;
  }

  return detectAdminExplanationIntent({ request })
    ?? detectMasHealthReviewIntent(normalizedInputText)
    ?? detectMasInspectionIntent(normalizedInputText);
}

function buildSyntheticAdminToolRequest({
  toolRequestId,
  toolId,
  input = {},
  purpose,
}) {
  return {
    kind: 'brain_tool_request',
    version: 1,
    toolRequestId,
    toolId,
    input,
    purpose,
    expectedSideEffectLevel: 'read_only',
  };
}

function buildSyntheticInspectToolRequest() {
  return {
    kind: 'brain_tool_request',
    version: 1,
    toolRequestId: 'runtime-intent-admin-mas-inspect-001',
    toolId: MAS_SYSTEM_INSPECT_TOOL_ID,
    input: {
      sections: [
        'overview',
        'agents',
        'operationalIdentities',
        'resources',
        'tools',
        'workflows',
        'memory',
        'warnings',
        'diagnosticSummary',
      ],
      includeCounts: true,
      includeReadiness: true,
    },
    purpose: 'Runtime resolved the user request as an explicit MAS inspection intent and routed it through the read-only MAS System Inspect tool.',
    expectedSideEffectLevel: 'read_only',
  };
}

function buildSyntheticHealthReviewWorkflowRequest() {
  return {
    kind: 'brain_workflow_request',
    version: 1,
    workflowRequestId: 'runtime-intent-admin-mas-health-review-001',
    workflowId: MAS_HEALTH_REVIEW_WORKFLOW_ID,
    input: {
      requestedSections: [
        'overview',
        'agents',
        'operationalIdentities',
        'resources',
        'tools',
        'workflows',
        'memory',
        'warnings',
      ],
    },
    purpose: 'Runtime resolved the user request as a MAS health review intent and routed it through the read-only MAS Health Review workflow.',
    expectedSideEffectLevel: 'read_only',
  };
}

function resolveSyntheticToolRequest({ toolRequest, toolReadinessEvaluation }) {
  return resolveBrainToolRequestForInvocation({
    brainOutput: createSyntheticBrainOutput({
      outputText: JSON.stringify(toolRequest),
    }),
    toolReadinessEvaluation,
  });
}

function resolveSyntheticWorkflowRequest({ workflowRequest, workflowRuntimeDefinitions }) {
  return resolveBrainWorkflowRequestForInvocation({
    brainOutput: createSyntheticBrainOutput({
      outputText: JSON.stringify(workflowRequest),
    }),
    workflowRuntimeDefinitions,
  });
}

function resolveMasInspectionIntent({
  runtimeIntent,
  toolRequestResolution,
  workflowRequestResolution,
  toolReadinessEvaluation,
}) {
  const toolRequest = buildSyntheticInspectToolRequest();
  const resolvedToolRequest = resolveSyntheticToolRequest({
    toolRequest,
    toolReadinessEvaluation,
  });

  if (resolvedToolRequest.status !== 'accepted') {
    return buildNoChangeResult({
      intentResolution: buildBlockedToolIntent({
        intentId: runtimeIntent.intentId,
        intentType: runtimeIntent.intentType,
        confidence: runtimeIntent.confidence,
        targetId: MAS_SYSTEM_INSPECT_TOOL_ID,
        reason: `Runtime detected MAS inspection intent, but ${MAS_SYSTEM_INSPECT_TOOL_ID} was not executable: ${resolvedToolRequest.reason}`,
        evidence: runtimeIntent.evidence,
        warnings: resolvedToolRequest.warnings,
      }),
      toolRequestResolution,
      workflowRequestResolution,
    });
  }

  return {
    intentResolution: buildResolvedToolIntent({
      intentId: runtimeIntent.intentId,
      intentType: runtimeIntent.intentType,
      confidence: runtimeIntent.confidence,
      targetId: MAS_SYSTEM_INSPECT_TOOL_ID,
      reason: `Runtime resolved the user request to ${MAS_SYSTEM_INSPECT_TOOL_ID} because the brain did not emit a tool request envelope.`,
      evidence: runtimeIntent.evidence,
      warnings: [
        'Brain output did not contain a tool request envelope, but runtime intent resolution detected a safe administrative inspection intent.',
      ],
    }),
    intentApplied: true,
    toolRequestResolution: assertBrainToolRequestResolution({
      ...resolvedToolRequest,
      reason: `Runtime intent resolution accepted ${MAS_SYSTEM_INSPECT_TOOL_ID} for execution after the brain omitted the request envelope.`,
      warnings: [
        ...resolvedToolRequest.warnings,
        'Brain output did not contain a tool request envelope, but runtime intent resolution detected a safe administrative inspection intent.',
      ],
    }),
    workflowRequestResolution,
  };
}

function resolveAdminExplanationIntent({
  runtimeIntent,
  toolRequestResolution,
  workflowRequestResolution,
  toolReadinessEvaluation,
}) {
  const toolRequest = buildSyntheticAdminToolRequest({
    toolRequestId: `runtime-intent-${runtimeIntent.intentId.replaceAll('.', '-')}-001`,
    toolId: runtimeIntent.targetId,
    input: runtimeIntent.input,
    purpose: `Runtime resolved the user request as an admin explanation intent and routed it through ${runtimeIntent.targetId}.`,
  });
  const resolvedToolRequest = resolveSyntheticToolRequest({
    toolRequest,
    toolReadinessEvaluation,
  });

  if (resolvedToolRequest.status !== 'accepted') {
    return buildNoChangeResult({
      intentResolution: buildBlockedToolIntent({
        intentId: runtimeIntent.intentId,
        intentType: runtimeIntent.intentType,
        confidence: runtimeIntent.confidence,
        targetId: runtimeIntent.targetId,
        reason: `Runtime detected admin explanation intent, but ${runtimeIntent.targetId} was not executable: ${resolvedToolRequest.reason}`,
        evidence: runtimeIntent.evidence,
        warnings: resolvedToolRequest.warnings,
      }),
      toolRequestResolution,
      workflowRequestResolution,
    });
  }

  return {
    intentResolution: buildResolvedToolIntent({
      intentId: runtimeIntent.intentId,
      intentType: runtimeIntent.intentType,
      confidence: runtimeIntent.confidence,
      targetId: runtimeIntent.targetId,
      reason: `Runtime resolved the user request to ${runtimeIntent.targetId} because the brain did not emit a tool request envelope.`,
      evidence: runtimeIntent.evidence,
      warnings: [
        'Brain output did not contain a tool request envelope, but runtime intent resolution detected a safe administrative explanation intent.',
      ],
    }),
    intentApplied: true,
    toolRequestResolution: assertBrainToolRequestResolution({
      ...resolvedToolRequest,
      reason: `Runtime intent resolution accepted ${runtimeIntent.targetId} for execution after the brain omitted the request envelope.`,
      warnings: [
        ...resolvedToolRequest.warnings,
        'Brain output did not contain a tool request envelope, but runtime intent resolution detected a safe administrative explanation intent.',
      ],
    }),
    workflowRequestResolution,
  };
}

function resolveMasHealthReviewIntent({
  runtimeIntent,
  toolRequestResolution,
  workflowRequestResolution,
  workflowRuntimeDefinitions,
}) {
  const workflowRequest = buildSyntheticHealthReviewWorkflowRequest();
  const resolvedWorkflowRequest = resolveSyntheticWorkflowRequest({
    workflowRequest,
    workflowRuntimeDefinitions,
  });

  if (resolvedWorkflowRequest.status !== 'accepted') {
    return buildNoChangeResult({
      intentResolution: buildBlockedWorkflowIntent({
        intentId: runtimeIntent.intentId,
        intentType: runtimeIntent.intentType,
        confidence: runtimeIntent.confidence,
        targetId: MAS_HEALTH_REVIEW_WORKFLOW_ID,
        reason: `Runtime detected MAS health review intent, but ${MAS_HEALTH_REVIEW_WORKFLOW_ID} was not executable: ${resolvedWorkflowRequest.reason}`,
        evidence: runtimeIntent.evidence,
        warnings: resolvedWorkflowRequest.warnings,
      }),
      toolRequestResolution,
      workflowRequestResolution,
    });
  }

  return {
    intentResolution: buildResolvedWorkflowIntent({
      intentId: runtimeIntent.intentId,
      intentType: runtimeIntent.intentType,
      confidence: runtimeIntent.confidence,
      targetId: MAS_HEALTH_REVIEW_WORKFLOW_ID,
      reason: `Runtime resolved the user request to ${MAS_HEALTH_REVIEW_WORKFLOW_ID} because the brain did not emit a workflow request envelope.`,
      evidence: runtimeIntent.evidence,
      warnings: [
        'Brain output did not contain a workflow request envelope, but runtime intent resolution detected a safe administrative health review intent.',
      ],
    }),
    intentApplied: true,
    toolRequestResolution,
    workflowRequestResolution: assertBrainWorkflowRequestResolution({
      ...resolvedWorkflowRequest,
      reason: `Runtime intent resolution accepted ${MAS_HEALTH_REVIEW_WORKFLOW_ID} for execution after the brain omitted the request envelope.`,
      warnings: [
        ...resolvedWorkflowRequest.warnings,
        'Brain output did not contain a workflow request envelope, but runtime intent resolution detected a safe administrative health review intent.',
      ],
    }),
  };
}

export function resolveIntentForInvocation({
  request,
  toolRequestResolution,
  workflowRequestResolution,
  toolReadinessEvaluation = null,
  workflowRuntimeDefinitions = [],
} = {}) {
  const normalizedToolRequestResolution = assertBrainToolRequestResolution(toolRequestResolution);
  const normalizedWorkflowRequestResolution = assertBrainWorkflowRequestResolution(workflowRequestResolution);

  if (!isPlainObject(request)) {
    return buildNoChangeResult({
      intentResolution: buildSkippedResolution('Intent resolution was skipped because no invocation request was available.'),
      toolRequestResolution: normalizedToolRequestResolution,
      workflowRequestResolution: normalizedWorkflowRequestResolution,
    });
  }

  if (request.command !== 'ask') {
    return buildNoChangeResult({
      intentResolution: buildSkippedResolution(`Intent resolution was skipped because command is ${request.command}.`),
      toolRequestResolution: normalizedToolRequestResolution,
      workflowRequestResolution: normalizedWorkflowRequestResolution,
    });
  }

  if (normalizedToolRequestResolution.status !== 'no_request') {
    return buildNoChangeResult({
      intentResolution: buildSkippedResolution(`Intent resolution was skipped because the brain tool request status is ${normalizedToolRequestResolution.status}.`),
      toolRequestResolution: normalizedToolRequestResolution,
      workflowRequestResolution: normalizedWorkflowRequestResolution,
    });
  }

  if (normalizedWorkflowRequestResolution.status !== 'no_request') {
    return buildNoChangeResult({
      intentResolution: buildSkippedResolution(`Intent resolution was skipped because the brain workflow request status is ${normalizedWorkflowRequestResolution.status}.`),
      toolRequestResolution: normalizedToolRequestResolution,
      workflowRequestResolution: normalizedWorkflowRequestResolution,
    });
  }

  const runtimeIntent = selectRuntimeIntent({ request });

  if (!runtimeIntent) {
    return buildNoChangeResult({
      intentResolution: buildNoIntentResolution('Intent resolution did not detect a safe runtime action intent.'),
      toolRequestResolution: normalizedToolRequestResolution,
      workflowRequestResolution: normalizedWorkflowRequestResolution,
    });
  }

  if (runtimeIntent.intentId === 'admin.mas.inspect') {
    return resolveMasInspectionIntent({
      runtimeIntent,
      toolRequestResolution: normalizedToolRequestResolution,
      workflowRequestResolution: normalizedWorkflowRequestResolution,
      toolReadinessEvaluation,
    });
  }

  if ([
    'admin.mas.tools.inspect',
    'admin.mas.workflows.inspect',
    'admin.mas.permissions.inspect',
  ].includes(runtimeIntent.intentId)) {
    return resolveAdminExplanationIntent({
      runtimeIntent,
      toolRequestResolution: normalizedToolRequestResolution,
      workflowRequestResolution: normalizedWorkflowRequestResolution,
      toolReadinessEvaluation,
    });
  }

  if (runtimeIntent.intentId === 'admin.mas.health_review') {
    return resolveMasHealthReviewIntent({
      runtimeIntent,
      toolRequestResolution: normalizedToolRequestResolution,
      workflowRequestResolution: normalizedWorkflowRequestResolution,
      workflowRuntimeDefinitions,
    });
  }

  return buildNoChangeResult({
    intentResolution: buildNoIntentResolution(`Intent resolution detected unsupported intent ${runtimeIntent.intentId}.`),
    toolRequestResolution: normalizedToolRequestResolution,
    workflowRequestResolution: normalizedWorkflowRequestResolution,
  });
}

export {
  MAS_HEALTH_REVIEW_WORKFLOW_ID,
  MAS_PERMISSIONS_INSPECT_TOOL_ID,
  MAS_SYSTEM_INSPECT_TOOL_ID,
  MAS_TOOLS_INSPECT_TOOL_ID,
  MAS_WORKFLOWS_INSPECT_TOOL_ID,
  detectAdminExplanationIntent,
  detectMasHealthReviewIntent,
  detectMasInspectionIntent,
  normalizeText,
};
