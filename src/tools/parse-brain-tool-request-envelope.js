import { assertBrainToolRequestEnvelope } from '../contracts/brain/brain-tool-request-contract.js';

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
  const tagPattern = /<openmas-tool-request>\s*([\s\S]*?)\s*<\/openmas-tool-request>/iu;
  const match = outputText.match(tagPattern);

  return match ? match[1].trim() : null;
}

function extractFencedJsonEnvelope(outputText) {
  const fencePattern = /```(?:json)?\s*([\s\S]*?)\s*```/giu;
  let match;

  while ((match = fencePattern.exec(outputText)) !== null) {
    const candidate = match[1].trim();

    if (candidate.includes('brain_tool_request')) {
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
  if (!outputText.includes('brain_tool_request')) {
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

    if (!candidate.includes('brain_tool_request')) {
      continue;
    }

    const parsedCandidate = tryParseJsonObject(candidate);

    if (
      parsedCandidate.status === 'parsed'
      && parsedCandidate.value.kind === 'brain_tool_request'
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
      reason: 'Brain output contained multiple brain_tool_request envelopes.',
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
    kind: 'brain_tool_request_parse_result',
    version: 1,
    status: 'no_request',
    toolRequest: null,
    reason: 'Brain output did not contain a brain_tool_request envelope.',
    warnings: [],
  };
}

function buildInvalidResult(reason) {
  return {
    kind: 'brain_tool_request_parse_result',
    version: 1,
    status: 'invalid',
    toolRequest: null,
    reason,
    warnings: [],
  };
}

function buildParsedResult(toolRequest, warnings = []) {
  return {
    kind: 'brain_tool_request_parse_result',
    version: 1,
    status: 'parsed',
    toolRequest,
    reason: `Parsed brain tool request for ${toolRequest.toolId}.`,
    warnings,
  };
}

function normalizeKnownToolAlias(value) {
  if (!isNonEmptyString(value)) {
    return null;
  }

  const normalizedValue = value.trim();

  if (normalizedValue === 'mas.os.delegate' || normalizedValue === 'mas-os-delegate') {
    return 'mas.os.delegate';
  }

  if (
    normalizedValue === 'mas.os.schedule_delegation'
    || normalizedValue === 'mas-os-schedule-delegation'
    || normalizedValue === 'mas.os.schedule-delegation'
  ) {
    return 'mas.os.schedule_delegation';
  }

  return null;
}

function buildMasOsDelegatePurpose(envelope) {
  const input = envelope.input && typeof envelope.input === 'object' && !Array.isArray(envelope.input)
    ? envelope.input
    : {};
  const targetOperationalIdentityId = isNonEmptyString(input.targetOperationalIdentityId)
    ? input.targetOperationalIdentityId.trim()
    : 'the target Operational Identity';
  const task = isNonEmptyString(input.task)
    ? input.task.trim()
    : 'the requested delegated task';

  return `Delegate ${task} to ${targetOperationalIdentityId} through the OpenMAS OS delegation affordance.`;
}

function buildMasOsScheduleDelegationPurpose(envelope) {
  const input = envelope.input && typeof envelope.input === 'object' && !Array.isArray(envelope.input)
    ? envelope.input
    : {};
  const targetOperationalIdentityId = isNonEmptyString(input.targetOperationalIdentityId)
    ? input.targetOperationalIdentityId.trim()
    : 'the target Operational Identity';
  const task = isNonEmptyString(input.task)
    ? input.task.trim()
    : 'the requested delegated task';
  const runAt = isNonEmptyString(input.runAt)
    ? input.runAt.trim()
    : 'the requested scheduled time';

  return `Schedule delegation of ${task} to ${targetOperationalIdentityId} at ${runAt} through the OpenMAS OS scheduled delegation affordance.`;
}

function repairKnownToolRequestEnvelope(envelope) {
  const repairedEnvelope = { ...envelope };
  const warnings = [];

  if (!isNonEmptyString(repairedEnvelope.toolId)) {
    const workflowToolAlias = normalizeKnownToolAlias(repairedEnvelope.workflowId);

    if (workflowToolAlias) {
      repairedEnvelope.toolId = workflowToolAlias;
      warnings.push(`Repaired brain_tool_request workflowId "${repairedEnvelope.workflowId}" into toolId "${workflowToolAlias}".`);
    }
  }

  if (!isNonEmptyString(repairedEnvelope.toolRequestId) && isNonEmptyString(repairedEnvelope.workflowRequestId)) {
    repairedEnvelope.toolRequestId = repairedEnvelope.workflowRequestId.trim();
    warnings.push(`Repaired brain_tool_request workflowRequestId "${repairedEnvelope.workflowRequestId}" into toolRequestId.`);
  }

  if (repairedEnvelope.toolId === 'mas.os.delegate') {
    if (!isNonEmptyString(repairedEnvelope.purpose)) {
      repairedEnvelope.purpose = buildMasOsDelegatePurpose(repairedEnvelope);
      warnings.push('Repaired mas.os.delegate brain_tool_request with a bounded audit purpose.');
    }

    if (!isNonEmptyString(repairedEnvelope.expectedSideEffectLevel)) {
      repairedEnvelope.expectedSideEffectLevel = 'write_internal';
      warnings.push('Repaired mas.os.delegate brain_tool_request with expectedSideEffectLevel "write_internal".');
    }
  }

  if (repairedEnvelope.toolId === 'mas.os.schedule_delegation') {
    if (!isNonEmptyString(repairedEnvelope.purpose)) {
      repairedEnvelope.purpose = buildMasOsScheduleDelegationPurpose(repairedEnvelope);
      warnings.push('Repaired mas.os.schedule_delegation brain_tool_request with a bounded audit purpose.');
    }

    if (!isNonEmptyString(repairedEnvelope.expectedSideEffectLevel)) {
      repairedEnvelope.expectedSideEffectLevel = 'write_internal';
      warnings.push('Repaired mas.os.schedule_delegation brain_tool_request with expectedSideEffectLevel "write_internal".');
    }
  }

  return {
    envelope: repairedEnvelope,
    warnings,
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

export function parseBrainToolRequestEnvelopeFromText({
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
    if (outputText.includes('brain_tool_request')) {
      return buildInvalidResult('Brain output mentioned brain_tool_request but did not provide a parseable envelope.');
    }

    return buildNoRequestResult();
  }

  const parsedCandidate = tryParseJsonObject(candidateExtraction.candidate);

  if (parsedCandidate.status !== 'parsed') {
    return buildInvalidResult(`Brain tool request envelope is not valid JSON: ${parsedCandidate.error}`);
  }

  if (parsedCandidate.value.kind !== 'brain_tool_request') {
    return buildNoRequestResult();
  }

  const repairedCandidate = repairKnownToolRequestEnvelope(parsedCandidate.value);

  try {
    return buildParsedResult(
      assertBrainToolRequestEnvelope(repairedCandidate.envelope),
      repairedCandidate.warnings,
    );
  } catch (error) {
    return buildInvalidResult(error.message);
  }
}
