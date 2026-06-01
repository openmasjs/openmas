import path from 'node:path';
import { access } from 'node:fs/promises';
import { resolveCognitiveIdentityRoot } from '../../invocation/resolve-cognitive-identity-root.js';
import { readCognitiveIdentityDefinition } from '../../invocation/read-cognitive-identity-definition.js';
import { resolveOperationalIdentityRoot } from '../../operational-identities/resolve-operational-identity-root.js';
import { readOperationalIdentityDefinition } from '../../operational-identities/read-operational-identity-definition.js';
import { readOperationalIdentityRoutingDefinition } from '../../operational-identities/read-operational-identity-routing-definition.js';
import { readExecutionProfileDefinition } from '../../operational-identities/read-execution-profile-definition.js';
import { resolveActiveCognitiveSet } from '../../operational-identities/resolve-active-cognitive-set.js';
import {
  getExecutionModeCompatibilityError,
  selectBrainForInvocation,
} from '../../operational-identities/select-brain-for-invocation.js';

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeOptionalString(value) {
  return isNonEmptyString(value) ? value.trim() : null;
}

async function pathExists(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function resolveMasRootPath({ projectRootPath = null, osRootPath = null } = {}) {
  if (isNonEmptyString(projectRootPath)) {
    return path.join(projectRootPath.trim(), 'instance');
  }

  if (isNonEmptyString(osRootPath)) {
    return path.dirname(osRootPath.trim());
  }

  return null;
}

function buildReadinessResult({
  ready,
  status,
  reasonCode,
  reason,
  targetOperationalIdentityId = null,
  command = null,
  mode = null,
  resolvedPrimaryCognitiveIdentityId = null,
  operationalIdentityLifecycleState = null,
  executionProfileId = null,
  executionMode = null,
  activeCognitiveSet = null,
  brainSelection = null,
  warnings = [],
}) {
  return {
    ready,
    status,
    reasonCode,
    reason,
    targetOperationalIdentityId,
    command,
    mode,
    resolvedPrimaryCognitiveIdentityId,
    operationalIdentityLifecycleState,
    executionProfileId,
    executionMode,
    activeCognitiveSet,
    brainSelection,
    warnings,
  };
}

function buildBlockedReadiness({
  reasonCode,
  reason,
  request,
  targetOperationalIdentityId,
  operationalIdentityDefinition = null,
  executionProfileDefinition = null,
  activeCognitiveSet = null,
  warnings = [],
}) {
  return buildReadinessResult({
    ready: false,
    status: 'blocked',
    reasonCode,
    reason,
    targetOperationalIdentityId,
    command: request.command,
    mode: request.invocationMode,
    resolvedPrimaryCognitiveIdentityId: activeCognitiveSet?.primaryCognitiveIdentityId ?? null,
    operationalIdentityLifecycleState: operationalIdentityDefinition?.lifecycleState ?? null,
    executionProfileId: executionProfileDefinition?.executionProfileId ?? null,
    executionMode: executionProfileDefinition?.executionMode ?? null,
    activeCognitiveSet,
    warnings,
  });
}

function buildUnverifiedReadiness({
  reasonCode,
  reason,
  request,
  targetOperationalIdentityId,
}) {
  return buildReadinessResult({
    ready: true,
    status: 'unverified',
    reasonCode,
    reason,
    targetOperationalIdentityId,
    command: request.command,
    mode: request.invocationMode,
    warnings: [reason],
  });
}

function resolveChildRequest({
  systemCall = null,
  targetOperationalIdentityId = null,
  command = null,
  mode = null,
} = {}) {
  const child = systemCall?.payload?.child ?? {};

  return {
    targetOperationalIdentityId: normalizeOptionalString(
      targetOperationalIdentityId
        ?? systemCall?.payload?.targetOperationalIdentityId,
    ),
    command: normalizeOptionalString(command ?? child.command) ?? 'ask',
    invocationMode: normalizeOptionalString(mode ?? child.mode) ?? 'probabilistic',
  };
}

function summarizeBrainSelection(brainSelection) {
  if (!brainSelection) {
    return null;
  }

  return {
    selectedBrainId: brainSelection.selectedBrain?.brainId ?? null,
    selectedProviderId: brainSelection.selectedBrain?.providerId ?? null,
    selectedModelId: brainSelection.selectedBrain?.modelId ?? null,
    fallbackBrainId: brainSelection.fallbackBrain?.brainId ?? null,
    brainRequired: brainSelection.brainRequired,
  };
}

function findRoutingOwnershipError({
  operationalIdentityDefinition,
  routingDefinition,
}) {
  if (!routingDefinition) {
    return null;
  }

  const attachedCognitiveIdentityIds = new Set(
    operationalIdentityDefinition.attachedCognitiveIdentities.map((entry) => {
      return entry.cognitiveIdentityId;
    }),
  );
  const defaultPrimaryCognitiveIdentityId = routingDefinition.defaultPrimaryCognitiveIdentityId;

  if (
    isNonEmptyString(defaultPrimaryCognitiveIdentityId)
    && !attachedCognitiveIdentityIds.has(defaultPrimaryCognitiveIdentityId)
  ) {
    return `Operational Identity ${operationalIdentityDefinition.operationalIdentityId} routing default primary cognitive identity is not attached: ${defaultPrimaryCognitiveIdentityId}`;
  }

  for (const commandRoute of routingDefinition.commandRoutes) {
    if (!attachedCognitiveIdentityIds.has(commandRoute.primaryCognitiveIdentityId)) {
      return `Operational Identity ${operationalIdentityDefinition.operationalIdentityId} routing command "${commandRoute.command}" primary cognitive identity is not attached: ${commandRoute.primaryCognitiveIdentityId}`;
    }

    for (const secondaryCognitiveIdentityId of commandRoute.secondaryCognitiveIdentityIds) {
      if (!attachedCognitiveIdentityIds.has(secondaryCognitiveIdentityId)) {
        return `Operational Identity ${operationalIdentityDefinition.operationalIdentityId} routing command "${commandRoute.command}" secondary cognitive identity is not attached: ${secondaryCognitiveIdentityId}`;
      }
    }
  }

  return null;
}

export async function evaluateDelegationTargetReadiness({
  projectRootPath = null,
  osRootPath = null,
  systemCall = null,
  targetOperationalIdentityId = null,
  command = null,
  mode = null,
} = {}) {
  const request = resolveChildRequest({
    systemCall,
    targetOperationalIdentityId,
    command,
    mode,
  });

  if (!isNonEmptyString(request.targetOperationalIdentityId)) {
    return buildBlockedReadiness({
      reasonCode: 'target_operational_identity_missing',
      reason: 'Delegation target readiness requires a target Operational Identity.',
      request,
      targetOperationalIdentityId: null,
    });
  }

  const masRootPath = resolveMasRootPath({ projectRootPath, osRootPath });

  if (!isNonEmptyString(masRootPath)) {
    return buildUnverifiedReadiness({
      reasonCode: 'target_readiness_unverified_missing_mas_root',
      reason: 'Delegation target readiness could not be verified because no MAS root path was provided.',
      request,
      targetOperationalIdentityId: request.targetOperationalIdentityId,
    });
  }

  const operationalIdentitiesRegistryPath = path.join(
    masRootPath,
    'registries',
    'operational-identities.json',
  );

  if (!(await pathExists(operationalIdentitiesRegistryPath))) {
    return buildUnverifiedReadiness({
      reasonCode: 'target_readiness_unverified_missing_operational_identity_registry',
      reason: 'Delegation target readiness could not be verified because no Operational Identity registry exists.',
      request,
      targetOperationalIdentityId: request.targetOperationalIdentityId,
    });
  }

  try {
    const operationalIdentityRoot = await resolveOperationalIdentityRoot({
      masRootPath,
      operationalIdentityId: request.targetOperationalIdentityId,
    });
    const operationalIdentityRead = await readOperationalIdentityDefinition({
      operationalIdentityRootPath: operationalIdentityRoot.operationalIdentityRootPath,
    });
    const operationalIdentityDefinition = operationalIdentityRead.definition;
    const routingRead = await readOperationalIdentityRoutingDefinition({
      operationalIdentityRootPath: operationalIdentityRoot.operationalIdentityRootPath,
    });
    const executionProfileRead = await readExecutionProfileDefinition({
      operationalIdentityRootPath: operationalIdentityRoot.operationalIdentityRootPath,
      expectedExecutionProfileId: operationalIdentityDefinition.executionProfileId,
    });
    const executionProfileDefinition = executionProfileRead.definition;

    if (operationalIdentityDefinition.lifecycleState !== 'active') {
      return buildBlockedReadiness({
        reasonCode: 'target_operational_identity_not_active',
        reason: `Delegation target ${request.targetOperationalIdentityId} is not active (${operationalIdentityDefinition.lifecycleState}).`,
        request,
        targetOperationalIdentityId: request.targetOperationalIdentityId,
        operationalIdentityDefinition,
        executionProfileDefinition,
      });
    }

    const routingOwnershipError = findRoutingOwnershipError({
      operationalIdentityDefinition,
      routingDefinition: routingRead.definition,
    });

    if (routingOwnershipError) {
      return buildBlockedReadiness({
        reasonCode: 'target_routing_references_unattached_cognitive_identity',
        reason: routingOwnershipError,
        request,
        targetOperationalIdentityId: request.targetOperationalIdentityId,
        operationalIdentityDefinition,
        executionProfileDefinition,
      });
    }

    const activeCognitiveSet = resolveActiveCognitiveSet({
      request,
      operationalIdentityDefinition,
      routingDefinition: routingRead.definition,
    });
    const executionModeCompatibilityError = getExecutionModeCompatibilityError({
      executionProfileDefinition,
      request,
    });

    if (executionModeCompatibilityError) {
      return buildBlockedReadiness({
        reasonCode: 'target_execution_mode_not_supported',
        reason: executionModeCompatibilityError,
        request,
        targetOperationalIdentityId: request.targetOperationalIdentityId,
        operationalIdentityDefinition,
        executionProfileDefinition,
        activeCognitiveSet,
      });
    }

    let brainSelection;

    try {
      brainSelection = selectBrainForInvocation({
        executionProfileDefinition,
        request,
      });
    } catch (error) {
      return buildBlockedReadiness({
        reasonCode: 'target_command_not_enabled',
        reason: error.message,
        request,
        targetOperationalIdentityId: request.targetOperationalIdentityId,
        operationalIdentityDefinition,
        executionProfileDefinition,
        activeCognitiveSet,
      });
    }

    const resolvedCognitiveIdentity = await resolveCognitiveIdentityRoot({
      masRootPath,
      cognitiveIdentityId: activeCognitiveSet.primaryCognitiveIdentityId,
    });
    const cognitiveIdentityDefinition = await readCognitiveIdentityDefinition({
      cognitiveIdentityRootPath: resolvedCognitiveIdentity.cognitiveIdentityRootPath,
    });

    if (cognitiveIdentityDefinition.missingRequiredComponents.length > 0) {
      return buildBlockedReadiness({
        reasonCode: 'target_cognitive_identity_missing_required_components',
        reason: `Delegation target ${request.targetOperationalIdentityId} resolved to cognitive identity ${resolvedCognitiveIdentity.cognitiveIdentityId}, but required components are missing: ${cognitiveIdentityDefinition.missingRequiredComponents.join(', ')}.`,
        request,
        targetOperationalIdentityId: request.targetOperationalIdentityId,
        operationalIdentityDefinition,
        executionProfileDefinition,
        activeCognitiveSet,
      });
    }

    return buildReadinessResult({
      ready: true,
      status: 'ready',
      reasonCode: 'target_ready_for_delegation',
      reason: `Delegation target ${request.targetOperationalIdentityId} is ready for ${request.invocationMode} ${request.command}.`,
      targetOperationalIdentityId: request.targetOperationalIdentityId,
      command: request.command,
      mode: request.invocationMode,
      resolvedPrimaryCognitiveIdentityId: resolvedCognitiveIdentity.cognitiveIdentityId,
      operationalIdentityLifecycleState: operationalIdentityDefinition.lifecycleState,
      executionProfileId: executionProfileDefinition.executionProfileId,
      executionMode: executionProfileDefinition.executionMode,
      activeCognitiveSet,
      brainSelection: summarizeBrainSelection(brainSelection),
      warnings: cognitiveIdentityDefinition.missingOptionalComponents.map((component) => {
        return `Optional target cognitive identity component is missing: ${component}`;
      }),
    });
  } catch (error) {
    return buildBlockedReadiness({
      reasonCode: 'target_readiness_check_failed',
      reason: `Delegation target ${request.targetOperationalIdentityId} is not ready: ${error.message}`,
      request,
      targetOperationalIdentityId: request.targetOperationalIdentityId,
    });
  }
}
