import { assertBrainToolRequestEnvelope } from '../brain/brain-tool-request-contract.js';
import { TOOL_SIDE_EFFECT_LEVELS } from '../tools/tool-definition-contract.js';
import { assertToolReadinessVerdict } from '../tools/tool-readiness-contract.js';

const HUMAN_APPROVAL_REQUEST_TYPES = new Set([
  'tool_execution',
]);

const HUMAN_APPROVAL_URGENCY_LEVELS = new Set([
  'low',
  'normal',
  'high',
  'urgent',
]);

const SAFE_APPROVAL_ID_PATTERN = /^[a-zA-Z0-9._-]+$/u;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function assertEnumValue(value, allowedValues, description) {
  if (!isNonEmptyString(value)) {
    throw new Error(`${description} must be a non-empty string.`);
  }

  const normalizedValue = value.trim();

  if (!allowedValues.has(normalizedValue)) {
    throw new Error(`${description} is invalid: ${normalizedValue}`);
  }

  return normalizedValue;
}

function assertSafeApprovalId(value, description) {
  if (!isNonEmptyString(value)) {
    throw new Error(`${description} must be a non-empty string.`);
  }

  const normalizedValue = value.trim();

  if (!SAFE_APPROVAL_ID_PATTERN.test(normalizedValue)) {
    throw new Error(`${description} contains unsafe characters: ${normalizedValue}`);
  }

  return normalizedValue;
}

function assertStringArray(values, description) {
  if (!Array.isArray(values)) {
    throw new Error(`${description} must be an array.`);
  }

  return values.map((value, index) => {
    if (!isNonEmptyString(value)) {
      throw new Error(`${description}[${index}] must be a non-empty string.`);
    }

    return value.trim();
  });
}

function assertOptionalPlainObject(value, description) {
  if (value === undefined || value === null) {
    return {};
  }

  if (!isPlainObject(value)) {
    throw new Error(`${description} must be an object when provided.`);
  }

  return { ...value };
}

function assertNullableString(value, description) {
  if (value === undefined || value === null) {
    return null;
  }

  if (!isNonEmptyString(value)) {
    throw new Error(`${description} must be a non-empty string when provided.`);
  }

  return value.trim();
}

function assertApprovalSubject(subject) {
  if (!isPlainObject(subject)) {
    throw new Error('Human approval request subject must be an object.');
  }

  if (!isNonEmptyString(subject.toolId)) {
    throw new Error('Human approval request subject must include a non-empty toolId.');
  }

  return {
    toolId: subject.toolId.trim(),
    expectedSideEffectLevel: assertEnumValue(
      subject.expectedSideEffectLevel,
      TOOL_SIDE_EFFECT_LEVELS,
      'Human approval request subject expectedSideEffectLevel',
    ),
    purpose: isNonEmptyString(subject.purpose) ? subject.purpose.trim() : null,
    input: assertOptionalPlainObject(subject.input, 'Human approval request subject input'),
  };
}

function assertRiskAssessment(riskAssessment) {
  if (!isPlainObject(riskAssessment)) {
    throw new Error('Human approval request riskAssessment must be an object.');
  }

  if (!isNonEmptyString(riskAssessment.summary)) {
    throw new Error('Human approval request riskAssessment must include a non-empty summary.');
  }

  return {
    sideEffectLevel: assertEnumValue(
      riskAssessment.sideEffectLevel,
      TOOL_SIDE_EFFECT_LEVELS,
      'Human approval request riskAssessment sideEffectLevel',
    ),
    summary: riskAssessment.summary.trim(),
    approvalReason: isNonEmptyString(riskAssessment.approvalReason)
      ? riskAssessment.approvalReason.trim()
      : null,
    matchedResourceIds: assertStringArray(
      riskAssessment.matchedResourceIds ?? [],
      'Human approval request riskAssessment matchedResourceIds',
    ),
    warnings: assertStringArray(riskAssessment.warnings ?? [], 'Human approval request riskAssessment warnings'),
  };
}

export function assertHumanApprovalRequest(request) {
  if (!isPlainObject(request)) {
    throw new Error('Human approval request must be an object.');
  }

  if (request.kind !== 'human_approval_request') {
    throw new Error('Human approval request must include kind "human_approval_request".');
  }

  if (request.version !== 1) {
    throw new Error('Human approval request version must be 1.');
  }

  if (!isNonEmptyString(request.invocationId)) {
    throw new Error('Human approval request must include a non-empty invocationId.');
  }

  if (!isNonEmptyString(request.operationalIdentityId)) {
    throw new Error('Human approval request must include a non-empty operationalIdentityId.');
  }

  if (!isNonEmptyString(request.requestedBy)) {
    throw new Error('Human approval request must include a non-empty requestedBy.');
  }

  if (!isNonEmptyString(request.requestedAt)) {
    throw new Error('Human approval request must include a non-empty requestedAt.');
  }

  return {
    kind: 'human_approval_request',
    version: 1,
    approvalRequestId: assertSafeApprovalId(
      request.approvalRequestId,
      'Human approval request approvalRequestId',
    ),
    approvalType: assertEnumValue(
      request.approvalType,
      HUMAN_APPROVAL_REQUEST_TYPES,
      'Human approval request approvalType',
    ),
    invocationId: request.invocationId.trim(),
    operationalIdentityId: request.operationalIdentityId.trim(),
    requestedBy: request.requestedBy.trim(),
    requestedAt: request.requestedAt.trim(),
    expiresAt: assertNullableString(request.expiresAt, 'Human approval request expiresAt'),
    urgency: assertEnumValue(
      request.urgency ?? 'normal',
      HUMAN_APPROVAL_URGENCY_LEVELS,
      'Human approval request urgency',
    ),
    source: {
      sourceType: 'brain_tool_request',
      sourceId: assertBrainToolRequestEnvelope(request.toolRequest).toolRequestId,
    },
    subject: assertApprovalSubject(request.subject),
    toolRequest: assertBrainToolRequestEnvelope(request.toolRequest),
    toolReadinessVerdict: assertToolReadinessVerdict(request.toolReadinessVerdict),
    riskAssessment: assertRiskAssessment(request.riskAssessment),
    warnings: assertStringArray(request.warnings ?? [], 'Human approval request warnings'),
  };
}

export {
  HUMAN_APPROVAL_REQUEST_TYPES,
  HUMAN_APPROVAL_URGENCY_LEVELS,
};
