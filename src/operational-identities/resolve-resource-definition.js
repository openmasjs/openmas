export function resolveResourceDefinition({ resourceRegistry, resourceId }) {
  if (!resourceRegistry || !Array.isArray(resourceRegistry.resources)) {
    throw new Error('resolveResourceDefinition requires a valid resource registry.');
  }

  if (!resourceId || typeof resourceId !== 'string' || resourceId.trim().length === 0) {
    throw new Error('resolveResourceDefinition requires a non-empty resourceId.');
  }

  const normalizedResourceId = resourceId.trim();

  const resourceDefinition = resourceRegistry.resources.find(
    (entry) => entry.resourceId === normalizedResourceId,
  );

  if (!resourceDefinition) {
    throw new Error(`Resource not found in the resource registry: ${normalizedResourceId}`);
  }

  return resourceDefinition;
}
