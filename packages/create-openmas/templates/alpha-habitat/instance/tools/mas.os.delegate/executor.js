import { executeMasOsDelegate } from 'openmas/src/os/actions/mas-os-delegate-runtime.js';

export async function executeTool({
  input = {},
  projectRootPath,
  operationalIdentityId,
  invocationId,
}) {
  return executeMasOsDelegate({
    input,
    projectRootPath,
    operationalIdentityId,
    invocationId,
  });
}
