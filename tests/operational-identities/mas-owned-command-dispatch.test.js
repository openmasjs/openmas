import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import {
  InvalidMasOwnedDeterministicCommandNameError,
  resolveMasOwnedDeterministicCommandPath,
} from '../../src/invocation/resolve-mas-owned-deterministic-command-path.js';
import { executeMasOwnedDeterministicCommand } from '../../src/invocation/execute-mas-owned-deterministic-command.js';
import { MasOwnedDeterministicCommandNotFoundError } from '../../src/invocation/load-mas-owned-deterministic-command.js';
import { writeSimpleHelloCommandModule } from '../helpers/write-simple-hello-command-module.js';

const TEST_PROJECT_ROOT_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function buildProjectLocalFixturePath(fixtureName) {
  return path.join(TEST_PROJECT_ROOT_PATH, 'tests', 'fixtures', fixtureName);
}

async function createCommandFixture(t) {
  const projectRootPath = await mkdtemp(path.join(TEST_PROJECT_ROOT_PATH, 'tests', '.tmp-openmas-command-dispatch-'));
  const relativeCognitiveIdentityPath = 'marketing-and-sales/community-manager';
  const cognitiveIdentityRootPath = path.join(projectRootPath, 'instance', 'cognitive-identities', relativeCognitiveIdentityPath);
  const masRootPath = path.join(projectRootPath, 'instance');

  t.after(async () => {
    await rm(projectRootPath, { recursive: true, force: true });
  });

  await mkdir(cognitiveIdentityRootPath, { recursive: true });
  await writeSimpleHelloCommandModule({
    projectRootPath,
    relativeCognitiveIdentityPath,
    roleName: 'Community Manager',
    defaultSpeakerLabel: 'Community Manager',
    reportKind: 'community_manager_welcome_report',
    messageText: 'I am ready to help with community-facing work in this OpenMAS instance.',
  });

  return {
    projectRootPath,
    masRootPath,
    cognitiveIdentityRootPath,
  };
}

test('resolveMasOwnedDeterministicCommandPath resolves a grouped Cognitive Identity command path', () => {
  const projectRootPath = buildProjectLocalFixturePath('openmas-command-fixture');
  const cognitiveIdentityRootPath = path.join(projectRootPath, 'instance', 'cognitive-identities', 'marketing-and-sales', 'community-manager');

  const resolved = resolveMasOwnedDeterministicCommandPath({
    cognitiveIdentityRootPath,
    commandName: 'hello',
  });

  assert.equal(
    resolved.commandRootPath,
    path.resolve(cognitiveIdentityRootPath, 'commands'),
  );
  assert.equal(
    resolved.commandModulePath,
    path.resolve(cognitiveIdentityRootPath, 'commands', 'hello.js'),
  );
  assert.equal(resolved.commandName, 'hello');
});

test('resolveMasOwnedDeterministicCommandPath rejects unsafe command names', () => {
  assert.throws(
    () => resolveMasOwnedDeterministicCommandPath({
      cognitiveIdentityRootPath: path.join(
        buildProjectLocalFixturePath('openmas-command-fixture'),
        'instance',
        'cognitive-identities',
        'system-steward',
      ),
      commandName: '../diagnose',
    }),
    InvalidMasOwnedDeterministicCommandNameError,
  );
});

test('executeMasOwnedDeterministicCommand loads and validates a MAS-owned command outcome', async (t) => {
  const { cognitiveIdentityRootPath, masRootPath } = await createCommandFixture(t);

  const result = await executeMasOwnedDeterministicCommand({
    cognitiveIdentityRootPath,
    commandName: 'hello',
    bootResult: {
      status: 'ready',
      masRootPath,
    },
    readiness: {
      operationalIdentityDefinition: {
        operationalIdentityId: 'maria',
        displayName: 'Maria',
      },
    },
    request: {
      command: 'hello',
    },
  });

  assert.equal(
    result.commandModulePath,
    path.resolve(cognitiveIdentityRootPath, 'commands', 'hello.js'),
  );
  assert.match(result.executionOutcome.message, /Maria/i);
  assert.equal(result.executionOutcome.outputPayload.cognitiveIdentityId, 'community-manager');
});

test('executeMasOwnedDeterministicCommand fails when the MAS-owned command module is missing', async (t) => {
  const { cognitiveIdentityRootPath, masRootPath } = await createCommandFixture(t);

  await assert.rejects(
    () => executeMasOwnedDeterministicCommand({
      cognitiveIdentityRootPath,
      commandName: 'diagnose',
      bootResult: {
        status: 'ready',
        masRootPath,
      },
      readiness: {},
      request: {
        command: 'diagnose',
      },
    }),
    MasOwnedDeterministicCommandNotFoundError,
  );
});
