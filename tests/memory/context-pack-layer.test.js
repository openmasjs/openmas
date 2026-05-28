import test from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregateContextPackWarnings,
  buildContextPackLayer,
} from '../../src/brain/build-context-pack-layer.js';

const VALID_CREATED_AT = '2026-04-14T00:00:00.000Z';
const VALID_SHA_256 = 'd'.repeat(64);

function buildSourceReference(overrides = {}) {
  return {
    kind: 'memory_source_reference',
    version: 1,
    sourceType: 'knowledge_document',
    sourceId: 'brand-rules.md',
    scope: 'mas_instance',
    ownerId: 'sin-cuchillo',
    path: 'memory/knowledge/brand-rules.md',
    origin: 'imported_document',
    sensitivityLevel: 'internal',
    createdAt: VALID_CREATED_AT,
    contentSha256: VALID_SHA_256,
    ...overrides,
  };
}

function buildDurableSourceReference(memoryRecordId, path) {
  return buildSourceReference({
    sourceType: 'durable_memory_record',
    sourceId: memoryRecordId,
    path,
    origin: 'system_generated',
  });
}

function buildContextPack(overrides = {}) {
  return {
    kind: 'context_pack',
    version: 1,
    contextPackId: 'context-pack-maria-001',
    invocationId: 'invocation-001',
    operationalIdentityId: 'maria',
    primaryCognitiveIdentityId: 'community-manager',
    secondaryCognitiveIdentityIds: ['copywriter-senior'],
    sections: [
      {
        sectionId: 'invocation-summary',
        sectionType: 'invocation_summary',
        title: 'Invocation Summary',
        content: 'Maria is answering a customer complaint.',
        inclusionReason: 'Invocation facts anchor the context pack.',
        sourceReferences: [],
        memoryRecordIds: [],
        visibilityChecked: true,
        authorityLevel: 'runtime_evidence',
        priority: 10,
        estimatedTokens: 9,
        warnings: [],
      },
      {
        sectionId: 'domain-knowledge',
        sectionType: 'domain_knowledge',
        title: 'Domain Knowledge',
        content: 'Sin Cuchillo uses a warm and precise brand voice.',
        inclusionReason: 'Brand voice is relevant to customer-facing response quality.',
        sourceReferences: [buildSourceReference()],
        memoryRecordIds: ['mem_brand_rules'],
        visibilityChecked: true,
        authorityLevel: 'mas_guidance',
        priority: 60,
        estimatedTokens: 13,
        warnings: [],
      },
    ],
    sourceReferences: [buildSourceReference()],
    omittedSources: [
      {
        sourceId: 'old-report.md',
        decisionType: 'budget_omission',
        reason: 'Old report was less relevant than active brand rules.',
        memoryRecordIds: ['mem_old_report'],
        sourceReferences: [],
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
      estimatedTokens: 22,
      maxTokens: 1200,
    },
    eligibilitySummary: {
      includedMemoryRecords: 1,
      omittedMemoryRecords: 1,
      rejectedMemoryRecords: 1,
    },
    warnings: ['Context pack warning example.'],
    ...overrides,
  };
}

test('buildContextPackLayer converts a valid context pack into an instruction layer', () => {
  const layer = buildContextPackLayer({
    contextPack: buildContextPack(),
  });

  assert.equal(layer.kind, 'instruction_layer');
  assert.equal(layer.layerId, 'context-pack');
  assert.equal(layer.layerType, 'context_pack');
  assert.equal(layer.owner, 'memory-and-context-factory');
  assert.equal(layer.priority, 80);
  assert.equal(layer.sourceReferences[0].sourceType, 'context_pack');
  assert.equal(layer.sourceReferences[0].sourceId, 'context-pack-maria-001');
  assert.equal(layer.sourceReferences[1].path, 'memory/knowledge/brand-rules.md');
  assert.match(layer.content, /The Context Pack is internal runtime support/u);
  assert.match(layer.content, /Do not output a "Context Pack Summary"/u);
  assert.match(layer.content, /Never say that a fresh tool result, inspection, workflow run, or runtime action exists unless/u);
  assert.match(layer.content, /Context Pack ID: context-pack-maria-001/);
  assert.match(layer.content, /Curated Context Sections/);
  assert.match(layer.content, /Sin Cuchillo uses a warm and precise brand voice/);
  assert.match(layer.content, /Omitted Context Sources/);
  assert.match(layer.content, /Rejected Context Sources/);
  assert.match(layer.content, /Maria is not authorized to use Juan private operational memory/);
  assert.match(layer.summary, /1 included memory records/);
  assert.deepEqual(layer.warnings, ['Context pack warning example.']);
});

test('buildContextPackLayer preserves provenance without requiring raw memory outside curated sections', () => {
  const layer = buildContextPackLayer({
    contextPack: buildContextPack({
      sourceReferences: [
        buildSourceReference({
          sourceType: 'policy_document',
          sourceId: 'complaints.md',
          path: 'memory/policies/complaints.md',
        }),
      ],
      sections: [
        {
          ...buildContextPack().sections[0],
        },
      ],
    }),
  });

  assert.equal(layer.sourceReferences.length, 2);
  assert.equal(layer.sourceReferences[1].sourceType, 'policy_document');
  assert.equal(layer.sourceReferences[1].sourceId, 'complaints.md');
  assert.doesNotMatch(layer.content, /RAW_PROVIDER_OUTPUT/);
  assert.doesNotMatch(layer.content, /SECRET_VALUE/);
});

test('buildContextPackLayer summarizes durable memory provenance counts', () => {
  const includedDurableSource = buildDurableSourceReference(
    'mem_active_durable',
    'memory/durable/memory-record-mem_active_durable.json',
  );
  const omittedDurableSource = buildDurableSourceReference(
    'mem_stale_durable',
    'memory/durable/memory-record-mem_stale_durable.json',
  );
  const rejectedDurableSource = buildDurableSourceReference(
    'mem_restricted_durable',
    'memory/durable/memory-record-mem_restricted_durable.json',
  );
  const layer = buildContextPackLayer({
    contextPack: buildContextPack({
      sections: [
        buildContextPack().sections[0],
        {
          sectionId: 'durable-decisions',
          sectionType: 'durable_decisions',
          title: 'Durable Decisions',
          content: 'Approved durable decision summary.',
          inclusionReason: 'Approved durable decisions can shape this invocation.',
          sourceReferences: [includedDurableSource],
          memoryRecordIds: ['mem_active_durable'],
          visibilityChecked: true,
          authorityLevel: 'mas_guidance',
          priority: 25,
          estimatedTokens: 12,
          warnings: [],
        },
      ],
      sourceReferences: [includedDurableSource],
      omittedSources: [
        {
          sourceId: 'mem_stale_durable',
          decisionType: 'stale_source',
          reason: 'Stale durable memory was omitted by default.',
          memoryRecordIds: ['mem_stale_durable'],
          sourceReferences: [omittedDurableSource],
          warnings: ['Stale memory omitted: mem_stale_durable'],
        },
      ],
      rejectedSources: [
        {
          sourceId: 'mem_restricted_durable',
          decisionType: 'sensitivity_rejection',
          reason: 'Restricted durable memory was rejected.',
          memoryRecordIds: ['mem_restricted_durable'],
          sourceReferences: [rejectedDurableSource],
          warnings: [],
        },
      ],
      eligibilitySummary: {
        includedMemoryRecords: 1,
        omittedMemoryRecords: 1,
        rejectedMemoryRecords: 1,
      },
    }),
  });

  assert.match(
    layer.summary,
    /Durable memory provenance: 1 included, 1 omitted, 1 rejected durable source references\./,
  );
  assert.equal(layer.sourceReferences.some((sourceReference) => {
    return sourceReference.path === 'memory/durable/memory-record-mem_active_durable.json';
  }), true);
});

test('buildContextPackLayer adds a recall guard when conversation context is present', () => {
  const layer = buildContextPackLayer({
    contextPack: buildContextPack({
      sections: [
        buildContextPack().sections[0],
        {
          sectionId: 'conversation-context',
          sectionType: 'conversation_context',
          title: 'Conversation Context',
          content: 'Turn 5 | Role: human | Text: My name is Miguel.',
          inclusionReason: 'Selected conversation context preserves continuity.',
          sourceReferences: [
            buildSourceReference({
              sourceType: 'conversation_session',
              sourceId: 'alfred-admin',
              path: 'memory/state/conversations/alfred-admin/session.json',
              origin: 'runtime_observed',
            }),
            buildSourceReference({
              sourceType: 'conversation_turn',
              sourceId: 'turn-alfred-admin-000005',
              path: 'memory/state/conversations/alfred-admin/turns.json',
              origin: 'runtime_observed',
            }),
          ],
          memoryRecordIds: ['mem_conversation_alfred_admin'],
          visibilityChecked: true,
          authorityLevel: 'runtime_evidence',
          priority: 75,
          estimatedTokens: 16,
          warnings: [],
        },
      ],
      sourceReferences: [
        buildSourceReference({
          sourceType: 'conversation_session',
          sourceId: 'alfred-admin',
          path: 'memory/state/conversations/alfred-admin/session.json',
          origin: 'runtime_observed',
        }),
        buildSourceReference({
          sourceType: 'conversation_turn',
          sourceId: 'turn-alfred-admin-000005',
          path: 'memory/state/conversations/alfred-admin/turns.json',
          origin: 'runtime_observed',
        }),
      ],
      eligibilitySummary: {
        includedMemoryRecords: 1,
        omittedMemoryRecords: 0,
        rejectedMemoryRecords: 0,
      },
    }),
  });

  assert.match(layer.content, /Conversation Memory Recall Guard/u);
  assert.match(layer.content, /Selected Conversation IDs: alfred-admin/u);
  assert.match(layer.content, /accessible runtime memory/u);
  assert.match(layer.content, /Do not claim that no memory, no context, or no prior conversation is available/u);
  assert.match(layer.content, /Do not let an older assistant denial override/u);
  assert.match(layer.content, /My name is Miguel/u);
});

test('aggregateContextPackWarnings leaves small warning sets unchanged', () => {
  const warnings = [
    'Context pack warning example.',
    'Another warning.',
  ];

  assert.deepEqual(aggregateContextPackWarnings(warnings), warnings);
});

test('buildContextPackLayer aggregates repetitive context warnings for prompt-facing output', () => {
  const warnings = [
    'Memory source runtime-state skipped oversized file agent-invocation-001.json: 40000 bytes exceeds 32768.',
    'Memory source runtime-state skipped oversized file agent-invocation-002.json: 41000 bytes exceeds 32768.',
    'Memory source runtime-state skipped oversized file agent-invocation-003.json: 42000 bytes exceeds 32768.',
    'Memory source runtime-state skipped oversized file agent-invocation-004.json: 43000 bytes exceeds 32768.',
    'Memory source runtime-state omitted file due to maxFiles limit: boot-session-001.json',
    'Memory source runtime-state omitted file due to maxFiles limit: boot-session-002.json',
    'Memory source runtime-state omitted file due to maxFiles limit: boot-session-003.json',
    'Memory source runtime-state skipped non-file entry: conversations',
    'Memory source runtime-artifacts skipped oversized file probabilistic-brain-invocation-001.md: 50000 bytes exceeds 32768.',
    'Memory source runtime-artifacts skipped oversized file probabilistic-brain-invocation-002.md: 52000 bytes exceeds 32768.',
  ];
  const layer = buildContextPackLayer({
    contextPack: buildContextPack({
      warnings,
    }),
  });

  assert.equal(layer.warnings.length, 5);
  assert.match(layer.warnings[0], /10 raw warnings collapsed into 4 warning groups/u);
  assert.match(layer.warnings[1], /runtime-state skipped oversized files/u);
  assert.match(layer.warnings[1], /Count: 4/u);
  assert.match(layer.warnings[1], /agent-invocation-001\.json, agent-invocation-002\.json, agent-invocation-003\.json/u);
  assert.doesNotMatch(layer.warnings.join('\n'), /agent-invocation-004\.json/u);
  assert.match(layer.content, /Context Pack warning aggregation/u);
  assert.match(layer.content, /runtime-state omitted files after reaching its maxFiles limit/u);
});
