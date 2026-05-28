import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluatePermissionsForInvocation } from '../../src/operational-identities/evaluate-permissions-for-invocation.js';
import { evaluateToolReadinessForInvocation } from '../../src/tools/evaluate-tool-readiness-for-invocation.js';

function buildToolDefinition(overrides = {}) {
  return {
    kind: 'tool_definition',
    version: 1,
    toolId: 'mas.system.inspect',
    displayName: 'MAS System Inspect',
    description: 'Inspects safe MAS system state.',
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
    requiredResourceTypes: ['storage'],
    requiredAccessModes: ['read'],
    requiredPermissionModes: ['tool.execute'],
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
      allowWritebackCandidates: true,
    },
    ...overrides,
  };
}

function buildResolvedBinding(overrides = {}) {
  return {
    resourceId: 'mas-filesystem',
    accessMode: 'read',
    bindingState: 'active',
    secretReferenceId: null,
    resourceType: 'storage',
    resourceDisplayName: 'MAS Filesystem',
    ownershipScope: 'shared',
    resourceLifecycleState: 'active',
    ...overrides,
  };
}

function buildPermissionDefinitions({ rules } = {}) {
  return {
    kind: 'operational_identity_permissions',
    version: 1,
    operationalIdentityId: 'alfred',
    defaultEffect: 'deny',
    rules: rules ?? [
      {
        ruleId: 'allow-mas-filesystem-read',
        effect: 'allow',
        resourceId: 'mas-filesystem',
        accessModes: ['read'],
      },
    ],
  };
}

function buildPermissionEvaluation({
  resolvedBindings = [buildResolvedBinding()],
  permissionDefinitions = buildPermissionDefinitions(),
} = {}) {
  return evaluatePermissionsForInvocation({
    resolvedBindings,
    permissionDefinitions,
  });
}

function buildSecretResolution({ status = 'resolved', secretReferenceId = 'meta-token' } = {}) {
  return {
    resolvedSecretReferences: [
      {
        resourceId: 'meta-channel',
        secretReferenceId,
        secretType: 'access_token',
        resolutionStatus: status,
        reason: status === 'resolved'
          ? 'Credential vault secret resolved successfully.'
          : 'Credential vault secret is not configured.',
        hasSecretValue: status === 'resolved',
      },
    ],
    summary: {
      totalReferenced: 1,
      resolved: status === 'resolved' ? 1 : 0,
      unresolved: status === 'resolved' ? 0 : 1,
      missingDefinitions: 0,
    },
    warnings: [],
    secretValueByReferenceId: new Map([
      [secretReferenceId, 'SECRET_VALUE_SHOULD_NOT_LEAK'],
    ]),
  };
}

test('evaluateToolReadinessForInvocation marks a read-only internal tool as ready', () => {
  const resolvedBindings = [buildResolvedBinding()];
  const evaluation = evaluateToolReadinessForInvocation({
    toolDefinitions: [buildToolDefinition()],
    resolvedBindings,
    permissionEvaluation: buildPermissionEvaluation({ resolvedBindings }),
  });
  const verdict = evaluation.evaluatedTools[0];

  assert.equal(verdict.toolId, 'mas.system.inspect');
  assert.equal(verdict.status, 'ready');
  assert.equal(verdict.approvalRequired, false);
  assert.equal(verdict.matchedBindings.length, 1);
  assert.equal(verdict.matchedBindings[0].resourceId, 'mas-filesystem');
  assert.equal(evaluation.summary.ready, 1);
});

test('evaluateToolReadinessForInvocation marks risky ready tools as approval_required', () => {
  const resolvedBindings = [
    buildResolvedBinding({
      resourceId: 'meta-channel',
      accessMode: 'publish',
      secretReferenceId: 'meta-token',
      resourceType: 'channel',
      resourceDisplayName: 'Meta Channel',
    }),
  ];
  const permissionEvaluation = buildPermissionEvaluation({
    resolvedBindings,
    permissionDefinitions: buildPermissionDefinitions({
      rules: [
        {
          ruleId: 'allow-meta-publish',
          effect: 'allow',
          resourceId: 'meta-channel',
          accessModes: ['publish'],
        },
      ],
    }),
  });
  const evaluation = evaluateToolReadinessForInvocation({
    toolDefinitions: [
      buildToolDefinition({
        toolId: 'meta.reply.publish',
        displayName: 'Meta Reply Publish',
        sideEffectLevel: 'publish_external',
        requiredResourceTypes: ['channel'],
        requiredAccessModes: ['publish'],
        approvalPolicy: {
          required: true,
        },
      }),
    ],
    resolvedBindings,
    permissionEvaluation,
    secretResolution: buildSecretResolution(),
  });
  const serializedEvaluation = JSON.stringify(evaluation);
  const verdict = evaluation.evaluatedTools[0];

  assert.equal(verdict.status, 'approval_required');
  assert.equal(verdict.approvalRequired, true);
  assert.equal(verdict.matchedBindings[0].secretReferenceId, 'meta-token');
  assert.equal(verdict.matchedBindings[0].secretResolutionStatus, 'resolved');
  assert.equal(serializedEvaluation.includes('SECRET_VALUE_SHOULD_NOT_LEAK'), false);
  assert.equal(evaluation.summary.approvalRequired, 1);
});

test('evaluateToolReadinessForInvocation denies tools when no usable binding satisfies requirements', () => {
  const resolvedBindings = [
    buildResolvedBinding({
      resourceId: 'mas-filesystem',
      accessMode: 'read',
      resourceType: 'storage',
    }),
  ];
  const evaluation = evaluateToolReadinessForInvocation({
    toolDefinitions: [
      buildToolDefinition({
        toolId: 'meta.comments.read',
        displayName: 'Meta Comments Read',
        requiredResourceTypes: ['channel'],
        requiredAccessModes: ['read'],
      }),
    ],
    resolvedBindings,
    permissionEvaluation: buildPermissionEvaluation({ resolvedBindings }),
  });
  const verdict = evaluation.evaluatedTools[0];

  assert.equal(verdict.status, 'denied');
  assert.match(verdict.reason, /required bindings are not usable/u);
  assert.match(verdict.missingRequirements[0].reason, /No resolved binding satisfies resourceType "channel"/u);
});

test('evaluateToolReadinessForInvocation surfaces permission denial reasons', () => {
  const resolvedBindings = [buildResolvedBinding()];
  const permissionEvaluation = buildPermissionEvaluation({
    resolvedBindings,
    permissionDefinitions: buildPermissionDefinitions({
      rules: [],
    }),
  });
  const evaluation = evaluateToolReadinessForInvocation({
    toolDefinitions: [buildToolDefinition()],
    resolvedBindings,
    permissionEvaluation,
  });
  const verdict = evaluation.evaluatedTools[0];

  assert.equal(verdict.status, 'denied');
  assert.match(verdict.missingRequirements[0].reason, /No allow rule found/u);
});

test('evaluateToolReadinessForInvocation marks tools unavailable when required secrets are unresolved', () => {
  const resolvedBindings = [
    buildResolvedBinding({
      resourceId: 'meta-channel',
      accessMode: 'read',
      secretReferenceId: 'meta-token',
      resourceType: 'channel',
      resourceDisplayName: 'Meta Channel',
    }),
  ];
  const permissionEvaluation = buildPermissionEvaluation({
    resolvedBindings,
    permissionDefinitions: buildPermissionDefinitions({
      rules: [
        {
          ruleId: 'allow-meta-read',
          effect: 'allow',
          resourceId: 'meta-channel',
          accessModes: ['read'],
        },
      ],
    }),
  });
  const evaluation = evaluateToolReadinessForInvocation({
    toolDefinitions: [
      buildToolDefinition({
        toolId: 'meta.comments.read',
        displayName: 'Meta Comments Read',
        requiredResourceTypes: ['channel'],
        requiredAccessModes: ['read'],
      }),
    ],
    resolvedBindings,
    permissionEvaluation,
    secretResolution: buildSecretResolution({ status: 'unresolved' }),
  });
  const verdict = evaluation.evaluatedTools[0];

  assert.equal(verdict.status, 'unavailable');
  assert.equal(verdict.matchedBindings[0].secretResolutionStatus, 'unresolved');
  assert.match(verdict.missingRequirements[0].reason, /Secret Reference meta-token is not resolved/u);
});

test('evaluateToolReadinessForInvocation marks inactive tools as unavailable', () => {
  const evaluation = evaluateToolReadinessForInvocation({
    toolDefinitions: [
      buildToolDefinition({
        lifecycleState: 'disabled',
      }),
    ],
    resolvedBindings: [buildResolvedBinding()],
    permissionEvaluation: buildPermissionEvaluation(),
  });
  const verdict = evaluation.evaluatedTools[0];

  assert.equal(verdict.status, 'unavailable');
  assert.match(verdict.reason, /lifecycle state is not active/u);
});

test('evaluateToolReadinessForInvocation keeps deterministic summaries across mixed verdicts', () => {
  const resolvedBindings = [
    buildResolvedBinding(),
    buildResolvedBinding({
      resourceId: 'meta-channel',
      accessMode: 'publish',
      secretReferenceId: 'meta-token',
      resourceType: 'channel',
      resourceDisplayName: 'Meta Channel',
    }),
  ];
  const permissionEvaluation = buildPermissionEvaluation({
    resolvedBindings,
    permissionDefinitions: buildPermissionDefinitions({
      rules: [
        {
          ruleId: 'allow-mas-filesystem-read',
          effect: 'allow',
          resourceId: 'mas-filesystem',
          accessModes: ['read'],
        },
        {
          ruleId: 'allow-meta-publish',
          effect: 'allow',
          resourceId: 'meta-channel',
          accessModes: ['publish'],
        },
      ],
    }),
  });
  const evaluation = evaluateToolReadinessForInvocation({
    toolDefinitions: [
      buildToolDefinition(),
      buildToolDefinition({
        toolId: 'meta.comments.read',
        displayName: 'Meta Comments Read',
        requiredResourceTypes: ['channel'],
        requiredAccessModes: ['read'],
      }),
      buildToolDefinition({
        toolId: 'meta.reply.publish',
        displayName: 'Meta Reply Publish',
        sideEffectLevel: 'publish_external',
        requiredResourceTypes: ['channel'],
        requiredAccessModes: ['publish'],
        approvalPolicy: {
          required: true,
        },
      }),
      buildToolDefinition({
        toolId: 'old.tool',
        displayName: 'Old Tool',
        lifecycleState: 'archived',
      }),
    ],
    resolvedBindings,
    permissionEvaluation,
    secretResolution: buildSecretResolution(),
  });

  assert.deepEqual(
    evaluation.evaluatedTools.map((verdict) => `${verdict.toolId}:${verdict.status}`),
    [
      'mas.system.inspect:ready',
      'meta.comments.read:denied',
      'meta.reply.publish:approval_required',
      'old.tool:unavailable',
    ],
  );
  assert.deepEqual(evaluation.summary, {
    totalEvaluated: 4,
    ready: 1,
    approvalRequired: 1,
    denied: 1,
    unavailable: 1,
  });
});

test('evaluateToolReadinessForInvocation requires valid evaluator inputs', () => {
  assert.throws(
    () => evaluateToolReadinessForInvocation({
      toolDefinitions: null,
    }),
    /toolDefinitions must be an array/u,
  );

  assert.throws(
    () => evaluateToolReadinessForInvocation({
      toolDefinitions: [],
      resolvedBindings: null,
    }),
    /resolvedBindings must be an array/u,
  );
});
