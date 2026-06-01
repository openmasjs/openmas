import path from 'node:path';
import { access } from 'node:fs/promises';

const REQUIRED_COGNITIVE_IDENTITY_COMPONENTS = [
  'identity.md',
  'policies.md',
  'capabilities.md',
];

const OPTIONAL_COGNITIVE_IDENTITY_COMPONENTS = [
  'memory',
];

async function pathExists(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function readCognitiveIdentityDefinition({ cognitiveIdentityRootPath }) {
  const presentComponents = [];
  const missingRequiredComponents = [];
  const missingOptionalComponents = [];

  for (const component of REQUIRED_COGNITIVE_IDENTITY_COMPONENTS) {
    const componentPath = path.join(cognitiveIdentityRootPath, component);
    const exists = await pathExists(componentPath);

    if (exists) {
      presentComponents.push(component);
      continue;
    }

    missingRequiredComponents.push(component);
  }

  for (const component of OPTIONAL_COGNITIVE_IDENTITY_COMPONENTS) {
    const componentPath = path.join(cognitiveIdentityRootPath, component);
    const exists = await pathExists(componentPath);

    if (exists) {
      presentComponents.push(component);
      continue;
    }

    missingOptionalComponents.push(component);
  }

  return {
    cognitiveIdentityRootPath,
    requiredComponents: REQUIRED_COGNITIVE_IDENTITY_COMPONENTS,
    optionalComponents: OPTIONAL_COGNITIVE_IDENTITY_COMPONENTS,
    presentComponents,
    missingRequiredComponents,
    missingOptionalComponents,
  };
}
