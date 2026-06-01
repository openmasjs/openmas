import test from 'node:test';
import assert from 'node:assert/strict';
import { assertBrainOutput } from '../../src/contracts/brain/brain-output-contract.js';
import { normalizeProviderResponseToBrainOutput } from '../../src/brain/normalize-provider-response-to-brain-output.js';
import { buildActionClaimReportEnvelope } from '../../src/actions/action-claim-report-envelope.js';

test('assertBrainOutput accepts a completed normalized brain output', () => {
  const brainOutput = assertBrainOutput({
    executionType: 'probabilistic_brain',
    status: 'completed',
    providerId: 'openrouter-api',
    modelId: 'openrouter/free',
    requestType: 'generate_text',
    outputText: 'Hello from Alfred.',
    finishReason: 'stop',
    providerResponseId: 'provider-response-1',
    usage: {
      inputTokens: 12,
      outputTokens: 4,
      totalTokens: 16,
    },
    warnings: [],
  });

  assert.equal(brainOutput.kind, 'brain_output');
  assert.equal(brainOutput.version, 1);
  assert.equal(brainOutput.status, 'completed');
  assert.equal(brainOutput.providerResponseStatus, 'completed');
  assert.equal(brainOutput.usage.totalTokens, 16);
});

test('assertBrainOutput derives total tokens when provider usage omits totalTokens', () => {
  const brainOutput = assertBrainOutput({
    executionType: 'probabilistic_brain',
    status: 'completed',
    providerId: 'gemini-api',
    modelId: 'gemini-flash-latest',
    requestType: 'generate_text',
    outputText: 'Hello from Gemini.',
    usage: {
      inputTokens: 20,
      outputTokens: 5,
    },
    warnings: [],
  });

  assert.equal(brainOutput.usage.inputTokens, 20);
  assert.equal(brainOutput.usage.outputTokens, 5);
  assert.equal(brainOutput.usage.totalTokens, 25);
});

test('assertBrainOutput creates an explicit empty usage object when provider usage is missing', () => {
  const brainOutput = assertBrainOutput({
    executionType: 'probabilistic_brain',
    status: 'completed',
    providerId: 'openrouter-api',
    modelId: 'openrouter/free',
    requestType: 'generate_text',
    outputText: 'Hello without usage.',
    warnings: [],
  });

  assert.deepEqual(brainOutput.usage, {
    inputTokens: null,
    outputTokens: null,
    totalTokens: null,
  });
});

test('assertBrainOutput accepts a failed normalized brain output', () => {
  const brainOutput = assertBrainOutput({
    executionType: 'probabilistic_brain',
    status: 'failed',
    providerId: 'openrouter-api',
    modelId: 'openrouter/free',
    requestType: 'generate_text',
    outputText: null,
    errorCode: 'http_500',
    errorMessage: 'Provider unavailable.',
    warnings: ['Provider returned an error.'],
  });

  assert.equal(brainOutput.status, 'failed');
  assert.equal(brainOutput.outputText, null);
  assert.equal(brainOutput.errorCode, 'http_500');
  assert.equal(brainOutput.usage.totalTokens, null);
});

test('assertBrainOutput rejects completed output without text', () => {
  assert.throws(
    () => assertBrainOutput({
      executionType: 'probabilistic_brain',
      status: 'completed',
      providerId: 'openrouter-api',
      modelId: 'openrouter/free',
      requestType: 'generate_text',
      outputText: '',
      warnings: [],
    }),
    /outputText/,
  );
});

test('normalizeProviderResponseToBrainOutput converts provider response into stable brain output', () => {
  const brainOutput = normalizeProviderResponseToBrainOutput({
    providerResponse: {
      kind: 'provider_response',
      providerId: 'openrouter-api',
      modelId: 'openrouter/free',
      requestType: 'generate_text',
      status: 'completed',
      outputText: 'I am Alfred.',
      finishReason: 'stop',
      providerResponseId: 'provider-response-2',
      usage: {
        inputTokens: 100,
        outputTokens: 12,
        totalTokens: 112,
      },
      warnings: [],
      errorCode: null,
      errorMessage: null,
    },
  });

  assert.equal(brainOutput.kind, 'brain_output');
  assert.equal(brainOutput.providerId, 'openrouter-api');
  assert.equal(brainOutput.modelId, 'openrouter/free');
  assert.equal(brainOutput.outputText, 'I am Alfred.');
  assert.equal(brainOutput.usage.totalTokens, 112);
});

test('normalizeProviderResponseToBrainOutput carries normalized provider failure taxonomy', () => {
  const brainOutput = normalizeProviderResponseToBrainOutput({
    providerResponse: {
      kind: 'provider_response',
      providerId: 'gemini-api',
      modelId: 'gemini-flash-latest',
      requestType: 'generate_text',
      status: 'failed',
      outputText: null,
      finishReason: null,
      providerResponseId: null,
      usage: null,
      warnings: [],
      errorCode: 'http_503',
      errorMessage: 'Provider temporarily unavailable.',
      providerFailure: {
        kind: 'provider_failure',
        version: 1,
        category: 'transient_unavailable',
        retryable: true,
        httpStatusCode: 503,
        providerErrorCode: '503',
        providerErrorStatus: 'UNAVAILABLE',
        providerErrorType: null,
        adapterErrorName: null,
        safeMessage: 'Provider temporarily unavailable.',
        diagnosticSummary: 'category=transient_unavailable http=503 providerStatus=UNAVAILABLE providerCode=503',
        originalErrorShape: {
          topLevelKeys: [],
          errorKeys: [],
          detailTypes: [],
        },
        metadata: {},
      },
    },
  });

  assert.equal(brainOutput.status, 'failed');
  assert.equal(brainOutput.providerFailure.category, 'transient_unavailable');
  assert.equal(brainOutput.providerFailure.retryable, true);
  assert.equal(brainOutput.providerFailure.httpStatusCode, 503);
});

test('normalizeProviderResponseToBrainOutput removes common HTML-ish terminal artifacts from completed text', () => {
  const brainOutput = normalizeProviderResponseToBrainOutput({
    providerResponse: {
      kind: 'provider_response',
      providerId: 'openrouter-api',
      modelId: 'openrouter/free',
      requestType: 'generate_text',
      status: 'completed',
      outputText: 'Line one<br>Line&nbsp;two &amp; three&lt;br&gt;Line four',
      finishReason: 'stop',
      providerResponseId: 'provider-response-html-1',
      usage: null,
      warnings: [],
      errorCode: null,
      errorMessage: null,
    },
  });

  assert.equal(brainOutput.outputText, 'Line one\nLine two & three\nLine four');
  assert.doesNotMatch(brainOutput.outputText, /<br>|&nbsp;|&lt;br&gt;/u);
});

test('normalizeProviderResponseToBrainOutput strips trailing provider control markers without rewriting legitimate inner text', () => {
  const brainOutput = normalizeProviderResponseToBrainOutput({
    providerResponse: {
      kind: 'provider_response',
      providerId: 'openrouter-api',
      modelId: 'openrouter/free',
      requestType: 'generate_text',
      status: 'completed',
      outputText: [
        'A literal <assistant> example inside explanatory text remains visible.',
        '</assistant>',
        '<|im_end|>',
      ].join('\n'),
      finishReason: 'stop',
      providerResponseId: 'provider-response-control-markers-1',
      usage: null,
      warnings: [],
      errorCode: null,
      errorMessage: null,
    },
  });

  assert.equal(
    brainOutput.outputText,
    'A literal <assistant> example inside explanatory text remains visible.',
  );
  assert.doesNotMatch(brainOutput.outputText, /<\/assistant>|<\|im_end\|>/u);
});

test('normalizeProviderResponseToBrainOutput strips hidden action claim report envelopes from visible output text', () => {
  const brainOutput = normalizeProviderResponseToBrainOutput({
    providerResponse: {
      kind: 'provider_response',
      providerId: 'openrouter-api',
      modelId: 'openrouter/free',
      requestType: 'generate_text',
      status: 'completed',
      outputText: [
        'I inspected the MAS through verified runtime evidence.',
        buildActionClaimReportEnvelope({
          kind: 'action_claim_report',
          version: 1,
          claims: [],
        }),
      ].join('\n'),
      finishReason: 'stop',
      providerResponseId: 'provider-response-claims-1',
      usage: null,
      warnings: [],
      errorCode: null,
      errorMessage: null,
    },
  });

  assert.equal(brainOutput.outputText, 'I inspected the MAS through verified runtime evidence.');
  assert.doesNotMatch(brainOutput.outputText, /openmas-action-claims/u);
});

test('normalizeProviderResponseToBrainOutput preserves compatibility warnings when a legacy action claim declaration is repaired', () => {
  const brainOutput = normalizeProviderResponseToBrainOutput({
    providerResponse: {
      kind: 'provider_response',
      providerId: 'openrouter-api',
      modelId: 'openrouter/free',
      requestType: 'generate_text',
      status: 'completed',
      outputText: [
        'I inspected the MAS through verified runtime evidence.',
        '<openmas-action-claims>{"kind":"action_claim_report","version":1,"claims":[{"claimId":"inspect-success","claimType":"execution","actionSurface":"mas.system.inspect","evidenceRequirement":"tool_status: succeeded","summary":"The inspection completed successfully."}]}</openmas-action-claims>',
      ].join('\n'),
      finishReason: 'stop',
      providerResponseId: 'provider-response-claims-legacy-1',
      usage: null,
      warnings: [],
      errorCode: null,
      errorMessage: null,
    },
  });

  assert.equal(brainOutput.outputText, 'I inspected the MAS through verified runtime evidence.');
  assert.match(brainOutput.warnings.join('\n'), /normalized for compatibility/u);
  assert.match(brainOutput.warnings.join('\n'), /legacy actionSurface "mas\.system\.inspect" was normalized/u);
});

test('normalizeProviderResponseToBrainOutput preserves envelope validation warnings when the hidden action claim report is invalid', () => {
  const brainOutput = normalizeProviderResponseToBrainOutput({
    providerResponse: {
      kind: 'provider_response',
      providerId: 'openrouter-api',
      modelId: 'openrouter/free',
      requestType: 'generate_text',
      status: 'completed',
      outputText: 'Visible answer.\n<openmas-action-claims>{"kind":"action_claim_report","version":1,</openmas-action-claims>',
      finishReason: 'stop',
      providerResponseId: 'provider-response-claims-invalid-1',
      usage: null,
      warnings: [],
      errorCode: null,
      errorMessage: null,
    },
  });

  assert.equal(brainOutput.outputText, 'Visible answer.');
  assert.match(brainOutput.warnings[0], /invalid and was ignored/u);
});
