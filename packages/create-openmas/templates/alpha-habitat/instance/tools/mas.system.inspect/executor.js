import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

async function listDirectoryNames(directoryPath) {
  try {
    const entries = await readdir(directoryPath, { withFileTypes: true });

    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .toSorted((left, right) => left.localeCompare(right));
  } catch {
    return [];
  }
}

export async function executeTool({
  masRootPath,
}) {
  const cognitiveRegistry = await readJson(
    path.join(masRootPath, 'registries', 'cognitive-identities.json'),
    { cognitiveIdentities: [] },
  );
  const operationalRegistry = await readJson(
    path.join(masRootPath, 'registries', 'operational-identities.json'),
    { operationalIdentities: [] },
  );
  const resourcesRegistry = await readJson(
    path.join(masRootPath, 'registries', 'resources.json'),
    { resources: [] },
  );
  const toolIds = await listDirectoryNames(path.join(masRootPath, 'tools'));

  return {
    status: 'succeeded',
    summary: 'Starter OpenMAS habitat inspection completed without mutation.',
    data: {
      cognitiveIdentityIds: cognitiveRegistry.cognitiveIdentities.map((entry) => {
        return entry.cognitiveIdentityId;
      }),
      operationalIdentityIds: operationalRegistry.operationalIdentities.map((entry) => {
        return entry.operationalIdentityId;
      }),
      resourceIds: resourcesRegistry.resources.map((entry) => {
        return entry.resourceId;
      }),
      toolIds,
    },
    warnings: [],
    errors: [],
  };
}
