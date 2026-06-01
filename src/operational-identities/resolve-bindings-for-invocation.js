import { resolveResourceDefinition } from './resolve-resource-definition.js';

export function resolveBindingsForInvocation({
  bindingDefinitions,
  resourceRegistry,
  operationalIdentityId,
}) {
  if (!bindingDefinitions) {
    return {
      resolvedBindings: [],
      warnings: [],
    };
  }

  const resolvedBindings = [];
  const warnings = [];

  for (const binding of bindingDefinitions.bindings) {
    let resourceDefinition;

    try {
      resourceDefinition = resolveResourceDefinition({
        resourceRegistry,
        resourceId: binding.resourceId,
      });
    } catch {
      warnings.push(
        `Binding references a resource not found in the registry: ${binding.resourceId}`,
      );
      continue;
    }

    if (
      resourceDefinition.ownershipScope === 'dedicated'
      && resourceDefinition.dedicatedToOperationalIdentityId !== operationalIdentityId
    ) {
      warnings.push(
        `Binding references a dedicated resource that belongs to a different operational identity: ${binding.resourceId} is dedicated to ${resourceDefinition.dedicatedToOperationalIdentityId}.`,
      );
      continue;
    }

    resolvedBindings.push({
      resourceId: binding.resourceId,
      accessMode: binding.accessMode,
      bindingState: binding.bindingState,
      credentialReferenceId: binding.credentialReferenceId,
      resourceType: resourceDefinition.resourceType,
      resourceDisplayName: resourceDefinition.displayName,
      ownershipScope: resourceDefinition.ownershipScope,
      resourceLifecycleState: resourceDefinition.lifecycleState,
    });
  }

  return {
    resolvedBindings,
    warnings,
  };
}
