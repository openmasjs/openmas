import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { generateMasterKey } from '../../src/credentials/generate-master-key.js';
import { writeCredentialVault } from '../../src/credentials/write-credential-vault.js';
import { assertMemoryRecord } from '../../src/contracts/memory/memory-record-contract.js';
import { createDurableMemoryRecordFileName } from '../../src/memory/write-durable-memory-record.js';
import { writeSystemStewardCommandModules } from './write-system-steward-command-modules.js';

const VALID_CREATED_AT = '2026-04-14T00:00:00.000Z';
const VALID_SHA_256 = 'a'.repeat(64);
const DEFAULT_CREDENTIAL_VAULT_SECRETS = Object.freeze({
  'openrouter-api-key': 'openrouter-secret',
  'gemini-api-key': 'gemini-secret',
});
let activeFixtureCredentialVaultSecretOverrides = null;

async function createDirectoryTree(rootPath, relativePaths) {
  for (const relativePath of relativePaths) {
    await mkdir(path.join(rootPath, relativePath), { recursive: true });
  }
}

function createCredentialReferenceRegistryContent({
} = {}) {
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

function createCredentialVaultContent(credentialVaultSecretOverrides = null) {
  const credentials = {};
  const requestedSecrets = {
    ...DEFAULT_CREDENTIAL_VAULT_SECRETS,
    ...(credentialVaultSecretOverrides ?? activeFixtureCredentialVaultSecretOverrides ?? {}),
  };

  for (const [credentialReferenceId, secretValue] of Object.entries(requestedSecrets)) {
    if (typeof secretValue === 'string' && secretValue.length > 0) {
      credentials[credentialReferenceId] = secretValue;
    }
  }

  return credentials;
}

async function writeDevelopmentCredentialVault({
  projectRootPath,
  credentialVaultSecrets,
}) {
  const masterKeyHex = generateMasterKey();

  await mkdir(path.join(projectRootPath, 'config', 'credentials'), { recursive: true });
  await writeFile(
    path.join(projectRootPath, 'config', 'credentials', 'development.key'),
    masterKeyHex,
    'utf8',
  );

  await writeCredentialVault({
    projectRootPath,
    environment: 'development',
    credentials: createCredentialVaultContent(credentialVaultSecrets),
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

function createAlfredBindingsContent() {
  return {
    kind: 'operational_identity_bindings',
    version: 1,
    operationalIdentityId: 'alfred',
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

function createAlfredPermissionsContent() {
  return {
    kind: 'operational_identity_permissions',
    version: 1,
    operationalIdentityId: 'alfred',
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

function createMasSystemInspectToolDefinition() {
  return {
    kind: 'tool_definition',
    version: 1,
    toolId: 'mas.system.inspect',
    displayName: 'MAS System Inspect',
    description: 'Reads safe MAS system state.',
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
    requiredResourceTypes: [
      'storage',
    ],
    requiredAccessModes: [
      'read',
    ],
    requiredPermissionModes: [
      'tool.execute',
    ],
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
      allowWritebackCandidates: false,
    },
    intentMetadata: {
      kind: 'action_intent_metadata',
      version: 1,
      primaryIntentId: 'admin.mas.inspect',
      targetActionType: 'tool_execution',
      targetType: 'tool',
      targetId: 'mas.system.inspect',
      expectedSideEffectLevel: 'read_only',
      requestTypes: [
        'diagnostic',
        'tool_action',
        'plan_request',
      ],
      semanticTags: [
        'mas',
        'system',
        'inspect',
        'diagnostic',
        'plan',
      ],
      whenToUse: [
        'The user asks for a current MAS inspection.',
      ],
      whenNotToUse: [
        'The user asks to mutate the MAS.',
      ],
      exampleRequests: [
        'Inspect the MAS.',
        'Show me an inspection plan for the MAS.',
      ],
      classificationGuidance: {
        highConfidenceSignals: [
          'The request asks for a MAS inspection or a governed inspection preview.',
        ],
        ambiguitySignals: [],
        negativeSignals: [],
        requiredContextKeys: [],
      },
    },
  };
}

function createMasHealthReviewWorkflowDefinition() {
  return {
    kind: 'workflow_runtime_definition',
    version: 1,
    workflowId: 'mas-health-review',
    lifecycleState: 'active',
    executionMode: 'on_demand',
    statePolicy: {
      persistState: true,
      resumeAllowed: true,
    },
    steps: [
      {
        stepId: 'inspect-system',
        stepType: 'tool_call',
        toolId: 'mas.system.inspect',
        input: {},
        onFailure: 'fail_workflow',
      },
    ],
    approvalPolicy: {
      defaultRequiredForSideEffectLevels: [
        'write_external',
        'publish_external',
        'financial',
        'destructive',
      ],
    },
    artifactPolicy: {
      persistFinalReport: true,
    },
    memoryPolicy: {
      allowWritebackCandidates: true,
    },
    intentMetadata: {
      kind: 'action_intent_metadata',
      version: 1,
      primaryIntentId: 'admin.mas.health_review',
      targetActionType: 'workflow_execution',
      targetType: 'workflow',
      targetId: 'mas-health-review',
      expectedSideEffectLevel: 'read_only',
      requestTypes: [
        'diagnostic',
        'workflow_action',
        'plan_request',
      ],
      semanticTags: [
        'mas',
        'health',
        'review',
        'plan',
      ],
      whenToUse: [
        'The user asks for a deeper MAS health review.',
      ],
      whenNotToUse: [
        'The user only asks for a quick inspection.',
      ],
      exampleRequests: [
        'Run a full MAS health review.',
        'Show me a deeper MAS review plan.',
      ],
      classificationGuidance: {
        highConfidenceSignals: [
          'The request asks for a comprehensive MAS diagnostic or a preview of that review path.',
        ],
        ambiguitySignals: [],
        negativeSignals: [],
        requiredContextKeys: [],
      },
    },
  };
}

function createSourceReference(overrides = {}) {
  return {
    kind: 'memory_source_reference',
    version: 1,
    sourceType: 'knowledge_document',
    sourceId: 'alfred-durable-fixture.md',
    scope: 'mas_instance',
    ownerId: 'sin-cuchillo',
    path: 'memory/knowledge/alfred-durable-fixture.md',
    origin: 'administrator_curated',
    sensitivityLevel: 'internal',
    createdAt: VALID_CREATED_AT,
    contentSha256: VALID_SHA_256,
    ...overrides,
  };
}

export function createDurableMemoryRecord(overrides = {}) {
  return assertMemoryRecord({
    kind: 'memory_record',
    version: 1,
    memoryRecordId: 'mem_alfred_durable_context',
    memoryType: 'company_fact',
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
    summary: 'Alfred has approved durable MAS memory about the organization.',
    content: 'ALFRED_DURABLE_MEMORY_ALLOWED: Sin Cuchillo is the MAS organization and Alfred should use approved durable MAS memory as supporting context.',
    sourceReferences: [createSourceReference()],
    subjectReferences: [
      {
        subjectType: 'mas_instance',
        subjectId: 'sin-cuchillo',
        relationship: 'owner',
      },
      {
        subjectType: 'operational_identity',
        subjectId: 'alfred',
        relationship: 'authorized-consumer',
      },
    ],
    retention: {
      retentionPolicyId: 'default-durable-memory',
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
    warnings: [],
    ...overrides,
  });
}

export async function writeDurableMemoryRecord({ projectRootPath, memoryRecord }) {
  const durableMemoryRootPath = path.join(projectRootPath, 'instance', 'memory', 'durable');

  await mkdir(durableMemoryRootPath, { recursive: true });
  await writeFile(
    path.join(durableMemoryRootPath, createDurableMemoryRecordFileName(memoryRecord.memoryRecordId)),
    `${JSON.stringify(memoryRecord, null, 2)}\n`,
    'utf8',
  );
}

export async function createAlfredProbabilisticProjectFixture({
  executionMode = 'hybrid',
  includeCredentialReferenceRegistry = true,
  includeInspectionAffordances = false,
  credentialVaultSecrets = null,
} = {}) {
  const temporaryRootPath = await mkdtemp(path.join(os.tmpdir(), 'openmas-probabilistic-invocation-'));

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
    'instance/cognitive-identities/system-steward',
    'instance/cognitive-identities/system-steward/commands',
    'instance/cognitive-identities/system-steward/memory',
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
    'instance/operational-identities/alfred',
  ]);

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

  await writeFile(
    path.join(temporaryRootPath, 'instance', 'registries', 'resources.json'),
    JSON.stringify(createResourcesRegistryContent(), null, 2),
    'utf8',
  );

  if (includeCredentialReferenceRegistry) {
    await writeFile(
      path.join(temporaryRootPath, 'config', 'credential-references.json'),
      JSON.stringify(createCredentialReferenceRegistryContent(), null, 2),
      'utf8',
    );
    await writeDevelopmentCredentialVault({
      projectRootPath: temporaryRootPath,
      credentialVaultSecrets,
    });
  }

  await writeFile(
    path.join(temporaryRootPath, 'instance', 'cognitive-identities', 'system-steward', 'identity.md'),
    '# System Steward\n\nThe System Steward administers the MAS framework.',
    'utf8',
  );
  await writeFile(
    path.join(temporaryRootPath, 'instance', 'cognitive-identities', 'system-steward', 'policies.md'),
    '# Policies\n\n- Be precise and audit-friendly.',
    'utf8',
  );
  await writeFile(
    path.join(temporaryRootPath, 'instance', 'cognitive-identities', 'system-steward', 'capabilities.md'),
    '# Capabilities\n\n- Explain MAS structure and runtime status.',
    'utf8',
  );
  await writeSystemStewardCommandModules(temporaryRootPath);

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
        attachedCognitiveIdentities: [
          {
            cognitiveIdentityId: 'system-steward',
          },
        ],
        executionProfileId: 'alfred-default',
        persona: {
          tone: 'helpful',
          presentationStyle: 'warm and professional',
        },
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
        executionMode,
        primaryBrain: {
          brainId: 'openrouter-primary',
          providerId: 'openrouter-api',
          modelId: 'openrouter/free',
        },
        fallbackBrain: {
          brainId: 'gemini-fallback',
          providerId: 'gemini-api',
          modelId: 'gemini-flash-latest',
        },
        enabledCommands: [
          'hello',
          'status',
          'ask',
        ],
      },
      null,
      2,
    ),
    'utf8',
  );

  await writeFile(
    path.join(temporaryRootPath, 'instance', 'operational-identities', 'alfred', 'bindings.json'),
    JSON.stringify(createAlfredBindingsContent(), null, 2),
    'utf8',
  );

  await writeFile(
    path.join(temporaryRootPath, 'instance', 'operational-identities', 'alfred', 'permissions.json'),
    JSON.stringify(createAlfredPermissionsContent(), null, 2),
    'utf8',
  );

  if (includeInspectionAffordances) {
    await createDirectoryTree(temporaryRootPath, [
      'instance/tools/mas.system.inspect',
      'instance/workflows/mas-health-review',
    ]);

    await writeFile(
      path.join(temporaryRootPath, 'instance', 'tools', 'mas.system.inspect', 'tool.json'),
      `${JSON.stringify(createMasSystemInspectToolDefinition(), null, 2)}\n`,
      'utf8',
    );

    await writeFile(
      path.join(temporaryRootPath, 'instance', 'tools', 'mas.system.inspect', 'executor.js'),
      [
        'export default async function executeMasSystemInspect() {',
        '  return {',
        '    output: {',
        "      summary: 'Fixture inspection executor ran successfully.',",
        '      inspected: true,',
        '    },',
        '  };',
        '}',
        '',
      ].join('\n'),
      'utf8',
    );

    await writeFile(
      path.join(temporaryRootPath, 'instance', 'workflows', 'mas-health-review', 'runtime.json'),
      `${JSON.stringify(createMasHealthReviewWorkflowDefinition(), null, 2)}\n`,
      'utf8',
    );
  }

  return temporaryRootPath;
}

export function withEnvironment(overrides, callback) {
  const previousValues = new Map();
  const credentialVaultSecretOverrides = {};
  const previousFixtureCredentialVaultSecretOverrides = activeFixtureCredentialVaultSecretOverrides;
  let hasCredentialVaultSecretOverrides = false;

  for (const [key, value] of Object.entries(overrides)) {
    if (key.includes('-')) {
      credentialVaultSecretOverrides[key] = value;
      hasCredentialVaultSecretOverrides = true;
      continue;
    }

    previousValues.set(key, process.env[key]);

    if (value === null) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  activeFixtureCredentialVaultSecretOverrides = hasCredentialVaultSecretOverrides
    ? credentialVaultSecretOverrides
    : previousFixtureCredentialVaultSecretOverrides;

  return Promise.resolve()
    .then(callback)
    .finally(() => {
      activeFixtureCredentialVaultSecretOverrides = previousFixtureCredentialVaultSecretOverrides;

      for (const [key, value] of previousValues.entries()) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    });
}
