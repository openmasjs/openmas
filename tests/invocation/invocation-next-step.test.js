import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInvocationNextStep } from '../../src/invocation/build-invocation-next-step.js';

function assertNoHistoricalRoadmapLanguage(nextStep) {
  assert.doesNotMatch(nextStep, /next slice/u);
  assert.doesNotMatch(nextStep, /first deterministic agent invocation/u);
  assert.doesNotMatch(nextStep, /first probabilistic brain/u);
}

test('buildInvocationNextStep gives conversation-aware guidance for completed probabilistic invocations', () => {
  const nextStep = buildInvocationNextStep({
    status: 'completed',
    request: {
      invocationMode: 'probabilistic',
      command: 'ask',
    },
    conversationRuntime: {
      conversationId: 'alfred-admin',
    },
    brainOutput: {
      providerId: 'openrouter-api',
    },
  });

  assert.match(nextStep, /conversation state was updated/u);
  assert.match(nextStep, /--conversation alfred-admin/u);
  assertNoHistoricalRoadmapLanguage(nextStep);
});

test('buildInvocationNextStep points operators to tool observation evidence after tool execution', () => {
  const nextStep = buildInvocationNextStep({
    status: 'completed',
    request: {
      invocationMode: 'probabilistic',
      command: 'ask',
    },
    toolRequestResolution: {
      status: 'accepted',
      requestedToolId: 'mas.system.inspect',
    },
    brainToolExecution: {
      executionPerformed: true,
      requestedToolId: 'mas.system.inspect',
      toolResultStatus: 'succeeded',
    },
  });

  assert.match(nextStep, /tool observation for mas\.system\.inspect/u);
  assert.match(nextStep, /audit evidence/u);
  assertNoHistoricalRoadmapLanguage(nextStep);
});

test('buildInvocationNextStep prioritizes pending human approval over generic completion', () => {
  const nextStep = buildInvocationNextStep({
    status: 'completed',
    request: {
      invocationMode: 'probabilistic',
      command: 'ask',
    },
    humanApprovalRuntime: {
      approvalState: {
        status: 'pending',
        approvalRequestId: 'approval-request-001',
      },
    },
  });

  assert.match(nextStep, /pending human approval approval-request-001/u);
  assert.match(nextStep, /approves, denies, or expires/u);
  assertNoHistoricalRoadmapLanguage(nextStep);
});

test('buildInvocationNextStep reports workflow approval pauses with approval ids', () => {
  const nextStep = buildInvocationNextStep({
    status: 'completed',
    request: {
      invocationMode: 'probabilistic',
      command: 'ask',
    },
    workflowRequestResolution: {
      status: 'accepted',
      requestedWorkflowId: 'mas-health-review',
    },
    brainWorkflowExecution: {
      executionPerformed: true,
      requestedWorkflowId: 'mas-health-review',
      workflowRunStatus: 'waiting_for_approval',
      observation: {
        approvalRequests: ['workflow-approval-001'],
      },
    },
  });

  assert.match(nextStep, /pending workflow approval \(workflow-approval-001\)/u);
  assert.match(nextStep, /mas-health-review/u);
  assertNoHistoricalRoadmapLanguage(nextStep);
});

test('buildInvocationNextStep gives provider readiness guidance for blocked probabilistic invocations', () => {
  const nextStep = buildInvocationNextStep({
    status: 'blocked',
    request: {
      invocationMode: 'probabilistic',
      command: 'ask',
    },
  });

  assert.match(nextStep, /provider, secret, binding, or readiness prerequisite/u);
  assertNoHistoricalRoadmapLanguage(nextStep);
});

test('buildInvocationNextStep gives provider-specific guidance for failed brain invocations', () => {
  const nextStep = buildInvocationNextStep({
    status: 'failed',
    request: {
      invocationMode: 'probabilistic',
      command: 'ask',
    },
    brainOutput: {
      providerId: 'gemini-api',
    },
  });

  assert.match(nextStep, /provider failure for gemini-api/u);
  assert.match(nextStep, /credential references/u);
  assertNoHistoricalRoadmapLanguage(nextStep);
});

test('buildInvocationNextStep explains primary and fallback failure evidence explicitly', () => {
  const nextStep = buildInvocationNextStep({
    status: 'failed',
    request: {
      invocationMode: 'probabilistic',
      command: 'ask',
    },
    fallbackDecisionTrace: {
      status: 'fallback_failed',
      primaryProviderId: 'openrouter-api',
      primaryFailureCategory: 'transient_unavailable',
      fallbackProviderId: 'gemini-api',
      fallbackFailureCategory: 'rate_limited',
    },
  });

  assert.match(nextStep, /primary provider openrouter-api failed \(transient_unavailable\)/u);
  assert.match(nextStep, /fallback provider gemini-api also failed \(rate_limited\)/u);
  assertNoHistoricalRoadmapLanguage(nextStep);
});

test('buildInvocationNextStep explains semantic-classifier degradation during clarification-safe completion', () => {
  const nextStep = buildInvocationNextStep({
    status: 'completed',
    request: {
      invocationMode: 'probabilistic',
      command: 'ask',
    },
    semanticIntentRuntime: {
      providerClassifierAudit: {
        status: 'failed',
        failureKind: 'provider_failure',
        providerRequest: {
          providerId: 'gemini-api',
        },
        attempts: [
          {
            attemptNumber: 1,
            failureCategory: 'malformed_response',
          },
        ],
      },
    },
    actionResultAssessment: {
      status: 'clarification_required',
    },
  });

  assert.match(nextStep, /Semantic routing degraded because gemini-api failed \(malformed_response\)/u);
  assert.match(nextStep, /explicit tool\/workflow request/u);
  assertNoHistoricalRoadmapLanguage(nextStep);
});

test('buildInvocationNextStep distinguishes malformed classifier output from provider failure', () => {
  const nextStep = buildInvocationNextStep({
    status: 'completed',
    request: {
      invocationMode: 'probabilistic',
      command: 'ask',
    },
    semanticIntentRuntime: {
      providerClassifierAudit: {
        status: 'failed',
        failureKind: 'classification_failure',
        providerRequest: {
          providerId: 'openrouter-api',
        },
        providerResponse: {
          providerId: 'openrouter-api',
        },
      },
    },
    actionResultAssessment: {
      status: 'clarification_required',
    },
  });

  assert.match(nextStep, /returned classifier output that could not be normalized safely/u);
  assert.match(nextStep, /inspect the classifier audit/u);
  assert.doesNotMatch(nextStep, /failed \(/u);
  assertNoHistoricalRoadmapLanguage(nextStep);
});
