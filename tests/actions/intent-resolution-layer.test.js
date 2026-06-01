import test from 'node:test';
import assert from 'node:assert/strict';
import {
  detectMasHealthReviewIntent,
  detectMasInspectionIntent,
  resolveIntentForInvocation,
} from '../../src/intents/resolve-intent-for-invocation.js';

function buildNoToolRequestResolution() {
  return {
    kind: 'brain_tool_request_resolution',
    version: 1,
    status: 'no_request',
    requestedToolId: null,
    toolRequest: null,
    toolReadinessVerdict: null,
    executionAllowed: false,
    approvalRequired: false,
    autoExecutionPerformed: false,
    runtimeAction: 'none',
    reason: 'No tool request in test.',
    warnings: [],
  };
}

function buildNoWorkflowRequestResolution() {
  return {
    kind: 'brain_workflow_request_resolution',
    version: 1,
    status: 'no_request',
    requestedWorkflowId: null,
    workflowRequest: null,
    workflowRuntimeDefinition: null,
    executionAllowed: false,
    autoExecutionPerformed: false,
    runtimeAction: 'none',
    reason: 'No workflow request in test.',
    warnings: [],
  };
}

function buildAcceptedToolRequestResolution() {
  return {
    kind: 'brain_tool_request_resolution',
    version: 1,
    status: 'accepted',
    requestedToolId: 'mas.system.inspect',
    toolRequest: {
      kind: 'brain_tool_request',
      version: 1,
      toolRequestId: 'brain-tool-request-existing-001',
      toolId: 'mas.system.inspect',
      input: {},
      purpose: 'Existing brain request.',
      expectedSideEffectLevel: 'read_only',
    },
    toolReadinessVerdict: buildReadyToolVerdict({
      toolId: 'mas.system.inspect',
    }),
    executionAllowed: true,
    approvalRequired: false,
    autoExecutionPerformed: false,
    runtimeAction: 'queue_for_execution',
    reason: 'Existing brain tool request was accepted.',
    warnings: [],
  };
}

function buildReadyToolVerdict({
  toolId = 'mas.system.inspect',
  status = 'ready',
} = {}) {
  return {
    kind: 'tool_readiness_verdict',
    version: 1,
    toolId,
    status,
    approvalRequired: false,
    reason: status === 'ready'
      ? 'Tool is ready.'
      : 'Tool is denied in this test.',
    matchedBindings: [
      {
        resourceId: 'mas-filesystem',
        resourceType: 'storage',
        accessMode: 'read',
        credentialReferenceId: null,
        secretResolutionStatus: null,
      },
    ],
    missingRequirements: status === 'ready'
      ? []
      : [
        {
          resourceType: 'storage',
          accessMode: 'read',
          reason: 'No readable MAS filesystem binding.',
        },
      ],
    warnings: [],
  };
}

function buildToolReadinessEvaluation({
  inspectStatus = 'ready',
} = {}) {
  const evaluatedTools = [
    buildReadyToolVerdict({
      toolId: 'mas.system.inspect',
      status: inspectStatus,
    }),
    buildReadyToolVerdict({
      toolId: 'mas.tools.inspect',
    }),
    buildReadyToolVerdict({
      toolId: 'mas.workflows.inspect',
    }),
    buildReadyToolVerdict({
      toolId: 'mas.permissions.inspect',
    }),
  ];
  const ready = evaluatedTools.filter((tool) => tool.status === 'ready').length;
  const denied = evaluatedTools.filter((tool) => tool.status === 'denied').length;

  return {
    kind: 'tool_readiness_evaluation',
    version: 1,
    evaluatedTools,
    summary: {
      totalEvaluated: evaluatedTools.length,
      ready,
      approvalRequired: 0,
      denied,
      unavailable: 0,
    },
    warnings: [],
  };
}

function buildMasHealthReviewWorkflowDefinition() {
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
        input: {
          includeCounts: true,
        },
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
  };
}

test('intent resolution detects Spanish MAS inspection requests without relying on exact commands', () => {
  const intent = detectMasInspectionIntent(
    'Porfa podrias ayudarme inspeccionando el MAS nuevamente para saber si algo cambio?',
  );

  assert.equal(intent.intentId, 'admin.mas.inspect');
  assert.equal(intent.confidence, 'high');
});

test('intent resolution does not execute retrospective inspection questions', () => {
  const intent = detectMasInspectionIntent('Tell me if you inspected the MAS.');

  assert.equal(intent, null);
});

test('intent resolution detects broader MAS health review requests as workflow intents', () => {
  const intent = detectMasHealthReviewIntent('Please run a full MAS health review.');

  assert.equal(intent.intentId, 'admin.mas.health_review');
  assert.equal(intent.intentType, 'administrative_health_review');
});

test('intent resolution synthesizes a governed MAS inspect tool request when the brain omits it', () => {
  const result = resolveIntentForInvocation({
    request: {
      command: 'ask',
      inputText: 'Necesito revisar el MAS completo.',
    },
    toolRequestResolution: buildNoToolRequestResolution(),
    workflowRequestResolution: buildNoWorkflowRequestResolution(),
    toolReadinessEvaluation: buildToolReadinessEvaluation(),
    workflowRuntimeDefinitions: [],
  });

  assert.equal(result.intentApplied, true);
  assert.equal(result.intentResolution.status, 'resolved');
  assert.equal(result.intentResolution.target.targetType, 'tool');
  assert.equal(result.intentResolution.target.targetId, 'mas.system.inspect');
  assert.equal(result.toolRequestResolution.status, 'accepted');
  assert.equal(result.toolRequestResolution.requestedToolId, 'mas.system.inspect');
  assert.equal(result.toolRequestResolution.toolRequest.toolRequestId, 'runtime-intent-admin-mas-inspect-001');
});

test('intent resolution routes tool explanation requests to the admin tool readiness explainer', () => {
  const result = resolveIntentForInvocation({
    request: {
      command: 'ask',
      operationalIdentityId: 'alfred',
      inputText: 'Alfred, me podrias explicar la herramienta de Inspeccion del MAS?',
    },
    toolRequestResolution: buildNoToolRequestResolution(),
    workflowRequestResolution: buildNoWorkflowRequestResolution(),
    toolReadinessEvaluation: buildToolReadinessEvaluation(),
    workflowRuntimeDefinitions: [],
  });

  assert.equal(result.intentApplied, true);
  assert.equal(result.intentResolution.intentId, 'admin.mas.tools.inspect');
  assert.equal(result.intentResolution.target.targetId, 'mas.tools.inspect');
  assert.equal(result.toolRequestResolution.status, 'accepted');
  assert.equal(result.toolRequestResolution.requestedToolId, 'mas.tools.inspect');
  assert.equal(result.toolRequestResolution.toolRequest.input.toolId, 'mas.system.inspect');
});

test('intent resolution routes general tool availability questions to the admin tool readiness explainer', () => {
  const result = resolveIntentForInvocation({
    request: {
      command: 'ask',
      operationalIdentityId: 'alfred',
      inputText: 'What tools can you use right now?',
    },
    toolRequestResolution: buildNoToolRequestResolution(),
    workflowRequestResolution: buildNoWorkflowRequestResolution(),
    toolReadinessEvaluation: buildToolReadinessEvaluation(),
    workflowRuntimeDefinitions: [],
  });

  assert.equal(result.intentApplied, true);
  assert.equal(result.intentResolution.intentId, 'admin.mas.tools.inspect');
  assert.equal(result.toolRequestResolution.requestedToolId, 'mas.tools.inspect');
  assert.deepEqual(result.toolRequestResolution.toolRequest.input, {});
});

test('intent resolution routes resource access questions to the admin permission explainer', () => {
  const result = resolveIntentForInvocation({
    request: {
      command: 'ask',
      operationalIdentityId: 'alfred',
      inputText: 'Why cannot you publish to WhatsApp?',
    },
    toolRequestResolution: buildNoToolRequestResolution(),
    workflowRequestResolution: buildNoWorkflowRequestResolution(),
    toolReadinessEvaluation: buildToolReadinessEvaluation(),
    workflowRuntimeDefinitions: [],
  });

  assert.equal(result.intentApplied, true);
  assert.equal(result.intentResolution.intentId, 'admin.mas.permissions.inspect');
  assert.equal(result.toolRequestResolution.requestedToolId, 'mas.permissions.inspect');
  assert.equal(result.toolRequestResolution.toolRequest.input.resourceId, 'alfred-whatsapp');
  assert.equal(result.toolRequestResolution.toolRequest.input.accessMode, 'publish');
});

test('intent resolution routes workflow explanation requests to the admin workflow readiness explainer', () => {
  const result = resolveIntentForInvocation({
    request: {
      command: 'ask',
      operationalIdentityId: 'alfred',
      inputText: 'Explain the mas-health-review workflow.',
    },
    toolRequestResolution: buildNoToolRequestResolution(),
    workflowRequestResolution: buildNoWorkflowRequestResolution(),
    toolReadinessEvaluation: buildToolReadinessEvaluation(),
    workflowRuntimeDefinitions: [
      buildMasHealthReviewWorkflowDefinition(),
    ],
  });

  assert.equal(result.intentApplied, true);
  assert.equal(result.intentResolution.intentId, 'admin.mas.workflows.inspect');
  assert.equal(result.intentResolution.target.targetId, 'mas.workflows.inspect');
  assert.equal(result.toolRequestResolution.requestedToolId, 'mas.workflows.inspect');
  assert.equal(result.toolRequestResolution.toolRequest.input.workflowId, 'mas-health-review');
  assert.equal(result.workflowRequestResolution.status, 'no_request');
});

test('intent resolution never overrides an existing accepted brain tool request', () => {
  const result = resolveIntentForInvocation({
    request: {
      command: 'ask',
      inputText: 'Inspecciona el MAS.',
    },
    toolRequestResolution: buildAcceptedToolRequestResolution(),
    workflowRequestResolution: buildNoWorkflowRequestResolution(),
    toolReadinessEvaluation: buildToolReadinessEvaluation(),
    workflowRuntimeDefinitions: [],
  });

  assert.equal(result.intentApplied, false);
  assert.equal(result.intentResolution.status, 'skipped');
  assert.equal(result.toolRequestResolution.toolRequest.toolRequestId, 'brain-tool-request-existing-001');
});

test('intent resolution blocks detected inspect intent when runtime gates deny the tool', () => {
  const result = resolveIntentForInvocation({
    request: {
      command: 'ask',
      inputText: 'Please inspect the MAS.',
    },
    toolRequestResolution: buildNoToolRequestResolution(),
    workflowRequestResolution: buildNoWorkflowRequestResolution(),
    toolReadinessEvaluation: buildToolReadinessEvaluation({
      inspectStatus: 'denied',
    }),
    workflowRuntimeDefinitions: [],
  });

  assert.equal(result.intentApplied, false);
  assert.equal(result.intentResolution.status, 'blocked');
  assert.equal(result.intentResolution.target.targetId, 'mas.system.inspect');
  assert.equal(result.toolRequestResolution.status, 'no_request');
});

test('intent resolution synthesizes a governed MAS health review workflow request', () => {
  const result = resolveIntentForInvocation({
    request: {
      command: 'ask',
      inputText: 'Please run a full MAS health review.',
    },
    toolRequestResolution: buildNoToolRequestResolution(),
    workflowRequestResolution: buildNoWorkflowRequestResolution(),
    toolReadinessEvaluation: buildToolReadinessEvaluation(),
    workflowRuntimeDefinitions: [
      buildMasHealthReviewWorkflowDefinition(),
    ],
  });

  assert.equal(result.intentApplied, true);
  assert.equal(result.intentResolution.status, 'resolved');
  assert.equal(result.intentResolution.target.targetType, 'workflow');
  assert.equal(result.intentResolution.target.targetId, 'mas-health-review');
  assert.equal(result.workflowRequestResolution.status, 'accepted');
  assert.equal(result.workflowRequestResolution.requestedWorkflowId, 'mas-health-review');
  assert.equal(
    result.workflowRequestResolution.workflowRequest.workflowRequestId,
    'runtime-intent-admin-mas-health-review-001',
  );
});
