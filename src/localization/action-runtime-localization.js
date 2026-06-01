const SUPPORTED_ACTION_RUNTIME_LOCALES = new Set([
  'en',
  'es',
  'pt',
]);

const SPANISH_LOCALE_SIGNAL_PATTERNS = [
  /[¿¡]/u,
  /\bhola\b/iu,
  /\bgracias\b/iu,
  /\bpor\s+favor\b/iu,
  /\bporfa\b/iu,
  /\bayudame\b/iu,
  /\bbuen(?:os|as)\s+(?:dias|días|tardes|noches)\b/iu,
  /\bpodr(?:ia|ias|ía|ías)\b/iu,
  /\binspecci(?:on|ón)\b/iu,
  /\bevaluaci(?:on|Ã³n)\b/iu,
  /\bdiagnostico\b/iu,
  /\brevisi(?:on|Ã³n)\b/iu,
  /\bherramienta\b/iu,
  /\bflujo\b/iu,
  /\bexplic(?:a|ame|arme|ar)\b/iu,
];

const PORTUGUESE_LOCALE_SIGNAL_PATTERNS = [
  /\bol[áa]\b/iu,
  /\bvoce\b/iu,
  /\bvoc[eê]\b/iu,
  /\bobrigad[oa]\b/iu,
  /\bpor\s+favor\b/iu,
  /\bpoderia\b/iu,
  /\binspe(?:cao|ção)\b/iu,
  /\bferramenta\b/iu,
  /\bfluxo\b/iu,
  /\ba[cç][aã]o\b/iu,
  /\ba[cç][oõ]es\b/iu,
];

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function toSupportedLocale(value) {
  if (!isNonEmptyString(value)) {
    return 'en';
  }

  const primaryTag = value
    .trim()
    .toLowerCase()
    .split(/[-_]/u)[0];

  return SUPPORTED_ACTION_RUNTIME_LOCALES.has(primaryTag)
    ? primaryTag
    : 'en';
}

function collectRequestLocaleTexts(request) {
  return [
    request?.originalInput,
    request?.inputText,
    request?.metadata?.originalInput,
    request?.metadata?.inputText,
    request?.metadata?.userInput,
  ].filter(isNonEmptyString);
}

function scoreLocaleSignals(text, signalPatterns) {
  if (!isNonEmptyString(text)) {
    return 0;
  }

  return signalPatterns.reduce((score, pattern) => {
    return score + (pattern.test(text) ? 1 : 0);
  }, 0);
}

function inferActionRuntimeLocaleFromRequest(request) {
  const localeTexts = collectRequestLocaleTexts(request);

  if (localeTexts.length === 0) {
    return 'en';
  }

  let spanishScore = 0;
  let portugueseScore = 0;

  for (const localeText of localeTexts) {
    spanishScore += scoreLocaleSignals(localeText, SPANISH_LOCALE_SIGNAL_PATTERNS);
    portugueseScore += scoreLocaleSignals(localeText, PORTUGUESE_LOCALE_SIGNAL_PATTERNS);
  }

  if (spanishScore === 0 && portugueseScore === 0) {
    return 'en';
  }

  if (spanishScore === portugueseScore) {
    return 'en';
  }

  return spanishScore > portugueseScore ? 'es' : 'pt';
}

export function resolveActionRuntimeLocale({
  request = null,
  locale = null,
  metadata = null,
} = {}) {
  const explicitLocale = locale
    ?? request?.locale
    ?? request?.metadata?.locale
    ?? request?.metadata?.userLocale
    ?? metadata?.locale
    ?? metadata?.userLocale;

  if (isNonEmptyString(explicitLocale)) {
    return toSupportedLocale(explicitLocale);
  }

  return inferActionRuntimeLocaleFromRequest(request);
}

export function getLocalizedActionTargetLabel(targetType, {
  locale = 'en',
} = {}) {
  const normalizedLocale = toSupportedLocale(locale);

  if (normalizedLocale === 'es') {
    if (targetType === 'tool') {
      return 'herramienta';
    }

    if (targetType === 'workflow') {
      return 'flujo';
    }

    if (targetType === 'command') {
      return 'comando';
    }

    return 'accion';
  }

  if (normalizedLocale === 'pt') {
    if (targetType === 'tool') {
      return 'ferramenta';
    }

    if (targetType === 'workflow') {
      return 'fluxo';
    }

    if (targetType === 'command') {
      return 'comando';
    }

    return 'acao';
  }

  if (targetType === 'tool') {
    return 'tool';
  }

  if (targetType === 'workflow') {
    return 'workflow';
  }

  if (targetType === 'command') {
    return 'command';
  }

  return 'action';
}

export function buildLocalizedClarificationQuestion({
  locale = 'en',
  reasonCategory,
  optionHints = [],
  contextReferences = [],
} = {}) {
  const normalizedLocale = toSupportedLocale(locale);

  if (normalizedLocale === 'es') {
    if (reasonCategory === 'multiple_candidates' && optionHints.length >= 2) {
      const [firstOption, secondOption] = optionHints;
      return `Quieres que use ${firstOption.label}, o ${secondOption.label}?`;
    }

    if (
      ['low_confidence', 'permission_unclear'].includes(reasonCategory)
      && optionHints.length === 1
    ) {
      return `Encontre una accion probable: ${optionHints[0].label}. Quieres que use esa, o quisiste decir otra cosa?`;
    }

    if (reasonCategory === 'unsupported_request' && contextReferences.length === 1) {
      const [reference] = contextReferences;
      return `Te refieres de nuevo a ${reference.referenceType} "${reference.referenceId}", o quieres una accion diferente?`;
    }

    return 'Por favor reformula la accion que quieres, o nombra la herramienta o el flujo directamente.';
  }

  if (normalizedLocale === 'pt') {
    if (reasonCategory === 'multiple_candidates' && optionHints.length >= 2) {
      const [firstOption, secondOption] = optionHints;
      return `Voce quer que eu use ${firstOption.label}, ou ${secondOption.label}?`;
    }

    if (
      ['low_confidence', 'permission_unclear'].includes(reasonCategory)
      && optionHints.length === 1
    ) {
      return `Encontrei uma acao provavel: ${optionHints[0].label}. Voce quer que eu use essa, ou quis dizer outra coisa?`;
    }

    if (reasonCategory === 'unsupported_request' && contextReferences.length === 1) {
      const [reference] = contextReferences;
      return `Voce esta se referindo novamente a ${reference.referenceType} "${reference.referenceId}", ou quer uma acao diferente?`;
    }

    return 'Por favor, reformule a acao desejada ou informe diretamente a ferramenta ou o fluxo.';
  }

  if (reasonCategory === 'multiple_candidates' && optionHints.length >= 2) {
    const [firstOption, secondOption] = optionHints;
    return `Do you want me to use ${firstOption.label}, or ${secondOption.label}?`;
  }

  if (
    ['low_confidence', 'permission_unclear'].includes(reasonCategory)
    && optionHints.length === 1
  ) {
    return `I found one likely action: ${optionHints[0].label}. Do you want me to use it, or did you mean something else?`;
  }

  if (reasonCategory === 'unsupported_request' && contextReferences.length === 1) {
    const [reference] = contextReferences;
    return `Are you referring to ${reference.referenceType} "${reference.referenceId}" again, or do you want a different action?`;
  }

  return 'Please restate the action you want, or name the tool or workflow directly.';
}

export function buildLocalizedActionResultAssessmentCopy({
  locale = 'en',
  scenario,
  clarificationQuestion = null,
} = {}) {
  const normalizedLocale = toSupportedLocale(locale);

  if (normalizedLocale === 'es') {
    switch (scenario) {
      case 'brain_output_failed':
        return {
          finalAnswerGuidance: [
            'No presentes la invocacion como completada.',
            'Muestra la falla del proveedor o del runtime y conserva las referencias a la evidencia persistida.',
          ],
          recommendedNextActions: [
            'Inspecciona la disponibilidad del proveedor, las referencias a secretos y los diagnosticos persistidos antes de reintentar.',
          ],
        };
      case 'clarification_required':
        return {
          finalAnswerGuidance: [
            'Haz la pregunta de clarificacion antes de ejecutar cualquier accion de runtime.',
            'No impliques que una accion ya ocurrio.',
          ],
          recommendedNextActions: [
            clarificationQuestion ?? 'Pide al usuario la aclaracion que hace falta.',
          ],
        };
      case 'approval_pause':
        return {
          finalAnswerGuidance: [
            'Explica que la ejecucion esta esperando aprobacion humana.',
            'No afirmes que la accion con efectos ya fue completada.',
          ],
          recommendedNextActions: [
            'Revisa el registro de aprobacion pendiente y decide aprobar, negar o expirar.',
          ],
        };
      case 'denied_or_invalid':
        return {
          finalAnswerGuidance: [
            'Explica que no se ejecuto ninguna accion de runtime.',
            'Usa evidencia de readiness, permisos y forma de la solicitud en lugar de lenguaje de exito.',
          ],
          recommendedNextActions: [
            'Revisa la evidencia de accion negada o invalida antes de reintentar.',
          ],
        };
      case 'execution_failed':
        return {
          finalAnswerGuidance: [
            'Reporta la ejecucion fallida con precision.',
            'No conviertas evidencia de runtime fallida en una afirmacion de exito.',
          ],
          recommendedNextActions: [
            'Inspecciona la evidencia de auditoria del tool o workflow fallido y reintenta solo despues de corregir la causa raiz.',
          ],
        };
      case 'workflow_waiting_external':
        return {
          finalAnswerGuidance: [
            'Explica que evidencia del workflow existe y que sigue pendiente.',
            'No presentes el workflow como totalmente completado.',
          ],
          recommendedNextActions: [
            'Inspecciona el estado del workflow y reanudalo cuando el evento externo requerido este disponible.',
          ],
        };
      case 'partial_success_unsupported_claims':
        return {
          finalAnswerGuidance: [
            'Aterriza la respuesta final solo en evidencia verificada de observacion de runtime.',
            'Elimina o corrige afirmaciones que excedan la evidencia disponible.',
          ],
          recommendedNextActions: [
            'Revisa las advertencias persistidas del action claim guard y compara la respuesta con las observaciones del runtime.',
          ],
        };
      case 'partial_success_verification_failed':
        return {
          finalAnswerGuidance: [
            'No presentes la respuesta final como plenamente verificada.',
            'Corrige o elimina detalles que no puedan sostenerse con la evidencia persistida del runtime.',
          ],
          recommendedNextActions: [
            'Revisa el verification gate, la observacion persistida y los artefactos de auditoria antes de confiar en el resumen final.',
          ],
        };
      case 'partial_success_verification_degraded':
        return {
          finalAnswerGuidance: [
            'Mantén la respuesta final dentro de la evidencia inline disponible y evita detalles exactos cuando falte vista previa acotada.',
            'Usa el artefacto persistido como referencia de auditoría antes de afirmar conteos o estados exactos.',
          ],
          recommendedNextActions: [
            'Revisa el artefacto persistido señalado por el verification gate antes de reutilizar el resumen como evidencia exacta.',
          ],
        };
      case 'success':
        return {
          finalAnswerGuidance: [
            'Usa la observacion de runtime como fuente autoritativa de evidencia.',
            'Manten las afirmaciones finales dentro de los limites del resultado observado del tool o workflow.',
          ],
          recommendedNextActions: [
            'Usa la sesion persistida, el reporte y la observacion de runtime como evidencia de auditoria.',
          ],
        };
      case 'no_execution_unsupported_claims':
        return {
          finalAnswerGuidance: [
            'No trates la respuesta final como evidencia de ejecucion.',
            'Reintenta con un camino valido de tool, workflow, canal, aprobacion o memoria si se requiere evidencia de accion.',
          ],
          recommendedNextActions: [
            'Revisa el action claim guard y vuelve a ejecutar la invocacion con una accion ejecutable explicita si hace falta.',
          ],
        };
      case 'not_applicable':
        return {
          finalAnswerGuidance: [
            'Las invocaciones de solo respuesta no deben implicar ejecucion de runtime.',
          ],
          recommendedNextActions: [
            'Haz una pregunta de seguimiento o solicita una accion explicita de tool/workflow cuando se necesite evidencia de runtime.',
          ],
        };
      default:
        return buildLocalizedActionResultAssessmentCopy({
          locale: 'en',
          scenario,
          clarificationQuestion,
        });
    }
  }

  if (normalizedLocale === 'pt') {
    switch (scenario) {
      case 'brain_output_failed':
        return {
          finalAnswerGuidance: [
            'Nao apresente a invocacao como concluida.',
            'Mostre a falha do provedor ou do runtime e preserve as referencias para a evidencia persistida.',
          ],
          recommendedNextActions: [
            'Inspecione a prontidao do provedor, as referencias de segredo e os diagnosticos persistidos antes de tentar novamente.',
          ],
        };
      case 'clarification_required':
        return {
          finalAnswerGuidance: [
            'Faca a pergunta de esclarecimento antes de executar qualquer acao de runtime.',
            'Nao implique que uma acao ja aconteceu.',
          ],
          recommendedNextActions: [
            clarificationQuestion ?? 'Peca ao usuario o esclarecimento que falta.',
          ],
        };
      case 'approval_pause':
        return {
          finalAnswerGuidance: [
            'Explique que a execucao esta aguardando aprovacao humana.',
            'Nao afirme que a acao com efeitos colaterais ja foi concluida.',
          ],
          recommendedNextActions: [
            'Revise o registro de aprovacao pendente e decida aprovar, negar ou expirar.',
          ],
        };
      case 'denied_or_invalid':
        return {
          finalAnswerGuidance: [
            'Explique que nenhuma acao de runtime foi executada.',
            'Use evidencia de prontidao, permissoes e formato da solicitacao em vez de linguagem de sucesso.',
          ],
          recommendedNextActions: [
            'Revise a evidencia da acao negada ou invalida antes de tentar novamente.',
          ],
        };
      case 'execution_failed':
        return {
          finalAnswerGuidance: [
            'Relate a execucao com falha de forma precisa.',
            'Nao transforme evidencia de runtime com falha em afirmacao de sucesso.',
          ],
          recommendedNextActions: [
            'Inspecione a evidencia de auditoria da ferramenta ou do fluxo com falha e tente novamente somente apos corrigir a causa raiz.',
          ],
        };
      case 'workflow_waiting_external':
        return {
          finalAnswerGuidance: [
            'Explique qual evidencia de workflow existe e o que ainda esta pendente.',
            'Nao apresente o workflow como totalmente concluido.',
          ],
          recommendedNextActions: [
            'Inspecione o estado do workflow e retome quando o evento externo necessario estiver disponivel.',
          ],
        };
      case 'partial_success_unsupported_claims':
        return {
          finalAnswerGuidance: [
            'Baseie a resposta final apenas em evidencia verificada de observacao de runtime.',
            'Remova ou corrija afirmacoes que excedam a evidencia disponivel.',
          ],
          recommendedNextActions: [
            'Revise os avisos persistidos do action claim guard e compare a resposta com as observacoes de runtime.',
          ],
        };
      case 'partial_success_verification_failed':
        return {
          finalAnswerGuidance: [
            'Nao apresente a resposta final como totalmente verificada.',
            'Corrija ou remova detalhes que nao possam ser sustentados pela evidencia persistida do runtime.',
          ],
          recommendedNextActions: [
            'Revise o verification gate, a observacao persistida e os artefatos de auditoria antes de confiar no resumo final.',
          ],
        };
      case 'partial_success_verification_degraded':
        return {
          finalAnswerGuidance: [
            'Mantenha a resposta final dentro da evidencia inline disponivel e evite detalhes exatos quando faltar uma visualizacao limitada.',
            'Use o artefato persistido como referencia de auditoria antes de afirmar contagens ou estados exatos.',
          ],
          recommendedNextActions: [
            'Revise o artefato persistido apontado pelo verification gate antes de reutilizar o resumo como evidencia exata.',
          ],
        };
      case 'success':
        return {
          finalAnswerGuidance: [
            'Use a observacao de runtime como fonte autoritativa de evidencia.',
            'Mantenha as afirmacoes finais dentro dos limites do resultado observado da ferramenta ou do workflow.',
          ],
          recommendedNextActions: [
            'Use a sessao persistida, o relatorio e a observacao de runtime como evidencia de auditoria.',
          ],
        };
      case 'no_execution_unsupported_claims':
        return {
          finalAnswerGuidance: [
            'Nao trate a resposta final como evidencia de execucao.',
            'Tente novamente com um caminho valido de ferramenta, workflow, canal, aprovacao ou memoria quando for necessaria evidencia de acao.',
          ],
          recommendedNextActions: [
            'Revise o action claim guard e execute novamente a invocacao com uma acao executavel explicita, se necessario.',
          ],
        };
      case 'not_applicable':
        return {
          finalAnswerGuidance: [
            'Invocacoes somente de resposta nao devem implicar execucao de runtime.',
          ],
          recommendedNextActions: [
            'Faca uma pergunta de acompanhamento ou solicite uma acao explicita de ferramenta/workflow quando for necessaria evidencia de runtime.',
          ],
        };
      default:
        return buildLocalizedActionResultAssessmentCopy({
          locale: 'en',
          scenario,
          clarificationQuestion,
        });
    }
  }

  switch (scenario) {
    case 'brain_output_failed':
      return {
        finalAnswerGuidance: [
          'Do not present the invocation as completed.',
          'Surface the provider or runtime failure and preserve the persisted evidence references.',
        ],
        recommendedNextActions: [
          'Inspect provider readiness, credential references, and persisted invocation diagnostics before retrying.',
        ],
      };
    case 'clarification_required':
      return {
        finalAnswerGuidance: [
          'Ask the clarification question before executing any runtime action.',
          'Do not imply that an action has already happened.',
        ],
        recommendedNextActions: [
          clarificationQuestion ?? 'Ask the user for the missing clarification.',
        ],
      };
    case 'approval_pause':
      return {
        finalAnswerGuidance: [
          'Explain that execution is waiting for human approval.',
          'Do not claim that the side-effecting action was completed.',
        ],
        recommendedNextActions: [
          'Review the pending approval record and decide approve, deny, or expire.',
        ],
      };
    case 'denied_or_invalid':
      return {
        finalAnswerGuidance: [
          'Explain that no runtime action was executed.',
          'Use readiness, permission, and request-shape evidence instead of success language.',
        ],
        recommendedNextActions: [
          'Review the denied or invalid action evidence before retrying.',
        ],
      };
    case 'execution_failed':
      return {
        finalAnswerGuidance: [
          'Report the failed execution accurately.',
          'Do not convert failed runtime evidence into a successful completion claim.',
        ],
        recommendedNextActions: [
          'Inspect the failed tool or workflow audit evidence and retry only after the root cause is fixed.',
        ],
      };
    case 'workflow_waiting_external':
      return {
        finalAnswerGuidance: [
          'Explain which workflow evidence exists and what remains pending.',
          'Do not present the workflow as fully completed.',
        ],
        recommendedNextActions: [
          'Inspect the workflow state and resume when the required external event is available.',
        ],
      };
    case 'partial_success_unsupported_claims':
      return {
        finalAnswerGuidance: [
          'Ground the final answer only in verified runtime observation evidence.',
          'Remove or correct claims that exceed the available evidence.',
        ],
        recommendedNextActions: [
          'Review the persisted action claim guard warnings and compare the answer with runtime observations.',
        ],
      };
    case 'partial_success_verification_failed':
      return {
        finalAnswerGuidance: [
          'Do not present the final answer as fully verified.',
          'Correct or remove details that cannot be supported by persisted runtime evidence.',
        ],
        recommendedNextActions: [
          'Review the verification gate, persisted observation, and audit artifacts before relying on the final summary.',
        ],
      };
    case 'partial_success_verification_degraded':
      return {
        finalAnswerGuidance: [
          'Keep the final answer within the inline evidence that is actually available and avoid exact details when bounded preview evidence is missing.',
          'Use the persisted artifact as the audit reference before asserting exact counts or states.',
        ],
        recommendedNextActions: [
          'Review the persisted artifact referenced by the verification gate before reusing the summary as exact evidence.',
        ],
      };
    case 'success':
      return {
        finalAnswerGuidance: [
          'Use the runtime observation as the authoritative evidence source.',
          'Keep final claims within the observed tool or workflow result boundaries.',
        ],
        recommendedNextActions: [
          'Use the persisted session, report, and runtime observation as audit evidence.',
        ],
      };
    case 'no_execution_unsupported_claims':
      return {
        finalAnswerGuidance: [
          'Do not treat the final answer as evidence of execution.',
          'Retry with a valid tool, workflow, channel, approval, or memory runtime path when action evidence is required.',
        ],
        recommendedNextActions: [
          'Review the action claim guard and rerun the invocation with an explicit executable action if needed.',
        ],
      };
    case 'not_applicable':
      return {
        finalAnswerGuidance: [
          'Answer-only invocations must not imply runtime execution.',
        ],
        recommendedNextActions: [
          'Ask a follow-up or request an explicit tool/workflow action when runtime evidence is needed.',
        ],
      };
    default:
      throw new Error(`Unsupported localized action result assessment scenario: ${scenario}`);
  }
}

export function buildLocalizedInvocationNextStep({
  locale = 'en',
  scenario,
  params = {},
} = {}) {
  const normalizedLocale = toSupportedLocale(locale);
  const {
    requestedToolId,
    requestedWorkflowId,
    providerId,
    failureCategory,
    primaryProviderId,
    primaryFailureCategory,
    fallbackProviderId,
    fallbackFailureCategory,
    classifierProviderId,
    conversationGuidance,
    approvalIds = [],
    pendingToolApprovalId,
  } = params;
  const workflowApprovalLabel = approvalIds.length > 0
    ? ` (${approvalIds.join(', ')})`
    : '';

  if (normalizedLocale === 'es') {
    switch (scenario) {
      case 'blocked':
        return 'Resuelve el prerrequisito de proveedor, secreto, binding o readiness mostrado en el mensaje/advertencias, y luego vuelve a ejecutar la invocacion probabilistica.';
      case 'blocked_generic':
        return 'Resuelve el prerrequisito de invocacion mostrado en el mensaje/advertencias, y luego vuelve a ejecutar la invocacion.';
      case 'failed_tool':
        return `Inspecciona la ejecucion fallida de ${requestedToolId}; revisa su registro de auditoria, corrige el problema del tool/runtime y luego vuelve a ejecutar la invocacion.`;
      case 'failed_workflow':
        return `Inspecciona la ejecucion fallida del workflow ${requestedWorkflowId}; revisa el registro de estado del workflow, corrige el paso que falla y luego vuelve a ejecutar la invocacion.`;
      case 'fallback_failed':
        return `Inspecciona la traza de decision de fallback: el proveedor primario ${primaryProviderId} fallo${primaryFailureCategory ? ` (${primaryFailureCategory})` : ''} y el proveedor fallback ${fallbackProviderId} tambien fallo${fallbackFailureCategory ? ` (${fallbackFailureCategory})` : ''}. Revisa la salud de proveedores, las referencias a secretos y la evidencia persistida antes de reintentar.`;
      case 'skipped_fallback_not_ready':
        return `El proveedor primario ${primaryProviderId} fallo${primaryFailureCategory ? ` (${primaryFailureCategory})` : ''}, y el proveedor fallback ${fallbackProviderId} no estaba listo. Revisa la disponibilidad del fallback, las referencias a secretos y la salud del proveedor antes de reintentar.`;
      case 'skipped_fallback_not_configured':
        return `El proveedor primario ${primaryProviderId} fallo${primaryFailureCategory ? ` (${primaryFailureCategory})` : ''}, y no hay un proveedor fallback configurado para esta invocacion. Revisa la seleccion de cerebro, la preparacion del proveedor y la disponibilidad del runtime antes de reintentar.`;
      case 'skipped_policy_disallowed':
        return `El proveedor primario ${primaryProviderId} fallo${primaryFailureCategory ? ` (${primaryFailureCategory})` : ''}, y el fallback fue omitido por politica. Revisa la politica de fallback, la salud del proveedor y la evidencia persistida antes de reintentar.`;
      case 'provider_failure':
        return `Inspecciona la falla del proveedor ${providerId}${failureCategory ? ` (${failureCategory})` : ''}; verifica readiness del proveedor, referencias a secretos y evidencia persistida antes de reintentar.`;
      case 'clarification_classifier_output_failure':
        return `El enrutamiento semantico se degrado porque ${classifierProviderId} devolvio una salida del clasificador que no pudo normalizarse de forma segura. Reintenta con una solicitud explicita de tool/workflow o inspecciona la auditoria del clasificador antes de esperar ejecucion semantica.${conversationGuidance ? ` ${conversationGuidance}` : ''}`;
      case 'clarification_classifier_provider_failure':
        return `El enrutamiento semantico se degrado porque ${classifierProviderId} fallo${failureCategory ? ` (${failureCategory})` : ''}. Reintenta con una solicitud explicita de tool/workflow o restaura la salud del proveedor clasificador antes de esperar ejecucion semantica.${conversationGuidance ? ` ${conversationGuidance}` : ''}`;
      case 'clarification_required':
        return `Haz la aclaracion solicitada antes de intentar ejecucion de runtime.${conversationGuidance ? ` ${conversationGuidance}` : ''}`;
      case 'no_execution':
        return `No se verifico ninguna accion de runtime. Revisa el action result assessment y reintenta con una accion ejecutable explicita si se requiere evidencia de ejecucion.${conversationGuidance ? ` ${conversationGuidance}` : ''}`;
      case 'partial_success':
        return `Revisa el action result assessment antes de confiar en la respuesta; parte de la evidencia de runtime es parcial o la respuesta final excedio la evidencia verificada.${conversationGuidance ? ` ${conversationGuidance}` : ''}`;
      case 'pending_tool_approval':
        return `Revisa la aprobacion humana pendiente ${pendingToolApprovalId}; la ejecucion esta pausada hasta que un administrador apruebe, niegue o expire.${conversationGuidance ? ` ${conversationGuidance}` : ''}`;
      case 'tool_approval_required':
        return `Revisa el requisito de aprobacion para ${requestedToolId}; no habra ejecucion del tool hasta que un administrador humano lo apruebe.${conversationGuidance ? ` ${conversationGuidance}` : ''}`;
      case 'tool_not_executed':
        return `No se ejecuto ningun tool. Revisa evidencia de readiness, permisos y forma de solicitud para ${requestedToolId} antes de reintentar.${conversationGuidance ? ` ${conversationGuidance}` : ''}`;
      case 'tool_failed':
        return `Revisa la observacion fallida del tool para ${requestedToolId}; inspecciona el registro de auditoria y corrige el problema del tool/runtime antes de reintentar.${conversationGuidance ? ` ${conversationGuidance}` : ''}`;
      case 'tool_succeeded':
        return `Revisa la observacion del tool para ${requestedToolId}; usa la sesion persistida y el reporte como evidencia de auditoria.${conversationGuidance ? ` ${conversationGuidance}` : ''}`;
      case 'workflow_not_executed':
        return `No se ejecuto ningun workflow. Revisa evidencia de readiness, permisos y forma de solicitud para ${requestedWorkflowId} antes de reintentar.${conversationGuidance ? ` ${conversationGuidance}` : ''}`;
      case 'workflow_waiting_approval':
        return `Revisa la aprobacion pendiente del workflow${workflowApprovalLabel} para ${requestedWorkflowId}; la ejecucion esta pausada hasta que un administrador decida.${conversationGuidance ? ` ${conversationGuidance}` : ''}`;
      case 'workflow_waiting_external':
        return `El workflow ${requestedWorkflowId} esta esperando un evento externo; inspecciona el registro de estado del workflow antes de reanudar o reintentar.${conversationGuidance ? ` ${conversationGuidance}` : ''}`;
      case 'workflow_failed':
        return `Revisa la observacion fallida del workflow para ${requestedWorkflowId}; inspecciona el registro de estado del workflow y corrige el paso que falla antes de reintentar.${conversationGuidance ? ` ${conversationGuidance}` : ''}`;
      case 'workflow_succeeded':
        return `Revisa la observacion del workflow para ${requestedWorkflowId}; usa la sesion persistida y el estado del workflow como evidencia de auditoria.${conversationGuidance ? ` ${conversationGuidance}` : ''}`;
      case 'completed_fallback_conversation':
        return `La invocacion se completo a traves del proveedor fallback ${fallbackProviderId} despues de que el proveedor primario ${primaryProviderId} fallo. ${conversationGuidance}`;
      case 'completed_conversation':
        return `La invocacion se completo y el estado de la conversacion fue actualizado. ${conversationGuidance}`;
      case 'completed_fallback':
        return `La invocacion se completo a traves del proveedor fallback ${fallbackProviderId} despues de que el proveedor primario ${primaryProviderId} fallo. Revisa la salud de proveedores si el fallback no deberia haber sido necesario, o haz una pregunta de seguimiento cuando se necesite continuidad.`;
      case 'completed_probabilistic':
        return `La invocacion se completo a traves de ${providerId} sin requerir fallback. Haz una pregunta de seguimiento, ejecuta una herramienta diagnostica o inicia una conversacion cuando se necesite continuidad.`;
      case 'completed_deterministic':
        return 'La invocacion se completo. Revisa la sesion/reporte persistido para evidencia de auditoria, o ejecuta otro comando para este objetivo.';
      default:
        return buildLocalizedInvocationNextStep({
          locale: 'en',
          scenario,
          params,
        });
    }
  }

  if (normalizedLocale === 'pt') {
    switch (scenario) {
      case 'blocked':
        return 'Resolva o prerequisito de provedor, segredo, binding ou readiness mostrado na mensagem/avisos e execute novamente a invocacao probabilistica.';
      case 'blocked_generic':
        return 'Resolva o prerequisito de invocacao mostrado na mensagem/avisos e execute novamente a invocacao.';
      case 'failed_tool':
        return `Inspecione a execucao com falha de ${requestedToolId}; revise o registro de auditoria, corrija o problema da ferramenta/runtime e execute novamente a invocacao.`;
      case 'failed_workflow':
        return `Inspecione a execucao com falha do workflow ${requestedWorkflowId}; revise o registro de estado do workflow, corrija a etapa com falha e execute novamente a invocacao.`;
      case 'fallback_failed':
        return `Inspecione o rastreamento de decisao de fallback: o provedor primario ${primaryProviderId} falhou${primaryFailureCategory ? ` (${primaryFailureCategory})` : ''} e o provedor fallback ${fallbackProviderId} tambem falhou${fallbackFailureCategory ? ` (${fallbackFailureCategory})` : ''}. Revise a saude dos provedores, as referencias de segredo e a evidencia persistida antes de tentar novamente.`;
      case 'skipped_fallback_not_ready':
        return `O provedor primario ${primaryProviderId} falhou${primaryFailureCategory ? ` (${primaryFailureCategory})` : ''}, e o provedor fallback ${fallbackProviderId} nao estava pronto. Revise a prontidao do fallback, as referencias de segredo e a saude do provedor antes de tentar novamente.`;
      case 'skipped_fallback_not_configured':
        return `O provedor primario ${primaryProviderId} falhou${primaryFailureCategory ? ` (${primaryFailureCategory})` : ''}, e nenhum provedor fallback esta configurado para esta invocacao. Revise a selecao do brain, a preparacao do provedor e a prontidao do runtime antes de tentar novamente.`;
      case 'skipped_policy_disallowed':
        return `O provedor primario ${primaryProviderId} falhou${primaryFailureCategory ? ` (${primaryFailureCategory})` : ''}, e o fallback foi ignorado pela politica. Revise a politica de fallback, a saude do provedor e a evidencia persistida antes de tentar novamente.`;
      case 'provider_failure':
        return `Inspecione a falha do provedor ${providerId}${failureCategory ? ` (${failureCategory})` : ''}; verifique prontidao do provedor, referencias de segredo e evidencia persistida antes de tentar novamente.`;
      case 'clarification_classifier_output_failure':
        return `O roteamento semantico degradou porque ${classifierProviderId} retornou uma saida do classificador que nao pode ser normalizada com seguranca. Tente novamente com uma solicitacao explicita de ferramenta/workflow ou inspecione a auditoria do classificador antes de esperar execucao semantica.${conversationGuidance ? ` ${conversationGuidance}` : ''}`;
      case 'clarification_classifier_provider_failure':
        return `O roteamento semantico degradou porque ${classifierProviderId} falhou${failureCategory ? ` (${failureCategory})` : ''}. Tente novamente com uma solicitacao explicita de ferramenta/workflow ou restaure a saude do provedor classificador antes de esperar execucao semantica.${conversationGuidance ? ` ${conversationGuidance}` : ''}`;
      case 'clarification_required':
        return `Faca o esclarecimento solicitado antes de tentar a execucao de runtime.${conversationGuidance ? ` ${conversationGuidance}` : ''}`;
      case 'no_execution':
        return `Nenhuma acao de runtime foi verificada. Revise o action result assessment e tente novamente com uma acao executavel explicita se evidencia de execucao for necessaria.${conversationGuidance ? ` ${conversationGuidance}` : ''}`;
      case 'partial_success':
        return `Revise o action result assessment antes de confiar na resposta; parte da evidencia de runtime e parcial ou a resposta final excedeu a evidencia verificada.${conversationGuidance ? ` ${conversationGuidance}` : ''}`;
      case 'pending_tool_approval':
        return `Revise a aprovacao humana pendente ${pendingToolApprovalId}; a execucao esta pausada ate que um administrador aprove, negue ou expire.${conversationGuidance ? ` ${conversationGuidance}` : ''}`;
      case 'tool_approval_required':
        return `Revise o requisito de aprovacao para ${requestedToolId}; nenhuma execucao da ferramenta ocorrera ate que um administrador humano aprove.${conversationGuidance ? ` ${conversationGuidance}` : ''}`;
      case 'tool_not_executed':
        return `Nenhuma ferramenta foi executada. Revise a evidencia de prontidao, permissoes e formato da solicitacao para ${requestedToolId} antes de tentar novamente.${conversationGuidance ? ` ${conversationGuidance}` : ''}`;
      case 'tool_failed':
        return `Revise a observacao com falha da ferramenta para ${requestedToolId}; inspecione o registro de auditoria e corrija o problema da ferramenta/runtime antes de tentar novamente.${conversationGuidance ? ` ${conversationGuidance}` : ''}`;
      case 'tool_succeeded':
        return `Revise a observacao da ferramenta para ${requestedToolId}; use a sessao persistida e o relatorio como evidencia de auditoria.${conversationGuidance ? ` ${conversationGuidance}` : ''}`;
      case 'workflow_not_executed':
        return `Nenhum workflow foi executado. Revise a evidencia de prontidao, permissoes e formato da solicitacao para ${requestedWorkflowId} antes de tentar novamente.${conversationGuidance ? ` ${conversationGuidance}` : ''}`;
      case 'workflow_waiting_approval':
        return `Revise a aprovacao pendente do workflow${workflowApprovalLabel} para ${requestedWorkflowId}; a execucao esta pausada ate que um administrador decida.${conversationGuidance ? ` ${conversationGuidance}` : ''}`;
      case 'workflow_waiting_external':
        return `O workflow ${requestedWorkflowId} esta aguardando um evento externo; inspecione o registro de estado do workflow antes de retomar ou tentar novamente.${conversationGuidance ? ` ${conversationGuidance}` : ''}`;
      case 'workflow_failed':
        return `Revise a observacao com falha do workflow para ${requestedWorkflowId}; inspecione o registro de estado do workflow e corrija a etapa com falha antes de tentar novamente.${conversationGuidance ? ` ${conversationGuidance}` : ''}`;
      case 'workflow_succeeded':
        return `Revise a observacao do workflow para ${requestedWorkflowId}; use a sessao persistida e o estado do workflow como evidencia de auditoria.${conversationGuidance ? ` ${conversationGuidance}` : ''}`;
      case 'completed_fallback_conversation':
        return `A invocacao foi concluida pelo provedor fallback ${fallbackProviderId} depois que o provedor primario ${primaryProviderId} falhou. ${conversationGuidance}`;
      case 'completed_conversation':
        return `A invocacao foi concluida e o estado da conversa foi atualizado. ${conversationGuidance}`;
      case 'completed_fallback':
        return `A invocacao foi concluida pelo provedor fallback ${fallbackProviderId} depois que o provedor primario ${primaryProviderId} falhou. Revise a saude dos provedores se o fallback nao deveria ter sido necessario, ou faca uma pergunta de acompanhamento quando a continuidade for necessaria.`;
      case 'completed_probabilistic':
        return `A invocacao foi concluida por ${providerId} sem precisar de fallback. Faca uma pergunta de acompanhamento, execute uma ferramenta diagnostica ou inicie uma conversa quando a continuidade for necessaria.`;
      case 'completed_deterministic':
        return 'A invocacao foi concluida. Revise a sessao/relatorio persistido para evidencia de auditoria, ou execute outro comando para este alvo.';
      default:
        return buildLocalizedInvocationNextStep({
          locale: 'en',
          scenario,
          params,
        });
    }
  }

  switch (scenario) {
    case 'blocked':
      return 'Resolve the provider, secret, binding, or readiness prerequisite shown in the message/warnings, then rerun the probabilistic invocation.';
    case 'blocked_generic':
      return 'Resolve the invocation prerequisite shown in the message/warnings, then rerun the invocation.';
    case 'failed_tool':
      return `Inspect the failed tool execution for ${requestedToolId}; review its audit record, fix the tool/runtime issue, then rerun the invocation.`;
    case 'failed_workflow':
      return `Inspect the failed workflow run for ${requestedWorkflowId}; review the workflow state record, fix the failing step, then rerun the invocation.`;
    case 'fallback_failed':
      return `Inspect the fallback decision trace: primary provider ${primaryProviderId} failed${primaryFailureCategory ? ` (${primaryFailureCategory})` : ''} and fallback provider ${fallbackProviderId} also failed${fallbackFailureCategory ? ` (${fallbackFailureCategory})` : ''}. Review provider health, credential references, and persisted invocation evidence before retrying.`;
    case 'skipped_fallback_not_ready':
      return `Primary provider ${primaryProviderId} failed${primaryFailureCategory ? ` (${primaryFailureCategory})` : ''}, and fallback provider ${fallbackProviderId} was not ready. Review fallback readiness, credential references, and provider health before retrying.`;
    case 'skipped_fallback_not_configured':
      return `Primary provider ${primaryProviderId} failed${primaryFailureCategory ? ` (${primaryFailureCategory})` : ''}, and no fallback provider is configured for this invocation. Review brain selection, provider preparation, and runtime readiness before retrying.`;
    case 'skipped_policy_disallowed':
      return `Primary provider ${primaryProviderId} failed${primaryFailureCategory ? ` (${primaryFailureCategory})` : ''}, and fallback was skipped by retry policy. Review the fallback policy, provider health, and persisted invocation evidence before retrying.`;
    case 'provider_failure':
      if (failureCategory) {
        return `Inspect the provider failure for ${providerId} (${failureCategory}); verify provider readiness, credential references, and persisted invocation evidence before retrying.`;
      }

      return `Inspect the provider failure for ${providerId}; verify provider readiness, credential references, and persisted invocation evidence before retrying.`;
    case 'clarification_classifier_output_failure':
      return `Semantic routing degraded because ${classifierProviderId} returned classifier output that could not be normalized safely. Retry with an explicit tool/workflow request or inspect the classifier audit before expecting semantic execution.${conversationGuidance ? ` ${conversationGuidance}` : ''}`;
    case 'clarification_classifier_provider_failure':
      return `Semantic routing degraded because ${classifierProviderId} failed${failureCategory ? ` (${failureCategory})` : ''}. Retry with an explicit tool/workflow request or restore classifier provider health before expecting semantic execution.${conversationGuidance ? ` ${conversationGuidance}` : ''}`;
    case 'clarification_required':
      return `Ask the requested clarification before attempting runtime execution.${conversationGuidance ? ` ${conversationGuidance}` : ''}`;
    case 'no_execution':
      return `No runtime action was verified. Review the action result assessment and retry with an explicit executable action if execution evidence is required.${conversationGuidance ? ` ${conversationGuidance}` : ''}`;
    case 'partial_success':
      return `Review the action result assessment before relying on the answer; some runtime evidence is partial or the final answer exceeded verified evidence.${conversationGuidance ? ` ${conversationGuidance}` : ''}`;
    case 'pending_tool_approval':
      return `Review pending human approval ${pendingToolApprovalId}; execution is paused until an administrator approves, denies, or expires it.${conversationGuidance ? ` ${conversationGuidance}` : ''}`;
    case 'tool_approval_required':
      return `Review the approval requirement for ${requestedToolId}; no tool execution occurs until a human administrator approves it.${conversationGuidance ? ` ${conversationGuidance}` : ''}`;
    case 'tool_not_executed':
      return `No tool was executed. Review readiness, permission, and request-shape evidence for ${requestedToolId} before retrying.${conversationGuidance ? ` ${conversationGuidance}` : ''}`;
    case 'tool_failed':
      return `Review the failed tool observation for ${requestedToolId}; inspect the audit record and fix the tool/runtime issue before retrying.${conversationGuidance ? ` ${conversationGuidance}` : ''}`;
    case 'tool_succeeded':
      return `Review the tool observation for ${requestedToolId}; use the persisted session and report as audit evidence.${conversationGuidance ? ` ${conversationGuidance}` : ''}`;
    case 'workflow_not_executed':
      return `No workflow was executed. Review readiness, permission, and request-shape evidence for ${requestedWorkflowId} before retrying.${conversationGuidance ? ` ${conversationGuidance}` : ''}`;
    case 'workflow_waiting_approval':
      return `Review pending workflow approval${workflowApprovalLabel} for ${requestedWorkflowId}; execution is paused until an administrator decides.${conversationGuidance ? ` ${conversationGuidance}` : ''}`;
    case 'workflow_waiting_external':
      return `Workflow ${requestedWorkflowId} is waiting for an external event; inspect the workflow state record before resuming or retrying.${conversationGuidance ? ` ${conversationGuidance}` : ''}`;
    case 'workflow_failed':
      return `Review the failed workflow observation for ${requestedWorkflowId}; inspect the workflow state record and fix the failing step before retrying.${conversationGuidance ? ` ${conversationGuidance}` : ''}`;
    case 'workflow_succeeded':
      return `Review the workflow observation for ${requestedWorkflowId}; use the persisted session and workflow state as audit evidence.${conversationGuidance ? ` ${conversationGuidance}` : ''}`;
    case 'completed_fallback_conversation':
      return `Invocation completed through fallback provider ${fallbackProviderId} after primary provider ${primaryProviderId} failed. ${conversationGuidance}`;
    case 'completed_conversation':
      return `Invocation completed and the conversation state was updated. ${conversationGuidance}`;
    case 'completed_fallback':
      return `Invocation completed through fallback provider ${fallbackProviderId} after primary provider ${primaryProviderId} failed. Review provider health if fallback should not have been needed, or ask a follow-up when continuity is needed.`;
    case 'completed_probabilistic':
      return `Invocation completed through ${providerId} without requiring fallback. Ask a follow-up, run a diagnostic tool, or start a conversation when continuity is needed.`;
    case 'completed_deterministic':
      return 'Invocation completed. Review the persisted session/report for audit evidence, or run another command for this target.';
    default:
      throw new Error(`Unsupported localized invocation next-step scenario: ${scenario}`);
  }
}

export {
  SUPPORTED_ACTION_RUNTIME_LOCALES,
};
