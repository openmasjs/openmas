export function resolveCredentialReferenceDefinition({
  credentialReferenceRegistry,
  credentialReferenceId,
}) {
  const definition = credentialReferenceRegistry.credentialReferences.find((entry) => {
    return entry.credentialReferenceId === credentialReferenceId;
  });

  if (!definition) {
    throw new Error(`Credential Reference not found in the registry: ${credentialReferenceId}`);
  }

  return definition;
}
