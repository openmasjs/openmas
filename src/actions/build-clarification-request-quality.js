import { assertActionClarificationRequest } from '../contracts/actions/action-intent-contract.js';
import {
  buildLocalizedClarificationQuestion,
  getLocalizedActionTargetLabel,
  resolveActionRuntimeLocale,
} from '../localization/action-runtime-localization.js';

const INTERNAL_IMPLEMENTATION_NOISE_PATTERN = /\b(confidence|classifier|runtime|readiness|policy|candidateid|metadata)\b/iu;
const ENGLISH_CLARIFICATION_PATTERN = /\b(i could not classify|please restate the action|please clarify|do you want me to use|are you referring to)\b/iu;
const NORMALIZED_CLARIFICATION_REASON_CATEGORIES = new Map([
  ['ambiguous_intent', 'ambiguous_intent'],
  ['ambiguity', 'ambiguous_intent'],
  ['ambiguous', 'ambiguous_intent'],
  ['missing_context', 'missing_context'],
  ['missing_information', 'missing_context'],
  ['low_confidence', 'low_confidence'],
  ['low-confidence', 'low_confidence'],
  ['multiple_candidates', 'multiple_candidates'],
  ['multiple_candidate', 'multiple_candidates'],
  ['multiple_choice', 'multiple_candidates'],
  ['multiple_options', 'multiple_candidates'],
  ['side_effect_unclear', 'side_effect_unclear'],
  ['permission_unclear', 'permission_unclear'],
  ['unsupported_request', 'unsupported_request'],
  ['unsupported', 'unsupported_request'],
]);
const SAFE_CONTEXT_REFERENCE_TYPES = new Set([
  'tool',
  'workflow',
  'command',
]);

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

export function normalizeClarificationReasonCategoryValue(value) {
  if (!isNonEmptyString(value)) {
    return 'unsupported_request';
  }

  const normalizedKey = value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/gu, '_');

  return NORMALIZED_CLARIFICATION_REASON_CATEGORIES.get(normalizedKey) ?? 'unsupported_request';
}

function getCandidateDisplayName(candidate) {
  if (isNonEmptyString(candidate?.metadata?.displayName)) {
    return candidate.metadata.displayName.trim();
  }

  if (isNonEmptyString(candidate?.targetId)) {
    return candidate.targetId.trim();
  }

  return 'the requested action';
}

function buildCandidateOptionHint(candidate, {
  locale = 'en',
} = {}) {
  return {
    kind: 'action_clarification_option_hint',
    version: 1,
    candidateId: candidate.candidateId,
    targetType: candidate.targetType,
    targetId: candidate.targetId,
    label: `${getLocalizedActionTargetLabel(candidate.targetType, { locale })} "${getCandidateDisplayName(candidate)}"`,
    description: isNonEmptyString(candidate.reason)
      ? candidate.reason.trim()
      : `Use ${getLocalizedActionTargetLabel(candidate.targetType, { locale })} ${getCandidateDisplayName(candidate)}.`,
  };
}

export function extractSafeConversationReferencesFromRequest(request) {
  const recentTurns = request?.metadata?.conversationContext?.recentTurns;

  if (!Array.isArray(recentTurns) || recentTurns.length === 0) {
    return [];
  }

  const references = [];
  const seenReferences = new Set();

  for (const turn of recentTurns) {
    const runtimeReferences = Array.isArray(turn?.runtimeReferences)
      ? turn.runtimeReferences
      : [];

    for (const runtimeReference of runtimeReferences) {
      if (!SAFE_CONTEXT_REFERENCE_TYPES.has(runtimeReference?.referenceType)) {
        continue;
      }

      if (!isNonEmptyString(runtimeReference?.referenceId)) {
        continue;
      }

      const referenceKey = `${runtimeReference.referenceType}:${runtimeReference.referenceId.trim()}`;

      if (seenReferences.has(referenceKey)) {
        continue;
      }

      seenReferences.add(referenceKey);
      references.push({
        kind: 'action_clarification_context_reference',
        version: 1,
        referenceType: runtimeReference.referenceType.trim(),
        referenceId: runtimeReference.referenceId.trim(),
        source: 'conversation_context',
        summary: isNonEmptyString(turn?.text)
          ? `Recent conversation mentioned ${runtimeReference.referenceType} "${runtimeReference.referenceId.trim()}": ${turn.text.trim()}`
          : `Recent conversation mentioned ${runtimeReference.referenceType} "${runtimeReference.referenceId.trim()}".`,
      });
    }
  }

  return references;
}

function shouldReplaceQuestion({
  question,
  locale,
  reasonCategory,
  contextReferences,
}) {
  if (!isNonEmptyString(question)) {
    return true;
  }

  if (INTERNAL_IMPLEMENTATION_NOISE_PATTERN.test(question.trim())) {
    return true;
  }

  if (locale !== 'en' && ENGLISH_CLARIFICATION_PATTERN.test(question.trim())) {
    return true;
  }

  if (
    reasonCategory === 'unsupported_request'
    && contextReferences.length === 1
    && !question.includes(contextReferences[0].referenceId)
  ) {
    return true;
  }

  return false;
}

export function buildHighQualityClarificationRequest({
  clarificationId,
  reasonCategory,
  existingQuestion = null,
  candidates = [],
  missingContext = [],
  warnings = [],
  request = null,
  metadata = {},
}) {
  const normalizedCandidates = Array.isArray(candidates)
    ? candidates.filter((candidate) => isPlainObject(candidate))
    : [];
  const normalizedReasonCategory = normalizeClarificationReasonCategoryValue(reasonCategory);
  const locale = resolveActionRuntimeLocale({
    request,
    metadata,
  });
  const contextReferences = extractSafeConversationReferencesFromRequest(request);
  const optionHints = normalizedCandidates.map((candidate) => {
    return buildCandidateOptionHint(candidate, {
      locale,
    });
  });
  const question = shouldReplaceQuestion({
    question: existingQuestion,
    locale,
    reasonCategory: normalizedReasonCategory,
    contextReferences,
  })
    ? buildLocalizedClarificationQuestion({
      locale,
      reasonCategory: normalizedReasonCategory,
      optionHints,
      contextReferences,
    })
    : existingQuestion.trim();

  return assertActionClarificationRequest({
    kind: 'action_clarification_request',
    version: 1,
    clarificationId,
    reasonCategory: normalizedReasonCategory,
    question,
    candidateIds: normalizedCandidates.map((candidate) => candidate.candidateId),
    missingContext,
    blockingExecution: true,
    warnings,
    metadata: {
      ...(isPlainObject(metadata) ? metadata : {}),
      kind: 'action_clarification_metadata',
      version: 1,
      qualityModel: 'clarification_quality_v1',
      localizationMode: 'runtime_localized',
      locale,
      hideInternalReasoning: true,
      optionHints,
      contextReferences,
      suggestedResponseMode: optionHints.length >= 2
        ? 'single_choice'
        : (optionHints.length === 1 ? 'confirm_or_restate' : 'free_text'),
      missingContextHints: uniqueStrings(missingContext),
    },
  });
}
