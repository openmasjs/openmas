import path from 'node:path';
import { readdir, readFile, stat } from 'node:fs/promises';
import { resolveBoundedChildPath } from '../contracts/shared/bounded-path-contract.js';
import { assertMemoryRecord } from '../contracts/memory/memory-record-contract.js';
import { assertMemorySourceDefinition } from '../contracts/memory/memory-source-registry-contract.js';
import { createSha256 } from './read-memory-source-files.js';
import {
  createDurableMemoryRecordFileName,
  DURABLE_MEMORY_ROOT_PATH,
  resolveDurableMemoryRootPath,
} from './write-durable-memory-record.js';

function buildReadFailureMessage(fileName, error) {
  return `Failed to read durable memory record ${fileName}: ${error.message}`;
}

function normalizeDurableMemorySourceDefinition(sourceDefinition) {
  if (sourceDefinition === null || sourceDefinition === undefined) {
    return null;
  }

  const normalizedSourceDefinition = assertMemorySourceDefinition(sourceDefinition);

  if (normalizedSourceDefinition.sourceType !== 'durable_memory_directory') {
    throw new Error(`Durable memory reader requires sourceType durable_memory_directory, received ${normalizedSourceDefinition.sourceType}.`);
  }

  return normalizedSourceDefinition;
}

function resolveDurableMemoryReadTarget({ masRootPath, sourceDefinition }) {
  const normalizedSourceDefinition = normalizeDurableMemorySourceDefinition(sourceDefinition);

  if (!normalizedSourceDefinition) {
    return {
      durableMemoryRootPath: resolveDurableMemoryRootPath({ masRootPath }),
      rootPath: DURABLE_MEMORY_ROOT_PATH,
      sourceDefinition: null,
    };
  }

  return {
    durableMemoryRootPath: resolveBoundedChildPath({
      parentRootPath: masRootPath,
      childRootPath: normalizedSourceDefinition.rootPath,
      description: `Memory source ${normalizedSourceDefinition.sourceId} rootPath`,
    }),
    rootPath: normalizedSourceDefinition.rootPath,
    sourceDefinition: normalizedSourceDefinition,
  };
}

function buildMissingRootWarning({ sourceDefinition, rootPath }) {
  if (sourceDefinition) {
    return `Memory source ${sourceDefinition.sourceId} rootPath does not exist: ${sourceDefinition.rootPath}`;
  }

  return `Durable memory rootPath does not exist: ${rootPath}`;
}

function createRelativeDurableMemoryPath({ fileName, rootPath }) {
  return path.posix.join(...rootPath.split(/[\\/]+/).filter(Boolean), fileName);
}

function buildDurableMemorySourceReference({
  memoryRecord,
  fileName,
  fileContent,
  rootPath,
  sourceDefinition,
}) {
  const durableMemoryPath = createRelativeDurableMemoryPath({ fileName, rootPath });

  return {
    kind: 'memory_source_reference',
    version: 1,
    sourceType: 'durable_memory_record',
    sourceId: memoryRecord.memoryRecordId,
    scope: sourceDefinition?.scope ?? memoryRecord.scope,
    ownerId: sourceDefinition?.ownerId ?? memoryRecord.ownerId,
    path: durableMemoryPath,
    origin: 'system_generated',
    sensitivityLevel: sourceDefinition?.defaultSensitivityLevel ?? memoryRecord.sensitivityLevel,
    createdAt: memoryRecord.updatedAt ?? memoryRecord.createdAt,
    contentSha256: createSha256(fileContent),
  };
}

function hasDurableSourceReference(memoryRecord, durableMemoryPath) {
  return memoryRecord.sourceReferences.some((sourceReference) => {
    return (
      sourceReference.sourceType === 'durable_memory_record'
      && sourceReference.path === durableMemoryPath
    );
  });
}

function attachDurableMemorySourceReference({
  memoryRecord,
  fileName,
  fileContent,
  rootPath,
  sourceDefinition,
}) {
  const durableMemoryPath = createRelativeDurableMemoryPath({ fileName, rootPath });

  if (hasDurableSourceReference(memoryRecord, durableMemoryPath)) {
    return memoryRecord;
  }

  return assertMemoryRecord({
    ...memoryRecord,
    sourceReferences: [
      ...memoryRecord.sourceReferences,
      buildDurableMemorySourceReference({
        memoryRecord,
        fileName,
        fileContent,
        rootPath,
        sourceDefinition,
      }),
    ],
  });
}

export async function readDurableMemoryRecords({
  masRootPath,
  sourceDefinition = null,
  strict = false,
} = {}) {
  const readTarget = resolveDurableMemoryReadTarget({ masRootPath, sourceDefinition });
  const {
    durableMemoryRootPath,
    rootPath,
    sourceDefinition: normalizedSourceDefinition,
  } = readTarget;
  const warnings = [];
  let directoryEntries;

  try {
    directoryEntries = await readdir(durableMemoryRootPath, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') {
      return {
        durableMemoryRootPath,
        memoryRecords: [],
        recordFiles: [],
        warnings: [buildMissingRootWarning({ sourceDefinition: normalizedSourceDefinition, rootPath })],
        summary: {
          filesRead: 0,
          recordsRead: 0,
          warnings: 1,
        },
      };
    }

    throw error;
  }

  const memoryRecords = [];
  const recordFiles = [];
  let filesRead = 0;
  const fileEntries = directoryEntries.toSorted((left, right) => {
    return left.name.localeCompare(right.name);
  });
  const candidateFiles = [];

  for (const directoryEntry of fileEntries) {
    if (!directoryEntry.isFile()) {
      warnings.push(`Durable memory store skipped non-file entry: ${directoryEntry.name}`);
      continue;
    }

    if (!directoryEntry.name.endsWith('.json')) {
      warnings.push(`Durable memory store skipped non-JSON file: ${directoryEntry.name}`);
      continue;
    }

    const absoluteFilePath = path.join(durableMemoryRootPath, directoryEntry.name);
    const fileStat = await stat(absoluteFilePath);

    if (
      normalizedSourceDefinition
      && fileStat.size > normalizedSourceDefinition.readPolicy.maxBytesPerFile
    ) {
      warnings.push(`Durable memory store skipped oversized file ${directoryEntry.name}: ${fileStat.size} bytes exceeds ${normalizedSourceDefinition.readPolicy.maxBytesPerFile}.`);
      continue;
    }

    candidateFiles.push({
      absoluteFilePath,
      fileName: directoryEntry.name,
    });
  }

  const selectedFiles = normalizedSourceDefinition
    ? candidateFiles.slice(0, normalizedSourceDefinition.readPolicy.maxFiles)
    : candidateFiles;
  const omittedByLimit = normalizedSourceDefinition
    ? candidateFiles.slice(normalizedSourceDefinition.readPolicy.maxFiles)
    : [];

  for (const omittedFile of omittedByLimit) {
    warnings.push(`Durable memory store omitted file due to maxFiles limit: ${omittedFile.fileName}`);
  }

  for (const candidateFile of selectedFiles) {
    filesRead += 1;

    try {
      const fileContent = await readFile(candidateFile.absoluteFilePath, 'utf8');
      const payload = JSON.parse(fileContent);
      const memoryRecord = assertMemoryRecord(payload);
      const expectedFileName = createDurableMemoryRecordFileName(memoryRecord.memoryRecordId);

      if (candidateFile.fileName !== expectedFileName) {
        throw new Error(`File name must match memoryRecordId. Expected ${expectedFileName}.`);
      }

      memoryRecords.push(attachDurableMemorySourceReference({
        memoryRecord,
        fileName: candidateFile.fileName,
        fileContent,
        rootPath,
        sourceDefinition: normalizedSourceDefinition,
      }));
      recordFiles.push({
        memoryRecordId: memoryRecord.memoryRecordId,
        fileName: candidateFile.fileName,
        durableMemoryPath: createRelativeDurableMemoryPath({
          fileName: candidateFile.fileName,
          rootPath,
        }),
      });
    } catch (error) {
      const warning = buildReadFailureMessage(candidateFile.fileName, error);

      if (strict) {
        throw new Error(warning);
      }

      warnings.push(warning);
    }
  }

  return {
    sourceId: normalizedSourceDefinition?.sourceId ?? null,
    durableMemoryRootPath,
    memoryRecords,
    recordFiles,
    warnings,
    summary: {
      filesRead,
      recordsRead: memoryRecords.length,
      warnings: warnings.length,
    },
  };
}
