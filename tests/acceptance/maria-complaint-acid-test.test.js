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
const VALID_SHA_256 = 'd'.repeat(64);

const COMMUNITY_COMPLAINT_MEMORY_MARKER = 'MARIA_COMPLAINT_COMMUNITY_MANAGER_MEMORY_ALLOWED';
const MARIA_OPERATIONAL_COMPLAINT_MEMORY_MARKER = 'MARIA_OPERATIONAL_COMPLAINT_MEMORY_ALLOWED';
const SIN_CUCHILLO_BRAND_MEMORY_MARKER = 'SIN_CUCHILLO_ACTIVE_BRAND_MEMORY_ALLOWED';
const SIN_CUCHILLO_COMPLAINT_POLICY_MARKER = 'SIN_CUCHILLO_COMPLAINT_POLICY_MUST_OVERRIDE_PERSONA';
const APPROVED_COMPLAINT_CASE_SUMMARY_MARKER = 'APPROVED_COMPLAINT_CASE_SUMMARY_WITH_PII_CONTROLS';
const APPROVED_SIMILAR_ISSUE_SUMMARY_MARKER = 'APPROVED_SIMILAR_ISSUE_SUMMARY_FOR_COMPLAINT_HANDLING';
const RUNTIME_EVIDENCE_SUMMARY_MARKER = 'RUNTIME_EVIDENCE_SUMMARY_ALLOWED_NOT_RAW_PROVIDER_OUTPUT';
const JUAN_PRIVATE_CAMPAIGN_MEMORY_MARKER = 'JUAN_PRIVATE_CAMPAIGN_MEMORY_MUST_NOT_REACH_MARIA';
const RAW_PROVIDER_OUTPUT_MARKER = 'RAW_PROVIDER_OUTPUT_MUST_NOT_REACH_CONTEXT';
const STALE_COMPLAINT_POLICY_MARKER = 'STALE_COMPLAINT_POLICY_MUST_NOT_REACH_CONTEXT';
const SUPERSEDED_COMPLAINT_POLICY_MARKER = 'SUPERSEDED_COMPLAINT_POLICY_MUST_NOT_REACH_CONTEXT';
const PENDING_MEMORY_CANDIDATE_MARKER = 'PENDING_MEMORY_CANDIDATE_MUST_NOT_REACH_CONTEXT';

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
  await writeFile(path.join(cognitiveIdentityRootPath, 'policies.md'), '# Policies\n\n- Use governed memory only.\n- Respect MAS policy over persona.', 'utf8');
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
        credentialReferenceId: 'openrouter-api-key',
      },
      {
        resourceId: 'gemini-api',
        accessMode: 'execute',
        bindingState: 'active',
        credentialReferenceId: 'gemini-api-key',
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
    enabledCommands: ['ask'],
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
  sourceType = 'knowledge_document',
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

function createMasSubjectReferences(extraSubjectReferences = []) {
  return [
    {
      subjectType: 'mas_instance',
      subjectId: 'sin-cuchillo',
      relationship: 'owner',
    },
    ...extraSubjectReferences,
  ];
}

function createComplaintDurableMemoryRecord(overrides = {}) {
  return createDurableMemoryRecord({
    memoryType: 'conversation_summary',
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
    summary: 'Approved complaint memory.',
    content: 'Approved complaint memory content.',
    sourceReferences: [
      createDurableSourceReference({
        sourceId: 'complaint-case-summary.md',
        path: 'memory/knowledge/complaint-case-summary.md',
      }),
    ],
    subjectReferences: createMasSubjectReferences([
      {
        subjectType: 'operational_identity',
        subjectId: 'maria',
        relationship: 'authorized-consumer',
      },
    ]),
    retention: {
      retentionPolicyId: 'default-complaint-memory',
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
          sourceId: 'maria-private-memory',
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
    },
  );
}

async function createMariaComplaintProjectFixture() {
  const projectRootPath = await mkdtemp(path.join(os.tmpdir(), 'openmas-maria-complaint-acid-'));

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
    identityText: 'Handles community conversations, customer complaints, public replies, escalation, and brand-safe moderation.',
  });
  await writePortableCognitiveIdentity({
    projectRootPath,
    relativeCognitiveIdentityPath: 'marketing-and-sales/copywriter-senior',
    title: 'Copywriter Senior',
    identityText: 'Writes concise, persuasive, human-facing copy while respecting policy and brand constraints.',
  });
  await writePortableCognitiveIdentity({
    projectRootPath,
    relativeCognitiveIdentityPath: 'marketing-and-sales/media-buyer',
    title: 'Media Buyer',
    identityText: 'Manages campaign investment analysis and paid media performance.',
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
    path.join(projectRootPath, 'config', 'credential-references.json'),
    createCredentialReferenceRegistryContent(),
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

  await writeMemorySourceRegistry({ projectRootPath });

  return projectRootPath;
}

async function seedMariaComplaintScenario(projectRootPath) {
  await writeTextFile(
    path.join(projectRootPath, 'instance', 'cognitive-identities', 'marketing-and-sales', 'community-manager', 'memory', 'complaint-response-principles.md'),
    `# Complaint Response Principles\n\n${COMMUNITY_COMPLAINT_MEMORY_MARKER}: Acknowledge frustration, ask for the order number, and escalate serious delivery failures.`,
  );
  await writeTextFile(
    path.join(projectRootPath, 'instance', 'cognitive-identities', 'marketing-and-sales', 'copywriter-senior', 'memory', 'public-reply-style.md'),
    '# Public Reply Style\n\nKeep public replies concise, human, and clear.',
  );
  await writeTextFile(
    path.join(projectRootPath, 'instance', 'operational-identities', 'maria', 'memory', 'complaint-tone-memory.md'),
    `# Maria Complaint Tone Memory\n\n${MARIA_OPERATIONAL_COMPLAINT_MEMORY_MARKER}: Maria slows her enthusiastic persona during serious complaints.`,
  );
  await writeTextFile(
    path.join(projectRootPath, 'instance', 'operational-identities', 'juan', 'memory', 'campaign-spend-note.md'),
    `# Juan Campaign Spend Note\n\n${JUAN_PRIVATE_CAMPAIGN_MEMORY_MARKER}: Juan's private paid media spend note must never be used by Maria.`,
  );
  await writeTextFile(
    path.join(projectRootPath, 'instance', 'memory', 'knowledge', 'company-brand.md'),
    `# Sin Cuchillo Brand Memory\n\n${SIN_CUCHILLO_BRAND_MEMORY_MARKER}: Sin Cuchillo replies must sound warm, accountable, and practical.`,
  );
  await writeTextFile(
    path.join(projectRootPath, 'instance', 'memory', 'policies', 'complaint-handling-policy.md'),
    `# Complaint Handling Policy\n\n${SIN_CUCHILLO_COMPLAINT_POLICY_MARKER}: Answer serious delivery complaints calmly, ask for the order number privately, and escalate when needed.`,
  );
  await writeJsonFile(
    path.join(projectRootPath, 'instance', 'memory', 'state', 'previous-complaint-session.json'),
    {
      kind: 'agent_invocation_session',
      invocationId: 'previous-complaint-session',
      operationalIdentityId: 'maria',
      primaryCognitiveIdentityId: 'community-manager',
      executionType: 'probabilistic_brain',
      request: {
        command: 'ask',
        invocationMode: 'probabilistic',
      },
      readinessStatus: 'ready',
      message: `${RUNTIME_EVIDENCE_SUMMARY_MARKER}: Maria previously handled a delayed delivery by requesting the order number and escalating politely.`,
      brainOutput: {
        outputText: RAW_PROVIDER_OUTPUT_MARKER,
      },
      startedAt: '2026-04-14T10:00:00.000Z',
      finishedAt: '2026-04-14T10:00:01.000Z',
    },
  );

  await writeDurableMemoryRecord({
    projectRootPath,
    memoryRecord: createComplaintDurableMemoryRecord({
      memoryRecordId: 'mem_maria_delayed_delivery_case_summary',
      memoryType: 'conversation_summary',
      summary: 'Approved delayed-delivery complaint summary with privacy controls.',
      content: `${APPROVED_COMPLAINT_CASE_SUMMARY_MARKER}: Late delivery complaint; PII redacted; ask for order number privately and escalate if needed.`,
      sourceReferences: [
        createDurableSourceReference({
          sourceId: 'complaint-case-summary.md',
          path: 'memory/knowledge/complaint-case-summary.md',
        }),
      ],
    }),
  });
  await writeDurableMemoryRecord({
    projectRootPath,
    memoryRecord: createComplaintDurableMemoryRecord({
      memoryRecordId: 'mem_recent_similar_complaint_resolution',
      memoryType: 'conversation_summary',
      summary: 'Approved similar complaint resolution summary.',
      content: `${APPROVED_SIMILAR_ISSUE_SUMMARY_MARKER}: Similar cases improved when order details moved to private support.`,
      sourceReferences: [
        createDurableSourceReference({
          sourceId: 'similar-complaint-resolution.md',
          path: 'memory/knowledge/similar-complaint-resolution.md',
        }),
      ],
    }),
  });
  await writeDurableMemoryRecord({
    projectRootPath,
    memoryRecord: createComplaintDurableMemoryRecord({
      memoryRecordId: 'mem_stale_complaint_policy',
      memoryType: 'policy_context',
      authorityLevel: 'policy',
      summary: 'Stale complaint policy must not shape Maria.',
      content: `${STALE_COMPLAINT_POLICY_MARKER}: Old policy said to answer every complaint with playful humor.`,
      retention: {
        retentionPolicyId: 'stale-complaint-policy',
        expiresAt: null,
        staleAfter: '2026-01-01T00:00:00.000Z',
        reviewRequiredAt: null,
      },
      sourceReferences: [
        createDurableSourceReference({
          sourceId: 'stale-complaint-policy.md',
          sourceType: 'policy_document',
          path: 'memory/policies/stale-complaint-policy.md',
        }),
      ],
    }),
  });
  await writeDurableMemoryRecord({
    projectRootPath,
    memoryRecord: createComplaintDurableMemoryRecord({
      memoryRecordId: 'mem_superseded_complaint_policy',
      memoryType: 'policy_context',
      authorityLevel: 'policy',
      summary: 'Superseded complaint policy must not shape Maria.',
      content: `${SUPERSEDED_COMPLAINT_POLICY_MARKER}: Old policy said to ask customers to wait without escalation.`,
      supersession: {
        supersedesMemoryRecordIds: [],
        supersededByMemoryRecordId: 'mem_current_complaint_policy_decision',
      },
      sourceReferences: [
        createDurableSourceReference({
          sourceId: 'superseded-complaint-policy.md',
          sourceType: 'policy_document',
          path: 'memory/policies/superseded-complaint-policy.md',
        }),
      ],
    }),
  });
  await writeDurableMemoryRecord({
    projectRootPath,
    memoryRecord: createComplaintDurableMemoryRecord({
      memoryRecordId: 'mem_current_complaint_policy_decision',
      memoryType: 'policy_context',
      authorityLevel: 'policy',
      summary: 'Current durable policy decision for serious delivery complaints.',
      content: 'Current durable policy confirms calm escalation for serious delivery complaints.',
      supersession: {
        supersedesMemoryRecordIds: ['mem_superseded_complaint_policy'],
        supersededByMemoryRecordId: null,
      },
      sourceReferences: [
        createDurableSourceReference({
          sourceId: 'current-complaint-policy-decision.md',
          sourceType: 'policy_document',
          path: 'memory/policies/current-complaint-policy-decision.md',
        }),
      ],
    }),
  });
  await writeDurableMemoryRecord({
    projectRootPath,
    memoryRecord: createComplaintDurableMemoryRecord({
      memoryRecordId: 'mem_pending_complaint_write_candidate',
      memoryType: 'conversation_summary',
      approvalState: 'pending',
      confidence: 'agent_proposed',
      summary: 'Pending complaint write candidate must not be available yet.',
      content: `${PENDING_MEMORY_CANDIDATE_MARKER}: This pending candidate was not approved by a human or steward.`,
      sourceReferences: [
        createDurableSourceReference({
          sourceId: 'pending-complaint-candidate.md',
          path: 'memory/knowledge/pending-complaint-candidate.md',
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

test('Maria complaint acid test uses governed context and omits unsafe memory', async () => {
  await withEnvironment(
    {
      "openrouter-api-key": 'openrouter-secret',
      "gemini-api-key": 'gemini-secret',
    },
    async () => {
      const projectRootPath = await createMariaComplaintProjectFixture();
      await seedMariaComplaintScenario(projectRootPath);

      const providerSystemMessages = [];
      const providerUserMessages = [];
      const result = await runAgentInvocation({
        projectRootPath,
        operationalIdentityId: 'maria',
        invocationMode: 'probabilistic',
        command: 'ask',
        inputText: 'Please draft a public reply to a customer complaining that their Sin Cuchillo delivery is delayed. Keep it short and safe.',
        requestedBy: 'complaint-acid-test',
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
                id: 'openrouter-maria-complaint-acid-test',
                choices: [
                  {
                    finish_reason: 'stop',
                    message: {
                      content: 'Maria drafted a calm public complaint reply using governed context.',
                    },
                  },
                ],
                usage: {
                  prompt_tokens: 520,
                  completion_tokens: 16,
                  total_tokens: 536,
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

      assert.match(providerUserMessages[0], /delayed/iu);
      assert.match(providerSystemMessage, /## Execution Guards/u);
      assert.match(providerSystemMessage, /Display Name: Maria/u);
      assert.match(providerSystemMessage, /Tone: enthusiastic/u);
      assert.match(providerSystemMessage, /Primary Cognitive Identity ID: community-manager/u);
      assert.match(providerSystemMessage, /Secondary Cognitive Identity IDs: copywriter-senior/u);
      assert.match(providerSystemMessage, /Policy Context/u);
      const runtimeEvidenceIncluded = /Recent Activity Summary/u.test(providerSystemMessage);
      const runtimeEvidenceOmittedWithReason = /Context section omitted by token budget: recent-activity-summary/u.test(providerSystemMessage);

      assert.equal(runtimeEvidenceIncluded || runtimeEvidenceOmittedWithReason, true);

      assertIncludesAll(providerSystemMessage, [
        COMMUNITY_COMPLAINT_MEMORY_MARKER,
        MARIA_OPERATIONAL_COMPLAINT_MEMORY_MARKER,
        SIN_CUCHILLO_BRAND_MEMORY_MARKER,
        SIN_CUCHILLO_COMPLAINT_POLICY_MARKER,
        APPROVED_COMPLAINT_CASE_SUMMARY_MARKER,
        APPROVED_SIMILAR_ISSUE_SUMMARY_MARKER,
      ]);
      if (runtimeEvidenceIncluded) {
        assert.match(providerSystemMessage, new RegExp(RUNTIME_EVIDENCE_SUMMARY_MARKER, 'u'));
      }
      assertExcludesAll(providerSystemMessage, [
        JUAN_PRIVATE_CAMPAIGN_MEMORY_MARKER,
        RAW_PROVIDER_OUTPUT_MARKER,
        STALE_COMPLAINT_POLICY_MARKER,
        SUPERSEDED_COMPLAINT_POLICY_MARKER,
        PENDING_MEMORY_CANDIDATE_MARKER,
        'openrouter-secret',
        'gemini-secret',
      ]);

      assert.match(providerSystemMessage, /Operational identity memory .* belongs to juan, not maria/u);
      assert.match(providerSystemMessage, /Decision Type: stale_source/u);
      assert.match(providerSystemMessage, /Decision Type: superseded_source/u);
      assert.match(providerSystemMessage, /Decision Type: approval_omission/u);
      assert.match(providerSystemMessage, /mem_pending_complaint_write_candidate/u);
      assert.match(contextPackLayer.summary, /Durable memory provenance: 3 included, 3 omitted, 0 rejected durable source references\./u);

      assert.equal(hasSourceReference(contextPackLayer, {
        sourceType: 'policy_document',
        sourceId: 'complaint-handling-policy.md',
        path: 'memory/policies/complaint-handling-policy.md',
      }), true);
      assert.equal(hasSourceReference(contextPackLayer, {
        sourceType: 'agent_local_memory',
        sourceId: 'complaint-response-principles.md',
        path: 'cognitive-identities/marketing-and-sales/community-manager/memory/complaint-response-principles.md',
      }), true);
      assert.equal(hasSourceReference(contextPackLayer, {
        sourceType: 'operational_identity_memory',
        sourceId: 'complaint-tone-memory.md',
        path: 'operational-identities/maria/memory/complaint-tone-memory.md',
      }), true);
      assert.equal(hasSourceReference(contextPackLayer, {
        sourceType: 'durable_memory_record',
        sourceId: 'mem_maria_delayed_delivery_case_summary',
        path: 'memory/durable/memory-record-mem_maria_delayed_delivery_case_summary.json',
      }), true);
      assert.equal(hasSourceReference(contextPackLayer, {
        sourceType: 'operational_identity_memory',
        sourceId: 'campaign-spend-note.md',
        path: 'operational-identities/juan/memory/campaign-spend-note.md',
      }), false);

      const persistedSession = JSON.stringify(invocationSession);

      assertExcludesAll(persistedSession, [
        RAW_PROVIDER_OUTPUT_MARKER,
        JUAN_PRIVATE_CAMPAIGN_MEMORY_MARKER,
        PENDING_MEMORY_CANDIDATE_MARKER,
        'openrouter-secret',
        'gemini-secret',
      ]);
    },
  );
});
