import path from 'node:path';
import { access } from 'node:fs/promises';

const REQUIRED_MAS_COMPONENTS = [
  'cognitive-identities',
  'memory',
  path.join('memory', 'knowledge'),
  path.join('memory', 'policies'),
  path.join('memory', 'state'),
  path.join('memory', 'artifacts'),
  'tools',
  'workflows',
  'registries',
  'evaluations',
];

async function pathExists(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function validateMasStructure(masRootPath) {
  const presentComponents = [];
  const missingRequiredComponents = [];

  for (const component of REQUIRED_MAS_COMPONENTS) {
    const componentPath = path.join(masRootPath, component);
    const exists = await pathExists(componentPath);

    if (exists) {
      presentComponents.push(component);
      continue;
    }

    missingRequiredComponents.push(component);
  }

  return {
    rootPath: masRootPath,
    requiredComponents: REQUIRED_MAS_COMPONENTS,
    presentComponents,
    missingRequiredComponents,
  };
}
