import path from 'node:path';
import { access } from 'node:fs/promises';
import { readOperationalIdentitiesRegistry } from './read-operational-identities-registry.js';
import { resolveBoundedChildPath } from '../contracts/shared/bounded-path-contract.js';

async function assertPathExists(targetPath, description) {
  try {
    await access(targetPath);
  } catch {
    throw new Error(`${description} does not exist: ${targetPath}`);
  }
}

export async function resolveOperationalIdentityRoot({ masRootPath, operationalIdentityId }) {
  const operationalIdentitiesRootPath = path.join(masRootPath, 'operational-identities');
  const { registryPath, registry } = await readOperationalIdentitiesRegistry({ masRootPath });
  const registryEntry = registry.operationalIdentities.find((entry) => entry.operationalIdentityId === operationalIdentityId);

  if (!registryEntry) {
    throw new Error(`Operational Identity registry entry could not be resolved for operationalIdentityId: ${operationalIdentityId}`);
  }

  const operationalIdentityRootPath = resolveBoundedChildPath({
    parentRootPath: operationalIdentitiesRootPath,
    childRootPath: registryEntry.rootPath,
    description: `Operational Identity registry rootPath for ${operationalIdentityId}`,
  });
  await assertPathExists(operationalIdentityRootPath, `Operational Identity root for ${operationalIdentityId}`);

  return {
    operationalIdentityId,
    registryPath,
    registryEntry,
    operationalIdentitiesRootPath,
    operationalIdentityRootPath,
  };
}
