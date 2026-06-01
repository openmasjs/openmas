import { assertBrainOutput } from '../contracts/brain/brain-output-contract.js';
import { assertProviderResponse } from '../contracts/providers/provider-response-contract.js';
import { extractActionClaimReportFromOutputText } from '../actions/action-claim-report-envelope.js';

export function sanitizeBrainOutputTextForRuntimeDisplay(outputText) {
  if (typeof outputText !== 'string') {
    return outputText;
  }

  const extractedClaimReport = extractActionClaimReportFromOutputText(outputText);

  return extractedClaimReport.visibleOutputText
    .replaceAll(/&lt;br\s*\/?&gt;/giu, '\n')
    .replaceAll(/<br\s*\/?>/giu, '\n')
    .replaceAll(/&nbsp;/giu, ' ')
    .replaceAll(/\u00a0/gu, ' ')
    .replaceAll(/&amp;/giu, '&')
    .replaceAll(/&quot;/giu, '"')
    .replaceAll(/&#39;/giu, "'")
    .replaceAll(/(?:\s*(?:<\/?assistant\s*>|<\|(?:assistant|end|im_end|eot_id)\|>))+\s*$/giu, '')
    .replaceAll(/[ \t]+\n/gu, '\n')
    .replaceAll(/\n{3,}/gu, '\n\n')
    .trim();
}

export function normalizeProviderResponseToBrainOutput({ providerResponse }) {
  const normalizedProviderResponse = assertProviderResponse(providerResponse);
  const extractedClaimReport = extractActionClaimReportFromOutputText(
    normalizedProviderResponse.outputText,
  );

  return assertBrainOutput({
    executionType: 'probabilistic_brain',
    status: normalizedProviderResponse.status,
    providerId: normalizedProviderResponse.providerId,
    modelId: normalizedProviderResponse.modelId,
    requestType: normalizedProviderResponse.requestType,
    outputText: sanitizeBrainOutputTextForRuntimeDisplay(normalizedProviderResponse.outputText),
    finishReason: normalizedProviderResponse.finishReason,
    providerResponseId: normalizedProviderResponse.providerResponseId,
    usage: normalizedProviderResponse.usage,
    warnings: [
      ...normalizedProviderResponse.warnings,
      ...extractedClaimReport.warnings,
    ],
    errorCode: normalizedProviderResponse.errorCode,
    errorMessage: normalizedProviderResponse.errorMessage,
    providerFailure: normalizedProviderResponse.providerFailure,
  });
}
