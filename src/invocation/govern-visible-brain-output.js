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

const INTERNAL_VISIBLE_LEAK_PATTERNS = [
  /\bHidden Action Claim Report\b/iu,
  /\bContext Pack Summary\b/iu,
  /\bConversation Context\b/iu,
  /\bImportant Context\b/iu,
  /\bMAS Debugging Mode\b/iu,
  /\bHere is the relevant conversation context\b/iu,
  /\bPrevious \d+ messages\b/iu,
  /\bConversation ID:\b/iu,
  /\bLast Message:\b/iu,
  /\bLast User:\b/iu,
  /\bSidebar text:\b/iu,
];

const CONVERSATIONAL_GREETING_PATTERNS = [
  /\bhello\b/iu,
  /\bhi\b/iu,
  /\bhey\b/iu,
  /\bhola\b/iu,
  /\bgreetings\b/iu,
  /\bgood\s+(?:morning|afternoon|evening)\b/iu,
  /\bbuen(?:os|as)\s+(?:dias|d[ií]as|tardes|noches)\b/iu,
  /\bboa\s+(?:tarde|noite)\b/iu,
  /\bbom\s+dia\b/iu,
];

const NO_ACTION_GREETING_OVERCLAIM_PATTERNS = [
  /<System Steward Operational Response>/iu,
  /<next_step>/iu,
  /\bDespliegue del Cap[ií]tulo de Operaciones\b/iu,
  /\bDiagn[oó]stico de Contexto Actual\b/iu,
  /\bPatr[oó]n de Comportamiento Observado\b/iu,
  /\bRegistro de Audit Interno\b/iu,
  /\bContinuum de Respuesta Posible\b/iu,
  /\bOperational Identity\b/iu,
  /\bOperational Identity ID:\b/iu,
  /\bTone:\b/iu,
  /\bRespuesta:\b/iu,
  /\bExplicaci[oÃ³]n:\b/iu,
  /\bRevisi[oÃ³]n interna:\b/iu,
  /\bCierre:\b/iu,
  /\bcontext-check sequence\b/iu,
  /\ball log and artifact records were triggered and persisted\b/iu,
  /\brouted it to the next appropriate workflow path\b/iu,
  /\bRuntime Context:\b/iu,
  /\bAction Authorization:\b/iu,
  /\bEvidence Source:\b/iu,
  /\bOperational Identity Activated\b/iu,
  /\bruntime-resolved facts\b/iu,
  /\brandom\/race\/self\b/iu,
  /\bdisclosed outcomes\b/iu,
  /\bunsigned tokens\b/iu,
  /\bpila de eventos del sistema\b/iu,
  /\bevidencia de conversaci[oó]n\b/iu,
  /\bsesi[oó]n de conversaci[oó]n\b/iu,
  /\binteracci[oó]n previa\b/iu,
  /\bturn-[a-z0-9-]+\b/iu,
  /\b20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z\b/iu,
  /\bSystem Steward Output:\b/iu,
  /\bContextualized check:\b/iu,
  /\bpresence is confirmed\b/iu,
  /\boperational phase\b/iu,
  /\bgrid diagnostics\b/iu,
  /\bProtocol [A-Z0-9-]+\b/iu,
  /\bbounded authoritarian role\b/iu,
  /\bhe observado su saludo\b/iu,
  /\bPr[oó]ximo paso sugerido:\b/iu,
  /\bpara poder asistirle de manera operativa\b/iu,
  /\bPodr[ií]as especificar qu[eé] tipo de inspecci[oó]n necesitas\b/iu,
  /\bInspecci[oó]n t[eé]cnica\b/iu,
  /\bPrefieres comenzar con una inspecci[oó]n general\b/iu,
];

const DENIED_ACTION_EXECUTION_CLAIM_PATTERNS = [
  /\bprimero necesito inspeccionar\b/iu,
  /\bperm[iÃ­]teme obtener los datos actuales\b/iu,
  /\bperm[iÃ­]teme obtener datos actuales\b/iu,
  /\bnecesito inspeccionar el estado actual\b/iu,
  /\bvoy a (?:inspeccionar|ejecutar|obtener)\b/iu,
  /\bdebo (?:inspeccionar|ejecutar)\b/iu,
  /\blet me (?:inspect|get|gather|retrieve)\b/iu,
  /\bI need to inspect\b/iu,
  /\bI need to gather\b/iu,
  /\bI will (?:inspect|execute|gather)\b/iu,
  /\bI have received the delegation\b/iu,
  /\bawaiting execution\b/iu,
];

const RAW_REQUEST_ENVELOPE_PATTERNS = [
  /<tool_call>\s*[\s\S]*?<\/tool_call>/giu,
  /<workflow_call>\s*[\s\S]*?<\/workflow_call>/giu,
  /<tool_call>\s*[a-z0-9._-]+[\s\S]*$/iu,
  /<workflow_call>\s*[a-z0-9._-]+[\s\S]*$/iu,
  /<tool_call>\s*brain_(?:tool|workflow)_request[\s\S]*$/iu,
  /<openmas-(?:tool|workflow)-request>\s*[\s\S]*?<\/openmas-(?:tool|workflow)-request>/giu,
  /```(?:json)?\s*[\s\S]*?"kind"\s*:\s*"brain_(?:tool|workflow)_request"[\s\S]*?```/giu,
  /(?:^|\n)\s*\{[\s\S]*?"kind"\s*:\s*"brain_(?:tool|workflow)_request"[\s\S]*?"expectedSideEffectLevel"\s*:\s*"[^"]+"\s*\}\s*(?=\n|$)/giu,
  /^\s*\{[\s\S]*?"kind"\s*:\s*"brain_(?:tool|workflow)_request"[\s\S]*?\}\s*$/iu,
];

const RESPONSE_WRAPPER_PATTERNS = [
  /^\s*<response>\s*/iu,
  /\s*<\/response>\s*$/iu,
];

function outputContainsInternalLeak(outputText) {
  if (!isNonEmptyString(outputText)) {
    return false;
  }

  return INTERNAL_VISIBLE_LEAK_PATTERNS.some((pattern) => pattern.test(outputText));
}

function requestLooksLikeGreeting(request) {
  const inputText = [
    request?.originalInput,
    request?.inputText,
    request?.input,
  ].find(isNonEmptyString);

  if (!isNonEmptyString(inputText)) {
    return false;
  }

  return CONVERSATIONAL_GREETING_PATTERNS.some((pattern) => pattern.test(inputText));
}

function outputContainsNoActionGreetingNoise(outputText) {
  if (!isNonEmptyString(outputText)) {
    return false;
  }

  return NO_ACTION_GREETING_OVERCLAIM_PATTERNS.some((pattern) => pattern.test(outputText));
}

function outputContainsDeniedActionExecutionNoise(outputText) {
  if (!isNonEmptyString(outputText)) {
    return false;
  }

  return DENIED_ACTION_EXECUTION_CLAIM_PATTERNS.some((pattern) => pattern.test(outputText));
}

function outputContainsRawRequestEnvelope(outputText) {
  if (!isNonEmptyString(outputText)) {
    return false;
  }

  return RAW_REQUEST_ENVELOPE_PATTERNS.some((pattern) => pattern.test(outputText));
}

function stripVisibleRuntimeArtifacts(outputText) {
  if (!isNonEmptyString(outputText)) {
    return outputText;
  }

  let sanitizedOutputText = outputText;

  for (const pattern of RAW_REQUEST_ENVELOPE_PATTERNS) {
    sanitizedOutputText = sanitizedOutputText.replace(pattern, '');
  }

  for (const pattern of RESPONSE_WRAPPER_PATTERNS) {
    sanitizedOutputText = sanitizedOutputText.replace(pattern, '');
  }

  return sanitizedOutputText
    .replaceAll(/[ \t]+\n/gu, '\n')
    .replaceAll(/\n{3,}/gu, '\n\n')
    .trim();
}

function buildVisibleGreetingFallback({
  locale,
} = {}) {
  if (locale === 'es') {
    return 'Hola. Gracias por tu saludo. Estoy listo para ayudarte con el MAS. Si quieres, puedes pedirme una inspeccion, un plan o una revision concreta.';
  }

  if (locale === 'pt') {
    return 'Ola. Obrigado pela saudacao. Estou pronto para ajudar com o MAS. Se quiser, voce pode pedir uma inspecao, um plano ou uma revisao especifica.';
  }

  return 'Hello. Thanks for the greeting. I am ready to help with the MAS. If you want, you can ask for an inspection, a plan, or a specific review.';
}

function buildDeniedActionFallback({
  locale,
  actionResolution = null,
  executionPlan = null,
} = {}) {
  const clarificationSource = getClarificationSource({
    actionResolution,
    executionPlan,
  });
  const clarificationQuestion = isPlainObject(clarificationSource)
    ? buildLocalizedClarificationQuestion({
      locale,
      reasonCategory: clarificationSource.reasonCategory,
      optionHints: Array.isArray(clarificationSource.metadata?.optionHints)
        ? clarificationSource.metadata.optionHints
        : [],
      contextReferences: Array.isArray(clarificationSource.metadata?.contextReferences)
        ? clarificationSource.metadata.contextReferences
        : [],
    })
    : buildLocalizedClarificationQuestion({
      locale,
      reasonCategory: 'unsupported_request',
    });
  const status = isNonEmptyString(actionResolution?.status)
    ? actionResolution.status.trim()
    : null;

  if (status === 'needs_clarification') {
    if (locale === 'es') {
      return [
        'No se ejecuto ninguna accion porque la solicitud no pudo validarse con seguridad para el runtime.',
        `Si quieres continuar, ${clarificationQuestion.charAt(0).toLowerCase()}${clarificationQuestion.slice(1)}`,
      ].join('\n\n');
    }

    if (locale === 'pt') {
      return [
        'Nenhuma acao foi executada porque a solicitacao nao pode ser validada com seguranca pelo runtime.',
        `Se voce quiser continuar, ${clarificationQuestion.charAt(0).toLowerCase()}${clarificationQuestion.slice(1)}`,
      ].join('\n\n');
    }

    return [
      'No action was executed because the request could not be validated safely by the runtime.',
      `If you want to continue, ${clarificationQuestion.charAt(0).toLowerCase()}${clarificationQuestion.slice(1)}`,
    ].join('\n\n');
  }

  if (locale === 'es') {
    return [
      'No se ejecuto ninguna accion porque la solicitud quedo rechazada o invalida para el runtime.',
      `Si quieres continuar, ${clarificationQuestion.charAt(0).toLowerCase()}${clarificationQuestion.slice(1)}`,
    ].join('\n\n');
  }

  if (locale === 'pt') {
    return [
      'Nenhuma acao foi executada porque a solicitacao foi rejeitada ou considerada invalida pelo runtime.',
      `Se voce quiser continuar, ${clarificationQuestion.charAt(0).toLowerCase()}${clarificationQuestion.slice(1)}`,
    ].join('\n\n');
  }

  return [
    'No action was executed because the request was rejected or considered invalid by the runtime.',
    `If you want to continue, ${clarificationQuestion.charAt(0).toLowerCase()}${clarificationQuestion.slice(1)}`,
  ].join('\n\n');
}

function getClarificationSource({
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

function buildVisibleOutputFallback({
  locale,
  actionResolution = null,
  executionPlan = null,
} = {}) {
  const clarificationSource = getClarificationSource({
    actionResolution,
    executionPlan,
  });
  const clarificationQuestion = isPlainObject(clarificationSource)
    ? buildLocalizedClarificationQuestion({
      locale,
      reasonCategory: clarificationSource.reasonCategory,
      optionHints: Array.isArray(clarificationSource.metadata?.optionHints)
        ? clarificationSource.metadata.optionHints
        : [],
      contextReferences: Array.isArray(clarificationSource.metadata?.contextReferences)
        ? clarificationSource.metadata.contextReferences
        : [],
    })
    : null;
  const defaultQuestion = clarificationQuestion
    ?? buildLocalizedClarificationQuestion({
      locale,
      reasonCategory: 'unsupported_request',
    });

  if (locale === 'es') {
    if (actionResolution?.status === 'no_action') {
      return [
        'Oculte contenido interno del runtime porque no es apto para la salida visible del usuario.',
        'No se ejecuto ninguna accion de runtime para esta respuesta.',
        `Si quieres continuar, ${defaultQuestion.charAt(0).toLowerCase()}${defaultQuestion.slice(1)}`,
      ].join('\n\n');
    }

    return [
      'Oculte contenido interno del runtime porque no es apto para la salida visible del usuario.',
      `Aclaracion necesaria: ${defaultQuestion}`,
    ].join('\n\n');
  }

  if (locale === 'pt') {
    if (actionResolution?.status === 'no_action') {
      return [
        'Ocultei conteudo interno do runtime porque ele nao e apropriado para a saida visivel do usuario.',
        'Nenhuma acao de runtime foi executada para esta resposta.',
        `Se voce quiser continuar, ${defaultQuestion.charAt(0).toLowerCase()}${defaultQuestion.slice(1)}`,
      ].join('\n\n');
    }

    return [
      'Ocultei conteudo interno do runtime porque ele nao e apropriado para a saida visivel do usuario.',
      `Esclarecimento necessario: ${defaultQuestion}`,
    ].join('\n\n');
  }

  if (actionResolution?.status === 'no_action') {
    return [
      'I hid internal runtime content because it is not appropriate for visible user output.',
      'No runtime action was executed for this response.',
      `If you want to continue, ${defaultQuestion.charAt(0).toLowerCase()}${defaultQuestion.slice(1)}`,
    ].join('\n\n');
  }

  return [
    'I hid internal runtime content because it is not appropriate for visible user output.',
    `Clarification needed: ${defaultQuestion}`,
  ].join('\n\n');
}

export function governVisibleBrainOutput({
  request,
  brainOutput,
  actionResolution = null,
  executionPlan = null,
} = {}) {
  const normalizedBrainOutput = assertBrainOutput(brainOutput);

  if (normalizedBrainOutput.status !== 'completed' || !isNonEmptyString(normalizedBrainOutput.outputText)) {
    return {
      brainOutput: normalizedBrainOutput,
      governed: false,
      reason: null,
    };
  }

  const locale = resolveActionRuntimeLocale({ request });
  const outputContainsRawEnvelope = outputContainsRawRequestEnvelope(normalizedBrainOutput.outputText);
  const outputContainsUnsafeInternalContent = outputContainsInternalLeak(normalizedBrainOutput.outputText);
  const blockedActionFallback = ['denied', 'needs_clarification'].includes(actionResolution?.status)
    && (
      outputContainsRawEnvelope
      || outputContainsUnsafeInternalContent
      || outputContainsDeniedActionExecutionNoise(normalizedBrainOutput.outputText)
    );
  const greetingNoActionFallback = actionResolution?.status === 'no_action'
    && requestLooksLikeGreeting(request)
    && (
      outputContainsUnsafeInternalContent
      || outputContainsNoActionGreetingNoise(normalizedBrainOutput.outputText)
    );
  const strippedOutputText = blockedActionFallback
    ? buildDeniedActionFallback({
      locale,
      actionResolution,
      executionPlan,
    })
    : greetingNoActionFallback
    ? buildVisibleGreetingFallback({ locale })
    : outputContainsUnsafeInternalContent
      ? buildVisibleOutputFallback({
        locale,
        actionResolution,
        executionPlan,
      })
      : stripVisibleRuntimeArtifacts(normalizedBrainOutput.outputText);
  const governedOutputText = isNonEmptyString(strippedOutputText)
    ? strippedOutputText
    : buildVisibleOutputFallback({
      locale,
      actionResolution,
      executionPlan,
    });

  if (governedOutputText === normalizedBrainOutput.outputText) {
    return {
      brainOutput: normalizedBrainOutput,
      governed: false,
      reason: null,
    };
  }

    return {
      brainOutput: assertBrainOutput({
        ...normalizedBrainOutput,
        outputText: governedOutputText,
      }),
      governed: true,
      reason: blockedActionFallback
        ? 'blocked_action_execution_claim'
        : greetingNoActionFallback
        ? 'no_action_greeting_overclaim'
        : outputContainsUnsafeInternalContent
      ? 'internal_runtime_context_leak'
      : 'raw_request_envelope_leak',
    };
  }
