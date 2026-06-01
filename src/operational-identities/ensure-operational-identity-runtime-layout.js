import path from 'node:path';
import { ensureDirectory } from '../persistence/ensure-directory.js';

export async function ensureOperationalIdentityRuntimeLayout({ operationalIdentityRootPath }) {
  const operationalMemoryRootPath = path.join(operationalIdentityRootPath, 'memory');

  await ensureDirectory(operationalMemoryRootPath);

  return {
    operationalMemoryRootPath,
  };
}
