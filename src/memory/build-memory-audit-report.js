import { createHash } from 'node:crypto';
import { auditMemoryQuality } from './audit-memory-quality.js';

function createSha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function normalizeTimestamp(value, description) {
  const normalizedValue = value instanceof Date ? value.toISOString() : value?.trim?.();

  if (!normalizedValue || Number.isNaN(Date.parse(normalizedValue))) {
    throw new Error(`${description} must be a valid ISO timestamp.`);
  }

  return normalizedValue;
}

function assertAuditResult(auditResult) {
  if (!auditResult || typeof auditResult !== 'object' || Array.isArray(auditResult)) {
    throw new Error('Memory audit report requires an audit result object.');
  }

  if (auditResult.kind !== 'memory_quality_audit') {
    throw new Error('Memory audit report requires kind "memory_quality_audit".');
  }

  if (!auditResult.summary || typeof auditResult.summary !== 'object') {
    throw new Error('Memory audit result must include a summary object.');
  }

  if (!Array.isArray(auditResult.findings)) {
    throw new Error('Memory audit result must include a findings array.');
  }

  if (!Array.isArray(auditResult.warnings)) {
    throw new Error('Memory audit result must include a warnings array.');
  }

  return auditResult;
}

export function buildMemoryAuditReport({
  memoryRecords = null,
  auditResult = null,
  now = new Date(),
  requestedBy = 'memory-context-factory',
} = {}) {
  const evaluatedAt = normalizeTimestamp(now, 'Memory audit report timestamp');
  const resolvedAuditResult = assertAuditResult(
    auditResult ?? auditMemoryQuality({
      memoryRecords: memoryRecords ?? [],
      now: evaluatedAt,
    }),
  );
  const reportHash = createSha256(JSON.stringify({
    evaluatedAt,
    requestedBy,
    summary: resolvedAuditResult.summary,
    findingIds: resolvedAuditResult.findings.map((finding) => finding.findingId),
    warnings: resolvedAuditResult.warnings,
  })).slice(0, 24);

  return {
    kind: 'memory_audit_report',
    version: 1,
    reportId: `memory-audit-${reportHash}`,
    status: 'completed',
    evaluatedAt,
    requestedBy,
    summary: {
      recordsReceived: resolvedAuditResult.summary.recordsReceived,
      recordsEvaluated: resolvedAuditResult.summary.recordsEvaluated,
      invalidRecords: resolvedAuditResult.summary.invalidRecords,
      findings: resolvedAuditResult.summary.findings,
      criticalFindings: resolvedAuditResult.summary.criticalFindings,
      highFindings: resolvedAuditResult.summary.highFindings,
      mediumFindings: resolvedAuditResult.summary.mediumFindings,
      lowFindings: resolvedAuditResult.summary.lowFindings,
      warnings: resolvedAuditResult.summary.warnings,
    },
    findings: resolvedAuditResult.findings,
    warnings: resolvedAuditResult.warnings,
  };
}
