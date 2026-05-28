import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { access, mkdtemp, readFile } from 'node:fs/promises';
import { buildInvocationReportArtifactDecision } from '../../src/invocation/build-invocation-report-artifact-decision.js';
import { writeInvocationArtifacts } from '../../src/invocation/write-invocation-artifacts.js';

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return false;
    }

    throw error;
  }
}

function buildInvocationSession(overrides = {}) {
  return {
    kind: 'agent_invocation_session',
    invocationId: 'artifact-decision-test',
    primaryCognitiveIdentityId: 'system-steward',
    operationalIdentityId: 'alfred',
    executionType: 'deterministic_command',
    request: {
      operationalIdentityId: 'alfred',
      invocationMode: 'deterministic',
      command: 'memory-health',
      requestedBy: 'test-suite',
    },
    message: 'Memory health report generated.',
    startedAt: '2026-04-15T00:00:00.000Z',
    finishedAt: '2026-04-15T00:00:01.000Z',
    ...overrides,
  };
}

test('buildInvocationReportArtifactDecision persists audit reports only for explicit diagnostic commands', () => {
  const explicitDecision = buildInvocationReportArtifactDecision({
    reportKind: 'memory_health_diagnostic_report',
    request: {
      operationalIdentityId: 'alfred',
      invocationMode: 'deterministic',
      command: 'memory-health',
      requestedBy: 'administrator',
    },
  });
  const implicitDecision = buildInvocationReportArtifactDecision({
    reportKind: 'memory_health_diagnostic_report',
    request: {
      operationalIdentityId: 'alfred',
      invocationMode: 'probabilistic',
      command: 'ask',
      requestedBy: 'administrator',
    },
  });

  assert.equal(explicitDecision.artifactClass, 'memory_audit_report');
  assert.equal(explicitDecision.persistReportArtifact, true);
  assert.equal(explicitDecision.promptInclusionMode, 'artifact_reference_only');
  assert.equal(explicitDecision.rawArtifactBodyPromptEligible, false);
  assert.equal(explicitDecision.durableMemoryWriteEligible, false);
  assert.equal(implicitDecision.artifactClass, 'memory_audit_report');
  assert.equal(implicitDecision.persistReportArtifact, false);
});

test('buildInvocationReportArtifactDecision keeps standard reports as runtime artifacts', () => {
  const decision = buildInvocationReportArtifactDecision({
    reportKind: 'system_status_report',
    request: {
      operationalIdentityId: 'alfred',
      invocationMode: 'deterministic',
      command: 'status',
      requestedBy: 'cli',
    },
  });

  assert.equal(decision.artifactClass, 'runtime_invocation_report');
  assert.equal(decision.persistReportArtifact, true);
  assert.equal(decision.rawArtifactBodyPromptEligible, false);
  assert.equal(decision.durableMemoryWriteEligible, false);
});

test('writeInvocationArtifacts records the artifact decision in the invocation session', async () => {
  const temporaryRootPath = await mkdtemp(path.join(os.tmpdir(), 'openmas-artifact-decision-'));
  const masRootPath = path.join(temporaryRootPath, 'instance');
  const request = {
    operationalIdentityId: 'alfred',
    invocationMode: 'deterministic',
    command: 'memory-health',
    requestedBy: 'administrator',
  };

  const persistence = await writeInvocationArtifacts({
    masRootPath,
    invocationId: 'audit-report-explicit',
    invocationSession: buildInvocationSession({ request }),
    request,
    reportKind: 'memory_health_diagnostic_report',
    reportContent: '# Memory Health Diagnostic Report\n\nNo raw secret values.\n',
  });

  assert.equal(persistence.reportArtifactDecision.artifactClass, 'memory_audit_report');
  assert.equal(persistence.reportArtifactDecision.persistReportArtifact, true);
  assert.equal(await fileExists(persistence.invocationReportPath), true);

  const persistedSession = JSON.parse(await readFile(persistence.invocationSessionRecordPath, 'utf8'));

  assert.equal(persistedSession.reportArtifactDecision.artifactClass, 'memory_audit_report');
  assert.equal(persistedSession.reportArtifactDecision.promptInclusionMode, 'artifact_reference_only');
  assert.equal(persistedSession.reportArtifactDecision.rawArtifactBodyPromptEligible, false);
  assert.equal(persistedSession.reportArtifactDecision.durableMemoryWriteEligible, false);
});

test('writeInvocationArtifacts skips non-explicit audit report artifacts but keeps the session audit trail', async () => {
  const temporaryRootPath = await mkdtemp(path.join(os.tmpdir(), 'openmas-artifact-decision-'));
  const masRootPath = path.join(temporaryRootPath, 'instance');
  const request = {
    operationalIdentityId: 'alfred',
    invocationMode: 'probabilistic',
    command: 'ask',
    requestedBy: 'administrator',
  };

  const persistence = await writeInvocationArtifacts({
    masRootPath,
    invocationId: 'audit-report-implicit',
    invocationSession: buildInvocationSession({ request }),
    request,
    reportKind: 'memory_health_diagnostic_report',
    reportContent: '# Memory Health Diagnostic Report\n\nThis should not be persisted.\n',
  });

  assert.equal(persistence.reportArtifactDecision.persistReportArtifact, false);
  assert.equal(persistence.invocationReportPath, null);
  assert.equal(await fileExists(persistence.invocationSessionRecordPath), true);

  const persistedSession = JSON.parse(await readFile(persistence.invocationSessionRecordPath, 'utf8'));

  assert.equal(persistedSession.reportArtifactDecision.artifactClass, 'memory_audit_report');
  assert.equal(persistedSession.reportArtifactDecision.persistReportArtifact, false);
});
