function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function assertSecondaryCognitiveIdentityIds(values, primaryCognitiveIdentityId) {
  if (!Array.isArray(values)) {
    throw new Error('Active Cognitive Set must include a secondaryCognitiveIdentityIds array.');
  }

  const normalizedSecondaryCognitiveIdentityIds = [];
  const seenSecondaryCognitiveIdentityIds = new Set();

  values.forEach((value, index) => {
    if (!isNonEmptyString(value)) {
      throw new Error(`Active Cognitive Set secondaryCognitiveIdentityIds[${index}] must be a non-empty string.`);
    }

    const normalizedValue = value.trim();

    if (normalizedValue === primaryCognitiveIdentityId) {
      throw new Error('Active Cognitive Set secondaryCognitiveIdentityIds must not contain the primary cognitive identity.');
    }

    if (seenSecondaryCognitiveIdentityIds.has(normalizedValue)) {
      throw new Error(`Active Cognitive Set contains a duplicated secondary cognitive identity: ${normalizedValue}`);
    }

    seenSecondaryCognitiveIdentityIds.add(normalizedValue);
    normalizedSecondaryCognitiveIdentityIds.push(normalizedValue);
  });

  return normalizedSecondaryCognitiveIdentityIds;
}

export function assertActiveCognitiveSet(activeCognitiveSet) {
  if (!activeCognitiveSet || typeof activeCognitiveSet !== 'object') {
    throw new Error('Active Cognitive Set must be an object.');
  }

  if (!isNonEmptyString(activeCognitiveSet.primaryCognitiveIdentityId)) {
    throw new Error('Active Cognitive Set must include a non-empty primaryCognitiveIdentityId.');
  }

  if (!isNonEmptyString(activeCognitiveSet.resolutionSource)) {
    throw new Error('Active Cognitive Set must include a non-empty resolutionSource.');
  }

  const primaryCognitiveIdentityId = activeCognitiveSet.primaryCognitiveIdentityId.trim();
  const secondaryCognitiveIdentityIds = assertSecondaryCognitiveIdentityIds(
    activeCognitiveSet.secondaryCognitiveIdentityIds ?? [],
    primaryCognitiveIdentityId,
  );

  return {
    primaryCognitiveIdentityId,
    secondaryCognitiveIdentityIds,
    resolutionSource: activeCognitiveSet.resolutionSource.trim(),
    matchedCommand: activeCognitiveSet.matchedCommand?.trim() ?? null,
  };
}
