import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { access, readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { buildDefaultMemorySourceRegistry } from '../../src/memory/build-default-memory-source-registry.js';
import { collectMemoryRecordsForInvocation } from '../../src/memory/collect-memory-records-for-invocation.js';
import { runAgentInvocation } from '../../src/invocation/run-agent-invocation.js';
import {
  createAlfredProbabilisticProjectFixture,
  createDurableMemoryRecord,
  withEnvironment,
  writeDurableMemoryRecord,
} from '../helpers/create-alfred-probabilistic-fixture.js';

const PROJECT_ROOT_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const APPROVED_DURABLE_MARKER = 'GATE_APPROVED_DURABLE_MEMORY_ALLOWED';
const PENDING_DURABLE_MARKER = 'GATE_PENDING_DURABLE_MEMORY_MUST_NOT_APPEAR';
const STALE_DURABLE_MARKER = 'GATE_STALE_DURABLE_MEMORY_MUST_NOT_APPEAR';
const REDACTED_DURABLE_MARKER = 'GATE_REDACTED_DURABLE_MEMORY_MUST_NOT_APPEAR';
const RESTRICTED_DURABLE_MARKER = 'GATE_RESTRICTED_DURABLE_MEMORY_MUST_NOT_APPEAR';

async function pathExists(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return false;
    }

    throw error;
  }
}

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

function buildGateDurableMemoryRecord(overrides = {}) {
  return createDurableMemoryRecord({
    ownerId: 'sin-cuchillo',
    scope: 'mas_instance',
    visibility: 'shared_with_mas',
    sensitivityLevel: 'internal',
    approvalState: 'approved',
    lifecycleStatus: 'active',
    retention: {
      retentionPolicyId: 'integration-gate',
      expiresAt: null,
      staleAfter: null,
      reviewRequiredAt: null,
    },
    supersession: {
      supersedesMemoryRecordIds: [],
      supersededByMemoryRecordId: null,
    },
    ...overrides,
  });
}

test('MC-PF integration gate preserves framework and MAS ownership boundaries', async () => {
  assert.equal(await pathExists(path.join(PROJECT_ROOT_PATH, 'src', 'agents')), false);

  const brainFiles = await listJavaScriptFiles(path.join(PROJECT_ROOT_PATH, 'src', 'brain'));
  const contextFiles = await listJavaScriptFiles(path.join(PROJECT_ROOT_PATH, 'src', 'context'));
  const memoryFiles = await listJavaScriptFiles(path.join(PROJECT_ROOT_PATH, 'src', 'memory'));
  const brainContextBuilderImports = [];
  const boundaryViolations = [];

  for (const filePath of brainFiles) {
    const content = await readFile(filePath, 'utf8');

    if (content.includes("../context/build-context-pack-for-invocation.js")) {
      brainContextBuilderImports.push(toProjectPath(filePath));
    }

    if (/from\s+['"]\.\.\/memory\//u.test(content)) {
      boundaryViolations.push(`${toProjectPath(filePath)} imports Memory Factory code directly.`);
    }

    if (/\breadDurableMemoryRecords\b|\bcollectMemoryRecordsForInvocation\b/u.test(content)) {
      boundaryViolations.push(`${toProjectPath(filePath)} reads memory directly instead of consuming Context Packs.`);
    }
  }

  for (const filePath of contextFiles) {
    const content = await readFile(filePath, 'utf8');

    if (/from\s+['"]\.\.\/brain\//u.test(content) || /from\s+['"]\.\.\/providers\//u.test(content)) {
      boundaryViolations.push(`${toProjectPath(filePath)} depends on Prompt Factory or provider code.`);
    }
  }

  for (const filePath of memoryFiles) {
    const content = await readFile(filePath, 'utf8');

    if (/from\s+['"]\.\.\/brain\//u.test(content) || /from\s+['"]\.\.\/providers\//u.test(content)) {
      boundaryViolations.push(`${toProjectPath(filePath)} depends on Prompt Factory or provider code.`);
    }
  }

  assert.deepEqual(brainContextBuilderImports, ['src/brain/assemble-brain-input-for-invocation.js']);
  assert.deepEqual(boundaryViolations, []);
});

test('MC-PF integration gate collects durable memory through the normal memory source registry', async () => {
  const projectRootPath = await createAlfredProbabilisticProjectFixture();
  const masRootPath = path.join(projectRootPath, 'instance');

  await writeDurableMemoryRecord({
    projectRootPath,
    memoryRecord: buildGateDurableMemoryRecord({
      memoryRecordId: 'mem_gate_registry_durable',
      summary: 'Integration gate durable memory is collected through the default registry.',
      content: 'Durable memory must enter through collectMemoryRecordsForInvocation before Context Pack eligibility.',
    }),
  });

  const defaultRegistry = buildDefaultMemorySourceRegistry({ masOwnerId: 'sin-cuchillo' });
  const durableSource = defaultRegistry.memorySources.find((source) => {
    return source.sourceId === 'durable-memory';
  });
  const collection = await collectMemoryRecordsForInvocation({
    masRootPath,
    readiness: {
      activeCognitiveSet: {
        primaryCognitiveIdentityId: 'system-steward',
        secondaryCognitiveIdentityIds: [],
      },
      operationalIdentityDefinition: {
        operationalIdentityId: 'alfred',
      },
    },
  });

  assert.equal(durableSource.sourceType, 'durable_memory_directory');
  assert.equal(durableSource.rootPath, 'memory/durable');
  assert.equal(collection.usedDefaultRegistry, true);
  assert.equal(collection.sourceResults.some((sourceResult) => {
    return sourceResult.sourceId === 'durable-memory';
  }), true);
  assert.equal(collection.memoryRecords.some((record) => {
    return record.memoryRecordId === 'mem_gate_registry_durable';
  }), true);
});

test('MC-PF integration gate routes durable memory through Context Pack and explains unsafe omissions', async () => {
  const projectRootPath = await createAlfredProbabilisticProjectFixture();
  const providerSystemMessages = [];

  await writeDurableMemoryRecord({
    projectRootPath,
    memoryRecord: buildGateDurableMemoryRecord({
      memoryRecordId: 'mem_gate_approved_durable',
      summary: 'Approved durable memory is eligible for Alfred.',
      content: `${APPROVED_DURABLE_MARKER}: Alfred may use this approved durable MAS memory through the Context Pack.`,
    }),
  });
  await writeDurableMemoryRecord({
    projectRootPath,
    memoryRecord: buildGateDurableMemoryRecord({
      memoryRecordId: 'mem_gate_pending_durable',
      approvalState: 'pending',
      summary: 'Pending durable memory must not reach provider prompts.',
      content: `${PENDING_DURABLE_MARKER}: this pending durable memory is not approved.`,
    }),
  });
  await writeDurableMemoryRecord({
    projectRootPath,
    memoryRecord: buildGateDurableMemoryRecord({
      memoryRecordId: 'mem_gate_stale_durable',
      summary: 'Stale durable memory must not reach provider prompts by default.',
      content: `${STALE_DURABLE_MARKER}: this stale durable memory is obsolete.`,
      retention: {
        retentionPolicyId: 'integration-gate-stale',
        expiresAt: null,
        staleAfter: '2000-01-01T00:00:00.000Z',
        reviewRequiredAt: null,
      },
    }),
  });
  await writeDurableMemoryRecord({
    projectRootPath,
    memoryRecord: buildGateDurableMemoryRecord({
      memoryRecordId: 'mem_gate_redacted_durable',
      summary: 'Redacted durable memory must not reach provider prompts.',
      content: `${REDACTED_DURABLE_MARKER}: this redacted durable memory is protected.`,
      privacy: {
        redactionState: 'redacted',
        deletionState: 'active',
        redactedAt: '2026-04-14T00:00:00.000Z',
        deletedAt: null,
        reason: 'Integration gate redaction test.',
      },
    }),
  });
  await writeDurableMemoryRecord({
    projectRootPath,
    memoryRecord: buildGateDurableMemoryRecord({
      memoryRecordId: 'mem_gate_restricted_durable',
      visibility: 'restricted',
      summary: 'Restricted durable memory must not reach provider prompts.',
      content: `${RESTRICTED_DURABLE_MARKER}: this restricted durable memory is not prompt eligible.`,
    }),
  });

  const result = await withEnvironment(
    {
      "openrouter-api-key": 'openrouter-secret',
      "gemini-api-key": 'gemini-secret',
    },
    () => {
      return runAgentInvocation({
        projectRootPath,
        operationalIdentityId: 'alfred',
        invocationMode: 'probabilistic',
        command: 'ask',
        inputText: 'Use governed memory only and summarize the current MAS memory posture.',
        requestedBy: 'integration-gate-test',
        fetchImplementation: async (url, options) => {
          assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions');
          assert.equal(options.headers.Authorization, 'Bearer openrouter-secret');

          const body = JSON.parse(options.body);

          providerSystemMessages.push(body.messages[0].content);

          return {
            ok: true,
            async json() {
              return {
                id: 'openrouter-integration-gate',
                choices: [
                  {
                    finish_reason: 'stop',
                    message: {
                      content: 'Alfred completed the MC-PF integration gate review using governed context.',
                    },
                  },
                ],
                usage: {
                  prompt_tokens: 300,
                  completion_tokens: 20,
                  total_tokens: 320,
                },
              };
            },
          };
        },
      });
    },
  );
  const providerSystemMessage = providerSystemMessages[0];
  const invocationSession = JSON.parse(await readFile(result.persistence.invocationSessionRecordPath, 'utf8'));
  const contextPackLayer = invocationSession.promptProvenance.includedLayers.find((layer) => {
    return layer.layerType === 'context_pack';
  });
  const layersWithDurableSources = invocationSession.promptProvenance.includedLayers.filter((layer) => {
    return layer.sourceReferences.some((sourceReference) => {
      return sourceReference.sourceType === 'durable_memory_record';
    });
  });
  const provenancePayload = JSON.stringify(invocationSession.promptProvenance);

  assert.equal(result.status, 'completed');
  assert.equal(providerSystemMessages.length, 1);
  assert.match(providerSystemMessage, /Context Pack/u);
  assert.match(providerSystemMessage, new RegExp(APPROVED_DURABLE_MARKER, 'u'));
  assert.doesNotMatch(providerSystemMessage, new RegExp(PENDING_DURABLE_MARKER, 'u'));
  assert.doesNotMatch(providerSystemMessage, new RegExp(STALE_DURABLE_MARKER, 'u'));
  assert.doesNotMatch(providerSystemMessage, new RegExp(REDACTED_DURABLE_MARKER, 'u'));
  assert.doesNotMatch(providerSystemMessage, new RegExp(RESTRICTED_DURABLE_MARKER, 'u'));
  assert.doesNotMatch(providerSystemMessage, /openrouter-secret|gemini-secret/u);
  assert.match(providerSystemMessage, /Decision Type: approval_omission/u);
  assert.match(providerSystemMessage, /Decision Type: stale_source/u);
  assert.match(providerSystemMessage, /Decision Type: privacy_rejection/u);
  assert.match(providerSystemMessage, /Decision Type: sensitivity_rejection/u);
  assert.ok(contextPackLayer);
  assert.deepEqual(layersWithDurableSources.map((layer) => layer.layerType), ['context_pack']);
  assert.equal(contextPackLayer.sourceReferences.some((sourceReference) => {
    return sourceReference.sourceType === 'durable_memory_record'
      && sourceReference.sourceId === 'mem_gate_approved_durable';
  }), true);
  assert.doesNotMatch(provenancePayload, new RegExp(APPROVED_DURABLE_MARKER, 'u'));
  assert.doesNotMatch(provenancePayload, /openrouter-secret|gemini-secret/u);
  assert.equal(result.persistence.reportArtifactDecision.artifactClass, 'runtime_invocation_report');
  assert.equal(result.persistence.reportArtifactDecision.rawArtifactBodyPromptEligible, false);
  assert.equal(result.persistence.reportArtifactDecision.durableMemoryWriteEligible, false);
});
