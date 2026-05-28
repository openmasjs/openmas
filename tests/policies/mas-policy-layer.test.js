import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { runSystemBoot } from '../../src/boot/run-system-boot.js';
import { assembleBrainInputForInvocation } from '../../src/brain/assemble-brain-input-for-invocation.js';
import { buildMasPolicyLayer } from '../../src/brain/build-mas-policy-layer.js';
import { prepareAgentInvocation } from '../../src/invocation/prepare-agent-invocation.js';
import { readMasPolicySourcesForInvocation } from '../../src/policies/read-mas-policy-sources-for-invocation.js';
import {
  createAlfredProbabilisticProjectFixture,
  withEnvironment,
} from '../helpers/create-alfred-probabilistic-fixture.js';

const MAS_POLICY_MARKER = 'MAS_POLICY_MARKER_NEUTRAL_ENTERPRISE_TONE';
const MAS_POLICY_RUNTIME_BOUNDARY_MARKER = 'MAS_POLICY_DOES_NOT_GRANT_RUNTIME_AUTHORITY';

async function createMasRoot() {
  const projectRootPath = await mkdtemp(path.join(os.tmpdir(), 'openmas-mas-policy-layer-'));
  const masRootPath = path.join(projectRootPath, 'instance');

  await mkdir(path.join(masRootPath, 'memory', 'policies'), { recursive: true });

  return {
    projectRootPath,
    masRootPath,
  };
}

async function writePolicyFile({ masRootPath, fileName, content }) {
  await writeFile(
    path.join(masRootPath, 'memory', 'policies', fileName),
    content,
    'utf8',
  );
}

function buildPolicySource(overrides = {}) {
  return {
    kind: 'mas_policy_source',
    version: 1,
    sourceId: 'mas-interaction-policy',
    title: 'MAS Interaction Policy',
    sourcePath: 'instance/memory/policies/mas-interaction-policy.md',
    lifecycleState: 'active',
    priority: 20,
    content: [
      '# MAS Interaction Policy',
      '',
      `- ${MAS_POLICY_MARKER}: use a concise, neutral enterprise tone when MAS policy requires it.`,
      `- ${MAS_POLICY_RUNTIME_BOUNDARY_MARKER}: policy guidance never authorizes tools, channels, secrets, or workflows by itself.`,
    ].join('\n'),
    contentSha256: 'b'.repeat(64),
    modifiedAt: '2026-04-17T12:00:00.000Z',
    warnings: [],
    ...overrides,
  };
}

test('readMasPolicySourcesForInvocation reads active MAS policy documents deterministically', async () => {
  const {
    masRootPath,
  } = await createMasRoot();

  await writePolicyFile({
    masRootPath,
    fileName: 'z-later-policy.md',
    content: '# Later Policy\n\n- Later policy guidance.',
  });
  await writePolicyFile({
    masRootPath,
    fileName: 'a-primary-policy.md',
    content: '# Primary Policy\n\n- Primary policy guidance.',
  });
  await writePolicyFile({
    masRootPath,
    fileName: 'draft-policy.json',
    content: JSON.stringify({
      kind: 'mas_policy_source',
      version: 1,
      sourceId: 'draft-policy',
      title: 'Draft Policy',
      lifecycleState: 'draft',
      priority: 1,
      content: 'DRAFT_POLICY_MUST_NOT_REACH_LAYER',
    }, null, 2),
  });

  const result = await readMasPolicySourcesForInvocation({
    masRootPath,
  });

  assert.equal(result.summary.policiesRead, 3);
  assert.equal(result.summary.activePolicies, 2);
  assert.deepEqual(
    result.policySources.map((policySource) => policySource.sourceId),
    ['a-primary-policy', 'z-later-policy'],
  );
  assert.equal(result.policySources[0].title, 'Primary Policy');
  assert.equal(result.policySources[0].sourcePath, 'instance/memory/policies/a-primary-policy.md');
  assert.match(result.policySources[0].contentSha256, /^[a-f0-9]{64}$/u);
  assert.equal(result.policySources.some((policySource) => {
    return policySource.content.includes('DRAFT_POLICY_MUST_NOT_REACH_LAYER');
  }), false);
});

test('buildMasPolicyLayer creates a first-class high-authority prompt layer without runtime authority', () => {
  const layer = buildMasPolicyLayer({
    policySources: [buildPolicySource()],
  });

  assert.equal(layer.layerId, 'mas-level-policy-instructions');
  assert.equal(layer.layerType, 'mas_policy');
  assert.equal(layer.owner, 'mas-instance');
  assert.equal(layer.priority, 15);
  assert.equal(layer.sourceReferences[0].sourceType, 'mas_policy_document');
  assert.equal(layer.sourceReferences[0].sourceId, 'mas-interaction-policy');
  assert.equal(layer.sourceReferences[0].path, 'instance/memory/policies/mas-interaction-policy.md');
  assert.match(layer.content, /MAS-Level Policy Instructions/u);
  assert.match(layer.content, new RegExp(MAS_POLICY_MARKER, 'u'));
  assert.match(layer.content, /They do not grant runtime authority/u);
  assert.match(layer.content, /runtime readiness, bindings, permissions, and audit evidence/u);
});

test('assembleBrainInputForInvocation includes MAS policy before persona and traces it in provenance', async () => {
  const projectRootPath = await createAlfredProbabilisticProjectFixture();

  await writeFile(
    path.join(projectRootPath, 'instance', 'memory', 'policies', 'mas-interaction-policy.md'),
    [
      '# MAS Interaction Policy',
      '',
      `- ${MAS_POLICY_MARKER}: use a concise, neutral enterprise tone even when persona says warm and professional.`,
      `- ${MAS_POLICY_RUNTIME_BOUNDARY_MARKER}: this policy does not grant runtime tool execution.`,
    ].join('\n'),
    'utf8',
  );

  await withEnvironment(
    {
      "openrouter-api-key": 'openrouter-secret',
      "gemini-api-key": 'gemini-secret',
    },
    async () => {
      const bootResult = await runSystemBoot({ projectRootPath });
      const request = {
        operationalIdentityId: 'alfred',
        invocationMode: 'probabilistic',
        command: 'ask',
        inputText: 'How should you answer inside this MAS?',
        requestedBy: 'mas-policy-test',
      };
      const readiness = await prepareAgentInvocation({
        bootResult,
        request,
      });
      const result = await assembleBrainInputForInvocation({
        bootResult,
        readiness,
        request,
        invocationId: 'mas-policy-layer-001',
      });
      const layerTypes = result.instructionLayers.map((layer) => layer.layerType);
      const masPolicyLayer = result.instructionLayers.find((layer) => {
        return layer.layerType === 'mas_policy';
      });
      const provenanceLayer = result.promptProvenance.includedLayers.find((layer) => {
        return layer.layerType === 'mas_policy';
      });
      const serializedProvenance = JSON.stringify(result.promptProvenance);
      const masPolicyIndex = result.brainInput.systemInstructions.indexOf('## MAS-Level Policy Instructions');
      const operationalIdentityIndex = result.brainInput.systemInstructions.indexOf('## Operational Identity');

      assert.deepEqual(
        layerTypes.slice(0, 4),
        [
          'framework_runtime',
          'mas_policy',
          'operational_identity',
          'cognitive_identity',
        ],
      );
      assert.ok(masPolicyLayer);
      assert.ok(provenanceLayer);
      assert.equal(result.instructionLayerSummary.totalLayers, 8);
      assert.equal(result.promptProvenance.includedLayerCount, 8);
      assert.equal(masPolicyIndex > -1, true);
      assert.equal(operationalIdentityIndex > -1, true);
      assert.equal(masPolicyIndex < operationalIdentityIndex, true);
      assert.match(result.brainInput.systemInstructions, new RegExp(MAS_POLICY_MARKER, 'u'));
      assert.match(result.brainInput.systemInstructions, new RegExp(MAS_POLICY_RUNTIME_BOUNDARY_MARKER, 'u'));
      assert.match(result.brainInput.systemInstructions, /They do not grant runtime authority/u);
      assert.equal(provenanceLayer.sourceReferences[0].sourceType, 'mas_policy_document');
      assert.equal(provenanceLayer.sourceReferences[0].path, 'instance/memory/policies/mas-interaction-policy.md');
      assert.equal(provenanceLayer.content, undefined);
      assert.doesNotMatch(serializedProvenance, new RegExp(MAS_POLICY_MARKER, 'u'));
      assert.doesNotMatch(serializedProvenance, /openrouter-secret|gemini-secret/u);
    },
  );
});
