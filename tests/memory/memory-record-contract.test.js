import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertMemorySourceReference,
  assertMemorySourceReferences,
} from '../../src/contracts/memory-source-reference-contract.js';
import { assertMemoryRecord } from '../../src/contracts/memory-record-contract.js';

const VALID_CREATED_AT = '2026-04-14T00:00:00.000Z';
const VALID_SHA_256 = 'a'.repeat(64);

function buildSourceReference(overrides = {}) {
  return {
    kind: 'memory_source_reference',
    version: 1,
    sourceType: 'knowledge_document',
    sourceId: 'community-management-playbook',
    scope: 'cognitive_identity',
    ownerId: 'community-manager',
    path: 'instance/cognitive-identities/marketing-and-sales/community-manager/memory/playbook.md',
    origin: 'imported_document',
    sensitivityLevel: 'internal',
    createdAt: VALID_CREATED_AT,
    contentSha256: VALID_SHA_256,
    metadata: {
      title: 'Community Management Playbook',
    },
    ...overrides,
  };
}

function buildMemoryRecord(overrides = {}) {
  return {
    kind: 'memory_record',
    version: 1,
    memoryRecordId: 'mem_community_manager_playbook',
    memoryType: 'professional_knowledge',
    scope: 'cognitive_identity',
    ownerId: 'community-manager',
    origin: 'imported_document',
    portability: 'portable',
    visibility: 'shared_with_mas',
    approvalState: 'approved',
    lifecycleStatus: 'active',
    sensitivityLevel: 'internal',
    confidence: 'human_approved',
    authorityLevel: 'mas_guidance',
    summary: 'Community managers should answer serious complaints calmly and escalate when needed.',
    content: null,
    sourceReferences: [buildSourceReference()],
    subjectReferences: [],
    retention: {
      retentionPolicyId: 'default-cognitive-memory',
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
  };
}

test('assertMemorySourceReference accepts and normalizes a valid source reference', () => {
  const sourceReference = assertMemorySourceReference(buildSourceReference({
    sourceId: ' community-management-playbook ',
    ownerId: ' community-manager ',
  }));

  assert.equal(sourceReference.kind, 'memory_source_reference');
  assert.equal(sourceReference.sourceId, 'community-management-playbook');
  assert.equal(sourceReference.ownerId, 'community-manager');
  assert.equal(sourceReference.scope, 'cognitive_identity');
  assert.equal(sourceReference.contentSha256, VALID_SHA_256);
  assert.deepEqual(sourceReference.metadata, {
    title: 'Community Management Playbook',
  });
});

test('assertMemorySourceReference rejects invalid source types', () => {
  assert.throws(
    () => assertMemorySourceReference(buildSourceReference({ sourceType: 'chat_dump' })),
    /sourceType is invalid/,
  );
});

test('assertMemorySourceReference rejects invalid scopes', () => {
  assert.throws(
    () => assertMemorySourceReference(buildSourceReference({ scope: 'personal_memory' })),
    /scope is invalid/,
  );
});

test('assertMemorySourceReference rejects invalid SHA-256 fingerprints', () => {
  assert.throws(
    () => assertMemorySourceReference(buildSourceReference({ contentSha256: 'not-a-sha' })),
    /contentSha256 must be a lowercase SHA-256 hex digest/,
  );
});

test('assertMemorySourceReferences rejects duplicated source references', () => {
  assert.throws(
    () => assertMemorySourceReferences([
      buildSourceReference(),
      buildSourceReference(),
    ]),
    /duplicated source reference/,
  );
});

test('assertMemoryRecord accepts a governed cognitive identity memory record', () => {
  const memoryRecord = assertMemoryRecord(buildMemoryRecord({
    summary: '  Community managers should acknowledge complaints before proposing a solution.  ',
    content: '  Acknowledge first. Solve second.  ',
  }));

  assert.equal(memoryRecord.kind, 'memory_record');
  assert.equal(memoryRecord.memoryRecordId, 'mem_community_manager_playbook');
  assert.equal(memoryRecord.scope, 'cognitive_identity');
  assert.equal(memoryRecord.portability, 'portable');
  assert.equal(memoryRecord.visibility, 'shared_with_mas');
  assert.equal(memoryRecord.lifecycleStatus, 'active');
  assert.equal(memoryRecord.summary, 'Community managers should acknowledge complaints before proposing a solution.');
  assert.equal(memoryRecord.content, 'Acknowledge first. Solve second.');
  assert.equal(memoryRecord.sourceReferences.length, 1);
});

test('assertMemoryRecord accepts MAS-bound operational identity memory', () => {
  const memoryRecord = assertMemoryRecord(buildMemoryRecord({
    memoryRecordId: 'mem_maria_onboarding',
    memoryType: 'relationship_note',
    scope: 'operational_identity',
    ownerId: 'maria',
    origin: 'runtime_observed',
    portability: 'mas_bound',
    visibility: 'private_to_owner',
    approvalState: 'pending',
    confidence: 'observed',
    authorityLevel: 'operational_note',
    summary: 'Maria was onboarded as a Community Manager inside Sin Cuchillo.',
    sourceReferences: [
      buildSourceReference({
        sourceType: 'invocation_session',
        sourceId: 'agent-invocation-maria-onboarding',
        scope: 'operational_identity',
        ownerId: 'maria',
        origin: 'runtime_observed',
        path: 'instance/memory/state/agent-invocation-maria-onboarding.json',
      }),
    ],
    subjectReferences: [
      {
        subjectType: 'operational_identity',
        subjectId: 'maria',
        relationship: 'owner',
      },
    ],
  }));

  assert.equal(memoryRecord.scope, 'operational_identity');
  assert.equal(memoryRecord.portability, 'mas_bound');
  assert.equal(memoryRecord.visibility, 'private_to_owner');
  assert.equal(memoryRecord.subjectReferences[0].subjectId, 'maria');
});

test('assertMemoryRecord rejects invalid memory types', () => {
  assert.throws(
    () => assertMemoryRecord(buildMemoryRecord({ memoryType: 'raw_chat_history' })),
    /memoryType is invalid/,
  );
});

test('assertMemoryRecord rejects invalid governance enum values', () => {
  assert.throws(
    () => assertMemoryRecord(buildMemoryRecord({ portability: 'travels_everywhere' })),
    /portability is invalid/,
  );

  assert.throws(
    () => assertMemoryRecord(buildMemoryRecord({ visibility: 'everyone_on_the_internet' })),
    /visibility is invalid/,
  );

  assert.throws(
    () => assertMemoryRecord(buildMemoryRecord({ approvalState: 'rubber_stamped' })),
    /approvalState is invalid/,
  );

  assert.throws(
    () => assertMemoryRecord(buildMemoryRecord({ lifecycleStatus: 'forgottenish' })),
    /lifecycleStatus is invalid/,
  );

  assert.throws(
    () => assertMemoryRecord(buildMemoryRecord({ authorityLevel: 'because_i_said_so' })),
    /authorityLevel is invalid/,
  );
});

test('assertMemoryRecord rejects portable memory outside cognitive identity scope', () => {
  assert.throws(
    () => assertMemoryRecord(buildMemoryRecord({
      scope: 'operational_identity',
      ownerId: 'maria',
      portability: 'portable',
      visibility: 'private_to_owner',
      approvalState: 'approved',
    })),
    /Only cognitive_identity memory records may use portability "portable"/,
  );
});

test('assertMemoryRecord rejects secret-reference-only memory with raw content', () => {
  assert.throws(
    () => assertMemoryRecord(buildMemoryRecord({
      sensitivityLevel: 'secret_reference_only',
      content: 'raw-secret-value',
    })),
    /must not include raw content/,
  );
});

test('assertMemoryRecord rejects source-required memory without source references', () => {
  assert.throws(
    () => assertMemoryRecord(buildMemoryRecord({
      memoryType: 'runtime_evidence',
      sourceReferences: [],
    })),
    /must include at least one source reference/,
  );
});

test('assertMemoryRecord validates subject references, retention, and supersession', () => {
  const memoryRecord = assertMemoryRecord(buildMemoryRecord({
    memoryRecordId: 'mem_company_policy_update',
    memoryType: 'policy_context',
    scope: 'mas_instance',
    ownerId: 'sin-cuchillo',
    portability: 'not_exportable',
    visibility: 'shared_with_mas',
    authorityLevel: 'policy',
    summary: 'Serious delivery complaints must be handled calmly and escalated when needed.',
    subjectReferences: [
      {
        subjectType: 'mas_instance',
        subjectId: 'sin-cuchillo',
        relationship: 'policy-owner',
      },
    ],
    retention: {
      retentionPolicyId: 'default-policy-memory',
      expiresAt: null,
      staleAfter: '2026-10-14T00:00:00.000Z',
      reviewRequiredAt: '2026-09-14T00:00:00.000Z',
    },
    supersession: {
      supersedesMemoryRecordIds: ['mem_old_policy'],
      supersededByMemoryRecordId: null,
    },
    privacy: {
      redactionState: 'not_required',
      deletionState: 'active',
      redactedAt: null,
      deletedAt: null,
      reason: null,
    },
  }));

  assert.equal(memoryRecord.retention.retentionPolicyId, 'default-policy-memory');
  assert.equal(memoryRecord.retention.staleAfter, '2026-10-14T00:00:00.000Z');
  assert.deepEqual(memoryRecord.supersession.supersedesMemoryRecordIds, ['mem_old_policy']);
  assert.equal(memoryRecord.privacy.deletionState, 'active');
  assert.equal(memoryRecord.subjectReferences[0].subjectType, 'mas_instance');
});

test('assertMemoryRecord rejects invalid subject references and retention dates', () => {
  assert.throws(
    () => assertMemoryRecord(buildMemoryRecord({
      subjectReferences: [
        {
          subjectType: 'imaginary_subject',
          subjectId: 'maria',
        },
      ],
    })),
    /subjectType is invalid/,
  );

  assert.throws(
    () => assertMemoryRecord(buildMemoryRecord({
      retention: {
        staleAfter: 'not-a-date',
      },
    })),
    /staleAfter must be a valid ISO date string/,
  );

  assert.throws(
    () => assertMemoryRecord(buildMemoryRecord({
      privacy: {
        redactionState: 'sort_of_redacted',
      },
    })),
    /redactionState is invalid/,
  );
});
