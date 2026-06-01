import { assertActiveCognitiveSet } from '../contracts/identity/active-cognitive-set-contract.js';

function assertAttachedCognitiveIdentityOwnership(attachedCognitiveIdentityIds, targetCognitiveIdentityId, description) {
  if (!attachedCognitiveIdentityIds.includes(targetCognitiveIdentityId)) {
    throw new Error(`${description} is not attached to the Operational Identity: ${targetCognitiveIdentityId}`);
  }
}

function buildSecondaryCognitiveIdentityIds({
  attachedCognitiveIdentityIds,
  primaryCognitiveIdentityId,
  preferredSecondaryCognitiveIdentityIds,
  preferredSecondaryCognitiveIdentityIdsSpecified,
}) {
  if (preferredSecondaryCognitiveIdentityIdsSpecified) {
    preferredSecondaryCognitiveIdentityIds.forEach((secondaryCognitiveIdentityId) => {
      assertAttachedCognitiveIdentityOwnership(
        attachedCognitiveIdentityIds,
        secondaryCognitiveIdentityId,
        'Secondary cognitive identity',
      );
    });

    return preferredSecondaryCognitiveIdentityIds.filter((secondaryCognitiveIdentityId) => {
      return secondaryCognitiveIdentityId !== primaryCognitiveIdentityId;
    });
  }

  return attachedCognitiveIdentityIds.filter((attachedCognitiveIdentityId) => {
    return attachedCognitiveIdentityId !== primaryCognitiveIdentityId;
  });
}

export function resolveActiveCognitiveSet({
  request,
  operationalIdentityDefinition,
  routingDefinition = null,
}) {
  const attachedCognitiveIdentityIds = operationalIdentityDefinition.attachedCognitiveIdentities.map((entry) => {
    return entry.cognitiveIdentityId;
  });

  if (attachedCognitiveIdentityIds.length === 1) {
    return assertActiveCognitiveSet({
      primaryCognitiveIdentityId: attachedCognitiveIdentityIds[0],
      secondaryCognitiveIdentityIds: [],
      resolutionSource: 'single_attached_cognitive_identity',
      matchedCommand: request.command,
    });
  }

  const matchedCommandRoute = routingDefinition?.commandRoutes.find((commandRoute) => {
    return commandRoute.command === request.command;
  }) ?? null;

  if (matchedCommandRoute) {
    assertAttachedCognitiveIdentityOwnership(
      attachedCognitiveIdentityIds,
      matchedCommandRoute.primaryCognitiveIdentityId,
      'Command-routed primary cognitive identity',
    );

    return assertActiveCognitiveSet({
      primaryCognitiveIdentityId: matchedCommandRoute.primaryCognitiveIdentityId,
      secondaryCognitiveIdentityIds: buildSecondaryCognitiveIdentityIds({
        attachedCognitiveIdentityIds,
        primaryCognitiveIdentityId: matchedCommandRoute.primaryCognitiveIdentityId,
        preferredSecondaryCognitiveIdentityIds: matchedCommandRoute.secondaryCognitiveIdentityIds ?? [],
        preferredSecondaryCognitiveIdentityIdsSpecified: matchedCommandRoute.secondaryCognitiveIdentityIdsSpecified
          ?? Object.hasOwn(matchedCommandRoute, 'secondaryCognitiveIdentityIds'),
      }),
      resolutionSource: 'command_route',
      matchedCommand: matchedCommandRoute.command,
    });
  }

  if (routingDefinition?.defaultPrimaryCognitiveIdentityId) {
    assertAttachedCognitiveIdentityOwnership(
      attachedCognitiveIdentityIds,
      routingDefinition.defaultPrimaryCognitiveIdentityId,
      'Default primary cognitive identity',
    );

    return assertActiveCognitiveSet({
      primaryCognitiveIdentityId: routingDefinition.defaultPrimaryCognitiveIdentityId,
      secondaryCognitiveIdentityIds: attachedCognitiveIdentityIds.filter((attachedCognitiveIdentityId) => {
        return attachedCognitiveIdentityId !== routingDefinition.defaultPrimaryCognitiveIdentityId;
      }),
      resolutionSource: 'default_primary_cognitive_identity',
      matchedCommand: request.command,
    });
  }

  throw new Error(
    `Operational Identity ${operationalIdentityDefinition.operationalIdentityId} requires deterministic routing to resolve the active cognitive set.`,
  );
}
