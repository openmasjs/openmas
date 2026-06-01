import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readdir, readFile } from 'node:fs/promises';

const SCANNED_ROOTS = Object.freeze([
  'src',
  'bin',
  'tests',
]);

const SCANNED_FILES = Object.freeze([
  'AGENTS.md',
  'README.md',
  'package.json',
  'config/credential-references.json',
]);

const CONCRETE_SECRET_PATTERNS = Object.freeze([
  {
    label: 'OpenRouter-style API key',
    pattern: new RegExp(`${['sk', 'or', 'v1'].join('-')}-[A-Za-z0-9_-]{12,}`, 'gu'),
  },
  {
    label: 'Gemini-style API key',
    pattern: new RegExp(`${['AI', 'za'].join('')}[0-9A-Za-z_-]{12,}`, 'gu'),
  },
  {
    label: 'Anthropic-style API key',
    pattern: new RegExp(`${['sk', 'ant'].join('-')}-[A-Za-z0-9_-]{8,}`, 'gu'),
  },
  {
    label: 'OpenAI-style test secret',
    pattern: new RegExp(`${['sk', 'testsecret'].join('-')}[0-9A-Za-z_-]{8,}`, 'gu'),
  },
]);

async function pathExists(filePath) {
  try {
    await readFile(filePath, 'utf8');
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return false;
    }

    throw error;
  }
}

async function collectJavaScriptFiles(directoryPath) {
  const entries = await readdir(directoryPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(directoryPath, entry.name);

    if (entry.isDirectory()) {
      files.push(...await collectJavaScriptFiles(entryPath));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      files.push(entryPath);
    }
  }

  return files;
}

async function collectScannedFiles(projectRootPath) {
  const files = [];

  for (const root of SCANNED_ROOTS) {
    files.push(...await collectJavaScriptFiles(path.join(projectRootPath, root)));
  }

  for (const relativeFilePath of SCANNED_FILES) {
    const filePath = path.join(projectRootPath, relativeFilePath);

    if (await pathExists(filePath)) {
      files.push(filePath);
    }
  }

  return files;
}

test('src, bin, and tests do not contain static provider-shaped secret fixtures', async () => {
  const projectRootPath = process.cwd();
  const files = await collectScannedFiles(projectRootPath);
  const findings = [];

  for (const filePath of files) {
    const content = await readFile(filePath, 'utf8');
    const relativeFilePath = path.relative(projectRootPath, filePath);

    for (const { label, pattern } of CONCRETE_SECRET_PATTERNS) {
      for (const match of content.matchAll(pattern)) {
        findings.push(`${relativeFilePath}: ${label} literal "${match[0]}"`);
      }
    }
  }

  assert.deepEqual(
    findings,
    [],
    [
      'Static provider-shaped secret fixtures are not allowed in public source.',
      'Use tests/helpers/fake-secret-probes.js to build redaction probes at runtime.',
    ].join(' '),
  );
});
