import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertInstructionLayer,
  assertInstructionLayers,
} from '../../src/contracts/brain/instruction-layer-contract.js';
import {
  buildSystemInstructions,
  buildSystemInstructionsFromLayers,
} from '../../src/brain/build-system-instructions.js';
import {
  buildRuntimeCoreInstructionContent,
  buildRuntimeCoreLayer,
} from '../../src/brain/build-runtime-core-layer.js';
import {
  buildCognitiveIdentityLayer,
  buildOperationalIdentityLayer,
} from '../../src/brain/build-identity-layer.js';
import { buildPolicyLayer } from '../../src/brain/build-policy-layer.js';
import { buildCapabilityLayer } from '../../src/brain/build-capability-layer.js';
import { buildExecutionGuardsLayer } from '../../src/brain/build-execution-guards-layer.js';
import {
  resolveInstructionLayersForInvocation,
  summarizeInstructionLayers,
} from '../../src/brain/resolve-instruction-layers-for-invocation.js';

function createOperationalIdentity() {
  return {
    operationalIdentityId: 'maria',
    displayName: 'Maria',
    persona: {
      tone: 'enthusiastic',
      presentationStyle: 'warm and friendly',
    },
  };
}

function createCognitiveIdentityContext(cognitiveIdentityId, label) {
  return {
    cognitiveIdentityId,
    identityText: `# ${label}\n\n${label} identity guidance.`,
    policiesText: `# Policies\n\n- ${label} policy guidance.`,
    capabilitiesText: `# Capabilities\n\n- ${label} capability guidance.`,
    sourcePaths: {
      identity: `instance/cognitive-identities/${cognitiveIdentityId}/identity.md`,
      policies: `instance/cognitive-identities/${cognitiveIdentityId}/policies.md`,
      capabilities: `instance/cognitive-identities/${cognitiveIdentityId}/capabilities.md`,
    },
  };
}

function createReadinessWithPermissionEvaluation() {
  return {
    operationalIdentityDefinition: {
      operationalIdentityId: 'maria',
    },
    brainSelection: {
      fallbackBrain: {
        providerId: 'gemini-api',
        modelId: 'gemini-flash-latest',
      },
    },
    permissionEvaluation: {
      evaluatedBindings: [
        {
          resourceId: 'instagram-api',
          accessMode: 'publish',
          effect: 'deny',
          matchedRuleId: 'allow-instagram-publish',
          reason: 'Allow rule allow-instagram-publish matched, but binding state is not active: draft.',
        },
      ],
      summary: {
        totalEvaluated: 2,
        allowed: 1,
        denied: 1,
      },
      allPermitted: false,
    },
  };
}

test('assertInstructionLayer normalizes a valid instruction layer', () => {
  const layer = assertInstructionLayer({
    layerId: ' runtime-core ',
    layerType: ' framework_runtime ',
    owner: ' openmas-framework ',
    priority: 10,
    sourceReferences: [
      {
        sourceType: ' framework_runtime ',
        sourceId: ' openmas-runtime-core ',
      },
    ],
    content: ' Runtime guidance. ',
    summary: ' Core runtime instructions. ',
    warnings: [],
  });

  assert.equal(layer.kind, 'instruction_layer');
  assert.equal(layer.version, 1);
  assert.equal(layer.layerId, 'runtime-core');
  assert.equal(layer.layerType, 'framework_runtime');
  assert.equal(layer.sourceReferences[0].path, null);
  assert.equal(layer.content, 'Runtime guidance.');
});

test('assertInstructionLayers rejects duplicate layer IDs', () => {
  const layer = {
    layerId: 'runtime-core',
    layerType: 'framework_runtime',
    owner: 'openmas-framework',
    priority: 10,
    sourceReferences: [
      {
        sourceType: 'framework_runtime',
        sourceId: 'openmas-runtime-core',
      },
    ],
    content: 'Runtime guidance.',
    warnings: [],
  };

  assert.throws(() => {
    assertInstructionLayers([layer, layer]);
  }, /duplicate layerId/);
});

test('resolveInstructionLayersForInvocation produces stable ordered layers', () => {
  const operationalIdentity = createOperationalIdentity();
  const primaryCognitiveIdentity = createCognitiveIdentityContext('community-manager', 'Community Manager');
  const secondaryCognitiveIdentities = [
    createCognitiveIdentityContext('copywriter-senior', 'Copywriter Senior'),
  ];

  const instructionLayers = resolveInstructionLayersForInvocation({
    operationalIdentity,
    primaryCognitiveIdentity,
    secondaryCognitiveIdentities,
  });

  assert.deepEqual(
    instructionLayers.map((layer) => layer.layerType),
    [
      'framework_runtime',
      'operational_identity',
      'cognitive_identity',
      'policy',
      'capability',
      'execution_guard',
    ],
  );
  assert.deepEqual(
    instructionLayers.map((layer) => layer.priority),
    [10, 20, 30, 40, 50, 70],
  );
  assert.equal(instructionLayers[1].owner, 'maria');
  assert.equal(instructionLayers[2].sourceReferences[0].sourceId, 'community-manager:identity.md');
  assert.equal(instructionLayers[2].sourceReferences[1].sourceId, 'copywriter-senior:identity.md');
  assert.equal(instructionLayers[3].sourceReferences[0].sourceId, 'community-manager:policies.md');
  assert.equal(instructionLayers[4].sourceReferences[1].sourceId, 'copywriter-senior:capabilities.md');
  assert.equal(instructionLayers[5].layerId, 'execution-guards');
});

test('resolveInstructionLayersForInvocation exposes allowed OS delegation targets as Operational Identities', () => {
  const operationalIdentity = {
    operationalIdentityId: 'alfred',
    displayName: 'Alfred',
  };
  const primaryCognitiveIdentity = createCognitiveIdentityContext('system-steward', 'System Steward');
  const instructionLayers = resolveInstructionLayersForInvocation({
    operationalIdentity,
    primaryCognitiveIdentity,
    osDelegationContext: {
      allowedDelegationTargets: [
        {
          ruleId: 'allow-alfred-to-bruce-probabilistic-ask',
          description: 'Allows Alfred to delegate MAS inspection to Bruce.',
          actionTypes: ['delegate'],
          commands: ['ask'],
          modes: ['probabilistic'],
          target: {
            operationalIdentityId: 'bruce',
            displayName: 'Bruce',
            lifecycleState: 'active',
            roleLabel: 'Evaluation & Audit Reviewer',
            operationalScope: ['review', 'audit'],
            attachedCognitiveIdentityIds: ['evaluation-audit-steward'],
          },
        },
      ],
      warnings: [],
    },
  });
  const delegationLayer = instructionLayers.find((layer) => {
    return layer.layerId === 'openmas-os-delegation-context';
  });

  assert.equal(delegationLayer.layerType, 'delegation_context');
  assert.equal(delegationLayer.priority, 63);
  assert.match(delegationLayer.content, /Bruce \(bruce\)/u);
  assert.match(delegationLayer.content, /Delegation targets are Operational Identities/u);
  assert.match(delegationLayer.content, /allow-alfred-to-bruce-probabilistic-ask/u);
});

test('buildRuntimeCoreLayer creates independently inspectable framework guidance', () => {
  const layer = buildRuntimeCoreLayer({
    brainReference: {
      providerId: 'openrouter-api',
      modelId: 'openrouter/free',
    },
    readiness: {
      brainSelection: {
        fallbackBrain: {
          providerId: 'gemini-api',
          modelId: 'gemini-flash-latest',
        },
      },
    },
  });

  assert.equal(layer.layerId, 'framework-runtime-core');
  assert.equal(layer.layerType, 'framework_runtime');
  assert.equal(layer.owner, 'openmas-framework');
  assert.equal(layer.priority, 10);
  assert.equal(layer.sourceReferences[0].path, 'src/brain/build-runtime-core-layer.js');
  assert.deepEqual(
    layer.sourceReferences.map((sourceReference) => sourceReference.sourceType),
    [
      'framework_runtime',
      'brain_reference',
      'brain_reference',
    ],
  );
  assert.equal(layer.sourceReferences[1].sourceId, 'current:openrouter-api:openrouter/free');
  assert.equal(layer.sourceReferences[2].sourceId, 'fallback:gemini-api:gemini-flash-latest');
  assert.match(layer.content, /Framework Runtime Core/);
  assert.match(layer.content, /Operational Identity is the acting AI Agent identity/u);
  assert.match(layer.content, /Cognitive Identities provide resolved expertise/u);
  assert.match(layer.content, /Traceability Guidance/);
  assert.match(layer.content, /Uncertainty Guidance/);
  assert.match(layer.content, /Resource And Permission Caution/);
  assert.match(layer.content, /Provider And Fallback Awareness/);
  assert.match(layer.content, /Current Brain Provider: openrouter-api/);
  assert.match(layer.content, /Fallback Brain Provider: gemini-api/);
});

test('buildRuntimeCoreInstructionContent degrades safely without provider metadata', () => {
  const content = buildRuntimeCoreInstructionContent();

  assert.match(content, /Current Brain Provider: not resolved/);
  assert.match(content, /Current Brain Model: not resolved/);
  assert.match(content, /Fallback Brain Configured: no/);
});

test('identity, policy, and capability builders split cognitive content by responsibility', () => {
  const operationalIdentity = createOperationalIdentity();
  const primaryCognitiveIdentity = createCognitiveIdentityContext('community-manager', 'Community Manager');
  const secondaryCognitiveIdentities = [
    createCognitiveIdentityContext('copywriter-senior', 'Copywriter Senior'),
  ];

  const operationalIdentityLayer = buildOperationalIdentityLayer({
    operationalIdentity,
  });
  const cognitiveIdentityLayer = buildCognitiveIdentityLayer({
    primaryCognitiveIdentity,
    secondaryCognitiveIdentities,
  });
  const policyLayer = buildPolicyLayer({
    primaryCognitiveIdentity,
    secondaryCognitiveIdentities,
  });
  const capabilityLayer = buildCapabilityLayer({
    primaryCognitiveIdentity,
    secondaryCognitiveIdentities,
  });

  assert.equal(operationalIdentityLayer.layerType, 'operational_identity');
  assert.equal(cognitiveIdentityLayer.layerType, 'cognitive_identity');
  assert.equal(policyLayer.layerType, 'policy');
  assert.equal(capabilityLayer.layerType, 'capability');
  assert.match(cognitiveIdentityLayer.content, /Community Manager identity guidance/);
  assert.match(operationalIdentityLayer.content, /Acting Agent Name: Maria/u);
  assert.match(operationalIdentityLayer.content, /identify yourself as Maria/u);
  assert.match(operationalIdentityLayer.content, /not your operational name and not a separate acting Agent/u);
  assert.doesNotMatch(cognitiveIdentityLayer.content, /policy guidance/);
  assert.doesNotMatch(cognitiveIdentityLayer.content, /capability guidance/);
  assert.match(policyLayer.content, /Community Manager policy guidance/);
  assert.doesNotMatch(policyLayer.content, /capability guidance/);
  assert.match(capabilityLayer.content, /Copywriter Senior capability guidance/);
  assert.equal(cognitiveIdentityLayer.sourceReferences[0].path, 'instance/cognitive-identities/community-manager/identity.md');
  assert.equal(policyLayer.sourceReferences[1].path, 'instance/cognitive-identities/copywriter-senior/policies.md');
  assert.equal(capabilityLayer.sourceReferences[1].path, 'instance/cognitive-identities/copywriter-senior/capabilities.md');
});

test('buildExecutionGuardsLayer creates prompt-level guardrails from runtime safety context', () => {
  const layer = buildExecutionGuardsLayer({
    brainReference: {
      providerId: 'openrouter-api',
      modelId: 'openrouter/free',
    },
    readiness: createReadinessWithPermissionEvaluation(),
    registeredCognitiveIdentities: [
      {
        cognitiveIdentityId: 'system-steward',
        rootPath: 'system-steward',
      },
      {
        cognitiveIdentityId: 'evaluation-audit-steward',
        rootPath: 'stewards/evaluation-audit',
      },
    ],
  });

  assert.equal(layer.layerId, 'execution-guards');
  assert.equal(layer.layerType, 'execution_guard');
  assert.equal(layer.owner, 'openmas-framework');
  assert.equal(layer.priority, 70);
  assert.match(layer.content, /Stop Conditions/);
  assert.match(layer.content, /Escalation Behavior/);
  assert.match(layer.content, /Confidence Caution/);
  assert.match(layer.content, /Permission Caution/);
  assert.match(layer.content, /Provider And Fallback Awareness/);
  assert.match(layer.content, /keep the answer bounded to runtime-known affordances, artifacts, and paths/i);
  assert.match(layer.content, /Do not invent tool ids, workflow ids, report names, filesystem paths, logs, providers, metrics, or evidence locations/i);
  assert.match(layer.content, /Live Registered Cognitive Identities: evaluation-audit-steward, system-steward\./i);
  assert.match(layer.content, /Recommend a specialist handoff only when the target cognitive identity is explicitly live in the MAS registry/i);
  assert.match(layer.content, /audit_report, evidence_gap_report, and policy_compliance_report/i);
  assert.match(layer.content, /Do not promise concrete future filenames such as audit_report\.json/i);
  assert.match(layer.content, /instance\/memory\/state\/agent-invocation-\*\.json/i);
  assert.match(layer.content, /"kind":"action_claim_declaration"/);
  assert.match(layer.content, /Do not append any action-claim envelope for greetings, acknowledgments, capability explanations, or preview-only drafts that did not execute/i);
  assert.match(layer.content, /Do not use legacy shorthand such as claimType "execution"/);
  assert.match(layer.content, /Denied: 1/);
  assert.match(layer.content, /instagram-api \(publish\)/);
  assert.match(layer.content, /Fallback Brain Provider: gemini-api/);
  assert.deepEqual(
    layer.sourceReferences.map((sourceReference) => sourceReference.sourceType),
    [
      'framework_runtime',
      'runtime_readiness',
      'operational_identity_permissions',
      'operational_identity_bindings',
      'resource_registry',
      'permission_evaluation',
      'brain_reference',
      'brain_reference',
      'cognitive_identity_registry',
    ],
  );
});

test('buildSystemInstructionsFromLayers assembles split prompt layers in priority order', () => {
  const operationalIdentity = createOperationalIdentity();
  const primaryCognitiveIdentity = createCognitiveIdentityContext('community-manager', 'Community Manager');
  const secondaryCognitiveIdentities = [
    createCognitiveIdentityContext('copywriter-senior', 'Copywriter Senior'),
  ];

  const instructionLayers = resolveInstructionLayersForInvocation({
    operationalIdentity,
    primaryCognitiveIdentity,
    secondaryCognitiveIdentities,
  });

  const layeredInstructions = buildSystemInstructionsFromLayers({
    instructionLayers,
  });
  const legacyInstructions = buildSystemInstructions({
    operationalIdentity,
    primaryCognitiveIdentity,
    secondaryCognitiveIdentities,
  });

  assert.equal(layeredInstructions, legacyInstructions);
  assert.match(layeredInstructions, /Framework Runtime Core/);
  assert.match(layeredInstructions, /Operational Identity/);
  assert.match(layeredInstructions, /Primary Cognitive Identity/);
  assert.match(layeredInstructions, /Secondary Cognitive Identities/);
  assert.match(layeredInstructions, /Policy Instructions/);
  assert.match(layeredInstructions, /Capability Instructions/);
  assert.match(layeredInstructions, /Execution Guards/);
});

test('summarizeInstructionLayers excludes full prompt content', () => {
  const instructionLayers = resolveInstructionLayersForInvocation({
    operationalIdentity: createOperationalIdentity(),
    primaryCognitiveIdentity: createCognitiveIdentityContext('community-manager', 'Community Manager'),
    secondaryCognitiveIdentities: [
      createCognitiveIdentityContext('copywriter-senior', 'Copywriter Senior'),
    ],
  });

  const summary = summarizeInstructionLayers(instructionLayers);

  assert.equal(summary.kind, 'instruction_layer_summary');
  assert.equal(summary.totalLayers, 6);
  assert.ok(summary.totalContentLength > 0);
  assert.equal(summary.layers[0].content, undefined);
  assert.equal(summary.layers[0].contentLength, instructionLayers[0].content.length);
  assert.equal(summary.layers.at(-1).layerType, 'execution_guard');
  assert.deepEqual(summary.warnings, []);
});
