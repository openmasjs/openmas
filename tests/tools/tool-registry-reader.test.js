import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import {
  readToolDefinitions,
  TOOL_DEFINITION_FILE_NAME,
  TOOL_ROOT_PATH,
} from '../../src/tools/read-tool-definitions.js';

async function createMasFixture({ withToolsRoot = true } = {}) {
  const temporaryRootPath = await mkdtemp(path.join(os.tmpdir(), 'openmas-tool-reader-'));
  const masRootPath = path.join(temporaryRootPath, 'instance');

  await mkdir(masRootPath, { recursive: true });

  if (withToolsRoot) {
    await mkdir(path.join(masRootPath, TOOL_ROOT_PATH), { recursive: true });
  }

  return {
    temporaryRootPath,
    masRootPath,
  };
}

function buildToolDefinition(overrides = {}) {
  return {
    kind: 'tool_definition',
    version: 1,
    toolId: 'mas.system.inspect',
    displayName: 'MAS System Inspect',
    description: 'Inspects safe MAS system state.',
    lifecycleState: 'active',
    owner: 'mas',
    toolType: 'local_js_module',
    sideEffectLevel: 'read_only',
    inputSchema: {
      type: 'object',
    },
    outputSchema: {
      type: 'object',
    },
    requiredResourceTypes: ['storage'],
    requiredAccessModes: ['read'],
    requiredPermissionModes: ['tool.execute'],
    approvalPolicy: {
      required: false,
    },
    execution: {
      modulePath: 'executor.js',
      timeoutMs: 10000,
      retryPolicy: {
        enabled: false,
      },
    },
    artifactPolicy: {
      persistResult: false,
    },
    memoryPolicy: {
      allowWritebackCandidates: true,
    },
    ...overrides,
  };
}

async function writeToolDefinition({
  masRootPath,
  toolDirectoryName,
  definition = buildToolDefinition({ toolId: toolDirectoryName }),
}) {
  const toolRootPath = path.join(masRootPath, TOOL_ROOT_PATH, toolDirectoryName);

  await mkdir(toolRootPath, { recursive: true });
  await writeFile(
    path.join(toolRootPath, TOOL_DEFINITION_FILE_NAME),
    JSON.stringify(definition, null, 2),
    'utf8',
  );
}

test('readToolDefinitions returns a warning and empty definitions when instance/tools is missing', async () => {
  const { masRootPath } = await createMasFixture({ withToolsRoot: false });

  const result = await readToolDefinitions({ masRootPath });

  assert.equal(result.toolDefinitions.length, 0);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /Tool rootPath does not exist: tools/u);
});

test('readToolDefinitions reads active tool definitions deterministically', async () => {
  const { masRootPath } = await createMasFixture();

  await writeToolDefinition({
    masRootPath,
    toolDirectoryName: 'mas.memory.health.read',
    definition: buildToolDefinition({
      toolId: 'mas.memory.health.read',
      displayName: 'MAS Memory Health Read',
    }),
  });
  await writeToolDefinition({
    masRootPath,
    toolDirectoryName: 'mas.system.inspect',
    definition: buildToolDefinition({
      toolId: 'mas.system.inspect',
      displayName: 'MAS System Inspect',
    }),
  });

  const result = await readToolDefinitions({ masRootPath });

  assert.deepEqual(
    result.toolDefinitions.map((definition) => definition.toolId),
    ['mas.memory.health.read', 'mas.system.inspect'],
  );
  assert.equal(result.toolDefinitions[0].sourcePath, 'instance/tools/mas.memory.health.read/tool.json');
  assert.equal(result.toolDefinitions[1].sourcePath, 'instance/tools/mas.system.inspect/tool.json');
  assert.deepEqual(result.warnings, []);
});

test('readToolDefinitions filters inactive tools by default and includes them when requested', async () => {
  const { masRootPath } = await createMasFixture();

  await writeToolDefinition({
    masRootPath,
    toolDirectoryName: 'mas.system.inspect',
  });
  await writeToolDefinition({
    masRootPath,
    toolDirectoryName: 'meta.reply.publish',
    definition: buildToolDefinition({
      toolId: 'meta.reply.publish',
      displayName: 'Meta Reply Publish',
      lifecycleState: 'disabled',
      requiredAccessModes: ['publish'],
      sideEffectLevel: 'publish_external',
      approvalPolicy: {
        required: true,
      },
    }),
  });

  const activeOnlyResult = await readToolDefinitions({ masRootPath });
  const includeInactiveResult = await readToolDefinitions({
    masRootPath,
    includeInactive: true,
  });

  assert.deepEqual(activeOnlyResult.toolDefinitions.map((definition) => definition.toolId), ['mas.system.inspect']);
  assert.deepEqual(
    includeInactiveResult.toolDefinitions.map((definition) => definition.toolId),
    ['mas.system.inspect', 'meta.reply.publish'],
  );
});

test('readToolDefinitions skips invalid tools and non-directory entries with warnings', async () => {
  const { masRootPath } = await createMasFixture();

  await writeToolDefinition({
    masRootPath,
    toolDirectoryName: 'mas.system.inspect',
  });
  await writeToolDefinition({
    masRootPath,
    toolDirectoryName: 'invalid-tool',
    definition: {
      kind: 'tool_definition',
      version: 1,
      toolId: 'invalid-tool',
      displayName: 'Invalid Tool',
      lifecycleState: 'active',
      owner: 'mas',
      toolType: 'local_js_module',
      sideEffectLevel: 'read_only',
      execution: {
        modulePath: '../unsafe.js',
      },
    },
  });
  await writeFile(path.join(masRootPath, TOOL_ROOT_PATH, 'README.md'), '# Tools\n', 'utf8');

  const result = await readToolDefinitions({ masRootPath });

  assert.deepEqual(result.toolDefinitions.map((definition) => definition.toolId), ['mas.system.inspect']);
  assert.equal(result.warnings.length, 2);
  assert.ok(result.warnings.some((warning) => warning.includes('skipped invalid-tool')));
  assert.ok(result.warnings.some((warning) => warning.includes('skipped non-directory entry: README.md')));
});

test('readToolDefinitions rejects tool definitions whose toolId does not match the directory name', async () => {
  const { masRootPath } = await createMasFixture();

  await writeToolDefinition({
    masRootPath,
    toolDirectoryName: 'mas.system.inspect',
    definition: buildToolDefinition({
      toolId: 'mas.documentation.search',
    }),
  });

  const result = await readToolDefinitions({ masRootPath });

  assert.equal(result.toolDefinitions.length, 0);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /must match its directory name/u);
});

test('readToolDefinitions requires valid reader inputs', async () => {
  await assert.rejects(
    () => readToolDefinitions({ masRootPath: '' }),
    /requires a non-empty masRootPath/u,
  );

  await assert.rejects(
    () => readToolDefinitions({
      masRootPath: 'instance',
      includeInactive: 'yes',
    }),
    /includeInactive must be a boolean/u,
  );
});
