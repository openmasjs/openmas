import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { runAgentInvocation } from '../../src/invocation/run-agent-invocation.js';
import {
  createAlfredProbabilisticProjectFixture,
  createDurableMemoryRecord,
  withEnvironment,
  writeDurableMemoryRecord,
} from '../helpers/create-alfred-probabilistic-fixture.js';

const COGNITIVE_MEMORY_MARKER = 'COGNITIVE_MEMORY_MARKER_SYSTEM_STEWARD_DIAGNOSTIC_PROTOCOL';
const OPERATIONAL_MEMORY_MARKER = 'OPERATIONAL_MEMORY_MARKER_ALFRED_PREFERS_AUDIT_TRAILS';
const MAS_MEMORY_MARKER = 'MAS_MEMORY_MARKER_SIN_CUCHILLO_ORGANIZATION_PROFILE';
const MAS_POLICY_MEMORY_MARKER = 'MAS_POLICY_MEMORY_MARKER_SYSTEM_ADMINISTRATION_RULES';
const DURABLE_RECALL_MARKER = 'DURABLE_RECALL_MARKER_ALFRED_APPROVED_CONTEXT';
const FALLBACK_MEMORY_MARKER = 'FALLBACK_MEMORY_MARKER_SURVIVES_PROVIDER_SWITCH';
const UNRELATED_COGNITIVE_MEMORY_MARKER = 'UNRELATED_COGNITIVE_MEMORY_MARKER_MEDIA_BUYER_BUDGETS';
const UNRELATED_OPERATIONAL_MEMORY_MARKER = 'UNRELATED_OPERATIONAL_MEMORY_MARKER_MARIA_PRIVATE_NOTE';
const ALFRED_MAS_STEWARD_ACID_MARKER = 'ALFRED_MAS_STEWARD_ACID_MEMORY_ALLOWED';
const ALFRED_ADMIN_PREFERENCE_MARKER = 'ALFRED_ADMIN_PREFERENCE_MEMORY_ALLOWED';
const ALFRED_MAS_DURABLE_HEALTH_MARKER = 'ALFRED_MAS_DURABLE_HEALTH_MEMORY_ALLOWED';
const ALFRED_STALE_DURABLE_MARKER = 'ALFRED_STALE_DURABLE_MEMORY_MUST_NOT_REACH_CONTEXT';
const ALFRED_PENDING_DURABLE_MARKER = 'ALFRED_PENDING_DURABLE_MEMORY_MUST_NOT_REACH_CONTEXT';
const ALFRED_SECRET_REFERENCE_MARKER = 'ALFRED_SECRET_REFERENCE_MEMORY_MUST_NOT_REACH_CONTEXT';
const ALFRED_JUAN_PRIVATE_MARKER = 'ALFRED_JUAN_PRIVATE_MEMORY_MUST_NOT_REACH_CONTEXT';

function createMemorySourceDefinition(overrides = {}) {
  return {
    sourceId: 'knowledge',
    sourceType: 'knowledge_directory',
    rootPath: 'memory/knowledge',
    scope: 'mas_instance',
    ownerId: 'sin-cuchillo',
    defaultPortability: 'not_exportable',
    defaultVisibility: 'shared_with_mas',
    defaultSensitivityLevel: 'internal',
    lifecycleState: 'active',
    readPolicy: {
      maxFiles: 20,
      maxBytesPerFile: 32768,
    },
    ...overrides,
  };
}

function createMemorySourceRegistry(memorySources) {
  return {
    kind: 'memory_source_registry',
    version: 1,
    memorySources,
  };
}

async function writeTextMemory({ projectRootPath, relativePath, content }) {
  const absolutePath = path.join(projectRootPath, 'instance', relativePath);

  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content, 'utf8');
}

async function writeMemorySourceRegistry({ projectRootPath, memorySources }) {
  await writeFile(
    path.join(projectRootPath, 'instance', 'memory', 'sources.json'),
    `${JSON.stringify(createMemorySourceRegistry(memorySources), null, 2)}\n`,
    'utf8',
  );
}

async function invokeAlfredWithPromptCapture({
  projectRootPath,
  inputText,
  providerSystemMessages,
  responseText = 'Alfred completed the memory availability probe.',
}) {
  return runAgentInvocation({
    projectRootPath,
    operationalIdentityId: 'alfred',
    invocationMode: 'probabilistic',
    command: 'ask',
    inputText,
    requestedBy: 'memory-availability-test',
    fetchImplementation: async (url, options) => {
      assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions');
      assert.equal(options.headers.Authorization, 'Bearer openrouter-secret');

      const body = JSON.parse(options.body);
      providerSystemMessages.push(body.messages[0].content);

      return {
        ok: true,
        async json() {
          return {
            id: `openrouter-memory-availability-${providerSystemMessages.length}`,
            choices: [
              {
                finish_reason: 'stop',
                message: {
                  content: responseText,
                },
              },
            ],
            usage: {
              prompt_tokens: 220,
              completion_tokens: 12,
              total_tokens: 232,
            },
          };
        },
      };
    },
  });
}

function findContextPackLayer(invocationSession) {
  return invocationSession.promptProvenance.includedLayers.find((layer) => {
    return layer.layerType === 'context_pack';
  });
}

function hasSourceReference(contextPackLayer, expected) {
  return contextPackLayer.sourceReferences.some((sourceReference) => {
    return Object.entries(expected).every(([key, value]) => {
      return sourceReference[key] === value;
    });
  });
}

test('Alfred invocation auto-creates the operational experience memory root when it is missing', async () => {
  await withEnvironment(
    {
      "openrouter-api-key": 'openrouter-secret',
      "gemini-api-key": 'gemini-secret',
    },
    async () => {
      const projectRootPath = await createAlfredProbabilisticProjectFixture();
      const providerSystemMessages = [];
      const operationalMemoryRootPath = path.join(
        projectRootPath,
        'instance',
        'operational-identities',
        'alfred',
        'memory',
      );

      await assert.rejects(access(operationalMemoryRootPath));

      const result = await invokeAlfredWithPromptCapture({
        projectRootPath,
        inputText: 'Do you have an operational experience root even when no files exist yet?',
        providerSystemMessages,
      });

      assert.equal(result.status, 'completed');
      await access(operationalMemoryRootPath);

      const invocationSession = JSON.parse(await readFile(result.persistence.invocationSessionRecordPath, 'utf8'));

      assert.equal(
        invocationSession.warnings.some((warning) => {
          return warning.includes('active-operational-alfred-memory rootPath does not exist');
        }),
        false,
      );
    },
  );
});

test('Alfred auto-loads active identity memory and default MAS memory without a custom memory registry', async () => {
  await withEnvironment(
    {
      "openrouter-api-key": 'openrouter-secret',
      "gemini-api-key": 'gemini-secret',
    },
    async () => {
      const projectRootPath = await createAlfredProbabilisticProjectFixture();
      const providerSystemMessages = [];

      await writeTextMemory({
        projectRootPath,
        relativePath: 'cognitive-identities/system-steward/memory/default-steward-memory.md',
        content: `# Default Steward Memory\n\n${COGNITIVE_MEMORY_MARKER}: default active cognitive identity memory is auto-discovered.`,
      });
      await writeTextMemory({
        projectRootPath,
        relativePath: 'operational-identities/alfred/memory/default-relationship-note.md',
        content: `# Default Alfred Relationship Note\n\n${OPERATIONAL_MEMORY_MARKER}: default operational identity memory is auto-discovered.`,
      });
      await writeTextMemory({
        projectRootPath,
        relativePath: 'memory/knowledge/default-organization-profile.md',
        content: `# Default Organization Profile\n\n${MAS_MEMORY_MARKER}: default MAS knowledge memory is available.`,
      });
      await writeTextMemory({
        projectRootPath,
        relativePath: 'memory/policies/default-system-administration-policy.md',
        content: `# Default System Administration Policy\n\n${MAS_POLICY_MEMORY_MARKER}: default MAS policy memory is available.`,
      });

      const result = await invokeAlfredWithPromptCapture({
        projectRootPath,
        inputText: 'Which default memories are available to you?',
        providerSystemMessages,
      });

      assert.equal(result.status, 'completed');

      const providerSystemMessage = providerSystemMessages[0];

      assert.match(providerSystemMessage, /Cognitive Identity Memory/);
      assert.match(providerSystemMessage, /Operational Identity Memory/);
      assert.match(providerSystemMessage, /Domain Knowledge/);
      assert.match(providerSystemMessage, /Policy Context/);
      assert.match(providerSystemMessage, new RegExp(COGNITIVE_MEMORY_MARKER, 'u'));
      assert.match(providerSystemMessage, new RegExp(OPERATIONAL_MEMORY_MARKER, 'u'));
      assert.match(providerSystemMessage, new RegExp(MAS_MEMORY_MARKER, 'u'));
      assert.match(providerSystemMessage, new RegExp(MAS_POLICY_MEMORY_MARKER, 'u'));

      const invocationSession = JSON.parse(await readFile(result.persistence.invocationSessionRecordPath, 'utf8'));
      const contextPackLayer = findContextPackLayer(invocationSession);

      assert.equal(hasSourceReference(contextPackLayer, {
        sourceType: 'agent_local_memory',
        path: 'cognitive-identities/system-steward/memory/default-steward-memory.md',
      }), true);
      assert.equal(hasSourceReference(contextPackLayer, {
        sourceType: 'operational_identity_memory',
        path: 'operational-identities/alfred/memory/default-relationship-note.md',
      }), true);
      assert.equal(hasSourceReference(contextPackLayer, {
        sourceType: 'knowledge_document',
        path: 'memory/knowledge/default-organization-profile.md',
      }), true);
      assert.equal(hasSourceReference(contextPackLayer, {
        sourceType: 'policy_document',
        path: 'memory/policies/default-system-administration-policy.md',
      }), true);
      assert.doesNotMatch(JSON.stringify(invocationSession), new RegExp(COGNITIVE_MEMORY_MARKER, 'u'));
      assert.doesNotMatch(JSON.stringify(invocationSession), new RegExp(OPERATIONAL_MEMORY_MARKER, 'u'));
      assert.doesNotMatch(JSON.stringify(invocationSession), new RegExp(MAS_MEMORY_MARKER, 'u'));
      assert.doesNotMatch(JSON.stringify(invocationSession), new RegExp(MAS_POLICY_MEMORY_MARKER, 'u'));
    },
  );
});

test('Alfred receives active cognitive identity, operational identity, and MAS memory in probabilistic prompts', async () => {
  await withEnvironment(
    {
      "openrouter-api-key": 'openrouter-secret',
      "gemini-api-key": 'gemini-secret',
    },
    async () => {
      const projectRootPath = await createAlfredProbabilisticProjectFixture();
      const providerSystemMessages = [];

      await writeMemorySourceRegistry({
        projectRootPath,
        memorySources: [
          createMemorySourceDefinition({
            sourceId: 'system-steward-portable-memory',
            sourceType: 'cognitive_identity_memory_directory',
            rootPath: 'cognitive-identities/system-steward/memory',
            scope: 'cognitive_identity',
            ownerId: 'system-steward',
            defaultPortability: 'portable',
            defaultVisibility: 'shared_with_mas',
            description: 'Portable expert memory for the System Steward cognitive identity.',
          }),
          createMemorySourceDefinition({
            sourceId: 'media-buyer-portable-memory',
            sourceType: 'cognitive_identity_memory_directory',
            rootPath: 'cognitive-identities/marketing-and-sales/media-buyer/memory',
            scope: 'cognitive_identity',
            ownerId: 'media-buyer',
            defaultPortability: 'portable',
            defaultVisibility: 'shared_with_mas',
            description: 'Unrelated portable expert memory that Alfred must not receive.',
          }),
          createMemorySourceDefinition({
            sourceId: 'alfred-private-memory',
            sourceType: 'operational_identity_memory_directory',
            rootPath: 'operational-identities/alfred/memory',
            scope: 'operational_identity',
            ownerId: 'alfred',
            defaultPortability: 'mas_bound',
            defaultVisibility: 'private_to_owner',
            description: 'Private lived memory for Alfred inside this MAS instance.',
          }),
          createMemorySourceDefinition({
            sourceId: 'maria-private-memory',
            sourceType: 'operational_identity_memory_directory',
            rootPath: 'operational-identities/maria/memory',
            scope: 'operational_identity',
            ownerId: 'maria',
            defaultPortability: 'mas_bound',
            defaultVisibility: 'private_to_owner',
            description: 'Unrelated private operational memory that Alfred must not receive.',
          }),
          createMemorySourceDefinition({
            sourceId: 'mas-knowledge',
            sourceType: 'knowledge_directory',
            rootPath: 'memory/knowledge',
            scope: 'mas_instance',
            ownerId: 'sin-cuchillo',
            defaultPortability: 'not_exportable',
            defaultVisibility: 'shared_with_mas',
            description: 'MAS-owned organization memory available to Alfred.',
          }),
        ],
      });
      await writeTextMemory({
        projectRootPath,
        relativePath: 'cognitive-identities/system-steward/memory/steward-diagnostic-protocol.md',
        content: `# Steward Diagnostic Protocol\n\n${COGNITIVE_MEMORY_MARKER}: Alfred can use the System Steward portable diagnostic protocol.`,
      });
      await writeTextMemory({
        projectRootPath,
        relativePath: 'cognitive-identities/marketing-and-sales/media-buyer/memory/budget-rules.md',
        content: `# Media Buyer Budget Rules\n\n${UNRELATED_COGNITIVE_MEMORY_MARKER}: this media buyer memory must not enter Alfred context.`,
      });
      await writeTextMemory({
        projectRootPath,
        relativePath: 'operational-identities/alfred/memory/relationship-note.md',
        content: `# Alfred Relationship Note\n\n${OPERATIONAL_MEMORY_MARKER}: Alfred remembers that audit trails should be explicit.`,
      });
      await writeTextMemory({
        projectRootPath,
        relativePath: 'operational-identities/maria/memory/private-note.md',
        content: `# Maria Private Note\n\n${UNRELATED_OPERATIONAL_MEMORY_MARKER}: Maria private memory must not enter Alfred context.`,
      });
      await writeTextMemory({
        projectRootPath,
        relativePath: 'memory/knowledge/organization-profile.md',
        content: `# Organization Profile\n\n${MAS_MEMORY_MARKER}: Sin Cuchillo is the current MAS organization.`,
      });

      const result = await invokeAlfredWithPromptCapture({
        projectRootPath,
        inputText: 'Which governed memories are available to you right now?',
        providerSystemMessages,
      });

      assert.equal(result.status, 'completed');

      const providerSystemMessage = providerSystemMessages[0];

      assert.match(providerSystemMessage, /Cognitive Identity Memory/);
      assert.match(providerSystemMessage, /Operational Identity Memory/);
      assert.match(providerSystemMessage, /Domain Knowledge/);
      assert.match(providerSystemMessage, new RegExp(COGNITIVE_MEMORY_MARKER, 'u'));
      assert.match(providerSystemMessage, new RegExp(OPERATIONAL_MEMORY_MARKER, 'u'));
      assert.match(providerSystemMessage, new RegExp(MAS_MEMORY_MARKER, 'u'));
      assert.doesNotMatch(providerSystemMessage, new RegExp(UNRELATED_COGNITIVE_MEMORY_MARKER, 'u'));
      assert.doesNotMatch(providerSystemMessage, new RegExp(UNRELATED_OPERATIONAL_MEMORY_MARKER, 'u'));

      const invocationSession = JSON.parse(await readFile(result.persistence.invocationSessionRecordPath, 'utf8'));
      const contextPackLayer = findContextPackLayer(invocationSession);
      const serializedSession = JSON.stringify(invocationSession);

      assert.ok(contextPackLayer);
      assert.equal(hasSourceReference(contextPackLayer, {
        sourceType: 'agent_local_memory',
        path: 'cognitive-identities/system-steward/memory/steward-diagnostic-protocol.md',
      }), true);
      assert.equal(hasSourceReference(contextPackLayer, {
        sourceType: 'operational_identity_memory',
        path: 'operational-identities/alfred/memory/relationship-note.md',
      }), true);
      assert.equal(hasSourceReference(contextPackLayer, {
        sourceType: 'knowledge_document',
        path: 'memory/knowledge/organization-profile.md',
      }), true);
      assert.doesNotMatch(serializedSession, new RegExp(COGNITIVE_MEMORY_MARKER, 'u'));
      assert.doesNotMatch(serializedSession, new RegExp(OPERATIONAL_MEMORY_MARKER, 'u'));
      assert.doesNotMatch(serializedSession, new RegExp(MAS_MEMORY_MARKER, 'u'));
      assert.doesNotMatch(serializedSession, /openrouter-secret/u);
    },
  );
});

test('Alfred carries the same governed memory context through fallback brain execution', async () => {
  await withEnvironment(
    {
      "openrouter-api-key": 'openrouter-secret',
      "gemini-api-key": 'gemini-secret',
    },
    async () => {
      const projectRootPath = await createAlfredProbabilisticProjectFixture();
      const capturedSystemMessages = [];

      await writeTextMemory({
        projectRootPath,
        relativePath: 'cognitive-identities/system-steward/memory/fallback-steward-memory.md',
        content: `# Fallback Steward Memory\n\n${FALLBACK_MEMORY_MARKER}: this memory must survive fallback provider execution.`,
      });
      await writeTextMemory({
        projectRootPath,
        relativePath: 'operational-identities/alfred/memory/fallback-relationship-note.md',
        content: `# Fallback Alfred Relationship Note\n\n${OPERATIONAL_MEMORY_MARKER}: Alfred operational memory must survive fallback provider execution.`,
      });
      await writeTextMemory({
        projectRootPath,
        relativePath: 'memory/knowledge/fallback-organization-profile.md',
        content: `# Fallback Organization Profile\n\n${MAS_MEMORY_MARKER}: MAS memory must survive fallback provider execution.`,
      });

      const result = await runAgentInvocation({
        projectRootPath,
        operationalIdentityId: 'alfred',
        invocationMode: 'probabilistic',
        command: 'ask',
        inputText: 'Use governed memory even if the primary provider fails.',
        requestedBy: 'memory-availability-test',
        fetchImplementation: async (url, options) => {
          if (url === 'https://openrouter.ai/api/v1/chat/completions') {
            const body = JSON.parse(options.body);
            capturedSystemMessages.push({
              providerId: 'openrouter-api',
              content: body.messages[0].content,
            });

            return {
              ok: false,
              status: 503,
              async text() {
                return 'OpenRouter unavailable for fallback memory continuity test.';
              },
            };
          }

          assert.match(url, /^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/models\/gemini-flash-latest:generateContent/u);

          const body = JSON.parse(options.body);
          capturedSystemMessages.push({
            providerId: 'gemini-api',
            content: body.systemInstruction.parts.map((part) => part.text).join('\n'),
          });

          return {
            ok: true,
            async json() {
              return {
                responseId: 'gemini-memory-fallback-response',
                candidates: [
                  {
                    finishReason: 'STOP',
                    content: {
                      parts: [
                        {
                          text: 'Gemini fallback preserved Alfred governed memory context.',
                        },
                      ],
                    },
                  },
                ],
                usageMetadata: {
                  promptTokenCount: 240,
                  candidatesTokenCount: 10,
                  totalTokenCount: 250,
                },
              };
            },
          };
        },
      });

      assert.equal(result.status, 'completed');
      assert.equal(result.output.providerId, 'gemini-api');
      assert.equal(result.message.includes('after fallback from openrouter-api'), true);
      assert.equal(capturedSystemMessages.length, 2);

      for (const capturedMessage of capturedSystemMessages) {
        assert.match(capturedMessage.content, new RegExp(FALLBACK_MEMORY_MARKER, 'u'));
        assert.match(capturedMessage.content, new RegExp(OPERATIONAL_MEMORY_MARKER, 'u'));
        assert.match(capturedMessage.content, new RegExp(MAS_MEMORY_MARKER, 'u'));
      }

      const invocationSession = JSON.parse(await readFile(result.persistence.invocationSessionRecordPath, 'utf8'));
      const finalContextPackLayer = findContextPackLayer(invocationSession);

      assert.equal(invocationSession.brainExecution.fallbackUsed, true);
      assert.equal(invocationSession.brainExecution.attempts[0].promptProvenance.includedLayers.at(-1).layerType, 'context_pack');
      assert.equal(invocationSession.brainExecution.attempts[1].promptProvenance.includedLayers.at(-1).layerType, 'context_pack');
      assert.equal(hasSourceReference(finalContextPackLayer, {
        sourceType: 'agent_local_memory',
        path: 'cognitive-identities/system-steward/memory/fallback-steward-memory.md',
      }), true);
      assert.doesNotMatch(JSON.stringify(invocationSession), new RegExp(FALLBACK_MEMORY_MARKER, 'u'));
      assert.doesNotMatch(JSON.stringify(invocationSession), /openrouter-secret/u);
      assert.doesNotMatch(JSON.stringify(invocationSession), /gemini-secret/u);
    },
  );
});

test('Alfred MAS stewardship acid test keeps private and unsafe memory out of probabilistic diagnostics', async () => {
  await withEnvironment(
    {
      "openrouter-api-key": 'openrouter-secret',
      "gemini-api-key": 'gemini-secret',
    },
    async () => {
      const projectRootPath = await createAlfredProbabilisticProjectFixture();
      const providerSystemMessages = [];

      await writeMemorySourceRegistry({
        projectRootPath,
        memorySources: [
          createMemorySourceDefinition({
            sourceId: 'system-steward-memory',
            sourceType: 'cognitive_identity_memory_directory',
            rootPath: 'cognitive-identities/system-steward/memory',
            scope: 'cognitive_identity',
            ownerId: 'system-steward',
            defaultPortability: 'portable',
            defaultVisibility: 'shared_with_mas',
          }),
          createMemorySourceDefinition({
            sourceId: 'media-buyer-overregistered-memory',
            sourceType: 'cognitive_identity_memory_directory',
            rootPath: 'cognitive-identities/marketing-and-sales/media-buyer/memory',
            scope: 'cognitive_identity',
            ownerId: 'media-buyer',
            defaultPortability: 'portable',
            defaultVisibility: 'shared_with_mas',
          }),
          createMemorySourceDefinition({
            sourceId: 'alfred-private-memory',
            sourceType: 'operational_identity_memory_directory',
            rootPath: 'operational-identities/alfred/memory',
            scope: 'operational_identity',
            ownerId: 'alfred',
            defaultPortability: 'mas_bound',
            defaultVisibility: 'private_to_owner',
          }),
          createMemorySourceDefinition({
            sourceId: 'maria-private-memory-overregistered',
            sourceType: 'operational_identity_memory_directory',
            rootPath: 'operational-identities/maria/memory',
            scope: 'operational_identity',
            ownerId: 'maria',
            defaultPortability: 'mas_bound',
            defaultVisibility: 'private_to_owner',
          }),
          createMemorySourceDefinition({
            sourceId: 'juan-private-memory-overregistered',
            sourceType: 'operational_identity_memory_directory',
            rootPath: 'operational-identities/juan/memory',
            scope: 'operational_identity',
            ownerId: 'juan',
            defaultPortability: 'mas_bound',
            defaultVisibility: 'private_to_owner',
          }),
          createMemorySourceDefinition({
            sourceId: 'mas-knowledge',
            sourceType: 'knowledge_directory',
            rootPath: 'memory/knowledge',
            scope: 'mas_instance',
            ownerId: 'sin-cuchillo',
            defaultPortability: 'not_exportable',
            defaultVisibility: 'shared_with_mas',
          }),
          createMemorySourceDefinition({
            sourceId: 'mas-policies',
            sourceType: 'policies_directory',
            rootPath: 'memory/policies',
            scope: 'mas_instance',
            ownerId: 'sin-cuchillo',
            defaultPortability: 'not_exportable',
            defaultVisibility: 'shared_with_mas',
          }),
          createMemorySourceDefinition({
            sourceId: 'durable-memory',
            sourceType: 'durable_memory_directory',
            rootPath: 'memory/durable',
            scope: 'mas_instance',
            ownerId: 'sin-cuchillo',
            defaultPortability: 'not_exportable',
            defaultVisibility: 'shared_with_mas',
            readPolicy: {
              maxFiles: 50,
              maxBytesPerFile: 65536,
            },
          }),
        ],
      });
      await writeTextMemory({
        projectRootPath,
        relativePath: 'cognitive-identities/system-steward/memory/mas-diagnostic-protocol.md',
        content: `# MAS Diagnostic Protocol\n\n${ALFRED_MAS_STEWARD_ACID_MARKER}: Alfred may use System Steward diagnostic memory when inspecting MAS health.`,
      });
      await writeTextMemory({
        projectRootPath,
        relativePath: 'cognitive-identities/marketing-and-sales/media-buyer/memory/budget-rules.md',
        content: `# Budget Rules\n\n${UNRELATED_COGNITIVE_MEMORY_MARKER}: media buyer memory must not enter Alfred stewardship diagnostics.`,
      });
      await writeTextMemory({
        projectRootPath,
        relativePath: 'operational-identities/alfred/memory/admin-preference.md',
        content: `# Alfred Admin Preference\n\n${ALFRED_ADMIN_PREFERENCE_MARKER}: Alfred should answer MAS diagnostics with short auditable findings.`,
      });
      await writeTextMemory({
        projectRootPath,
        relativePath: 'operational-identities/maria/memory/private-note.md',
        content: `# Maria Private Note\n\n${UNRELATED_OPERATIONAL_MEMORY_MARKER}: Maria private memory must not enter Alfred diagnostics.`,
      });
      await writeTextMemory({
        projectRootPath,
        relativePath: 'operational-identities/juan/memory/private-note.md',
        content: `# Juan Private Note\n\n${ALFRED_JUAN_PRIVATE_MARKER}: Juan private memory must not enter Alfred diagnostics.`,
      });
      await writeTextMemory({
        projectRootPath,
        relativePath: 'memory/knowledge/mas-health-profile.md',
        content: `# MAS Health Profile\n\n${MAS_MEMORY_MARKER}: Alfred may use shared MAS health profile memory.`,
      });
      await writeTextMemory({
        projectRootPath,
        relativePath: 'memory/policies/system-diagnostics-policy.md',
        content: `# System Diagnostics Policy\n\n${MAS_POLICY_MEMORY_MARKER}: Alfred must summarize diagnostics without exposing private operational memories or secret values.`,
      });
      await writeDurableMemoryRecord({
        projectRootPath,
        memoryRecord: createDurableMemoryRecord({
          memoryRecordId: 'mem_alfred_mas_durable_health_signal',
          summary: 'Approved durable MAS health signal for Alfred.',
          content: `${ALFRED_MAS_DURABLE_HEALTH_MARKER}: approved durable MAS health signal is safe for Alfred diagnostics.`,
        }),
      });
      await writeDurableMemoryRecord({
        projectRootPath,
        memoryRecord: createDurableMemoryRecord({
          memoryRecordId: 'mem_alfred_stale_durable_health_signal',
          summary: 'Stale durable MAS health signal must not shape Alfred.',
          content: `${ALFRED_STALE_DURABLE_MARKER}: stale durable health signal must stay out.`,
          retention: {
            retentionPolicyId: 'stale-health-signal',
            expiresAt: null,
            staleAfter: '2026-01-01T00:00:00.000Z',
            reviewRequiredAt: null,
          },
        }),
      });
      await writeDurableMemoryRecord({
        projectRootPath,
        memoryRecord: createDurableMemoryRecord({
          memoryRecordId: 'mem_alfred_pending_durable_health_signal',
          summary: 'Pending durable MAS health signal must not shape Alfred.',
          content: `${ALFRED_PENDING_DURABLE_MARKER}: pending durable health signal must stay out.`,
          approvalState: 'pending',
          confidence: 'agent_proposed',
        }),
      });
      await writeDurableMemoryRecord({
        projectRootPath,
        memoryRecord: createDurableMemoryRecord({
          memoryRecordId: 'mem_alfred_secret_reference_health_signal',
          summary: `${ALFRED_SECRET_REFERENCE_MARKER}: secret-reference-only durable memory must not shape Alfred.`,
          content: null,
          sensitivityLevel: 'secret_reference_only',
        }),
      });

      const result = await invokeAlfredWithPromptCapture({
        projectRootPath,
        inputText: 'Diagnose MAS memory health using only governed context. Do not expose private memories or secrets.',
        providerSystemMessages,
      });

      assert.equal(result.status, 'completed');

      const providerSystemMessage = providerSystemMessages[0];

      assert.match(providerSystemMessage, new RegExp(ALFRED_MAS_STEWARD_ACID_MARKER, 'u'));
      assert.match(providerSystemMessage, new RegExp(ALFRED_ADMIN_PREFERENCE_MARKER, 'u'));
      assert.match(providerSystemMessage, new RegExp(MAS_MEMORY_MARKER, 'u'));
      assert.match(providerSystemMessage, new RegExp(MAS_POLICY_MEMORY_MARKER, 'u'));
      assert.match(providerSystemMessage, new RegExp(ALFRED_MAS_DURABLE_HEALTH_MARKER, 'u'));
      assert.doesNotMatch(providerSystemMessage, new RegExp(UNRELATED_COGNITIVE_MEMORY_MARKER, 'u'));
      assert.doesNotMatch(providerSystemMessage, new RegExp(UNRELATED_OPERATIONAL_MEMORY_MARKER, 'u'));
      assert.doesNotMatch(providerSystemMessage, new RegExp(ALFRED_JUAN_PRIVATE_MARKER, 'u'));
      assert.doesNotMatch(providerSystemMessage, new RegExp(ALFRED_STALE_DURABLE_MARKER, 'u'));
      assert.doesNotMatch(providerSystemMessage, new RegExp(ALFRED_PENDING_DURABLE_MARKER, 'u'));
      assert.doesNotMatch(providerSystemMessage, new RegExp(ALFRED_SECRET_REFERENCE_MARKER, 'u'));
      assert.doesNotMatch(providerSystemMessage, /openrouter-secret/u);
      assert.doesNotMatch(providerSystemMessage, /gemini-secret/u);
      assert.match(providerSystemMessage, /Cognitive identity memory .* belongs to media-buyer, which is not active/u);
      assert.match(providerSystemMessage, /Operational identity memory .* belongs to maria, not alfred/u);
      assert.match(providerSystemMessage, /Operational identity memory .* belongs to juan, not alfred/u);
      assert.match(providerSystemMessage, /Decision Type: stale_source/u);
      assert.match(providerSystemMessage, /Decision Type: approval_omission/u);
      assert.match(providerSystemMessage, /Decision Type: sensitivity_rejection/u);

      const invocationSession = JSON.parse(await readFile(result.persistence.invocationSessionRecordPath, 'utf8'));
      const contextPackLayer = findContextPackLayer(invocationSession);
      const serializedSession = JSON.stringify(invocationSession);

      assert.equal(hasSourceReference(contextPackLayer, {
        sourceType: 'agent_local_memory',
        path: 'cognitive-identities/system-steward/memory/mas-diagnostic-protocol.md',
      }), true);
      assert.equal(hasSourceReference(contextPackLayer, {
        sourceType: 'operational_identity_memory',
        path: 'operational-identities/alfred/memory/admin-preference.md',
      }), true);
      assert.equal(hasSourceReference(contextPackLayer, {
        sourceType: 'durable_memory_record',
        sourceId: 'mem_alfred_mas_durable_health_signal',
        path: 'memory/durable/memory-record-mem_alfred_mas_durable_health_signal.json',
      }), true);
      assert.equal(hasSourceReference(contextPackLayer, {
        sourceType: 'operational_identity_memory',
        path: 'operational-identities/maria/memory/private-note.md',
      }), false);
      assert.equal(hasSourceReference(contextPackLayer, {
        sourceType: 'operational_identity_memory',
        path: 'operational-identities/juan/memory/private-note.md',
      }), false);
      assert.doesNotMatch(serializedSession, new RegExp(ALFRED_MAS_DURABLE_HEALTH_MARKER, 'u'));
      assert.doesNotMatch(serializedSession, new RegExp(UNRELATED_OPERATIONAL_MEMORY_MARKER, 'u'));
      assert.doesNotMatch(serializedSession, /openrouter-secret/u);
      assert.doesNotMatch(serializedSession, /gemini-secret/u);
    },
  );
});

test('Alfred can remember newly written operational identity memory in a future invocation', async () => {
  await withEnvironment(
    {
      "openrouter-api-key": 'openrouter-secret',
      "gemini-api-key": 'gemini-secret',
    },
    async () => {
      const projectRootPath = await createAlfredProbabilisticProjectFixture();
      const providerSystemMessages = [];

      await writeMemorySourceRegistry({
        projectRootPath,
        memorySources: [
          createMemorySourceDefinition({
            sourceId: 'alfred-private-memory',
            sourceType: 'operational_identity_memory_directory',
            rootPath: 'operational-identities/alfred/memory',
            scope: 'operational_identity',
            ownerId: 'alfred',
            defaultPortability: 'mas_bound',
            defaultVisibility: 'private_to_owner',
          }),
        ],
      });

      const firstResult = await invokeAlfredWithPromptCapture({
        projectRootPath,
        inputText: 'Do you have a future operational memory marker yet?',
        providerSystemMessages,
      });

      assert.equal(firstResult.status, 'completed');
      assert.doesNotMatch(providerSystemMessages[0], /OPERATIONAL_FUTURE_RECALL_MARKER/u);

      await writeTextMemory({
        projectRootPath,
        relativePath: 'operational-identities/alfred/memory/relationship-note.md',
        content: '# Alfred Relationship Note\n\nOPERATIONAL_FUTURE_RECALL_MARKER: Alfred remembers that the administrator wants short memory diagnostics.',
      });

      const secondResult = await invokeAlfredWithPromptCapture({
        projectRootPath,
        inputText: 'What did your operational memory learn for future diagnostics?',
        providerSystemMessages,
      });

      assert.equal(secondResult.status, 'completed');
      assert.match(providerSystemMessages[1], /OPERATIONAL_FUTURE_RECALL_MARKER/u);

      const invocationSession = JSON.parse(await readFile(secondResult.persistence.invocationSessionRecordPath, 'utf8'));
      const contextPackLayer = findContextPackLayer(invocationSession);

      assert.equal(hasSourceReference(contextPackLayer, {
        sourceType: 'operational_identity_memory',
        path: 'operational-identities/alfred/memory/relationship-note.md',
      }), true);
      assert.doesNotMatch(JSON.stringify(invocationSession), /OPERATIONAL_FUTURE_RECALL_MARKER/u);
    },
  );
});

test('Alfred can remember newly approved durable MAS memory in a future invocation', async () => {
  await withEnvironment(
    {
      "openrouter-api-key": 'openrouter-secret',
      "gemini-api-key": 'gemini-secret',
    },
    async () => {
      const projectRootPath = await createAlfredProbabilisticProjectFixture();
      const providerSystemMessages = [];

      const firstResult = await invokeAlfredWithPromptCapture({
        projectRootPath,
        inputText: 'Do you have a durable recall marker yet?',
        providerSystemMessages,
      });

      assert.equal(firstResult.status, 'completed');
      assert.doesNotMatch(providerSystemMessages[0], new RegExp(DURABLE_RECALL_MARKER, 'u'));

      await writeDurableMemoryRecord({
        projectRootPath,
        memoryRecord: createDurableMemoryRecord({
          memoryRecordId: 'mem_alfred_future_durable_recall',
          summary: 'Alfred has a newly approved durable MAS recall marker.',
          content: `${DURABLE_RECALL_MARKER}: Alfred can recall newly approved durable MAS memory in later invocations.`,
        }),
      });

      const secondResult = await invokeAlfredWithPromptCapture({
        projectRootPath,
        inputText: 'What durable MAS memory became available after the previous invocation?',
        providerSystemMessages,
      });

      assert.equal(secondResult.status, 'completed');
      assert.match(providerSystemMessages[1], new RegExp(DURABLE_RECALL_MARKER, 'u'));

      const invocationSession = JSON.parse(await readFile(secondResult.persistence.invocationSessionRecordPath, 'utf8'));
      const contextPackLayer = findContextPackLayer(invocationSession);

      assert.equal(hasSourceReference(contextPackLayer, {
        sourceType: 'durable_memory_record',
        sourceId: 'mem_alfred_future_durable_recall',
        path: 'memory/durable/memory-record-mem_alfred_future_durable_recall.json',
      }), true);
      assert.doesNotMatch(JSON.stringify(invocationSession), new RegExp(DURABLE_RECALL_MARKER, 'u'));
    },
  );
});
