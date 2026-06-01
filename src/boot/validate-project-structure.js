import path from 'node:path';
import { access } from 'node:fs/promises';

const REQUIRED_PROJECT_COMPONENTS = [
  'package.json',
  'bin',
  'src',
  'docs',
  'var',
  'instance',
];

const OPTIONAL_PROJECT_COMPONENTS = [
  'tests',
  'config',
];

async function pathExists(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function validateProjectStructure(projectRootPath) {
  const presentComponents = [];
  const missingRequiredComponents = [];
  const missingOptionalComponents = [];

  for (const component of REQUIRED_PROJECT_COMPONENTS) {
    const componentPath = path.join(projectRootPath, component);
    const exists = await pathExists(componentPath);

    if (exists) {
      presentComponents.push(component);
      continue;
    }

    missingRequiredComponents.push(component);
  }

  for (const component of OPTIONAL_PROJECT_COMPONENTS) {
    const componentPath = path.join(projectRootPath, component);
    const exists = await pathExists(componentPath);

    if (exists) {
      presentComponents.push(component);
      continue;
    }

    missingOptionalComponents.push(component);
  }

  return {
    rootPath: projectRootPath,
    requiredComponents: REQUIRED_PROJECT_COMPONENTS,
    optionalComponents: OPTIONAL_PROJECT_COMPONENTS,
    presentComponents,
    missingRequiredComponents,
    missingOptionalComponents,
  };
}
