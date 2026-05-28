import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile } from 'node:fs/promises';
import { persistToolResultForInvocation } from '../../src/tools/persist-tool-result-for-invocation.js';

async function createTemporaryMasRoot() {
  const temporaryRootPath = await mkdtemp(path.join(os.tmpdir(), 'openmas-tool-result-persistence-'));

  return path.join(temporaryRootPath, 'instance');
}

async function readJsonFile(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

function buildToolDefinition(overrides = {}) {
  return {
    kind: 'tool_definition',
    version: 1,
    toolId: 'mas.system.inspect',
    displayName: 'MAS System Inspect',
    description: 'Inspects safe MAS system state.',
    lifecycleState: 'active',
    owner: 'mas',
    toolType: 'local_js_module',
    sideEffectLevel: 'read_only',
    inputSchema: {
      type: 'object',
    },
    outputSchema: {
      type: 'object',
    },
    requiredResourceTypes: ['storage'],
    requiredAccessModes: ['read'],
    requiredPermissionModes: ['tool.execute'],
    approvalPolicy: {
      required: false,
    },
    execution: {
      modulePath: 'executor.js',
      timeoutMs: 10000,
      retryPolicy: {
        enabled: false,
      },
    },
    artifactPolicy: {
      persistResult: false,
    },
    memoryPolicy: {
      allowWritebackCandidates: false,
    },
    ...overrides,
  };
}

function buildToolResult(overrides = {}) {
  return {
    kind: 'tool_result',
    version: 1,
    toolId: 'mas.system.inspect',
    toolRunId: 'tool-run-persistence-001',
    status: 'succeeded',
    summary: 'MAS inspection completed.',
    data: {
      registeredCognitiveIdentityCount: 3,
      operationalIdentityCount: 3,
    },
    artifacts: [],
    warnings: [],
    errors: [],
    memoryWritebackCandidates: [],
    audit: {
      invocationId: 'invocation-tool-persistence-001',
      operationalIdentityId: 'alfred',
      requestedBy: 'test-suite',
      startedAt: '2026-04-16T10:00:00.000Z',
      completedAt: '2026-04-16T10:00:01.000Z',
    },
    ...overrides,
  };
}

test('persistToolResultForInvocation writes a small tool audit record without forcing a result artifact', async () => {
  const masRootPath = await createTemporaryMasRoot();

  const persistence = await persistToolResultForInvocation({
    masRootPath,
    toolDefinition: buildToolDefinition(),
    toolResult: buildToolResult(),
  });
  const auditRecord = await readJsonFile(persistence.auditRecordPath);

  assert.equal(persistence.targetType, 'mas-memory');
  assert.equal(persistence.resultSnapshotPath, null);
  assert.equal(auditRecord.kind, 'tool_run_audit_record');
  assert.equal(auditRecord.toolId, 'mas.system.inspect');
  assert.equal(auditRecord.resultEvidence.inlineDataIncluded, true);
  assert.equal(auditRecord.resultEvidence.fullResultArtifactPersisted, false);
  assert.equal(auditRecord.dataPreview.registeredCognitiveIdentityCount, 3);
  assert.equal(auditRecord.audit.operationalIdentityId, 'alfred');
});

test('persistToolResultForInvocation persists a redacted result snapshot when artifact policy requires it', async () => {
  const masRootPath = await createTemporaryMasRoot();

  const persistence = await persistToolResultForInvocation({
    masRootPath,
    toolDefinition: buildToolDefinition({
      artifactPolicy: {
        persistResult: true,
      },
    }),
    toolResult: buildToolResult({
      toolRunId: 'tool-run-persistence-002',
      artifacts: [
        {
          artifactId: 'executor-report-001',
          artifactKind: 'executor_report',
          path: 'memory/artifacts/executor-report-001.md',
          summary: 'Executor report.',
        },
      ],
    }),
  });
  const auditRecord = await readJsonFile(persistence.auditRecordPath);
  const resultSnapshot = await readJsonFile(persistence.resultSnapshotPath);

  assert.equal(auditRecord.resultEvidence.fullResultArtifactPersisted, true);
  assert.equal(auditRecord.resultEvidence.fullResultArtifactReason, 'tool_artifact_policy');
  assert.equal(auditRecord.artifactReferences.length, 2);
  assert.equal(auditRecord.artifactReferences[1].artifactKind, 'tool_result_snapshot');
  assert.equal(resultSnapshot.kind, 'tool_result_snapshot');
  assert.equal(resultSnapshot.result.toolRunId, 'tool-run-persistence-002');
  assert.equal(resultSnapshot.result.data.operationalIdentityCount, 3);
});

test('persistToolResultForInvocation stores large output in an artifact and keeps audit data preview bounded', async () => {
  const masRootPath = await createTemporaryMasRoot();

  const persistence = await persistToolResultForInvocation({
    masRootPath,
    toolDefinition: buildToolDefinition(),
    toolResult: buildToolResult({
      toolRunId: 'tool-run-persistence-003',
      data: {
        largePayload: 'x'.repeat(256),
      },
    }),
    inlineDataLimitBytes: 32,
  });
  const auditRecord = await readJsonFile(persistence.auditRecordPath);
  const resultSnapshot = await readJsonFile(persistence.resultSnapshotPath);

  assert.equal(auditRecord.resultEvidence.inlineDataIncluded, false);
  assert.equal(auditRecord.resultEvidence.fullResultArtifactPersisted, true);
  assert.equal(auditRecord.resultEvidence.fullResultArtifactReason, 'inline_data_limit_exceeded');
  assert.equal(auditRecord.dataPreview, null);
  assert.equal(resultSnapshot.result.data.largePayload.length, 256);
});

test('persistToolResultForInvocation redacts sensitive keys and known secret-looking values', async () => {
  const masRootPath = await createTemporaryMasRoot();
  const googleSecretProbe = [
    'AI',
    'za',
    'SyREDACTION_PROBE_NOT_A_REAL_KEY_1234567890',
  ].join('');
  const openRouterSecretProbe = [
    'sk',
    'or',
    'v1',
    'REDACTION_PROBE_NOT_A_REAL_KEY_1234567890',
  ].join('-');
  const bearerSecretProbe = 'Bearer secret-token-value';

  const persistence = await persistToolResultForInvocation({
    masRootPath,
    toolDefinition: buildToolDefinition({
      artifactPolicy: {
        persistResult: true,
      },
    }),
    toolResult: buildToolResult({
      toolRunId: 'tool-run-persistence-004',
      summary: `Provider key ${googleSecretProbe} was seen.`,
      data: {
        apiKey: googleSecretProbe,
        nested: {
          openRouterToken: openRouterSecretProbe,
        },
        header: bearerSecretProbe,
      },
    }),
  });
  const auditRecord = await readJsonFile(persistence.auditRecordPath);
  const resultSnapshot = await readJsonFile(persistence.resultSnapshotPath);
  const serializedEvidence = JSON.stringify({
    auditRecord,
    resultSnapshot,
  });

  assert.equal(auditRecord.resultEvidence.redactionApplied, true);
  assert.equal(auditRecord.dataPreview.apiKey, '[REDACTED]');
  assert.equal(auditRecord.dataPreview.nested.openRouterToken, '[REDACTED]');
  assert.equal(serializedEvidence.includes(googleSecretProbe), false);
  assert.equal(serializedEvidence.includes(openRouterSecretProbe), false);
  assert.equal(serializedEvidence.includes(bearerSecretProbe), false);
  assert.match(serializedEvidence, /\[REDACTED\]/u);
});

test('persistToolResultForInvocation redacts executor error text before persistence', async () => {
  const masRootPath = await createTemporaryMasRoot();
  const failureSecretProbe = 'ACID_FAILURE_SECRET_DO_NOT_LEAK';

  const persistence = await persistToolResultForInvocation({
    masRootPath,
    toolDefinition: buildToolDefinition({
      artifactPolicy: {
        persistResult: true,
      },
    }),
    toolResult: buildToolResult({
      toolRunId: 'tool-run-persistence-005',
      status: 'failed',
      summary: 'MAS inspection failed.',
      errors: [`Inspection failed with ${failureSecretProbe}`],
    }),
  });
  const auditRecord = await readJsonFile(persistence.auditRecordPath);
  const resultSnapshot = await readJsonFile(persistence.resultSnapshotPath);
  const serializedEvidence = JSON.stringify({
    auditRecord,
    resultSnapshot,
  });

  assert.deepEqual(auditRecord.errors, ['[REDACTED]']);
  assert.deepEqual(resultSnapshot.result.errors, ['[REDACTED]']);
  assert.doesNotMatch(serializedEvidence, new RegExp(failureSecretProbe, 'u'));
  assert.match(serializedEvidence, /\[REDACTED\]/u);
});

test('persistToolResultForInvocation rejects mismatched tools and unsafe tool run ids', async () => {
  const masRootPath = await createTemporaryMasRoot();

  await assert.rejects(
    () => persistToolResultForInvocation({
      masRootPath,
      toolDefinition: buildToolDefinition(),
      toolResult: buildToolResult({
        toolId: 'mas.memory.health.read',
      }),
    }),
    /does not match tool definition/u,
  );

  await assert.rejects(
    () => persistToolResultForInvocation({
      masRootPath,
      toolDefinition: buildToolDefinition(),
      toolResult: buildToolResult({
        toolRunId: '../unsafe-tool-run',
      }),
    }),
    /unsafe filesystem characters/u,
  );
});
