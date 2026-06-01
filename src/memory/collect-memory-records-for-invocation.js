import { assertMemorySourceRegistry, selectActiveMemorySources } from '../contracts/memory/memory-source-registry-contract.js';
import { readMemorySourceRegistry } from './read-memory-source-registry.js';
import { readRuntimeStateMemory } from './read-runtime-state-memory.js';
import { readRuntimeArtifactMemory } from './read-runtime-artifact-memory.js';
import { readKnowledgeMemory } from './read-knowledge-memory.js';
import { readPolicyMemory } from './read-policy-memory.js';
import { readCognitiveIdentityMemory } from './read-cognitive-identity-memory.js';
import { readOperationalIdentityMemory } from './read-operational-identity-memory.js';
import { readDurableMemoryRecords } from './read-durable-memory-records.js';
import { readConversationMemory } from './read-conversation-memory.js';
import { readCognitiveIdentitiesRegistry } from '../invocation/read-cognitive-identities-registry.js';
import { readOperationalIdentitiesRegistry } from '../operational-identities/read-operational-identities-registry.js';

const INVOCATION_IDENTITY_MEMORY_READ_POLICY = {
  maxFiles: 20,
  maxBytesPerFile: 32768,
};

function normalizeRootPath(rootPath) {
  return rootPath.split(/[\\/]+/u).filter(Boolean).join('/');
}

function toSourceIdSegment(value) {
  return value.trim().replace(/[^A-Za-z0-9_-]+/gu, '-');
}

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => {
    return typeof value === 'string' && value.trim().length > 0;
  }).map((value) => value.trim()))];
}

function createCognitiveIdentityMemorySource({ cognitiveIdentityId, cognitiveIdentityRootPath }) {
  return {
    sourceId: `active-cognitive-${toSourceIdSegment(cognitiveIdentityId)}-memory`,
    sourceType: 'cognitive_identity_memory_directory',
    rootPath: `cognitive-identities/${normalizeRootPath(cognitiveIdentityRootPath)}/memory`,
    scope: 'cognitive_identity',
    ownerId: cognitiveIdentityId,
    defaultPortability: 'portable',
    defaultVisibility: 'shared_with_mas',
    defaultSensitivityLevel: 'internal',
    lifecycleState: 'active',
    readPolicy: INVOCATION_IDENTITY_MEMORY_READ_POLICY,
    description: `Invocation-scoped portable memory for active Cognitive Identity ${cognitiveIdentityId}.`,
  };
}

function createOperationalIdentityMemorySource({ operationalIdentityId, operationalIdentityRootPath }) {
  return {
    sourceId: `active-operational-${toSourceIdSegment(operationalIdentityId)}-memory`,
    sourceType: 'operational_identity_memory_directory',
    rootPath: `operational-identities/${normalizeRootPath(operationalIdentityRootPath)}/memory`,
    scope: 'operational_identity',
    ownerId: operationalIdentityId,
    defaultPortability: 'mas_bound',
    defaultVisibility: 'private_to_owner',
    defaultSensitivityLevel: 'internal',
    lifecycleState: 'active',
    readPolicy: INVOCATION_IDENTITY_MEMORY_READ_POLICY,
    description: `Invocation-scoped lived memory for active Operational Identity ${operationalIdentityId}.`,
  };
}

function hasEquivalentSource(memorySources, candidateSource) {
  return memorySources.some((sourceDefinition) => {
    return (
      sourceDefinition.sourceType === candidateSource.sourceType
      && sourceDefinition.rootPath === candidateSource.rootPath
      && sourceDefinition.scope === candidateSource.scope
      && sourceDefinition.ownerId === candidateSource.ownerId
    );
  });
}

function appendUniqueMemorySources(baseSources, dynamicSources) {
  const memorySources = [...baseSources];

  for (const dynamicSource of dynamicSources) {
    if (memorySources.some((sourceDefinition) => sourceDefinition.sourceId === dynamicSource.sourceId)) {
      continue;
    }

    if (hasEquivalentSource(memorySources, dynamicSource)) {
      continue;
    }

    memorySources.push(dynamicSource);
  }

  return memorySources;
}

function resolveActiveCognitiveIdentityIds(readiness) {
  return uniqueStrings([
    readiness?.activeCognitiveSet?.primaryCognitiveIdentityId,
    ...(readiness?.activeCognitiveSet?.secondaryCognitiveIdentityIds ?? []),
  ]);
}

function resolveOperationalIdentityId(readiness) {
  return readiness?.operationalIdentityDefinition?.operationalIdentityId
    ?? readiness?.resolvedOperationalIdentity?.operationalIdentityId
    ?? null;
}

async function resolveInvocationIdentityMemorySources({ masRootPath, readiness }) {
  const memorySources = [];
  const warnings = [];
  const activeCognitiveIdentityIds = resolveActiveCognitiveIdentityIds(readiness);

  if (activeCognitiveIdentityIds.length > 0) {
    try {
      const { registry } = await readCognitiveIdentitiesRegistry({ masRootPath });

      for (const cognitiveIdentityId of activeCognitiveIdentityIds) {
        const registryEntry = registry.cognitiveIdentities.find((entry) => entry.cognitiveIdentityId === cognitiveIdentityId);

        if (!registryEntry) {
          warnings.push(`Active Cognitive Identity memory source was not registered because no Cognitive Identity registry entry exists for ${cognitiveIdentityId}.`);
          continue;
        }

        memorySources.push(createCognitiveIdentityMemorySource({
          cognitiveIdentityId,
          cognitiveIdentityRootPath: registryEntry.rootPath,
        }));
      }
    } catch (error) {
      warnings.push(`Active Cognitive Identity memory sources could not be resolved: ${error.message}`);
    }
  }

  const operationalIdentityId = resolveOperationalIdentityId(readiness);

  if (operationalIdentityId) {
    try {
      const { registry } = await readOperationalIdentitiesRegistry({ masRootPath });
      const registryEntry = registry.operationalIdentities.find((entry) => {
        return entry.operationalIdentityId === operationalIdentityId;
      });

      if (registryEntry) {
        memorySources.push(createOperationalIdentityMemorySource({
          operationalIdentityId,
          operationalIdentityRootPath: registryEntry.rootPath,
        }));
      } else {
        warnings.push(`Operational Identity memory source was not registered because no registry entry exists for ${operationalIdentityId}.`);
      }
    } catch (error) {
      warnings.push(`Operational Identity memory source could not be resolved: ${error.message}`);
    }
  }

  return {
    memorySources,
    warnings,
  };
}

async function readSourceByType({ masRootPath, sourceDefinition, readiness }) {
  if (sourceDefinition.sourceType === 'state_directory') {
    return readRuntimeStateMemory({ masRootPath, sourceDefinition });
  }

  if (sourceDefinition.sourceType === 'artifacts_directory') {
    return readRuntimeArtifactMemory({ masRootPath, sourceDefinition });
  }

  if (sourceDefinition.sourceType === 'knowledge_directory') {
    return readKnowledgeMemory({ masRootPath, sourceDefinition });
  }

  if (sourceDefinition.sourceType === 'policies_directory') {
    return readPolicyMemory({ masRootPath, sourceDefinition });
  }

  if (sourceDefinition.sourceType === 'cognitive_identity_memory_directory') {
    return readCognitiveIdentityMemory({ masRootPath, sourceDefinition });
  }

  if (sourceDefinition.sourceType === 'operational_identity_memory_directory') {
    return readOperationalIdentityMemory({ masRootPath, sourceDefinition });
  }

  if (sourceDefinition.sourceType === 'durable_memory_directory') {
    const durableReadResult = await readDurableMemoryRecords({
      masRootPath,
      sourceDefinition,
      strict: false,
    });

    return {
      sourceId: sourceDefinition.sourceId,
      memoryRecords: durableReadResult.memoryRecords,
      warnings: durableReadResult.warnings,
      recordFiles: durableReadResult.recordFiles,
      summary: durableReadResult.summary,
    };
  }

  if (sourceDefinition.sourceType === 'conversation_state_directory') {
    return readConversationMemory({ masRootPath, sourceDefinition, readiness });
  }

  return {
    sourceId: sourceDefinition.sourceId,
    memoryRecords: [],
    warnings: [`Memory source ${sourceDefinition.sourceId} uses sourceType ${sourceDefinition.sourceType}, which is registered but not read by MC Slice 3.`],
  };
}

export async function collectMemoryRecordsForInvocation({
  masRootPath,
  memorySourceRegistry = null,
  masOwnerId = 'mas-instance',
  readiness = null,
} = {}) {
  let registry;
  let registryPath = null;
  let usedDefaultRegistry = false;
  let registryWarnings = [];

  if (memorySourceRegistry) {
    registry = assertMemorySourceRegistry(memorySourceRegistry);
  } else {
    const registryReadResult = await readMemorySourceRegistry({ masRootPath, masOwnerId });
    registry = registryReadResult.registry;
    registryPath = registryReadResult.registryPath;
    usedDefaultRegistry = registryReadResult.usedDefaultRegistry;
  }

  const invocationIdentityMemorySources = await resolveInvocationIdentityMemorySources({
    masRootPath,
    readiness,
  });

  registryWarnings = invocationIdentityMemorySources.warnings;
  registry = assertMemorySourceRegistry({
    ...registry,
    memorySources: appendUniqueMemorySources(
      registry.memorySources,
      invocationIdentityMemorySources.memorySources,
    ),
  });

  const activeSources = selectActiveMemorySources(registry);
  const sourceResults = [];
  const memoryRecords = [];
  const warnings = [...registryWarnings];

  for (const sourceDefinition of activeSources) {
    const sourceResult = await readSourceByType({ masRootPath, sourceDefinition, readiness });

    sourceResults.push(sourceResult);
    memoryRecords.push(...sourceResult.memoryRecords);
    warnings.push(...sourceResult.warnings);
  }

  return {
    registryPath,
    registry,
    usedDefaultRegistry,
    sourceResults,
    memoryRecords,
    warnings,
    summary: {
      sourcesRegistered: registry.memorySources.length,
      sourcesRead: activeSources.length,
      memoryRecordsCollected: memoryRecords.length,
      warnings: warnings.length,
    },
  };
}
