function createBindingKey({ resourceId, accessMode }) {
  return `${resourceId}::${accessMode}`;
}

export function resolveUsableBindingsForInvocation({
  resolvedBindings,
  permissionEvaluation,
}) {
  if (!resolvedBindings || resolvedBindings.length === 0) {
    return [];
  }

  const bindingsWithActiveState = resolvedBindings.filter((binding) => {
    return binding.bindingState === 'active' && binding.resourceLifecycleState === 'active';
  });

  if (!permissionEvaluation) {
    return bindingsWithActiveState;
  }

  const allowedBindingKeys = new Set(
    permissionEvaluation.evaluatedBindings
      .filter((decision) => decision.effect === 'allow')
      .map((decision) => {
        return createBindingKey({
          resourceId: decision.resourceId,
          accessMode: decision.accessMode,
        });
      }),
  );

  return bindingsWithActiveState.filter((binding) => {
    return allowedBindingKeys.has(
      createBindingKey({
        resourceId: binding.resourceId,
        accessMode: binding.accessMode,
      }),
    );
  });
}
