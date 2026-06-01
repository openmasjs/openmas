import { assertBrainWorkflowRequestEnvelope } from '../contracts/brain/brain-workflow-request-contract.js';

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function tryParseJsonObject(text) {
  try {
    const parsed = JSON.parse(text);

    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return {
        status: 'parsed',
        value: parsed,
        error: null,
      };
    }

    return {
      status: 'invalid',
      value: null,
      error: 'Parsed JSON is not an object.',
    };
  } catch (error) {
    return {
      status: 'invalid',
      value: null,
      error: error.message,
    };
  }
}

function extractTaggedEnvelope(outputText) {
  const tagPattern = /<openmas-workflow-request>\s*([\s\S]*?)\s*<\/openmas-workflow-request>/iu;
  const match = outputText.match(tagPattern);

  return match ? match[1].trim() : null;
}

function extractFencedJsonEnvelope(outputText) {
  const fencePattern = /```(?:json)?\s*([\s\S]*?)\s*```/giu;
  let match;

  while ((match = fencePattern.exec(outputText)) !== null) {
    const candidate = match[1].trim();

    if (candidate.includes('brain_workflow_request')) {
      return candidate;
    }
  }

  return null;
}

function extractStrictJsonEnvelope(outputText) {
  const trimmedOutput = outputText.trim();

  if (trimmedOutput.startsWith('{') && trimmedOutput.endsWith('}')) {
    return trimmedOutput;
  }

  return null;
}

function findJsonObjectEnd(text, startIndex) {
  let depth = 0;
  let insideString = false;
  let escaped = false;

  for (let index = startIndex; index < text.length; index += 1) {
    const character = text[index];

    if (insideString) {
      if (escaped) {
        escaped = false;
        continue;
      }

      if (character === '\\') {
        escaped = true;
        continue;
      }

      if (character === '"') {
        insideString = false;
      }

      continue;
    }

    if (character === '"') {
      insideString = true;
      continue;
    }

    if (character === '{') {
      depth += 1;
      continue;
    }

    if (character === '}') {
      depth -= 1;

      if (depth === 0) {
        return index;
      }

      if (depth < 0) {
        return null;
      }
    }
  }

  return null;
}

function extractEmbeddedJsonEnvelope(outputText) {
  if (!outputText.includes('brain_workflow_request')) {
    return {
      status: 'not_found',
      candidate: null,
      reason: null,
    };
  }

  const candidates = [];

  for (let index = 0; index < outputText.length; index += 1) {
    if (outputText[index] !== '{') {
      continue;
    }

    const endIndex = findJsonObjectEnd(outputText, index);

    if (endIndex === null) {
      continue;
    }

    const candidate = outputText.slice(index, endIndex + 1).trim();

    if (!candidate.includes('brain_workflow_request')) {
      continue;
    }

    const parsedCandidate = tryParseJsonObject(candidate);

    if (
      parsedCandidate.status === 'parsed'
      && parsedCandidate.value.kind === 'brain_workflow_request'
    ) {
      candidates.push(candidate);
    }

    index = endIndex;
  }

  if (candidates.length === 1) {
    return {
      status: 'found',
      candidate: candidates[0],
      reason: null,
    };
  }

  if (candidates.length > 1) {
    return {
      status: 'ambiguous',
      candidate: null,
      reason: 'Brain output contained multiple brain_workflow_request envelopes.',
    };
  }

  return {
    status: 'not_found',
    candidate: null,
    reason: null,
  };
}

function buildNoRequestResult() {
  return {
    kind: 'brain_workflow_request_parse_result',
    version: 1,
    status: 'no_request',
    workflowRequest: null,
    reason: 'Brain output did not contain a brain_workflow_request envelope.',
    warnings: [],
  };
}

function buildInvalidResult(reason) {
  return {
    kind: 'brain_workflow_request_parse_result',
    version: 1,
    status: 'invalid',
    workflowRequest: null,
    reason,
    warnings: [],
  };
}

function buildParsedResult(workflowRequest) {
  return {
    kind: 'brain_workflow_request_parse_result',
    version: 1,
    status: 'parsed',
    workflowRequest,
    reason: `Parsed brain workflow request for ${workflowRequest.workflowId}.`,
    warnings: [],
  };
}

function extractCandidate(outputText) {
  const directCandidate = (
    extractTaggedEnvelope(outputText)
    ?? extractFencedJsonEnvelope(outputText)
    ?? extractStrictJsonEnvelope(outputText)
  );

  if (directCandidate !== null) {
    return {
      status: 'found',
      candidate: directCandidate,
      reason: null,
    };
  }

  return extractEmbeddedJsonEnvelope(outputText);
}

export function parseBrainWorkflowRequestEnvelopeFromText({
  outputText,
} = {}) {
  if (!isNonEmptyString(outputText)) {
    return buildNoRequestResult();
  }

  const candidateExtraction = extractCandidate(outputText);

  if (candidateExtraction.status === 'ambiguous') {
    return buildInvalidResult(candidateExtraction.reason);
  }

  if (candidateExtraction.status !== 'found') {
    if (outputText.includes('brain_workflow_request')) {
      return buildInvalidResult('Brain output mentioned brain_workflow_request but did not provide a parseable envelope.');
    }

    return buildNoRequestResult();
  }

  const parsedCandidate = tryParseJsonObject(candidateExtraction.candidate);

  if (parsedCandidate.status !== 'parsed') {
    return buildInvalidResult(`Brain workflow request envelope is not valid JSON: ${parsedCandidate.error}`);
  }

  if (parsedCandidate.value.kind !== 'brain_workflow_request') {
    return buildNoRequestResult();
  }

  try {
    return buildParsedResult(assertBrainWorkflowRequestEnvelope(parsedCandidate.value));
  } catch (error) {
    return buildInvalidResult(error.message);
  }
}
