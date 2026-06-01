import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdir, mkdtemp, utimes, writeFile } from 'node:fs/promises';
import { assertMemoryRecord } from '../../src/contracts/memory/memory-record-contract.js';
import { buildContextPackForInvocation } from '../../src/context/build-context-pack-for-invocation.js';
import { estimateContextTokens } from '../../src/context/summarize-memory-record-for-context.js';
import { createDurableMemoryRecordFileName } from '../../src/memory/write-durable-memory-record.js';

const VALID_CREATED_AT = '2026-04-14T00:00:00.000Z';
const VALID_SHA_256 = 'c'.repeat(64);

async function createTemporaryMasRoot() {
  const temporaryRootPath = await mkdtemp(path.join(os.tmpdir(), 'openmas-context-pack-'));
  const masRootPath = path.join(temporaryRootPath, 'instance');

  await mkdir(path.join(masRootPath, 'memory', 'state'), { recursive: true });
  await mkdir(path.join(masRootPath, 'memory', 'artifacts'), { recursive: true });
  await mkdir(path.join(masRootPath, 'memory', 'knowledge'), { recursive: true });
  await mkdir(path.join(masRootPath, 'memory', 'policies'), { recursive: true });

  return masRootPath;
}

async function writeJsonFile(filePath, payload, modifiedAt) {
  await writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8');

  if (modifiedAt) {
    await utimes(filePath, modifiedAt, modifiedAt);
  }
}

async function writeTextFile(filePath, content, modifiedAt) {
  await writeFile(filePath, content, 'utf8');

  if (modifiedAt) {
    await utimes(filePath, modifiedAt, modifiedAt);
  }
}

async function writeDurableMemoryRecordFile({ masRootPath, memoryRecord }) {
  const durableMemoryRootPath = path.join(masRootPath, 'memory', 'durable');

  await mkdir(durableMemoryRootPath, { recursive: true });
  await writeJsonFile(
    path.join(durableMemoryRootPath, createDurableMemoryRecordFileName(memoryRecord.memoryRecordId)),
    memoryRecord,
  );
}

function buildReadiness(overrides = {}) {
  return {
    status: 'ready',
    resolvedPrimaryCognitiveIdentityId: 'community-manager',
    operationalIdentityDefinition: {
      operationalIdentityId: 'maria',
      displayName: 'Maria',
    },
    activeCognitiveSet: {
      primaryCognitiveIdentityId: 'community-manager',
      secondaryCognitiveIdentityIds: ['copywriter-senior'],
    },
    brainSelection: {
      selectedBrain: {
        brainId: 'openrouter-primary',
        providerId: 'openrouter-api',
        modelId: 'openrouter/free',
      },
      fallbackBrain: {
        brainId: 'gemini-fallback',
        providerId: 'gemini-api',
        modelId: 'gemini-flash-latest',
      },
    },
    usableBindings: [],
    ...overrides,
  };
}

function buildRequest(overrides = {}) {
  return {
    operationalIdentityId: 'maria',
    invocationMode: 'probabilistic',
    command: 'ask',
    requestedBy: 'human-admin',
    inputText: 'Help me answer a customer.',
    ...overrides,
  };
}

function buildSourceDefinition(overrides = {}) {
  return {
    sourceId: 'knowledge',
    sourceType: 'knowledge_directory',
    rootPath: 'memory/knowledge',
    scope: 'mas_instance',
    ownerId: 'sin-cuchillo',
    defaultPortability: 'not_exportable',
    defaultVisibility: 'shared_with_mas',
    defaultSensitivityLevel: 'internal',
    lifecycleState: 'active',
    readPolicy: {
      maxFiles: 10,
      maxBytesPerFile: 8192,
    },
    ...overrides,
  };
}

function buildMemorySourceRegistry(memorySources) {
  return {
    kind: 'memory_source_registry',
    version: 1,
    memorySources,
  };
}

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
    memoryRecordId: 'mem_001',
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
    summary: 'Sin Cuchillo serves premium meat products.',
    content: 'Sin Cuchillo serves premium meat products with a warm brand voice.',
    sourceReferences: [buildSourceReference()],
    subjectReferences: [
      {
        subjectType: 'mas_instance',
        subjectId: 'sin-cuchillo',
        relationship: 'memory-owner',
      },
    ],
    retention: {
      retentionPolicyId: null,
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

test('buildContextPackForInvocation builds invocation summary and non-secret resource context', async () => {
  const contextPack = await buildContextPackForInvocation({
    bootResult: {
      status: 'ready',
      masRootPath: 'not-used-with-memory-collection',
    },
    readiness: buildReadiness({
      usableBindings: [
        {
          resourceId: 'gemini-brain',
          resourceType: 'brain-provider',
          resourceDisplayName: 'Gemini Brain',
          accessMode: 'execute',
          ownershipScope: 'shared',
          resourceLifecycleState: 'active',
          credentialReferenceId: 'gemini-api-key',
        },
      ],
    }),
    request: buildRequest(),
    invocationId: 'invocation-001',
    memoryCollection: {
      memoryRecords: [],
      warnings: [],
    },
  });

  assert.equal(contextPack.kind, 'context_pack');
  assert.equal(contextPack.sections[0].sectionType, 'invocation_summary');
  assert.equal(contextPack.sections[0].content.includes('Selected Brain: openrouter-api/openrouter/free'), true);

  const resourceSection = contextPack.sections.find((section) => section.sectionType === 'resource_context');

  assert.ok(resourceSection);
  assert.equal(resourceSection.content.includes('Gemini Brain'), true);
  assert.equal(resourceSection.content.includes('gemini-api-key'), false);
  assert.equal(contextPack.eligibilitySummary.includedMemoryRecords, 0);
});

test('buildContextPackForInvocation includes bounded state, artifacts, knowledge, and policy context', async () => {
  const masRootPath = await createTemporaryMasRoot();

  await writeJsonFile(
    path.join(masRootPath, 'memory', 'state', 'agent-invocation-001.json'),
    {
      kind: 'agent_invocation_session',
      invocationId: 'previous-invocation',
      operationalIdentityId: 'maria',
      primaryCognitiveIdentityId: 'community-manager',
      executionType: 'probabilistic_brain',
      request: {
        command: 'ask',
        invocationMode: 'probabilistic',
      },
      readinessStatus: 'ready',
      message: 'Maria handled a customer complaint calmly.',
      brainOutput: {
        outputText: 'RAW_PROVIDER_OUTPUT_MUST_NOT_LEAK',
      },
      startedAt: '2026-04-14T10:00:00.000Z',
      finishedAt: '2026-04-14T10:00:01.000Z',
    },
    new Date('2026-04-14T10:00:00.000Z'),
  );
  await writeTextFile(
    path.join(masRootPath, 'memory', 'artifacts', 'complaint-report.md'),
    '# Complaint Report\n\nRAW_ARTIFACT_BODY_MUST_NOT_LEAK',
    new Date('2026-04-14T10:01:00.000Z'),
  );
  await writeTextFile(
    path.join(masRootPath, 'memory', 'knowledge', 'brand-rules.md'),
    '# Brand Rules\n\nSin Cuchillo uses a warm and precise brand voice.',
  );
  await writeTextFile(
    path.join(masRootPath, 'memory', 'policies', 'complaints.md'),
    '# Complaint Policy\n\nSerious complaints must be answered calmly.',
  );

  const contextPack = await buildContextPackForInvocation({
    bootResult: {
      status: 'ready',
      masRootPath,
    },
    readiness: buildReadiness(),
    request: buildRequest(),
    invocationId: 'invocation-002',
    memorySourceRegistry: buildMemorySourceRegistry([
      buildSourceDefinition({
        sourceId: 'runtime-state',
        sourceType: 'state_directory',
        rootPath: 'memory/state',
        defaultVisibility: 'restricted',
      }),
      buildSourceDefinition({
        sourceId: 'runtime-artifacts',
        sourceType: 'artifacts_directory',
        rootPath: 'memory/artifacts',
        defaultVisibility: 'restricted',
      }),
      buildSourceDefinition(),
      buildSourceDefinition({
        sourceId: 'policies',
        sourceType: 'policies_directory',
        rootPath: 'memory/policies',
      }),
    ]),
  });

  const sectionTypes = contextPack.sections.map((section) => section.sectionType);
  const fullContent = contextPack.sections.map((section) => section.content).join('\n');

  assert.equal(sectionTypes.includes('recent_activity_summary'), true);
  assert.equal(sectionTypes.includes('relevant_artifacts'), true);
  assert.equal(sectionTypes.includes('domain_knowledge'), true);
  assert.equal(sectionTypes.includes('policy_context'), true);
  assert.equal(fullContent.includes('Sin Cuchillo uses a warm and precise brand voice'), true);
  assert.equal(fullContent.includes('Serious complaints must be answered calmly'), true);
  assert.equal(fullContent.includes('RAW_PROVIDER_OUTPUT_MUST_NOT_LEAK'), false);
  assert.equal(fullContent.includes('RAW_ARTIFACT_BODY_MUST_NOT_LEAK'), false);
  assert.equal(contextPack.sourceReferences.length, 4);
});

test('buildContextPackForInvocation includes only active cognitive and operational identity memory', async () => {
  const masRootPath = await createTemporaryMasRoot();

  await mkdir(path.join(masRootPath, 'cognitive-identities', 'marketing-and-sales', 'community-manager', 'memory'), { recursive: true });
  await mkdir(path.join(masRootPath, 'cognitive-identities', 'marketing-and-sales', 'copywriter-senior', 'memory'), { recursive: true });
  await mkdir(path.join(masRootPath, 'cognitive-identities', 'marketing-and-sales', 'media-buyer', 'memory'), { recursive: true });
  await mkdir(path.join(masRootPath, 'cognitive-identities', 'marketing-and-sales', 'community-manager', 'project-memory'), { recursive: true });
  await mkdir(path.join(masRootPath, 'operational-identities', 'maria', 'memory'), { recursive: true });
  await mkdir(path.join(masRootPath, 'operational-identities', 'juan', 'memory'), { recursive: true });

  await writeTextFile(
    path.join(masRootPath, 'cognitive-identities', 'marketing-and-sales', 'community-manager', 'memory', 'complaints.md'),
    'Community managers should acknowledge complaints before offering solutions.',
  );
  await writeTextFile(
    path.join(masRootPath, 'cognitive-identities', 'marketing-and-sales', 'copywriter-senior', 'memory', 'hooks.md'),
    'Copywriters should keep customer-facing hooks clear and concise.',
  );
  await writeTextFile(
    path.join(masRootPath, 'cognitive-identities', 'marketing-and-sales', 'media-buyer', 'memory', 'budgets.md'),
    'MEDIA_BUYER_MEMORY_MUST_NOT_LEAK',
  );
  await writeTextFile(
    path.join(masRootPath, 'cognitive-identities', 'marketing-and-sales', 'community-manager', 'project-memory', 'mas-bound.md'),
    'MAS_BOUND_COGNITIVE_MEMORY_MUST_NOT_LEAK',
  );
  await writeTextFile(
    path.join(masRootPath, 'operational-identities', 'maria', 'memory', 'relationship-note.md'),
    'Maria remembers that Carlos prefers concise community updates.',
  );
  await writeTextFile(
    path.join(masRootPath, 'operational-identities', 'juan', 'memory', 'private-note.md'),
    'JUAN_PRIVATE_MEMORY_MUST_NOT_LEAK',
  );

  const contextPack = await buildContextPackForInvocation({
    bootResult: {
      status: 'ready',
      masRootPath,
    },
    readiness: buildReadiness(),
    request: buildRequest(),
    invocationId: 'invocation-003',
    memorySourceRegistry: buildMemorySourceRegistry([
      buildSourceDefinition({
        sourceId: 'community-manager-memory',
        sourceType: 'cognitive_identity_memory_directory',
        rootPath: 'cognitive-identities/marketing-and-sales/community-manager/memory',
        scope: 'cognitive_identity',
        ownerId: 'community-manager',
        defaultPortability: 'portable',
      }),
      buildSourceDefinition({
        sourceId: 'copywriter-senior-memory',
        sourceType: 'cognitive_identity_memory_directory',
        rootPath: 'cognitive-identities/marketing-and-sales/copywriter-senior/memory',
        scope: 'cognitive_identity',
        ownerId: 'copywriter-senior',
        defaultPortability: 'portable',
      }),
      buildSourceDefinition({
        sourceId: 'media-buyer-memory',
        sourceType: 'cognitive_identity_memory_directory',
        rootPath: 'cognitive-identities/marketing-and-sales/media-buyer/memory',
        scope: 'cognitive_identity',
        ownerId: 'media-buyer',
        defaultPortability: 'portable',
      }),
      buildSourceDefinition({
        sourceId: 'community-manager-mas-bound-memory',
        sourceType: 'cognitive_identity_memory_directory',
        rootPath: 'cognitive-identities/marketing-and-sales/community-manager/project-memory',
        scope: 'cognitive_identity',
        ownerId: 'community-manager',
        defaultPortability: 'mas_bound',
      }),
      buildSourceDefinition({
        sourceId: 'maria-memory',
        sourceType: 'operational_identity_memory_directory',
        rootPath: 'operational-identities/maria/memory',
        scope: 'operational_identity',
        ownerId: 'maria',
        defaultPortability: 'mas_bound',
        defaultVisibility: 'private_to_owner',
      }),
      buildSourceDefinition({
        sourceId: 'juan-memory',
        sourceType: 'operational_identity_memory_directory',
        rootPath: 'operational-identities/juan/memory',
        scope: 'operational_identity',
        ownerId: 'juan',
        defaultPortability: 'mas_bound',
        defaultVisibility: 'private_to_owner',
      }),
    ]),
  });

  const fullContent = contextPack.sections.map((section) => section.content).join('\n');
  const cognitiveSection = contextPack.sections.find((section) => section.sectionType === 'cognitive_identity_memory');
  const operationalSection = contextPack.sections.find((section) => section.sectionType === 'operational_identity_memory');

  assert.ok(cognitiveSection);
  assert.ok(operationalSection);
  assert.equal(fullContent.includes('Community managers should acknowledge complaints'), true);
  assert.equal(fullContent.includes('Copywriters should keep customer-facing hooks'), true);
  assert.equal(fullContent.includes('Maria remembers that Carlos prefers concise'), true);
  assert.equal(fullContent.includes('MEDIA_BUYER_MEMORY_MUST_NOT_LEAK'), false);
  assert.equal(fullContent.includes('MAS_BOUND_COGNITIVE_MEMORY_MUST_NOT_LEAK'), false);
  assert.equal(fullContent.includes('JUAN_PRIVATE_MEMORY_MUST_NOT_LEAK'), false);
  assert.equal(contextPack.rejectedSources.some((decision) => decision.reason.includes('media-buyer')), true);
  assert.equal(contextPack.rejectedSources.some((decision) => decision.reason.includes('not portable')), true);
  assert.equal(contextPack.rejectedSources.some((decision) => decision.reason.includes('juan')), true);
});

test('buildContextPackForInvocation omits stale, superseded, and budgeted memory with reasons', async () => {
  const activePolicy = buildMemoryRecord({
    memoryRecordId: 'mem_policy',
    memoryType: 'policy_context',
    authorityLevel: 'policy',
    summary: 'Complaint policy is active.',
    content: 'Serious complaints must be escalated when they include legal or safety risk.',
    sourceReferences: [
      buildSourceReference({
        sourceType: 'policy_document',
        sourceId: 'complaints.md',
        path: 'memory/policies/complaints.md',
      }),
    ],
  });
  const activeKnowledge = buildMemoryRecord({
    memoryRecordId: 'mem_domain',
    summary: 'Detailed brand knowledge is available.',
    content: 'Brand knowledge '.repeat(120),
    sourceReferences: [
      buildSourceReference({
        sourceId: 'brand.md',
        path: 'memory/knowledge/brand.md',
      }),
    ],
  });
  const staleKnowledge = buildMemoryRecord({
    memoryRecordId: 'mem_stale',
    lifecycleStatus: 'stale',
    summary: 'Old campaign language is stale.',
    content: 'Old campaign language should not be used.',
    sourceReferences: [
      buildSourceReference({
        sourceId: 'old-campaign.md',
        path: 'memory/knowledge/old-campaign.md',
      }),
    ],
  });
  const supersededKnowledge = buildMemoryRecord({
    memoryRecordId: 'mem_superseded',
    lifecycleStatus: 'superseded',
    summary: 'Superseded tone guidance exists.',
    content: 'This tone guidance has been superseded.',
    sourceReferences: [
      buildSourceReference({
        sourceId: 'old-tone.md',
        path: 'memory/knowledge/old-tone.md',
      }),
    ],
  });

  const contextPack = await buildContextPackForInvocation({
    bootResult: {
      status: 'ready',
      masRootPath: 'not-used-with-memory-collection',
    },
    readiness: buildReadiness(),
    request: buildRequest(),
    invocationId: 'invocation-004',
    maxSections: 2,
    maxEstimatedTokens: 400,
    memoryCollection: {
      memoryRecords: [
        activePolicy,
        activeKnowledge,
        staleKnowledge,
        supersededKnowledge,
      ],
      warnings: ['Memory source knowledge skipped oversized file huge.md: 9000 bytes exceeds 8192.'],
    },
  });

  assert.equal(contextPack.sections.length, 2);
  assert.equal(contextPack.sections[1].sectionType, 'policy_context');
  assert.equal(contextPack.sections.map((section) => section.content).join('\n').includes('Brand knowledge'), false);
  assert.equal(contextPack.omittedSources.some((decision) => decision.decisionType === 'budget_omission'), true);
  assert.equal(contextPack.omittedSources.some((decision) => decision.decisionType === 'stale_source'), true);
  assert.equal(contextPack.omittedSources.some((decision) => decision.decisionType === 'superseded_source'), true);
  assert.equal(contextPack.warnings.some((warning) => warning.includes('oversized file')), true);
  assert.equal(contextPack.warnings.some((warning) => warning.includes('maxSections')), true);
  assert.equal(contextPack.budget.estimatedTokens <= contextPack.budget.maxTokens, true);
});

test('buildContextPackForInvocation respects token limits for optional sections', async () => {
  const invocationOnlyTokens = estimateContextTokens([
    'Invocation ID: invocation-005',
    'Command: ask',
    'Invocation Mode: probabilistic',
    'Requested By: human-admin',
    'Boot Status: ready',
    'Readiness Status: ready',
    'Operational Identity: maria',
    'Operational Display Name: Maria',
    'Primary Cognitive Identity: community-manager',
    'Secondary Cognitive Identities: copywriter-senior',
    'Selected Brain: openrouter-api/openrouter/free',
    'Fallback Brain: gemini-api/gemini-flash-latest',
  ].join('\n'));

  const contextPack = await buildContextPackForInvocation({
    bootResult: {
      status: 'ready',
      masRootPath: 'not-used-with-memory-collection',
    },
    readiness: buildReadiness(),
    request: buildRequest(),
    invocationId: 'invocation-005',
    maxEstimatedTokens: invocationOnlyTokens + 15,
    memoryCollection: {
      memoryRecords: [
        buildMemoryRecord({
          memoryRecordId: 'mem_large_domain',
          content: 'Large context '.repeat(200),
        }),
      ],
      warnings: [],
    },
  });

  assert.equal(contextPack.sections.length, 1);
  assert.equal(contextPack.sections[0].sectionType, 'invocation_summary');
  assert.equal(contextPack.omittedSources[0].decisionType, 'budget_omission');
  assert.equal(contextPack.budget.estimatedTokens <= contextPack.budget.maxTokens, true);
});

test('buildContextPackForInvocation applies eligibility gates to default durable memory', async () => {
  const masRootPath = await createTemporaryMasRoot();
  const now = '2026-04-14T12:00:00.000Z';
  const durableRecords = [
    buildMemoryRecord({
      memoryRecordId: 'mem_active_company_fact',
      memoryType: 'company_fact',
      summary: 'Sin Cuchillo is available as durable company memory.',
      content: 'DURABLE_ACTIVE_COMPANY_FACT_ALLOWED',
    }),
    buildMemoryRecord({
      memoryRecordId: 'mem_durable_decision',
      memoryType: 'durable_decision',
      authorityLevel: 'mas_guidance',
      summary: 'Durable decision says complaint tone must stay calm.',
      content: 'DURABLE_DECISION_ALLOWED',
    }),
    buildMemoryRecord({
      memoryRecordId: 'mem_expired_durable',
      summary: 'Expired durable memory must not be included.',
      content: 'DURABLE_EXPIRED_MUST_NOT_LEAK',
      retention: {
        retentionPolicyId: 'test-expired',
        expiresAt: '2026-04-13T00:00:00.000Z',
        staleAfter: null,
        reviewRequiredAt: null,
      },
    }),
    buildMemoryRecord({
      memoryRecordId: 'mem_stale_durable',
      summary: 'Stale durable memory must not be included by default.',
      content: 'DURABLE_STALE_MUST_NOT_LEAK_BY_DEFAULT',
      retention: {
        retentionPolicyId: 'test-stale',
        expiresAt: null,
        staleAfter: '2026-04-13T00:00:00.000Z',
        reviewRequiredAt: null,
      },
    }),
    buildMemoryRecord({
      memoryRecordId: 'mem_superseded_durable',
      summary: 'Superseded durable memory must not be included.',
      content: 'DURABLE_SUPERSEDED_MUST_NOT_LEAK',
      supersession: {
        supersedesMemoryRecordIds: [],
        supersededByMemoryRecordId: 'mem_superseding_durable',
      },
    }),
    buildMemoryRecord({
      memoryRecordId: 'mem_superseding_durable',
      summary: 'Superseding durable memory is current.',
      content: 'DURABLE_SUPERSEDING_ALLOWED',
      supersession: {
        supersedesMemoryRecordIds: ['mem_superseded_durable'],
        supersededByMemoryRecordId: null,
      },
    }),
    buildMemoryRecord({
      memoryRecordId: 'mem_restricted_durable',
      visibility: 'restricted',
      summary: 'Restricted durable non-runtime memory must be rejected.',
      content: 'DURABLE_RESTRICTED_MUST_NOT_LEAK',
    }),
    buildMemoryRecord({
      memoryRecordId: 'mem_redacted_durable',
      summary: 'Redacted durable memory must be rejected.',
      content: 'DURABLE_REDACTED_MUST_NOT_LEAK',
      privacy: {
        redactionState: 'redacted',
        deletionState: 'active',
        redactedAt: '2026-04-14T08:00:00.000Z',
        deletedAt: null,
        reason: 'Test redaction.',
      },
    }),
    buildMemoryRecord({
      memoryRecordId: 'mem_deleted_durable',
      summary: 'Deleted durable memory must be rejected.',
      content: 'DURABLE_DELETED_MUST_NOT_LEAK',
      privacy: {
        redactionState: 'not_required',
        deletionState: 'deleted',
        redactedAt: null,
        deletedAt: '2026-04-14T08:00:00.000Z',
        reason: 'Test deletion.',
      },
    }),
  ];

  for (const memoryRecord of durableRecords) {
    await writeDurableMemoryRecordFile({ masRootPath, memoryRecord });
  }

  const contextPack = await buildContextPackForInvocation({
    bootResult: {
      status: 'ready',
      masRootPath,
    },
    readiness: buildReadiness(),
    request: buildRequest(),
    invocationId: 'invocation-durable-eligibility',
    now,
  });
  const fullContent = contextPack.sections.map((section) => section.content).join('\n');
  const durableDecisionSection = contextPack.sections.find((section) => {
    return section.sectionType === 'durable_decisions';
  });
  const domainKnowledgeSection = contextPack.sections.find((section) => {
    return section.sectionType === 'domain_knowledge';
  });

  assert.ok(durableDecisionSection);
  assert.ok(domainKnowledgeSection);
  assert.equal(durableDecisionSection.memoryRecordIds.includes('mem_durable_decision'), true);
  assert.equal(domainKnowledgeSection.memoryRecordIds.includes('mem_active_company_fact'), true);
  assert.equal(fullContent.includes('DURABLE_ACTIVE_COMPANY_FACT_ALLOWED'), true);
  assert.equal(fullContent.includes('DURABLE_DECISION_ALLOWED'), true);
  assert.equal(fullContent.includes('DURABLE_SUPERSEDING_ALLOWED'), true);
  assert.equal(fullContent.includes('DURABLE_EXPIRED_MUST_NOT_LEAK'), false);
  assert.equal(fullContent.includes('DURABLE_STALE_MUST_NOT_LEAK_BY_DEFAULT'), false);
  assert.equal(fullContent.includes('DURABLE_SUPERSEDED_MUST_NOT_LEAK'), false);
  assert.equal(fullContent.includes('DURABLE_RESTRICTED_MUST_NOT_LEAK'), false);
  assert.equal(fullContent.includes('DURABLE_REDACTED_MUST_NOT_LEAK'), false);
  assert.equal(fullContent.includes('DURABLE_DELETED_MUST_NOT_LEAK'), false);
  assert.equal(contextPack.omittedSources.some((decision) => {
    return decision.decisionType === 'expired_source' && decision.memoryRecordIds.includes('mem_expired_durable');
  }), true);
  assert.equal(contextPack.omittedSources.some((decision) => {
    return decision.decisionType === 'stale_source' && decision.memoryRecordIds.includes('mem_stale_durable');
  }), true);
  assert.equal(contextPack.omittedSources.some((decision) => {
    return decision.decisionType === 'superseded_source' && decision.memoryRecordIds.includes('mem_superseded_durable');
  }), true);
  assert.equal(contextPack.rejectedSources.some((decision) => {
    return decision.decisionType === 'sensitivity_rejection' && decision.memoryRecordIds.includes('mem_restricted_durable');
  }), true);
  assert.equal(contextPack.rejectedSources.some((decision) => {
    return decision.decisionType === 'privacy_rejection' && decision.memoryRecordIds.includes('mem_redacted_durable');
  }), true);
  assert.equal(contextPack.rejectedSources.some((decision) => {
    return decision.decisionType === 'privacy_rejection' && decision.memoryRecordIds.includes('mem_deleted_durable');
  }), true);
  assert.equal(contextPack.sourceReferences.some((sourceReference) => {
    return (
      sourceReference.sourceType === 'durable_memory_record'
      && sourceReference.path === 'memory/durable/memory-record-mem_active_company_fact.json'
    );
  }), true);
  assert.equal(contextPack.sourceReferences.some((sourceReference) => {
    return (
      sourceReference.sourceType === 'durable_memory_record'
      && sourceReference.path === 'memory/durable/memory-record-mem_durable_decision.json'
    );
  }), true);
});

test('buildContextPackForInvocation omits unapproved durable memory before prompt assembly', async () => {
  const masRootPath = await createTemporaryMasRoot();

  await writeDurableMemoryRecordFile({
    masRootPath,
    memoryRecord: buildMemoryRecord({
      memoryRecordId: 'mem_pending_complaint_candidate',
      memoryType: 'conversation_summary',
      approvalState: 'pending',
      confidence: 'agent_proposed',
      summary: 'Pending complaint summary must wait for approval.',
      content: 'PENDING_COMPLAINT_MEMORY_MUST_NOT_REACH_CONTEXT',
    }),
  });

  const contextPack = await buildContextPackForInvocation({
    bootResult: {
      status: 'ready',
      masRootPath,
    },
    readiness: buildReadiness(),
    request: buildRequest(),
    invocationId: 'invocation-pending-memory-gate',
    now: '2026-04-14T12:00:00.000Z',
  });
  const fullContent = contextPack.sections.map((section) => section.content).join('\n');

  assert.equal(fullContent.includes('PENDING_COMPLAINT_MEMORY_MUST_NOT_REACH_CONTEXT'), false);
  assert.equal(contextPack.omittedSources.some((decision) => {
    return (
      decision.decisionType === 'approval_omission'
      && decision.memoryRecordIds.includes('mem_pending_complaint_candidate')
    );
  }), true);
});

test('buildContextPackForInvocation includes stale durable memory only with explicit option', async () => {
  const masRootPath = await createTemporaryMasRoot();

  await writeDurableMemoryRecordFile({
    masRootPath,
    memoryRecord: buildMemoryRecord({
      memoryRecordId: 'mem_stale_but_allowed',
      summary: 'Stale durable memory can be inspected explicitly.',
      content: 'DURABLE_STALE_ALLOWED_WITH_EXPLICIT_OPTION',
      retention: {
        retentionPolicyId: 'test-stale',
        expiresAt: null,
        staleAfter: '2026-04-13T00:00:00.000Z',
        reviewRequiredAt: null,
      },
    }),
  });

  const defaultContextPack = await buildContextPackForInvocation({
    bootResult: {
      status: 'ready',
      masRootPath,
    },
    readiness: buildReadiness(),
    request: buildRequest(),
    invocationId: 'invocation-stale-durable-default',
    now: '2026-04-14T12:00:00.000Z',
  });
  const explicitContextPack = await buildContextPackForInvocation({
    bootResult: {
      status: 'ready',
      masRootPath,
    },
    readiness: buildReadiness(),
    request: buildRequest(),
    invocationId: 'invocation-stale-durable-explicit',
    now: '2026-04-14T12:00:00.000Z',
    includeStaleMemory: true,
  });
  const defaultContent = defaultContextPack.sections.map((section) => section.content).join('\n');
  const explicitContent = explicitContextPack.sections.map((section) => section.content).join('\n');

  assert.equal(defaultContent.includes('DURABLE_STALE_ALLOWED_WITH_EXPLICIT_OPTION'), false);
  assert.equal(defaultContextPack.omittedSources.some((decision) => {
    return decision.decisionType === 'stale_source';
  }), true);
  assert.equal(explicitContent.includes('DURABLE_STALE_ALLOWED_WITH_EXPLICIT_OPTION'), true);
  assert.equal(explicitContextPack.warnings.some((warning) => {
    return warning.includes('Stale memory included by explicit option');
  }), true);
});
