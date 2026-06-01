import path from 'node:path';
import { ensureDirectory } from '../persistence/ensure-directory.js';
import { writeJsonFile } from '../persistence/write-json-file.js';
import { writeTextFile } from '../persistence/write-text-file.js';

function resolvePersistenceDirectories({ status, projectRootPath, masRootPath }) {
  if ((status === 'ready' || status === 'degraded') && masRootPath) {
    return {
      targetType: 'mas-memory',
      stateDirectoryPath: path.join(masRootPath, 'memory', 'state'),
      artifactsDirectoryPath: path.join(masRootPath, 'memory', 'artifacts'),
    };
  }

  if (projectRootPath) {
    return {
      targetType: 'project-logs',
      stateDirectoryPath: path.join(projectRootPath, 'var', 'logs', 'boot', 'state'),
      artifactsDirectoryPath: path.join(projectRootPath, 'var', 'logs', 'boot', 'artifacts'),
    };
  }

  return null;
}

export async function writeBootArtifacts({
  status,
  projectRootPath,
  masRootPath,
  bootId,
  bootSession,
  bootContext,
  bootReport,
}) {
  const persistenceDirectories = resolvePersistenceDirectories({
    status,
    projectRootPath,
    masRootPath,
  });

  if (!persistenceDirectories) {
    return null;
  }

  const { targetType, stateDirectoryPath, artifactsDirectoryPath } = persistenceDirectories;

  await ensureDirectory(stateDirectoryPath);
  await ensureDirectory(artifactsDirectoryPath);

  const bootSessionRecordPath = path.join(stateDirectoryPath, `boot-session-${bootId}.json`);
  const bootContextSummaryPath = path.join(artifactsDirectoryPath, `boot-context-${bootId}.json`);
  const bootReportPath = path.join(artifactsDirectoryPath, `boot-report-${bootId}.md`);

  await writeJsonFile(bootSessionRecordPath, bootSession);
  await writeJsonFile(bootContextSummaryPath, bootContext);
  await writeTextFile(bootReportPath, bootReport);

  return {
    targetType,
    bootSessionRecordPath,
    bootContextSummaryPath,
    bootReportPath,
  };
}
