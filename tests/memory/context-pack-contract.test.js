import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertContextPack,
  assertContextPackSection,
} from '../../src/contracts/context/context-pack-contract.js';

const VALID_CREATED_AT = '2026-04-14T00:00:00.000Z';
const VALID_SHA_256 = 'b'.repeat(64);

function buildSourceReference(overrides = {}) {
  return {
    kind: 'memory_source_reference',
    version: 1,
    sourceType: 'knowledge_document',
    sourceId: 'sin-cuchillo-brand-rules.md',
    scope: 'mas_instance',
    ownerId: 'sin-cuchillo',
    path: 'memory/knowledge/sin-cuchillo-brand-rules.md',
    origin: 'imported_document',
    sensitivityLevel: 'internal',
    createdAt: VALID_CREATED_AT,
    contentSha256: VALID_SHA_256,
    ...overrides,
  };
}

function buildSection(overrides = {}) {
  return {
    sectionId: 'brand-context',
    sectionType: 'domain_knowledge',
    title: 'Brand Context',
    content: 'Sin Cuchillo uses a warm, precise, and premium brand voice.',
    inclusionReason: 'Brand voice is relevant to the current customer-facing task.',
    sourceReferences: [buildSourceReference()],
    memoryRecordIds: ['mem_brand_rules'],
    visibilityChecked: true,
    authorityLevel: 'mas_guidance',
    priority: 30,
    estimatedTokens: 18,
    warnings: [],
    ...overrides,
  };
}

function buildContextPack(overrides = {}) {
  return {
    kind: 'context_pack',
    version: 1,
    contextPackId: 'ctx_maria_complaint_001',
    invocationId: 'invocation-001',
    operationalIdentityId: 'maria',
    primaryCognitiveIdentityId: 'community-manager',
    secondaryCognitiveIdentityIds: ['copywriter-senior'],
    sections: [
      buildSection({
        sectionId: 'invocation-summary',
        sectionType: 'invocation_summary',
        title: 'Invocation Summary',
        content: 'Maria is answering a customer complaint for Sin Cuchillo.',
        inclusionReason: 'The active invocation facts anchor the context pack.',
        memoryRecordIds: [],
        authorityLevel: 'runtime_evidence',
        priority: 10,
        estimatedTokens: 14,
      }),
      buildSection(),
      buildSection({
        sectionId: 'policy-context',
        sectionType: 'policy_context',
        title: 'Complaint Policy',
        content: 'Serious complaints must be handled calmly and escalated when needed.',
        inclusionReason: 'Complaint handling policy overrides persona preferences.',
        sourceReferences: [
          buildSourceReference({
            sourceType: 'policy_document',
            sourceId: 'complaint-policy.md',
            path: 'memory/policies/complaint-policy.md',
          }),
        ],
        memoryRecordIds: ['mem_complaint_policy'],
        authorityLevel: 'policy',
        priority: 40,
        estimatedTokens: 16,
      }),
    ],
    sourceReferences: [
      buildSourceReference(),
      buildSourceReference({
        sourceType: 'policy_document',
        sourceId: 'complaint-policy.md',
        path: 'memory/policies/complaint-policy.md',
      }),
    ],
    omittedSources: [
      {
        sourceId: 'runtime-artifacts',
        decisionType: 'budget_omission',
        reason: 'Artifact references were less relevant than active policy context.',
        memoryRecordIds: ['mem_old_report'],
        sourceReferences: [
          buildSourceReference({
            sourceType: 'artifact',
            sourceId: 'old-report.md',
            path: 'memory/artifacts/old-report.md',
          }),
        ],
        warnings: [],
      },
    ],
    rejectedSources: [
      {
        sourceId: 'juan-private-memory',
        decisionType: 'permission_rejection',
        reason: 'Maria is not authorized to use Juan private operational memory.',
        memoryRecordIds: ['mem_juan_private_note'],
        sourceReferences: [],
        warnings: ['Private operational identity memory was rejected.'],
      },
    ],
    budget: {
      estimatedTokens: 48,
      maxTokens: 1200,
    },
    eligibilitySummary: {
      includedMemoryRecords: 3,
      omittedMemoryRecords: 1,
      rejectedMemoryRecords: 1,
    },
    warnings: [],
    ...overrides,
  };
}

test('assertContextPack accepts a valid governed context pack', () => {
  const contextPack = assertContextPack(buildContextPack({
    contextPackId: ' ctx_maria_complaint_001 ',
    operationalIdentityId: ' maria ',
  }));

  assert.equal(contextPack.kind, 'context_pack');
  assert.equal(contextPack.contextPackId, 'ctx_maria_complaint_001');
  assert.equal(contextPack.operationalIdentityId, 'maria');
  assert.equal(contextPack.sections.length, 3);
  assert.equal(contextPack.sections[0].sectionId, 'invocation-summary');
  assert.equal(contextPack.sections[2].authorityLevel, 'policy');
  assert.equal(contextPack.omittedSources.length, 1);
  assert.equal(contextPack.rejectedSources.length, 1);
});

test('assertContextPackSection accepts all initial section types', () => {
  const sectionTypes = [
    'invocation_summary',
    'recent_activity_summary',
    'durable_decisions',
    'relevant_artifacts',
    'domain_knowledge',
    'cognitive_identity_memory',
    'operational_identity_memory',
    'policy_context',
    'task_state',
    'workflow_context',
    'relationship_context',
    'resource_context',
    'human_preferences',
    'evaluation_context',
    'open_questions',
    'risk_notes',
  ];

  const sections = sectionTypes.map((sectionType, index) => {
    return assertContextPackSection(buildSection({
      sectionId: `section-${index}`,
      sectionType,
      priority: index,
    }));
  });

  assert.equal(sections.length, sectionTypes.length);
  assert.equal(sections[0].sectionType, 'invocation_summary');
  assert.equal(sections[15].sectionType, 'risk_notes');
});

test('assertContextPackSection rejects missing inclusion reasons', () => {
  assert.throws(
    () => assertContextPackSection(buildSection({ inclusionReason: '   ' })),
    /must include a non-empty inclusionReason/,
  );
});

test('assertContextPackSection rejects invalid section types', () => {
  assert.throws(
    () => assertContextPackSection(buildSection({ sectionType: 'raw_history_dump' })),
    /sectionType is invalid/,
  );
});

test('assertContextPack rejects invalid token budgets', () => {
  assert.throws(
    () => assertContextPack(buildContextPack({
      budget: {
        estimatedTokens: -1,
        maxTokens: 1200,
      },
    })),
    /estimatedTokens must be a non-negative integer/,
  );

  assert.throws(
    () => assertContextPack(buildContextPack({
      budget: {
        estimatedTokens: 1300,
        maxTokens: 1200,
      },
    })),
    /estimatedTokens must not exceed maxTokens/,
  );
});

test('assertContextPack rejects invalid source references', () => {
  assert.throws(
    () => assertContextPack(buildContextPack({
      sourceReferences: [
        buildSourceReference({
          sourceType: 'not_real',
        }),
      ],
    })),
    /sourceType is invalid/,
  );
});

test('assertContextPackSection rejects sections without visibility validation', () => {
  assert.throws(
    () => assertContextPackSection(buildSection({ visibilityChecked: false })),
    /must include visibilityChecked: true/,
  );
});

test('assertContextPack accepts omitted and rejected source explanations', () => {
  const contextPack = assertContextPack(buildContextPack({
    omittedSources: [
      {
        sourceId: 'stale-state',
        decisionType: 'stale_source',
        reason: 'Stale runtime state was omitted from normal context.',
        memoryRecordIds: ['mem_stale_state'],
        sourceReferences: [],
        warnings: ['Stale source omitted.'],
      },
    ],
    rejectedSources: [
      {
        sourceId: 'private-note',
        decisionType: 'sensitivity_rejection',
        reason: 'Restricted private note failed sensitivity checks.',
        memoryRecordIds: ['mem_private_note'],
        sourceReferences: [],
        warnings: [],
      },
    ],
  }));

  assert.equal(contextPack.omittedSources[0].decisionType, 'stale_source');
  assert.equal(contextPack.rejectedSources[0].decisionType, 'sensitivity_rejection');
});

test('assertContextPack rejects omitted and rejected source entries without reasons', () => {
  assert.throws(
    () => assertContextPack(buildContextPack({
      omittedSources: [
        {
          sourceId: 'runtime-state',
          decisionType: 'budget_omission',
          reason: '',
        },
      ],
    })),
    /omittedSources\[0\] must include a non-empty reason/,
  );

  assert.throws(
    () => assertContextPack(buildContextPack({
      rejectedSources: [
        {
          sourceId: 'private-memory',
          decisionType: 'permission_rejection',
          reason: '',
        },
      ],
    })),
    /rejectedSources\[0\] must include a non-empty reason/,
  );
});

test('assertContextPack validates deterministic section ordering', () => {
  assert.throws(
    () => assertContextPack(buildContextPack({
      sections: [
        buildSection({
          sectionId: 'later',
          priority: 50,
        }),
        buildSection({
          sectionId: 'earlier',
          priority: 10,
        }),
      ],
    })),
    /sections must be ordered by ascending priority/,
  );

  assert.throws(
    () => assertContextPack(buildContextPack({
      sections: [
        buildSection({
          sectionId: 'z-section',
          priority: 10,
        }),
        buildSection({
          sectionId: 'a-section',
          priority: 10,
        }),
      ],
    })),
    /same priority must be ordered by sectionId/,
  );
});

test('assertContextPack rejects duplicate section IDs and duplicate memory record IDs', () => {
  assert.throws(
    () => assertContextPack(buildContextPack({
      sections: [
        buildSection({
          sectionId: 'duplicate',
          priority: 10,
        }),
        buildSection({
          sectionId: 'duplicate',
          priority: 20,
        }),
      ],
    })),
    /duplicated sectionId/,
  );

  assert.throws(
    () => assertContextPackSection(buildSection({
      memoryRecordIds: ['mem_1', 'mem_1'],
    })),
    /duplicated value: mem_1/,
  );
});
