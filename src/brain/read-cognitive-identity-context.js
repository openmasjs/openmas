import path from 'node:path';
import { readFile } from 'node:fs/promises';

async function readRequiredTextFile(filePath, description) {
  const content = await readFile(filePath, 'utf8');

  if (typeof content !== 'string' || content.trim().length === 0) {
    throw new Error(`${description} at ${filePath} is empty.`);
  }

  return content.trim();
}

export async function readCognitiveIdentityContext({ cognitiveIdentityRootPath, cognitiveIdentityId }) {
  return {
    cognitiveIdentityId,
    identityText: await readRequiredTextFile(
      path.join(cognitiveIdentityRootPath, 'identity.md'),
      `Cognitive Identity ${cognitiveIdentityId} identity.md`,
    ),
    policiesText: await readRequiredTextFile(
      path.join(cognitiveIdentityRootPath, 'policies.md'),
      `Cognitive Identity ${cognitiveIdentityId} policies.md`,
    ),
    capabilitiesText: await readRequiredTextFile(
      path.join(cognitiveIdentityRootPath, 'capabilities.md'),
      `Cognitive Identity ${cognitiveIdentityId} capabilities.md`,
    ),
  };
}
