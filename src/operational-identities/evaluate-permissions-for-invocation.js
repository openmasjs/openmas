import { assertPermissionEvaluation } from '../contracts/access/permission-contract.js';

/**
 * Evaluates permissions for each resolved binding against the OI's permission policy.
 *
 * For each resolved binding, applies a three-gate check:
 *   Gate 1: Rule Match     — Does an allow rule exist for this resourceId + accessMode?
 *   Gate 2: Binding State  — Is the binding state "active"?
 *   Gate 3: Resource State — Is the resource lifecycle state "active"?
 *
 * Default effect is DENY. Only explicit allow rules grant access.
 *
 * This evaluator is designed for AI Agents living inside the MAS ecosystem.
 * Every decision includes a clear, human-and-AI-readable reason explaining
 * exactly why access was allowed or denied, so agents can understand their
 * own permission boundaries and act accordingly.
 */
export function evaluatePermissionsForInvocation({
  resolvedBindings,
  permissionDefinitions,
}) {
  if (!resolvedBindings || resolvedBindings.length === 0) {
    return assertPermissionEvaluation({
      evaluatedBindings: [],
      summary: {
        totalEvaluated: 0,
        allowed: 0,
        denied: 0,
      },
      allPermitted: true,
    });
  }

  if (!permissionDefinitions) {
    return assertPermissionEvaluation({
      evaluatedBindings: [],
      summary: {
        totalEvaluated: 0,
        allowed: 0,
        denied: 0,
      },
      allPermitted: true,
    });
  }

  const evaluatedBindings = [];
  let allowedCount = 0;
  let deniedCount = 0;

  for (const binding of resolvedBindings) {
    const matchedRule = findMatchingRule({
      rules: permissionDefinitions.rules,
      resourceId: binding.resourceId,
      accessMode: binding.accessMode,
    });

    // Gate 1: Rule Match
    if (!matchedRule || matchedRule.effect !== 'allow') {
      deniedCount++;
      evaluatedBindings.push({
        resourceId: binding.resourceId,
        accessMode: binding.accessMode,
        effect: 'deny',
        matchedRuleId: null,
        reason: `No allow rule found for resource ${binding.resourceId} with access mode ${binding.accessMode}. Default effect is ${permissionDefinitions.defaultEffect}.`,
      });
      continue;
    }

    // Gate 2: Binding State
    if (binding.bindingState !== 'active') {
      deniedCount++;
      evaluatedBindings.push({
        resourceId: binding.resourceId,
        accessMode: binding.accessMode,
        effect: 'deny',
        matchedRuleId: matchedRule.ruleId,
        reason: `Allow rule ${matchedRule.ruleId} matched, but binding state is not active: ${binding.bindingState}.`,
      });
      continue;
    }

    // Gate 3: Resource Lifecycle State
    if (binding.resourceLifecycleState !== 'active') {
      deniedCount++;
      evaluatedBindings.push({
        resourceId: binding.resourceId,
        accessMode: binding.accessMode,
        effect: 'deny',
        matchedRuleId: matchedRule.ruleId,
        reason: `Allow rule ${matchedRule.ruleId} matched, but resource lifecycle state is not active: ${binding.resourceLifecycleState}.`,
      });
      continue;
    }

    // All three gates passed — ALLOW
    allowedCount++;
    evaluatedBindings.push({
      resourceId: binding.resourceId,
      accessMode: binding.accessMode,
      effect: 'allow',
      matchedRuleId: matchedRule.ruleId,
      reason: `Explicit allow rule ${matchedRule.ruleId} matched for resource ${binding.resourceId} with access mode ${binding.accessMode}.`,
    });
  }

  const totalEvaluated = evaluatedBindings.length;

  return assertPermissionEvaluation({
    evaluatedBindings,
    summary: {
      totalEvaluated,
      allowed: allowedCount,
      denied: deniedCount,
    },
    allPermitted: deniedCount === 0,
  });
}

function findMatchingRule({ rules, resourceId, accessMode }) {
  for (const rule of rules) {
    if (rule.resourceId === resourceId && rule.accessModes.includes(accessMode)) {
      return rule;
    }
  }

  return null;
}
