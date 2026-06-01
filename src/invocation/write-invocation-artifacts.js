import path from 'node:path';
import { ensureDirectory } from '../persistence/ensure-directory.js';
import { writeJsonFile } from '../persistence/write-json-file.js';
import { writeTextFile } from '../persistence/write-text-file.js';
import { buildInvocationReportArtifactDecision } from './build-invocation-report-artifact-decision.js';
import { compactInvocationSessionForPersistence } from './compact-invocation-session.js';

function toFileSlug(value) {
  return value.replaceAll('_', '-');
}

function toMasRelativePath({ masRootPath, filePath }) {
  return path.relative(masRootPath, filePath).split(path.sep).join('/');
}

export async function writeInvocationArtifacts({
  masRootPath,
  invocationId,
  invocationSession,
  request = null,
  reportKind,
  reportContent,
}) {
  const stateDirectoryPath = path.join(masRootPath, 'memory', 'state');
  const artifactsDirectoryPath = path.join(masRootPath, 'memory', 'artifacts');
  const diagnosticsDirectoryPath = path.join(masRootPath, 'memory', 'internal', 'invocation-diagnostics');

  await ensureDirectory(stateDirectoryPath);
  await ensureDirectory(artifactsDirectoryPath);

  const invocationSessionRecordPath = path.join(stateDirectoryPath, `agent-invocation-${invocationId}.json`);
  const invocationReportPath = path.join(artifactsDirectoryPath, `${toFileSlug(reportKind)}-${invocationId}.md`);
  const invocationDiagnosticsPath = path.join(diagnosticsDirectoryPath, `agent-invocation-diagnostics-${invocationId}.json`);
  const invocationDiagnosticsRelativePath = toMasRelativePath({
    masRootPath,
    filePath: invocationDiagnosticsPath,
  });
  const reportArtifactDecision = buildInvocationReportArtifactDecision({
    reportKind,
    request,
  });
  const invocationSessionWithReportDecision = {
    ...invocationSession,
    reportArtifactDecision,
  };
  const {
    invocationSession: persistedInvocationSession,
    diagnosticsArtifact,
  } = compactInvocationSessionForPersistence({
    invocationSession: invocationSessionWithReportDecision,
    diagnosticsArtifactPath: invocationDiagnosticsRelativePath,
  });

  if (diagnosticsArtifact) {
    await ensureDirectory(diagnosticsDirectoryPath);
    await writeJsonFile(invocationDiagnosticsPath, diagnosticsArtifact);
  }

  await writeJsonFile(invocationSessionRecordPath, persistedInvocationSession);

  if (reportArtifactDecision.persistReportArtifact) {
    await writeTextFile(invocationReportPath, reportContent);
  }

  return {
    targetType: 'mas-memory',
    invocationSessionRecordPath,
    invocationDiagnosticsPath: diagnosticsArtifact ? invocationDiagnosticsPath : null,
    invocationReportPath: reportArtifactDecision.persistReportArtifact ? invocationReportPath : null,
    invocationSessionCompaction: persistedInvocationSession.invocationSessionCompaction ?? null,
    reportArtifactDecision,
  };
}
