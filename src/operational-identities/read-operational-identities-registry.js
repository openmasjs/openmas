import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { assertOperationalIdentityRegistry } from '../contracts/identity/operational-identity-contract.js';

export async function readOperationalIdentitiesRegistry({ masRootPath }) {
  const registryPath = path.join(masRootPath, 'registries', 'operational-identities.json');
  const fileContent = await readFile(registryPath, 'utf8');
  const parsedRegistry = JSON.parse(fileContent);

  return {
    registryPath,
    registry: assertOperationalIdentityRegistry(parsedRegistry),
  };
}
