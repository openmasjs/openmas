import { assertMemorySourceRegistry } from '../contracts/memory/memory-source-registry-contract.js';

const DEFAULT_READ_POLICY = {
  maxFiles: 10,
  maxBytesPerFile: 32768,
};

const DEFAULT_DURABLE_MEMORY_READ_POLICY = {
  maxFiles: 50,
  maxBytesPerFile: 65536,
};

export function buildDefaultMemorySourceRegistry({ masOwnerId = 'mas-instance' } = {}) {
  return assertMemorySourceRegistry({
    kind: 'memory_source_registry',
    version: 1,
    memorySources: [
      {
        sourceId: 'runtime-state',
        sourceType: 'state_directory',
        rootPath: 'memory/state',
        scope: 'mas_instance',
        ownerId: masOwnerId,
        defaultPortability: 'mas_bound',
        defaultVisibility: 'restricted',
        defaultSensitivityLevel: 'internal',
        lifecycleState: 'active',
        readPolicy: DEFAULT_READ_POLICY,
        description: 'Recent runtime state files. Evidence only, not durable truth.',
      },
      {
        sourceId: 'runtime-artifacts',
        sourceType: 'artifacts_directory',
        rootPath: 'memory/artifacts',
        scope: 'mas_instance',
        ownerId: masOwnerId,
        defaultPortability: 'mas_bound',
        defaultVisibility: 'restricted',
        defaultSensitivityLevel: 'internal',
        lifecycleState: 'active',
        readPolicy: DEFAULT_READ_POLICY,
        description: 'Runtime artifact references. Artifacts must be summarized before context inclusion.',
      },
      {
        sourceId: 'knowledge',
        sourceType: 'knowledge_directory',
        rootPath: 'memory/knowledge',
        scope: 'mas_instance',
        ownerId: masOwnerId,
        defaultPortability: 'not_exportable',
        defaultVisibility: 'shared_with_mas',
        defaultSensitivityLevel: 'internal',
        lifecycleState: 'active',
        readPolicy: {
          maxFiles: 20,
          maxBytesPerFile: 32768,
        },
        description: 'MAS-owned knowledge documents.',
      },
      {
        sourceId: 'policies',
        sourceType: 'policies_directory',
        rootPath: 'memory/policies',
        scope: 'mas_instance',
        ownerId: masOwnerId,
        defaultPortability: 'not_exportable',
        defaultVisibility: 'shared_with_mas',
        defaultSensitivityLevel: 'internal',
        lifecycleState: 'active',
        readPolicy: {
          maxFiles: 20,
          maxBytesPerFile: 32768,
        },
        description: 'MAS-owned policy documents. Policy context has higher authority than runtime evidence.',
      },
      {
        sourceId: 'durable-memory',
        sourceType: 'durable_memory_directory',
        rootPath: 'memory/durable',
        scope: 'mas_instance',
        ownerId: masOwnerId,
        defaultPortability: 'not_exportable',
        defaultVisibility: 'shared_with_mas',
        defaultSensitivityLevel: 'internal',
        lifecycleState: 'active',
        readPolicy: DEFAULT_DURABLE_MEMORY_READ_POLICY,
        description: 'Approved durable MAS memory records. Context eligibility is decided by the Context Pack Builder.',
      },
      {
        sourceId: 'conversation-state',
        sourceType: 'conversation_state_directory',
        rootPath: 'memory/state/conversations',
        scope: 'mas_instance',
        ownerId: masOwnerId,
        defaultPortability: 'mas_bound',
        defaultVisibility: 'restricted',
        defaultSensitivityLevel: 'internal',
        lifecycleState: 'active',
        readPolicy: {
          maxFiles: 20,
          maxBytesPerFile: 65536,
        },
        description: 'Curated conversation runtime state. Conversation turns must enter prompts only through bounded Context Pack records.',
      },
    ],
  });
}
