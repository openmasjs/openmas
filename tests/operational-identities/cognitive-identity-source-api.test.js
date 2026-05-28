import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { readCognitiveIdentitiesRegistry } from '../../src/invocation/read-cognitive-identities-registry.js';
import { resolveCognitiveIdentityRoot } from '../../src/invocation/resolve-cognitive-identity-root.js';
import { readCognitiveIdentityDefinition } from '../../src/invocation/read-cognitive-identity-definition.js';

async function createCognitiveIdentityFixture({ registryEntries = null } = {}) {
  const projectRootPath = await mkdtemp(path.join(os.tmpdir(), 'openmas-cognitive-source-'));
  const masRootPath = path.join(projectRootPath, 'instance');
  const cognitiveIdentityRootPath = path.join(masRootPath, 'cognitive-identities', 'stewards', 'evaluation-audit');

  await mkdir(path.join(masRootPath, 'registries'), { recursive: true });
  await mkdir(path.join(cognitiveIdentityRootPath, 'memory'), { recursive: true });
  await writeFile(path.join(cognitiveIdentityRootPath, 'identity.md'), '# Evaluation And Audit Steward\n', 'utf8');
  await writeFile(path.join(cognitiveIdentityRootPath, 'policies.md'), '# Policies\n', 'utf8');
  await writeFile(path.join(cognitiveIdentityRootPath, 'capabilities.md'), '# Capabilities\n', 'utf8');
  await writeFile(
    path.join(masRootPath, 'registries', 'cognitive-identities.json'),
    JSON.stringify({
      kind: 'cognitive_identities_registry',
      version: 1,
      cognitiveIdentities: registryEntries ?? [
        {
          cognitiveIdentityId: 'evaluation-audit-steward',
          rootPath: 'stewards/evaluation-audit',
          category: 'platform',
        },
      ],
    }, null, 2),
    'utf8',
  );

  return {
    masRootPath,
    cognitiveIdentityRootPath,
  };
}

test('Cognitive Identity source API loads portable cognition without operational execution authority', async () => {
  const { masRootPath, cognitiveIdentityRootPath } = await createCognitiveIdentityFixture();
  const { registry } = await readCognitiveIdentitiesRegistry({ masRootPath });
  const resolvedCognitiveIdentity = await resolveCognitiveIdentityRoot({
    masRootPath,
    cognitiveIdentityId: 'evaluation-audit-steward',
  });
  const definition = await readCognitiveIdentityDefinition({
    cognitiveIdentityRootPath: resolvedCognitiveIdentity.cognitiveIdentityRootPath,
  });

  assert.equal(registry.cognitiveIdentities[0].cognitiveIdentityId, 'evaluation-audit-steward');
  assert.equal(resolvedCognitiveIdentity.cognitiveIdentityId, 'evaluation-audit-steward');
  assert.equal(resolvedCognitiveIdentity.cognitiveIdentityRootPath, cognitiveIdentityRootPath);
  assert.deepEqual(definition.missingRequiredComponents, []);
  assert.equal(Object.hasOwn(resolvedCognitiveIdentity, 'operationalIdentityId'), false);
});

test('readCognitiveIdentitiesRegistry rejects duplicate Cognitive Identity identifiers', async () => {
  const duplicateEntry = {
    cognitiveIdentityId: 'evaluation-audit-steward',
    rootPath: 'stewards/evaluation-audit',
    category: 'platform',
  };
  const { masRootPath } = await createCognitiveIdentityFixture({
    registryEntries: [duplicateEntry, duplicateEntry],
  });

  await assert.rejects(
    () => readCognitiveIdentitiesRegistry({ masRootPath }),
    /duplicated cognitiveIdentityId/u,
  );
});

test('resolveCognitiveIdentityRoot refuses registry paths outside portable cognition storage', async () => {
  const { masRootPath } = await createCognitiveIdentityFixture({
    registryEntries: [
      {
        cognitiveIdentityId: 'evaluation-audit-steward',
        rootPath: '../operational-identities/bruce',
        category: 'platform',
      },
    ],
  });

  await assert.rejects(
    () => resolveCognitiveIdentityRoot({
      masRootPath,
      cognitiveIdentityId: 'evaluation-audit-steward',
    }),
    /contains invalid path segments/u,
  );
});
