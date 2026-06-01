function normalizeCredentialReferenceId(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

export function collectReferencedCredentialReferenceIds({ usableBindings } = {}) {
  if (!Array.isArray(usableBindings)) {
    return [];
  }

  const seenReferenceIds = new Set();
  const referencedCredentialReferenceIds = [];

  for (const binding of usableBindings) {
    const credentialReferenceId = normalizeCredentialReferenceId(binding?.credentialReferenceId);

    if (!credentialReferenceId || seenReferenceIds.has(credentialReferenceId)) {
      continue;
    }

    seenReferenceIds.add(credentialReferenceId);
    referencedCredentialReferenceIds.push(credentialReferenceId);
  }

  return referencedCredentialReferenceIds;
}
