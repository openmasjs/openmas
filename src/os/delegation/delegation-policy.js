import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { resolveBoundedChildPath } from '../../contracts/shared/bounded-path-contract.js';
import { assertOpenMasOsActionRequest } from '../../contracts/os/openmas-os-action-request-contract.js';
import { assertDelegationPolicy } from '../../contracts/os/delegation-policy-contract.js';

const DEFAULT_DELEGATION_POLICY_ROOT_PATH = path.join('instance', 'registries', 'delegation-policy.json');

function includesValue(ruleValues, expectedValue) {
  return ruleValues.includes('*') || ruleValues.includes(expectedValue);
}

function buildMatchedRule({ rule, actionRequest }) {
  return {
    ruleId: rule.ruleId,
    fromOperationalIdentityId: actionRequest.requestedBy.id,
    toOperationalIdentityId: actionRequest.payload.targetOperationalIdentityId,
    actionType: actionRequest.actionType,
    command: actionRequest.payload.command,
    mode: actionRequest.payload.mode,
  };
}

function matchDelegationPolicyRule({ rule, actionRequest }) {
  if (rule.effect !== 'allow') {
    return false;
  }

  return includesValue(rule.fromOperationalIdentityIds, actionRequest.requestedBy.id)
    && includesValue(rule.toOperationalIdentityIds, actionRequest.payload.targetOperationalIdentityId)
    && includesValue(rule.actionTypes, actionRequest.actionType)
    && includesValue(rule.commands, actionRequest.payload.command)
    && includesValue(rule.modes, actionRequest.payload.mode);
}

export function getDelegationPolicyAllowedRequesters(policy) {
  const delegationPolicy = assertDelegationPolicy(policy);
  const allowedRequesters = [];
  const seenRequesterIds = new Set();

  for (const rule of delegationPolicy.rules) {
    for (const fromOperationalIdentityId of rule.fromOperationalIdentityIds) {
      if (seenRequesterIds.has(fromOperationalIdentityId)) {
        continue;
      }

      seenRequesterIds.add(fromOperationalIdentityId);
      allowedRequesters.push({
        type: 'operational_identity',
        id: fromOperationalIdentityId,
      });
    }
  }

  return allowedRequesters;
}

export function evaluateDelegationPolicy({
  actionRequest,
  delegationPolicy,
} = {}) {
  const normalizedActionRequest = assertOpenMasOsActionRequest(actionRequest);

  if (normalizedActionRequest.requestedBy.type !== 'operational_identity') {
    return {
      authorized: false,
      effect: 'deny',
      reasonCode: 'requester_must_be_operational_identity',
      reason: 'Delegation policy only authorizes Operational Identities to request delegation.',
      matchedRule: null,
    };
  }

  if (delegationPolicy === undefined || delegationPolicy === null) {
    return {
      authorized: false,
      effect: 'deny',
      reasonCode: 'no_delegation_policy',
      reason: 'No OpenMAS delegation policy is configured for this OS action.',
      matchedRule: null,
    };
  }

  const normalizedPolicy = assertDelegationPolicy(delegationPolicy);

  for (const rule of normalizedPolicy.rules) {
    if (matchDelegationPolicyRule({ rule, actionRequest: normalizedActionRequest })) {
      return {
        authorized: true,
        effect: 'allow',
        reasonCode: 'allowed_by_delegation_policy_rule',
        reason: `Delegation from ${normalizedActionRequest.requestedBy.id} to ${normalizedActionRequest.payload.targetOperationalIdentityId} is allowed by policy rule ${rule.ruleId}.`,
        matchedRule: buildMatchedRule({
          rule,
          actionRequest: normalizedActionRequest,
        }),
      };
    }
  }

  return {
    authorized: false,
    effect: normalizedPolicy.defaultEffect,
    reasonCode: 'no_matching_delegation_policy_rule',
    reason: `No delegation policy rule allows ${normalizedActionRequest.requestedBy.id} to delegate ${normalizedActionRequest.actionType} to ${normalizedActionRequest.payload.targetOperationalIdentityId}.`,
    matchedRule: null,
  };
}

export async function readDelegationPolicy({
  projectRootPath,
  delegationPolicyRootPath = DEFAULT_DELEGATION_POLICY_ROOT_PATH,
} = {}) {
  const delegationPolicyPath = resolveBoundedChildPath({
    parentRootPath: projectRootPath,
    childRootPath: delegationPolicyRootPath,
    description: 'OpenMAS delegation policy path',
  });

  let fileContent;

  try {
    fileContent = await readFile(delegationPolicyPath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      return {
        delegationPolicyPath,
        delegationPolicy: null,
      };
    }

    throw error;
  }

  const parsedPolicy = JSON.parse(fileContent);
  const delegationPolicy = assertDelegationPolicy(parsedPolicy);

  return {
    delegationPolicyPath,
    delegationPolicy,
  };
}

export {
  DEFAULT_DELEGATION_POLICY_ROOT_PATH,
};
