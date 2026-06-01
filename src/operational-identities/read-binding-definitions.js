import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { assertOperationalIdentityBindings } from '../contracts/access/binding-contract.js';

export async function readBindingDefinitions({
  operationalIdentityRootPath,
  expectedOperationalIdentityId,
}) {
  const bindingsPath = path.join(operationalIdentityRootPath, 'bindings.json');

  let fileContent;

  try {
    fileContent = await readFile(bindingsPath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      return {
        bindingsPath,
        bindings: null,
      };
    }

    throw error;
  }

  const parsedBindings = JSON.parse(fileContent);
  const bindings = assertOperationalIdentityBindings(parsedBindings);

  if (expectedOperationalIdentityId && bindings.operationalIdentityId !== expectedOperationalIdentityId) {
    throw new Error(
      `Binding definitions operationalIdentityId mismatch. Expected ${expectedOperationalIdentityId}, received ${bindings.operationalIdentityId}.`,
    );
  }

  return {
    bindingsPath,
    bindings,
  };
}
