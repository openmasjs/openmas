import { assertInstructionLayers } from '../contracts/brain/instruction-layer-contract.js';
import {
  buildRuntimeCoreInstructionContent,
  buildRuntimeCoreLayer,
} from './build-runtime-core-layer.js';
import { buildMasPolicyLayer } from './build-mas-policy-layer.js';
import {
  buildCognitiveIdentityLayer,
  buildOperationalIdentityLayer,
} from './build-identity-layer.js';
import { buildPolicyLayer } from './build-policy-layer.js';
import { buildCapabilityLayer } from './build-capability-layer.js';
import { buildExecutionGuardsLayer } from './build-execution-guards-layer.js';

export function buildFrameworkRoleInstructionContent(options = {}) {
  return buildRuntimeCoreInstructionContent(options);
}

export function buildSystemInstructionsFromLayers({ instructionLayers }) {
  return assertInstructionLayers(instructionLayers)
    .toSorted((left, right) => {
      if (left.priority !== right.priority) {
        return left.priority - right.priority;
      }

      return left.layerId.localeCompare(right.layerId);
    })
    .map((layer) => layer.content)
    .join('\n\n');
}

export function buildSystemInstructions({
  operationalIdentity,
  primaryCognitiveIdentity,
  secondaryCognitiveIdentities,
  brainReference = null,
  readiness = null,
  masPolicySources = [],
  masPolicyWarnings = [],
}) {
  const instructionLayers = [
    buildRuntimeCoreLayer({
      brainReference,
      readiness,
    }),
    buildMasPolicyLayer({
      policySources: masPolicySources,
      warnings: masPolicyWarnings,
    }),
    buildOperationalIdentityLayer({
      operationalIdentity,
    }),
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
    buildExecutionGuardsLayer({
      brainReference,
      readiness,
    }),
  ].filter(Boolean);

  return buildSystemInstructionsFromLayers({
    instructionLayers,
  });
}
