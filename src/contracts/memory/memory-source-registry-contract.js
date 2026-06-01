import { assertRelativeRegistryRootPath } from '../shared/bounded-path-contract.js';
import {
  MEMORY_PORTABILITY_VALUES,
  MEMORY_RECORD_SCOPES,
  MEMORY_VISIBILITY_VALUES,
} from './memory-record-contract.js';
import { MEMORY_SENSITIVITY_LEVELS } from './memory-source-reference-contract.js';

const MEMORY_SOURCE_REGISTRY_SOURCE_TYPES = new Set([
  'state_directory',
  'artifacts_directory',
  'knowledge_directory',
  'policies_directory',
  'cognitive_identity_memory_directory',
  'operational_identity_memory_directory',
  'team_memory_directory',
  'workflow_memory_directory',
  'durable_memory_directory',
  'conversation_state_directory',
]);

const MEMORY_SOURCE_LIFECYCLE_STATES = new Set([
  'active',
  'draft',
  'disabled',
]);

const DISALLOWED_ROOT_PATH_SEGMENTS = new Set([
  'config',
  'node_modules',
]);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function assertEnumValue(value, allowedValues, description) {
  if (!isNonEmptyString(value)) {
    throw new Error(`${description} must be a non-empty string.`);
  }

  const normalizedValue = value.trim();

  if (!allowedValues.has(normalizedValue)) {
    throw new Error(`${description} is invalid: ${normalizedValue}`);
  }

  return normalizedValue;
}

function assertPositiveInteger(value, description) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${description} must be a positive integer.`);
  }

  return value;
}

function assertMemorySourceRootPath(rootPath, description) {
  const safeRootPath = assertRelativeRegistryRootPath(rootPath, description);
  const normalizedRootPath = safeRootPath.split(/[\\/]+/).filter(Boolean).join('/');
  const segments = normalizedRootPath.split('/');

  const disallowedSegment = segments.find((segment) => DISALLOWED_ROOT_PATH_SEGMENTS.has(segment));

  if (disallowedSegment) {
    throw new Error(`${description} contains a disallowed path segment: ${disallowedSegment}`);
  }

  return normalizedRootPath;
}

function assertReadPolicy(readPolicy, description) {
  if (!isPlainObject(readPolicy)) {
    throw new Error(`${description} readPolicy must be an object.`);
  }

  return {
    maxFiles: assertPositiveInteger(readPolicy.maxFiles, `${description} readPolicy maxFiles`),
    maxBytesPerFile: assertPositiveInteger(readPolicy.maxBytesPerFile, `${description} readPolicy maxBytesPerFile`),
  };
}

export function assertMemorySourceDefinition(sourceDefinition, index = null) {
  const description = Number.isInteger(index)
    ? `Memory source registry memorySources[${index}]`
    : 'Memory source definition';

  if (!isPlainObject(sourceDefinition)) {
    throw new Error(`${description} must be an object.`);
  }

  if (!isNonEmptyString(sourceDefinition.sourceId)) {
    throw new Error(`${description} must include a non-empty sourceId.`);
  }

  if (!isNonEmptyString(sourceDefinition.ownerId)) {
    throw new Error(`${description} must include a non-empty ownerId.`);
  }

  return {
    sourceId: sourceDefinition.sourceId.trim(),
    sourceType: assertEnumValue(
      sourceDefinition.sourceType,
      MEMORY_SOURCE_REGISTRY_SOURCE_TYPES,
      `${description} sourceType`,
    ),
    rootPath: assertMemorySourceRootPath(sourceDefinition.rootPath, `${description} rootPath`),
    scope: assertEnumValue(sourceDefinition.scope, MEMORY_RECORD_SCOPES, `${description} scope`),
    ownerId: sourceDefinition.ownerId.trim(),
    defaultPortability: assertEnumValue(
      sourceDefinition.defaultPortability,
      MEMORY_PORTABILITY_VALUES,
      `${description} defaultPortability`,
    ),
    defaultVisibility: assertEnumValue(
      sourceDefinition.defaultVisibility,
      MEMORY_VISIBILITY_VALUES,
      `${description} defaultVisibility`,
    ),
    defaultSensitivityLevel: assertEnumValue(
      sourceDefinition.defaultSensitivityLevel,
      MEMORY_SENSITIVITY_LEVELS,
      `${description} defaultSensitivityLevel`,
    ),
    lifecycleState: assertEnumValue(
      sourceDefinition.lifecycleState,
      MEMORY_SOURCE_LIFECYCLE_STATES,
      `${description} lifecycleState`,
    ),
    readPolicy: assertReadPolicy(sourceDefinition.readPolicy, description),
    description: isNonEmptyString(sourceDefinition.description) ? sourceDefinition.description.trim() : null,
  };
}

export function assertMemorySourceRegistry(registry) {
  if (!isPlainObject(registry)) {
    throw new Error('Memory source registry must be an object.');
  }

  if (registry.kind !== 'memory_source_registry') {
    throw new Error('Memory source registry must include kind "memory_source_registry".');
  }

  if (!Number.isInteger(registry.version) || registry.version < 1) {
    throw new Error('Memory source registry must include an integer version greater than or equal to 1.');
  }

  if (!Array.isArray(registry.memorySources)) {
    throw new Error('Memory source registry must include a memorySources array.');
  }

  const seenSourceIds = new Set();
  const memorySources = registry.memorySources.map((sourceDefinition, index) => {
    const normalizedSourceDefinition = assertMemorySourceDefinition(sourceDefinition, index);

    if (seenSourceIds.has(normalizedSourceDefinition.sourceId)) {
      throw new Error(`Memory source registry contains a duplicated sourceId: ${normalizedSourceDefinition.sourceId}`);
    }

    seenSourceIds.add(normalizedSourceDefinition.sourceId);
    return normalizedSourceDefinition;
  });

  return {
    kind: registry.kind,
    version: registry.version,
    memorySources,
  };
}

export function selectActiveMemorySources(registry) {
  return assertMemorySourceRegistry(registry).memorySources.filter((sourceDefinition) => {
    return sourceDefinition.lifecycleState === 'active';
  });
}

export {
  MEMORY_SOURCE_LIFECYCLE_STATES,
  MEMORY_SOURCE_REGISTRY_SOURCE_TYPES,
};
