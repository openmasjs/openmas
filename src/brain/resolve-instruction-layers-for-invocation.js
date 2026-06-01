import { assertInstructionLayers } from '../contracts/brain/instruction-layer-contract.js';
import { buildRuntimeCoreLayer } from './build-runtime-core-layer.js';
import { buildMasPolicyLayer } from './build-mas-policy-layer.js';
import {
  buildCognitiveIdentityLayer,
  buildOperationalIdentityLayer,
} from './build-identity-layer.js';
import { buildPolicyLayer } from './build-policy-layer.js';
import { buildCapabilityLayer } from './build-capability-layer.js';
import { buildWorkflowLayer } from './build-workflow-layer.js';
import { buildWorkflowAvailabilityLayer } from './build-workflow-availability-layer.js';
import { buildToolAvailabilityLayer } from './build-tool-availability-layer.js';
import { buildOpenMasOsContextLayer } from './build-openmas-os-context-layer.js';
import { buildOpenMasOsDelegationLayer } from './build-openmas-os-delegation-layer.js';
import { buildExecutionGuardsLayer } from './build-execution-guards-layer.js';
import { buildContextPackLayer } from './build-context-pack-layer.js';
import { buildFewShotLayer } from './build-few-shot-layer.js';

export function resolveInstructionLayersForInvocation({
  operationalIdentity,
  primaryCognitiveIdentity,
  secondaryCognitiveIdentities = [],
  brainReference = null,
  readiness = null,
  masPolicySources = [],
  masPolicyWarnings = [],
  workflowContexts = [],
  workflowWarnings = [],
  workflowRuntimeDefinitions = [],
  workflowRuntimeWarnings = [],
  toolDefinitions = [],
  toolReadinessEvaluation = null,
  toolAvailabilityWarnings = [],
  registeredCognitiveIdentities = [],
  contextPack = null,
  osRuntimeContext = null,
  conversationId = null,
  osDelegationContext = null,
  goldenExampleSets = [],
  goldenExampleWarnings = [],
}) {
  const layers = [
    buildRuntimeCoreLayer({
      brainReference,
      readiness,
    }),
    buildMasPolicyLayer({
      policySources: masPolicySources,
      warnings: masPolicyWarnings,
    }),
    buildOperationalIdentityLayer({ operationalIdentity }),
    buildCognitiveIdentityLayer({
      primaryCognitiveIdentity,
      secondaryCognitiveIdentities,
    }),
    buildPolicyLayer({
      primaryCognitiveIdentity,
      secondaryCognitiveIdentities,
    }),
    buildCapabilityLayer({
      primaryCognitiveIdentity,
      secondaryCognitiveIdentities,
    }),
    buildWorkflowLayer({
      workflowContexts,
      warnings: workflowWarnings,
    }),
    buildWorkflowAvailabilityLayer({
      workflowRuntimeDefinitions,
      warnings: workflowRuntimeWarnings,
    }),
    buildToolAvailabilityLayer({
      toolDefinitions,
      toolReadinessEvaluation,
      warnings: toolAvailabilityWarnings,
    }),
    buildOpenMasOsContextLayer({
      osRuntimeContext,
      conversationId,
    }),
    buildOpenMasOsDelegationLayer({
      delegationContext: osDelegationContext,
    }),
    buildExecutionGuardsLayer({
      brainReference,
      readiness,
      registeredCognitiveIdentities,
    }),
    contextPack
      ? buildContextPackLayer({
        contextPack,
      })
      : null,
    buildFewShotLayer({
      exampleSets: goldenExampleSets,
      warnings: goldenExampleWarnings,
    }),
  ].filter(Boolean);

  return assertInstructionLayers(layers)
    .toSorted((left, right) => {
      if (left.priority !== right.priority) {
        return left.priority - right.priority;
      }

      return left.layerId.localeCompare(right.layerId);
    });
}

export function summarizeInstructionLayers(instructionLayers) {
  const normalizedLayers = assertInstructionLayers(instructionLayers)
    .toSorted((left, right) => {
      if (left.priority !== right.priority) {
        return left.priority - right.priority;
      }

      return left.layerId.localeCompare(right.layerId);
    });

  const warnings = normalizedLayers.flatMap((layer) => {
    return layer.warnings.map((warning) => {
      return {
        layerId: layer.layerId,
        warning,
      };
    });
  });

  return {
    kind: 'instruction_layer_summary',
    version: 1,
    totalLayers: normalizedLayers.length,
    totalContentLength: normalizedLayers.reduce((total, layer) => {
      return total + layer.content.length;
    }, 0),
    layers: normalizedLayers.map((layer) => {
      return {
        layerId: layer.layerId,
        layerType: layer.layerType,
        owner: layer.owner,
        priority: layer.priority,
        sourceReferenceCount: layer.sourceReferences.length,
        contentLength: layer.content.length,
        summary: layer.summary,
        warningCount: layer.warnings.length,
      };
    }),
    warnings,
  };
}
