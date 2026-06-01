import path from 'node:path';
import { access } from 'node:fs/promises';
import { readCognitiveIdentitiesRegistry } from './read-cognitive-identities-registry.js';
import { resolveBoundedChildPath } from '../contracts/shared/bounded-path-contract.js';

async function assertPathExists(targetPath, description) {
  try {
    await access(targetPath);
  } catch {
    throw new Error(`${description} does not exist: ${targetPath}`);
  }
}

export async function resolveCognitiveIdentityRoot({ masRootPath, cognitiveIdentityId }) {
  const cognitiveIdentitiesRootPath = path.join(masRootPath, 'cognitive-identities');
  const { registryPath, registry } = await readCognitiveIdentitiesRegistry({ masRootPath });
  const registryEntry = registry.cognitiveIdentities.find((entry) => entry.cognitiveIdentityId === cognitiveIdentityId);

  if (!registryEntry) {
    throw new Error(`Cognitive Identity registry entry could not be resolved for cognitiveIdentityId: ${cognitiveIdentityId}`);
  }

  const cognitiveIdentityRootPath = resolveBoundedChildPath({
    parentRootPath: cognitiveIdentitiesRootPath,
    childRootPath: registryEntry.rootPath,
    description: `Cognitive Identity registry rootPath for ${cognitiveIdentityId}`,
  });
  await assertPathExists(cognitiveIdentityRootPath, `Cognitive Identity root for ${cognitiveIdentityId}`);

  return {
    cognitiveIdentityId,
    registryPath,
    registryEntry,
    cognitiveIdentitiesRootPath,
    cognitiveIdentityRootPath,
  };
}
