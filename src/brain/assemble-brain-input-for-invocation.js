import { assertBrainInput } from '../contracts/brain/brain-input-contract.js';
import { resolveCognitiveIdentityRoot } from '../invocation/resolve-cognitive-identity-root.js';
import { readCognitiveIdentityContext } from './read-cognitive-identity-context.js';
import { buildSystemInstructionsFromLayers } from './build-system-instructions.js';
import { buildUserInput } from './build-user-input.js';
import { buildToolObservationLayer } from './build-tool-observation-layer.js';
import { buildToolObservationFollowupInput } from './build-tool-observation-followup-input.js';
import { buildWorkflowObservationLayer } from './build-workflow-observation-layer.js';
import { buildWorkflowObservationFollowupInput } from './build-workflow-observation-followup-input.js';
import { buildProviderRequest } from './build-provider-request.js';
import { buildPromptProvenance } from './build-prompt-provenance.js';
import { buildContextPackForInvocation } from '../context/build-context-pack-for-invocation.js';
import { readWorkflowInstructionsForInvocation } from '../workflows/read-workflow-instructions-for-invocation.js';
import { readWorkflowRuntimeDefinitions } from '../workflows/read-workflow-runtime-definitions.js';
import { readGoldenExamplesForInvocation } from '../examples/read-golden-examples-for-invocation.js';
import { applyPromptBudgetToInstructionLayers } from './apply-prompt-budget-to-instruction-layers.js';
import { readPromptProfileForInvocation } from '../prompt-profiles/read-prompt-profile-for-invocation.js';
import { readMasPolicySourcesForInvocation } from '../policies/read-mas-policy-sources-for-invocation.js';
import { readCognitiveIdentitiesRegistry } from '../invocation/read-cognitive-identities-registry.js';
import { resolveOpenMasOsDelegationContextForInvocation } from './resolve-openmas-os-delegation-context-for-invocation.js';
import {
  resolveInstructionLayersForInvocation,
  summarizeInstructionLayers,
} from './resolve-instruction-layers-for-invocation.js';

async function resolveCognitiveIdentityContext({ masRootPath, cognitiveIdentityId }) {
  const resolvedCognitiveIdentity = await resolveCognitiveIdentityRoot({
    masRootPath,
    cognitiveIdentityId,
  });

  const normalizedCognitiveIdentityRootPath = resolvedCognitiveIdentity.registryEntry.rootPath
    .replaceAll('\\', '/')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');
  const context = await readCognitiveIdentityContext({
    cognitiveIdentityRootPath: resolvedCognitiveIdentity.cognitiveIdentityRootPath,
    cognitiveIdentityId,
  });

  return {
    ...context,
    sourcePaths: {
      identity: `instance/cognitive-identities/${normalizedCognitiveIdentityRootPath}/identity.md`,
      policies: `instance/cognitive-identities/${normalizedCognitiveIdentityRootPath}/policies.md`,
      capabilities: `instance/cognitive-identities/${normalizedCognitiveIdentityRootPath}/capabilities.md`,
    },
  };
}

export async function assembleBrainInputForInvocation({
  bootResult,
  readiness,
  request,
  invocationId,
  brainReference = readiness?.brainSelection?.selectedBrain,
  promptBudgetPolicy = undefined,
  brainToolExecution = null,
  brainWorkflowExecution = null,
}) {
  if (!bootResult?.masRootPath) {
    throw new Error('Brain Input assembly requires bootResult.masRootPath.');
  }

  if (!readiness?.activeCognitiveSet?.primaryCognitiveIdentityId) {
    throw new Error('Brain Input assembly requires an active primary cognitive identity.');
  }

  if (!brainReference) {
    throw new Error('Brain Input assembly requires a brain reference.');
  }

  if (typeof invocationId !== 'string' || invocationId.trim().length === 0) {
    throw new Error('Brain Input assembly requires a non-empty invocationId.');
  }

  const primaryCognitiveIdentity = await resolveCognitiveIdentityContext({
    masRootPath: bootResult.masRootPath,
    cognitiveIdentityId: readiness.activeCognitiveSet.primaryCognitiveIdentityId,
  });

  const secondaryCognitiveIdentities = [];

  for (const cognitiveIdentityId of readiness.activeCognitiveSet.secondaryCognitiveIdentityIds ?? []) {
    secondaryCognitiveIdentities.push(await resolveCognitiveIdentityContext({
      masRootPath: bootResult.masRootPath,
      cognitiveIdentityId,
    }));
  }

  const operationalIdentity = readiness.operationalIdentityDefinition
    ? {
      operationalIdentityId: readiness.operationalIdentityDefinition.operationalIdentityId,
      displayName: readiness.operationalIdentityDefinition.displayName,
      persona: readiness.operationalIdentityDefinition.persona ?? null,
    }
    : null;
  const contextPack = await buildContextPackForInvocation({
    bootResult,
    readiness,
    request,
    invocationId,
  });
  const osDelegationContext = await resolveOpenMasOsDelegationContextForInvocation({
    bootResult,
    readiness,
    request,
  });
  const masPolicyResolution = await readMasPolicySourcesForInvocation({
    masRootPath: bootResult.masRootPath,
  });
  const workflowInstructionResolution = await readWorkflowInstructionsForInvocation({
    masRootPath: bootResult.masRootPath,
    readiness,
    request,
  });
  const workflowRuntimeResolution = await readWorkflowRuntimeDefinitions({
    masRootPath: bootResult.masRootPath,
  });
  const goldenExampleResolution = await readGoldenExamplesForInvocation({
    masRootPath: bootResult.masRootPath,
    readiness,
    request,
  });
  const promptProfileResolution = await readPromptProfileForInvocation({
    masRootPath: bootResult.masRootPath,
    readiness,
    request,
    brainReference,
  });
  let registeredCognitiveIdentities = [];

  try {
    const cognitiveIdentityRegistryResolution = await readCognitiveIdentitiesRegistry({
      masRootPath: bootResult.masRootPath,
    });

    registeredCognitiveIdentities = cognitiveIdentityRegistryResolution.registry.cognitiveIdentities.map((entry) => {
      return {
        cognitiveIdentityId: entry.cognitiveIdentityId,
        rootPath: entry.rootPath,
      };
    });
  } catch {
    registeredCognitiveIdentities = [];
  }
  const resolvedInstructionLayers = resolveInstructionLayersForInvocation({
    operationalIdentity,
    primaryCognitiveIdentity,
    secondaryCognitiveIdentities,
    brainReference,
    readiness,
    masPolicySources: masPolicyResolution.policySources,
    masPolicyWarnings: masPolicyResolution.warnings,
    workflowContexts: workflowInstructionResolution.workflowContexts,
    workflowWarnings: workflowInstructionResolution.warnings,
    workflowRuntimeDefinitions: workflowRuntimeResolution.workflowRuntimeDefinitions,
    workflowRuntimeWarnings: workflowRuntimeResolution.warnings,
    toolDefinitions: readiness.toolRegistry?.toolDefinitions ?? [],
    toolReadinessEvaluation: readiness.toolReadiness ?? null,
    toolAvailabilityWarnings: readiness.toolRegistry?.warnings ?? [],
    registeredCognitiveIdentities,
    contextPack,
    osRuntimeContext: request.osRuntimeContext,
    conversationId: request.conversationId,
    osDelegationContext,
    goldenExampleSets: goldenExampleResolution.exampleSets,
    goldenExampleWarnings: goldenExampleResolution.warnings,
  });
  const toolObservationLayer = brainToolExecution?.observation
    ? buildToolObservationLayer({
      brainToolExecution,
      masRootPath: bootResult.masRootPath,
    })
    : null;
  const workflowObservationLayer = brainWorkflowExecution?.observation
    ? buildWorkflowObservationLayer({
      brainWorkflowExecution,
      masRootPath: bootResult.masRootPath,
    })
    : null;
  const observationLayers = [
    toolObservationLayer,
    workflowObservationLayer,
  ].filter(Boolean);
  const instructionLayersBeforeBudget = observationLayers.length > 0
    ? [...resolvedInstructionLayers, ...observationLayers]
    : resolvedInstructionLayers;
  const {
    instructionLayers,
    promptBudgetReport,
  } = applyPromptBudgetToInstructionLayers({
    instructionLayers: instructionLayersBeforeBudget,
    promptBudgetPolicy: promptBudgetPolicy ?? promptProfileResolution.promptProfile.promptBudgetPolicy ?? undefined,
  });
  const instructionLayerSummary = summarizeInstructionLayers(instructionLayers);
  const systemInstructions = buildSystemInstructionsFromLayers({ instructionLayers });
  const userInput = (() => {
    if (brainToolExecution?.observation) {
      return buildToolObservationFollowupInput({
        request,
        activeCognitiveSet: readiness.activeCognitiveSet,
        brainToolObservation: brainToolExecution.observation,
      });
    }

    if (brainWorkflowExecution?.observation) {
      return buildWorkflowObservationFollowupInput({
        request,
        activeCognitiveSet: readiness.activeCognitiveSet,
        brainWorkflowObservation: brainWorkflowExecution.observation,
      });
    }

    return buildUserInput({
      request,
      activeCognitiveSet: readiness.activeCognitiveSet,
    });
  })();

  const brainInput = assertBrainInput({
    promptProfileId: promptProfileResolution.promptProfile.promptProfileId,
    promptStackVersionId: promptProfileResolution.promptProfile.promptStackVersionId,
    operationalIdentityId: readiness.operationalIdentityDefinition?.operationalIdentityId ?? null,
    operationalDisplayName: readiness.operationalIdentityDefinition?.displayName ?? null,
    persona: readiness.operationalIdentityDefinition?.persona ?? null,
    providerId: brainReference.providerId,
    modelId: brainReference.modelId,
    primaryCognitiveIdentityId: readiness.activeCognitiveSet.primaryCognitiveIdentityId,
    secondaryCognitiveIdentityIds: readiness.activeCognitiveSet.secondaryCognitiveIdentityIds ?? [],
    primaryCognitiveIdentity,
    secondaryCognitiveIdentities,
    command: request.command,
    requestedBy: request.requestedBy,
    inputText: request.inputText ?? '',
    systemInstructions,
    userInput,
    assistantPrimer: null,
    messages: [
      {
        role: 'system',
        content: systemInstructions,
      },
      {
        role: 'user',
        content: userInput,
      },
    ],
  });

  const providerRequest = buildProviderRequest({ brainInput });
  const promptProvenance = buildPromptProvenance({
    instructionLayers,
    brainInput,
    providerRequest,
    promptProfileId: promptProfileResolution.promptProfile.promptProfileId,
    promptStackVersionId: promptProfileResolution.promptProfile.promptStackVersionId,
    warnings: [
      ...masPolicyResolution.warnings,
      ...promptProfileResolution.warnings,
      ...promptBudgetReport.warnings,
    ],
  });

  return {
    brainInput,
    providerRequest,
    contextPack,
    masPolicySources: masPolicyResolution.policySources,
    masPolicyWarnings: masPolicyResolution.warnings,
    instructionLayers,
    workflowRuntimeDefinitions: workflowRuntimeResolution.workflowRuntimeDefinitions,
    workflowRuntimeWarnings: workflowRuntimeResolution.warnings,
    instructionLayerSummary,
    promptProfileSelection: promptProfileResolution.selectionReport,
    promptBudgetReport,
    promptProvenance,
  };
}
