import { readDelegationPolicy } from '../os/delegation/delegation-policy.js';
import { resolveOperationalIdentityRoot } from '../operational-identities/resolve-operational-identity-root.js';
import { readOperationalIdentityDefinition } from '../operational-identities/read-operational-identity-definition.js';

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function includesPolicyValue(values, expectedValue) {
  return Array.isArray(values)
    && (values.includes('*') || values.includes(expectedValue));
}

function currentOperationalIdentityId(readiness) {
  return readiness?.operationalIdentityDefinition?.operationalIdentityId ?? null;
}

function actionRuleAppliesToCurrentInvocation({
  rule,
  requesterOperationalIdentityId,
  request,
}) {
  return rule.effect === 'allow'
    && includesPolicyValue(rule.fromOperationalIdentityIds, requesterOperationalIdentityId)
    && includesPolicyValue(rule.actionTypes, 'delegate')
    && includesPolicyValue(rule.commands, request.command)
    && includesPolicyValue(rule.modes, request.invocationMode);
}

async function readTargetOperationalIdentity({
  masRootPath,
  operationalIdentityId,
}) {
  const rootResolution = await resolveOperationalIdentityRoot({
    masRootPath,
    operationalIdentityId,
  });
  const definitionResolution = await readOperationalIdentityDefinition({
    operationalIdentityRootPath: rootResolution.operationalIdentityRootPath,
  });

  return {
    registryEntry: rootResolution.registryEntry,
    definition: definitionResolution.definition,
    definitionPath: definitionResolution.definitionPath,
  };
}

function summarizeOperationalIdentityDefinition(definition) {
  return {
    operationalIdentityId: definition.operationalIdentityId,
    displayName: definition.displayName,
    lifecycleState: definition.lifecycleState,
    roleLabel: definition.persona?.roleLabel ?? null,
    operationalScope: definition.persona?.operationalScope ?? [],
    attachedCognitiveIdentityIds: (definition.attachedCognitiveIdentities ?? []).map((entry) => {
      return entry.cognitiveIdentityId;
    }),
  };
}

export async function resolveOpenMasOsDelegationContextForInvocation({
  bootResult,
  readiness,
  request,
} = {}) {
  const warnings = [];
  const requesterOperationalIdentityId = currentOperationalIdentityId(readiness);

  if (!isNonEmptyString(bootResult?.projectRootPath) || !isNonEmptyString(bootResult?.masRootPath)) {
    return {
      allowedDelegationTargets: [],
      warnings: ['OpenMAS OS delegation context could not be resolved because boot paths are missing.'],
    };
  }

  if (!isNonEmptyString(requesterOperationalIdentityId)) {
    return {
      allowedDelegationTargets: [],
      warnings: ['OpenMAS OS delegation context could not be resolved because the requester Operational Identity is missing.'],
    };
  }

  const { delegationPolicy } = await readDelegationPolicy({
    projectRootPath: bootResult.projectRootPath,
  });

  if (!delegationPolicy) {
    return {
      allowedDelegationTargets: [],
      warnings: [],
    };
  }

  const allowedDelegationTargets = [];
  const seenTargetIds = new Set();

  for (const rule of delegationPolicy.rules) {
    if (!actionRuleAppliesToCurrentInvocation({
      rule,
      requesterOperationalIdentityId,
      request,
    })) {
      continue;
    }

    for (const targetOperationalIdentityId of rule.toOperationalIdentityIds) {
      if (targetOperationalIdentityId === '*' || seenTargetIds.has(targetOperationalIdentityId)) {
        continue;
      }

      seenTargetIds.add(targetOperationalIdentityId);

      try {
        const targetIdentity = await readTargetOperationalIdentity({
          masRootPath: bootResult.masRootPath,
          operationalIdentityId: targetOperationalIdentityId,
        });

        allowedDelegationTargets.push({
          ruleId: rule.ruleId,
          description: rule.description,
          actionTypes: rule.actionTypes,
          commands: rule.commands,
          modes: rule.modes,
          target: summarizeOperationalIdentityDefinition(targetIdentity.definition),
        });
      } catch (error) {
        warnings.push(
          `OpenMAS OS delegation target ${targetOperationalIdentityId} is allowed by rule ${rule.ruleId}, but its Operational Identity definition could not be resolved: ${error.message}`,
        );
      }
    }
  }

  return {
    allowedDelegationTargets,
    warnings,
  };
}
