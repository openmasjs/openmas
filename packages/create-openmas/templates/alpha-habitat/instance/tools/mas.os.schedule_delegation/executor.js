import { executeMasOsScheduleDelegation } from 'openmas/src/os/actions/mas-os-schedule-delegation-runtime.js';

export async function executeTool({
  input = {},
  projectRootPath,
  operationalIdentityId,
  invocationId,
}) {
  return executeMasOsScheduleDelegation({
    input,
    projectRootPath,
    operationalIdentityId,
    invocationId,
  });
}
