import { assertBrainOutput } from '../contracts/brain/brain-output-contract.js';
import {
  buildLocalizedClarificationQuestion,
  resolveActionRuntimeLocale,
} from '../localization/action-runtime-localization.js';

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function escapeRegularExpression(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

const PLAN_PREVIEW_SIGNAL_PATTERNS = [
  /\bplan\b/iu,
  /\bpreview\b/iu,
  /\boutline\b/iu,
  /\bbefore\s+(?:acting|execution|executing)\b/iu,
  /\bplan\s+de\b/iu,
  /\bantes\s+de\s+ejecutar\b/iu,
  /\bprevi[oa]\b/iu,
  /\bplano\s+de\b/iu,
  /\bantes\s+de\s+executar\b/iu,
];

const STRUCTURED_PLAN_MARKER_PATTERNS = [
  /^#{1,6}\s+/mu,
  /^\d+\.\s+/mu,
  /^-\s+/mu,
  /\bchecklist\b/iu,
  /\bpasos\b/iu,
  /\bsteps\b/iu,
  /\bcriterios\b/iu,
  /\bcriteria\b/iu,
];

const PREVIEW_EXECUTION_CLAIM_PATTERNS = [
  /\bI (?:executed|ran|performed)\b/iu,
  /\bwe (?:executed|ran|performed)\b/iu,
  /\bI (?:will|am going to)\s+execute\b/iu,
  /\bwe (?:will|are going to)\s+execute\b/iu,
  /\bI will now request\b/iu,
  /\bwe will now request\b/iu,
  /\bI will request the (?:tool|workflow)\b/iu,
  /\bwe will request the (?:tool|workflow)\b/iu,
  /\btool-run-[a-z0-9-]+\b/iu,
  /\bworkflow-run-[a-z0-9-]+\b/iu,
  /\bhe realizado\b/iu,
  /\bhemos ejecutado\b/iu,
  /\bacabamos de ejecutar\b/iu,
  /\bvoy a ejecutar\b/iu,
  /\bvamos a ejecutar\b/iu,
  /\bejecutar[eé]\s+la\s+(?:herramienta|tool)\b/iu,
  /\bvoy\s+a\s+realizar\s+una\s+inspecci[oó]n\b/iu,
  /\bvoy\s+a\s+realizar\s+una\s+inspecci[oó]n\s+completa\b/iu,
  /\bdebo ejecutar\b/iu,
  /\bahora voy a solicitar\b/iu,
  /\bsolicitare la (?:herramienta|tool)\b/iu,
  /\bsolicitaremos la (?:herramienta|tool)\b/iu,
  /\bvoy a solicitar la (?:herramienta|tool)\b/iu,
  /\bresultado de la inspecci[oó]n\b/iu,
  /\bevidencia (?:t[eé]cnica|observada)\b/iu,
  /\binspecci[oó]n (?:inicial|previa)\b/iu,
];

const PREVIEW_RUNTIME_EVIDENCE_CLAIM_PATTERNS = [
  /\bRuntime-Resolved Evidence\b/iu,
  /\bGrounded in Runtime Evidence\b/iu,
  /\bRecent tool activity\b/iu,
  /\bMachine state:\s*(?:active|ready|stable|healthy|operational)\b/iu,
  /\bNo permission gaps detected\b/iu,
  /\bInspection Timestamp:\b/iu,
  /\bConfidence Score:\s*\d+/iu,
  /\bRegistered Identities:\s*\d+/iu,
  /\breadiness scores?\b/iu,
  /\bmas-warning-templates\b/iu,
  /\bpolicy\s+\d+\b/iu,
];

const UNSUPPORTED_PLAN_DELIVERABLE_PATTERNS = [
  /\baudit_report\.json\b/iu,
  /\bevidence_gap_report\.json\b/iu,
  /\bpolicy_compliance_report\.json\b/iu,
  /\bimprovement_roadmap\.md\b/iu,
  /\bhealth-review-[a-z0-9<>_-]+\.json\b/iu,
];

const RAW_PLAN_REQUEST_ENVELOPE_PATTERNS = [
  /<tool_call>\s*[a-z0-9._-]+[\s\S]*$/iu,
  /<workflow_call>\s*[a-z0-9._-]+[\s\S]*$/iu,
  /^\s*\{[\s\S]*?"kind"\s*:\s*"brain_(?:tool|workflow)_request"[\s\S]*?\}\s*$/iu,
  /^\s*```(?:json)?\s*\{[\s\S]*?"kind"\s*:\s*"brain_(?:tool|workflow)_request"[\s\S]*?\}\s*```\s*$/iu,
];

const BACKTICKED_IDENTIFIER_PATTERN = /`([a-z0-9][a-z0-9._-]*)`/giu;

function matchesAnyPattern(value, patterns) {
  if (!isNonEmptyString(value)) {
    return false;
  }

  return patterns.some((pattern) => pattern.test(value));
}

function requestLooksLikePlanPreview(request) {
  const inputText = [
    request?.originalInput,
    request?.inputText,
    request?.input,
  ].find(isNonEmptyString);

  return matchesAnyPattern(inputText, PLAN_PREVIEW_SIGNAL_PATTERNS);
}

function outputLooksLikeStructuredPlan(outputText) {
  if (!isNonEmptyString(outputText)) {
    return false;
  }

  const matchedMarkerCount = STRUCTURED_PLAN_MARKER_PATTERNS.reduce((count, pattern) => {
    return count + (pattern.test(outputText) ? 1 : 0);
  }, 0);

  return matchedMarkerCount >= 2;
}

function outputClaimsPreviewExecution(outputText) {
  return matchesAnyPattern(outputText, PREVIEW_EXECUTION_CLAIM_PATTERNS);
}

function outputClaimsUnsupportedPlanDeliverables(outputText) {
  return matchesAnyPattern(outputText, UNSUPPORTED_PLAN_DELIVERABLE_PATTERNS);
}

function outputClaimsUnverifiedRuntimeEvidence(outputText) {
  return matchesAnyPattern(outputText, PREVIEW_RUNTIME_EVIDENCE_CLAIM_PATTERNS);
}

function outputIsMachineReadablePlanEnvelope(outputText) {
  return matchesAnyPattern(outputText, RAW_PLAN_REQUEST_ENVELOPE_PATTERNS);
}

function outputMentionsRuntimeSelectedTarget(outputText, targetId) {
  if (!isNonEmptyString(outputText) || !isNonEmptyString(targetId)) {
    return false;
  }

  const escapedTargetId = escapeRegularExpression(targetId.trim());
  return new RegExp(`\\b${escapedTargetId}\\b`, 'iu').test(outputText);
}

function collectBacktickedIdentifiers(outputText) {
  if (!isNonEmptyString(outputText)) {
    return [];
  }

  const identifiers = [];

  for (const match of outputText.matchAll(BACKTICKED_IDENTIFIER_PATTERN)) {
    if (!isNonEmptyString(match[1])) {
      continue;
    }

    identifiers.push(match[1].trim());
  }

  return [...new Set(identifiers)];
}

function looksLikeMasRuntimeAffordanceId(value) {
  if (!isNonEmptyString(value)) {
    return false;
  }

  const normalizedValue = value.trim().toLowerCase();
  return normalizedValue.startsWith('mas.') || normalizedValue.startsWith('mas-');
}

function collectUnsupportedAffordanceReferences(outputText, {
  selectedTarget = null,
  executionPlan = null,
} = {}) {
  const allowedIds = new Set(
    [
      selectedTarget?.targetId,
      ...(Array.isArray(executionPlan?.requiredTools) ? executionPlan.requiredTools : []),
      ...(Array.isArray(executionPlan?.requiredWorkflows) ? executionPlan.requiredWorkflows : []),
    ]
      .filter(isNonEmptyString)
      .map((value) => value.trim()),
  );

  return collectBacktickedIdentifiers(outputText)
    .filter((identifier) => looksLikeMasRuntimeAffordanceId(identifier))
    .filter((identifier) => !allowedIds.has(identifier));
}

const ENGLISH_CLARIFICATION_PATTERN = /\b(i could not classify|please restate the action|do you want me to use|are you referring to)\b/iu;

function getPlanPreviewClarificationSource({
  actionResolution = null,
  executionPlan = null,
} = {}) {
  if (isPlainObject(actionResolution?.clarificationRequest)) {
    return actionResolution.clarificationRequest;
  }

  if (isPlainObject(executionPlan?.clarificationRequest)) {
    return executionPlan.clarificationRequest;
  }

  return null;
}

function shouldRelocalizeClarificationQuestion(question, locale) {
  if (!isNonEmptyString(question)) {
    return false;
  }

  if (locale === 'en') {
    return false;
  }

  return ENGLISH_CLARIFICATION_PATTERN.test(question);
}

function resolvePlanPreviewClarificationQuestion({
  locale,
  actionResolution = null,
  executionPlan = null,
} = {}) {
  const clarificationSource = getPlanPreviewClarificationSource({
    actionResolution,
    executionPlan,
  });

  if (!isPlainObject(clarificationSource)) {
    return null;
  }

  const existingQuestion = isNonEmptyString(clarificationSource.question)
    ? clarificationSource.question.trim()
    : null;

  if (!shouldRelocalizeClarificationQuestion(existingQuestion, locale)) {
    return existingQuestion;
  }

  const optionHints = Array.isArray(clarificationSource.metadata?.optionHints)
    ? clarificationSource.metadata.optionHints
    : [];
  const contextReferences = Array.isArray(clarificationSource.metadata?.contextReferences)
    ? clarificationSource.metadata.contextReferences
    : [];

  return buildLocalizedClarificationQuestion({
    locale,
    reasonCategory: clarificationSource.reasonCategory,
    optionHints,
    contextReferences,
  });
}

function buildDraftPlanDowngradeMessage({
  locale,
  clarificationQuestion = null,
}) {
  if (locale === 'es') {
    return [
      'Puedo ayudarte con un plan, pero esta respuesta no quedo validada como un plan gobernado por el runtime.',
      'Por ahora solo puedo presentarlo como un borrador no verificado.',
      clarificationQuestion
        ? `Aclaracion necesaria: ${clarificationQuestion}`
        : 'Por favor acota el objetivo o nombra la herramienta o el flujo que quieres planificar directamente.',
    ].join('\n\n');
  }

  if (locale === 'pt') {
    return [
      'Posso ajudar com um plano, mas esta resposta ainda nao foi validada como um plano governado pelo runtime.',
      'Por enquanto, so posso apresenta-la como um rascunho nao verificado.',
      clarificationQuestion
        ? `Esclarecimento necessario: ${clarificationQuestion}`
        : 'Por favor, restrinja o objetivo ou informe diretamente a ferramenta ou o fluxo que voce quer planejar.',
    ].join('\n\n');
  }

  return [
    'I can help with a plan, but this response was not validated as a runtime-governed plan yet.',
    'For now, I can only present it as an unverified draft.',
    clarificationQuestion
      ? `Clarification needed: ${clarificationQuestion}`
      : 'Please narrow the goal or name the tool or workflow you want me to plan directly.',
  ].join('\n\n');
}

function resolvePlanPreviewTarget({
  actionResolution = null,
  executionPlan = null,
} = {}) {
  const selectedCandidate = actionResolution?.selectedCandidate ?? null;

  if (
    isPlainObject(selectedCandidate)
    && isNonEmptyString(selectedCandidate.targetType)
    && isNonEmptyString(selectedCandidate.targetId)
  ) {
    return {
      targetType: selectedCandidate.targetType.trim(),
      targetId: selectedCandidate.targetId.trim(),
      sideEffectLevel: isNonEmptyString(selectedCandidate.sideEffectLevel)
        ? selectedCandidate.sideEffectLevel.trim()
        : null,
    };
  }

  const targetType = isNonEmptyString(executionPlan?.metadata?.targetType)
    ? executionPlan.metadata.targetType.trim()
    : null;
  const targetId = isNonEmptyString(executionPlan?.metadata?.targetId)
    ? executionPlan.metadata.targetId.trim()
    : null;

  if (!targetType || !targetId) {
    return null;
  }

  return {
    targetType,
    targetId,
    sideEffectLevel: null,
  };
}

function formatPreviewTargetLabel({
  locale,
  targetType,
  targetId,
} = {}) {
  if (!isNonEmptyString(targetType) || !isNonEmptyString(targetId)) {
    return null;
  }

  if (locale === 'es') {
    return targetType === 'workflow'
      ? `el flujo \`${targetId}\``
      : `la herramienta \`${targetId}\``;
  }

  if (locale === 'pt') {
    return targetType === 'workflow'
      ? `o fluxo \`${targetId}\``
      : `a ferramenta \`${targetId}\``;
  }

  return targetType === 'workflow'
    ? `the workflow \`${targetId}\``
    : `the tool \`${targetId}\``;
}

function formatCapabilitySummary({
  locale,
  requiredTools = [],
  requiredWorkflows = [],
} = {}) {
  const normalizedTools = requiredTools.filter(isNonEmptyString).map((value) => value.trim());
  const normalizedWorkflows = requiredWorkflows.filter(isNonEmptyString).map((value) => value.trim());
  const parts = [];

  if (normalizedTools.length > 0) {
    parts.push(
      locale === 'es'
        ? `Herramientas previstas: ${normalizedTools.map((toolId) => `\`${toolId}\``).join(', ')}.`
        : locale === 'pt'
          ? `Ferramentas previstas: ${normalizedTools.map((toolId) => `\`${toolId}\``).join(', ')}.`
          : `Planned tools: ${normalizedTools.map((toolId) => `\`${toolId}\``).join(', ')}.`,
    );
  }

  if (normalizedWorkflows.length > 0) {
    parts.push(
      locale === 'es'
        ? `Flujos previstos: ${normalizedWorkflows.map((workflowId) => `\`${workflowId}\``).join(', ')}.`
        : locale === 'pt'
          ? `Fluxos previstos: ${normalizedWorkflows.map((workflowId) => `\`${workflowId}\``).join(', ')}.`
          : `Planned workflows: ${normalizedWorkflows.map((workflowId) => `\`${workflowId}\``).join(', ')}.`,
    );
  }

  return parts.join('\n');
}

function buildGovernedPlanPreviewMessage({
  locale,
  actionResolution = null,
  executionPlan = null,
} = {}) {
  const target = resolvePlanPreviewTarget({
    actionResolution,
    executionPlan,
  });

  if (!target || !['tool', 'workflow'].includes(target.targetType)) {
    return null;
  }

  const targetLabel = formatPreviewTargetLabel({
    locale,
    targetType: target.targetType,
    targetId: target.targetId,
  });
  const requiredTools = Array.isArray(executionPlan?.requiredTools)
    ? executionPlan.requiredTools
    : [];
  const requiredWorkflows = Array.isArray(executionPlan?.requiredWorkflows)
    ? executionPlan.requiredWorkflows
    : [];
  const capabilitySummary = formatCapabilitySummary({
    locale,
    requiredTools,
    requiredWorkflows,
  });
  const requiresApproval = Array.isArray(executionPlan?.requiredApprovals)
    && executionPlan.requiredApprovals.length > 0;
  const executeLine = locale === 'es'
    ? `2. Cuando lo solicites de forma explicita, ejecutar ${targetLabel} a traves del runtime gobernado${requiresApproval ? ' despues de la aprobacion humana requerida' : ''}.`
    : locale === 'pt'
      ? `2. Quando voce solicitar explicitamente, executar ${targetLabel} pelo runtime governado${requiresApproval ? ' depois da aprovacao humana exigida' : ''}.`
      : `2. When you explicitly ask to proceed, execute ${targetLabel} through the governed runtime${requiresApproval ? ' after the required human approval' : ''}.`;

  if (locale === 'es') {
    return [
      `Puedo ayudarte con un plan gobernado de solo lectura para ${targetLabel}.`,
      capabilitySummary || `Capacidad seleccionada por el runtime: ${targetLabel}.`,
      [
        'Ruta propuesta:',
        '1. Confirmar el alcance exacto de la revision o de la inspeccion.',
        executeLine,
        '3. Verificar la observacion de runtime antes de aceptar hallazgos o afirmar resultados.',
        '4. Entregarte un resumen acotado por evidencia.',
      ].join('\n'),
      [
        'Estado actual:',
        '- Esta invocacion quedo en `plan_only`.',
        '- No se ejecuto ninguna accion en este turno.',
      ].join('\n'),
      `Siguiente paso: si quieres continuar, pide ejecutar \`${target.targetId}\` o ajusta el alcance del plan.`,
    ].join('\n\n');
  }

  if (locale === 'pt') {
    return [
      `Posso ajudar com um plano governado de somente leitura para ${targetLabel}.`,
      capabilitySummary || `Capacidade selecionada pelo runtime: ${targetLabel}.`,
      [
        'Rota proposta:',
        '1. Confirmar o escopo exato da revisao ou da inspecao.',
        executeLine,
        '3. Verificar a observacao do runtime antes de aceitar achados ou afirmar resultados.',
        '4. Entregar um resumo limitado pela evidencia.',
      ].join('\n'),
      [
        'Estado atual:',
        '- Esta invocacao permaneceu em `plan_only`.',
        '- Nenhuma acao foi executada neste turno.',
      ].join('\n'),
      `Proximo passo: se quiser continuar, peca para executar \`${target.targetId}\` ou ajuste o escopo do plano.`,
    ].join('\n\n');
  }

  return [
    `I can help with a governed read-only plan for ${targetLabel}.`,
    capabilitySummary || `Runtime-selected capability: ${targetLabel}.`,
    [
      'Proposed path:',
      '1. Confirm the exact inspection or review scope.',
      executeLine,
      '3. Verify runtime observation evidence before accepting findings or claiming results.',
      '4. Deliver an evidence-bounded summary.',
    ].join('\n'),
    [
      'Current status:',
      '- This invocation remained in `plan_only`.',
      '- No action was executed in this turn.',
    ].join('\n'),
    `Next step: if you want to continue, ask me to execute \`${target.targetId}\` or narrow the plan scope.`,
  ].join('\n\n');
}

export function governPlanPreviewOutput({
  request,
  brainOutput,
  providerResponse = null,
  actionResolution = null,
  executionPlan = null,
  planExecutionCoordination = null,
  brainToolExecution = null,
  brainWorkflowExecution = null,
} = {}) {
  const normalizedBrainOutput = assertBrainOutput(brainOutput);

  if (normalizedBrainOutput.status !== 'completed') {
    return {
      brainOutput: normalizedBrainOutput,
      providerResponse,
      downgraded: false,
      reason: null,
    };
  }

  const runtimeValidatedPlan = actionResolution?.status === 'plan_only';
  const coordinationStatus = isNonEmptyString(planExecutionCoordination?.status)
    ? planExecutionCoordination.status
    : null;
  const executionObserved = Boolean(brainToolExecution?.executionPerformed || brainWorkflowExecution?.executionPerformed);

  if (executionObserved) {
    return {
      brainOutput: normalizedBrainOutput,
      providerResponse,
      downgraded: false,
      reason: null,
    };
  }

  const claimsPreviewExecution = outputClaimsPreviewExecution(normalizedBrainOutput.outputText);
  const claimsUnsupportedDeliverables = outputClaimsUnsupportedPlanDeliverables(normalizedBrainOutput.outputText);
  const claimsUnverifiedRuntimeEvidence = outputClaimsUnverifiedRuntimeEvidence(normalizedBrainOutput.outputText);
  const machineReadablePlanEnvelope = outputIsMachineReadablePlanEnvelope(normalizedBrainOutput.outputText);
  const runtimePreviewTarget = runtimeValidatedPlan
    ? resolvePlanPreviewTarget({
      actionResolution,
      executionPlan,
    })
    : null;
  const unsupportedAffordanceReferences = runtimeValidatedPlan
    ? collectUnsupportedAffordanceReferences(normalizedBrainOutput.outputText, {
      selectedTarget: runtimePreviewTarget,
      executionPlan,
    })
    : [];
  const selectedTargetMentionMissing = Boolean(
    runtimePreviewTarget?.targetId
      && !outputMentionsRuntimeSelectedTarget(
        normalizedBrainOutput.outputText,
        runtimePreviewTarget.targetId,
      ),
  );

  if (
    runtimeValidatedPlan
    && !claimsPreviewExecution
    && !claimsUnsupportedDeliverables
    && !claimsUnverifiedRuntimeEvidence
    && !machineReadablePlanEnvelope
    && unsupportedAffordanceReferences.length === 0
    && !selectedTargetMentionMissing
  ) {
    return {
      brainOutput: normalizedBrainOutput,
      providerResponse,
      downgraded: false,
      reason: null,
    };
  }

  if (coordinationStatus !== 'no_execution') {
    return {
      brainOutput: normalizedBrainOutput,
      providerResponse,
      downgraded: false,
      reason: null,
    };
  }

  const validatedPlanPreviewNeedsGovernanceRewrite = runtimeValidatedPlan && (
    claimsPreviewExecution
    || claimsUnsupportedDeliverables
    || claimsUnverifiedRuntimeEvidence
    || machineReadablePlanEnvelope
    || unsupportedAffordanceReferences.length > 0
    || selectedTargetMentionMissing
  );

  if (
    !validatedPlanPreviewNeedsGovernanceRewrite
    && (
      !requestLooksLikePlanPreview(request)
      || (
        !outputLooksLikeStructuredPlan(normalizedBrainOutput.outputText)
        && !machineReadablePlanEnvelope
      )
    )
  ) {
    return {
      brainOutput: normalizedBrainOutput,
      providerResponse,
      downgraded: false,
      reason: null,
    };
  }

  const locale = resolveActionRuntimeLocale({ request });
  const governedPlanPreviewMessage = runtimeValidatedPlan
    ? buildGovernedPlanPreviewMessage({
      locale,
      actionResolution,
      executionPlan,
    })
    : null;
  const clarificationQuestion = resolvePlanPreviewClarificationQuestion({
    locale,
    actionResolution,
    executionPlan,
  });
  const governedOutputText = governedPlanPreviewMessage
    ?? buildDraftPlanDowngradeMessage({
      locale,
      clarificationQuestion,
    });
  const governedBrainOutput = assertBrainOutput({
    ...normalizedBrainOutput,
    outputText: governedOutputText,
  });
  const governedProviderResponse = isPlainObject(providerResponse)
    && isNonEmptyString(providerResponse.outputText)
    ? {
      ...providerResponse,
      outputText: governedOutputText,
    }
    : providerResponse;

  return {
    brainOutput: governedBrainOutput,
    providerResponse: governedProviderResponse,
    downgraded: true,
    reason: runtimeValidatedPlan
      ? (
        machineReadablePlanEnvelope
          ? 'plan_preview_raw_envelope'
          : claimsUnsupportedDeliverables
            ? 'plan_preview_unsupported_deliverables'
            : claimsUnverifiedRuntimeEvidence
              ? 'plan_preview_unverified_runtime_evidence'
              : unsupportedAffordanceReferences.length > 0
                ? 'plan_preview_unsupported_affordance_references'
              : selectedTargetMentionMissing
                ? 'plan_preview_target_mismatch'
                : 'plan_preview_claimed_execution'
      )
      : 'ungoverned_plan_preview',
  };
}
