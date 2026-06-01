import path from 'node:path';
import { readFile } from 'node:fs/promises';

function assertCognitiveIdentitiesRegistryShape(registry) {
  if (!registry || typeof registry !== 'object') {
    throw new Error('Cognitive Identities registry must be an object.');
  }

  if (!Array.isArray(registry.cognitiveIdentities)) {
    throw new Error('Cognitive Identities registry must include a cognitiveIdentities array.');
  }

  const seenCognitiveIdentityIds = new Set();

  for (const entry of registry.cognitiveIdentities) {
    if (!entry || typeof entry !== 'object') {
      throw new Error('Cognitive Identities registry entries must be objects.');
    }

    if (typeof entry.cognitiveIdentityId !== 'string' || entry.cognitiveIdentityId.trim().length === 0) {
      throw new Error('Cognitive Identities registry entries must include a non-empty cognitiveIdentityId.');
    }

    if (typeof entry.rootPath !== 'string' || entry.rootPath.trim().length === 0) {
      throw new Error(`Cognitive Identities registry entry for ${entry.cognitiveIdentityId} must include a non-empty rootPath.`);
    }

    if (seenCognitiveIdentityIds.has(entry.cognitiveIdentityId)) {
      throw new Error(`Cognitive Identities registry contains a duplicated cognitiveIdentityId: ${entry.cognitiveIdentityId}`);
    }

    seenCognitiveIdentityIds.add(entry.cognitiveIdentityId);
  }

  return registry;
}

export async function readCognitiveIdentitiesRegistry({ masRootPath }) {
  const registryPath = path.join(masRootPath, 'registries', 'cognitive-identities.json');
  const fileContent = await readFile(registryPath, 'utf8');
  const parsedRegistry = JSON.parse(fileContent);

  return {
    registryPath,
    registry: assertCognitiveIdentitiesRegistryShape(parsedRegistry),
  };
}
