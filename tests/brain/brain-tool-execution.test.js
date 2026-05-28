import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { executeAcceptedBrainToolRequest } from '../../src/tools/execute-accepted-brain-tool-request.js';

const FAKE_SECRET_VALUE = 'AIzaFAKE_BRAIN_TOOL_EXECUTION_SECRET_SHOULD_NOT_LEAK';

async function createTemporaryMasRoot() {
  const temporaryRootPath = await mkdtemp(path.join(os.tmpdir(), 'openmas-brain-tool-execution-'));
  const masRootPath = path.join(temporaryRootPath, 'instance');

  await mkdir(path.join(masRootPath, 'tools', 'mas.system.inspect'), { recursive: true });
  await writeFile(
    path.join(masRootPath, 'tools', 'mas.system.inspect', 'executor.js'),
    [
      'export async function executeTool({ input }) {',
      '  return {',
      '    status: "succeeded",',
      '    summary: "Brain-requested MAS inspection completed.",',
      '    data: {',
      '      inputEcho: input,',
      `      apiKey: "${FAKE_SECRET_VALUE}",`,
      '      observedState: "ready"',
      '    },',
      '    warnings: [],',
      '    errors: []',
      '  };',
      '}',
    ].join('\n'),
    'utf8',
  );

  return masRootPath;
}

function buildToolDefinition(overrides = {}) {
  return {
    kind: 'tool_definition',
    version: 1,
    toolId: 'mas.system.inspect',
    displayName: 'MAS System Inspect',
    description: 'Reads safe MAS system structure.',
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
      allowWritebackCandidates: false,
    },
    ...overrides,
  };
}

function buildReadyVerdict(overrides = {}) {
  return {
    kind: 'tool_readiness_verdict',
    version: 1,
    toolId: 'mas.system.inspect',
    status: 'ready',
    approvalRequired: false,
    reason: 'Tool mas.system.inspect passed readiness gates and can be requested for execution.',
    matchedBindings: [
      {
        resourceId: 'mas-filesystem',
        resourceType: 'storage',
        accessMode: 'read',
        secretReferenceId: null,
        secretResolutionStatus: null,
      },
    ],
    missingRequirements: [],
    warnings: [],
    ...overrides,
  };
}

function buildToolRequest(overrides = {}) {
  return {
    kind: 'brain_tool_request',
    version: 1,
    toolRequestId: 'tool-request-execution-001',
    toolId: 'mas.system.inspect',
    input: {
      includeCounts: true,
    },
    purpose: 'Inspect the MAS before answering.',
    expectedSideEffectLevel: 'read_only',
    ...overrides,
  };
}

function buildAcceptedResolution(overrides = {}) {
  const toolRequest = buildToolRequest(overrides.toolRequest ?? {});

  return {
    kind: 'brain_tool_request_resolution',
    version: 1,
    status: 'accepted',
    requestedToolId: toolRequest.toolId,
    toolRequest,
    toolReadinessVerdict: buildReadyVerdict(overrides.toolReadinessVerdict ?? {}),
    executionAllowed: true,
    approvalRequired: false,
    autoExecutionPerformed: false,
    runtimeAction: 'queue_for_execution',
    reason: `Brain tool request for ${toolRequest.toolId} was accepted for runtime execution.`,
    warnings: [],
  };
}

function buildDeniedResolution() {
  const toolRequest = buildToolRequest();

  return {
    kind: 'brain_tool_request_resolution',
    version: 1,
    status: 'denied',
    requestedToolId: toolRequest.toolId,
    toolRequest,
    toolReadinessVerdict: {
      ...buildReadyVerdict({
        status: 'denied',
        approvalRequired: false,
        reason: 'No usable binding satisfies storage read.',
        matchedBindings: [],
        missingRequirements: [
          {
            resourceType: 'storage',
            accessMode: 'read',
            reason: 'No usable binding satisfies storage read.',
          },
        ],
      }),
    },
    executionAllowed: false,
    approvalRequired: false,
    autoExecutionPerformed: false,
    runtimeAction: 'reject',
    reason: 'Tool mas.system.inspect cannot be used in this invocation.',
    warnings: [],
  };
}

function buildApprovalRequiredResolution() {
  const toolRequest = buildToolRequest({
    toolRequestId: 'tool-request-approval-001',
    toolId: 'meta.reply.publish',
    expectedSideEffectLevel: 'publish_external',
  });

  return {
    kind: 'brain_tool_request_resolution',
    version: 1,
    status: 'approval_required',
    requestedToolId: toolRequest.toolId,
    toolRequest,
    toolReadinessVerdict: buildReadyVerdict({
      toolId: 'meta.reply.publish',
      status: 'approval_required',
      approvalRequired: true,
      reason: 'Tool meta.reply.publish passed readiness gates but requires approval before execution.',
      matchedBindings: [
        {
          resourceId: 'meta-channel',
          resourceType: 'channel',
          accessMode: 'publish',
          secretReferenceId: null,
          secretResolutionStatus: null,
        },
      ],
    }),
    executionAllowed: false,
    approvalRequired: true,
    autoExecutionPerformed: false,
    runtimeAction: 'request_human_approval',
    reason: 'Tool meta.reply.publish requires approval before execution.',
    warnings: [],
  };
}

test('executeAcceptedBrainToolRequest executes accepted local read-only requests and returns a redacted observation', async () => {
  const masRootPath = await createTemporaryMasRoot();
  const execution = await executeAcceptedBrainToolRequest({
    masRootPath,
    invocationId: 'invocation-brain-tool-execution-001',
    operationalIdentityId: 'alfred',
    requestedBy: 'test-suite',
    toolRequestResolution: buildAcceptedResolution(),
    toolDefinitions: [buildToolDefinition()],
  });
  const persistedAudit = JSON.parse(await readFile(execution.toolAuditRecordPath, 'utf8'));
  const serializedExecution = JSON.stringify(execution);

  assert.equal(execution.status, 'executed');
  assert.equal(execution.executionPerformed, true);
  assert.equal(execution.toolResultStatus, 'succeeded');
  assert.equal(execution.observation.status, 'succeeded');
  assert.equal(execution.observation.summary, 'Brain-requested MAS inspection completed.');
  assert.equal(execution.observation.dataPreview.apiKey, '[REDACTED]');
  assert.equal(persistedAudit.audit.operationalIdentityId, 'alfred');
  assert.doesNotMatch(serializedExecution, new RegExp(FAKE_SECRET_VALUE, 'u'));
});

test('executeAcceptedBrainToolRequest creates pending memory writeback review for allowed tool observations', async () => {
  const masRootPath = await createTemporaryMasRoot();
  const execution = await executeAcceptedBrainToolRequest({
    masRootPath,
    invocationId: 'invocation-brain-tool-writeback-001',
    operationalIdentityId: 'alfred',
    requestedBy: 'test-suite',
    toolRequestResolution: buildAcceptedResolution(),
    toolDefinitions: [
      buildToolDefinition({
        memoryPolicy: {
          allowWritebackCandidates: true,
        },
      }),
    ],
  });
  const persistedWritebackRequest = JSON.parse(await readFile(execution.memoryWritebackPersistence.recordPath, 'utf8'));
  const serializedWriteback = JSON.stringify({
    memoryWritebackRequest: execution.memoryWritebackRequest,
    persistedWritebackRequest,
  });

  assert.equal(execution.status, 'executed');
  assert.equal(execution.memoryWritebackRequest.requiresHumanApproval, true);
  assert.equal(execution.memoryWritebackRequest.memoryWrites.length, 1);
  assert.equal(execution.memoryWritebackRequest.memoryWrites[0].writeType, 'artifact_reference');
  assert.equal(execution.memoryWritebackRequest.memoryWrites[0].approvalState, 'pending');
  assert.equal(execution.memoryWritebackRequest.memoryWrites[0].content, null);
  assert.equal(execution.memoryWritebackPersistence.relativePath, `memory/state/memory-writeback-${execution.toolRunId}.json`);
  assert.deepEqual(
    execution.observation.memoryWritebackCandidateIds,
    execution.memoryWritebackRequest.memoryWrites.map((candidate) => {
      return candidate.writeId;
    }),
  );
  assert.equal(execution.observation.memoryWritebackRequestPath, execution.memoryWritebackPersistence.recordPath);
  assert.equal(persistedWritebackRequest.memoryWrites[0].sourceReferences[0].sourceType, 'tool_result');
  assert.doesNotMatch(serializedWriteback, new RegExp(FAKE_SECRET_VALUE, 'u'));
});

test('executeAcceptedBrainToolRequest does not execute denied or approval-required requests', async () => {
  const masRootPath = await createTemporaryMasRoot();
  const deniedExecution = await executeAcceptedBrainToolRequest({
    masRootPath,
    invocationId: 'invocation-brain-tool-denied-001',
    operationalIdentityId: 'alfred',
    requestedBy: 'test-suite',
    toolRequestResolution: buildDeniedResolution(),
    toolDefinitions: [buildToolDefinition()],
  });
  const approvalExecution = await executeAcceptedBrainToolRequest({
    masRootPath,
    invocationId: 'invocation-brain-tool-approval-001',
    operationalIdentityId: 'maria',
    requestedBy: 'test-suite',
    toolRequestResolution: buildApprovalRequiredResolution(),
    toolDefinitions: [buildToolDefinition()],
  });

  assert.equal(deniedExecution.status, 'not_executed');
  assert.equal(deniedExecution.executionPerformed, false);
  assert.equal(deniedExecution.toolRunId, null);
  assert.match(deniedExecution.reason, /resolution status is denied/u);
  assert.equal(approvalExecution.status, 'not_executed');
  assert.equal(approvalExecution.executionPerformed, false);
  assert.equal(approvalExecution.toolRunId, null);
  assert.match(approvalExecution.reason, /resolution status is approval_required/u);
});

test('executeAcceptedBrainToolRequest recovers bounded observation preview from persisted result snapshot when audit preview is omitted', async () => {
  const masRootPath = await createTemporaryMasRoot();
  const oversizedPayload = 'x'.repeat(16384);
  const execution = await executeAcceptedBrainToolRequest({
    masRootPath,
    invocationId: 'invocation-brain-tool-large-preview-001',
    operationalIdentityId: 'alfred',
    requestedBy: 'test-suite',
    toolRequestResolution: buildAcceptedResolution({
      toolRequest: {
        input: {
          largePayload: oversizedPayload,
        },
      },
    }),
    toolDefinitions: [buildToolDefinition()],
  });
  const persistedAudit = JSON.parse(await readFile(execution.toolAuditRecordPath, 'utf8'));

  assert.equal(execution.status, 'executed');
  assert.equal(persistedAudit.dataPreview, null);
  assert.equal(execution.observation.status, 'succeeded');
  assert.equal(execution.observation.dataPreview.inputEcho.largePayload.length, oversizedPayload.length);
  assert.equal(execution.observation.dataPreview.apiKey, '[REDACTED]');
});

test('executeAcceptedBrainToolRequest refuses accepted requests outside the BE 14.1 read-only execution scope', async () => {
  const masRootPath = await createTemporaryMasRoot();
  const missingDefinitionExecution = await executeAcceptedBrainToolRequest({
    masRootPath,
    invocationId: 'invocation-brain-tool-missing-definition-001',
    operationalIdentityId: 'alfred',
    requestedBy: 'test-suite',
    toolRequestResolution: buildAcceptedResolution(),
    toolDefinitions: [],
  });
  const sideEffectMismatchExecution = await executeAcceptedBrainToolRequest({
    masRootPath,
    invocationId: 'invocation-brain-tool-side-effect-mismatch-001',
    operationalIdentityId: 'alfred',
    requestedBy: 'test-suite',
    toolRequestResolution: buildAcceptedResolution({
      toolRequest: {
        expectedSideEffectLevel: 'write_internal',
      },
    }),
    toolDefinitions: [buildToolDefinition()],
  });
  const unsafeToolTypeExecution = await executeAcceptedBrainToolRequest({
    masRootPath,
    invocationId: 'invocation-brain-tool-unsafe-type-001',
    operationalIdentityId: 'alfred',
    requestedBy: 'test-suite',
    toolRequestResolution: buildAcceptedResolution(),
    toolDefinitions: [
      buildToolDefinition({
        toolType: 'http_api',
        execution: {
          modulePath: null,
          timeoutMs: null,
          retryPolicy: {
            enabled: false,
          },
        },
      }),
    ],
  });

  assert.equal(missingDefinitionExecution.status, 'not_executed');
  assert.match(missingDefinitionExecution.reason, /tool definition mas\.system\.inspect could not be resolved/u);
  assert.equal(sideEffectMismatchExecution.status, 'not_executed');
  assert.match(sideEffectMismatchExecution.reason, /expectedSideEffectLevel must match tool mas\.system\.inspect sideEffectLevel "read_only"/u);
  assert.equal(unsafeToolTypeExecution.status, 'not_executed');
  assert.match(unsafeToolTypeExecution.reason, /toolType is http_api/u);
});
