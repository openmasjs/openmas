import path from 'node:path';
import { readdir, readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolveBoundedChildPath } from '../contracts/shared/bounded-path-contract.js';
import { assertMasPolicySources } from '../contracts/policies/mas-policy-source-contract.js';

const MAS_POLICY_ROOT_PATH = 'memory/policies';
const DEFAULT_MAX_POLICY_FILES = 20;
const DEFAULT_MAX_BYTES_PER_POLICY_FILE = 32768;
const SUPPORTED_POLICY_EXTENSIONS = new Set(['.md', '.txt', '.json']);

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function createSha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function toPosixPath(value) {
  return value.split(path.sep).join('/');
}

function createSourcePath({ masRootPath, filePath }) {
  return `instance/${toPosixPath(path.relative(masRootPath, filePath))}`;
}

function createSourceId(fileName) {
  return fileName
    .trim()
    .replace(/\.[^.]+$/u, '')
    .replace(/[^A-Za-z0-9_-]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .toLowerCase();
}

function extractTitle({ fileName, content }) {
  const heading = content
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => /^#\s+/u.test(line));

  if (heading) {
    return heading.replace(/^#\s+/u, '').trim();
  }

  return fileName.replace(/\.[^.]+$/u, '').replace(/[-_]+/gu, ' ').trim();
}

function parseJsonPolicyFile({ fileName, content }) {
  let parsedPolicy;

  try {
    parsedPolicy = JSON.parse(content);
  } catch {
    return null;
  }

  if (!parsedPolicy || typeof parsedPolicy !== 'object' || Array.isArray(parsedPolicy)) {
    return null;
  }

  if (parsedPolicy.kind !== 'mas_policy_source') {
    return null;
  }

  if (!isNonEmptyString(parsedPolicy.content)) {
    throw new Error(`MAS policy JSON file ${fileName} must include non-empty content.`);
  }

  return parsedPolicy;
}

async function readPolicyFiles({
  masRootPath,
  policyRootPath,
  maxFiles,
  maxBytesPerFile,
}) {
  const absolutePolicyRootPath = resolveBoundedChildPath({
    parentRootPath: masRootPath,
    childRootPath: policyRootPath,
    description: 'MAS policy rootPath',
  });
  const warnings = [];
  let directoryEntries;

  try {
    directoryEntries = await readdir(absolutePolicyRootPath, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') {
      return {
        files: [],
        warnings,
      };
    }

    throw error;
  }

  const candidateFiles = [];

  for (const directoryEntry of directoryEntries) {
    if (!directoryEntry.isFile()) {
      warnings.push(`MAS policy reader skipped non-file entry: ${directoryEntry.name}`);
      continue;
    }

    const extension = path.extname(directoryEntry.name).toLowerCase();

    if (!SUPPORTED_POLICY_EXTENSIONS.has(extension)) {
      warnings.push(`MAS policy reader skipped unsupported file extension: ${directoryEntry.name}`);
      continue;
    }

    const filePath = path.join(absolutePolicyRootPath, directoryEntry.name);
    const fileStat = await stat(filePath);

    if (fileStat.size > maxBytesPerFile) {
      warnings.push(`MAS policy reader skipped oversized file ${directoryEntry.name}: ${fileStat.size} bytes exceeds ${maxBytesPerFile}.`);
      continue;
    }

    candidateFiles.push({
      fileName: directoryEntry.name,
      filePath,
      modifiedAt: fileStat.mtime.toISOString(),
      modifiedAtMs: fileStat.mtimeMs,
    });
  }

  candidateFiles.sort((left, right) => {
    return left.fileName.localeCompare(right.fileName);
  });

  const selectedFiles = candidateFiles.slice(0, maxFiles);
  const omittedFiles = candidateFiles.slice(maxFiles);

  for (const omittedFile of omittedFiles) {
    warnings.push(`MAS policy reader omitted file due to maxFiles limit: ${omittedFile.fileName}`);
  }

  const files = [];

  for (const selectedFile of selectedFiles) {
    files.push({
      ...selectedFile,
      content: await readFile(selectedFile.filePath, 'utf8'),
    });
  }

  return {
    files,
    warnings,
  };
}

function normalizePolicySource({ masRootPath, file }) {
  const jsonPolicy = path.extname(file.fileName).toLowerCase() === '.json'
    ? parseJsonPolicyFile({
      fileName: file.fileName,
      content: file.content,
    })
    : null;
  const sourceId = jsonPolicy?.sourceId ?? createSourceId(file.fileName);
  const content = jsonPolicy?.content ?? file.content;

  return {
    kind: 'mas_policy_source',
    version: jsonPolicy?.version ?? 1,
    sourceId,
    title: jsonPolicy?.title ?? extractTitle({
      fileName: file.fileName,
      content,
    }),
    sourcePath: createSourcePath({
      masRootPath,
      filePath: file.filePath,
    }),
    lifecycleState: jsonPolicy?.lifecycleState ?? 'active',
    priority: jsonPolicy?.priority ?? 100,
    content,
    contentSha256: createSha256(content),
    modifiedAt: file.modifiedAt,
    warnings: jsonPolicy?.warnings ?? [],
  };
}

export async function readMasPolicySourcesForInvocation({
  masRootPath,
  policyRootPath = MAS_POLICY_ROOT_PATH,
  maxFiles = DEFAULT_MAX_POLICY_FILES,
  maxBytesPerFile = DEFAULT_MAX_BYTES_PER_POLICY_FILE,
} = {}) {
  if (!isNonEmptyString(masRootPath)) {
    throw new Error('MAS policy reader requires a non-empty masRootPath.');
  }

  const readResult = await readPolicyFiles({
    masRootPath,
    policyRootPath,
    maxFiles,
    maxBytesPerFile,
  });
  const policySources = [];
  const warnings = [...readResult.warnings];

  for (const file of readResult.files) {
    try {
      policySources.push(normalizePolicySource({
        masRootPath,
        file,
      }));
    } catch (error) {
      warnings.push(`MAS policy reader skipped ${file.fileName}: ${error.message}`);
    }
  }

  const activePolicySources = assertMasPolicySources(policySources)
    .filter((policySource) => {
      return policySource.lifecycleState === 'active';
    })
    .toSorted((left, right) => {
      if (left.priority !== right.priority) {
        return left.priority - right.priority;
      }

      return left.sourceId.localeCompare(right.sourceId);
    });

  return {
    policySources: activePolicySources,
    warnings,
    summary: {
      policiesRead: policySources.length,
      activePolicies: activePolicySources.length,
      warnings: warnings.length,
    },
  };
}

export {
  DEFAULT_MAX_BYTES_PER_POLICY_FILE,
  DEFAULT_MAX_POLICY_FILES,
  MAS_POLICY_ROOT_PATH,
};
