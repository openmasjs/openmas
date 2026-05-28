import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { readOperationalIdentitiesRegistry } from '../../src/operational-identities/read-operational-identities-registry.js';
import { resolveOperationalIdentityRoot } from '../../src/operational-identities/resolve-operational-identity-root.js';
import { readOperationalIdentityDefinition } from '../../src/operational-identities/read-operational-identity-definition.js';
import { isOperationalIdentityActive } from '../../src/contracts/operational-identity-contract.js';

async function createDirectoryTree(rootPath, relativePaths) {
  for (const relativePath of relativePaths) {
    await mkdir(path.join(rootPath, relativePath), { recursive: true });
  }
}

async function createProjectFixture({
  lifecycleState = 'active',
  omitRegistryEntry = false,
  omitDefinitionFile = false,
  operationalIdentityRegistryRootPath = 'alfred',
} = {}) {
  const temporaryRootPath = await mkdtemp(path.join(os.tmpdir(), 'openmas-operational-identity-'));

  await writeFile(
    path.join(temporaryRootPath, 'package.json'),
    JSON.stringify(
      {
        name: 'openmas-fixture',
        private: true,
        type: 'module',
        openmas: {
          projectKind: 'framework',
          schemaVersion: 1,
        },
      },
      null,
      2,
    ),
    'utf8',
  );

  await createDirectoryTree(temporaryRootPath, [
    'bin',
    'src',
    'docs',
    'var',
    'tests',
    'config',
    'instance',
    'instance/registries',
    'instance/operational-identities',
    'instance/operational-identities/alfred',
  ]);

  await writeFile(
    path.join(temporaryRootPath, 'instance', 'registries', 'operational-identities.json'),
    JSON.stringify(
      {
        kind: 'operational_identities_registry',
        version: 1,
        operationalIdentities: omitRegistryEntry
          ? []
          : [
              {
                operationalIdentityId: 'alfred',
                rootPath: operationalIdentityRegistryRootPath,
                category: 'platform',
              },
            ],
      },
      null,
      2,
    ),
    'utf8',
  );

  if (!omitDefinitionFile) {
    await writeFile(
      path.join(temporaryRootPath, 'instance', 'operational-identities', 'alfred', 'identity.json'),
      JSON.stringify(
        {
          kind: 'operational_identity_definition',
          version: 1,
          operationalIdentityId: 'alfred',
          displayName: 'Alfred',
          lifecycleState,
          auditActorId: 'system-steward.ops.alfred.v1',
          attachedCognitiveIdentities: [
            {
              cognitiveIdentityId: 'system-steward',
            },
          ],
          executionProfileId: 'alfred-default',
          persona: {
            tone: 'helpful',
          },
        },
        null,
        2,
      ),
      'utf8',
    );
  }

  return temporaryRootPath;
}

test('readOperationalIdentitiesRegistry returns the Alfred registry entry', async () => {
  const projectRootPath = await createProjectFixture();
  const masRootPath = path.join(projectRootPath, 'instance');

  const { registryPath, registry } = await readOperationalIdentitiesRegistry({ masRootPath });

  assert.equal(registryPath, path.join(masRootPath, 'registries', 'operational-identities.json'));
  assert.equal(registry.operationalIdentities.length, 1);
  assert.equal(registry.operationalIdentities[0].operationalIdentityId, 'alfred');
});

test('resolveOperationalIdentityRoot resolves Alfred from the operational identities registry', async () => {
  const projectRootPath = await createProjectFixture();
  const masRootPath = path.join(projectRootPath, 'instance');

  const resolvedOperationalIdentity = await resolveOperationalIdentityRoot({
    masRootPath,
    operationalIdentityId: 'alfred',
  });

  assert.equal(resolvedOperationalIdentity.operationalIdentityId, 'alfred');
  assert.equal(
    resolvedOperationalIdentity.operationalIdentityRootPath,
    path.join(masRootPath, 'operational-identities', 'alfred'),
  );
});

test('readOperationalIdentityDefinition validates Alfred as an active operational identity', async () => {
  const projectRootPath = await createProjectFixture();
  const operationalIdentityRootPath = path.join(projectRootPath, 'instance', 'operational-identities', 'alfred');

  const { definition } = await readOperationalIdentityDefinition({ operationalIdentityRootPath });

  assert.equal(definition.operationalIdentityId, 'alfred');
  assert.equal(definition.displayName, 'Alfred');
  assert.equal(definition.lifecycleState, 'active');
  assert.equal(definition.attachedCognitiveIdentities[0].cognitiveIdentityId, 'system-steward');
  assert.equal(isOperationalIdentityActive(definition), true);
});

test('readOperationalIdentityDefinition accepts non-active lifecycle states that are still valid', async () => {
  const projectRootPath = await createProjectFixture({
    lifecycleState: 'suspended',
  });
  const operationalIdentityRootPath = path.join(projectRootPath, 'instance', 'operational-identities', 'alfred');

  const { definition } = await readOperationalIdentityDefinition({ operationalIdentityRootPath });

  assert.equal(definition.lifecycleState, 'suspended');
  assert.equal(isOperationalIdentityActive(definition), false);
});

test('readOperationalIdentityDefinition rejects invalid lifecycle states', async () => {
  const projectRootPath = await createProjectFixture({
    lifecycleState: 'offline',
  });
  const operationalIdentityRootPath = path.join(projectRootPath, 'instance', 'operational-identities', 'alfred');

  await assert.rejects(
    () => readOperationalIdentityDefinition({ operationalIdentityRootPath }),
    /Operational Identity lifecycleState is invalid: offline/,
  );
});

test('resolveOperationalIdentityRoot fails when the Alfred registry entry is missing', async () => {
  const projectRootPath = await createProjectFixture({
    omitRegistryEntry: true,
  });
  const masRootPath = path.join(projectRootPath, 'instance');

  await assert.rejects(
    () => resolveOperationalIdentityRoot({
      masRootPath,
      operationalIdentityId: 'alfred',
    }),
    /Operational Identity registry entry could not be resolved/,
  );
});

test('resolveOperationalIdentityRoot rejects a registry rootPath that escapes the MAS operational identities root', async () => {
  const projectRootPath = await createProjectFixture({
    operationalIdentityRegistryRootPath: '../outside-operational-identity',
  });
  const masRootPath = path.join(projectRootPath, 'instance');

  await assert.rejects(
    () => resolveOperationalIdentityRoot({
      masRootPath,
      operationalIdentityId: 'alfred',
    }),
    /contains invalid path segments/,
  );
});
