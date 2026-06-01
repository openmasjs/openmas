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

const VALID_CREATED_AT = '2026-04-14T00:00:00.000Z';
const VALID_SHA_256 = 'e'.repeat(64);

const MEDIA_BUYER_MEMORY_MARKER = 'JUAN_MEDIA_BUYER_COGNITIVE_MEMORY_ALLOWED';
const JUAN_OPERATIONAL_MEMORY_MARKER = 'JUAN_OPERATIONAL_CAMPAIGN_MEMORY_ALLOWED';
const MAS_BUSINESS_GOAL_MARKER = 'SIN_CUCHILLO_BUSINESS_GOAL_ALLOWED';
const CURRENT_CAMPAIGN_PERFORMANCE_MARKER = 'CURRENT_CAMPAIGN_PERFORMANCE_MEMORY_ALLOWED';
const STALE_CAMPAIGN_PERFORMANCE_MARKER = 'STALE_CAMPAIGN_PERFORMANCE_MUST_NOT_REACH_CONTEXT';
const PENDING_OPTIMIZATION_MARKER = 'PENDING_OPTIMIZATION_CANDIDATE_MUST_NOT_REACH_CONTEXT';
const MARIA_PRIVATE_MEMORY_MARKER = 'MARIA_PRIVATE_COMPLAINT_MEMORY_MUST_NOT_REACH_JUAN';
const COMMUNITY_MANAGER_MEMORY_MARKER = 'COMMUNITY_MANAGER_MEMORY_MUST_NOT_REACH_JUAN_CAMPAIGN_ROUTE';
const RAW_PROVIDER_OUTPUT_MARKER = 'RAW_PROVIDER_OUTPUT_MUST_NOT_REACH_JUAN_CONTEXT';
const META_ADS_SECRET_VALUE = 'meta-ads-secret-value';
const INSTAGRAM_SECRET_VALUE = 'instagram-channel-secret-value';

async function createDirectoryTree(rootPath, relativePaths) {
  for (const relativePath of relativePaths) {
    await mkdir(path.join(rootPath, relativePath), { recursive: true });
  }
}

async function writeJsonFile(filePath, payload) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

async function writeTextFile(filePath, content) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, 'utf8');
}

async function writePortableCognitiveIdentity({ projectRootPath, relativeCognitiveIdentityPath, title, identityText }) {
  const cognitiveIdentityRootPath = path.join(projectRootPath, 'instance', 'cognitive-identities', relativeCognitiveIdentityPath);

  await mkdir(cognitiveIdentityRootPath, { recursive: true });
  await writeFile(path.join(cognitiveIdentityRootPath, 'identity.md'), `# ${title}\n\n${identityText}`, 'utf8');
  await writeFile(path.join(cognitiveIdentityRootPath, 'policies.md'), '# Policies\n\n- Use governed memory only.\n- Do not fabricate unavailable metrics.', 'utf8');
  await writeFile(path.join(cognitiveIdentityRootPath, 'capabilities.md'), '# Capabilities\n\n- Use role-specific context carefully.', 'utf8');
}

function createCredentialReferenceRegistryContent() {
  return {
    kind: 'credential_reference_registry',
    version: 1,
    credentialReferences: [
      {
        kind: 'credential_reference_definition',
        version: 1,
        credentialReferenceId: 'openrouter-api-key',
        credentialType: 'api_key',
        valueShape: 'string',
      },
      {
        kind: 'credential_reference_definition',
        version: 1,
        credentialReferenceId: 'gemini-api-key',
        credentialType: 'api_key',
        valueShape: 'string',
      },
      {
        kind: 'credential_reference_definition',
        version: 1,
        credentialReferenceId: 'meta-ads-api-key',
        credentialType: 'api_key',
        valueShape: 'string',
      },
      {
        kind: 'credential_reference_definition',
        version: 1,
        credentialReferenceId: 'instagram-channel-token',
        credentialType: 'access_token',
        valueShape: 'string',
      },
    ],
  };
}

function createCredentialVaultContent() {
  return {
    'openrouter-api-key': 'openrouter-secret',
    'gemini-api-key': 'gemini-secret',
    'meta-ads-api-key': META_ADS_SECRET_VALUE,
    'instagram-channel-token': INSTAGRAM_SECRET_VALUE,
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
      {
        kind: 'resource_definition',
        version: 1,
        resourceId: 'meta-ads-reporting',
        resourceType: 'tool',
        displayName: 'Meta Ads Reporting API',
        ownershipScope: 'shared',
        lifecycleState: 'active',
      },
      {
        kind: 'resource_definition',
        version: 1,
        resourceId: 'facebook-page-publisher',
        resourceType: 'channel',
        displayName: 'Facebook Page Publisher',
        ownershipScope: 'shared',
        lifecycleState: 'active',
      },
      {
        kind: 'resource_definition',
        version: 1,
        resourceId: 'instagram-community-channel',
        resourceType: 'channel',
        displayName: 'Instagram Community Channel',
        ownershipScope: 'shared',
        lifecycleState: 'active',
      },
    ],
  };
}

function createJuanBindingsContent() {
  return {
    kind: 'operational_identity_bindings',
    version: 1,
    operationalIdentityId: 'juan',
    bindings: [
      {
        resourceId: 'openrouter-api',
        accessMode: 'execute',
        bindingState: 'active',
        credentialReferenceId: 'openrouter-api-key',
      },
      {
        resourceId: 'gemini-api',
        accessMode: 'execute',
        bindingState: 'active',
        credentialReferenceId: 'gemini-api-key',
      },
      {
        resourceId: 'meta-ads-reporting',
        accessMode: 'read',
        bindingState: 'active',
        credentialReferenceId: 'meta-ads-api-key',
      },
      {
        resourceId: 'facebook-page-publisher',
        accessMode: 'publish',
        bindingState: 'active',
        credentialReferenceId: null,
      },
    ],
  };
}

function createJuanPermissionsContent() {
  return {
    kind: 'operational_identity_permissions',
    version: 1,
    operationalIdentityId: 'juan',
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
      {
        ruleId: 'allow-meta-ads-read',
        effect: 'allow',
        resourceId: 'meta-ads-reporting',
        accessModes: ['read'],
      },
    ],
  };
}

function createMariaBindingsContent() {
  return {
    kind: 'operational_identity_bindings',
    version: 1,
    operationalIdentityId: 'maria',
    bindings: [
      {
        resourceId: 'openrouter-api',
        accessMode: 'execute',
        bindingState: 'active',
        credentialReferenceId: 'openrouter-api-key',
      },
      {
        resourceId: 'gemini-api',
        accessMode: 'execute',
        bindingState: 'active',
        credentialReferenceId: 'gemini-api-key',
      },
      {
        resourceId: 'instagram-community-channel',
        accessMode: 'publish',
        bindingState: 'active',
        credentialReferenceId: 'instagram-channel-token',
      },
      {
        resourceId: 'meta-ads-reporting',
        accessMode: 'read',
        bindingState: 'active',
        credentialReferenceId: 'meta-ads-api-key',
      },
    ],
  };
}

function createMariaPermissionsContent() {
  return {
    kind: 'operational_identity_permissions',
    version: 1,
    operationalIdentityId: 'maria',
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
      {
        ruleId: 'allow-instagram-publish',
        effect: 'allow',
        resourceId: 'instagram-community-channel',
        accessModes: ['publish'],
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

function createJuanRoutingDefinition() {
  return {
    kind: 'operational_identity_routing_definition',
    version: 1,
    defaultPrimaryCognitiveIdentityId: 'media-buyer',
    commandRoutes: [
      {
        command: 'ask',
        primaryCognitiveIdentityId: 'media-buyer',
        secondaryCognitiveIdentityIds: ['community-manager'],
      },
      {
        command: 'analyze-campaign',
        primaryCognitiveIdentityId: 'media-buyer',
        secondaryCognitiveIdentityIds: [],
      },
    ],
  };
}

function createMariaRoutingDefinition() {
  return {
    kind: 'operational_identity_routing_definition',
    version: 1,
    defaultPrimaryCognitiveIdentityId: 'community-manager',
    commandRoutes: [
      {
        command: 'ask',
        primaryCognitiveIdentityId: 'community-manager',
        secondaryCognitiveIdentityIds: [],
      },
    ],
  };
}

function createExecutionProfileDefinition({
  executionProfileId,
  primaryBrainId,
  enabledCommands,
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

function createDurableSourceReference({
  sourceId,
  path: sourcePath,
  sourceType = 'artifact',
  origin = 'human_approved',
}) {
  return {
    kind: 'memory_source_reference',
    version: 1,
    sourceType,
    sourceId,
    scope: 'mas_instance',
    ownerId: 'sin-cuchillo',
    path: sourcePath,
    origin,
    sensitivityLevel: 'internal',
    createdAt: VALID_CREATED_AT,
    contentSha256: VALID_SHA_256,
  };
}

function createCampaignDurableMemoryRecord(overrides = {}) {
  return createDurableMemoryRecord({
    memoryType: 'resource_context',
    scope: 'mas_instance',
    ownerId: 'sin-cuchillo',
    origin: 'human_approved',
    portability: 'not_exportable',
    visibility: 'shared_with_mas',
    approvalState: 'approved',
    lifecycleStatus: 'active',
    sensitivityLevel: 'internal',
    confidence: 'human_approved',
    authorityLevel: 'mas_guidance',
    summary: 'Approved campaign performance memory.',
    content: 'Approved campaign performance memory content.',
    sourceReferences: [
      createDurableSourceReference({
        sourceId: 'campaign-performance-summary.md',
        path: 'memory/artifacts/campaign-performance-summary.md',
      }),
    ],
    subjectReferences: [
      {
        subjectType: 'mas_instance',
        subjectId: 'sin-cuchillo',
        relationship: 'owner',
      },
      {
        subjectType: 'operational_identity',
        subjectId: 'juan',
        relationship: 'authorized-consumer',
      },
      {
        subjectType: 'resource',
        subjectId: 'meta-ads-reporting',
        relationship: 'evidence-source',
      },
    ],
    retention: {
      retentionPolicyId: 'campaign-performance-short-lived',
      expiresAt: null,
      staleAfter: null,
      reviewRequiredAt: null,
    },
    supersession: {
      supersedesMemoryRecordIds: [],
      supersededByMemoryRecordId: null,
    },
    createdAt: VALID_CREATED_AT,
    updatedAt: VALID_CREATED_AT,
    ...overrides,
  });
}

async function writeMemorySourceRegistry({ projectRootPath }) {
  await writeJsonFile(
    path.join(projectRootPath, 'instance', 'memory', 'sources.json'),
    {
      kind: 'memory_source_registry',
      version: 1,
      memorySources: [
        createMemorySourceDefinition({
          sourceId: 'runtime-state',
          sourceType: 'state_directory',
          rootPath: 'memory/state',
          scope: 'mas_instance',
          ownerId: 'sin-cuchillo',
          defaultPortability: 'mas_bound',
          defaultVisibility: 'restricted',
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
          sourceId: 'community-manager-memory-overregistered',
          sourceType: 'cognitive_identity_memory_directory',
          rootPath: 'cognitive-identities/marketing-and-sales/community-manager/memory',
          scope: 'cognitive_identity',
          ownerId: 'community-manager',
          defaultPortability: 'portable',
          defaultVisibility: 'shared_with_mas',
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
          sourceId: 'maria-private-memory-overregistered',
          sourceType: 'operational_identity_memory_directory',
          rootPath: 'operational-identities/maria/memory',
          scope: 'operational_identity',
          ownerId: 'maria',
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
    },
  );
}

async function createJuanCampaignProjectFixture() {
  const projectRootPath = await mkdtemp(path.join(os.tmpdir(), 'openmas-juan-campaign-acid-'));

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
    'instance/operational-identities/juan',
    'instance/operational-identities/maria',
  ]);

  await writePortableCognitiveIdentity({
    projectRootPath,
    relativeCognitiveIdentityPath: 'marketing-and-sales/media-buyer',
    title: 'Media Buyer',
    identityText: 'Analyzes paid media performance, budget allocation, traffic quality, campaign risk, and next investment actions.',
  });
  await writePortableCognitiveIdentity({
    projectRootPath,
    relativeCognitiveIdentityPath: 'marketing-and-sales/community-manager',
    title: 'Community Manager',
    identityText: 'Handles public community conversations and customer support interactions.',
  });

  await writeJsonFile(
    path.join(projectRootPath, 'instance', 'registries', 'cognitive-identities.json'),
    {
      kind: 'cognitive_identities_registry',
      version: 1,
      cognitiveIdentities: [
        {
          cognitiveIdentityId: 'media-buyer',
          rootPath: 'marketing-and-sales/media-buyer',
          category: 'domain',
        },
        {
          cognitiveIdentityId: 'community-manager',
          rootPath: 'marketing-and-sales/community-manager',
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
          operationalIdentityId: 'juan',
          rootPath: 'juan',
          category: 'domain',
        },
        {
          operationalIdentityId: 'maria',
          rootPath: 'maria',
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
    path.join(projectRootPath, 'config', 'credential-references.json'),
    createCredentialReferenceRegistryContent(),
  );
  await writeDevelopmentCredentialVault(projectRootPath);

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
    createJuanRoutingDefinition(),
  );
  await writeJsonFile(
    path.join(projectRootPath, 'instance', 'operational-identities', 'juan', 'execution-profile.json'),
    createExecutionProfileDefinition({
      executionProfileId: 'juan-default',
      primaryBrainId: 'juan-openrouter-primary',
      enabledCommands: ['ask', 'analyze-campaign'],
    }),
  );
  await writeJsonFile(
    path.join(projectRootPath, 'instance', 'operational-identities', 'juan', 'bindings.json'),
    createJuanBindingsContent(),
  );
  await writeJsonFile(
    path.join(projectRootPath, 'instance', 'operational-identities', 'juan', 'permissions.json'),
    createJuanPermissionsContent(),
  );

  await writeJsonFile(
    path.join(projectRootPath, 'instance', 'operational-identities', 'maria', 'identity.json'),
    createOperationalIdentityDefinition({
      operationalIdentityId: 'maria',
      displayName: 'Maria',
      auditActorId: 'community-manager.ops.maria.v1',
      attachedCognitiveIdentityIds: ['community-manager'],
      executionProfileId: 'maria-default',
      tone: 'enthusiastic',
    }),
  );
  await writeJsonFile(
    path.join(projectRootPath, 'instance', 'operational-identities', 'maria', 'routing.json'),
    createMariaRoutingDefinition(),
  );
  await writeJsonFile(
    path.join(projectRootPath, 'instance', 'operational-identities', 'maria', 'execution-profile.json'),
    createExecutionProfileDefinition({
      executionProfileId: 'maria-default',
      primaryBrainId: 'maria-openrouter-primary',
      enabledCommands: ['ask'],
    }),
  );
  await writeJsonFile(
    path.join(projectRootPath, 'instance', 'operational-identities', 'maria', 'bindings.json'),
    createMariaBindingsContent(),
  );
  await writeJsonFile(
    path.join(projectRootPath, 'instance', 'operational-identities', 'maria', 'permissions.json'),
    createMariaPermissionsContent(),
  );

  await writeMemorySourceRegistry({ projectRootPath });

  return projectRootPath;
}

async function seedJuanCampaignScenario(projectRootPath) {
  await writeTextFile(
    path.join(projectRootPath, 'instance', 'cognitive-identities', 'marketing-and-sales', 'media-buyer', 'memory', 'campaign-analysis-principles.md'),
    `# Campaign Analysis Principles\n\n${MEDIA_BUYER_MEMORY_MARKER}: Prioritize qualified traffic, CAC discipline, conversion quality, and explicit uncertainty when metrics are incomplete.`,
  );
  await writeTextFile(
    path.join(projectRootPath, 'instance', 'cognitive-identities', 'marketing-and-sales', 'community-manager', 'memory', 'support-reply-principles.md'),
    `# Support Reply Principles\n\n${COMMUNITY_MANAGER_MEMORY_MARKER}: This support memory must not enter a narrowed Media Buyer campaign route.`,
  );
  await writeTextFile(
    path.join(projectRootPath, 'instance', 'operational-identities', 'juan', 'memory', 'campaign-review-preference.md'),
    `# Juan Campaign Review Preference\n\n${JUAN_OPERATIONAL_MEMORY_MARKER}: Juan prefers strict ROI-first summaries with one concrete next action and no vanity-metric conclusions.`,
  );
  await writeTextFile(
    path.join(projectRootPath, 'instance', 'operational-identities', 'maria', 'memory', 'complaint-note.md'),
    `# Maria Complaint Note\n\n${MARIA_PRIVATE_MEMORY_MARKER}: Maria private complaint memory must not shape Juan's campaign spend analysis.`,
  );
  await writeTextFile(
    path.join(projectRootPath, 'instance', 'memory', 'knowledge', 'business-goals.md'),
    `# Business Goals\n\n${MAS_BUSINESS_GOAL_MARKER}: Sin Cuchillo wants profitable local purchases, not empty engagement or vanity reach.`,
  );
  await writeJsonFile(
    path.join(projectRootPath, 'instance', 'memory', 'state', 'previous-campaign-session.json'),
    {
      kind: 'agent_invocation_session',
      invocationId: 'previous-campaign-session',
      operationalIdentityId: 'juan',
      primaryCognitiveIdentityId: 'media-buyer',
      executionType: 'probabilistic_brain',
      request: {
        command: 'analyze-campaign',
        invocationMode: 'probabilistic',
      },
      readinessStatus: 'ready',
      message: 'Juan previously warned that reported campaign data must be treated as evidence, not final truth.',
      brainOutput: {
        outputText: RAW_PROVIDER_OUTPUT_MARKER,
      },
      startedAt: '2026-04-14T10:00:00.000Z',
      finishedAt: '2026-04-14T10:00:01.000Z',
    },
  );

  await writeDurableMemoryRecord({
    projectRootPath,
    memoryRecord: createCampaignDurableMemoryRecord({
      memoryRecordId: 'mem_current_campaign_performance_summary',
      summary: 'Approved current Meta Ads performance summary.',
      content: `${CURRENT_CAMPAIGN_PERFORMANCE_MARKER}: Current approved summary says Campaign A has lower CAC and stronger purchase intent than Campaign B; recommend shifting budget cautiously, not publishing changes automatically.`,
      sourceReferences: [
        createDurableSourceReference({
          sourceId: 'current-campaign-performance.md',
          path: 'memory/artifacts/current-campaign-performance.md',
        }),
      ],
    }),
  });
  await writeDurableMemoryRecord({
    projectRootPath,
    memoryRecord: createCampaignDurableMemoryRecord({
      memoryRecordId: 'mem_stale_campaign_performance_summary',
      summary: 'Stale campaign performance summary must not shape Juan.',
      content: `${STALE_CAMPAIGN_PERFORMANCE_MARKER}: Old performance said Campaign B was best, but it is stale.`,
      retention: {
        retentionPolicyId: 'campaign-performance-short-lived',
        expiresAt: null,
        staleAfter: '2026-01-01T00:00:00.000Z',
        reviewRequiredAt: null,
      },
      sourceReferences: [
        createDurableSourceReference({
          sourceId: 'stale-campaign-performance.md',
          path: 'memory/artifacts/stale-campaign-performance.md',
        }),
      ],
    }),
  });
  await writeDurableMemoryRecord({
    projectRootPath,
    memoryRecord: createCampaignDurableMemoryRecord({
      memoryRecordId: 'mem_pending_campaign_optimization_candidate',
      approvalState: 'pending',
      confidence: 'agent_proposed',
      summary: 'Pending optimization recommendation must not be available yet.',
      content: `${PENDING_OPTIMIZATION_MARKER}: This unapproved candidate says to double budget immediately.`,
      sourceReferences: [
        createDurableSourceReference({
          sourceId: 'pending-campaign-optimization.md',
          path: 'memory/artifacts/pending-campaign-optimization.md',
          origin: 'agent_proposed',
        }),
      ],
    }),
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

test('Juan campaign spend acid test uses governed performance context and respects boundaries', async () => {
  await withEnvironment(
    {
      "openrouter-api-key": 'openrouter-secret',
      "gemini-api-key": 'gemini-secret',
      "meta-ads-api-key": META_ADS_SECRET_VALUE,
    },
    async () => {
      const projectRootPath = await createJuanCampaignProjectFixture();
      await seedJuanCampaignScenario(projectRootPath);

      const providerSystemMessages = [];
      const providerUserMessages = [];
      const result = await runAgentInvocation({
        projectRootPath,
        operationalIdentityId: 'juan',
        invocationMode: 'probabilistic',
        command: 'analyze-campaign',
        inputText: 'Analyze the current Meta Ads campaign spend for Sin Cuchillo and recommend the safest next budget action.',
        requestedBy: 'juan-campaign-acid-test',
        fetchImplementation: async (url, options) => {
          assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions');
          assert.equal(options.headers.Authorization, 'Bearer openrouter-secret');

          const body = JSON.parse(options.body);
          providerSystemMessages.push(body.messages[0].content);
          providerUserMessages.push(body.messages[1].content);

          return {
            ok: true,
            async json() {
              return {
                id: 'openrouter-juan-campaign-acid-test',
                choices: [
                  {
                    finish_reason: 'stop',
                    message: {
                      content: 'Juan prepared a cautious campaign spend recommendation from governed context.',
                    },
                  },
                ],
                usage: {
                  prompt_tokens: 560,
                  completion_tokens: 18,
                  total_tokens: 578,
                },
              };
            },
          };
        },
      });

      assert.equal(result.status, 'completed');
      assert.equal(providerSystemMessages.length, 1);
      assert.equal(providerUserMessages.length, 1);

      const providerSystemMessage = providerSystemMessages[0];
      const invocationSession = JSON.parse(await readFile(result.persistence.invocationSessionRecordPath, 'utf8'));
      const contextPackLayer = findContextPackLayer(invocationSession);

      assert.match(providerUserMessages[0], /Meta Ads campaign spend/u);
      assert.match(providerSystemMessage, /Display Name: Juan/u);
      assert.match(providerSystemMessage, /Tone: strict but kind/u);
      assert.match(providerSystemMessage, /Primary Cognitive Identity ID: media-buyer/u);
      assert.match(providerSystemMessage, /Secondary Cognitive Identity IDs: none/u);
      assert.match(providerSystemMessage, /Meta Ads Reporting API/u);
      assert.match(providerSystemMessage, /Access Mode: read/u);
      assert.match(providerSystemMessage, /Permission Evaluation Status: resolved/u);
      assert.match(providerSystemMessage, /Denied Bindings:/u);
      assert.match(providerSystemMessage, /facebook-page-publisher \(publish\): No allow rule found/u);

      assertIncludesAll(providerSystemMessage, [
        MEDIA_BUYER_MEMORY_MARKER,
        JUAN_OPERATIONAL_MEMORY_MARKER,
        MAS_BUSINESS_GOAL_MARKER,
        CURRENT_CAMPAIGN_PERFORMANCE_MARKER,
      ]);
      assertExcludesAll(providerSystemMessage, [
        MARIA_PRIVATE_MEMORY_MARKER,
        COMMUNITY_MANAGER_MEMORY_MARKER,
        RAW_PROVIDER_OUTPUT_MARKER,
        STALE_CAMPAIGN_PERFORMANCE_MARKER,
        PENDING_OPTIMIZATION_MARKER,
        META_ADS_SECRET_VALUE,
        'openrouter-secret',
        'gemini-secret',
      ]);

      assert.match(providerSystemMessage, /Cognitive identity memory .* belongs to community-manager, which is not active/u);
      assert.match(providerSystemMessage, /Operational identity memory .* belongs to maria, not juan/u);
      assert.match(providerSystemMessage, /Decision Type: stale_source/u);
      assert.match(providerSystemMessage, /Decision Type: approval_omission/u);
      assert.match(providerSystemMessage, /mem_pending_campaign_optimization_candidate/u);

      assert.equal(hasSourceReference(contextPackLayer, {
        sourceType: 'agent_local_memory',
        sourceId: 'campaign-analysis-principles.md',
        path: 'cognitive-identities/marketing-and-sales/media-buyer/memory/campaign-analysis-principles.md',
      }), true);
      assert.equal(hasSourceReference(contextPackLayer, {
        sourceType: 'operational_identity_memory',
        sourceId: 'campaign-review-preference.md',
        path: 'operational-identities/juan/memory/campaign-review-preference.md',
      }), true);
      assert.equal(hasSourceReference(contextPackLayer, {
        sourceType: 'durable_memory_record',
        sourceId: 'mem_current_campaign_performance_summary',
        path: 'memory/durable/memory-record-mem_current_campaign_performance_summary.json',
      }), true);
      assert.equal(hasSourceReference(contextPackLayer, {
        sourceType: 'operational_identity_memory',
        sourceId: 'complaint-note.md',
        path: 'operational-identities/maria/memory/complaint-note.md',
      }), false);
      assert.equal(hasSourceReference(contextPackLayer, {
        sourceType: 'agent_local_memory',
        sourceId: 'support-reply-principles.md',
        path: 'cognitive-identities/marketing-and-sales/community-manager/memory/support-reply-principles.md',
      }), false);

      const persistedSession = JSON.stringify(invocationSession);

      assertExcludesAll(persistedSession, [
        RAW_PROVIDER_OUTPUT_MARKER,
        MARIA_PRIVATE_MEMORY_MARKER,
        COMMUNITY_MANAGER_MEMORY_MARKER,
        PENDING_OPTIMIZATION_MARKER,
        META_ADS_SECRET_VALUE,
        'openrouter-secret',
        'gemini-secret',
      ]);
    },
  );
});

test('Maria and Juan shared Meta resources resolve different usable permissions without leaking secrets', async () => {
  await withEnvironment(
    {
      "openrouter-api-key": 'openrouter-secret',
      "gemini-api-key": 'gemini-secret',
      "meta-ads-api-key": META_ADS_SECRET_VALUE,
      "instagram-channel-token": INSTAGRAM_SECRET_VALUE,
    },
    async () => {
      const projectRootPath = await createJuanCampaignProjectFixture();
      await seedJuanCampaignScenario(projectRootPath);

      const captured = {
        maria: [],
        juan: [],
      };
      const runProbe = async ({ operationalIdentityId, command, inputText }) => {
        return runAgentInvocation({
          projectRootPath,
          operationalIdentityId,
          invocationMode: 'probabilistic',
          command,
          inputText,
          requestedBy: 'shared-resource-permission-acid-test',
          fetchImplementation: async (url, options) => {
            assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions');
            assert.equal(options.headers.Authorization, 'Bearer openrouter-secret');

            const body = JSON.parse(options.body);
            captured[operationalIdentityId].push(body.messages[0].content);

            return {
              ok: true,
              async json() {
                return {
                  id: `openrouter-${operationalIdentityId}-shared-resource-acid-test`,
                  choices: [
                    {
                      finish_reason: 'stop',
                      message: {
                        content: `${operationalIdentityId} completed shared resource permission probe.`,
                      },
                    },
                  ],
                  usage: {
                    prompt_tokens: 420,
                    completion_tokens: 12,
                    total_tokens: 432,
                  },
                };
              },
            };
          },
        });
      };

      const mariaResult = await runProbe({
        operationalIdentityId: 'maria',
        command: 'ask',
        inputText: 'Can you manage the Instagram community channel and inspect ad spend?',
      });
      const juanResult = await runProbe({
        operationalIdentityId: 'juan',
        command: 'analyze-campaign',
        inputText: 'Can you inspect ad spend and publish community replies?',
      });

      assert.equal(mariaResult.status, 'completed');
      assert.equal(juanResult.status, 'completed');

      const mariaPrompt = captured.maria[0];
      const juanPrompt = captured.juan[0];

      assert.match(mariaPrompt, /Instagram Community Channel/u);
      assert.match(mariaPrompt, /Access Mode: publish/u);
      assert.match(mariaPrompt, /meta-ads-reporting \(read\): No allow rule found/u);
      assert.doesNotMatch(mariaPrompt, /Meta Ads Reporting API\n  Resource ID: meta-ads-reporting\n  Type: tool\n  Access Mode: read/u);
      assert.doesNotMatch(mariaPrompt, new RegExp(META_ADS_SECRET_VALUE, 'u'));
      assert.doesNotMatch(mariaPrompt, new RegExp(INSTAGRAM_SECRET_VALUE, 'u'));

      assert.match(juanPrompt, /Meta Ads Reporting API/u);
      assert.match(juanPrompt, /Access Mode: read/u);
      assert.match(juanPrompt, /facebook-page-publisher \(publish\): No allow rule found/u);
      assert.doesNotMatch(juanPrompt, /Instagram Community Channel/u);
      assert.doesNotMatch(juanPrompt, new RegExp(META_ADS_SECRET_VALUE, 'u'));
      assert.doesNotMatch(juanPrompt, new RegExp(INSTAGRAM_SECRET_VALUE, 'u'));

      const mariaSession = JSON.parse(await readFile(mariaResult.persistence.invocationSessionRecordPath, 'utf8'));
      const juanSession = JSON.parse(await readFile(juanResult.persistence.invocationSessionRecordPath, 'utf8'));
      const serializedSessions = `${JSON.stringify(mariaSession)}\n${JSON.stringify(juanSession)}`;

      assert.doesNotMatch(serializedSessions, new RegExp(META_ADS_SECRET_VALUE, 'u'));
      assert.doesNotMatch(serializedSessions, new RegExp(INSTAGRAM_SECRET_VALUE, 'u'));
      assert.equal(mariaSession.usableBindings.some((binding) => {
        return binding.resourceId === 'instagram-community-channel' && binding.accessMode === 'publish';
      }), true);
      assert.equal(mariaSession.usableBindings.some((binding) => {
        return binding.resourceId === 'meta-ads-reporting';
      }), false);
      assert.equal(juanSession.usableBindings.some((binding) => {
        return binding.resourceId === 'meta-ads-reporting' && binding.accessMode === 'read';
      }), true);
      assert.equal(juanSession.usableBindings.some((binding) => {
        return binding.resourceId === 'instagram-community-channel';
      }), false);
    },
  );
});
