#!/usr/bin/env node

import path from 'node:path';
import process from 'node:process';
import { access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HABITAT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INSTALLED_OPENMAS_CLI = path.join(HABITAT_ROOT, 'node_modules', 'openmas', 'bin', 'openmas.js');

async function installedOpenMasCliExists() {
  try {
    await access(INSTALLED_OPENMAS_CLI);
    return true;
  } catch {
    return false;
  }
}

if (!(await installedOpenMasCliExists())) {
  console.error('OpenMAS local wrapper failed');
  console.error(`Error: Installed OpenMAS CLI not found at ${INSTALLED_OPENMAS_CLI}.`);
  console.error('Next: run npm install or pnpm install inside this habitat, then retry the command.');
  process.exitCode = 1;
} else {
  const result = spawnSync(
    process.execPath,
    [
      INSTALLED_OPENMAS_CLI,
      ...process.argv.slice(2),
    ],
    {
      cwd: HABITAT_ROOT,
      env: process.env,
      stdio: 'inherit',
    },
  );

  if (typeof result.status === 'number') {
    process.exitCode = result.status;
  } else {
    console.error(`OpenMAS local wrapper failed to launch: ${result.error?.message ?? 'unknown error'}`);
    process.exitCode = 1;
  }
}
