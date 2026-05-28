import test from 'node:test';
import assert from 'node:assert/strict';
import { assertMemoryRecord } from '../../src/contracts/memory-record-contract.js';
import { buildContextPackForInvocation } from '../../src/context/build-context-pack-for-invocation.js';
import { evaluateMemoryRetention } from '../../src/memory/evaluate-memory-retention.js';
import { evaluateMemoryStaleness } from '../../src/memory/evaluate-memory-staleness.js';
import {
  evaluateMemorySupersession,
  resolveSupersededMemoryRecords,
} from '../../src/memory/resolve-superseded-memory-records.js';

const VALID_CREATED_AT = '2026-04-14T00:00:00.000Z';
const VALID_SHA_256 = 'b'.repeat(64);
const EVALUATION_NOW = '2026-04-14T12:00:00.000Z';

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
    memoryRecordId: 'mem_company_fact',
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
      retentionPolicyId: 'default-test-memory',
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

function buildReadiness() {
  return {
    status: 'ready',
    resolvedPrimaryCognitiveIdentityId: 'community-manager',
    operationalIdentityDefinition: {
      operationalIdentityId: 'maria',
      displayName: 'Maria',
    },
    activeCognitiveSet: {
      primaryCognitiveIdentityId: 'community-manager',
      secondaryCognitiveIdentityIds: [],
    },
    usableBindings: [],
  };
}

function buildRequest() {
  return {
    operationalIdentityId: 'maria',
    invocationMode: 'probabilistic',
    command: 'ask',
    requestedBy: 'human-admin',
    inputText: 'Help me answer a customer.',
  };
}

async function buildContextPackWithMemory(memoryRecords, options = {}) {
  return buildContextPackForInvocation({
    bootResult: {
      status: 'ready',
      masRootPath: 'not-used-with-memory-collection',
    },
    readiness: buildReadiness(),
    request: buildRequest(),
    invocationId: options.invocationId ?? 'invocation-lifecycle-001',
    now: options.now ?? EVALUATION_NOW,
    includeStaleMemory: options.includeStaleMemory ?? false,
    includeSupersededMemory: options.includeSupersededMemory ?? false,
    memoryCollection: {
      memoryRecords,
      warnings: [],
    },
  });
}

test('evaluateMemoryRetention marks expired memory as excluded by default', () => {
  const retentionEvaluation = evaluateMemoryRetention({
    memoryRecord: buildMemoryRecord({
      memoryRecordId: 'mem_expired',
      retention: {
        retentionPolicyId: 'short-lived',
        expiresAt: '2026-04-13T00:00:00.000Z',
        staleAfter: null,
        reviewRequiredAt: null,
      },
    }),
    now: EVALUATION_NOW,
  });

  assert.equal(retentionEvaluation.expired, true);
  assert.equal(retentionEvaluation.effect, 'omit');
  assert.equal(retentionEvaluation.decisionType, 'expired_source');
  assert.equal(retentionEvaluation.warnings.some((warning) => warning.includes('Expired memory omitted')), true);
});

test('evaluateMemoryRetention emits warnings for missing timestamps and review-required memory', () => {
  const retentionEvaluation = evaluateMemoryRetention({
    memoryRecord: buildMemoryRecord({
      memoryRecordId: 'mem_missing_timestamps',
      createdAt: null,
      updatedAt: null,
      retention: {
        retentionPolicyId: 'needs-review',
        expiresAt: null,
        staleAfter: null,
        reviewRequiredAt: '2026-04-13T00:00:00.000Z',
      },
    }),
    now: EVALUATION_NOW,
  });

  assert.equal(retentionEvaluation.reviewRequired, true);
  assert.equal(retentionEvaluation.effect, 'include');
  assert.equal(retentionEvaluation.warnings.some((warning) => warning.includes('missing createdAt')), true);
  assert.equal(retentionEvaluation.warnings.some((warning) => warning.includes('missing updatedAt')), true);
  assert.equal(retentionEvaluation.warnings.some((warning) => warning.includes('requires review')), true);
});

test('evaluateMemoryStaleness omits stale memory unless it is explicitly allowed', () => {
  const staleRecord = buildMemoryRecord({
    memoryRecordId: 'mem_stale',
    retention: {
      retentionPolicyId: 'campaign-memory',
      expiresAt: null,
      staleAfter: '2026-04-13T00:00:00.000Z',
      reviewRequiredAt: null,
    },
  });
  const defaultEvaluation = evaluateMemoryStaleness({
    memoryRecord: staleRecord,
    now: EVALUATION_NOW,
  });
  const allowedEvaluation = evaluateMemoryStaleness({
    memoryRecord: staleRecord,
    now: EVALUATION_NOW,
    includeStaleMemory: true,
  });

  assert.equal(defaultEvaluation.stale, true);
  assert.equal(defaultEvaluation.effect, 'omit');
  assert.equal(defaultEvaluation.decisionType, 'stale_source');
  assert.equal(allowedEvaluation.effect, 'include');
  assert.equal(allowedEvaluation.warnings.some((warning) => warning.includes('included by explicit option')), true);
});

test('resolveSupersededMemoryRecords resolves explicit supersession chains', () => {
  const oldRecord = buildMemoryRecord({
    memoryRecordId: 'mem_old_policy',
    summary: 'Old policy.',
  });
  const currentRecord = buildMemoryRecord({
    memoryRecordId: 'mem_current_policy',
    summary: 'Current policy.',
    supersession: {
      supersedesMemoryRecordIds: ['mem_old_policy'],
      supersededByMemoryRecordId: null,
    },
  });
  const supersessionResolution = resolveSupersededMemoryRecords([oldRecord, currentRecord]);
  const supersessionEvaluation = evaluateMemorySupersession({
    memoryRecord: oldRecord,
    supersessionResolution,
  });

  assert.deepEqual(supersessionResolution.supersededMemoryRecordIds, ['mem_old_policy']);
  assert.equal(supersessionEvaluation.effect, 'omit');
  assert.equal(supersessionEvaluation.supersededByMemoryRecordId, 'mem_current_policy');
});

test('buildContextPackForInvocation excludes expired, stale, and superseded memory by default', async () => {
  const contextPack = await buildContextPackWithMemory([
    buildMemoryRecord({
      memoryRecordId: 'mem_active',
      summary: 'Active brand memory.',
      content: 'Active brand memory should appear.',
    }),
    buildMemoryRecord({
      memoryRecordId: 'mem_expired',
      summary: 'Expired memory.',
      content: 'EXPIRED_MEMORY_MUST_NOT_APPEAR',
      retention: {
        retentionPolicyId: 'expired-test',
        expiresAt: '2026-04-13T00:00:00.000Z',
        staleAfter: null,
        reviewRequiredAt: null,
      },
    }),
    buildMemoryRecord({
      memoryRecordId: 'mem_stale',
      summary: 'Stale memory.',
      content: 'STALE_MEMORY_MUST_NOT_APPEAR',
      retention: {
        retentionPolicyId: 'stale-test',
        expiresAt: null,
        staleAfter: '2026-04-13T00:00:00.000Z',
        reviewRequiredAt: null,
      },
    }),
    buildMemoryRecord({
      memoryRecordId: 'mem_old',
      summary: 'Superseded memory.',
      content: 'SUPERSEDED_MEMORY_MUST_NOT_APPEAR',
      supersession: {
        supersedesMemoryRecordIds: [],
        supersededByMemoryRecordId: 'mem_active',
      },
    }),
  ]);
  const contextContent = contextPack.sections.map((section) => section.content).join('\n');

  assert.equal(contextContent.includes('Active brand memory should appear'), true);
  assert.equal(contextContent.includes('EXPIRED_MEMORY_MUST_NOT_APPEAR'), false);
  assert.equal(contextContent.includes('STALE_MEMORY_MUST_NOT_APPEAR'), false);
  assert.equal(contextContent.includes('SUPERSEDED_MEMORY_MUST_NOT_APPEAR'), false);
  assert.equal(contextPack.omittedSources.some((decision) => decision.decisionType === 'expired_source'), true);
  assert.equal(contextPack.omittedSources.some((decision) => decision.decisionType === 'stale_source'), true);
  assert.equal(contextPack.omittedSources.some((decision) => decision.decisionType === 'superseded_source'), true);
});

test('buildContextPackForInvocation includes stale memory only when explicitly allowed and emits warnings', async () => {
  const contextPack = await buildContextPackWithMemory([
    buildMemoryRecord({
      memoryRecordId: 'mem_stale_allowed',
      summary: 'Stale but explicitly allowed memory.',
      content: 'STALE_MEMORY_ALLOWED_FOR_AUDIT',
      retention: {
        retentionPolicyId: 'stale-test',
        expiresAt: null,
        staleAfter: '2026-04-13T00:00:00.000Z',
        reviewRequiredAt: null,
      },
    }),
  ], {
    includeStaleMemory: true,
    invocationId: 'invocation-lifecycle-002',
  });
  const contextContent = contextPack.sections.map((section) => section.content).join('\n');

  assert.equal(contextContent.includes('STALE_MEMORY_ALLOWED_FOR_AUDIT'), true);
  assert.equal(contextPack.warnings.some((warning) => warning.includes('Stale memory included by explicit option')), true);
});

test('buildContextPackForInvocation rejects redacted or deleted subject memory', async () => {
  const contextPack = await buildContextPackWithMemory([
    buildMemoryRecord({
      memoryRecordId: 'mem_deleted_subject',
      summary: 'Deleted customer memory.',
      content: 'DELETED_SUBJECT_MEMORY_MUST_NOT_APPEAR',
      privacy: {
        redactionState: 'not_required',
        deletionState: 'deleted',
        redactedAt: null,
        deletedAt: '2026-04-14T10:00:00.000Z',
        reason: 'Subject deletion request.',
      },
    }),
    buildMemoryRecord({
      memoryRecordId: 'mem_redacted_subject',
      summary: 'Redacted customer memory.',
      content: 'REDACTED_SUBJECT_MEMORY_MUST_NOT_APPEAR',
      privacy: {
        redactionState: 'redacted',
        deletionState: 'active',
        redactedAt: '2026-04-14T10:00:00.000Z',
        deletedAt: null,
        reason: 'Sensitive subject content was redacted.',
      },
    }),
  ], {
    invocationId: 'invocation-lifecycle-003',
  });
  const contextContent = contextPack.sections.map((section) => section.content).join('\n');

  assert.equal(contextContent.includes('DELETED_SUBJECT_MEMORY_MUST_NOT_APPEAR'), false);
  assert.equal(contextContent.includes('REDACTED_SUBJECT_MEMORY_MUST_NOT_APPEAR'), false);
  assert.equal(contextPack.rejectedSources.length, 2);
  assert.equal(contextPack.rejectedSources.every((decision) => decision.decisionType === 'privacy_rejection'), true);
});
