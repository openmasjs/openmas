import { PERMISSION_ACCESS_MODES } from '../access/permission-contract.js';
import { assertActionIntentMetadata } from '../actions/action-intent-metadata-contract.js';

const TOOL_LIFECYCLE_STATES = new Set([
  'draft',
  'active',
  'disabled',
  'deprecated',
  'archived',
]);

const TOOL_TYPES = new Set([
  'local_js_module',
  'framework_builtin',
  'http_api',
  'provider_native_tool',
  'mcp_server_tool',
  'external_worker',
  'containerized_worker',
]);

const TOOL_SIDE_EFFECT_LEVELS = new Set([
  'read_only',
  'write_internal',
  'write_external',
  'publish_external',
  'financial',
  'destructive',
]);

const TOOL_PERMISSION_MODES = new Set([
  'tool.execute',
  'tool.read',
  'tool.write',
  'tool.publish',
  'tool.approve',
  'tool.administer',
]);

const TOOL_APPROVAL_REQUIRED_SIDE_EFFECT_LEVELS = new Set([
  'write_external',
  'publish_external',
  'financial',
  'destructive',
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

function assertStringArray(values, description, { allowEmpty = true, allowedValues = null } = {}) {
  if (!Array.isArray(values)) {
    throw new Error(`${description} must be an array.`);
  }

  if (!allowEmpty && values.length === 0) {
    throw new Error(`${description} must include at least one value.`);
  }

  const seenValues = new Set();

  return values.map((value, index) => {
    if (!isNonEmptyString(value)) {
      throw new Error(`${description}[${index}] must be a non-empty string.`);
    }

    const normalizedValue = value.trim();

    if (allowedValues && !allowedValues.has(normalizedValue)) {
      throw new Error(`${description}[${index}] is invalid: ${normalizedValue}`);
    }

    if (seenValues.has(normalizedValue)) {
      throw new Error(`${description} contains a duplicated value: ${normalizedValue}`);
    }

    seenValues.add(normalizedValue);
    return normalizedValue;
  });
}

function assertOptionalSchema(schema, description) {
  if (schema === undefined || schema === null) {
    return {};
  }

  if (!isPlainObject(schema)) {
    throw new Error(`${description} must be an object when provided.`);
  }

  return { ...schema };
}

function assertOptionalBoolean(value, description, defaultValue) {
  if (value === undefined || value === null) {
    return defaultValue;
  }

  if (typeof value !== 'boolean') {
    throw new Error(`${description} must be a boolean when provided.`);
  }

  return value;
}

function assertOptionalPositiveInteger(value, description, defaultValue = null) {
  if (value === undefined || value === null) {
    return defaultValue;
  }

  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${description} must be an integer greater than or equal to 1 when provided.`);
  }

  return value;
}

function assertRelativeModulePath(value, description) {
  if (!isNonEmptyString(value)) {
    throw new Error(`${description} must be a non-empty string.`);
  }

  const normalizedValue = value.trim().replaceAll('\\', '/');

  if (
    normalizedValue.startsWith('/')
    || /^[a-zA-Z]:\//u.test(normalizedValue)
    || normalizedValue.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    throw new Error(`${description} must be a bounded relative path inside the tool directory.`);
  }

  return normalizedValue;
}

function assertToolExecutionDefinition(execution, toolType) {
  if (execution === undefined || execution === null) {
    if (toolType === 'local_js_module') {
      throw new Error('Tool definition with toolType "local_js_module" must include execution.');
    }

    return {
      modulePath: null,
      timeoutMs: null,
      retryPolicy: {
        enabled: false,
      },
    };
  }

  if (!isPlainObject(execution)) {
    throw new Error('Tool definition execution must be an object when provided.');
  }

  const modulePath = execution.modulePath === undefined || execution.modulePath === null
    ? null
    : assertRelativeModulePath(execution.modulePath, 'Tool definition execution.modulePath');

  if (toolType === 'local_js_module' && !modulePath) {
    throw new Error('Tool definition with toolType "local_js_module" must include execution.modulePath.');
  }

  const retryPolicy = execution.retryPolicy === undefined || execution.retryPolicy === null
    ? { enabled: false }
    : (() => {
      if (!isPlainObject(execution.retryPolicy)) {
        throw new Error('Tool definition execution.retryPolicy must be an object when provided.');
      }

      return {
        enabled: assertOptionalBoolean(execution.retryPolicy.enabled, 'Tool definition execution.retryPolicy.enabled', false),
        maxAttempts: assertOptionalPositiveInteger(
          execution.retryPolicy.maxAttempts,
          'Tool definition execution.retryPolicy.maxAttempts',
          null,
        ),
      };
    })();

  if (retryPolicy.enabled && retryPolicy.maxAttempts === null) {
    throw new Error('Tool definition execution.retryPolicy.maxAttempts is required when retryPolicy.enabled is true.');
  }

  return {
    modulePath,
    timeoutMs: assertOptionalPositiveInteger(execution.timeoutMs, 'Tool definition execution.timeoutMs', null),
    retryPolicy,
  };
}

function assertToolApprovalPolicy(approvalPolicy, sideEffectLevel) {
  const normalizedApprovalPolicy = approvalPolicy === undefined || approvalPolicy === null
    ? { required: false, requiredForSideEffectLevels: [] }
    : (() => {
      if (!isPlainObject(approvalPolicy)) {
        throw new Error('Tool definition approvalPolicy must be an object when provided.');
      }

      return {
        required: assertOptionalBoolean(approvalPolicy.required, 'Tool definition approvalPolicy.required', false),
        requiredForSideEffectLevels: assertStringArray(
          approvalPolicy.requiredForSideEffectLevels ?? [],
          'Tool definition approvalPolicy.requiredForSideEffectLevels',
          { allowedValues: TOOL_SIDE_EFFECT_LEVELS },
        ),
      };
    })();

  if (
    TOOL_APPROVAL_REQUIRED_SIDE_EFFECT_LEVELS.has(sideEffectLevel)
    && normalizedApprovalPolicy.required !== true
  ) {
    throw new Error(`Tool definition with sideEffectLevel "${sideEffectLevel}" must require approval.`);
  }

  return normalizedApprovalPolicy;
}

function assertToolArtifactPolicy(artifactPolicy) {
  if (artifactPolicy === undefined || artifactPolicy === null) {
    return {
      persistResult: false,
    };
  }

  if (!isPlainObject(artifactPolicy)) {
    throw new Error('Tool definition artifactPolicy must be an object when provided.');
  }

  return {
    persistResult: assertOptionalBoolean(artifactPolicy.persistResult, 'Tool definition artifactPolicy.persistResult', false),
  };
}

function assertToolMemoryPolicy(memoryPolicy) {
  if (memoryPolicy === undefined || memoryPolicy === null) {
    return {
      allowWritebackCandidates: false,
    };
  }

  if (!isPlainObject(memoryPolicy)) {
    throw new Error('Tool definition memoryPolicy must be an object when provided.');
  }

  return {
    allowWritebackCandidates: assertOptionalBoolean(
      memoryPolicy.allowWritebackCandidates,
      'Tool definition memoryPolicy.allowWritebackCandidates',
      false,
    ),
  };
}

export function toolDefinitionRequiresApproval(definition) {
  const normalizedDefinition = assertToolDefinition(definition);

  return (
    normalizedDefinition.approvalPolicy.required
    || TOOL_APPROVAL_REQUIRED_SIDE_EFFECT_LEVELS.has(normalizedDefinition.sideEffectLevel)
  );
}

export function assertToolDefinition(definition) {
  if (!isPlainObject(definition)) {
    throw new Error('Tool definition must be an object.');
  }

  if (definition.kind !== 'tool_definition') {
    throw new Error('Tool definition must include kind "tool_definition".');
  }

  if (!Number.isInteger(definition.version) || definition.version < 1) {
    throw new Error('Tool definition must include an integer version greater than or equal to 1.');
  }

  if (!isNonEmptyString(definition.toolId)) {
    throw new Error('Tool definition must include a non-empty toolId.');
  }

  if (!isNonEmptyString(definition.displayName)) {
    throw new Error('Tool definition must include a non-empty displayName.');
  }

  if (!isNonEmptyString(definition.owner)) {
    throw new Error('Tool definition must include a non-empty owner.');
  }

  const toolType = assertEnumValue(definition.toolType, TOOL_TYPES, 'Tool definition toolType');
  const sideEffectLevel = assertEnumValue(
    definition.sideEffectLevel,
    TOOL_SIDE_EFFECT_LEVELS,
    'Tool definition sideEffectLevel',
  );

  return {
    kind: definition.kind,
    version: definition.version,
    toolId: definition.toolId.trim(),
    displayName: definition.displayName.trim(),
    description: isNonEmptyString(definition.description) ? definition.description.trim() : null,
    lifecycleState: assertEnumValue(
      definition.lifecycleState,
      TOOL_LIFECYCLE_STATES,
      'Tool definition lifecycleState',
    ),
    owner: definition.owner.trim(),
    toolType,
    sideEffectLevel,
    inputSchema: assertOptionalSchema(definition.inputSchema, 'Tool definition inputSchema'),
    outputSchema: assertOptionalSchema(definition.outputSchema, 'Tool definition outputSchema'),
    requiredResourceTypes: assertStringArray(
      definition.requiredResourceTypes ?? [],
      'Tool definition requiredResourceTypes',
    ),
    requiredAccessModes: assertStringArray(
      definition.requiredAccessModes ?? [],
      'Tool definition requiredAccessModes',
      { allowedValues: PERMISSION_ACCESS_MODES },
    ),
    requiredPermissionModes: assertStringArray(
      definition.requiredPermissionModes ?? [],
      'Tool definition requiredPermissionModes',
      { allowedValues: TOOL_PERMISSION_MODES },
    ),
    approvalPolicy: assertToolApprovalPolicy(definition.approvalPolicy, sideEffectLevel),
    execution: assertToolExecutionDefinition(definition.execution, toolType),
    artifactPolicy: assertToolArtifactPolicy(definition.artifactPolicy),
    memoryPolicy: assertToolMemoryPolicy(definition.memoryPolicy),
    intentMetadata: assertActionIntentMetadata(definition.intentMetadata, {
      targetType: 'tool',
      targetActionType: 'tool_execution',
      targetId: definition.toolId.trim(),
      expectedSideEffectLevel: sideEffectLevel,
    }),
  };
}

export function isToolActive(definition) {
  return assertToolDefinition(definition).lifecycleState === 'active';
}

export {
  TOOL_APPROVAL_REQUIRED_SIDE_EFFECT_LEVELS,
  TOOL_LIFECYCLE_STATES,
  TOOL_PERMISSION_MODES,
  TOOL_SIDE_EFFECT_LEVELS,
  TOOL_TYPES,
};
