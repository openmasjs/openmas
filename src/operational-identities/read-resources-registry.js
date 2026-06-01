import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { assertResourceRegistry } from '../contracts/access/resource-contract.js';

export async function readResourcesRegistry({ masRootPath }) {
  const registryPath = path.join(masRootPath, 'registries', 'resources.json');

  let fileContent;

  try {
    fileContent = await readFile(registryPath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      return {
        registryPath,
        registry: null,
      };
    }

    throw error;
  }

  const parsedRegistry = JSON.parse(fileContent);

  return {
    registryPath,
    registry: assertResourceRegistry(parsedRegistry),
  };
}
