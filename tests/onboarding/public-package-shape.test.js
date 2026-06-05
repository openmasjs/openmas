import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OPENMAS_CLI_PATH = path.join(REPOSITORY_ROOT, 'bin', 'openmas.js');
const CREATE_OPENMAS_PACKAGE_PATH = path.join(REPOSITORY_ROOT, 'packages', 'create-openmas');
const CREATE_OPENMAS_CLI_PATH = path.join(CREATE_OPENMAS_PACKAGE_PATH, 'bin', 'create-openmas.js');
const OPENMAS_HOMEPAGE = 'https://openmas.dev/';
const OPENMAS_REPOSITORY_URL = 'git+https://github.com/openmasjs/openmas.git';
const OPENMAS_BUGS_URL = 'https://github.com/openmasjs/openmas/issues';

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

function runNode(args, options = {}) {
  return spawnSync(process.execPath, args, {
    cwd: REPOSITORY_ROOT,
    encoding: 'utf8',
    ...options,
  });
}

function assertCommonPublicPackageMetadata(packageManifest) {
  assert.equal(packageManifest.homepage, OPENMAS_HOMEPAGE);
  assert.deepEqual(packageManifest.repository, {
    type: 'git',
    url: OPENMAS_REPOSITORY_URL,
    ...(packageManifest.name === 'create-openmas' ? { directory: 'packages/create-openmas' } : {}),
  });
  assert.deepEqual(packageManifest.bugs, {
    url: OPENMAS_BUGS_URL,
  });
  assert.deepEqual(packageManifest.publishConfig, {
    tag: 'alpha',
  });
  assert.equal(packageManifest.license, 'MIT');
  assert.equal(packageManifest.engines.node, '>=22.0.0');
  assert.ok(packageManifest.keywords.includes('openmas'));
  assert.ok(packageManifest.keywords.includes('multi-agent-system'));
  assert.ok(packageManifest.keywords.includes('mas'));
}

test('root package exposes the public openmas CLI shape', async () => {
  const packageManifest = await readJson(path.join(REPOSITORY_ROOT, 'package.json'));

  assert.equal(packageManifest.name, 'openmas');
  assert.equal(packageManifest.private, false);
  assert.equal(packageManifest.description, 'Open Source Multi-Agent System (MAS) Framework');
  assert.equal(packageManifest.type, 'module');
  assert.equal(packageManifest.bin.openmas, './bin/openmas.js');
  assertCommonPublicPackageMetadata(packageManifest);
  assert.ok(packageManifest.files.includes('AGENTS.md'));
  assert.ok(packageManifest.files.includes('CHANGELOG.md'));
  assert.ok(packageManifest.files.includes('LICENSE'));
  assert.ok(packageManifest.files.includes('README.md'));
  assert.ok(packageManifest.files.includes('bin/'));
  assert.ok(packageManifest.files.includes('src/'));
  assert.ok(!packageManifest.files.some((entry) => entry.startsWith('docs/')));
  assert.ok(!packageManifest.files.some((entry) => entry.startsWith('config/')));
  assert.ok(!packageManifest.files.some((entry) => entry.startsWith('instance/')));
  assert.equal(packageManifest.openmas.projectKind, 'framework');
  assert.equal(packageManifest.openmas.schemaVersion, 1);
});

test('create-openmas package exposes the npm create binary shape', async () => {
  const packageManifest = await readJson(path.join(CREATE_OPENMAS_PACKAGE_PATH, 'package.json'));

  assert.equal(packageManifest.name, 'create-openmas');
  assert.equal(packageManifest.private, false);
  assert.equal(packageManifest.description, 'Create an OpenMAS AI-native habitat');
  assert.equal(packageManifest.type, 'module');
  assert.equal(packageManifest.bin['create-openmas'], './bin/create-openmas.js');
  assertCommonPublicPackageMetadata(packageManifest);
  assert.ok(packageManifest.files.includes('README.md'));
  assert.ok(packageManifest.files.includes('LICENSE'));
  assert.ok(packageManifest.files.includes('bin/'));
  assert.ok(packageManifest.files.includes('templates/'));
  assert.ok(!packageManifest.files.some((entry) => entry.startsWith('docs/')));
});

test('create-openmas help and next steps include npm and pnpm paths', async () => {
  const parentPath = await mkdtemp(path.join(os.tmpdir(), 'openmas-public-package-help-'));
  const helpResult = runNode([
    CREATE_OPENMAS_CLI_PATH,
    '--help',
  ]);
  const createResult = runNode([
    CREATE_OPENMAS_CLI_PATH,
    'public-package-help-habitat',
  ], {
    cwd: parentPath,
  });

  assert.equal(helpResult.status, 0);
  assert.match(helpResult.stdout, /npm create openmas@alpha <habitat-name>/u);
  assert.match(helpResult.stdout, /pnpm create openmas@alpha <habitat-name>/u);
  assert.equal(helpResult.stderr, '');

  assert.equal(createResult.status, 0, createResult.stderr);
  assert.match(createResult.stdout, /npm install/u);
  assert.match(createResult.stdout, /pnpm install/u);
});

test('public README tells the Alpha regular-user happy path honestly', async () => {
  const readme = await readFile(path.join(REPOSITORY_ROOT, 'README.md'), 'utf8');

  assert.match(readme, /npm create openmas@alpha marketing-and-sales-department/u);
  assert.match(readme, /pnpm create openmas@alpha marketing-and-sales-department/u);
  assert.match(readme, /npx openmas invoke alfred hello/u);
  assert.match(readme, /npx openmas invoke bruce hello/u);
  assert.match(readme, /providers\.openrouter\.shared\.default\.api_key/u);
  assert.match(readme, /openrouter\/free/u);
  assert.match(readme, /Deterministic invocation does not call an AI provider/u);
  assert.match(readme, /Probabilistic invocation calls the configured provider/u);
  assert.match(readme, /terminal CLI is the Alpha bootstrap, administration, and diagnostic surface/u);
  assert.match(readme, /WhatsApp, Telegram, Slack, and email/u);
  assert.match(readme, /Docker is intentionally single-container for Alpha/u);
  assert.match(readme, /AGENTS\.md/u);
  assert.match(readme, /Cross-Platform Notes/u);
  assert.doesNotMatch(readme, /docs\/architecture/u);
  assert.doesNotMatch(readme, /sk-or-|AIza|OPENMAS_MASTER_KEY/u);
});

test('create-openmas README renders a standalone npm package landing page', async () => {
  const readme = await readFile(path.join(CREATE_OPENMAS_PACKAGE_PATH, 'README.md'), 'utf8');

  assert.match(readme, /^# create-openmas/mu);
  assert.match(readme, /Create a new OpenMAS AI-native habitat/u);
  assert.match(readme, /npm create openmas@alpha marketing-and-sales-department/u);
  assert.match(readme, /pnpm create openmas@alpha marketing-and-sales-department/u);
  assert.match(readme, /npx openmas doctor/u);
  assert.match(readme, /npx openmas invoke alfred hello/u);
  assert.match(readme, /npx openmas invoke bruce hello/u);
  assert.match(readme, /Credential Vault/u);
  assert.match(readme, /Alfred/u);
  assert.match(readme, /Bruce/u);
  assert.match(readme, /https:\/\/openmas\.dev\//u);
  assert.match(readme, /https:\/\/github\.com\/openmasjs\/openmas\/issues/u);
  assert.doesNotMatch(readme, /sk-or-|AIza|OPENMAS_MASTER_KEY/u);
});

test('openmas public CLI prints the alpha command surface', () => {
  const result = runNode([
    OPENMAS_CLI_PATH,
    '--help',
  ]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /OpenMAS CLI/u);
  assert.match(result.stdout, /openmas invoke --agent <id>/u);
  assert.match(result.stdout, /openmas invoke <agent> <command>/u);
  assert.match(result.stdout, /openmas ask <agent> <input>/u);
  assert.match(result.stdout, /openmas credentials edit <environment>/u);
  assert.match(result.stdout, /openmas os status/u);
  assert.match(result.stdout, /doctor/u);
  assert.equal(result.stderr, '');
});

test('openmas invoke help explains canonical and human-friendly forms', () => {
  const result = runNode([
    OPENMAS_CLI_PATH,
    'invoke',
    '--help',
  ]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /OpenMAS Invoke/u);
  assert.match(result.stdout, /openmas invoke --agent <id> --mode <mode> --command <command>/u);
  assert.match(result.stdout, /openmas invoke <agent> <command>/u);
  assert.match(result.stdout, /openmas invoke alfred hello/u);
  assert.equal(result.stderr, '');
});

test('openmas os public subcommands map to service-oriented verbs', () => {
  const helpResult = runNode([
    OPENMAS_CLI_PATH,
    'os',
    '--help',
  ]);
  const unsupportedResult = runNode([
    OPENMAS_CLI_PATH,
    'os',
    'unsupported-command',
  ]);

  assert.equal(helpResult.status, 0);
  assert.match(helpResult.stdout, /OpenMAS OS/u);
  assert.match(helpResult.stdout, /openmas os status/u);
  assert.match(helpResult.stdout, /openmas os watch/u);
  assert.match(helpResult.stdout, /openmas os submit-system-call/u);
  assert.equal(helpResult.stderr, '');

  assert.equal(unsupportedResult.status, 1);
  assert.match(unsupportedResult.stderr, /Unsupported OS command "unsupported-command"/u);
});
