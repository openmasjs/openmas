import { createHash } from 'node:crypto';
import { assertMemoryRecord } from '../contracts/memory/memory-record-contract.js';
import { evaluateMemoryRetention } from './evaluate-memory-retention.js';
import { evaluateMemoryStaleness } from './evaluate-memory-staleness.js';
import { evaluateMemorySupersession, resolveSupersededMemoryRecords } from './resolve-superseded-memory-records.js';

const DEFAULT_MAX_CONTENT_LENGTH = 32768;
const SEVERITY_RANK = new Map([['critical', 0], ['high', 1], ['medium', 2], ['low', 3], ['info', 4]]);
const SHARED_OPERATIONAL_VISIBILITIES = new Set(['shared_with_team', 'shared_with_mas', 'public_within_mas', 'restricted']);
const APPROVAL_REQUIRED_TYPES = new Set(['durable_decision', 'preference', 'domain_fact', 'company_fact', 'brand_rule', 'policy_context', 'human_preference', 'evaluation_finding', 'risk_note']);
const PRIVACY_SENSITIVE_LEVELS = new Set(['confidential', 'restricted', 'secret_reference_only']);
const SECRET_PATTERNS = [
  ['OpenRouter API key', /\bsk-or-v1-[A-Za-z0-9_-]{16,}\b/u],
  ['OpenAI-style API key', /\bsk-[A-Za-z0-9_-]{16,}\b/u],
  ['Google API key', /\bAIza[A-Za-z0-9_-]{20,}\b/u],
  ['AWS access key', /\bAKIA[A-Z0-9]{16}\b/u],
  ['inline credential assignment', /\b(password|passwd|secret|api[_-]?key|access[_-]?token)\s*[:=]\s*['"]?[^'"\s]{8,}/iu],
];

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

function normalizeText(value) {
  return typeof value === 'string' ? value.replace(/\s+/gu, ' ').trim().toLowerCase() : '';
}

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === 'string' && value.trim().length > 0).map((value) => value.trim()))];
}

function createFinding({ findingType, severity, category, memoryRecordIds = [], sourceIds = [], message, remediation }) {
  const sortedRecordIds = uniqueStrings(memoryRecordIds).toSorted();
  const sortedSourceIds = uniqueStrings(sourceIds).toSorted();
  const hash = createSha256([findingType, severity, category, sortedRecordIds.join(','), sortedSourceIds.join(','), message].join('|')).slice(0, 16);

  return {
    findingId: `finding_${findingType}_${hash}`,
    findingType,
    severity,
    category,
    memoryRecordIds: sortedRecordIds,
    sourceIds: sortedSourceIds,
    message,
    remediation,
  };
}

function sourceIds(record) {
  return record.sourceReferences.map((sourceReference) => sourceReference.sourceId);
}

function findSecretPattern(record) {
  const inspectedText = [record.summary, record.content].filter(Boolean).join('\n');
  const match = SECRET_PATTERNS.find(([, pattern]) => pattern.test(inspectedText));

  return match ? match[0] : null;
}

function addContractFindings({ rawMemoryRecords, records, findings }) {
  rawMemoryRecords.forEach((rawRecord, index) => {
    try {
      records.push(assertMemoryRecord(rawRecord));
    } catch (error) {
      findings.push(createFinding({
        findingType: 'invalid_memory_record',
        severity: 'critical',
        category: 'contract',
        memoryRecordIds: rawRecord?.memoryRecordId ? [String(rawRecord.memoryRecordId)] : [],
        message: `Memory record at index ${index} failed the memory_record contract: ${error.message}`,
        remediation: 'Fix the record shape before the Memory and Context Factory can trust it.',
      }));
    }
  });
}

function addLifecycleFindings({ record, findings, warnings, now, supersessionResolution }) {
  const retention = evaluateMemoryRetention({ memoryRecord: record, now, includeExpiredMemory: true });
  const staleness = evaluateMemoryStaleness({ memoryRecord: record, now, includeStaleMemory: true });
  const supersession = evaluateMemorySupersession({ memoryRecord: record, supersessionResolution, includeSupersededMemory: true });

  warnings.push(...retention.warnings, ...staleness.warnings, ...supersession.warnings);

  if (retention.expired && record.lifecycleStatus === 'active') {
    findings.push(createFinding({
      findingType: 'expired_active_record',
      severity: 'high',
      category: 'lifecycle',
      memoryRecordIds: [record.memoryRecordId],
      sourceIds: sourceIds(record),
      message: `Memory record ${record.memoryRecordId} is expired but still active.`,
      remediation: 'Archive, expire, or refresh the memory before it influences future context.',
    }));
  }

  if (retention.reviewRequired) {
    findings.push(createFinding({
      findingType: 'review_required',
      severity: 'low',
      category: 'lifecycle',
      memoryRecordIds: [record.memoryRecordId],
      sourceIds: sourceIds(record),
      message: `Memory record ${record.memoryRecordId} requires review.`,
      remediation: 'Review the memory and update its lifecycle, retention, or source evidence.',
    }));
  }

  if (staleness.stale && record.lifecycleStatus === 'active') {
    findings.push(createFinding({
      findingType: 'stale_active_record',
      severity: 'medium',
      category: 'lifecycle',
      memoryRecordIds: [record.memoryRecordId],
      sourceIds: sourceIds(record),
      message: `Memory record ${record.memoryRecordId} is stale but still active.`,
      remediation: 'Refresh, supersede, or explicitly keep the memory with a review note.',
    }));
  }

  if (supersession.superseded && record.lifecycleStatus === 'active') {
    findings.push(createFinding({
      findingType: 'superseded_active_record',
      severity: 'medium',
      category: 'lifecycle',
      memoryRecordIds: [record.memoryRecordId],
      sourceIds: sourceIds(record),
      message: `Memory record ${record.memoryRecordId} is superseded but still active.`,
      remediation: 'Update the lifecycle to superseded or verify the supersession metadata.',
    }));
  }
}

function addRecordFindings({ record, findings, warnings, now, maxContentLength, supersessionResolution }) {
  if (record.sourceReferences.length === 0) {
    findings.push(createFinding({
      findingType: 'missing_source_references',
      severity: 'high',
      category: 'traceability',
      memoryRecordIds: [record.memoryRecordId],
      message: `Memory record ${record.memoryRecordId} has no source references.`,
      remediation: 'Attach source references or keep the record out of durable and prompt-eligible memory.',
    }));
  }

  addLifecycleFindings({ record, findings, warnings, now, supersessionResolution });

  if (record.confidence === 'unknown') {
    findings.push(createFinding({
      findingType: 'unknown_confidence',
      severity: 'medium',
      category: 'trust',
      memoryRecordIds: [record.memoryRecordId],
      sourceIds: sourceIds(record),
      message: `Memory record ${record.memoryRecordId} has unknown confidence.`,
      remediation: 'Reclassify the memory confidence before it becomes trusted context.',
    }));
  }

  if (record.content && record.content.length > maxContentLength) {
    findings.push(createFinding({
      findingType: 'oversized_content',
      severity: 'low',
      category: 'quality',
      memoryRecordIds: [record.memoryRecordId],
      sourceIds: sourceIds(record),
      message: `Memory record ${record.memoryRecordId} content exceeds the audit length limit.`,
      remediation: 'Summarize or split the memory before retrieval becomes expensive or risky.',
    }));
  }

  const secretLabel = findSecretPattern(record);

  if (secretLabel) {
    findings.push(createFinding({
      findingType: 'possible_secret_value',
      severity: 'critical',
      category: 'security',
      memoryRecordIds: [record.memoryRecordId],
      sourceIds: sourceIds(record),
      message: `Memory record ${record.memoryRecordId} appears to contain a ${secretLabel}.`,
      remediation: 'Remove raw secrets immediately and replace them with credential references only.',
    }));
  }

  if (record.portability === 'portable' && record.sourceReferences.some((sourceReference) => sourceReference.scope !== 'cognitive_identity' || PRIVACY_SENSITIVE_LEVELS.has(sourceReference.sensitivityLevel))) {
    findings.push(createFinding({
      findingType: 'unsafe_portable_source',
      severity: 'high',
      category: 'portability',
      memoryRecordIds: [record.memoryRecordId],
      sourceIds: sourceIds(record),
      message: `Portable memory record ${record.memoryRecordId} references non-portable or sensitive source context.`,
      remediation: 'Redact, re-scope, or mark the memory as non-portable before export or reuse.',
    }));
  }

  if (record.scope === 'operational_identity' && SHARED_OPERATIONAL_VISIBILITIES.has(record.visibility)) {
    findings.push(createFinding({
      findingType: 'operational_memory_shared_visibility',
      severity: 'medium',
      category: 'privacy',
      memoryRecordIds: [record.memoryRecordId],
      sourceIds: sourceIds(record),
      message: `Operational identity memory ${record.memoryRecordId} is visible beyond its owner.`,
      remediation: 'Verify that sharing is intentional, approved, and represented by a future sharing rule.',
    }));
  }

  if (record.lifecycleStatus === 'active' && APPROVAL_REQUIRED_TYPES.has(record.memoryType) && record.approvalState !== 'approved') {
    findings.push(createFinding({
      findingType: 'active_memory_without_required_approval',
      severity: 'high',
      category: 'governance',
      memoryRecordIds: [record.memoryRecordId],
      sourceIds: sourceIds(record),
      message: `Active memory record ${record.memoryRecordId} requires approval for ${record.memoryType}.`,
      remediation: 'Approve, reject, or downgrade the record before it influences future context.',
    }));
  }

  if (PRIVACY_SENSITIVE_LEVELS.has(record.sensitivityLevel) && record.subjectReferences.length === 0) {
    findings.push(createFinding({
      findingType: 'missing_subject_references',
      severity: 'medium',
      category: 'privacy',
      memoryRecordIds: [record.memoryRecordId],
      sourceIds: sourceIds(record),
      message: `Privacy-sensitive memory record ${record.memoryRecordId} has no subject references.`,
      remediation: 'Attach subject references so redaction, deletion, and audit workflows can target it safely.',
    }));
  }

  if (record.lifecycleStatus === 'active' && (record.privacy.deletionState !== 'active' || ['redacted', 'blocked'].includes(record.privacy.redactionState))) {
    findings.push(createFinding({
      findingType: 'privacy_lifecycle_conflict',
      severity: 'high',
      category: 'privacy',
      memoryRecordIds: [record.memoryRecordId],
      sourceIds: sourceIds(record),
      message: `Memory record ${record.memoryRecordId} is active while privacy metadata requires protection.`,
      remediation: 'Archive, delete, or replace the record with a safe redacted memory version.',
    }));
  }
}

function addCollectionFindings({ records, findings }) {
  const byId = new Map();
  const bySummary = new Map();

  for (const record of records) {
    byId.set(record.memoryRecordId, [...(byId.get(record.memoryRecordId) ?? []), record]);
    bySummary.set(normalizeText(record.summary), [...(bySummary.get(normalizeText(record.summary)) ?? []), record]);
  }

  for (const [memoryRecordId, groupedRecords] of byId.entries()) {
    if (groupedRecords.length > 1) {
      findings.push(createFinding({
        findingType: 'duplicate_memory_record_id',
        severity: 'critical',
        category: 'integrity',
        memoryRecordIds: [memoryRecordId],
        sourceIds: groupedRecords.flatMap(sourceIds),
        message: `Memory record ID ${memoryRecordId} appears ${groupedRecords.length} times.`,
        remediation: 'Deduplicate or rename memory records before retrieval or durable persistence.',
      }));
    }
  }

  for (const [summary, groupedRecords] of bySummary.entries()) {
    if (summary && groupedRecords.length > 1) {
      findings.push(createFinding({
        findingType: 'duplicate_summary',
        severity: 'medium',
        category: 'quality',
        memoryRecordIds: groupedRecords.map((record) => record.memoryRecordId),
        sourceIds: groupedRecords.flatMap(sourceIds),
        message: 'Multiple memory records share the same normalized summary.',
        remediation: 'Merge, supersede, or differentiate duplicate memory records.',
      }));
    }
  }

  addConflictingDecisionFindings({ records, findings });
}

function decisionSubjectKeys(record) {
  if (record.subjectReferences.length === 0) {
    return [`owner:${record.ownerId}`];
  }

  return record.subjectReferences.map((subjectReference) => `${subjectReference.subjectType}:${subjectReference.subjectId}`);
}

function addConflictingDecisionFindings({ records, findings }) {
  const decisionGroups = new Map();
  const decisions = records.filter((record) => record.memoryType === 'durable_decision' && record.lifecycleStatus === 'active' && record.approvalState === 'approved');

  for (const record of decisions) {
    for (const subjectKey of decisionSubjectKeys(record)) {
      decisionGroups.set(subjectKey, [...(decisionGroups.get(subjectKey) ?? []), record]);
    }
  }

  for (const [subjectKey, groupedRecords] of decisionGroups.entries()) {
    const decisionTexts = new Set(groupedRecords.map((record) => normalizeText(record.content ?? record.summary)));

    if (groupedRecords.length > 1 && decisionTexts.size > 1) {
      findings.push(createFinding({
        findingType: 'conflicting_durable_decisions',
        severity: 'high',
        category: 'truth_conflict',
        memoryRecordIds: groupedRecords.map((record) => record.memoryRecordId),
        sourceIds: groupedRecords.flatMap(sourceIds),
        message: `Durable decisions conflict for subject ${subjectKey}.`,
        remediation: 'Resolve the conflict by superseding old decisions or adding an explicit current decision.',
      }));
    }
  }
}

function sortFindings(findings) {
  return [...findings].sort((left, right) => {
    const severityDelta = (SEVERITY_RANK.get(left.severity) ?? 99) - (SEVERITY_RANK.get(right.severity) ?? 99);

    if (severityDelta !== 0) {
      return severityDelta;
    }

    return `${left.findingType}:${left.findingId}`.localeCompare(`${right.findingType}:${right.findingId}`);
  });
}

export function auditMemoryQuality({ memoryRecords, now = new Date(), maxContentLength = DEFAULT_MAX_CONTENT_LENGTH } = {}) {
  if (!Array.isArray(memoryRecords)) {
    throw new Error('Memory quality audit requires a memoryRecords array.');
  }

  if (!Number.isInteger(maxContentLength) || maxContentLength <= 0) {
    throw new Error('Memory quality audit maxContentLength must be a positive integer.');
  }

  const evaluatedAt = normalizeTimestamp(now, 'Memory quality audit timestamp');
  const records = [];
  const findings = [];
  const warnings = [];

  addContractFindings({ rawMemoryRecords: memoryRecords, records, findings });

  const supersessionResolution = resolveSupersededMemoryRecords(records);
  warnings.push(...supersessionResolution.warnings);

  for (const record of records) {
    addRecordFindings({ record, findings, warnings, now: evaluatedAt, maxContentLength, supersessionResolution });
  }

  addCollectionFindings({ records, findings });

  const sortedFindings = sortFindings(findings);
  const uniqueWarnings = uniqueStrings(warnings).toSorted();

  return {
    kind: 'memory_quality_audit',
    version: 1,
    evaluatedAt,
    recordsEvaluated: records.length,
    invalidRecords: memoryRecords.length - records.length,
    findings: sortedFindings,
    warnings: uniqueWarnings,
    summary: {
      recordsReceived: memoryRecords.length,
      recordsEvaluated: records.length,
      invalidRecords: memoryRecords.length - records.length,
      findings: sortedFindings.length,
      criticalFindings: sortedFindings.filter((finding) => finding.severity === 'critical').length,
      highFindings: sortedFindings.filter((finding) => finding.severity === 'high').length,
      mediumFindings: sortedFindings.filter((finding) => finding.severity === 'medium').length,
      lowFindings: sortedFindings.filter((finding) => finding.severity === 'low').length,
      warnings: uniqueWarnings.length,
    },
  };
}

export { DEFAULT_MAX_CONTENT_LENGTH, SEVERITY_RANK };
