import { access } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolveMasOwnedDeterministicCommandPath } from './resolve-mas-owned-deterministic-command-path.js';

export class MasOwnedDeterministicCommandNotFoundError extends Error {}

async function assertPathExists(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function loadMasOwnedDeterministicCommand({
  cognitiveIdentityRootPath,
  commandName,
}) {
  const { commandModulePath } = resolveMasOwnedDeterministicCommandPath({
    cognitiveIdentityRootPath,
    commandName,
  });
  const commandModuleExists = await assertPathExists(commandModulePath);

  if (!commandModuleExists) {
    throw new MasOwnedDeterministicCommandNotFoundError(
      `MAS-owned deterministic command module was not found: ${commandModulePath}`,
    );
  }

  const commandModuleUrl = pathToFileURL(commandModulePath).href;
  const importedModule = await import(commandModuleUrl);
  const runDeterministicCommand = importedModule.runDeterministicCommand ?? importedModule.default;

  if (typeof runDeterministicCommand !== 'function') {
    throw new Error(`MAS-owned deterministic command module must export a runDeterministicCommand function: ${commandModulePath}`);
  }

  return {
    commandModulePath,
    runDeterministicCommand,
  };
}
