import { assertIdentityCommandExecutionOutcome } from '../contracts/identity/identity-command-contract.js';
import { loadMasOwnedDeterministicCommand } from './load-mas-owned-deterministic-command.js';

export async function executeMasOwnedDeterministicCommand({
  cognitiveIdentityRootPath,
  commandName,
  bootResult,
  readiness,
  request,
}) {
  const { commandModulePath, runDeterministicCommand } = await loadMasOwnedDeterministicCommand({
    cognitiveIdentityRootPath,
    commandName,
  });

  const executionOutcome = assertIdentityCommandExecutionOutcome(
    await runDeterministicCommand({
      bootResult,
      readiness,
      request,
    }),
  );

  return {
    commandModulePath,
    executionOutcome,
  };
}
