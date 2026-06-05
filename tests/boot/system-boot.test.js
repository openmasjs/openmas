import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { access, mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { runSystemBoot } from '../../src/boot/run-system-boot.js';

async function createDirectoryTree(rootPath, relativePaths) {
  for (const relativePath of relativePaths) {
    await mkdir(path.join(rootPath, relativePath), { recursive: true });
  }
}

async function createProjectFixture({
  omitMasComponents = [],
  projectKind = 'framework',
  withOpenMASMarker = true,
} = {}) {
  const temporaryRootPath = await mkdtemp(path.join(os.tmpdir(), 'openmas-phase-0-'));
  const packageManifest = {
    name: 'openmas-fixture',
    private: true,
    type: 'module',
  };

  if (withOpenMASMarker) {
    packageManifest.openmas = {
      projectKind,
      schemaVersion: 1,
    };
  }

  await writeFile(
    path.join(temporaryRootPath, 'package.json'),
    JSON.stringify(packageManifest, null, 2),
    'utf8',
  );

  if (projectKind === 'habitat') {
    await createDirectoryTree(temporaryRootPath, [
      'config',
      'instance',
    ]);
  } else {
    await createDirectoryTree(temporaryRootPath, [
      'bin',
      'src',
      'docs',
      'var',
      'tests',
      'config',
      'instance',
    ]);
  }

  const masComponentPaths = [
    'instance/cognitive-identities',
    'instance/memory',
    'instance/memory/knowledge',
    'instance/memory/policies',
    'instance/memory/state',
    'instance/memory/artifacts',
    'instance/tools',
    'instance/workflows',
    'instance/registries',
    'instance/evaluations',
  ].filter((relativePath) => !omitMasComponents.includes(relativePath));

  await createDirectoryTree(temporaryRootPath, masComponentPaths);

  if (!omitMasComponents.includes('instance/registries')) {
    await writeFile(
      path.join(temporaryRootPath, 'instance', 'registries', 'cognitive-identities.json'),
      JSON.stringify(
        {
          kind: 'cognitive_identities_registry',
          version: 1,
          cognitiveIdentities: [],
        },
        null,
        2,
      ),
      'utf8',
    );
  }

  return temporaryRootPath;
}

async function assertFileExists(filePath) {
  await access(filePath);
}

test('runSystemBoot returns ready and persists boot artifacts on the happy path', async () => {
  const projectRootPath = await createProjectFixture();

  const bootResult = await runSystemBoot({ projectRootPath });

  assert.equal(bootResult.status, 'ready');
  assert.equal(bootResult.invocationReadiness.allowed, true);
  assert.equal(bootResult.projectRootPath, projectRootPath);
  assert.equal(bootResult.masRootPath, path.join(projectRootPath, 'instance'));
  assert.ok(bootResult.persistence);
  assert.equal(bootResult.persistence.targetType, 'mas-memory');

  await assertFileExists(bootResult.persistence.bootSessionRecordPath);
  await assertFileExists(bootResult.persistence.bootContextSummaryPath);
  await assertFileExists(bootResult.persistence.bootReportPath);

  const sessionRecord = JSON.parse(await readFile(bootResult.persistence.bootSessionRecordPath, 'utf8'));
  const bootContextSummary = JSON.parse(await readFile(bootResult.persistence.bootContextSummaryPath, 'utf8'));
  const bootReport = await readFile(bootResult.persistence.bootReportPath, 'utf8');

  assert.equal(sessionRecord.kind, 'system_boot_session');
  assert.equal(bootContextSummary.kind, 'system_boot_context');
  assert.match(bootReport, /OpenMAS System Boot Report/);
  assert.match(bootReport, /Status: ready/);
});

test('runSystemBoot accepts a habitat project root without framework source folders', async () => {
  const projectRootPath = await createProjectFixture({
    projectKind: 'habitat',
  });

  const bootResult = await runSystemBoot({ projectRootPath });

  assert.equal(bootResult.status, 'degraded');
  assert.equal(bootResult.projectValidation.projectKind, 'habitat');
  assert.equal(bootResult.invocationReadiness.allowed, false);
  assert.deepEqual(bootResult.projectValidation.missingRequiredComponents, []);
  assert.ok(bootResult.warnings.some((warning) => warning.includes('Optional project component is missing: README.md')));
});

test('runSystemBoot returns blocked and still persists artifacts when a required MAS component is missing', async () => {
  const projectRootPath = await createProjectFixture({
    omitMasComponents: ['instance/registries'],
  });

  const bootResult = await runSystemBoot({ projectRootPath });

  assert.equal(bootResult.status, 'blocked');
  assert.equal(bootResult.invocationReadiness.allowed, false);
  assert.ok(bootResult.errors.some((errorMessage) => errorMessage.includes('Required MAS component is missing: registries')));
  assert.ok(bootResult.persistence);
  assert.equal(bootResult.persistence.targetType, 'project-logs');

  await assertFileExists(bootResult.persistence.bootSessionRecordPath);
  await assertFileExists(bootResult.persistence.bootContextSummaryPath);
  await assertFileExists(bootResult.persistence.bootReportPath);
});

test('runSystemBoot returns failed when the MAS root cannot be resolved', async () => {
  const projectRootPath = await createProjectFixture();

  const bootResult = await runSystemBoot({
    projectRootPath,
    masRootHint: 'missing-instance',
  });

  assert.equal(bootResult.status, 'failed');
  assert.equal(bootResult.invocationReadiness.allowed, false);
  assert.equal(bootResult.projectRootPath, projectRootPath);
  assert.equal(bootResult.masRootPath, null);
  assert.ok(bootResult.persistence);
  assert.equal(bootResult.persistence.targetType, 'project-logs');
  assert.ok(bootResult.errors.some((errorMessage) => errorMessage.includes('MAS Root does not exist')));
});

test('runSystemBoot returns failed when the Project Root package.json misses the OpenMAS marker', async () => {
  const projectRootPath = await createProjectFixture({
    withOpenMASMarker: false,
  });

  const bootResult = await runSystemBoot({ projectRootPath });

  assert.equal(bootResult.status, 'failed');
  assert.equal(bootResult.projectRootPath, null);
  assert.equal(bootResult.invocationReadiness.allowed, false);
  assert.ok(bootResult.errors.some((errorMessage) => errorMessage.includes('must include an "openmas" project marker')));
});
