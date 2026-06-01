import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { assertCredentialReferenceRegistry } from '../contracts/credentials/credential-reference-contract.js';

export async function readCredentialReferenceRegistry({ projectRootPath }) {
  const credentialReferenceRegistryPath = path.join(projectRootPath, 'config', 'credential-references.json');

  let fileContent;

  try {
    fileContent = await readFile(credentialReferenceRegistryPath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      return {
        credentialReferenceRegistryPath,
        registry: null,
      };
    }

    throw error;
  }

  const parsedRegistry = JSON.parse(fileContent);
  const registry = assertCredentialReferenceRegistry(parsedRegistry);

  return {
    credentialReferenceRegistryPath,
    registry,
  };
}
