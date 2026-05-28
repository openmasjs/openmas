import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { generateMasterKey } from '../../src/credentials/generate-master-key.js';
import { writeCredentialVault } from '../../src/credentials/write-credential-vault.js';
import { runAgentInvocation } from '../../src/invocation/run-agent-invocation.js';
import {
  createDurableMemoryRecord,
  withEnvironment,
  writeDurableMemoryRecord,
} from '../helpers/create-alfred-probabilistic-fixture.js';

const SHARED_COMMUNITY_MEMORY_MARKER = 'SHARED_COMMUNITY_MEMORY_MARKER_VISIBLE_TO_MARIA_AND_JUAN';
const MARIA_COPYWRITER_MEMORY_MARKER = 'MARIA_COPYWRITER_MEMORY_MARKER_VISIBLE_ONLY_TO_MARIA';
const JUAN_MEDIA_BUYER_MEMORY_MARKER = 'JUAN_MEDIA_BUYER_MEMORY_MARKER_VISIBLE_ONLY_TO_JUAN';
const MARIA_OPERATIONAL_MEMORY_MARKER = 'MARIA_OPERATIONAL_MEMORY_MARKER_PRIVATE_TO_MARIA';
const JUAN_OPERATIONAL_MEMORY_MARKER = 'JUAN_OPERATIONAL_MEMORY_MARKER_PRIVATE_TO_JUAN';
const MAS_SHARED_MEMORY_MARKER = 'MAS_SHARED_MEMORY_MARKER_VISIBLE_TO_BOTH_MARIA_AND_JUAN';
const MAS_POLICY_MEMORY_MARKER = 'MAS_POLICY_MEMORY_MARKER_VISIBLE_TO_BOTH_MARIA_AND_JUAN';
const DURABLE_SHARED_MEMORY_MARKER = 'DURABLE_SHARED_MEMORY_MARKER_VISIBLE_TO_BOTH_MARIA_AND_JUAN';
const MARIA_FUTURE_RECALL_MARKER = 'MARIA_FUTURE_RECALL_MARKER_NOT_VISIBLE_TO_JUAN';
const MARIA_SHARED_OPERATIONAL_MEMORY_MARKER = 'MARIA_SHARED_OPERATIONAL_MEMORY_MARKER_VISIBLE_TO_JUAN_WHEN_APPROVED';
const MARIA_HUMAN_PREFERENCE_MARKER = 'MARIA_HUMAN_PREFERENCE_MARKER_HIGHER_PRIORITY_THAN_RUNTIME_NOISE';
const RUNTIME_NOISE_MARKER = 'RUNTIME_NOISE_MARKER_MUST_NOT_CROWD_OUT_IDENTITY_MEMORY';
const ARTIFACT_NOISE_MARKER = 'ARTIFACT_NOISE_MARKER_MUST_NOT_CROWD_OUT_IDENTITY_MEMORY';
const RESTRICTED_MEMORY_MARKER = 'RESTRICTED_MEMORY_MARKER_MUST_NOT_REACH_PROVIDER_PROMPT';
const SECRET_REFERENCE_MEMORY_MARKER = 'SECRET_REFERENCE_MEMORY_MARKER_MUST_NOT_REACH_PROVIDER_PROMPT';

async function createDirectoryTree(rootPath, relativePaths) {
  for (const relativePath of relativePaths) {
    await mkdir(path.join(rootPath, relativePath), { recursive: true });
  }
}

async function writeJsonFile(filePath, payload) {
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

async function writeTextFile(filePath, content) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, 'utf8');
}

async function writePortableCognitiveIdentity({ projectRootPath, relativeCognitiveIdentityPath, title }) {
  const cognitiveIdentityRootPath = path.join(projectRootPath, 'instance', 'cognitive-identities', relativeCognitiveIdentityPath);

  await mkdir(cognitiveIdentityRootPath, { recursive: true });
  await writeFile(path.join(cognitiveIdentityRootPath, 'identity.md'), `# ${title}\n\n${title} cognitive identity.`, 'utf8');
  await writeFile(path.join(cognitiveIdentityRootPath, 'policies.md'), '# Policies\n\n- Use governed memory only.', 'utf8');
  await writeFile(path.join(cognitiveIdentityRootPath, 'capabilities.md'), '# Capabilities\n\n- Use role-specific context carefully.', 'utf8');
}

function createSecretReferenceRegistryContent() {
  return {
    kind: 'secret_reference_registry',
    version: 1,
    secretReferences: [
      {
        kind: 'secret_reference_definition',
        version: 1,
        secretReferenceId: 'openrouter-api-key',
        secretType: 'api_key',
        valueShape: 'string',
      },
      {
        kind: 'secret_reference_definition',
        version: 1,
        secretReferenceId: 'gemini-api-key',
        secretType: 'api_key',
        valueShape: 'string',
      },
    ],
  };
}

function createCredentialVaultContent() {
  return {
    'openrouter-api-key': 'openrouter-secret',
    'gemini-api-key': 'gemini-secret',
  };
}

async function writeDevelopmentCredentialVault(projectRootPath) {
  const masterKeyHex = generateMasterKey();

  await mkdir(path.join(projectRootPath, 'config', 'credentials'), { recursive: true });
  await writeFile(path.join(projectRootPath, 'config', 'credentials', 'development.key'), masterKeyHex, 'utf8');
  await writeCredentialVault({
    projectRootPath,
    environment: 'development',
    credentials: createCredentialVaultContent(),
    masterKeyHex,
  });
}

function createResourcesRegistryContent() {
  return {
    kind: 'resource_registry',
    version: 1,
    resources: [
      {
        kind: 'resource_definition',
        version: 1,
        resourceId: 'openrouter-api',
        resourceType: 'brain-provider',
        displayName: 'OpenRouter API',
        ownershipScope: 'shared',
        lifecycleState: 'active',
      },
      {
        kind: 'resource_definition',
        version: 1,
        resourceId: 'gemini-api',
        resourceType: 'brain-provider',
        displayName: 'Gemini API',
        ownershipScope: 'shared',
        lifecycleState: 'active',
      },
    ],
  };
}

function createBindingsContent(operationalIdentityId) {
  return {
    kind: 'operational_identity_bindings',
    version: 1,
    operationalIdentityId,
    bindings: [
      {
        resourceId: 'openrouter-api',
        accessMode: 'execute',
        bindingState: 'active',
        secretReferenceId: 'openrouter-api-key',
      },
      {
        resourceId: 'gemini-api',
        accessMode: 'execute',
        bindingState: 'active',
        secretReferenceId: 'gemini-api-key',
      },
    ],
  };
}

function createPermissionsContent(operationalIdentityId) {
  return {
    kind: 'operational_identity_permissions',
    version: 1,
    operationalIdentityId,
    defaultEffect: 'deny',
    rules: [
      {
        ruleId: 'allow-openrouter-execute',
        effect: 'allow',
        resourceId: 'openrouter-api',
        accessModes: ['execute'],
      },
      {
        ruleId: 'allow-gemini-execute',
        effect: 'allow',
        resourceId: 'gemini-api',
        accessModes: ['execute'],
      },
    ],
  };
}

function createOperationalIdentityDefinition({
  operationalIdentityId,
  displayName,
  auditActorId,
  attachedCognitiveIdentityIds,
  executionProfileId,
  tone,
}) {
  return {
    kind: 'operational_identity_definition',
    version: 1,
    operationalIdentityId,
    displayName,
    lifecycleState: 'active',
    auditActorId,
    attachedCognitiveIdentities: attachedCognitiveIdentityIds.map((cognitiveIdentityId) => {
      return { cognitiveIdentityId };
    }),
    executionProfileId,
    persona: {
      tone,
    },
  };
}

function createRoutingDefinition({
  primaryCognitiveIdentityId,
  secondaryCognitiveIdentityIds,
}) {
  return {
    kind: 'operational_identity_routing_definition',
    version: 1,
    defaultPrimaryCognitiveIdentityId: primaryCognitiveIdentityId,
    commandRoutes: [
      {
        command: 'ask',
        primaryCognitiveIdentityId,
        secondaryCognitiveIdentityIds,
      },
    ],
  };
}

function createExecutionProfileDefinition({
  executionProfileId,
  primaryBrainId,
  enabledCommands = ['ask'],
}) {
  return {
    kind: 'execution_profile_definition',
    version: 1,
    executionProfileId,
    executionMode: 'hybrid',
    primaryBrain: {
      brainId: primaryBrainId,
      providerId: 'openrouter-api',
      modelId: 'openrouter/free',
    },
    fallbackBrain: {
      brainId: 'gemini-fallback',
      providerId: 'gemini-api',
      modelId: 'gemini-flash-latest',
    },
    enabledCommands,
  };
}

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

async function writeOverbroadMemorySourceRegistry({ projectRootPath }) {
  await writeJsonFile(
    path.join(projectRootPath, 'instance', 'memory', 'sources.json'),
    {
      kind: 'memory_source_registry',
      version: 1,
      memorySources: [
        createMemorySourceDefinition({
          sourceId: 'community-manager-memory',
          sourceType: 'cognitive_identity_memory_directory',
          rootPath: 'cognitive-identities/marketing-and-sales/community-manager/memory',
          scope: 'cognitive_identity',
          ownerId: 'community-manager',
          defaultPortability: 'portable',
          defaultVisibility: 'shared_with_mas',
        }),
        createMemorySourceDefinition({
          sourceId: 'copywriter-senior-memory',
          sourceType: 'cognitive_identity_memory_directory',
          rootPath: 'cognitive-identities/marketing-and-sales/copywriter-senior/memory',
          scope: 'cognitive_identity',
          ownerId: 'copywriter-senior',
          defaultPortability: 'portable',
          defaultVisibility: 'shared_with_mas',
        }),
        createMemorySourceDefinition({
          sourceId: 'media-buyer-memory',
          sourceType: 'cognitive_identity_memory_directory',
          rootPath: 'cognitive-identities/marketing-and-sales/media-buyer/memory',
          scope: 'cognitive_identity',
          ownerId: 'media-buyer',
          defaultPortability: 'portable',
          defaultVisibility: 'shared_with_mas',
        }),
        createMemorySourceDefinition({
          sourceId: 'maria-private-memory',
          sourceType: 'operational_identity_memory_directory',
          rootPath: 'operational-identities/maria/memory',
          scope: 'operational_identity',
          ownerId: 'maria',
          defaultPortability: 'mas_bound',
          defaultVisibility: 'private_to_owner',
        }),
        createMemorySourceDefinition({
          sourceId: 'juan-private-memory',
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
      ],
    },
  );
}

async function writeSharedOperationalMemorySourceRegistry({ projectRootPath }) {
  await writeJsonFile(
    path.join(projectRootPath, 'instance', 'memory', 'sources.json'),
    {
      kind: 'memory_source_registry',
      version: 1,
      memorySources: [
        createMemorySourceDefinition({
          sourceId: 'maria-shared-operational-memory',
          sourceType: 'operational_identity_memory_directory',
          rootPath: 'operational-identities/maria/shared-memory',
          scope: 'operational_identity',
          ownerId: 'maria',
          defaultPortability: 'mas_bound',
          defaultVisibility: 'shared_with_team',
        }),
        createMemorySourceDefinition({
          sourceId: 'maria-private-operational-memory',
          sourceType: 'operational_identity_memory_directory',
          rootPath: 'operational-identities/maria/memory',
          scope: 'operational_identity',
          ownerId: 'maria',
          defaultPortability: 'mas_bound',
          defaultVisibility: 'private_to_owner',
        }),
        createMemorySourceDefinition({
          sourceId: 'juan-private-operational-memory',
          sourceType: 'operational_identity_memory_directory',
          rootPath: 'operational-identities/juan/memory',
          scope: 'operational_identity',
          ownerId: 'juan',
          defaultPortability: 'mas_bound',
          defaultVisibility: 'private_to_owner',
        }),
      ],
    },
  );
}

async function writeMariaCopyOnlyRoute({ projectRootPath }) {
  await writeJsonFile(
    path.join(projectRootPath, 'instance', 'operational-identities', 'maria', 'routing.json'),
    {
      kind: 'operational_identity_routing_definition',
      version: 1,
      defaultPrimaryCognitiveIdentityId: 'community-manager',
      commandRoutes: [
        {
          command: 'ask',
          primaryCognitiveIdentityId: 'community-manager',
          secondaryCognitiveIdentityIds: ['copywriter-senior'],
        },
        {
          command: 'ask-copy-only',
          primaryCognitiveIdentityId: 'copywriter-senior',
          secondaryCognitiveIdentityIds: [],
        },
      ],
    },
  );
  await writeJsonFile(
    path.join(projectRootPath, 'instance', 'operational-identities', 'maria', 'execution-profile.json'),
    createExecutionProfileDefinition({
      executionProfileId: 'maria-default',
      primaryBrainId: 'maria-openrouter-primary',
      enabledCommands: ['ask', 'ask-copy-only'],
    }),
  );
}

async function createProjectFixture() {
  const projectRootPath = await mkdtemp(path.join(os.tmpdir(), 'openmas-maria-juan-memory-'));

  await writeJsonFile(
    path.join(projectRootPath, 'package.json'),
    {
      name: 'openmas-fixture',
      private: true,
      type: 'module',
      openmas: {
        projectKind: 'framework',
        schemaVersion: 1,
      },
    },
  );

  await createDirectoryTree(projectRootPath, [
    'bin',
    'src',
    'docs',
    'var',
    'tests',
    'config',
    'instance',
    'instance/memory',
    'instance/memory/knowledge',
    'instance/memory/policies',
    'instance/memory/state',
    'instance/memory/artifacts',
    'instance/memory/durable',
    'instance/tools',
    'instance/workflows',
    'instance/registries',
    'instance/evaluations',
    'instance/operational-identities',
    'instance/operational-identities/maria',
    'instance/operational-identities/juan',
  ]);

  await writePortableCognitiveIdentity({
    projectRootPath,
    relativeCognitiveIdentityPath: 'marketing-and-sales/community-manager',
    title: 'Community Manager',
  });
  await writePortableCognitiveIdentity({
    projectRootPath,
    relativeCognitiveIdentityPath: 'marketing-and-sales/copywriter-senior',
    title: 'Copywriter Senior',
  });
  await writePortableCognitiveIdentity({
    projectRootPath,
    relativeCognitiveIdentityPath: 'marketing-and-sales/media-buyer',
    title: 'Media Buyer',
  });

  await writeJsonFile(
    path.join(projectRootPath, 'instance', 'registries', 'cognitive-identities.json'),
    {
      kind: 'cognitive_identities_registry',
      version: 1,
      cognitiveIdentities: [
        {
          cognitiveIdentityId: 'community-manager',
          rootPath: 'marketing-and-sales/community-manager',
          category: 'domain',
        },
        {
          cognitiveIdentityId: 'copywriter-senior',
          rootPath: 'marketing-and-sales/copywriter-senior',
          category: 'domain',
        },
        {
          cognitiveIdentityId: 'media-buyer',
          rootPath: 'marketing-and-sales/media-buyer',
          category: 'domain',
        },
      ],
    },
  );

  await writeJsonFile(
    path.join(projectRootPath, 'instance', 'registries', 'operational-identities.json'),
    {
      kind: 'operational_identities_registry',
      version: 1,
      operationalIdentities: [
        {
          operationalIdentityId: 'maria',
          rootPath: 'maria',
          category: 'domain',
        },
        {
          operationalIdentityId: 'juan',
          rootPath: 'juan',
          category: 'domain',
        },
      ],
    },
  );

  await writeJsonFile(
    path.join(projectRootPath, 'instance', 'registries', 'resources.json'),
    createResourcesRegistryContent(),
  );
  await writeJsonFile(
    path.join(projectRootPath, 'config', 'secret-references.json'),
    createSecretReferenceRegistryContent(),
  );
  await writeDevelopmentCredentialVault(projectRootPath);

  await writeJsonFile(
    path.join(projectRootPath, 'instance', 'operational-identities', 'maria', 'identity.json'),
    createOperationalIdentityDefinition({
      operationalIdentityId: 'maria',
      displayName: 'Maria',
      auditActorId: 'community-manager.ops.maria.v1',
      attachedCognitiveIdentityIds: ['community-manager', 'copywriter-senior'],
      executionProfileId: 'maria-default',
      tone: 'enthusiastic',
    }),
  );
  await writeJsonFile(
    path.join(projectRootPath, 'instance', 'operational-identities', 'maria', 'routing.json'),
    createRoutingDefinition({
      primaryCognitiveIdentityId: 'community-manager',
      secondaryCognitiveIdentityIds: ['copywriter-senior'],
    }),
  );
  await writeJsonFile(
    path.join(projectRootPath, 'instance', 'operational-identities', 'maria', 'execution-profile.json'),
    createExecutionProfileDefinition({
      executionProfileId: 'maria-default',
      primaryBrainId: 'maria-openrouter-primary',
    }),
  );
  await writeJsonFile(
    path.join(projectRootPath, 'instance', 'operational-identities', 'maria', 'bindings.json'),
    createBindingsContent('maria'),
  );
  await writeJsonFile(
    path.join(projectRootPath, 'instance', 'operational-identities', 'maria', 'permissions.json'),
    createPermissionsContent('maria'),
  );

  await writeJsonFile(
    path.join(projectRootPath, 'instance', 'operational-identities', 'juan', 'identity.json'),
    createOperationalIdentityDefinition({
      operationalIdentityId: 'juan',
      displayName: 'Juan',
      auditActorId: 'media-buyer.ops.juan.v1',
      attachedCognitiveIdentityIds: ['media-buyer', 'community-manager'],
      executionProfileId: 'juan-default',
      tone: 'strict but kind',
    }),
  );
  await writeJsonFile(
    path.join(projectRootPath, 'instance', 'operational-identities', 'juan', 'routing.json'),
    createRoutingDefinition({
      primaryCognitiveIdentityId: 'media-buyer',
      secondaryCognitiveIdentityIds: ['community-manager'],
    }),
  );
  await writeJsonFile(
    path.join(projectRootPath, 'instance', 'operational-identities', 'juan', 'execution-profile.json'),
    createExecutionProfileDefinition({
      executionProfileId: 'juan-default',
      primaryBrainId: 'juan-openrouter-primary',
    }),
  );
  await writeJsonFile(
    path.join(projectRootPath, 'instance', 'operational-identities', 'juan', 'bindings.json'),
    createBindingsContent('juan'),
  );
  await writeJsonFile(
    path.join(projectRootPath, 'instance', 'operational-identities', 'juan', 'permissions.json'),
    createPermissionsContent('juan'),
  );

  return projectRootPath;
}

async function seedSharedAndPrivateMemory(projectRootPath) {
  await writeTextFile(
    path.join(projectRootPath, 'instance', 'cognitive-identities', 'marketing-and-sales', 'community-manager', 'memory', 'shared-community-guidelines.md'),
    `# Shared Community Guidelines\n\n${SHARED_COMMUNITY_MEMORY_MARKER}: community work must acknowledge customers before suggesting next actions.`,
  );
  await writeTextFile(
    path.join(projectRootPath, 'instance', 'cognitive-identities', 'marketing-and-sales', 'copywriter-senior', 'memory', 'copywriting-guidelines.md'),
    `# Copywriting Guidelines\n\n${MARIA_COPYWRITER_MEMORY_MARKER}: copywriting work should keep hooks direct and human.`,
  );
  await writeTextFile(
    path.join(projectRootPath, 'instance', 'cognitive-identities', 'marketing-and-sales', 'media-buyer', 'memory', 'campaign-investment-guidelines.md'),
    `# Campaign Investment Guidelines\n\n${JUAN_MEDIA_BUYER_MEMORY_MARKER}: campaign investment decisions should prioritize qualified traffic.`,
  );
  await writeTextFile(
    path.join(projectRootPath, 'instance', 'operational-identities', 'maria', 'memory', 'relationship-note.md'),
    `# Maria Relationship Note\n\n${MARIA_OPERATIONAL_MEMORY_MARKER}: Maria remembers that customer community updates should be warm.`,
  );
  await writeTextFile(
    path.join(projectRootPath, 'instance', 'operational-identities', 'juan', 'memory', 'relationship-note.md'),
    `# Juan Relationship Note\n\n${JUAN_OPERATIONAL_MEMORY_MARKER}: Juan remembers that campaign budget diagnostics should be strict.`,
  );
  await writeTextFile(
    path.join(projectRootPath, 'instance', 'memory', 'knowledge', 'company-profile.md'),
    `# Company Profile\n\n${MAS_SHARED_MEMORY_MARKER}: Sin Cuchillo is the shared organization context for Maria and Juan.`,
  );
  await writeTextFile(
    path.join(projectRootPath, 'instance', 'memory', 'policies', 'shared-policy.md'),
    `# Shared MAS Policy\n\n${MAS_POLICY_MEMORY_MARKER}: all agents must respect shared MAS operating policies.`,
  );
  await writeDurableMemoryRecord({
    projectRootPath,
    memoryRecord: createDurableMemoryRecord({
      memoryRecordId: 'mem_maria_juan_shared_durable_context',
      summary: 'Maria and Juan share approved durable MAS context.',
      content: `${DURABLE_SHARED_MEMORY_MARKER}: Maria and Juan can both use approved durable MAS memory.`,
    }),
  });
}

async function invokeOperationalIdentityWithPromptCapture({
  projectRootPath,
  operationalIdentityId,
  command = 'ask',
  inputText,
}) {
  const providerSystemMessages = [];
  const result = await runAgentInvocation({
    projectRootPath,
    operationalIdentityId,
    invocationMode: 'probabilistic',
    command,
    inputText,
    requestedBy: 'memory-separation-test',
    fetchImplementation: async (url, options) => {
      assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions');
      assert.equal(options.headers.Authorization, 'Bearer openrouter-secret');

      const body = JSON.parse(options.body);
      providerSystemMessages.push(body.messages[0].content);

      return {
        ok: true,
        async json() {
          return {
            id: `openrouter-${operationalIdentityId}-memory-separation`,
            choices: [
              {
                finish_reason: 'stop',
                message: {
                  content: `${operationalIdentityId} completed the memory separation probe.`,
                },
              },
            ],
            usage: {
              prompt_tokens: 260,
              completion_tokens: 12,
              total_tokens: 272,
            },
          };
        },
      };
    },
  });

  return {
    result,
    providerSystemMessage: providerSystemMessages[0],
    invocationSession: JSON.parse(await readFile(result.persistence.invocationSessionRecordPath, 'utf8')),
  };
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

function countSourceReferencesByType(contextPackLayer, sourceType) {
  return contextPackLayer.sourceReferences.filter((sourceReference) => {
    return sourceReference.sourceType === sourceType;
  }).length;
}

function assertIncludesAll(content, markers) {
  for (const marker of markers) {
    assert.match(content, new RegExp(marker, 'u'));
  }
}

function assertExcludesAll(content, markers) {
  for (const marker of markers) {
    assert.doesNotMatch(content, new RegExp(marker, 'u'));
  }
}

test('Maria and Juan receive separated default memory in probabilistic prompts', async () => {
  await withEnvironment(
    {
      "openrouter-api-key": 'openrouter-secret',
      "gemini-api-key": 'gemini-secret',
    },
    async () => {
      const projectRootPath = await createProjectFixture();
      await seedSharedAndPrivateMemory(projectRootPath);

      const mariaInvocation = await invokeOperationalIdentityWithPromptCapture({
        projectRootPath,
        operationalIdentityId: 'maria',
        inputText: 'Which memory can you use for community and copywriting work?',
      });
      const juanInvocation = await invokeOperationalIdentityWithPromptCapture({
        projectRootPath,
        operationalIdentityId: 'juan',
        inputText: 'Which memory can you use for media buying and community work?',
      });

      assert.equal(mariaInvocation.result.status, 'completed');
      assert.equal(juanInvocation.result.status, 'completed');

      assertIncludesAll(mariaInvocation.providerSystemMessage, [
        SHARED_COMMUNITY_MEMORY_MARKER,
        MARIA_COPYWRITER_MEMORY_MARKER,
        MARIA_OPERATIONAL_MEMORY_MARKER,
        MAS_SHARED_MEMORY_MARKER,
        MAS_POLICY_MEMORY_MARKER,
        DURABLE_SHARED_MEMORY_MARKER,
      ]);
      assertExcludesAll(mariaInvocation.providerSystemMessage, [
        JUAN_MEDIA_BUYER_MEMORY_MARKER,
        JUAN_OPERATIONAL_MEMORY_MARKER,
      ]);

      assertIncludesAll(juanInvocation.providerSystemMessage, [
        SHARED_COMMUNITY_MEMORY_MARKER,
        JUAN_MEDIA_BUYER_MEMORY_MARKER,
        JUAN_OPERATIONAL_MEMORY_MARKER,
        MAS_SHARED_MEMORY_MARKER,
        MAS_POLICY_MEMORY_MARKER,
        DURABLE_SHARED_MEMORY_MARKER,
      ]);
      assertExcludesAll(juanInvocation.providerSystemMessage, [
        MARIA_COPYWRITER_MEMORY_MARKER,
        MARIA_OPERATIONAL_MEMORY_MARKER,
      ]);

      const mariaContextLayer = findContextPackLayer(mariaInvocation.invocationSession);
      const juanContextLayer = findContextPackLayer(juanInvocation.invocationSession);

      assert.equal(hasSourceReference(mariaContextLayer, {
        sourceType: 'agent_local_memory',
        path: 'cognitive-identities/marketing-and-sales/community-manager/memory/shared-community-guidelines.md',
      }), true);
      assert.equal(hasSourceReference(mariaContextLayer, {
        sourceType: 'agent_local_memory',
        path: 'cognitive-identities/marketing-and-sales/copywriter-senior/memory/copywriting-guidelines.md',
      }), true);
      assert.equal(hasSourceReference(mariaContextLayer, {
        sourceType: 'operational_identity_memory',
        path: 'operational-identities/maria/memory/relationship-note.md',
      }), true);
      assert.equal(hasSourceReference(mariaContextLayer, {
        sourceType: 'durable_memory_record',
        sourceId: 'mem_maria_juan_shared_durable_context',
      }), true);
      assert.equal(hasSourceReference(mariaContextLayer, {
        sourceType: 'knowledge_document',
        path: 'memory/knowledge/company-profile.md',
      }), true);
      assert.equal(hasSourceReference(mariaContextLayer, {
        sourceType: 'policy_document',
        path: 'memory/policies/shared-policy.md',
      }), true);
      assert.equal(hasSourceReference(juanContextLayer, {
        sourceType: 'agent_local_memory',
        path: 'cognitive-identities/marketing-and-sales/community-manager/memory/shared-community-guidelines.md',
      }), true);
      assert.equal(hasSourceReference(juanContextLayer, {
        sourceType: 'agent_local_memory',
        path: 'cognitive-identities/marketing-and-sales/media-buyer/memory/campaign-investment-guidelines.md',
      }), true);
      assert.equal(hasSourceReference(juanContextLayer, {
        sourceType: 'operational_identity_memory',
        path: 'operational-identities/juan/memory/relationship-note.md',
      }), true);
      assert.equal(hasSourceReference(juanContextLayer, {
        sourceType: 'durable_memory_record',
        sourceId: 'mem_maria_juan_shared_durable_context',
      }), true);
      assert.equal(hasSourceReference(juanContextLayer, {
        sourceType: 'knowledge_document',
        path: 'memory/knowledge/company-profile.md',
      }), true);
      assert.equal(hasSourceReference(juanContextLayer, {
        sourceType: 'policy_document',
        path: 'memory/policies/shared-policy.md',
      }), true);

      assertExcludesAll(JSON.stringify(mariaInvocation.invocationSession), [
        MARIA_OPERATIONAL_MEMORY_MARKER,
        MARIA_COPYWRITER_MEMORY_MARKER,
        DURABLE_SHARED_MEMORY_MARKER,
        'openrouter-secret',
      ]);
      assertExcludesAll(JSON.stringify(juanInvocation.invocationSession), [
        JUAN_OPERATIONAL_MEMORY_MARKER,
        JUAN_MEDIA_BUYER_MEMORY_MARKER,
        DURABLE_SHARED_MEMORY_MARKER,
        'openrouter-secret',
      ]);
    },
  );
});

test('Maria and Juan reject cross-owned private memory even when sources are over-registered', async () => {
  await withEnvironment(
    {
      "openrouter-api-key": 'openrouter-secret',
      "gemini-api-key": 'gemini-secret',
    },
    async () => {
      const projectRootPath = await createProjectFixture();
      await seedSharedAndPrivateMemory(projectRootPath);
      await writeOverbroadMemorySourceRegistry({ projectRootPath });

      const mariaInvocation = await invokeOperationalIdentityWithPromptCapture({
        projectRootPath,
        operationalIdentityId: 'maria',
        inputText: 'Confirm memory separation with over-registered sources.',
      });
      const juanInvocation = await invokeOperationalIdentityWithPromptCapture({
        projectRootPath,
        operationalIdentityId: 'juan',
        inputText: 'Confirm memory separation with over-registered sources.',
      });

      assert.equal(mariaInvocation.result.status, 'completed');
      assert.equal(juanInvocation.result.status, 'completed');
      assertExcludesAll(mariaInvocation.providerSystemMessage, [
        JUAN_MEDIA_BUYER_MEMORY_MARKER,
        JUAN_OPERATIONAL_MEMORY_MARKER,
      ]);
      assertExcludesAll(juanInvocation.providerSystemMessage, [
        MARIA_COPYWRITER_MEMORY_MARKER,
        MARIA_OPERATIONAL_MEMORY_MARKER,
      ]);
      assert.match(mariaInvocation.providerSystemMessage, /belongs to juan, not maria/u);
      assert.match(mariaInvocation.providerSystemMessage, /belongs to media-buyer, which is not active/u);
      assert.match(juanInvocation.providerSystemMessage, /belongs to maria, not juan/u);
      assert.match(juanInvocation.providerSystemMessage, /belongs to copywriter-senior, which is not active/u);

      const mariaContextLayer = findContextPackLayer(mariaInvocation.invocationSession);
      const juanContextLayer = findContextPackLayer(juanInvocation.invocationSession);

      assert.equal(hasSourceReference(mariaContextLayer, {
        sourceType: 'operational_identity_memory',
        path: 'operational-identities/juan/memory/relationship-note.md',
      }), false);
      assert.equal(hasSourceReference(juanContextLayer, {
        sourceType: 'operational_identity_memory',
        path: 'operational-identities/maria/memory/relationship-note.md',
      }), false);
    },
  );
});

test('Shared operational memory becomes visible across identities only when explicitly approved by visibility', async () => {
  await withEnvironment(
    {
      "openrouter-api-key": 'openrouter-secret',
      "gemini-api-key": 'gemini-secret',
    },
    async () => {
      const projectRootPath = await createProjectFixture();
      await seedSharedAndPrivateMemory(projectRootPath);
      await writeSharedOperationalMemorySourceRegistry({ projectRootPath });
      await writeTextFile(
        path.join(projectRootPath, 'instance', 'operational-identities', 'maria', 'shared-memory', 'shared-team-note.md'),
        `# Maria Shared Team Note\n\n${MARIA_SHARED_OPERATIONAL_MEMORY_MARKER}: Maria approved this operational note for team visibility.`,
      );

      const juanInvocation = await invokeOperationalIdentityWithPromptCapture({
        projectRootPath,
        operationalIdentityId: 'juan',
        inputText: 'Which Maria operational memory can you see through governed sharing?',
      });

      assert.equal(juanInvocation.result.status, 'completed');
      assert.match(juanInvocation.providerSystemMessage, new RegExp(MARIA_SHARED_OPERATIONAL_MEMORY_MARKER, 'u'));
      assert.doesNotMatch(juanInvocation.providerSystemMessage, new RegExp(MARIA_OPERATIONAL_MEMORY_MARKER, 'u'));

      const contextLayer = findContextPackLayer(juanInvocation.invocationSession);

      assert.equal(hasSourceReference(contextLayer, {
        sourceType: 'operational_identity_memory',
        path: 'operational-identities/maria/shared-memory/shared-team-note.md',
      }), true);
      assert.equal(hasSourceReference(contextLayer, {
        sourceType: 'operational_identity_memory',
        path: 'operational-identities/maria/memory/relationship-note.md',
      }), false);
      assert.doesNotMatch(JSON.stringify(juanInvocation.invocationSession), new RegExp(MARIA_SHARED_OPERATIONAL_MEMORY_MARKER, 'u'));
    },
  );
});

test('Identity and MAS memory keep priority over noisy runtime state and artifact context', async () => {
  await withEnvironment(
    {
      "openrouter-api-key": 'openrouter-secret',
      "gemini-api-key": 'gemini-secret',
    },
    async () => {
      const projectRootPath = await createProjectFixture();
      await seedSharedAndPrivateMemory(projectRootPath);
      await writeTextFile(
        path.join(projectRootPath, 'instance', 'operational-identities', 'maria', 'memory', 'preference-note.md'),
        `# Maria Preference Note\n\n${MARIA_HUMAN_PREFERENCE_MARKER}: Maria prefers concise escalation summaries.`,
      );

      for (let index = 0; index < 8; index += 1) {
        await writeJsonFile(
          path.join(projectRootPath, 'instance', 'memory', 'state', `runtime-noise-${index}.json`),
          {
            kind: 'agent_invocation_session',
            invocationId: `runtime-noise-${index}`,
            operationalIdentityId: 'noise-identity',
            primaryCognitiveIdentityId: 'noise-cognition',
            executionType: 'probabilistic_brain',
            request: {
              command: 'ask',
              invocationMode: 'probabilistic',
            },
            readinessStatus: 'ready',
            message: `${RUNTIME_NOISE_MARKER}: noisy runtime state should not crowd out identity memory.`,
            startedAt: '2026-04-14T00:00:00.000Z',
            finishedAt: '2026-04-14T00:00:01.000Z',
          },
        );
        await writeTextFile(
          path.join(projectRootPath, 'instance', 'memory', 'artifacts', `runtime-artifact-noise-${index}.md`),
          `# Runtime Artifact Noise\n\n${ARTIFACT_NOISE_MARKER}: noisy artifact body should not enter prompt context.`,
        );
      }

      const mariaInvocation = await invokeOperationalIdentityWithPromptCapture({
        projectRootPath,
        operationalIdentityId: 'maria',
        inputText: 'Which high-priority identity memories survive runtime noise?',
      });

      assert.equal(mariaInvocation.result.status, 'completed');
      assertIncludesAll(mariaInvocation.providerSystemMessage, [
        SHARED_COMMUNITY_MEMORY_MARKER,
        MARIA_COPYWRITER_MEMORY_MARKER,
        MARIA_OPERATIONAL_MEMORY_MARKER,
        MARIA_HUMAN_PREFERENCE_MARKER,
        MAS_SHARED_MEMORY_MARKER,
        MAS_POLICY_MEMORY_MARKER,
        DURABLE_SHARED_MEMORY_MARKER,
      ]);
      assertExcludesAll(mariaInvocation.providerSystemMessage, [
        RUNTIME_NOISE_MARKER,
        ARTIFACT_NOISE_MARKER,
      ]);
      assert.match(mariaInvocation.providerSystemMessage, /Context section omitted by (maxSections|token budget): recent-activity-summary/u);
      assert.match(mariaInvocation.providerSystemMessage, /Context section omitted by (maxSections|token budget): relevant-artifacts/u);

      const contextLayer = findContextPackLayer(mariaInvocation.invocationSession);

      assert.equal(countSourceReferencesByType(contextLayer, 'invocation_session'), 0);
      assert.equal(countSourceReferencesByType(contextLayer, 'artifact'), 0);
    },
  );
});

test('Restricted and secret-reference-only memory are rejected before probabilistic provider prompts', async () => {
  await withEnvironment(
    {
      "openrouter-api-key": 'openrouter-secret',
      "gemini-api-key": 'gemini-secret',
    },
    async () => {
      const projectRootPath = await createProjectFixture();
      await seedSharedAndPrivateMemory(projectRootPath);
      await writeDurableMemoryRecord({
        projectRootPath,
        memoryRecord: createDurableMemoryRecord({
          memoryRecordId: 'mem_restricted_memory_rejection_probe',
          summary: 'Restricted MAS memory should not enter probabilistic prompts.',
          content: `${RESTRICTED_MEMORY_MARKER}: this restricted durable memory must stay out of provider prompts.`,
          visibility: 'restricted',
        }),
      });
      await writeDurableMemoryRecord({
        projectRootPath,
        memoryRecord: createDurableMemoryRecord({
          memoryRecordId: 'mem_secret_reference_memory_rejection_probe',
          summary: `${SECRET_REFERENCE_MEMORY_MARKER}: secret-reference-only memory metadata should not enter probabilistic prompts.`,
          content: null,
          sensitivityLevel: 'secret_reference_only',
        }),
      });

      const mariaInvocation = await invokeOperationalIdentityWithPromptCapture({
        projectRootPath,
        operationalIdentityId: 'maria',
        inputText: 'Confirm restricted and secret-reference memory handling.',
      });

      assert.equal(mariaInvocation.result.status, 'completed');
      assertExcludesAll(mariaInvocation.providerSystemMessage, [
        RESTRICTED_MEMORY_MARKER,
        SECRET_REFERENCE_MEMORY_MARKER,
      ]);
      assert.match(mariaInvocation.providerSystemMessage, /restricted and is not a runtime reference/u);
      assert.match(mariaInvocation.providerSystemMessage, /secret-reference-only and cannot enter a context pack/u);

      const contextLayer = findContextPackLayer(mariaInvocation.invocationSession);

      assert.equal(hasSourceReference(contextLayer, {
        sourceType: 'durable_memory_record',
        sourceId: 'mem_restricted_memory_rejection_probe',
      }), false);
      assert.equal(hasSourceReference(contextLayer, {
        sourceType: 'durable_memory_record',
        sourceId: 'mem_secret_reference_memory_rejection_probe',
      }), false);
      assert.doesNotMatch(JSON.stringify(mariaInvocation.invocationSession), new RegExp(RESTRICTED_MEMORY_MARKER, 'u'));
      assert.doesNotMatch(JSON.stringify(mariaInvocation.invocationSession), new RegExp(SECRET_REFERENCE_MEMORY_MARKER, 'u'));
    },
  );
});

test('Maria narrowed active cognitive route limits cognitive memory to the resolved expert set', async () => {
  await withEnvironment(
    {
      "openrouter-api-key": 'openrouter-secret',
      "gemini-api-key": 'gemini-secret',
    },
    async () => {
      const projectRootPath = await createProjectFixture();
      await seedSharedAndPrivateMemory(projectRootPath);
      await writeMariaCopyOnlyRoute({ projectRootPath });

      const mariaInvocation = await invokeOperationalIdentityWithPromptCapture({
        projectRootPath,
        operationalIdentityId: 'maria',
        command: 'ask-copy-only',
        inputText: 'Use only the narrowed copywriter active cognitive route.',
      });

      assert.equal(mariaInvocation.result.status, 'completed');
      assert.equal(mariaInvocation.invocationSession.primaryCognitiveIdentityId, 'copywriter-senior');
      assert.deepEqual(mariaInvocation.invocationSession.secondaryCognitiveIdentityIds, []);
      assert.match(mariaInvocation.providerSystemMessage, /Primary Cognitive Identity: copywriter-senior/u);
      assert.doesNotMatch(mariaInvocation.providerSystemMessage, /Secondary Cognitive Identities: community-manager/u);
      assert.match(mariaInvocation.providerSystemMessage, new RegExp(MARIA_COPYWRITER_MEMORY_MARKER, 'u'));
      assert.match(mariaInvocation.providerSystemMessage, new RegExp(MARIA_OPERATIONAL_MEMORY_MARKER, 'u'));
      assert.doesNotMatch(mariaInvocation.providerSystemMessage, new RegExp(SHARED_COMMUNITY_MEMORY_MARKER, 'u'));

      const contextLayer = findContextPackLayer(mariaInvocation.invocationSession);

      assert.equal(hasSourceReference(contextLayer, {
        sourceType: 'agent_local_memory',
        path: 'cognitive-identities/marketing-and-sales/copywriter-senior/memory/copywriting-guidelines.md',
      }), true);
      assert.equal(hasSourceReference(contextLayer, {
        sourceType: 'agent_local_memory',
        path: 'cognitive-identities/marketing-and-sales/community-manager/memory/shared-community-guidelines.md',
      }), false);
    },
  );
});

test('Maria future operational memory remains private from Juan while remaining available to Maria', async () => {
  await withEnvironment(
    {
      "openrouter-api-key": 'openrouter-secret',
      "gemini-api-key": 'gemini-secret',
    },
    async () => {
      const projectRootPath = await createProjectFixture();
      await seedSharedAndPrivateMemory(projectRootPath);

      const beforeMariaInvocation = await invokeOperationalIdentityWithPromptCapture({
        projectRootPath,
        operationalIdentityId: 'maria',
        inputText: 'Do you have the future Maria recall marker yet?',
      });

      assert.equal(beforeMariaInvocation.result.status, 'completed');
      assert.doesNotMatch(beforeMariaInvocation.providerSystemMessage, new RegExp(MARIA_FUTURE_RECALL_MARKER, 'u'));

      await writeTextFile(
        path.join(projectRootPath, 'instance', 'operational-identities', 'maria', 'memory', 'future-relationship-note.md'),
        `# Maria Future Relationship Note\n\n${MARIA_FUTURE_RECALL_MARKER}: Maria remembers that the human administrator wants careful community escalation notes.`,
      );

      const juanInvocation = await invokeOperationalIdentityWithPromptCapture({
        projectRootPath,
        operationalIdentityId: 'juan',
        inputText: 'Can you see Maria future operational memory?',
      });
      const afterMariaInvocation = await invokeOperationalIdentityWithPromptCapture({
        projectRootPath,
        operationalIdentityId: 'maria',
        inputText: 'Can you recall your new future operational memory?',
      });

      assert.equal(juanInvocation.result.status, 'completed');
      assert.equal(afterMariaInvocation.result.status, 'completed');
      assert.doesNotMatch(juanInvocation.providerSystemMessage, new RegExp(MARIA_FUTURE_RECALL_MARKER, 'u'));
      assert.match(afterMariaInvocation.providerSystemMessage, new RegExp(MARIA_FUTURE_RECALL_MARKER, 'u'));

      const mariaContextLayer = findContextPackLayer(afterMariaInvocation.invocationSession);
      const juanContextLayer = findContextPackLayer(juanInvocation.invocationSession);

      assert.equal(hasSourceReference(mariaContextLayer, {
        sourceType: 'operational_identity_memory',
        path: 'operational-identities/maria/memory/future-relationship-note.md',
      }), true);
      assert.equal(hasSourceReference(juanContextLayer, {
        sourceType: 'operational_identity_memory',
        path: 'operational-identities/maria/memory/future-relationship-note.md',
      }), false);
      assert.doesNotMatch(JSON.stringify(afterMariaInvocation.invocationSession), new RegExp(MARIA_FUTURE_RECALL_MARKER, 'u'));
    },
  );
});
