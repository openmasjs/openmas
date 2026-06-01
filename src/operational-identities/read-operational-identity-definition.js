import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { assertOperationalIdentityDefinition } from '../contracts/identity/operational-identity-contract.js';

export async function readOperationalIdentityDefinition({ operationalIdentityRootPath }) {
  const definitionPath = path.join(operationalIdentityRootPath, 'identity.json');
  const fileContent = await readFile(definitionPath, 'utf8');
  const parsedDefinition = JSON.parse(fileContent);

  return {
    definitionPath,
    definition: assertOperationalIdentityDefinition(parsedDefinition),
  };
}
