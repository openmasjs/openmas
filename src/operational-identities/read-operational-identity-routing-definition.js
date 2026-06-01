import path from 'node:path';
import { access, readFile } from 'node:fs/promises';
import { assertOperationalIdentityRoutingDefinition } from '../contracts/identity/operational-identity-contract.js';

async function pathExists(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function readOperationalIdentityRoutingDefinition({ operationalIdentityRootPath }) {
  const definitionPath = path.join(operationalIdentityRootPath, 'routing.json');
  const routingDefinitionExists = await pathExists(definitionPath);

  if (!routingDefinitionExists) {
    return {
      definitionPath,
      definition: null,
    };
  }

  const fileContent = await readFile(definitionPath, 'utf8');
  const parsedDefinition = JSON.parse(fileContent);

  return {
    definitionPath,
    definition: assertOperationalIdentityRoutingDefinition(parsedDefinition),
  };
}
