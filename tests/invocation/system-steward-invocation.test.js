import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { access, mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { runAgentInvocation } from '../../src/invocation/run-agent-invocation.js';
import { writeSystemStewardCommandModules } from '../helpers/write-system-steward-command-modules.js';

async function createDirectoryTree(rootPath, relativePaths) {
  for (const relativePath of relativePaths) {
    await mkdir(path.join(rootPath, relativePath), { recursive: true });
  }
}

async function createProjectFixture({ omitAgentFiles = [], omitProjectComponents = [] } = {}) {
  const temporaryRootPath = await mkdtemp(path.join(os.tmpdir(), 'openmas-system-steward-'));

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

  const projectComponents = [
    'bin',
    'src',
    'docs',
    'var',
    'tests',
    'config',
    'instance',
    'instance/cognitive-identities/system-steward',
    'instance/cognitive-identities/system-steward/commands',
    'instance/cognitive-identities/system-steward/memory',
    'instance/memory',
    'instance/memory/knowledge',
    'instance/memory/policies',
    'instance/memory/state',
    'instance/memory/artifacts',
    'instance/tools',
    'instance/workflows',
    'instance/registries',
    'instance/evaluations',
    'instance/operational-identities',
    'instance/operational-identities/alfred',
  ].filter((relativePath) => !omitProjectComponents.includes(relativePath));

  await createDirectoryTree(temporaryRootPath, projectComponents);

  await writeFile(
    path.join(temporaryRootPath, 'instance', 'registries', 'cognitive-identities.json'),
    JSON.stringify(
      {
        kind: 'cognitive_identities_registry',
        version: 1,
        cognitiveIdentities: [
          {
            cognitiveIdentityId: 'system-steward',
            rootPath: 'system-steward',
            category: 'platform',
          },
        ],
      },
      null,
      2,
    ),
    'utf8',
  );

  await writeFile(
    path.join(temporaryRootPath, 'instance', 'registries', 'operational-identities.json'),
    JSON.stringify(
      {
        kind: 'operational_identities_registry',
        version: 1,
        operationalIdentities: [
          {
            operationalIdentityId: 'alfred',
            rootPath: 'alfred',
            category: 'platform',
          },
        ],
      },
      null,
      2,
    ),
    'utf8',
  );

  if (!omitAgentFiles.includes('identity.md')) {
    await writeFile(path.join(temporaryRootPath, 'instance', 'cognitive-identities', 'system-steward', 'identity.md'), '# System Steward\n', 'utf8');
  }

  if (!omitAgentFiles.includes('policies.md')) {
    await writeFile(path.join(temporaryRootPath, 'instance', 'cognitive-identities', 'system-steward', 'policies.md'), '# Policies\n', 'utf8');
  }

  if (!omitAgentFiles.includes('capabilities.md')) {
    await writeFile(path.join(temporaryRootPath, 'instance', 'cognitive-identities', 'system-steward', 'capabilities.md'), '# Capabilities\n', 'utf8');
  }

  await writeFile(
    path.join(temporaryRootPath, 'instance', 'operational-identities', 'alfred', 'identity.json'),
    JSON.stringify(
      {
        kind: 'operational_identity_definition',
        version: 1,
        operationalIdentityId: 'alfred',
        displayName: 'Alfred',
        lifecycleState: 'active',
        auditActorId: 'system-steward.ops.alfred.v1',
        attachedCognitiveIdentities: [{ cognitiveIdentityId: 'system-steward' }],
        executionProfileId: 'alfred-default',
        persona: { tone: 'helpful' },
      },
      null,
      2,
    ),
    'utf8',
  );

  await writeFile(
    path.join(temporaryRootPath, 'instance', 'operational-identities', 'alfred', 'execution-profile.json'),
    JSON.stringify(
      {
        kind: 'execution_profile_definition',
        version: 1,
        executionProfileId: 'alfred-default',
        executionMode: 'deterministic',
        primaryBrain: {
          brainId: 'openrouter-primary',
          providerId: 'openrouter-api',
          modelId: 'openrouter/free',
        },
        fallbackBrain: null,
        enabledCommands: [
          'help',
          'hello',
          'status',
          'bootstrap',
          'gap-analysis',
          'inspect',
          'diagnose',
          'memory-health',
        ],
      },
      null,
      2,
    ),
    'utf8',
  );

  await writeSystemStewardCommandModules(temporaryRootPath);

  return temporaryRootPath;
}

async function assertFileExists(filePath) {
  await access(filePath);
}

test('runAgentInvocation completes Alfred deterministic execution through System Steward and persists its outputs', async () => {
  const projectRootPath = await createProjectFixture();

  const result = await runAgentInvocation({
    projectRootPath,
    operationalIdentityId: 'alfred',
    command: 'status',
    requestedBy: 'cli',
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.primaryCognitiveIdentityId, 'system-steward');
  assert.equal(result.request.command, 'status');
  assert.match(result.message, /System Steward/);
  assert.ok(result.persistence);
  assert.equal(result.persistence.targetType, 'mas-memory');

  await assertFileExists(result.persistence.invocationSessionRecordPath);
  await assertFileExists(result.persistence.invocationReportPath);

  const invocationSession = JSON.parse(await readFile(result.persistence.invocationSessionRecordPath, 'utf8'));
  const invocationReport = await readFile(result.persistence.invocationReportPath, 'utf8');

  assert.equal(invocationSession.kind, 'agent_invocation_session');
  assert.match(invocationReport, /System Status Report/);
  assert.match(invocationReport, /Registered Cognitive Identities/);
});

test('runAgentInvocation completes Alfred deterministic hello command through System Steward', async () => {
  const projectRootPath = await createProjectFixture();

  const result = await runAgentInvocation({
    projectRootPath,
    operationalIdentityId: 'alfred',
    command: 'hello',
    requestedBy: 'cli',
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.request.command, 'hello');
  assert.match(result.message, /framework is alive/i);

  const invocationReport = await readFile(result.persistence.invocationReportPath, 'utf8');
  assert.match(invocationReport, /System Welcome Report/);
});

test('runAgentInvocation completes Alfred deterministic help command through System Steward', async () => {
  const projectRootPath = await createProjectFixture();

  const result = await runAgentInvocation({
    projectRootPath,
    operationalIdentityId: 'alfred',
    command: 'help',
    requestedBy: 'cli',
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.request.command, 'help');
  assert.match(result.message, /deterministic commands/i);
  assert.ok(Array.isArray(result.output.supportedCommands));
  assert.ok(result.output.supportedCommands.includes('help'));

  const invocationReport = await readFile(result.persistence.invocationReportPath, 'utf8');
  assert.match(invocationReport, /System Steward Help/);
  assert.match(invocationReport, /Supported Deterministic Commands/);
});

test('runAgentInvocation completes Alfred deterministic bootstrap command through System Steward', async () => {
  const projectRootPath = await createProjectFixture();

  const result = await runAgentInvocation({
    projectRootPath,
    operationalIdentityId: 'alfred',
    command: 'bootstrap',
    requestedBy: 'cli',
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.request.command, 'bootstrap');
  assert.match(result.message, /bootstrap plan/i);

  const invocationReport = await readFile(result.persistence.invocationReportPath, 'utf8');
  assert.match(invocationReport, /Bootstrap Plan/);
  assert.match(invocationReport, /Recommended Bootstrap Steps/);
});

test('runAgentInvocation completes Alfred deterministic gap-analysis command through System Steward', async () => {
  const projectRootPath = await createProjectFixture();

  const result = await runAgentInvocation({
    projectRootPath,
    operationalIdentityId: 'alfred',
    command: 'gap-analysis',
    requestedBy: 'cli',
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.request.command, 'gap-analysis');
  assert.match(result.message, /gap analysis/i);

  const invocationReport = await readFile(result.persistence.invocationReportPath, 'utf8');
  assert.match(invocationReport, /Gap Analysis Report/);
  assert.match(invocationReport, /## Gaps/);
});

test('runAgentInvocation completes Alfred deterministic inspect command through System Steward', async () => {
  const projectRootPath = await createProjectFixture();

  const result = await runAgentInvocation({
    projectRootPath,
    operationalIdentityId: 'alfred',
    command: 'inspect',
    requestedBy: 'cli',
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.request.command, 'inspect');

  const invocationReport = await readFile(result.persistence.invocationReportPath, 'utf8');
  assert.match(invocationReport, /System Inspection Report/);
  assert.match(invocationReport, /Memory Snapshot/);
});

test('runAgentInvocation persists memory-health as an explicit audit runtime artifact', async () => {
  const projectRootPath = await createProjectFixture();

  const result = await runAgentInvocation({
    projectRootPath,
    operationalIdentityId: 'alfred',
    command: 'memory-health',
    requestedBy: 'administrator',
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.request.command, 'memory-health');
  assert.equal(result.persistence.reportArtifactDecision.artifactClass, 'memory_audit_report');
  assert.equal(result.persistence.reportArtifactDecision.persistReportArtifact, true);
  assert.equal(result.persistence.reportArtifactDecision.promptInclusionMode, 'artifact_reference_only');
  assert.equal(result.persistence.reportArtifactDecision.rawArtifactBodyPromptEligible, false);
  assert.equal(result.persistence.reportArtifactDecision.durableMemoryWriteEligible, false);

  const invocationSession = JSON.parse(await readFile(result.persistence.invocationSessionRecordPath, 'utf8'));
  const invocationReport = await readFile(result.persistence.invocationReportPath, 'utf8');

  assert.equal(invocationSession.reportArtifactDecision.artifactClass, 'memory_audit_report');
  assert.equal(invocationSession.reportArtifactDecision.persistReportArtifact, true);
  assert.match(invocationReport, /Memory Health Diagnostic Report/);
});

test('runAgentInvocation allows Alfred safe degraded boot diagnostics through System Steward', async () => {
  const projectRootPath = await createProjectFixture({
    omitProjectComponents: ['config'],
  });

  const result = await runAgentInvocation({
    projectRootPath,
    operationalIdentityId: 'alfred',
    command: 'diagnose',
    requestedBy: 'cli',
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.bootResult.status, 'degraded');
  assert.ok(result.readiness.warnings.some((warning) => warning.includes('degraded boot')));

  const invocationReport = await readFile(result.persistence.invocationReportPath, 'utf8');
  assert.match(invocationReport, /System Diagnostic Report/);
  assert.match(invocationReport, /Recommendations/);
});

test('runAgentInvocation returns blocked when Alfred resolved System Steward definition is incomplete', async () => {
  const projectRootPath = await createProjectFixture({
    omitAgentFiles: ['capabilities.md'],
  });

  const result = await runAgentInvocation({
    projectRootPath,
    operationalIdentityId: 'alfred',
    command: 'status',
  });

  assert.equal(result.status, 'blocked');
  assert.equal(result.persistence, null);
  assert.ok(result.errors.includes('Required Cognitive Identity component is missing: capabilities.md'));
});
