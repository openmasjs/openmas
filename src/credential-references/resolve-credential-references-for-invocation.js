import { assertCredentialReferenceResolution } from '../contracts/credentials/credential-reference-contract.js';
import { resolveCredentialVaultEnvironment } from '../credentials/resolve-credential-vault-environment.js';
import { openCredentialVault } from '../credentials/open-credential-vault.js';
import { collectReferencedCredentialReferenceIds } from './collect-referenced-credential-reference-ids.js';
import { resolveCredentialReferenceDefinition } from './resolve-credential-reference-definition.js';

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function buildBindingByCredentialReferenceId(usableBindings) {
  const bindingByCredentialReferenceId = new Map();

  if (!Array.isArray(usableBindings)) {
    return bindingByCredentialReferenceId;
  }

  for (const binding of usableBindings) {
    const credentialReferenceId = isNonEmptyString(binding?.credentialReferenceId)
      ? binding.credentialReferenceId.trim()
      : null;

    if (credentialReferenceId && !bindingByCredentialReferenceId.has(credentialReferenceId)) {
      bindingByCredentialReferenceId.set(credentialReferenceId, binding);
    }
  }

  return bindingByCredentialReferenceId;
}

function resolveReferenceResourceId({ credentialReferenceId, bindingByCredentialReferenceId }) {
  const binding = bindingByCredentialReferenceId.get(credentialReferenceId);

  if (isNonEmptyString(binding?.resourceId)) {
    return binding.resourceId.trim();
  }

  return credentialReferenceId;
}

function resolveSecretValue({
  definition,
  credentials,
  vaultEnvironment,
  vaultUnavailableReason,
}) {
  if (vaultUnavailableReason) {
    return {
      resolutionStatus: 'unresolved',
      secretValue: null,
      reason: vaultUnavailableReason,
    };
  }

  if (!Object.hasOwn(credentials, definition.credentialReferenceId)) {
    return {
      resolutionStatus: 'unresolved',
      secretValue: null,
      reason: `Credential Reference ${definition.credentialReferenceId} is not present in the ${vaultEnvironment} credential vault.`,
    };
  }

  const secretValue = credentials[definition.credentialReferenceId];

  if (definition.valueShape === 'string') {
    if (typeof secretValue !== 'string' || secretValue.length === 0) {
      return {
        resolutionStatus: 'unresolved',
        secretValue: null,
        reason: `Credential Reference ${definition.credentialReferenceId} must be stored as a non-empty string in the ${vaultEnvironment} credential vault.`,
      };
    }

    return {
      resolutionStatus: 'resolved',
      secretValue,
      reason: `Credential Reference ${definition.credentialReferenceId} resolved from the ${vaultEnvironment} credential vault.`,
    };
  }

  if (definition.valueShape === 'json_object') {
    if (!isPlainObject(secretValue)) {
      return {
        resolutionStatus: 'unresolved',
        secretValue: null,
        reason: `Credential Reference ${definition.credentialReferenceId} must be stored as a JSON object in the ${vaultEnvironment} credential vault.`,
      };
    }

    return {
      resolutionStatus: 'resolved',
      secretValue,
      reason: `Credential Reference ${definition.credentialReferenceId} resolved from the ${vaultEnvironment} credential vault.`,
    };
  }

  return {
    resolutionStatus: 'unresolved',
    secretValue: null,
    reason: `Credential Reference ${definition.credentialReferenceId} has unsupported valueShape: ${definition.valueShape}.`,
  };
}

export async function resolveCredentialReferencesForInvocation({
  projectRootPath,
  environment = null,
  usableBindings,
  credentialReferenceRegistry,
}) {
  const environmentSelection = resolveCredentialVaultEnvironment({
    requestedEnvironment: environment,
    environmentVariables: process.env,
  });

  const referencedCredentialReferenceIds = collectReferencedCredentialReferenceIds({ usableBindings });
  const bindingByCredentialReferenceId = buildBindingByCredentialReferenceId(usableBindings);

  if (referencedCredentialReferenceIds.length === 0) {
    const result = assertCredentialReferenceResolution({
      resolvedCredentialReferences: [],
      summary: {
        totalReferenced: 0,
        resolved: 0,
        unresolved: 0,
        missingDefinitions: 0,
      },
      warnings: [],
    });

    return {
      ...result,
      credentialVaultEnvironment: environmentSelection.vaultEnvironment,
      credentialVaultFilePath: null,
      credentialVaultExists: null,
      secretValueByReferenceId: new Map(),
    };
  }

  const resolvedCredentialReferences = [];
  const warnings = [];
  const secretValueByReferenceId = new Map();
  let credentialVault = null;
  let credentialVaultFilePath = null;
  let credentialVaultExists = false;
  let vaultUnavailableReason = null;

  let resolvedCount = 0;
  let unresolvedCount = 0;
  let missingDefinitionCount = 0;

  if (typeof projectRootPath !== 'string' || projectRootPath.trim().length === 0) {
    vaultUnavailableReason = 'Secret resolution requires a non-empty projectRootPath to open the credential vault.';
  } else {
    try {
      const vaultResult = await openCredentialVault({
        projectRootPath,
        environment: environmentSelection.vaultEnvironment,
      });

      credentialVaultFilePath = vaultResult.vaultFilePath;
      credentialVaultExists = vaultResult.exists;
      credentialVault = vaultResult.credentials;

      if (!vaultResult.exists) {
        vaultUnavailableReason = `Credential vault not found for environment "${environmentSelection.vaultEnvironment}" at ${vaultResult.vaultFilePath}.`;
      }
    } catch (error) {
      vaultUnavailableReason = `Credential vault for environment "${environmentSelection.vaultEnvironment}" could not be opened. ${error.message}`;
    }
  }

  for (const credentialReferenceId of referencedCredentialReferenceIds) {
    const resourceId = resolveReferenceResourceId({
      credentialReferenceId,
      bindingByCredentialReferenceId,
    });
    let definition;

    try {
      definition = resolveCredentialReferenceDefinition({
        credentialReferenceRegistry,
        credentialReferenceId,
      });
    } catch {
      missingDefinitionCount++;
      const reason = `Credential Reference not found in the registry: ${credentialReferenceId}.`;
      warnings.push(`Credential resolution warning for resource ${resourceId}: ${reason}`);
      resolvedCredentialReferences.push({
        resourceId,
        credentialReferenceId,
        credentialType: null,
        valueShape: null,
        resolutionStatus: 'missing_definition',
        reason,
        hasSecretValue: false,
      });
      continue;
    }

    const valueResolution = resolveSecretValue({
      definition,
      credentials: credentialVault ?? {},
      vaultEnvironment: environmentSelection.vaultEnvironment,
      vaultUnavailableReason,
    });

    if (valueResolution.resolutionStatus === 'resolved') {
      resolvedCount++;
      secretValueByReferenceId.set(definition.credentialReferenceId, valueResolution.secretValue);
    } else {
      unresolvedCount++;
      warnings.push(`Secret resolution warning for resource ${resourceId}: ${valueResolution.reason}`);
    }

    resolvedCredentialReferences.push({
      resourceId,
      credentialReferenceId: definition.credentialReferenceId,
      credentialType: definition.credentialType,
      valueShape: definition.valueShape,
      resolutionStatus: valueResolution.resolutionStatus,
      reason: valueResolution.reason,
      hasSecretValue: valueResolution.secretValue !== null,
    });
  }

  const result = assertCredentialReferenceResolution({
    resolvedCredentialReferences,
    summary: {
      totalReferenced: referencedCredentialReferenceIds.length,
      resolved: resolvedCount,
      unresolved: unresolvedCount,
      missingDefinitions: missingDefinitionCount,
    },
    warnings,
  });

  return {
    ...result,
    credentialVaultEnvironment: environmentSelection.vaultEnvironment,
    credentialVaultFilePath,
    credentialVaultExists,
    secretValueByReferenceId,
  };
}
