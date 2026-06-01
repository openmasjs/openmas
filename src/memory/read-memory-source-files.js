import path from 'node:path';
import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { resolveBoundedChildPath } from '../contracts/shared/bounded-path-contract.js';
import { assertMemorySourceDefinition } from '../contracts/memory/memory-source-registry-contract.js';

function toPosixPath(value) {
  return value.split(path.sep).join('/');
}

function normalizeExtensions(allowedExtensions) {
  return new Set(allowedExtensions.map((extension) => {
    return extension.startsWith('.') ? extension.toLowerCase() : `.${extension.toLowerCase()}`;
  }));
}

export function createSha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function createStableMemoryRecordId(...parts) {
  return `mem_${createSha256(parts.join('|')).slice(0, 32)}`;
}

export function createMemorySourceFilePath({ masRootPath, absoluteFilePath }) {
  return toPosixPath(path.relative(masRootPath, absoluteFilePath));
}

export async function readMemorySourceFiles({
  masRootPath,
  sourceDefinition,
  allowedExtensions,
  preferNewest = true,
}) {
  const normalizedSource = assertMemorySourceDefinition(sourceDefinition);
  const allowedExtensionSet = normalizeExtensions(allowedExtensions);
  const sourceRootPath = resolveBoundedChildPath({
    parentRootPath: masRootPath,
    childRootPath: normalizedSource.rootPath,
    description: `Memory source ${normalizedSource.sourceId} rootPath`,
  });
  const warnings = [];

  let directoryEntries;

  try {
    directoryEntries = await readdir(sourceRootPath, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') {
      return {
        sourceDefinition: normalizedSource,
        sourceRootPath,
        files: [],
        warnings: [`Memory source ${normalizedSource.sourceId} rootPath does not exist: ${normalizedSource.rootPath}`],
      };
    }

    throw error;
  }

  const candidateFiles = [];

  for (const directoryEntry of directoryEntries) {
    if (!directoryEntry.isFile()) {
      warnings.push(`Memory source ${normalizedSource.sourceId} skipped non-file entry: ${directoryEntry.name}`);
      continue;
    }

    const extension = path.extname(directoryEntry.name).toLowerCase();

    if (!allowedExtensionSet.has(extension)) {
      warnings.push(`Memory source ${normalizedSource.sourceId} skipped unsupported file extension: ${directoryEntry.name}`);
      continue;
    }

    const absoluteFilePath = path.join(sourceRootPath, directoryEntry.name);
    const fileStat = await stat(absoluteFilePath);

    if (fileStat.size > normalizedSource.readPolicy.maxBytesPerFile) {
      warnings.push(`Memory source ${normalizedSource.sourceId} skipped oversized file ${directoryEntry.name}: ${fileStat.size} bytes exceeds ${normalizedSource.readPolicy.maxBytesPerFile}.`);
      continue;
    }

    candidateFiles.push({
      absoluteFilePath,
      fileName: directoryEntry.name,
      extension,
      sizeBytes: fileStat.size,
      modifiedAt: fileStat.mtime.toISOString(),
      modifiedAtMs: fileStat.mtimeMs,
    });
  }

  candidateFiles.sort((left, right) => {
    if (preferNewest && right.modifiedAtMs !== left.modifiedAtMs) {
      return right.modifiedAtMs - left.modifiedAtMs;
    }

    return left.fileName.localeCompare(right.fileName);
  });

  const selectedFiles = candidateFiles.slice(0, normalizedSource.readPolicy.maxFiles);
  const omittedByLimit = candidateFiles.slice(normalizedSource.readPolicy.maxFiles);

  for (const omittedFile of omittedByLimit) {
    warnings.push(`Memory source ${normalizedSource.sourceId} omitted file due to maxFiles limit: ${omittedFile.fileName}`);
  }

  const files = [];

  for (const selectedFile of selectedFiles) {
    const content = await readFile(selectedFile.absoluteFilePath, 'utf8');

    files.push({
      ...selectedFile,
      relativePath: createMemorySourceFilePath({
        masRootPath,
        absoluteFilePath: selectedFile.absoluteFilePath,
      }),
      content,
      contentSha256: createSha256(content),
    });
  }

  return {
    sourceDefinition: normalizedSource,
    sourceRootPath,
    files,
    warnings,
  };
}
