import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { assertMemorySourceRegistry } from '../contracts/memory/memory-source-registry-contract.js';
import { buildDefaultMemorySourceRegistry } from './build-default-memory-source-registry.js';

export async function readMemorySourceRegistry({ masRootPath, masOwnerId = 'mas-instance' }) {
  const registryPath = path.join(masRootPath, 'memory', 'sources.json');

  let fileContent;

  try {
    fileContent = await readFile(registryPath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      return {
        registryPath,
        registry: buildDefaultMemorySourceRegistry({ masOwnerId }),
        usedDefaultRegistry: true,
      };
    }

    throw error;
  }

  const parsedRegistry = JSON.parse(fileContent);

  return {
    registryPath,
    registry: assertMemorySourceRegistry(parsedRegistry),
    usedDefaultRegistry: false,
  };
}
