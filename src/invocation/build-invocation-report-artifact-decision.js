const AUDIT_REPORT_KINDS = new Set([
  'memory_health_diagnostic_report',
]);

const EXPLICIT_AUDIT_COMMANDS = new Set([
  'memory-health',
]);

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeOptionalString(value) {
  return isNonEmptyString(value) ? value.trim() : null;
}

function normalizeReportKind(reportKind) {
  if (!isNonEmptyString(reportKind)) {
    throw new Error('Invocation report artifact decision requires a non-empty reportKind.');
  }

  return reportKind.trim();
}

function buildTrigger({ request }) {
  return {
    operationalIdentityId: normalizeOptionalString(request?.operationalIdentityId),
    invocationMode: normalizeOptionalString(request?.invocationMode),
    command: normalizeOptionalString(request?.command),
    requestedBy: normalizeOptionalString(request?.requestedBy) ?? 'system',
  };
}

function isExplicitAuditRequest({ request }) {
  return EXPLICIT_AUDIT_COMMANDS.has(normalizeOptionalString(request?.command));
}

function buildCommonDecision({
  reportKind,
  artifactClass,
  persistReportArtifact,
  persistenceReason,
  trigger,
}) {
  return {
    kind: 'invocation_report_artifact_decision',
    version: 1,
    reportKind,
    artifactClass,
    persistReportArtifact,
    persistenceReason,
    trigger,
    promptInclusionMode: 'artifact_reference_only',
    rawArtifactBodyPromptEligible: false,
    durableMemoryWriteEligible: false,
    safetyRules: [
      'Persisted invocation reports are runtime artifacts, not durable memory truth.',
      'Prompt Factory may reference artifact metadata through artifact_reference memory only.',
      'Raw artifact bodies must not be injected into prompts by default.',
      'Secret values must not be intentionally persisted in report artifacts.',
    ],
  };
}

export function buildInvocationReportArtifactDecision({
  reportKind,
  request = null,
} = {}) {
  const normalizedReportKind = normalizeReportKind(reportKind);
  const trigger = buildTrigger({ request });

  if (!AUDIT_REPORT_KINDS.has(normalizedReportKind)) {
    return buildCommonDecision({
      reportKind: normalizedReportKind,
      artifactClass: 'runtime_invocation_report',
      persistReportArtifact: true,
      persistenceReason: 'Standard invocation reports are persisted as bounded runtime artifacts for auditability.',
      trigger,
    });
  }

  if (isExplicitAuditRequest({ request })) {
    return buildCommonDecision({
      reportKind: normalizedReportKind,
      artifactClass: 'memory_audit_report',
      persistReportArtifact: true,
      persistenceReason: 'Memory audit reports are persisted only for explicit diagnostic invocations.',
      trigger,
    });
  }

  return buildCommonDecision({
    reportKind: normalizedReportKind,
    artifactClass: 'memory_audit_report',
    persistReportArtifact: false,
    persistenceReason: 'Memory audit reports are not persisted automatically outside explicit diagnostic requests.',
    trigger,
  });
}

export {
  AUDIT_REPORT_KINDS,
  EXPLICIT_AUDIT_COMMANDS,
};
