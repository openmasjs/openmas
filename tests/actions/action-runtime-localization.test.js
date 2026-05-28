import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLocalizedClarificationQuestion,
  resolveActionRuntimeLocale,
} from '../../src/localization/action-runtime-localization.js';
import { buildHighQualityClarificationRequest } from '../../src/actions/build-clarification-request-quality.js';

function buildCandidate({
  candidateId,
  actionType,
  targetType,
  targetId,
  displayName,
}) {
  return {
    kind: 'action_candidate',
    version: 1,
    candidateId,
    actionType,
    targetType,
    targetId,
    source: 'semantic_classifier',
    confidence: 'medium',
    confidenceScore: 0.64,
    sideEffectLevel: 'read_only',
    requiresApproval: false,
    reason: `Use ${displayName}.`,
    matchedSignals: [],
    missingContext: [],
    warnings: [],
    metadata: {
      displayName,
    },
  };
}

test('resolveActionRuntimeLocale normalizes supported locale tags and falls back safely', () => {
  assert.equal(resolveActionRuntimeLocale({
    request: {
      metadata: {
        locale: 'es-CO',
      },
    },
  }), 'es');
  assert.equal(resolveActionRuntimeLocale({
    request: {
      metadata: {
        locale: 'pt-BR',
      },
    },
  }), 'pt');
  assert.equal(resolveActionRuntimeLocale({
    request: {
      metadata: {
        locale: 'it-IT',
      },
    },
  }), 'en');
});

test('resolveActionRuntimeLocale infers supported runtime locale from user text when metadata is absent', () => {
  assert.equal(resolveActionRuntimeLocale({
    request: {
      originalInput: 'Hola Alfred, podrias explicarme la herramienta de inspeccion?',
    },
  }), 'es');
  assert.equal(resolveActionRuntimeLocale({
    request: {
      inputText: 'Ola Alfred, voce poderia explicar o fluxo de inspecao?',
    },
  }), 'pt');
  assert.equal(resolveActionRuntimeLocale({
    request: {
      inputText: 'Hello Alfred, can you explain the inspection tool?',
    },
  }), 'en');
});

test('buildLocalizedClarificationQuestion uses locale-aware wording separate from runtime decision logic', () => {
  assert.equal(
    buildLocalizedClarificationQuestion({
      locale: 'es',
      reasonCategory: 'multiple_candidates',
      optionHints: [
        {
          label: 'herramienta "MAS System Inspect"',
        },
        {
          label: 'flujo "MAS Health Review"',
        },
      ],
      contextReferences: [],
    }),
    'Quieres que use herramienta "MAS System Inspect", o flujo "MAS Health Review"?',
  );
  assert.equal(
    buildLocalizedClarificationQuestion({
      locale: 'pt',
      reasonCategory: 'unsupported_request',
      optionHints: [],
      contextReferences: [
        {
          referenceType: 'tool',
          referenceId: 'mas.system.inspect',
        },
      ],
    }),
    'Voce esta se referindo novamente a tool "mas.system.inspect", ou quer uma acao diferente?',
  );
});

test('buildHighQualityClarificationRequest records runtime localization metadata independently from reasoning metadata', () => {
  const clarificationRequest = buildHighQualityClarificationRequest({
    clarificationId: 'clarification-locale-001',
    reasonCategory: 'multiple_candidates',
    candidates: [
      buildCandidate({
        candidateId: 'candidate-tool-001',
        actionType: 'tool_execution',
        targetType: 'tool',
        targetId: 'mas.system.inspect',
        displayName: 'MAS System Inspect',
      }),
      buildCandidate({
        candidateId: 'candidate-workflow-001',
        actionType: 'workflow_execution',
        targetType: 'workflow',
        targetId: 'mas-health-review',
        displayName: 'MAS Health Review',
      }),
    ],
    request: {
      metadata: {
        locale: 'es-CO',
      },
    },
  });

  assert.equal(clarificationRequest.metadata.localizationMode, 'runtime_localized');
  assert.equal(clarificationRequest.metadata.locale, 'es');
  assert.match(clarificationRequest.question, /^Quieres que use /u);
});

test('buildHighQualityClarificationRequest rewrites an English clarification question when the request locale is Spanish', () => {
  const clarificationRequest = buildHighQualityClarificationRequest({
    clarificationId: 'clarification-locale-002',
    reasonCategory: 'unsupported_request',
    existingQuestion: 'I could not classify the requested action safely. Please restate the action or use an explicit tool/workflow request.',
    request: {
      inputText: 'Bruce, podrias ayudarme con un plan de evaluacion del MAS?',
      metadata: {
        locale: 'es-CO',
      },
    },
  });

  assert.equal(clarificationRequest.metadata.locale, 'es');
  assert.doesNotMatch(clarificationRequest.question, /\bI could not classify\b/u);
  assert.match(clarificationRequest.question, /Por favor reformula|Quieres que use|Te refieres nuevamente/u);
});

test('buildHighQualityClarificationRequest normalizes safe clarification reason aliases before localization', () => {
  const clarificationRequest = buildHighQualityClarificationRequest({
    clarificationId: 'clarification-locale-003',
    reasonCategory: 'ambiguity',
    existingQuestion: 'Please clarify what evaluation path you want.',
    request: {
      inputText: 'Bruce, podrias ayudarme con un plan de evaluacion del MAS?',
      metadata: {
        locale: 'es-CO',
      },
    },
  });

  assert.equal(clarificationRequest.reasonCategory, 'ambiguous_intent');
  assert.equal(clarificationRequest.metadata.locale, 'es');
  assert.match(clarificationRequest.question, /Por favor reformula/u);
});
