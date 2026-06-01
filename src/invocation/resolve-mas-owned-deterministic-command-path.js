import path from 'node:path';

const MAS_OWNED_COMMAND_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export class InvalidMasOwnedDeterministicCommandNameError extends Error {}

export function assertValidMasOwnedDeterministicCommandName(commandName) {
  if (!isNonEmptyString(commandName)) {
    throw new InvalidMasOwnedDeterministicCommandNameError(
      'MAS-owned deterministic command name must be a non-empty string.',
    );
  }

  const normalizedCommandName = commandName.trim();

  if (!MAS_OWNED_COMMAND_NAME_PATTERN.test(normalizedCommandName)) {
    throw new InvalidMasOwnedDeterministicCommandNameError(
      `MAS-owned deterministic command name is invalid: ${normalizedCommandName}`,
    );
  }

  return normalizedCommandName;
}

export function resolveMasOwnedDeterministicCommandPath({
  cognitiveIdentityRootPath,
  commandName,
}) {
  if (!isNonEmptyString(cognitiveIdentityRootPath)) {
    throw new Error('MAS-owned deterministic command resolution requires a non-empty cognitiveIdentityRootPath.');
  }

  const normalizedCommandName = assertValidMasOwnedDeterministicCommandName(commandName);
  const commandRootPath = path.resolve(cognitiveIdentityRootPath, 'commands');
  const commandModulePath = path.resolve(commandRootPath, `${normalizedCommandName}.js`);

  return {
    commandRootPath,
    commandModulePath,
    commandName: normalizedCommandName,
  };
}
