#!/usr/bin/env node

import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  mkdir,
  readdir,
  readFile,
  stat,
  writeFile,
} from 'node:fs/promises';

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE_ROOT = path.join(PACKAGE_ROOT, 'templates', 'alpha-habitat');
const TEXT_FILE_EXTENSIONS = new Set([
  '',
  '.json',
  '.js',
  '.md',
  '.txt',
  '.gitkeep',
  '.dockerignore',
  '.cmd',
]);

function printHelp() {
  console.log('Create OpenMAS Habitat');
  console.log('');
  console.log('Usage:');
  console.log('  npm create openmas@alpha <habitat-name>');
  console.log('  pnpm create openmas@alpha <habitat-name>');
  console.log('');
  console.log('Examples:');
  console.log('  npm create openmas@alpha marketing-department');
  console.log('  pnpm create openmas@alpha marketing-department');
}

function normalizePackageName(habitatName) {
  return habitatName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function parseArguments(argv) {
  const [habitatName] = argv.filter((argument) => {
    return argument !== '--';
  });

  if (!habitatName || habitatName === '--help' || habitatName === '-h') {
    return {
      help: true,
      habitatName: null,
    };
  }

  if (habitatName.includes('\0')) {
    throw new Error('Habitat name contains an invalid null byte.');
  }

  const destinationPath = path.resolve(process.cwd(), habitatName);
  const parentPath = path.resolve(process.cwd());

  if (destinationPath !== parentPath && !destinationPath.startsWith(`${parentPath}${path.sep}`)) {
    throw new Error('Habitat path must stay inside the current working directory.');
  }

  return {
    help: false,
    habitatName,
    packageName: normalizePackageName(path.basename(destinationPath)),
    destinationPath,
  };
}

async function assertDestinationIsSafe(destinationPath) {
  try {
    const destinationStats = await stat(destinationPath);

    if (!destinationStats.isDirectory()) {
      throw new Error(`Destination exists and is not a directory: ${destinationPath}`);
    }

    const entries = await readdir(destinationPath);

    if (entries.length > 0) {
      throw new Error(`Destination directory is not empty: ${destinationPath}`);
    }
  } catch (error) {
    if (error.code === 'ENOENT') {
      return;
    }

    throw error;
  }
}

async function readCreatePackageVersion() {
  const packageJson = JSON.parse(await readFile(path.join(PACKAGE_ROOT, 'package.json'), 'utf8'));
  return packageJson.version;
}

function mapTemplateFileName(fileName) {
  if (fileName === '_gitignore') {
    return '.gitignore';
  }

  if (fileName === '_dockerignore') {
    return '.dockerignore';
  }

  return fileName;
}

function shouldTreatAsText(filePath) {
  return TEXT_FILE_EXTENSIONS.has(path.extname(filePath));
}

function applyTemplateTokens(content, {
  habitatName,
  packageName,
  openmasVersion,
}) {
  return content
    .replaceAll('__HABITAT_NAME__', habitatName)
    .replaceAll('__HABITAT_PACKAGE_NAME__', packageName)
    .replaceAll('__OPENMAS_VERSION__', openmasVersion);
}

async function copyTemplateDirectory(sourcePath, destinationPath, tokens) {
  await mkdir(destinationPath, { recursive: true });

  for (const entry of await readdir(sourcePath, { withFileTypes: true })) {
    const sourceEntryPath = path.join(sourcePath, entry.name);
    const destinationEntryPath = path.join(destinationPath, mapTemplateFileName(entry.name));

    if (entry.isDirectory()) {
      await copyTemplateDirectory(sourceEntryPath, destinationEntryPath, tokens);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    if (shouldTreatAsText(sourceEntryPath)) {
      const content = await readFile(sourceEntryPath, 'utf8');
      await writeFile(destinationEntryPath, applyTemplateTokens(content, tokens), 'utf8');
      continue;
    }

    await writeFile(destinationEntryPath, await readFile(sourceEntryPath));
  }
}

async function createHabitat(options) {
  const openmasVersion = await readCreatePackageVersion();

  await assertDestinationIsSafe(options.destinationPath);
  await copyTemplateDirectory(TEMPLATE_ROOT, options.destinationPath, {
    habitatName: options.habitatName,
    packageName: options.packageName || 'openmas-habitat',
    openmasVersion,
  });

  console.log('OpenMAS habitat created');
  console.log(`Habitat: ${options.habitatName}`);
  console.log(`Path: ${options.destinationPath}`);
  console.log('');
  console.log('Next:');
  console.log(`  cd ${options.habitatName}`);
  console.log('  npm install');
  console.log('  # or: pnpm install');
  console.log('  npx openmas --help');
  console.log('  npx openmas doctor');
  console.log('  npx openmas invoke alfred hello');
  console.log('  npx openmas credentials edit development');
  console.log('  npx openmas ask alfred "Please inspect this habitat."');
}

try {
  const options = parseArguments(process.argv.slice(2));

  if (options.help) {
    printHelp();
  } else {
    await createHabitat(options);
  }
} catch (error) {
  console.error('Create OpenMAS Habitat');
  console.error('Status: failed');
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
}
