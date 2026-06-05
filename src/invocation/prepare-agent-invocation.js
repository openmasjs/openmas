import { createAgentInvocationRequest, assertAgentInvocationReadiness } from '../contracts/identity/agent-invocation-contract.js';
import { isBootReadyForAgentInvocation } from '../contracts/boot/system-boot-contract.js';
import { resolveCognitiveIdentityRoot } from './resolve-cognitive-identity-root.js';
import { readCognitiveIdentityDefinition } from './read-cognitive-identity-definition.js';
import { resolveOperationalIdentityRoot } from '../operational-identities/resolve-operational-identity-root.js';
import { ensureOperationalIdentityRuntimeLayout } from '../operational-identities/ensure-operational-identity-runtime-layout.js';
import { readOperationalIdentityDefinition } from '../operational-identities/read-operational-identity-definition.js';
import { readOperationalIdentityRoutingDefinition } from '../operational-identities/read-operational-identity-routing-definition.js';
import { resolveActiveCognitiveSet } from '../operational-identities/resolve-active-cognitive-set.js';
import { readExecutionProfileDefinition } from '../operational-identities/read-execution-profile-definition.js';
import {
  getExecutionModeCompatibilityError,
  selectBrainForInvocation,
} from '../operational-identities/select-brain-for-invocation.js';
import { readResourcesRegistry } from '../operational-identities/read-resources-registry.js';
import { readBindingDefinitions } from '../operational-identities/read-binding-definitions.js';
import { resolveBindingsForInvocation } from '../operational-identities/resolve-bindings-for-invocation.js';
import { readPermissionDefinitions } from '../operational-identities/read-permission-definitions.js';
import { evaluatePermissionsForInvocation } from '../operational-identities/evaluate-permissions-for-invocation.js';
import { resolveUsableBindingsForInvocation } from '../operational-identities/resolve-usable-bindings-for-invocation.js';
import { readCredentialReferenceRegistry } from '../credential-references/read-credential-reference-registry.js';
import { resolveCredentialReferencesForInvocation } from '../credential-references/resolve-credential-references-for-invocation.js';
import { prepareProviderIntegrationsForInvocation } from '../providers/prepare-provider-integrations-for-invocation.js';
import { readToolDefinitions } from '../tools/read-tool-definitions.js';
import { evaluateToolReadinessForInvocation } from '../tools/evaluate-tool-readiness-for-invocation.js';

const SAFE_DEGRADED_SYSTEM_STEWARD_COMMANDS = new Set([
  'help',
  'hello',
  'status',
  'bootstrap',
  'gap-analysis',
  'inspect',
  'diagnose',
  'memory-health',
]);

function buildNextStep(status) {
  if (status === 'ready') {
    return 'Invocation preflight is ready. Run the requested agent invocation.';
  }

  if (status === 'blocked') {
    return 'Complete the missing invocation prerequisites and rerun the preflight.';
  }

  return 'Inspect the invocation failure, fix the error cause, and rerun the preflight.';
}

function canProceedWithSafeDegradedInvocation({ bootResult, request, primaryCognitiveIdentityId }) {
  return (
    bootResult?.status === 'degraded'
    && primaryCognitiveIdentityId === 'system-steward'
    && SAFE_DEGRADED_SYSTEM_STEWARD_COMMANDS.has(request.command)
  );
}

export async function prepareAgentInvocation({ bootResult, request }) {
  const normalizedRequest = createAgentInvocationRequest(request);

  try {
    if (bootResult.status !== 'degraded' && !isBootReadyForAgentInvocation(bootResult)) {
      const readiness = {
        status: 'blocked',
        request: normalizedRequest,
        bootStatus: bootResult.status,
        resolvedPrimaryCognitiveIdentityId: null,
        resolvedOperationalIdentity: null,
        operationalIdentityDefinition: null,
        resolvedBindings: null,
        usableBindings: null,
        permissionEvaluation: null,
        secretResolution: null,
        providerPreparation: null,
        toolRegistry: null,
        toolReadiness: null,
        auditActorId: null,
        resolvedCognitiveIdentity: null,
        cognitiveIdentityDefinition: null,
        warnings: [],
        errors: ['System Boot is not ready for Agent Invocation.'],
        nextStep: buildNextStep('blocked'),
      };

      return assertAgentInvocationReadiness(readiness);
    }

    let resolvedOperationalIdentity = null;
    let operationalIdentityDefinition = null;
    let operationalIdentityRoutingDefinition = null;
    let executionProfileDefinition = null;
    let brainSelection = null;
    let resolvedBindingsResult = null;
    let usableBindings = null;
    let permissionEvaluationResult = null;
    let secretResolutionResult = null;
    let providerPreparation = null;
    let toolRegistryResult = null;
    let toolReadinessEvaluation = null;
    let resolvedPrimaryCognitiveIdentityId = null;
    let auditActorId = null;
    let activeCognitiveSet = null;

    if (normalizedRequest.operationalIdentityId) {
      resolvedOperationalIdentity = await resolveOperationalIdentityRoot({
        masRootPath: bootResult.masRootPath,
        operationalIdentityId: normalizedRequest.operationalIdentityId,
      });

      const operationalIdentityResult = await readOperationalIdentityDefinition({
        operationalIdentityRootPath: resolvedOperationalIdentity.operationalIdentityRootPath,
      });

      operationalIdentityDefinition = operationalIdentityResult.definition;
      const operationalIdentityRoutingResult = await readOperationalIdentityRoutingDefinition({
        operationalIdentityRootPath: resolvedOperationalIdentity.operationalIdentityRootPath,
      });

      operationalIdentityRoutingDefinition = operationalIdentityRoutingResult.definition;
      auditActorId = operationalIdentityDefinition.auditActorId;
      const executionProfileResult = await readExecutionProfileDefinition({
        operationalIdentityRootPath: resolvedOperationalIdentity.operationalIdentityRootPath,
        expectedExecutionProfileId: operationalIdentityDefinition.executionProfileId,
      });

      executionProfileDefinition = executionProfileResult.definition;
      activeCognitiveSet = resolveActiveCognitiveSet({
        request: normalizedRequest,
        operationalIdentityDefinition,
        routingDefinition: operationalIdentityRoutingDefinition,
      });
      resolvedPrimaryCognitiveIdentityId = activeCognitiveSet.primaryCognitiveIdentityId;

      const executionModeCompatibilityError = getExecutionModeCompatibilityError({
        executionProfileDefinition,
        request: normalizedRequest,
      });

      if (executionModeCompatibilityError) {
        const readiness = {
          status: 'blocked',
          request: normalizedRequest,
          bootStatus: bootResult.status,
          resolvedPrimaryCognitiveIdentityId,
          resolvedOperationalIdentity,
          operationalIdentityDefinition,
          operationalIdentityRoutingDefinition,
          executionProfileDefinition,
          brainSelection: null,
          resolvedBindings: null,
          usableBindings: null,
          permissionEvaluation: null,
          secretResolution: null,
          providerPreparation: null,
          toolRegistry: null,
          toolReadiness: null,
          activeCognitiveSet,
          auditActorId,
          resolvedCognitiveIdentity: null,
          cognitiveIdentityDefinition: null,
          warnings: [],
          errors: [executionModeCompatibilityError],
          nextStep: buildNextStep('blocked'),
        };

        return assertAgentInvocationReadiness(readiness);
      }

      brainSelection = selectBrainForInvocation({
        request: normalizedRequest,
        executionProfileDefinition,
      });

      const resourcesRegistryResult = await readResourcesRegistry({
        masRootPath: bootResult.masRootPath,
      });

      const bindingDefinitionsResult = await readBindingDefinitions({
        operationalIdentityRootPath: resolvedOperationalIdentity.operationalIdentityRootPath,
        expectedOperationalIdentityId: operationalIdentityDefinition.operationalIdentityId,
      });

      if (bindingDefinitionsResult.bindings && resourcesRegistryResult.registry) {
        resolvedBindingsResult = resolveBindingsForInvocation({
          bindingDefinitions: bindingDefinitionsResult.bindings,
          resourceRegistry: resourcesRegistryResult.registry,
          operationalIdentityId: operationalIdentityDefinition.operationalIdentityId,
        });
      }

      const permissionDefinitionsResult = await readPermissionDefinitions({
        operationalIdentityRootPath: resolvedOperationalIdentity.operationalIdentityRootPath,
        expectedOperationalIdentityId: operationalIdentityDefinition.operationalIdentityId,
      });

      if (resolvedBindingsResult && permissionDefinitionsResult.permissions) {
        permissionEvaluationResult = evaluatePermissionsForInvocation({
          resolvedBindings: resolvedBindingsResult.resolvedBindings,
          permissionDefinitions: permissionDefinitionsResult.permissions,
        });
      }

      if (resolvedBindingsResult) {
        usableBindings = resolveUsableBindingsForInvocation({
          resolvedBindings: resolvedBindingsResult.resolvedBindings,
          permissionEvaluation: permissionEvaluationResult,
        });
      }

      if (usableBindings && usableBindings.length > 0) {
        const credentialReferenceRegistryResult = await readCredentialReferenceRegistry({
          projectRootPath: bootResult.projectRootPath,
        });

        if (credentialReferenceRegistryResult.registry) {
          secretResolutionResult = await resolveCredentialReferencesForInvocation({
            projectRootPath: bootResult.projectRootPath,
            usableBindings,
            credentialReferenceRegistry: credentialReferenceRegistryResult.registry,
          });
        }
      }

      providerPreparation = prepareProviderIntegrationsForInvocation({
        usableBindings: usableBindings ?? [],
        secretResolution: secretResolutionResult,
        brainSelection,
      });

      if (operationalIdentityDefinition.lifecycleState !== 'active') {
        const readiness = {
          status: 'blocked',
          request: normalizedRequest,
          bootStatus: bootResult.status,
          resolvedPrimaryCognitiveIdentityId,
          resolvedOperationalIdentity,
          operationalIdentityDefinition,
          operationalIdentityRoutingDefinition,
          executionProfileDefinition,
          brainSelection,
          resolvedBindings: resolvedBindingsResult,
          usableBindings,
          permissionEvaluation: permissionEvaluationResult,
          secretResolution: secretResolutionResult,
          providerPreparation,
          toolRegistry: null,
          toolReadiness: null,
          activeCognitiveSet,
          auditActorId,
          resolvedCognitiveIdentity: null,
          cognitiveIdentityDefinition: null,
          warnings: [],
          errors: [
            `Operational Identity is not active: ${operationalIdentityDefinition.operationalIdentityId} (${operationalIdentityDefinition.lifecycleState}).`,
          ],
          nextStep: buildNextStep('blocked'),
        };

        return assertAgentInvocationReadiness(readiness);
      }

      await ensureOperationalIdentityRuntimeLayout({
        operationalIdentityRootPath: resolvedOperationalIdentity.operationalIdentityRootPath,
      });
    }

    const safeDegradedInvocation = canProceedWithSafeDegradedInvocation({
      bootResult,
      request: normalizedRequest,
      primaryCognitiveIdentityId: resolvedPrimaryCognitiveIdentityId,
    });

    if (!isBootReadyForAgentInvocation(bootResult) && !safeDegradedInvocation) {
      const readiness = {
        status: 'blocked',
        request: normalizedRequest,
        bootStatus: bootResult.status,
        resolvedPrimaryCognitiveIdentityId,
        resolvedOperationalIdentity,
        operationalIdentityDefinition,
        operationalIdentityRoutingDefinition,
        executionProfileDefinition,
        brainSelection,
        resolvedBindings: resolvedBindingsResult,
        usableBindings,
        permissionEvaluation: permissionEvaluationResult,
        secretResolution: secretResolutionResult,
        providerPreparation,
        toolRegistry: null,
        toolReadiness: null,
        activeCognitiveSet,
        auditActorId,
        resolvedCognitiveIdentity: null,
        cognitiveIdentityDefinition: null,
        warnings: [],
        errors: ['System Boot is not ready for Agent Invocation.'],
        nextStep: buildNextStep('blocked'),
      };

      return assertAgentInvocationReadiness(readiness);
    }

    const resolvedCognitiveIdentity = await resolveCognitiveIdentityRoot({
      masRootPath: bootResult.masRootPath,
      cognitiveIdentityId: resolvedPrimaryCognitiveIdentityId,
    });

    if (operationalIdentityDefinition) {
      toolRegistryResult = await readToolDefinitions({
        masRootPath: bootResult.masRootPath,
      });
      toolReadinessEvaluation = evaluateToolReadinessForInvocation({
        toolDefinitions: toolRegistryResult.toolDefinitions,
        resolvedBindings: resolvedBindingsResult?.resolvedBindings ?? [],
        permissionEvaluation: permissionEvaluationResult,
        secretResolution: secretResolutionResult,
      });
    }

    const cognitiveIdentityDefinition = await readCognitiveIdentityDefinition({
      cognitiveIdentityRootPath: resolvedCognitiveIdentity.cognitiveIdentityRootPath,
    });

    const warnings = cognitiveIdentityDefinition.missingOptionalComponents.map((component) => {
      return `Optional Cognitive Identity component is missing: ${component}`;
    });

    if (safeDegradedInvocation) {
      warnings.push('Invocation is proceeding under a degraded boot because the System Steward command is considered safe for diagnostics.');
    }

    if (resolvedBindingsResult) {
      warnings.push(...resolvedBindingsResult.warnings);
    }

    if (permissionEvaluationResult) {
      const deniedBindings = permissionEvaluationResult.evaluatedBindings.filter(
        (decision) => decision.effect === 'deny',
      );

      for (const denied of deniedBindings) {
        warnings.push(`Permission denied for resource ${denied.resourceId} (${denied.accessMode}): ${denied.reason}`);
      }
    }

    if (secretResolutionResult && brainSelection?.brainRequired === true) {
      warnings.push(...secretResolutionResult.warnings);
    }

    if (toolRegistryResult) {
      warnings.push(...toolRegistryResult.warnings);
    }

    if (toolReadinessEvaluation) {
      warnings.push(...toolReadinessEvaluation.warnings);
    }

    const errors = cognitiveIdentityDefinition.missingRequiredComponents.map((component) => {
      return `Required Cognitive Identity component is missing: ${component}`;
    });

    const readiness = {
      status: errors.length > 0 ? 'blocked' : 'ready',
      request: normalizedRequest,
      bootStatus: bootResult.status,
      resolvedPrimaryCognitiveIdentityId,
      resolvedOperationalIdentity,
      operationalIdentityDefinition,
      operationalIdentityRoutingDefinition,
      executionProfileDefinition,
      brainSelection,
      resolvedBindings: resolvedBindingsResult,
      usableBindings,
      permissionEvaluation: permissionEvaluationResult,
      secretResolution: secretResolutionResult,
      providerPreparation,
      toolRegistry: toolRegistryResult,
      toolReadiness: toolReadinessEvaluation,
      activeCognitiveSet,
      auditActorId,
      resolvedCognitiveIdentity,
      cognitiveIdentityDefinition,
      warnings,
      errors,
      nextStep: buildNextStep(errors.length > 0 ? 'blocked' : 'ready'),
    };

    return assertAgentInvocationReadiness(readiness);
  } catch (error) {
    const readiness = {
      status: 'failed',
      request: normalizedRequest,
      bootStatus: bootResult?.status ?? 'failed',
      resolvedPrimaryCognitiveIdentityId: null,
      resolvedOperationalIdentity: null,
      operationalIdentityDefinition: null,
      operationalIdentityRoutingDefinition: null,
      executionProfileDefinition: null,
      brainSelection: null,
      resolvedBindings: null,
      usableBindings: null,
      permissionEvaluation: null,
      secretResolution: null,
      providerPreparation: null,
      toolRegistry: null,
      toolReadiness: null,
      activeCognitiveSet: null,
      auditActorId: null,
      resolvedCognitiveIdentity: null,
      cognitiveIdentityDefinition: null,
      warnings: [],
      errors: [error.message],
      nextStep: buildNextStep('failed'),
    };

    return assertAgentInvocationReadiness(readiness);
  }
}
