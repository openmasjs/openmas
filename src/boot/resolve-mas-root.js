import path from 'node:path';
import { access } from 'node:fs/promises';

async function ensurePathExists(targetPath, description) {
  try {
    await access(targetPath);
  } catch {
    throw new Error(`${description} does not exist: ${targetPath}`);
  }
}

export async function resolveMasRoot({ projectRootPath, masRootHint = 'instance' }) {
  const masRootPath = path.resolve(projectRootPath, masRootHint);

  await ensurePathExists(masRootPath, 'MAS Root');

  return {
    masRootHint,
    masRootPath,
  };
}
