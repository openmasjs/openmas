import path from 'node:path';
import { access } from 'node:fs/promises';

const REQUIRED_FRAMEWORK_PROJECT_COMPONENTS = [
  'package.json',
  'bin',
  'src',
  'docs',
  'var',
  'instance',
];

const REQUIRED_HABITAT_PROJECT_COMPONENTS = [
  'package.json',
  'config',
  'instance',
];

const OPTIONAL_FRAMEWORK_PROJECT_COMPONENTS = [
  'tests',
  'config',
];

const OPTIONAL_HABITAT_PROJECT_COMPONENTS = [
  'README.md',
  'AGENTS.md',
  'Dockerfile',
  '.dockerignore',
];

async function pathExists(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function resolveProjectStructureComponents(projectKind) {
  if (projectKind === 'habitat') {
    return {
      requiredComponents: REQUIRED_HABITAT_PROJECT_COMPONENTS,
      optionalComponents: OPTIONAL_HABITAT_PROJECT_COMPONENTS,
    };
  }

  return {
    requiredComponents: REQUIRED_FRAMEWORK_PROJECT_COMPONENTS,
    optionalComponents: OPTIONAL_FRAMEWORK_PROJECT_COMPONENTS,
  };
}

export async function validateProjectStructure(projectRootPath, {
  projectKind = 'framework',
} = {}) {
  const { requiredComponents, optionalComponents } = resolveProjectStructureComponents(projectKind);
  const presentComponents = [];
  const missingRequiredComponents = [];
  const missingOptionalComponents = [];

  for (const component of requiredComponents) {
    const componentPath = path.join(projectRootPath, component);
    const exists = await pathExists(componentPath);

    if (exists) {
      presentComponents.push(component);
      continue;
    }

    missingRequiredComponents.push(component);
  }

  for (const component of optionalComponents) {
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
    projectKind,
    requiredComponents,
    optionalComponents,
    presentComponents,
    missingRequiredComponents,
    missingOptionalComponents,
  };
}

export {
  OPTIONAL_FRAMEWORK_PROJECT_COMPONENTS,
  OPTIONAL_HABITAT_PROJECT_COMPONENTS,
  REQUIRED_FRAMEWORK_PROJECT_COMPONENTS,
  REQUIRED_HABITAT_PROJECT_COMPONENTS,
};
