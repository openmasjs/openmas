import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { generateMasterKey } from '../../src/credentials/generate-master-key.js';
import { writeCredentialVault } from '../../src/credentials/write-credential-vault.js';
import {
  parseOpenMasDoctorCliArgs,
  runOpenMasDoctor,
} from '../../src/onboarding/openmas-doctor.js';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CREATE_OPENMAS_CLI_PATH = path.join(
  REPOSITORY_ROOT,
  'packages',
  'create-openmas',
  'bin',
  'create-openmas.js',
);
const OPENMAS_CLI_PATH = path.join(REPOSITORY_ROOT, 'bin', 'openmas.js');

function runNode(args, options = {}) {
  return spawnSync(process.execPath, args, {
    cwd: REPOSITORY_ROOT,
    encoding: 'utf8',
    ...options,
  });
}

async function createStarterHabitat(habitatName = 'doctor-habitat') {
  const parentPath = await mkdtemp(path.join(os.tmpdir(), 'openmas-doctor-habitat-'));
  const result = runNode([
    CREATE_OPENMAS_CLI_PATH,
    habitatName,
  ], {
    cwd: parentPath,
  });

  assert.equal(result.status, 0, result.stderr);

  return path.join(parentPath, habitatName);
}

test('parseOpenMasDoctorCliArgs accepts project root, environment, JSON, and repeated agent options', () => {
  const options = parseOpenMasDoctorCliArgs([
    '--project-root',
    'marketing-and-sales-department',
    '--environment=development',
    '--agent',
    'alfred',
    '--agent=bruce',
    '--json',
  ]);

  assert.equal(options.projectRootPath, 'marketing-and-sales-department');
  assert.equal(options.environment, 'development');
  assert.equal(options.json, true);
  assert.deepEqual(options.operationalIdentityIds, ['alfred', 'bruce']);
});

test('Doctor reports a fresh generated habitat as deterministic-ready without provider credentials', async () => {
  const habitatPath = await createStarterHabitat('doctor-fresh-habitat');

  const result = await runOpenMasDoctor({
    projectRootPath: habitatPath,
  });

  assert.equal(result.status, 'ready_for_deterministic_runtime');
  assert.equal(result.exitCode, 0);
  assert.equal(result.project.projectKind, 'habitat');
  assert.equal(result.runtime.deterministicInvocation.status, 'ready');
  assert.equal(result.runtime.probabilisticInvocation.status, 'blocked');
  assert.match(result.runtime.probabilisticInvocation.reason, /Credential Vault is not configured/u);
  assert.equal(result.runtime.credentialVault.exists, false);
  assert.equal(result.runtime.credentialVault.environment, 'development');
  assert.deepEqual(
    result.identities.map((identity) => identity.operationalIdentityId),
    ['alfred', 'bruce'],
  );
  assert.ok(result.identities.every((identity) => identity.deterministicReady));
  assert.ok(result.identities.every((identity) => identity.probabilisticCapable));
  assert.ok(result.nextSteps.includes('npx openmas credentials edit development'));
  assert.doesNotMatch(JSON.stringify(result), /sk-or-|AIza|OPENMAS_MASTER_KEY/u);
});

test('Doctor reports probabilistic-ready when required starter credentials exist in the Vault', async () => {
  const habitatPath = await createStarterHabitat('doctor-configured-habitat');
  const masterKey = generateMasterKey();

  await mkdir(path.join(habitatPath, 'config', 'credentials'), { recursive: true });
  await writeFile(path.join(habitatPath, 'config', 'credentials', 'development.key'), `${masterKey}\n`, 'utf8');
  await writeCredentialVault({
    projectRootPath: habitatPath,
    environment: 'development',
    masterKeyHex: masterKey,
    credentials: {
      'providers.openrouter.shared.default.api_key': 'doctor-test-openrouter-api-key',
    },
  });

  const result = await runOpenMasDoctor({
    projectRootPath: habitatPath,
  });

  assert.equal(result.status, 'ready');
  assert.equal(result.exitCode, 0);
  assert.equal(result.runtime.deterministicInvocation.status, 'ready');
  assert.equal(result.runtime.probabilisticInvocation.status, 'ready');
  assert.equal(result.runtime.credentialVault.exists, true);
  assert.equal(result.runtime.credentialVault.credentialCount, 1);
  assert.deepEqual(
    result.runtime.credentialVault.presentCredentialReferenceIds,
    ['providers.openrouter.shared.default.api_key'],
  );
  assert.doesNotMatch(JSON.stringify(result), /doctor-test-openrouter-api-key/u);
});

test('openmas doctor CLI prints human diagnostics for a generated habitat', async () => {
  const habitatPath = await createStarterHabitat('doctor-cli-habitat');
  const result = runNode([
    OPENMAS_CLI_PATH,
    'doctor',
    '--project-root',
    habitatPath,
  ]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /OpenMAS Doctor/u);
  assert.match(result.stdout, /Status: ready_for_deterministic_runtime/u);
  assert.match(result.stdout, /Deterministic invocation: ready/u);
  assert.match(result.stdout, /Probabilistic invocation: blocked/u);
  assert.match(result.stdout, /npx openmas credentials edit development/u);
  assert.equal(result.stderr, '');
});

test('openmas doctor --json returns safe machine-readable diagnostics', async () => {
  const habitatPath = await createStarterHabitat('doctor-json-habitat');
  const result = runNode([
    OPENMAS_CLI_PATH,
    'doctor',
    '--project-root',
    habitatPath,
    '--json',
  ]);
  const doctorResult = JSON.parse(result.stdout);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(doctorResult.kind, 'openmas_doctor_result');
  assert.equal(doctorResult.status, 'ready_for_deterministic_runtime');
  assert.equal(doctorResult.project.projectKind, 'habitat');
  assert.equal(doctorResult.runtime.deterministicInvocation.status, 'ready');
  assert.equal(doctorResult.runtime.probabilisticInvocation.status, 'blocked');
  assert.equal(result.stderr, '');
});

test('Doctor fails precisely for a broken project root', async () => {
  const projectRootPath = await mkdtemp(path.join(os.tmpdir(), 'openmas-doctor-broken-'));

  await writeFile(
    path.join(projectRootPath, 'package.json'),
    JSON.stringify({
      name: 'broken-openmas-habitat',
      private: true,
      type: 'module',
    }, null, 2),
    'utf8',
  );

  const result = await runOpenMasDoctor({
    projectRootPath,
  });

  assert.equal(result.status, 'blocked');
  assert.equal(result.exitCode, 1);
  assert.equal(result.runtime.deterministicInvocation.status, 'blocked');
  assert.match(result.errors.join('\n'), /openmas" project marker/u);
});

test('generated local wrapper fails clearly before npm install creates node_modules', async () => {
  const habitatPath = await createStarterHabitat('doctor-wrapper-habitat');
  const result = runNode([
    path.join(habitatPath, 'bin', 'openmas.js'),
    'doctor',
  ], {
    cwd: habitatPath,
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Installed OpenMAS CLI not found/u);
  assert.match(result.stderr, /run npm install or pnpm install/u);
});
