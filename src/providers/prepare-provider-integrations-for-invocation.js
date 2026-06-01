import { assertProviderIntegrationPreparation } from '../contracts/providers/provider-integration-contract.js';

function findUsableBinding({ usableBindings, resourceId, accessMode }) {
  return usableBindings.find((binding) => {
    return binding.resourceId === resourceId && binding.accessMode === accessMode;
  }) ?? null;
}

function findSecretResolution({ secretResolution, credentialReferenceId }) {
  if (!secretResolution || !credentialReferenceId) {
    return null;
  }

  return secretResolution.resolvedCredentialReferences.find((entry) => {
    return entry.credentialReferenceId === credentialReferenceId;
  }) ?? null;
}

function prepareBrainProvider({ brainReference, usableBindings, secretResolution, roleLabel }) {
  if (!brainReference) {
    return null;
  }

  const providerBinding = findUsableBinding({
    usableBindings,
    resourceId: brainReference.providerId,
    accessMode: 'execute',
  });

  if (!providerBinding) {
    return {
      brainId: brainReference.brainId,
      providerId: brainReference.providerId,
      modelId: brainReference.modelId,
      resourceId: null,
      credentialReferenceId: null,
      secretResolutionStatus: null,
      status: 'not_ready',
      reason: `No usable execute binding is available for the ${roleLabel} brain provider ${brainReference.providerId}.`,
    };
  }

  if (!providerBinding.credentialReferenceId) {
    return {
      brainId: brainReference.brainId,
      providerId: brainReference.providerId,
      modelId: brainReference.modelId,
      resourceId: providerBinding.resourceId,
      credentialReferenceId: null,
      secretResolutionStatus: null,
      status: 'not_ready',
      reason: `Provider binding ${providerBinding.resourceId} does not define a credentialReferenceId.`,
    };
  }

  const secretResolutionEntry = findSecretResolution({
    secretResolution,
    credentialReferenceId: providerBinding.credentialReferenceId,
  });

  if (!secretResolutionEntry || secretResolutionEntry.resolutionStatus !== 'resolved') {
    return {
      brainId: brainReference.brainId,
      providerId: brainReference.providerId,
      modelId: brainReference.modelId,
      resourceId: providerBinding.resourceId,
      credentialReferenceId: providerBinding.credentialReferenceId,
      secretResolutionStatus: secretResolutionEntry?.resolutionStatus ?? 'unresolved',
      status: 'not_ready',
      reason: `Credential Reference ${providerBinding.credentialReferenceId} is not resolved for provider ${providerBinding.resourceId}.`,
    };
  }

  return {
    brainId: brainReference.brainId,
    providerId: brainReference.providerId,
    modelId: brainReference.modelId,
    resourceId: providerBinding.resourceId,
    credentialReferenceId: providerBinding.credentialReferenceId,
    secretResolutionStatus: secretResolutionEntry.resolutionStatus,
    status: 'ready',
    reason: `Provider ${providerBinding.resourceId} is ready for future invocation through credential reference ${providerBinding.credentialReferenceId}.`,
  };
}

function prepareChannelProviders({ usableBindings, secretResolution }) {
  return usableBindings
    .filter((binding) => {
      return binding.resourceType === 'channel';
    })
    .map((binding) => {
      if (!binding.credentialReferenceId) {
        return {
          resourceId: binding.resourceId,
          accessMode: binding.accessMode,
          credentialReferenceId: null,
          secretResolutionStatus: null,
          status: 'not_ready',
          reason: `Channel binding ${binding.resourceId} does not define a credentialReferenceId.`,
        };
      }

      const secretResolutionEntry = findSecretResolution({
        secretResolution,
        credentialReferenceId: binding.credentialReferenceId,
      });

      if (!secretResolutionEntry || secretResolutionEntry.resolutionStatus !== 'resolved') {
        return {
          resourceId: binding.resourceId,
          accessMode: binding.accessMode,
          credentialReferenceId: binding.credentialReferenceId,
          secretResolutionStatus: secretResolutionEntry?.resolutionStatus ?? 'unresolved',
          status: 'not_ready',
          reason: `Credential Reference ${binding.credentialReferenceId} is not resolved for channel ${binding.resourceId}.`,
        };
      }

      return {
        resourceId: binding.resourceId,
        accessMode: binding.accessMode,
        credentialReferenceId: binding.credentialReferenceId,
        secretResolutionStatus: secretResolutionEntry.resolutionStatus,
        status: 'ready',
        reason: `Channel ${binding.resourceId} is ready for future invocation through credential reference ${binding.credentialReferenceId}.`,
      };
    });
}

export function prepareProviderIntegrationsForInvocation({
  usableBindings,
  secretResolution,
  brainSelection,
}) {
  return assertProviderIntegrationPreparation({
    selectedBrainProvider: prepareBrainProvider({
      brainReference: brainSelection?.selectedBrain ?? null,
      usableBindings,
      secretResolution,
      roleLabel: 'selected',
    }),
    fallbackBrainProvider: prepareBrainProvider({
      brainReference: brainSelection?.fallbackBrain ?? null,
      usableBindings,
      secretResolution,
      roleLabel: 'fallback',
    }),
    channelProviders: prepareChannelProviders({
      usableBindings,
      secretResolution,
    }),
  });
}
