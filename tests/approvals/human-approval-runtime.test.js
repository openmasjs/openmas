import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { assertHumanApprovalState } from '../../src/contracts/human-approval-state-contract.js';
import { createHumanApprovalRuntimeForToolRequest } from '../../src/approvals/create-human-approval-runtime-for-tool-request.js';
import { writeHumanApprovalRuntimeArtifacts } from '../../src/approvals/write-human-approval-runtime-artifacts.js';
import { decideHumanApprovalRequest } from '../../src/approvals/decide-human-approval-request.js';
import { readHumanApprovalState } from '../../src/approvals/read-human-approval-state.js';
import { resumeApprovedToolRequest } from '../../src/approvals/resume-approved-tool-request.js';
import { runAgentInvocation } from '../../src/invocation/run-agent-invocation.js';
import {
  createAlfredProbabilisticProjectFixture,
  withEnvironment,
} from '../helpers/create-alfred-probabilistic-fixture.js';

function buildPublishToolRequest(overrides = {}) {
  return {
    kind: 'brain_tool_request',
    version: 1,
    toolRequestId: 'tool-request-publish-001',
    toolId: 'meta.reply.publish',
    input: {
      conversationId: 'conversation-123',
      replyText: 'Thanks for your message. A human will review this reply before publication.',
    },
    purpose: 'Publish a reviewed reply to an external Meta conversation.',
    expectedSideEffectLevel: 'publish_external',
    ...overrides,
  };
}

function buildApprovalRequiredToolVerdict(overrides = {}) {
  return {
    kind: 'tool_readiness_verdict',
    version: 1,
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
    missingRequirements: [],
    warnings: [],
    ...overrides,
  };
}

function buildApprovalRequiredToolResolution(overrides = {}) {
  return {
    kind: 'brain_tool_request_resolution',
    version: 1,
    status: 'approval_required',
    requestedToolId: 'meta.reply.publish',
    toolRequest: buildPublishToolRequest(),
    toolReadinessVerdict: buildApprovalRequiredToolVerdict(),
    executionAllowed: false,
    approvalRequired: true,
    autoExecutionPerformed: false,
    runtimeAction: 'request_human_approval',
    reason: 'Brain tool request for meta.reply.publish requires human approval before execution.',
    warnings: [],
    ...overrides,
  };
}

function buildAcceptedToolResolution() {
  return {
    kind: 'brain_tool_request_resolution',
    version: 1,
    status: 'accepted',
    requestedToolId: 'meta.reply.publish',
    toolRequest: buildPublishToolRequest({
      expectedSideEffectLevel: 'read_only',
    }),
    toolReadinessVerdict: {
      ...buildApprovalRequiredToolVerdict({
        status: 'ready',
        approvalRequired: false,
      }),
      reason: 'Tool meta.reply.publish passed readiness gates and can be requested for execution.',
    },
    executionAllowed: true,
    approvalRequired: false,
    autoExecutionPerformed: false,
    runtimeAction: 'queue_for_execution',
    reason: 'Brain tool request for meta.reply.publish was accepted for runtime execution.',
    warnings: [],
  };
}

function buildPublishToolDefinition() {
  return {
    kind: 'tool_definition',
    version: 1,
    toolId: 'meta.reply.publish',
    displayName: 'Meta Reply Publish',
    description: 'Publishes an external Meta reply after explicit human approval.',
    lifecycleState: 'active',
    owner: 'mas',
    toolType: 'local_js_module',
    sideEffectLevel: 'publish_external',
    inputSchema: {
      type: 'object',
    },
    outputSchema: {
      type: 'object',
    },
    requiredResourceTypes: ['channel'],
    requiredAccessModes: ['publish'],
    requiredPermissionModes: ['tool.publish'],
    approvalPolicy: {
      required: true,
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
  };
}

async function writeJsonFile(filePath, payload) {
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

async function createPersistedApprovalRuntime({
  projectRootPath,
  invocationId,
  operationalIdentityId = 'alfred',
  requestedAt = '2026-04-16T00:00:00.000Z',
  toolRequestResolution = buildApprovalRequiredToolResolution(),
}) {
  const approvalRuntime = createHumanApprovalRuntimeForToolRequest({
    invocationId,
    operationalIdentityId,
    requestedBy: 'cli',
    requestedAt,
    toolRequestResolution,
  });
  const approvalPersistence = await writeHumanApprovalRuntimeArtifacts({
    masRootPath: path.join(projectRootPath, 'instance'),
    approvalRuntime,
  });

  return {
    approvalRuntime,
    approvalPersistence,
  };
}

async function listToolRunAuditFiles(projectRootPath) {
  const stateDirectoryPath = path.join(projectRootPath, 'instance', 'memory', 'state');
  const entries = await readdir(stateDirectoryPath);

  return entries.filter((entry) => {
    return entry.startsWith('tool-run-') && entry.endsWith('.json');
  });
}

async function addApprovalRequiredPublishToolToAlfredFixture(projectRootPath) {
  const instanceRootPath = path.join(projectRootPath, 'instance');
  const toolRootPath = path.join(instanceRootPath, 'tools', 'meta.reply.publish');

  await mkdir(toolRootPath, { recursive: true });

  await writeJsonFile(
    path.join(instanceRootPath, 'registries', 'resources.json'),
    {
      kind: 'resource_registry',
      version: 1,
      resources: [
        {
          kind: 'resource_definition',
          version: 1,
          resourceId: 'openrouter-api',
          resourceType: 'brain-provider',
          displayName: 'OpenRouter API',
          ownershipScope: 'shared',
          lifecycleState: 'active',
        },
        {
          kind: 'resource_definition',
          version: 1,
          resourceId: 'gemini-api',
          resourceType: 'brain-provider',
          displayName: 'Gemini API',
          ownershipScope: 'shared',
          lifecycleState: 'active',
        },
        {
          kind: 'resource_definition',
          version: 1,
          resourceId: 'meta-channel',
          resourceType: 'channel',
          displayName: 'Meta Channel',
          ownershipScope: 'shared',
          lifecycleState: 'active',
        },
      ],
    },
  );

  await writeJsonFile(
    path.join(instanceRootPath, 'operational-identities', 'alfred', 'bindings.json'),
    {
      kind: 'operational_identity_bindings',
      version: 1,
      operationalIdentityId: 'alfred',
      bindings: [
        {
          resourceId: 'openrouter-api',
          accessMode: 'execute',
          bindingState: 'active',
          secretReferenceId: 'openrouter-api-key',
        },
        {
          resourceId: 'gemini-api',
          accessMode: 'execute',
          bindingState: 'active',
          secretReferenceId: 'gemini-api-key',
        },
        {
          resourceId: 'meta-channel',
          accessMode: 'publish',
          bindingState: 'active',
          secretReferenceId: null,
        },
      ],
    },
  );

  await writeJsonFile(
    path.join(instanceRootPath, 'operational-identities', 'alfred', 'permissions.json'),
    {
      kind: 'operational_identity_permissions',
      version: 1,
      operationalIdentityId: 'alfred',
      defaultEffect: 'deny',
      rules: [
        {
          ruleId: 'allow-openrouter-execute',
          effect: 'allow',
          resourceId: 'openrouter-api',
          accessModes: ['execute'],
        },
        {
          ruleId: 'allow-gemini-execute',
          effect: 'allow',
          resourceId: 'gemini-api',
          accessModes: ['execute'],
        },
        {
          ruleId: 'allow-meta-channel-publish',
          effect: 'allow',
          resourceId: 'meta-channel',
          accessModes: ['publish'],
        },
      ],
    },
  );

  await writeJsonFile(
    path.join(toolRootPath, 'tool.json'),
    buildPublishToolDefinition(),
  );

  await writeFile(
    path.join(toolRootPath, 'executor.js'),
    [
      'export async function executeTool({ input, approvalRequestId }) {',
      '  return {',
      '    status: "succeeded",',
      '    summary: "Approved Meta reply publication simulated.",',
      '    data: {',
      '      conversationId: input.conversationId,',
      '      replyText: input.replyText,',
      '      published: true,',
      '      approvalRequestId,',
      '      secretToken: "sk-or-v1-test-secret-that-must-be-redacted"',
      '    },',
      '    artifacts: [],',
      '    warnings: [],',
      '    errors: [],',
      '    memoryWritebackCandidates: []',
      '  };',
      '}',
      '',
    ].join('\n'),
    'utf8',
  );
}

test('createHumanApprovalRuntimeForToolRequest creates a pending approval skeleton for approval-required requests', () => {
  const approvalRuntime = createHumanApprovalRuntimeForToolRequest({
    invocationId: 'invocation-approval-001',
    operationalIdentityId: 'alfred',
    requestedBy: 'cli',
    requestedAt: '2026-04-16T00:00:00.000Z',
    toolRequestResolution: buildApprovalRequiredToolResolution(),
  });
  const acceptedRuntime = createHumanApprovalRuntimeForToolRequest({
    invocationId: 'invocation-approval-002',
    operationalIdentityId: 'alfred',
    requestedBy: 'cli',
    requestedAt: '2026-04-16T00:00:00.000Z',
    toolRequestResolution: buildAcceptedToolResolution(),
  });

  assert.equal(acceptedRuntime, null);
  assert.equal(approvalRuntime.kind, 'human_approval_runtime');
  assert.equal(approvalRuntime.approvalRequest.approvalType, 'tool_execution');
  assert.equal(approvalRuntime.approvalRequest.subject.toolId, 'meta.reply.publish');
  assert.equal(approvalRuntime.approvalState.status, 'pending');
  assert.equal(approvalRuntime.approvalState.executionBlocked, true);
  assert.equal(approvalRuntime.approvalState.executionAuthorized, false);
  assert.equal(approvalRuntime.approvalRequiredToolResult.status, 'approval_required');
  assert.equal(
    approvalRuntime.approvalRequiredToolResult.audit.approvalRequestId,
    approvalRuntime.approvalRequest.approvalRequestId,
  );
});

test('assertHumanApprovalState rejects pending states that authorize execution or include decision metadata', () => {
  const approvalRuntime = createHumanApprovalRuntimeForToolRequest({
    invocationId: 'invocation-approval-003',
    operationalIdentityId: 'alfred',
    requestedBy: 'cli',
    requestedAt: '2026-04-16T00:00:00.000Z',
    toolRequestResolution: buildApprovalRequiredToolResolution(),
  });

  assert.throws(() => {
    assertHumanApprovalState({
      ...approvalRuntime.approvalState,
      executionAuthorized: true,
    });
  }, /must block execution/u);

  assert.throws(() => {
    assertHumanApprovalState({
      ...approvalRuntime.approvalState,
      decidedAt: '2026-04-16T00:01:00.000Z',
      decidedBy: 'human-admin',
    });
  }, /must not include decision metadata/u);
});

test('decideHumanApprovalRequest approves, denies, and expires pending approval states', async () => {
  const projectRootPath = await createAlfredProbabilisticProjectFixture();
  const instanceRootPath = path.join(projectRootPath, 'instance');
  const approvedRuntime = await createPersistedApprovalRuntime({
    projectRootPath,
    invocationId: 'invocation-approval-decision-approve',
  });
  const deniedRuntime = await createPersistedApprovalRuntime({
    projectRootPath,
    invocationId: 'invocation-approval-decision-deny',
  });
  const expiredRuntime = await createPersistedApprovalRuntime({
    projectRootPath,
    invocationId: 'invocation-approval-decision-expire',
  });

  const approved = await decideHumanApprovalRequest({
    masRootPath: instanceRootPath,
    approvalRequestId: approvedRuntime.approvalRuntime.approvalRequest.approvalRequestId,
    decision: 'approve',
    decidedBy: 'human-admin',
    decisionReason: 'Reply reviewed and approved.',
    decidedAt: '2026-04-16T00:05:00.000Z',
  });
  const denied = await decideHumanApprovalRequest({
    masRootPath: instanceRootPath,
    approvalRequestId: deniedRuntime.approvalRuntime.approvalRequest.approvalRequestId,
    decision: 'deny',
    decidedBy: 'human-admin',
    decisionReason: 'Reply needs rewrite.',
    decidedAt: '2026-04-16T00:06:00.000Z',
  });
  const expired = await decideHumanApprovalRequest({
    masRootPath: instanceRootPath,
    approvalRequestId: expiredRuntime.approvalRuntime.approvalRequest.approvalRequestId,
    decision: 'expire',
    decidedBy: 'system',
    decisionReason: 'Approval window elapsed.',
    decidedAt: '2026-04-16T00:07:00.000Z',
  });
  const persistedApproved = await readHumanApprovalState({
    masRootPath: instanceRootPath,
    approvalRequestId: approved.approvalRequestId,
  });

  assert.equal(approved.status, 'approved');
  assert.equal(approved.executionAuthorized, true);
  assert.equal(approved.executionBlocked, false);
  assert.equal(approved.approvalState.consumedAt, null);
  assert.equal(denied.status, 'denied');
  assert.equal(denied.executionAuthorized, false);
  assert.equal(denied.executionBlocked, true);
  assert.equal(expired.status, 'expired');
  assert.equal(expired.executionAuthorized, false);
  assert.equal(expired.executionBlocked, true);
  assert.equal(persistedApproved.approvalState.status, 'approved');
  assert.equal(persistedApproved.approvalState.decidedBy, 'human-admin');

  await assert.rejects(
    () => decideHumanApprovalRequest({
      masRootPath: instanceRootPath,
      approvalRequestId: approved.approvalRequestId,
      decision: 'deny',
      decidedBy: 'human-admin',
    }),
    /cannot be decided because status is approved/u,
  );
});

test('resumeApprovedToolRequest executes exactly one matching approved tool request', async () => {
  const projectRootPath = await createAlfredProbabilisticProjectFixture();
  const instanceRootPath = path.join(projectRootPath, 'instance');

  await addApprovalRequiredPublishToolToAlfredFixture(projectRootPath);

  const { approvalRuntime } = await createPersistedApprovalRuntime({
    projectRootPath,
    invocationId: 'invocation-approval-resume-exact-match',
  });

  await decideHumanApprovalRequest({
    masRootPath: instanceRootPath,
    approvalRequestId: approvalRuntime.approvalRequest.approvalRequestId,
    decision: 'approve',
    decidedBy: 'human-admin',
    decisionReason: 'External reply reviewed and approved.',
    decidedAt: '2026-04-16T01:00:00.000Z',
  });

  const resumeResult = await resumeApprovedToolRequest({
    masRootPath: instanceRootPath,
    approvalRequestId: approvalRuntime.approvalRequest.approvalRequestId,
    operationalIdentityId: 'alfred',
    requestedBy: 'human-admin',
    toolDefinition: buildPublishToolDefinition(),
    readinessVerdict: buildApprovalRequiredToolVerdict(),
  });
  const consumedState = await readHumanApprovalState({
    masRootPath: instanceRootPath,
    approvalRequestId: approvalRuntime.approvalRequest.approvalRequestId,
  });
  const persistedAudit = JSON.parse(await readFile(resumeResult.toolAuditRecordPath, 'utf8'));
  const persistedAuditText = await readFile(resumeResult.toolAuditRecordPath, 'utf8');
  const replayResult = await resumeApprovedToolRequest({
    masRootPath: instanceRootPath,
    approvalRequestId: approvalRuntime.approvalRequest.approvalRequestId,
    operationalIdentityId: 'alfred',
    requestedBy: 'human-admin',
    toolDefinition: buildPublishToolDefinition(),
    readinessVerdict: buildApprovalRequiredToolVerdict(),
  });

  assert.equal(resumeResult.status, 'executed');
  assert.equal(resumeResult.executionPerformed, true);
  assert.equal(resumeResult.requestedToolId, 'meta.reply.publish');
  assert.equal(resumeResult.toolResultStatus, 'succeeded');
  assert.equal(resumeResult.observation.status, 'succeeded');
  assert.equal(resumeResult.observation.audit.approvalRequestId, approvalRuntime.approvalRequest.approvalRequestId);
  assert.equal(consumedState.approvalState.status, 'consumed');
  assert.equal(consumedState.approvalState.executionAuthorized, false);
  assert.equal(consumedState.approvalState.executionBlocked, true);
  assert.equal(consumedState.approvalState.consumedByToolRunId, resumeResult.toolRunId);
  assert.equal(persistedAudit.audit.approvalRequestId, approvalRuntime.approvalRequest.approvalRequestId);
  assert.equal(persistedAudit.dataPreview.secretToken, '[REDACTED]');
  assert.doesNotMatch(persistedAuditText, /sk-or-v1-test-secret-that-must-be-redacted/u);
  assert.equal(replayResult.status, 'not_executed');
  assert.equal(replayResult.executionPerformed, false);
  assert.equal(replayResult.toolAuditRecordPath, null);
  assert.match(replayResult.reason, /status is consumed/u);
});

test('resumeApprovedToolRequest rejects mismatched tool, operational identity, or changed input', async () => {
  const projectRootPath = await createAlfredProbabilisticProjectFixture();
  const instanceRootPath = path.join(projectRootPath, 'instance');

  await addApprovalRequiredPublishToolToAlfredFixture(projectRootPath);

  const { approvalRuntime } = await createPersistedApprovalRuntime({
    projectRootPath,
    invocationId: 'invocation-approval-resume-mismatch',
  });

  await decideHumanApprovalRequest({
    masRootPath: instanceRootPath,
    approvalRequestId: approvalRuntime.approvalRequest.approvalRequestId,
    decision: 'approve',
    decidedBy: 'human-admin',
    decisionReason: 'Approved only for the exact original request.',
    decidedAt: '2026-04-16T02:00:00.000Z',
  });

  const wrongIdentityResult = await resumeApprovedToolRequest({
    masRootPath: instanceRootPath,
    approvalRequestId: approvalRuntime.approvalRequest.approvalRequestId,
    operationalIdentityId: 'maria',
    requestedBy: 'human-admin',
    toolDefinition: buildPublishToolDefinition(),
    readinessVerdict: buildApprovalRequiredToolVerdict(),
  });
  const wrongToolResult = await resumeApprovedToolRequest({
    masRootPath: instanceRootPath,
    approvalRequestId: approvalRuntime.approvalRequest.approvalRequestId,
    operationalIdentityId: 'alfred',
    requestedBy: 'human-admin',
    toolDefinition: {
      ...buildPublishToolDefinition(),
      toolId: 'meta.reply.archive',
      displayName: 'Meta Reply Archive',
      description: 'Archives an external Meta reply after approval.',
    },
    readinessVerdict: {
      ...buildApprovalRequiredToolVerdict(),
      toolId: 'meta.reply.archive',
    },
  });
  const changedInputResult = await resumeApprovedToolRequest({
    masRootPath: instanceRootPath,
    approvalRequestId: approvalRuntime.approvalRequest.approvalRequestId,
    operationalIdentityId: 'alfred',
    requestedBy: 'human-admin',
    toolDefinition: buildPublishToolDefinition(),
    readinessVerdict: buildApprovalRequiredToolVerdict(),
    input: {
      ...approvalRuntime.approvalRequest.toolRequest.input,
      replyText: 'This is not the reviewed reply.',
    },
  });
  const approvalAfterRejectedAttempts = await readHumanApprovalState({
    masRootPath: instanceRootPath,
    approvalRequestId: approvalRuntime.approvalRequest.approvalRequestId,
  });

  assert.equal(wrongIdentityResult.status, 'not_executed');
  assert.equal(wrongIdentityResult.toolAuditRecordPath, null);
  assert.match(wrongIdentityResult.reason, /belongs to alfred, not maria/u);
  assert.equal(wrongToolResult.status, 'not_executed');
  assert.equal(wrongToolResult.toolAuditRecordPath, null);
  assert.match(wrongToolResult.reason, /scoped to tool meta.reply.publish/u);
  assert.equal(changedInputResult.status, 'not_executed');
  assert.equal(changedInputResult.toolAuditRecordPath, null);
  assert.match(changedInputResult.reason, /input does not match/u);
  assert.equal(approvalAfterRejectedAttempts.approvalState.status, 'approved');
  assert.equal(approvalAfterRejectedAttempts.approvalState.consumedAt, null);
});

test('resumeApprovedToolRequest does not execute denied or expired approvals', async () => {
  const projectRootPath = await createAlfredProbabilisticProjectFixture();
  const instanceRootPath = path.join(projectRootPath, 'instance');

  await addApprovalRequiredPublishToolToAlfredFixture(projectRootPath);

  const deniedRuntime = await createPersistedApprovalRuntime({
    projectRootPath,
    invocationId: 'invocation-approval-resume-denied',
  });
  const expiredRuntime = await createPersistedApprovalRuntime({
    projectRootPath,
    invocationId: 'invocation-approval-resume-expired',
  });

  await decideHumanApprovalRequest({
    masRootPath: instanceRootPath,
    approvalRequestId: deniedRuntime.approvalRuntime.approvalRequest.approvalRequestId,
    decision: 'deny',
    decidedBy: 'human-admin',
    decisionReason: 'Do not publish this reply.',
    decidedAt: '2026-04-16T03:00:00.000Z',
  });
  await decideHumanApprovalRequest({
    masRootPath: instanceRootPath,
    approvalRequestId: expiredRuntime.approvalRuntime.approvalRequest.approvalRequestId,
    decision: 'expire',
    decidedBy: 'system',
    decisionReason: 'Decision timed out.',
    decidedAt: '2026-04-16T03:01:00.000Z',
  });

  const deniedResume = await resumeApprovedToolRequest({
    masRootPath: instanceRootPath,
    approvalRequestId: deniedRuntime.approvalRuntime.approvalRequest.approvalRequestId,
    operationalIdentityId: 'alfred',
    requestedBy: 'human-admin',
    toolDefinition: buildPublishToolDefinition(),
    readinessVerdict: buildApprovalRequiredToolVerdict(),
  });
  const expiredResume = await resumeApprovedToolRequest({
    masRootPath: instanceRootPath,
    approvalRequestId: expiredRuntime.approvalRuntime.approvalRequest.approvalRequestId,
    operationalIdentityId: 'alfred',
    requestedBy: 'human-admin',
    toolDefinition: buildPublishToolDefinition(),
    readinessVerdict: buildApprovalRequiredToolVerdict(),
  });
  const toolRunAuditFiles = await listToolRunAuditFiles(projectRootPath);

  assert.equal(deniedResume.status, 'not_executed');
  assert.equal(deniedResume.executionPerformed, false);
  assert.equal(deniedResume.toolAuditRecordPath, null);
  assert.match(deniedResume.reason, /status is denied/u);
  assert.equal(expiredResume.status, 'not_executed');
  assert.equal(expiredResume.executionPerformed, false);
  assert.equal(expiredResume.toolAuditRecordPath, null);
  assert.match(expiredResume.reason, /status is expired/u);
  assert.deepEqual(toolRunAuditFiles, []);
});

test('runAgentInvocation persists human approval artifacts and does not execute approval-required tool requests', async () => {
  await withEnvironment(
    {
      "openrouter-api-key": 'openrouter-secret',
      "gemini-api-key": 'gemini-secret',
    },
    async () => {
      const projectRootPath = await createAlfredProbabilisticProjectFixture();
      const envelopeText = JSON.stringify(buildPublishToolRequest(), null, 2);

      await addApprovalRequiredPublishToolToAlfredFixture(projectRootPath);

      const result = await runAgentInvocation({
        projectRootPath,
        operationalIdentityId: 'alfred',
        invocationMode: 'probabilistic',
        command: 'ask',
        inputText: 'Please publish a Meta reply if it is allowed.',
        requestedBy: 'cli',
        fetchImplementation: async (url, options) => {
          assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions');

          const body = JSON.parse(options.body);
          const systemMessage = body.messages[0].content;

          assert.match(systemMessage, /## Tool Availability/u);
          assert.match(systemMessage, /Meta Reply Publish/u);
          assert.match(systemMessage, /approval_required/u);
          assert.match(systemMessage, /require human approval/u);

          return {
            ok: true,
            async json() {
              return {
                id: 'openrouter-approval-request-response-1',
                choices: [
                  {
                    finish_reason: 'stop',
                    message: {
                      content: envelopeText,
                    },
                  },
                ],
                usage: {
                  prompt_tokens: 180,
                  completion_tokens: 50,
                  total_tokens: 230,
                },
              };
            },
          };
        },
      });

      assert.equal(result.status, 'completed');
      assert.equal(result.output.toolRequestResolution.status, 'approval_required');
      assert.equal(result.output.toolRequestResolution.executionAllowed, false);
      assert.equal(result.output.toolRequestResolution.autoExecutionPerformed, false);
      assert.equal(result.output.humanApprovalRequest.approvalType, 'tool_execution');
      assert.equal(result.output.humanApprovalState.status, 'pending');
      assert.equal(result.output.humanApprovalState.executionBlocked, true);
      assert.equal(result.output.approvalRequiredToolResult.status, 'approval_required');
      assert.equal(result.output.approvalRequiredToolResult.data.executionBlocked, true);
      assert.equal(
        result.output.approvalRequiredToolResult.audit.approvalRequestId,
        result.output.humanApprovalRequest.approvalRequestId,
      );

      const invocationSession = JSON.parse(await readFile(result.persistence.invocationSessionRecordPath, 'utf8'));
      const invocationReport = await readFile(result.persistence.invocationReportPath, 'utf8');
      const persistedApprovalRequest = JSON.parse(
        await readFile(invocationSession.humanApprovalPersistence.approvalRequestRecordPath, 'utf8'),
      );
      const persistedApprovalState = JSON.parse(
        await readFile(invocationSession.humanApprovalPersistence.approvalStateRecordPath, 'utf8'),
      );

      assert.equal(invocationSession.toolReadiness.summary.approvalRequired, 1);
      assert.equal(invocationSession.toolRequestResolution.status, 'approval_required');
      assert.equal(invocationSession.humanApprovalRequest.approvalRequestId, result.output.humanApprovalRequest.approvalRequestId);
      assert.equal(invocationSession.humanApprovalState.status, 'pending');
      assert.equal(invocationSession.approvalRequiredToolResult.status, 'approval_required');
      assert.equal(invocationSession.brainExecution.attempts[0].humanApprovalRuntime.approvalState.status, 'pending');
      assert.equal(persistedApprovalRequest.approvalRequestId, result.output.humanApprovalRequest.approvalRequestId);
      assert.equal(persistedApprovalState.status, 'pending');
      assert.equal(persistedApprovalState.executionBlocked, true);
      assert.equal(persistedApprovalState.executionAuthorized, false);
      assert.match(invocationReport, /Human Approval/u);
      assert.match(invocationReport, /Approval State: pending/u);
      assert.match(invocationReport, /Execution Blocked: yes/u);
      assert.doesNotMatch(JSON.stringify(invocationSession), /openrouter-secret|gemini-secret/u);
    },
  );
});
