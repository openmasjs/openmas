import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  KERNEL_BOUNDARY_MODULE_CLASSIFICATIONS,
  KERNEL_BOUNDARY_ROLES,
  KERNEL_MUTATION_SYMBOLS,
  SYSTEM_CALL_SUBMISSION_SYMBOLS,
  USER_MODE_OS_AFFORDANCE_MODULES,
  classifyKernelBoundaryModule,
} from '../../src/os/kernel-boundary-audit.js';

const PROJECT_ROOT_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BOUNDARY_AUDIT_MODULE = 'src/os/kernel-boundary-audit.js';

async function listJavaScriptFiles(rootPath) {
  const entries = await readdir(rootPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(rootPath, entry.name);

    if (entry.isDirectory()) {
      files.push(...await listJavaScriptFiles(entryPath));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith('.js')) {
      files.push(entryPath);
    }
  }

  return files;
}

function toProjectPath(filePath) {
  return path.relative(PROJECT_ROOT_PATH, filePath).replaceAll(path.sep, '/');
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function includesSymbol(content, symbol) {
  return new RegExp(`\\b${escapeRegex(symbol)}\\b`, 'u').test(content);
}

function collectBoundarySymbols(content) {
  return [
    ...KERNEL_MUTATION_SYMBOLS,
    ...SYSTEM_CALL_SUBMISSION_SYMBOLS,
  ].filter((symbol) => includesSymbol(content, symbol));
}

test('kernel boundary audit classifies every production module that touches OS mutation or System Call intake symbols', async () => {
  const productionFiles = [
    ...await listJavaScriptFiles(path.join(PROJECT_ROOT_PATH, 'src')),
    ...await listJavaScriptFiles(path.join(PROJECT_ROOT_PATH, 'bin')),
  ];
  const violations = [];
  const classifiedPaths = new Set(Object.keys(KERNEL_BOUNDARY_MODULE_CLASSIFICATIONS));

  for (const filePath of productionFiles) {
    const projectPath = toProjectPath(filePath);

    if (projectPath === BOUNDARY_AUDIT_MODULE) {
      continue;
    }

    const content = await readFile(filePath, 'utf8');
    const symbols = collectBoundarySymbols(content);

    if (symbols.length === 0) {
      continue;
    }

    const classification = classifyKernelBoundaryModule(projectPath);

    if (!classification) {
      violations.push(`${projectPath} touches boundary symbols (${symbols.join(', ')}) but has no kernel boundary classification.`);
    }

    classifiedPaths.delete(projectPath);
  }

  classifiedPaths.delete(BOUNDARY_AUDIT_MODULE);

  assert.deepEqual(violations, []);
  assert.deepEqual([...classifiedPaths].sort(), []);
});

test('user-mode mas.os affordances submit System Calls and do not materialize kernel state directly', async () => {
  const violations = [];

  for (const projectPath of USER_MODE_OS_AFFORDANCE_MODULES) {
    const classification = classifyKernelBoundaryModule(projectPath);
    const content = await readFile(path.join(PROJECT_ROOT_PATH, projectPath), 'utf8');

    assert.equal(classification.role, KERNEL_BOUNDARY_ROLES.userModeSystemCallAffordance);
    assert.match(content, /submitOpenMasOsSystemCall/u);

    for (const symbol of KERNEL_MUTATION_SYMBOLS) {
      if (includesSymbol(content, symbol)) {
        violations.push(`${projectPath} must not use kernel mutation symbol ${symbol}.`);
      }
    }
  }

  assert.deepEqual(violations, []);
});

test('System Call clients are classified as intake helpers and do not contain kernel materialization symbols', async () => {
  const systemCallClientPaths = Object.entries(KERNEL_BOUNDARY_MODULE_CLASSIFICATIONS)
    .filter(([, classification]) => {
      return classification.role === KERNEL_BOUNDARY_ROLES.systemCallSubmissionClient;
    })
    .map(([projectPath]) => projectPath);
  const violations = [];

  assert.deepEqual(systemCallClientPaths.sort(), [
    'src/os/system-calls/local-system-call-inbox.js',
    'src/os/system-calls/system-call-client.js',
  ]);

  for (const projectPath of systemCallClientPaths) {
    const content = await readFile(path.join(PROJECT_ROOT_PATH, projectPath), 'utf8');

    for (const symbol of KERNEL_MUTATION_SYMBOLS) {
      if (includesSymbol(content, symbol)) {
        violations.push(`${projectPath} must not materialize kernel state through ${symbol}.`);
      }
    }
  }

  assert.deepEqual(violations, []);
});

test('legacy direct CLI Job runner remains an explicit boundary exception', async () => {
  const projectPath = 'bin/invoke-agent.js';
  const classification = classifyKernelBoundaryModule(projectPath);
  const content = await readFile(path.join(PROJECT_ROOT_PATH, projectPath), 'utf8');

  assert.equal(classification.role, KERNEL_BOUNDARY_ROLES.legacyDirectCliJobRunner);
  assert.match(classification.allowedReason, /technical debt/u);
  assert.equal(includesSymbol(content, 'createJob'), true);
  assert.equal(includesSymbol(content, 'admitJob'), true);
  assert.equal(includesSymbol(content, 'runJobNow'), true);
});
