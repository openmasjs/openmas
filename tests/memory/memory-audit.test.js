import test from 'node:test';
import assert from 'node:assert/strict';
import { assertMemoryRecord } from '../../src/contracts/memory-record-contract.js';
import { auditMemoryQuality } from '../../src/memory/audit-memory-quality.js';
import { buildMemoryAuditReport } from '../../src/memory/build-memory-audit-report.js';

const VALID_CREATED_AT = '2026-04-14T00:00:00.000Z';
const AUDIT_NOW = '2026-04-14T12:00:00.000Z';
const VALID_SHA_256 = 'd'.repeat(64);

function buildSourceReference(overrides = {}) {
  return {
    kind: 'memory_source_reference',
    version: 1,
    sourceType: 'knowledge_document',
    sourceId: 'memory.md',
    scope: 'mas_instance',
    ownerId: 'sin-cuchillo',
    path: 'memory/knowledge/memory.md',
    origin: 'steward_curated',
    sensitivityLevel: 'internal',
    createdAt: VALID_CREATED_AT,
    contentSha256: VALID_SHA_256,
    ...overrides,
  };
}

function buildMemoryRecord(overrides = {}) {
  return assertMemoryRecord({
    kind: 'memory_record',
    version: 1,
    memoryRecordId: 'mem_audit_record',
    memoryType: 'domain_fact',
    scope: 'mas_instance',
    ownerId: 'sin-cuchillo',
    origin: 'steward_curated',
    portability: 'not_exportable',
    visibility: 'shared_with_mas',
    approvalState: 'approved',
    lifecycleStatus: 'active',
    sensitivityLevel: 'internal',
    confidence: 'steward_approved',
    authorityLevel: 'mas_guidance',
    summary: 'Sin Cuchillo uses a warm and precise brand voice.',
    content: 'Sin Cuchillo uses a warm and precise brand voice.',
    sourceReferences: [buildSourceReference()],
    subjectReferences: [
      {
        subjectType: 'mas_instance',
        subjectId: 'sin-cuchillo',
        relationship: 'memory-owner',
      },
    ],
    retention: {
      retentionPolicyId: 'audit-test',
      expiresAt: null,
      staleAfter: null,
      reviewRequiredAt: null,
    },
    supersession: {
      supersedesMemoryRecordIds: [],
      supersededByMemoryRecordId: null,
    },
    createdAt: VALID_CREATED_AT,
    updatedAt: VALID_CREATED_AT,
    warnings: [],
    ...overrides,
  });
}

function findingTypes(auditResult) {
  return auditResult.findings.map((finding) => finding.findingType);
}

test('auditMemoryQuality detects missing source references', () => {
  const auditResult = auditMemoryQuality({
    now: AUDIT_NOW,
    memoryRecords: [
      buildMemoryRecord({
        memoryRecordId: 'mem_task_state_no_sources',
        memoryType: 'task_state',
        authorityLevel: 'operational_note',
        summary: 'Task state without source references.',
        sourceReferences: [],
      }),
    ],
  });

  assert.equal(findingTypes(auditResult).includes('missing_source_references'), true);
  assert.equal(auditResult.summary.highFindings, 1);
});

test('auditMemoryQuality detects stale and expired active records', () => {
  const auditResult = auditMemoryQuality({
    now: AUDIT_NOW,
    memoryRecords: [
      buildMemoryRecord({
        memoryRecordId: 'mem_stale_active',
        retention: {
          retentionPolicyId: 'audit-test',
          expiresAt: null,
          staleAfter: '2026-04-13T00:00:00.000Z',
          reviewRequiredAt: null,
        },
      }),
      buildMemoryRecord({
        memoryRecordId: 'mem_expired_active',
        retention: {
          retentionPolicyId: 'audit-test',
          expiresAt: '2026-04-13T00:00:00.000Z',
          staleAfter: null,
          reviewRequiredAt: null,
        },
      }),
    ],
  });

  assert.equal(findingTypes(auditResult).includes('stale_active_record'), true);
  assert.equal(findingTypes(auditResult).includes('expired_active_record'), true);
});

test('auditMemoryQuality detects possible secret patterns without copying the secret into findings', () => {
  const rawSecret = 'sk-or-v1-THIS_IS_A_FAKE_SECRET_FOR_TESTING_ONLY';
  const auditResult = auditMemoryQuality({
    now: AUDIT_NOW,
    memoryRecords: [
      buildMemoryRecord({
        memoryRecordId: 'mem_secret_like_content',
        content: `Use API key ${rawSecret}`,
      }),
    ],
  });

  assert.equal(findingTypes(auditResult).includes('possible_secret_value'), true);
  assert.equal(auditResult.summary.criticalFindings, 1);
  assert.equal(JSON.stringify(auditResult.findings).includes(rawSecret), false);
});

test('auditMemoryQuality detects conflicting durable decisions', () => {
  const sharedSubject = {
    subjectType: 'mas_instance',
    subjectId: 'sin-cuchillo',
    relationship: 'policy-subject',
  };
  const auditResult = auditMemoryQuality({
    now: AUDIT_NOW,
    memoryRecords: [
      buildMemoryRecord({
        memoryRecordId: 'mem_decision_a',
        memoryType: 'durable_decision',
        authorityLevel: 'human_directive',
        summary: 'Delivery complaints must be escalated.',
        content: 'Escalate serious delivery complaints to a human manager.',
        subjectReferences: [sharedSubject],
      }),
      buildMemoryRecord({
        memoryRecordId: 'mem_decision_b',
        memoryType: 'durable_decision',
        authorityLevel: 'human_directive',
        summary: 'Delivery complaints must not be escalated.',
        content: 'Do not escalate serious delivery complaints.',
        subjectReferences: [sharedSubject],
      }),
    ],
  });
  const finding = auditResult.findings.find((candidate) => candidate.findingType === 'conflicting_durable_decisions');

  assert.ok(finding);
  assert.deepEqual(finding.memoryRecordIds, ['mem_decision_a', 'mem_decision_b']);
  assert.equal(finding.severity, 'high');
});

test('auditMemoryQuality detects unsafe portability and shared operational visibility', () => {
  const auditResult = auditMemoryQuality({
    now: AUDIT_NOW,
    memoryRecords: [
      buildMemoryRecord({
        memoryRecordId: 'mem_portable_from_mas_source',
        memoryType: 'professional_knowledge',
        scope: 'cognitive_identity',
        ownerId: 'community-manager',
        portability: 'portable',
        visibility: 'shared_with_mas',
        sourceReferences: [buildSourceReference({ scope: 'mas_instance', ownerId: 'sin-cuchillo' })],
      }),
      buildMemoryRecord({
        memoryRecordId: 'mem_operational_shared',
        memoryType: 'relationship_note',
        scope: 'operational_identity',
        ownerId: 'maria',
        portability: 'mas_bound',
        visibility: 'shared_with_mas',
        approvalState: 'approved',
        sourceReferences: [
          buildSourceReference({
            sourceType: 'operational_identity_memory',
            sourceId: 'maria-memory.md',
            scope: 'operational_identity',
            ownerId: 'maria',
            path: 'operational-identities/maria/memory/maria-memory.md',
          }),
        ],
        subjectReferences: [{ subjectType: 'operational_identity', subjectId: 'maria', relationship: 'owner' }],
      }),
    ],
  });

  assert.equal(findingTypes(auditResult).includes('unsafe_portable_source'), true);
  assert.equal(findingTypes(auditResult).includes('operational_memory_shared_visibility'), true);
});

test('auditMemoryQuality detects missing subject references on privacy-sensitive memory', () => {
  const auditResult = auditMemoryQuality({
    now: AUDIT_NOW,
    memoryRecords: [
      buildMemoryRecord({
        memoryRecordId: 'mem_confidential_without_subject',
        sensitivityLevel: 'confidential',
        subjectReferences: [],
      }),
    ],
  });

  assert.equal(findingTypes(auditResult).includes('missing_subject_references'), true);
});

test('auditMemoryQuality detects unknown confidence, oversized content, duplicate summaries, and invalid records', () => {
  const auditResult = auditMemoryQuality({
    now: AUDIT_NOW,
    maxContentLength: 20,
    memoryRecords: [
      buildMemoryRecord({
        memoryRecordId: 'mem_duplicate_summary_a',
        confidence: 'unknown',
        summary: 'Duplicate summary.',
        content: 'This content is intentionally larger than the configured audit threshold.',
      }),
      buildMemoryRecord({
        memoryRecordId: 'mem_duplicate_summary_b',
        summary: ' duplicate   summary. ',
      }),
      {
        kind: 'memory_record',
        memoryRecordId: 'mem_invalid_contract',
      },
    ],
  });
  const types = findingTypes(auditResult);

  assert.equal(types.includes('unknown_confidence'), true);
  assert.equal(types.includes('oversized_content'), true);
  assert.equal(types.includes('duplicate_summary'), true);
  assert.equal(types.includes('invalid_memory_record'), true);
  assert.equal(auditResult.summary.invalidRecords, 1);
});

test('buildMemoryAuditReport generates a stable persistable audit report', () => {
  const memoryRecords = [
    buildMemoryRecord({
      memoryRecordId: 'mem_report_stale',
      retention: {
        retentionPolicyId: 'audit-test',
        expiresAt: null,
        staleAfter: '2026-04-13T00:00:00.000Z',
        reviewRequiredAt: null,
      },
    }),
  ];
  const firstReport = buildMemoryAuditReport({ memoryRecords, now: AUDIT_NOW, requestedBy: 'test-suite' });
  const secondReport = buildMemoryAuditReport({ memoryRecords, now: AUDIT_NOW, requestedBy: 'test-suite' });

  assert.equal(firstReport.kind, 'memory_audit_report');
  assert.equal(firstReport.status, 'completed');
  assert.equal(firstReport.reportId, secondReport.reportId);
  assert.deepEqual(firstReport, secondReport);
  assert.equal(firstReport.summary.recordsEvaluated, 1);
  assert.equal(firstReport.summary.findings, 1);
  assert.equal(firstReport.findings[0].findingType, 'stale_active_record');
});
