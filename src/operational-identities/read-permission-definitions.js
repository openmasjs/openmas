import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { assertOperationalIdentityPermissions } from '../contracts/access/permission-contract.js';

export async function readPermissionDefinitions({
  operationalIdentityRootPath,
  expectedOperationalIdentityId,
}) {
  const permissionsFilePath = path.join(operationalIdentityRootPath, 'permissions.json');

  let fileContent;

  try {
    fileContent = await readFile(permissionsFilePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      return { path: permissionsFilePath, permissions: null };
    }

    throw error;
  }

  const rawPermissions = JSON.parse(fileContent);
  const permissions = assertOperationalIdentityPermissions(rawPermissions);

  if (
    expectedOperationalIdentityId
    && permissions.operationalIdentityId !== expectedOperationalIdentityId
  ) {
    throw new Error(
      `Permissions file operationalIdentityId mismatch: expected "${expectedOperationalIdentityId}" but found "${permissions.operationalIdentityId}".`,
    );
  }

  return { path: permissionsFilePath, permissions };
}
