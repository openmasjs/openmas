import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildWarningTaxonomy,
  classifyWarning,
  formatWarningTaxonomyForCli,
} from '../../src/cli/warning-taxonomy.js';

test('classifyWarning identifies permission and access warnings as action-required', () => {
  const classifiedWarning = classifyWarning(
    'Permission denied for resource alfred-whatsapp (publish): Allow rule matched, but binding state is not active: draft.',
  );

  assert.equal(classifiedWarning.categoryId, 'permissions_access');
  assert.equal(classifiedWarning.categoryLabel, 'Permissions & Access');
  assert.equal(classifiedWarning.severity, 'action_required');
  assert.equal(classifiedWarning.relevance, 'request_impacting');
  assert.match(classifiedWarning.adminAction, /bindings, permissions\.json/u);
});

test('classifyWarning identifies provider and secret readiness warnings', () => {
  const classifiedWarning = classifyWarning(
    'Credential Reference providers.openrouter.shared.default.api_key is not resolved for provider openrouter-api.',
  );

  assert.equal(classifiedWarning.categoryId, 'provider_secrets');
  assert.equal(classifiedWarning.severity, 'action_required');
  assert.equal(classifiedWarning.relevance, 'request_impacting');
  assert.match(classifiedWarning.adminAction, /API key readiness/u);
});

test('classifyWarning treats skipped memory-source warnings as informational context warnings', () => {
  const classifiedWarning = classifyWarning(
    'Memory source runtime-state skipped oversized file agent-invocation-001.json: 580295 bytes exceeds 32768.',
  );

  assert.equal(classifiedWarning.categoryId, 'memory_context');
  assert.equal(classifiedWarning.severity, 'info');
  assert.equal(classifiedWarning.relevance, 'request_impacting');
});

test('classifyWarning treats expected writeback policy notices as informational tool runtime notices', () => {
  const classifiedWarning = classifyWarning(
    'Runtime notice: Tool mas.system.inspect runtime memory writeback candidates are disabled by tool policy.',
  );

  assert.equal(classifiedWarning.categoryId, 'tools_workflows');
  assert.equal(classifiedWarning.severity, 'info');
  assert.equal(classifiedWarning.relevance, 'request_impacting');
});

test('classifyWarning marks unrelated permission denials as environment advisories when request resources are known', () => {
  const classifiedWarning = classifyWarning(
    'Permission denied for resource alfred-whatsapp (publish): Allow rule matched, but binding state is not active: draft.',
    {
      runtimeContext: {
        requestedResourceIds: ['mas-filesystem'],
      },
    },
  );

  assert.equal(classifiedWarning.categoryId, 'permissions_access');
  assert.equal(classifiedWarning.severity, 'action_required');
  assert.equal(classifiedWarning.relevance, 'environment_advisory');
});

test('buildWarningTaxonomy groups warnings by category and severity priority', () => {
  const taxonomy = buildWarningTaxonomy([
    'Memory source runtime-artifacts omitted file due to maxFiles limit: old-report.md',
    'Permission denied for resource alfred-whatsapp (publish): No allow rule found.',
    'Human approval is required before executing meta.reply.publish.',
    'Tool rootPath does not exist: tools',
  ]);

  assert.equal(taxonomy.totalWarnings, 4);
  assert.equal(taxonomy.severityCounts.action_required, 2);
  assert.equal(taxonomy.severityCounts.review, 1);
  assert.equal(taxonomy.severityCounts.info, 1);
  assert.equal(taxonomy.relevanceCounts.request_impacting, 4);
  assert.equal(taxonomy.relevanceCounts.environment_advisory, 0);
  assert.deepEqual(
    taxonomy.groups.map((group) => group.categoryId),
    [
      'approval',
      'permissions_access',
      'structure_configuration',
      'memory_context',
    ],
  );
});

test('formatWarningTaxonomyForCli emits an admin-friendly grouped warning summary', () => {
  const lines = formatWarningTaxonomyForCli([
    'Permission denied for resource alfred-whatsapp (publish): No allow rule found.',
    'Memory source runtime-state skipped oversized file agent-invocation-001.json: 580295 bytes exceeds 32768.',
    'Memory source runtime-state skipped oversized file agent-invocation-002.json: 590000 bytes exceeds 32768.',
    'Memory source runtime-state skipped oversized file agent-invocation-003.json: 600000 bytes exceeds 32768.',
    'Memory source runtime-state skipped oversized file agent-invocation-004.json: 610000 bytes exceeds 32768.',
  ], {
    maxExamplesPerCategory: 2,
  });
  const output = lines.join('\n');

  assert.match(output, /Warnings:/u);
  assert.match(output, /Total: 5 \| Request Impacting: 5 \| Environment Advisories: 0/u);
  assert.match(output, /Severity: Action Required: 1 \| Review: 0 \| Info: 4/u);
  assert.match(output, /Request-Impacting Warnings:/u);
  assert.match(output, /Permissions & Access \[action_required\] \(1\)/u);
  assert.match(output, /Memory & Context \[info\] \(4\)/u);
  assert.match(output, /2 additional warning\(s\) omitted from CLI summary/u);
  assert.doesNotMatch(output, /Warnings: .* \| .* \| /u);
});

test('formatWarningTaxonomyForCli separates request warnings from environment advisories', () => {
  const lines = formatWarningTaxonomyForCli([
    'Permission denied for resource alfred-whatsapp (publish): Allow rule matched, but binding state is not active: draft.',
    'Runtime notice: Tool mas.system.inspect runtime memory writeback candidates are disabled by tool policy.',
  ], {
    runtimeContext: {
      requestedResourceIds: ['mas-filesystem'],
    },
  });
  const output = lines.join('\n');

  assert.match(output, /Total: 2 \| Request Impacting: 1 \| Environment Advisories: 1/u);
  assert.match(output, /Request-Impacting Warnings:[\s\S]*Tools & Workflows \[info\]/u);
  assert.match(output, /Environment Advisories:[\s\S]*Permissions & Access \[action_required\]/u);
});

test('formatWarningTaxonomyForCli returns no lines when there are no warnings', () => {
  assert.deepEqual(formatWarningTaxonomyForCli([]), []);
  assert.deepEqual(formatWarningTaxonomyForCli(null), []);
});
