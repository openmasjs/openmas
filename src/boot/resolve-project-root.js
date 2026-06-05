import path from 'node:path';
import { access, readFile } from 'node:fs/promises';

const SUPPORTED_OPENMAS_PROJECT_KINDS = new Set([
  'framework',
  'habitat',
]);

async function ensurePathExists(targetPath, description) {
  try {
    await access(targetPath);
  } catch {
    throw new Error(`${description} does not exist: ${targetPath}`);
  }
}

function assertOpenMASProjectManifest(manifest, packageJsonPath) {
  if (!manifest || typeof manifest !== 'object') {
    throw new Error(`Project Root package.json must contain a valid JSON object: ${packageJsonPath}`);
  }

  if (manifest.type !== 'module') {
    throw new Error(`Project Root package.json must declare \"type\": \"module\": ${packageJsonPath}`);
  }

  if (!manifest.openmas || typeof manifest.openmas !== 'object') {
    throw new Error(`Project Root package.json must include an \"openmas\" project marker: ${packageJsonPath}`);
  }

  if (!SUPPORTED_OPENMAS_PROJECT_KINDS.has(manifest.openmas.projectKind)) {
    throw new Error(`Project Root package.json must declare openmas.projectKind as \"framework\" or \"habitat\": ${packageJsonPath}`);
  }

  if (manifest.openmas.schemaVersion !== 1) {
    throw new Error(`Project Root package.json must declare openmas.schemaVersion as 1: ${packageJsonPath}`);
  }

  return manifest;
}

export async function resolveProjectRoot(projectRootPath) {
  const candidateProjectRoot = path.resolve(projectRootPath ?? process.cwd());
  const packageJsonPath = path.join(candidateProjectRoot, 'package.json');

  await ensurePathExists(candidateProjectRoot, 'Project Root');
  await ensurePathExists(packageJsonPath, 'Project Root package.json');
  const packageJsonContent = await readFile(packageJsonPath, 'utf8');
  const packageManifest = JSON.parse(packageJsonContent);
  const validatedManifest = assertOpenMASProjectManifest(packageManifest, packageJsonPath);

  return {
    projectRootPath: candidateProjectRoot,
    packageJsonPath,
    packageManifest: validatedManifest,
  };
}

export {
  SUPPORTED_OPENMAS_PROJECT_KINDS,
};
