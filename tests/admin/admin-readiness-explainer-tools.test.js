import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readToolDefinitions } from '../../src/tools/read-tool-definitions.js';
import { evaluatePermissionsForInvocation } from '../../src/operational-identities/evaluate-permissions-for-invocation.js';
import { evaluateToolReadinessForInvocation } from '../../src/tools/evaluate-tool-readiness-for-invocation.js';
import { executeLocalReadOnlyToolForInvocation } from '../../src/tools/execute-local-read-only-tool-for-invocation.js';
import {
  buildPermissionReadinessExplanation,
  buildToolReadinessExplanation,
  buildWorkflowReadinessExplanation,
} from '../../src/admin/readiness-explainer-runtime.js';

const MAS_ROOT_PATH = path.resolve('instance');
const SECRET_LEAK_PATTERN = /AIza|sk-or-v1|OPENMAS_[A-Z0-9_]+|SECRET_VALUE|environmentVariableName|secretValueByReferenceId/u;

function buildResolvedBindings() {
  return [
    {
      resourceId: 'mas-filesystem',
      accessMode: 'read',
      bindingState: 'active',
      credentialReferenceId: null,
      resourceType: 'storage',
      resourceDisplayName: 'MAS Filesystem',
      ownershipScope: 'shared',
      resourceLifecycleState: 'active',
    },
  ];
}

function buildPermissionEvaluation({ resolvedBindings }) {
  return evaluatePermissionsForInvocation({
    resolvedBindings,
    permissionDefinitions: {
      kind: 'operational_identity_permissions',
      version: 1,
      operationalIdentityId: 'alfred',
      defaultEffect: 'deny',
      rules: [
        {
          ruleId: 'allow-mas-filesystem-read',
          effect: 'allow',
          resourceId: 'mas-filesystem',
          accessModes: ['read'],
        },
      ],
    },
  });
}

async function executeCheckedInTool({ toolId, input = {} }) {
  const toolRegistry = await readToolDefinitions({
    masRootPath: MAS_ROOT_PATH,
    includeInactive: true,
  });
  const toolDefinition = toolRegistry.toolDefinitions.find((definition) => {
    return definition.toolId === toolId;
  });

  assert.ok(toolDefinition, `Expected checked-in tool definition for ${toolId}.`);

  const resolvedBindings = buildResolvedBindings();
  const permissionEvaluation = buildPermissionEvaluation({ resolvedBindings });
  const readinessEvaluation = evaluateToolReadinessForInvocation({
    toolDefinitions: [toolDefinition],
    resolvedBindings,
    permissionEvaluation,
  });

  return executeLocalReadOnlyToolForInvocation({
    masRootPath: MAS_ROOT_PATH,
    toolDefinition,
    readinessVerdict: readinessEvaluation.evaluatedTools[0],
    input,
    invocationId: `invocation-${toolId}-test-001`,
    operationalIdentityId: 'alfred',
    requestedBy: 'test-suite',
  });
}

test('buildToolReadinessExplanation explains checked-in admin tools without exposing secrets', async () => {
  const explanation = await buildToolReadinessExplanation({
    masRootPath: MAS_ROOT_PATH,
    operationalIdentityId: 'alfred',
  });
  const toolIds = explanation.tools.map((tool) => tool.toolId);
  const serializedExplanation = JSON.stringify(explanation);

  assert.equal(explanation.kind, 'admin_tool_readiness_explanation');
  assert.equal(explanation.operationalIdentityId, 'alfred');
  assert.equal(toolIds.includes('mas.system.inspect'), true);
  assert.equal(toolIds.includes('mas.tools.inspect'), true);
  assert.equal(toolIds.includes('mas.workflows.inspect'), true);
  assert.equal(toolIds.includes('mas.permissions.inspect'), true);
  assert.equal(
    explanation.tools.find((tool) => tool.toolId === 'mas.tools.inspect').readiness.status,
    'ready',
  );
  assert.doesNotMatch(serializedExplanation, SECRET_LEAK_PATTERN);
});

test('buildWorkflowReadinessExplanation explains active workflow definitions without implying active runs', async () => {
  const explanation = await buildWorkflowReadinessExplanation({
    masRootPath: MAS_ROOT_PATH,
    operationalIdentityId: 'alfred',
    input: {
      workflowId: 'mas-health-review',
    },
  });
  const serializedExplanation = JSON.stringify(explanation);
  const workflow = explanation.workflows[0];

  assert.equal(explanation.kind, 'admin_workflow_readiness_explanation');
  assert.equal(workflow.workflowId, 'mas-health-review');
  assert.equal(workflow.lifecycleState, 'active');
  assert.equal(workflow.readiness.status, 'ready');
  assert.equal(workflow.stepReadiness[0].toolId, 'mas.system.inspect');
  assert.equal(workflow.stepReadiness[0].status, 'ready');
  assert.match(serializedExplanation, /active workflow definition, not a workflow currently running/u);
  assert.doesNotMatch(serializedExplanation, /in progress|executing workflow/u);
  assert.doesNotMatch(serializedExplanation, SECRET_LEAK_PATTERN);
});

test('buildPermissionReadinessExplanation explains when a draft resource is not yet bound to the operational identity', async () => {
  const explanation = await buildPermissionReadinessExplanation({
    masRootPath: MAS_ROOT_PATH,
    operationalIdentityId: 'alfred',
    input: {
      resourceId: 'alfred-whatsapp',
      accessMode: 'publish',
    },
  });
  const serializedExplanation = JSON.stringify(explanation);
  const permissionRecord = explanation.permissions[0];

  assert.equal(explanation.kind, 'admin_permission_readiness_explanation');
  assert.equal(explanation.scope.currentOperationalIdentityOnly, true);
  assert.equal(explanation.summary.total, 0);
  assert.equal(explanation.permissions.length, 0);
  assert.equal(permissionRecord, undefined);
  assert.match(serializedExplanation, /did not find a binding matching the requested filter/u);
  assert.doesNotMatch(serializedExplanation, SECRET_LEAK_PATTERN);
});

test('checked-in admin readiness tools execute through the local read-only runtime', async () => {
  const toolsResult = await executeCheckedInTool({
    toolId: 'mas.tools.inspect',
    input: {
      toolId: 'mas.system.inspect',
    },
  });
  const workflowsResult = await executeCheckedInTool({
    toolId: 'mas.workflows.inspect',
    input: {
      workflowId: 'mas-health-review',
    },
  });
  const permissionsResult = await executeCheckedInTool({
    toolId: 'mas.permissions.inspect',
    input: {
      resourceId: 'alfred-whatsapp',
      accessMode: 'publish',
    },
  });
  const serializedResults = JSON.stringify([
    toolsResult,
    workflowsResult,
    permissionsResult,
  ]);

  assert.equal(toolsResult.status, 'succeeded');
  assert.equal(workflowsResult.status, 'succeeded');
  assert.equal(permissionsResult.status, 'succeeded');
  assert.equal(toolsResult.data.tools[0].toolId, 'mas.system.inspect');
  assert.equal(workflowsResult.data.workflows[0].workflowId, 'mas-health-review');
  assert.equal(permissionsResult.data.permissions.length, 0);
  assert.match(JSON.stringify(permissionsResult.data.warnings), /did not find a binding matching the requested filter/u);
  assert.equal(toolsResult.audit.operationalIdentityId, 'alfred');
  assert.doesNotMatch(serializedResults, SECRET_LEAK_PATTERN);
});
