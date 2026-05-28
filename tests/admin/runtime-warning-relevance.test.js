import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRuntimeWarningRelevance,
  classifyRuntimeWarning,
  formatRuntimeWarningRelevanceForCli,
} from '../../src/warnings/runtime-warning-relevance.js';

function buildMasInspectRuntimeContext() {
  return {
    output: {
      providerId: 'openrouter-api',
      actionResolution: {
        status: 'accepted',
        source: 'semantic_intent',
        runtimeAction: 'queue_tool_request',
        selectedCandidate: {
          actionType: 'tool_execution',
          targetType: 'tool',
          targetId: 'mas.system.inspect',
        },
      },
      toolRequestResolution: {
        requestedToolId: 'mas.system.inspect',
        toolReadinessVerdict: {
          matchedBindings: [
            {
              resourceId: 'mas-filesystem',
              accessMode: 'read',
              secretReferenceId: null,
            },
          ],
        },
      },
      brainToolExecution: {
        requestedToolId: 'mas.system.inspect',
        executionPerformed: true,
      },
    },
  };
}

test('buildRuntimeWarningRelevance creates a v2 runtime model with request and environment lists', () => {
  const warningRelevance = buildRuntimeWarningRelevance([
    'Permission denied for resource alfred-whatsapp (publish): Allow rule matched, but binding state is not active: draft.',
    'Runtime notice: Tool mas.system.inspect runtime memory writeback candidates are disabled by tool policy.',
  ], {
    runtimeContext: buildMasInspectRuntimeContext(),
  });

  assert.equal(warningRelevance.kind, 'runtime_warning_relevance');
  assert.equal(warningRelevance.version, 2);
  assert.equal(warningRelevance.totalWarnings, 2);
  assert.equal(warningRelevance.relevanceCounts.request_impacting, 1);
  assert.equal(warningRelevance.relevanceCounts.environment_advisory, 1);
  assert.equal(warningRelevance.requestImpactingWarnings[0].categoryId, 'tools_workflows');
  assert.equal(warningRelevance.environmentAdvisoryWarnings[0].categoryId, 'permissions_access');
  assert.deepEqual(warningRelevance.requestImpactingWarnings[0].sourceReferences, [
    {
      sourceType: 'tool',
      sourceId: 'mas.system.inspect',
    },
  ]);
  assert.deepEqual(warningRelevance.actionContextReferences.requestedResourceIds, ['mas-filesystem']);
  assert.deepEqual(warningRelevance.actionContextReferences.requestedToolIds, ['mas.system.inspect']);
});

test('classifyRuntimeWarning includes source references and action context references', () => {
  const classifiedWarning = classifyRuntimeWarning(
    'Permission denied for resource alfred-whatsapp (publish): No allow rule found.',
    {
      runtimeContext: buildMasInspectRuntimeContext(),
    },
  );

  assert.equal(classifiedWarning.relevance, 'environment_advisory');
  assert.deepEqual(classifiedWarning.sourceReferences, [
    {
      sourceType: 'resource',
      sourceId: 'alfred-whatsapp',
    },
  ]);
  assert.equal(classifiedWarning.actionContextReferences.selectedAction.targetId, 'mas.system.inspect');
});

test('requested resource warnings remain request-impacting', () => {
  const classifiedWarning = classifyRuntimeWarning(
    'Permission denied for resource mas-filesystem (read): No allow rule found.',
    {
      runtimeContext: buildMasInspectRuntimeContext(),
    },
  );

  assert.equal(classifiedWarning.relevance, 'request_impacting');
  assert.equal(classifiedWarning.sourceReferences[0].sourceId, 'mas-filesystem');
});

test('permission warnings remain request-impacting when no action context exists yet', () => {
  const classifiedWarning = classifyRuntimeWarning(
    'Permission denied for resource alfred-whatsapp (publish): No allow rule found.',
    {
      runtimeContext: {
        request: {
          command: 'ask',
        },
      },
    },
  );

  assert.equal(classifiedWarning.relevance, 'request_impacting');
});

test('unrelated tool warnings become environment advisories', () => {
  const classifiedWarning = classifyRuntimeWarning(
    'Tool meta.reply.publish lifecycle state is not active: draft.',
    {
      runtimeContext: buildMasInspectRuntimeContext(),
    },
  );

  assert.equal(classifiedWarning.categoryId, 'tools_workflows');
  assert.equal(classifiedWarning.relevance, 'environment_advisory');
  assert.deepEqual(classifiedWarning.sourceReferences, [
    {
      sourceType: 'tool',
      sourceId: 'meta.reply.publish',
    },
  ]);
});

test('action guard and result assessment warnings stay request-impacting', () => {
  const warningRelevance = buildRuntimeWarningRelevance([
    'Unsupported action claim detected: the answer claimed an inspection without runtime evidence.',
    'Action result assessment found 1 unsupported action claim.',
  ], {
    runtimeContext: buildMasInspectRuntimeContext(),
  });

  assert.equal(warningRelevance.relevanceCounts.request_impacting, 2);
  assert.equal(warningRelevance.relevanceCounts.environment_advisory, 0);
  assert.equal(
    warningRelevance.requestImpactingWarnings.some((warning) => {
      return warning.sourceReferences.some((reference) => reference.sourceType === 'action_claim_guard');
    }),
    true,
  );
});

test('provider and secret warnings use provider context for relevance', () => {
  const warningRelevance = buildRuntimeWarningRelevance([
    'Provider openrouter-api failed: API key not valid.',
    'Secret Reference gemini-api-key is not resolved for resource gemini-api.',
  ], {
    runtimeContext: buildMasInspectRuntimeContext(),
  });

  assert.equal(warningRelevance.relevanceCounts.request_impacting, 1);
  assert.equal(warningRelevance.relevanceCounts.environment_advisory, 1);
  assert.equal(warningRelevance.requestImpactingWarnings[0].sourceReferences[0].sourceId, 'openrouter-api');
  assert.equal(
    warningRelevance.environmentAdvisoryWarnings.some((warning) => {
      return warning.sourceReferences.some((reference) => reference.sourceId === 'gemini-api-key');
    }),
    true,
  );
});

test('formatRuntimeWarningRelevanceForCli formats a precomputed runtime model', () => {
  const warningRelevance = buildRuntimeWarningRelevance([
    'Permission denied for resource alfred-whatsapp (publish): No allow rule found.',
    'Runtime notice: Tool mas.system.inspect runtime memory writeback candidates are disabled by tool policy.',
  ], {
    runtimeContext: buildMasInspectRuntimeContext(),
  });
  const output = formatRuntimeWarningRelevanceForCli(warningRelevance).join('\n');

  assert.match(output, /Total: 2 \| Request Impacting: 1 \| Environment Advisories: 1/u);
  assert.match(output, /Request-Impacting Warnings:[\s\S]*Tools & Workflows/u);
  assert.match(output, /Environment Advisories:[\s\S]*Permissions & Access/u);
});
