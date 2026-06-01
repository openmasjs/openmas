import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { assertExecutionProfileDefinition } from '../contracts/identity/execution-profile-contract.js';

export async function readExecutionProfileDefinition({
  operationalIdentityRootPath,
  expectedExecutionProfileId,
}) {
  const definitionPath = path.join(operationalIdentityRootPath, 'execution-profile.json');
  const fileContent = await readFile(definitionPath, 'utf8');
  const parsedDefinition = JSON.parse(fileContent);
  const definition = assertExecutionProfileDefinition(parsedDefinition);

  if (expectedExecutionProfileId && definition.executionProfileId !== expectedExecutionProfileId) {
    throw new Error(
      `Execution Profile definition id mismatch. Expected ${expectedExecutionProfileId}, received ${definition.executionProfileId}.`,
    );
  }

  return {
    definitionPath,
    definition,
  };
}
