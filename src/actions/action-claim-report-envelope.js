import {
  ACTION_CLAIM_EVIDENCE_REQUIREMENTS,
  ACTION_CLAIM_SURFACES,
  ACTION_CLAIM_TYPES,
  assertActionClaimReport,
} from '../contracts/actions/action-claim-report-contract.js';

const ACTION_CLAIM_REPORT_ENVELOPE_TAG = 'openmas-action-claims';
const ACTION_CLAIM_REPORT_ENVELOPE_PATTERN = new RegExp(
  `<${ACTION_CLAIM_REPORT_ENVELOPE_TAG}>\\s*([\\s\\S]*?)\\s*<\\/${ACTION_CLAIM_REPORT_ENVELOPE_TAG}>`,
  'giu',
);

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeFreeTextToken(value) {
  if (!isNonEmptyString(value)) {
    return null;
  }

  return value
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, '_')
    .replaceAll(/^_+|_+$/gu, '');
}

function inferEvidenceRequirement(rawEvidenceRequirement) {
  if (ACTION_CLAIM_EVIDENCE_REQUIREMENTS.has(rawEvidenceRequirement)) {
    return rawEvidenceRequirement;
  }

  const normalizedToken = normalizeFreeTextToken(rawEvidenceRequirement);

  if (!normalizedToken) {
    return null;
  }

  if ([
    'tool_status_succeeded',
    'workflow_status_succeeded',
    'runtime_observation_succeeded',
    'successful_runtime_observation',
  ].includes(normalizedToken)) {
    return 'successful_runtime_observation';
  }

  if ([
    'tool_execution',
    'workflow_execution',
    'tool_or_workflow_execution',
    'runtime_execution',
  ].includes(normalizedToken)) {
    return 'tool_or_workflow_execution';
  }

  if ([
    'selected_runtime_action',
    'selected_action',
    'approval_or_selected_runtime_action',
  ].includes(normalizedToken)) {
    return 'selected_runtime_action';
  }

  if ([
    'channel_delivery',
    'external_delivery',
    'delivery_confirmed',
  ].includes(normalizedToken)) {
    return 'channel_delivery';
  }

  if ([
    'state_mutation',
    'mutation',
    'write_applied',
  ].includes(normalizedToken)) {
    return 'state_mutation';
  }

  return null;
}

function inferClaimType(rawClaimType, inferredEvidenceRequirement) {
  if (ACTION_CLAIM_TYPES.has(rawClaimType)) {
    return rawClaimType;
  }

  if (inferredEvidenceRequirement === 'successful_runtime_observation') {
    return 'completed_action';
  }

  if (inferredEvidenceRequirement === 'tool_or_workflow_execution') {
    return 'tool_or_workflow_execution';
  }

  if (inferredEvidenceRequirement === 'selected_runtime_action') {
    return 'future_action';
  }

  if (inferredEvidenceRequirement === 'channel_delivery') {
    return 'external_delivery';
  }

  if (inferredEvidenceRequirement === 'state_mutation') {
    return 'state_mutation';
  }

  const normalizedToken = normalizeFreeTextToken(rawClaimType);

  if (!normalizedToken) {
    return null;
  }

  if ([
    'execution',
    'tool_execution',
    'workflow_execution',
    'tool_or_workflow_execution',
  ].includes(normalizedToken)) {
    return 'tool_or_workflow_execution';
  }

  if ([
    'completed',
    'completed_action',
    'completion',
    'success',
  ].includes(normalizedToken)) {
    return 'completed_action';
  }

  if ([
    'future_action',
    'future',
    'planned_action',
    'will_execute',
  ].includes(normalizedToken)) {
    return 'future_action';
  }

  if ([
    'delivery',
    'external_delivery',
    'publish',
    'sent',
  ].includes(normalizedToken)) {
    return 'external_delivery';
  }

  if ([
    'mutation',
    'state_mutation',
    'update',
    'write',
  ].includes(normalizedToken)) {
    return 'state_mutation';
  }

  return null;
}

function inferActionSurface(rawActionSurface, inferredClaimType) {
  if (ACTION_CLAIM_SURFACES.has(rawActionSurface)) {
    return rawActionSurface;
  }

  if ([
    'tool_or_workflow_execution',
    'completed_action',
    'future_action',
  ].includes(inferredClaimType)) {
    return 'tool_or_workflow';
  }

  if (inferredClaimType === 'external_delivery') {
    return 'channel';
  }

  if (inferredClaimType === 'state_mutation') {
    return 'state';
  }

  return 'generic';
}

function inferTargetType(rawActionSurface, inferredActionSurface) {
  if (!isNonEmptyString(rawActionSurface)) {
    return null;
  }

  if (inferredActionSurface === 'channel') {
    return 'channel';
  }

  if (inferredActionSurface === 'state') {
    return 'state';
  }

  if (inferredActionSurface !== 'tool_or_workflow') {
    return null;
  }

  return rawActionSurface.includes('workflow') ? 'workflow' : 'tool';
}

function normalizeActionClaimDeclarationForCompatibility(declaration, index) {
  if (!isPlainObject(declaration)) {
    return {
      normalizedDeclaration: declaration,
      warnings: [],
      changed: false,
    };
  }

  const rawActionSurface = isNonEmptyString(declaration.actionSurface)
    ? declaration.actionSurface.trim()
    : null;
  const rawClaimType = isNonEmptyString(declaration.claimType)
    ? declaration.claimType.trim()
    : null;
  const rawEvidenceRequirement = isNonEmptyString(declaration.evidenceRequirement)
    ? declaration.evidenceRequirement.trim()
    : null;
  const inferredEvidenceRequirement = inferEvidenceRequirement(rawEvidenceRequirement);
  const inferredClaimType = inferClaimType(rawClaimType, inferredEvidenceRequirement);
  const inferredActionSurface = inferActionSurface(rawActionSurface, inferredClaimType);
  const metadata = isPlainObject(declaration.metadata)
    ? { ...declaration.metadata }
    : {};
  let changed = false;
  const warnings = [];

  if (declaration.kind !== 'action_claim_declaration') {
    changed = true;
    warnings.push(`Claim ${index + 1}: missing or legacy claim kind was normalized to "action_claim_declaration".`);
  }

  if (declaration.version !== 1) {
    changed = true;
    warnings.push(`Claim ${index + 1}: missing or legacy claim version was normalized to 1.`);
  }

  if (rawClaimType !== inferredClaimType && inferredClaimType) {
    changed = true;
    warnings.push(`Claim ${index + 1}: legacy claimType "${rawClaimType ?? 'missing'}" was normalized to "${inferredClaimType}".`);
  }

  if (rawEvidenceRequirement !== inferredEvidenceRequirement && inferredEvidenceRequirement) {
    changed = true;
    warnings.push(`Claim ${index + 1}: legacy evidenceRequirement "${rawEvidenceRequirement ?? 'missing'}" was normalized to "${inferredEvidenceRequirement}".`);
  }

  if (rawActionSurface && !ACTION_CLAIM_SURFACES.has(rawActionSurface)) {
    changed = true;
    warnings.push(`Claim ${index + 1}: legacy actionSurface "${rawActionSurface}" was normalized to "${inferredActionSurface}".`);
    metadata.legacyActionSurface = rawActionSurface;
  }

  const normalizedTargetType = isNonEmptyString(declaration.targetType)
    ? declaration.targetType.trim()
    : inferTargetType(rawActionSurface, inferredActionSurface);
  const normalizedTargetId = isNonEmptyString(declaration.targetId)
    ? declaration.targetId.trim()
    : (
      rawActionSurface && !ACTION_CLAIM_SURFACES.has(rawActionSurface)
        ? rawActionSurface
        : null
    );

  if (!isNonEmptyString(declaration.targetId) && normalizedTargetId) {
    changed = true;
  }

  if (!isNonEmptyString(declaration.targetType) && normalizedTargetType) {
    changed = true;
  }

  return {
    normalizedDeclaration: {
      ...declaration,
      kind: 'action_claim_declaration',
      version: 1,
      claimType: inferredClaimType ?? declaration.claimType,
      actionSurface: inferredActionSurface,
      evidenceRequirement: inferredEvidenceRequirement ?? declaration.evidenceRequirement,
      targetType: normalizedTargetType,
      targetId: normalizedTargetId,
      metadata,
    },
    warnings,
    changed,
  };
}

function normalizeActionClaimReportForCompatibility(report) {
  if (!isPlainObject(report) || report.kind !== 'action_claim_report' || !Array.isArray(report.claims)) {
    return {
      normalizedReport: report,
      warnings: [],
      changed: false,
    };
  }

  let changed = false;
  const warnings = [];
  const normalizedClaims = report.claims.map((claim, index) => {
    const compatibilityResult = normalizeActionClaimDeclarationForCompatibility(claim, index);

    if (compatibilityResult.changed) {
      changed = true;
      warnings.push(...compatibilityResult.warnings);
    }

    return compatibilityResult.normalizedDeclaration;
  });

  if (!changed) {
    return {
      normalizedReport: report,
      warnings: [],
      changed: false,
    };
  }

  return {
    normalizedReport: {
      ...report,
      kind: 'action_claim_report',
      version: 1,
      claims: normalizedClaims,
    },
    warnings: [
      'Legacy action claim report envelope was normalized for compatibility.',
      ...warnings,
    ],
    changed: true,
  };
}

export function buildActionClaimReportEnvelope(actionClaimReport) {
  const normalizedReport = assertActionClaimReport(actionClaimReport);

  return `<${ACTION_CLAIM_REPORT_ENVELOPE_TAG}>${JSON.stringify(normalizedReport)}</${ACTION_CLAIM_REPORT_ENVELOPE_TAG}>`;
}

export function extractActionClaimReportFromOutputText(outputText) {
  if (!isNonEmptyString(outputText)) {
    return {
      visibleOutputText: outputText,
      actionClaimReport: null,
      warnings: [],
    };
  }

  const matches = [...outputText.matchAll(ACTION_CLAIM_REPORT_ENVELOPE_PATTERN)];
  const visibleOutputText = outputText.replaceAll(ACTION_CLAIM_REPORT_ENVELOPE_PATTERN, '').trim();

  if (matches.length === 0) {
    return {
      visibleOutputText,
      actionClaimReport: null,
      warnings: [],
    };
  }

  const warnings = [];

  if (matches.length > 1) {
    warnings.push('Action claim report envelope appeared multiple times; only the final envelope was evaluated.');
  }

  const rawPayload = matches.at(-1)?.[1]?.trim() ?? '';

  try {
    const parsedPayload = JSON.parse(rawPayload);
    const compatibilityResult = normalizeActionClaimReportForCompatibility(parsedPayload);

    return {
      visibleOutputText,
      actionClaimReport: assertActionClaimReport(compatibilityResult.normalizedReport),
      warnings: [
        ...warnings,
        ...compatibilityResult.warnings,
      ],
    };
  } catch (error) {
    return {
      visibleOutputText,
      actionClaimReport: null,
      warnings: [
        ...warnings,
        `Action claim report envelope was invalid and was ignored: ${error.message}`,
      ],
    };
  }
}

export {
  ACTION_CLAIM_REPORT_ENVELOPE_TAG,
};
