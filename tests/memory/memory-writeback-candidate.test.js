import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertMemoryWriteCandidate,
  assertMemoryWritebackRequest,
} from '../../src/contracts/memory/memory-writeback-contract.js';
import { proposeMemoryWritebackForInvocation } from '../../src/context/propose-memory-writeback-for-invocation.js';

const VALID_CREATED_AT = '2026-04-14T00:00:00.000Z';
const VALID_SHA_256 = 'e'.repeat(64);

function buildSourceReference(overrides = {}) {
  return {
    kind: 'memory_source_reference',
    version: 1,
    sourceType: 'invocation_session',
    sourceId: 'invocation-001',
    scope: 'operational_identity',
    ownerId: 'maria',
    path: 'memory/state/agent-invocation-invocation-001.json',
    origin: 'runtime_observed',
    sensitivityLevel: 'internal',
    createdAt: VALID_CREATED_AT,
    contentSha256: VALID_SHA_256,
    ...overrides,
  };
}

function buildWriteCandidate(overrides = {}) {
  return {
    kind: 'memory_write_candidate',
    writeId: 'write_conversation_summary_001',
    writeType: 'conversation_summary',
    targetMemoryType: 'conversation_summary',
    scope: 'operational_identity',
    ownerId: 'maria',
    origin: 'agent_proposed',
    portability: 'mas_bound',
    visibility: 'private_to_owner',
    sensitivityLevel: 'internal',
    authorityLevel: 'operational_note',
    summary: 'Maria completed a customer-facing complaint response.',
    content: 'Invocation completed. Raw model output was not copied.',
    sourceReferences: [buildSourceReference()],
    subjectReferences: [
      {
        subjectType: 'invocation',
        subjectId: 'invocation-001',
        relationship: 'source-invocation',
      },
      {
        subjectType: 'operational_identity',
        subjectId: 'maria',
        relationship: 'owner',
      },
    ],
    approvalState: 'pending',
    redactionState: 'not_required',
    sourceGovernance: {
      sourceScopes: ['operational_identity'],
      sourceOwnerIds: ['maria'],
      mostRestrictiveVisibility: 'private_to_owner',
      highestSensitivityLevel: 'internal',
      requiresHumanApproval: false,
    },
    reason: 'The invocation produced useful continuity context.',
    warnings: [],
    ...overrides,
  };
}

function buildWritebackRequest(overrides = {}) {
  return {
    kind: 'memory_writeback_request',
    version: 1,
    invocationId: 'invocation-001',
    requestedBy: 'runtime',
    requiresHumanApproval: true,
    memoryWrites: [buildWriteCandidate()],
    warnings: [],
    ...overrides,
  };
}

function buildProbabilisticInvocationSession(overrides = {}) {
  return {
    kind: 'agent_invocation_session',
    invocationId: 'invocation-001',
    operationalIdentityId: 'maria',
    primaryCognitiveIdentityId: 'community-manager',
    secondaryCognitiveIdentityIds: ['copywriter-senior'],
    executionType: 'probabilistic_brain',
    request: {
      invocationMode: 'probabilistic',
      command: 'ask',
      inputText: 'Please answer this complaint.',
    },
    providerRequestSummary: {
      providerId: 'openrouter-api',
      modelId: 'openrouter/free',
    },
    brainOutput: {
      providerId: 'openrouter-api',
      modelId: 'openrouter/free',
      outputText: 'SECRET_VALUE_SHOULD_NOT_BE_COPIED',
    },
    startedAt: '2026-04-14T10:00:00.000Z',
    finishedAt: '2026-04-14T10:00:01.000Z',
    ...overrides,
  };
}

test('assertMemoryWritebackRequest accepts a governed conversation summary candidate', () => {
  const writebackRequest = assertMemoryWritebackRequest(buildWritebackRequest());

  assert.equal(writebackRequest.kind, 'memory_writeback_request');
  assert.equal(writebackRequest.requiresHumanApproval, true);
  assert.equal(writebackRequest.memoryWrites.length, 1);
  assert.equal(writebackRequest.memoryWrites[0].kind, 'memory_write_candidate');
  assert.equal(writebackRequest.memoryWrites[0].writeType, 'conversation_summary');
  assert.equal(writebackRequest.memoryWrites[0].sourceReferences.length, 1);
});

test('assertMemoryWritebackRequest requires human approval for durable decision candidates', () => {
  const decisionCandidate = buildWriteCandidate({
    writeId: 'write_decision_001',
    writeType: 'decision',
    targetMemoryType: 'durable_decision',
    scope: 'mas_instance',
    ownerId: 'sin-cuchillo',
    visibility: 'shared_with_mas',
    authorityLevel: 'human_directive',
    summary: 'The company decided to escalate serious delivery complaints.',
    content: 'Serious delivery complaints should be escalated to a human manager.',
    sourceGovernance: {
      sourceScopes: ['mas_instance'],
      sourceOwnerIds: ['sin-cuchillo'],
      mostRestrictiveVisibility: 'shared_with_mas',
      highestSensitivityLevel: 'internal',
      requiresHumanApproval: true,
    },
  });

  assert.equal(
    assertMemoryWritebackRequest(buildWritebackRequest({
      memoryWrites: [decisionCandidate],
      requiresHumanApproval: true,
    })).memoryWrites[0].writeType,
    'decision',
  );

  assert.throws(
    () => assertMemoryWritebackRequest(buildWritebackRequest({
      memoryWrites: [decisionCandidate],
      requiresHumanApproval: false,
    })),
    /requiresHumanApproval must be true/,
  );
});

test('assertMemoryWriteCandidate rejects candidates without source references', () => {
  assert.throws(
    () => assertMemoryWriteCandidate(buildWriteCandidate({
      sourceReferences: [],
    })),
    /must include at least one source reference/,
  );
});

test('assertMemoryWriteCandidate rejects unsafe private operational memory promotion', () => {
  assert.throws(
    () => assertMemoryWriteCandidate(buildWriteCandidate({
      writeId: 'write_private_promotion_001',
      writeType: 'memory_promotion',
      targetMemoryType: 'conversation_summary',
      scope: 'mas_instance',
      ownerId: 'sin-cuchillo',
      visibility: 'shared_with_mas',
      sourceGovernance: {
        sourceScopes: ['operational_identity'],
        sourceOwnerIds: ['maria'],
        mostRestrictiveVisibility: 'private_to_owner',
        highestSensitivityLevel: 'internal',
        requiresHumanApproval: true,
      },
    })),
    /must not promote private operational identity memory/,
  );
});

test('assertMemoryWriteCandidate rejects sensitivity downgrades without redaction', () => {
  assert.throws(
    () => assertMemoryWriteCandidate(buildWriteCandidate({
      writeId: 'write_sensitivity_downgrade_001',
      scope: 'mas_instance',
      ownerId: 'sin-cuchillo',
      visibility: 'public_within_mas',
      sensitivityLevel: 'public',
      sourceGovernance: {
        sourceScopes: ['mas_instance'],
        sourceOwnerIds: ['sin-cuchillo'],
        mostRestrictiveVisibility: 'restricted',
        highestSensitivityLevel: 'restricted',
        requiresHumanApproval: true,
      },
    })),
    /must not downgrade inherited source sensitivity without redaction/,
  );

  const redactedCandidate = assertMemoryWriteCandidate(buildWriteCandidate({
    writeId: 'write_redacted_summary_001',
    writeType: 'redacted_summary',
    targetMemoryType: 'conversation_summary',
    scope: 'mas_instance',
    ownerId: 'sin-cuchillo',
    visibility: 'public_within_mas',
    sensitivityLevel: 'public',
    redactionState: 'redacted',
    sourceGovernance: {
      sourceScopes: ['mas_instance'],
      sourceOwnerIds: ['sin-cuchillo'],
      mostRestrictiveVisibility: 'restricted',
      highestSensitivityLevel: 'restricted',
      requiresHumanApproval: true,
    },
  }));

  assert.equal(redactedCandidate.redactionState, 'redacted');
});

test('assertMemoryWriteCandidate rejects invalid write type and target memory combinations', () => {
  assert.throws(
    () => assertMemoryWriteCandidate(buildWriteCandidate({
      writeType: 'artifact_reference',
      targetMemoryType: 'conversation_summary',
    })),
    /cannot target memoryType/,
  );
});

test('proposeMemoryWritebackForInvocation proposes conversation summary and artifact reference candidates', () => {
  const writebackRequest = proposeMemoryWritebackForInvocation({
    invocationSession: buildProbabilisticInvocationSession(),
    invocationReport: {
      reportId: 'probabilistic-report-001',
      reportKind: 'probabilistic_brain_invocation',
      path: 'memory/artifacts/invocation-report-invocation-001.md',
    },
  });
  const serializedWriteback = JSON.stringify(writebackRequest);

  assert.equal(writebackRequest.kind, 'memory_writeback_request');
  assert.equal(writebackRequest.requiresHumanApproval, true);
  assert.equal(writebackRequest.memoryWrites.length, 2);
  assert.equal(writebackRequest.memoryWrites[0].writeType, 'conversation_summary');
  assert.equal(writebackRequest.memoryWrites[1].writeType, 'artifact_reference');
  assert.equal(writebackRequest.memoryWrites[1].content, null);
  assert.equal(serializedWriteback.includes('SECRET_VALUE_SHOULD_NOT_BE_COPIED'), false);
});

test('proposeMemoryWritebackForInvocation returns no candidates for deterministic invocations', () => {
  const writebackRequest = proposeMemoryWritebackForInvocation({
    invocationSession: buildProbabilisticInvocationSession({
      executionType: 'deterministic_command',
      brainOutput: null,
      providerRequestSummary: null,
      request: {
        invocationMode: 'deterministic',
        command: 'hello',
      },
    }),
  });

  assert.equal(writebackRequest.requiresHumanApproval, false);
  assert.equal(writebackRequest.memoryWrites.length, 0);
  assert.equal(writebackRequest.warnings[0].includes('non-probabilistic'), true);
});
