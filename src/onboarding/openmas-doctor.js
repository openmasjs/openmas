import path from 'node:path';
import process from 'node:process';
import { resolveProjectRoot } from '../boot/resolve-project-root.js';
import { resolveMasRoot } from '../boot/resolve-mas-root.js';
import { validateProjectStructure } from '../boot/validate-project-structure.js';
import { validateMasStructure } from '../boot/validate-mas-structure.js';
import { readCredentialReferenceRegistry } from '../credential-references/read-credential-reference-registry.js';
import { resolveCredentialVaultEnvironment } from '../credentials/resolve-credential-vault-environment.js';
import { openCredentialVault } from '../credentials/open-credential-vault.js';
import { readCognitiveIdentitiesRegistry } from '../invocation/read-cognitive-identities-registry.js';
import { resolveCognitiveIdentityRoot } from '../invocation/resolve-cognitive-identity-root.js';
import { readCognitiveIdentityDefinition } from '../invocation/read-cognitive-identity-definition.js';
import { readOperationalIdentitiesRegistry } from '../operational-identities/read-operational-identities-registry.js';
import { resolveOperationalIdentityRoot } from '../operational-identities/resolve-operational-identity-root.js';
import { readOperationalIdentityDefinition } from '../operational-identities/read-operational-identity-definition.js';
import { readOperationalIdentityRoutingDefinition } from '../operational-identities/read-operational-identity-routing-definition.js';
import { readExecutionProfileDefinition } from '../operational-identities/read-execution-profile-definition.js';
import { readBindingDefinitions } from '../operational-identities/read-binding-definitions.js';
import { readPermissionDefinitions } from '../operational-identities/read-permission-definitions.js';
import { readResourcesRegistry } from '../operational-identities/read-resources-registry.js';
import { resolveActiveCognitiveSet } from '../operational-identities/resolve-active-cognitive-set.js';
import {
  readServiceHeartbeat,
  readServiceState,
} from '../os/service/service-health.js';

const DEFAULT_DOCTOR_OPERATIONAL_IDENTITIES = Object.freeze([
  'alfred',
  'bruce',
]);
const REQUIRED_NODE_MAJOR = 22;

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function createCheck({
  id,
  label,
  status,
  summary,
  nextStep = null,
  details = {},
}) {
  return {
    id,
    label,
    status,
    summary,
    nextStep,
    details,
  };
}

function normalizeCheckError(error) {
  if (error instanceof Error && isNonEmptyString(error.message)) {
    return error.message;
  }

  if (isNonEmptyString(error)) {
    return String(error).trim();
  }

  return 'Unknown Doctor check failure.';
}

function resolveOverallStatus({
  deterministicReadiness,
  probabilisticReadiness,
}) {
  if (deterministicReadiness.status !== 'ready') {
    return 'blocked';
  }

  if (probabilisticReadiness.status === 'ready') {
    return 'ready';
  }

  return 'ready_for_deterministic_runtime';
}

function resolveExitCode(status) {
  return status === 'blocked' ? 1 : 0;
}

function checkNodeVersion() {
  const major = Number.parseInt(process.versions.node.split('.')[0], 10);

  if (Number.isInteger(major) && major >= REQUIRED_NODE_MAJOR) {
    return createCheck({
      id: 'node_version',
      label: 'Node.js version',
      status: 'ok',
      summary: `Node.js ${process.versions.node} satisfies >=${REQUIRED_NODE_MAJOR}.`,
      details: {
        version: process.versions.node,
        requiredMajor: REQUIRED_NODE_MAJOR,
      },
    });
  }

  return createCheck({
    id: 'node_version',
    label: 'Node.js version',
    status: 'blocked',
    summary: `Node.js ${process.versions.node} does not satisfy >=${REQUIRED_NODE_MAJOR}.`,
    nextStep: `Install Node.js ${REQUIRED_NODE_MAJOR} or newer.`,
    details: {
      version: process.versions.node,
      requiredMajor: REQUIRED_NODE_MAJOR,
    },
  });
}

function normalizeOperationalIdentityIds(operationalIdentityIds) {
  const values = Array.isArray(operationalIdentityIds) && operationalIdentityIds.length > 0
    ? operationalIdentityIds
    : DEFAULT_DOCTOR_OPERATIONAL_IDENTITIES;
  const seenValues = new Set();

  return values.map((value) => {
    if (!isNonEmptyString(value)) {
      throw new Error('Doctor Operational Identity ids must be non-empty strings.');
    }

    return value.trim();
  }).filter((value) => {
    if (seenValues.has(value)) {
      return false;
    }

    seenValues.add(value);
    return true;
  });
}

function commandIsEnabled(executionProfileDefinition, command) {
  return executionProfileDefinition.enabledCommands.length === 0
    || executionProfileDefinition.enabledCommands.includes(command);
}

function canRunDeterministicHello(executionProfileDefinition) {
  return (
    ['deterministic', 'hybrid'].includes(executionProfileDefinition.executionMode)
    && commandIsEnabled(executionProfileDefinition, 'hello')
  );
}

function canRunProbabilisticAsk(executionProfileDefinition) {
  return (
    ['probabilistic', 'hybrid'].includes(executionProfileDefinition.executionMode)
    && commandIsEnabled(executionProfileDefinition, 'ask')
  );
}

function collectBindingCredentialReferenceIds(bindings) {
  if (!bindings) {
    return [];
  }

  return bindings.bindings
    .map((binding) => binding.credentialReferenceId)
    .filter(isNonEmptyString)
    .toSorted((left, right) => left.localeCompare(right));
}

async function inspectOperationalIdentity({
  masRootPath,
  operationalIdentityId,
}) {
  const resolvedOperationalIdentity = await resolveOperationalIdentityRoot({
    masRootPath,
    operationalIdentityId,
  });
  const operationalIdentityDefinitionResult = await readOperationalIdentityDefinition({
    operationalIdentityRootPath: resolvedOperationalIdentity.operationalIdentityRootPath,
  });
  const operationalIdentityDefinition = operationalIdentityDefinitionResult.definition;
  const routingDefinitionResult = await readOperationalIdentityRoutingDefinition({
    operationalIdentityRootPath: resolvedOperationalIdentity.operationalIdentityRootPath,
  });
  const executionProfileResult = await readExecutionProfileDefinition({
    operationalIdentityRootPath: resolvedOperationalIdentity.operationalIdentityRootPath,
    expectedExecutionProfileId: operationalIdentityDefinition.executionProfileId,
  });
  const bindingsResult = await readBindingDefinitions({
    operationalIdentityRootPath: resolvedOperationalIdentity.operationalIdentityRootPath,
    expectedOperationalIdentityId: operationalIdentityDefinition.operationalIdentityId,
  });
  const permissionsResult = await readPermissionDefinitions({
    operationalIdentityRootPath: resolvedOperationalIdentity.operationalIdentityRootPath,
    expectedOperationalIdentityId: operationalIdentityDefinition.operationalIdentityId,
  });
  const activeCognitiveSet = resolveActiveCognitiveSet({
    request: {
      command: 'hello',
    },
    operationalIdentityDefinition,
    routingDefinition: routingDefinitionResult.definition,
  });
  const resolvedCognitiveIdentity = await resolveCognitiveIdentityRoot({
    masRootPath,
    cognitiveIdentityId: activeCognitiveSet.primaryCognitiveIdentityId,
  });
  const cognitiveIdentityDefinition = await readCognitiveIdentityDefinition({
    cognitiveIdentityRootPath: resolvedCognitiveIdentity.cognitiveIdentityRootPath,
  });
  const executionProfileDefinition = executionProfileResult.definition;
  const deterministicReady = (
    operationalIdentityDefinition.lifecycleState === 'active'
    && cognitiveIdentityDefinition.missingRequiredComponents.length === 0
    && canRunDeterministicHello(executionProfileDefinition)
  );
  const probabilisticCapable = (
    operationalIdentityDefinition.lifecycleState === 'active'
    && cognitiveIdentityDefinition.missingRequiredComponents.length === 0
    && canRunProbabilisticAsk(executionProfileDefinition)
  );

  return {
    operationalIdentityId,
    displayName: operationalIdentityDefinition.displayName,
    lifecycleState: operationalIdentityDefinition.lifecycleState,
    primaryCognitiveIdentityId: activeCognitiveSet.primaryCognitiveIdentityId,
    executionMode: executionProfileDefinition.executionMode,
    primaryBrain: executionProfileDefinition.primaryBrain,
    fallbackBrain: executionProfileDefinition.fallbackBrain,
    enabledCommands: executionProfileDefinition.enabledCommands,
    bindingCount: bindingsResult.bindings?.bindings.length ?? 0,
    permissionRuleCount: permissionsResult.permissions?.rules.length ?? 0,
    credentialReferenceIds: collectBindingCredentialReferenceIds(bindingsResult.bindings),
    deterministicReady,
    probabilisticCapable,
    cognitiveIdentityMissingRequiredComponents: cognitiveIdentityDefinition.missingRequiredComponents,
    cognitiveIdentityMissingOptionalComponents: cognitiveIdentityDefinition.missingOptionalComponents,
  };
}

function buildDeterministicReadiness(identityReports) {
  const blockedIdentities = identityReports.filter((identityReport) => {
    return !identityReport.deterministicReady;
  });

  if (blockedIdentities.length === 0) {
    return {
      status: 'ready',
      reason: 'Required starter Operational Identities can run deterministic hello.',
      blockedOperationalIdentityIds: [],
    };
  }

  return {
    status: 'blocked',
    reason: `Deterministic hello is blocked for: ${blockedIdentities.map((entry) => entry.operationalIdentityId).join(', ')}.`,
    blockedOperationalIdentityIds: blockedIdentities.map((entry) => entry.operationalIdentityId),
  };
}

function isCredentialValuePresent(value) {
  if (typeof value === 'string') {
    return value.trim().length > 0;
  }

  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function buildRequiredProbabilisticCredentialReferenceIds(identityReports) {
  return [
    ...new Set(identityReports.flatMap((identityReport) => {
      if (!identityReport.probabilisticCapable) {
        return [];
      }

      return identityReport.credentialReferenceIds;
    })),
  ].toSorted((left, right) => left.localeCompare(right));
}

function buildProbabilisticReadiness({
  identityReports,
  credentialReferenceRegistry,
  vaultInspection,
}) {
  const incapableIdentities = identityReports.filter((identityReport) => {
    return !identityReport.probabilisticCapable;
  });

  if (incapableIdentities.length > 0) {
    return {
      status: 'blocked',
      reason: `Probabilistic ask is not enabled for: ${incapableIdentities.map((entry) => entry.operationalIdentityId).join(', ')}.`,
      requiredCredentialReferenceIds: [],
      missingCredentialReferenceIds: [],
      unresolvedCredentialReferenceIds: [],
    };
  }

  const requiredCredentialReferenceIds = buildRequiredProbabilisticCredentialReferenceIds(identityReports);
  const definedCredentialReferenceIds = new Set(
    credentialReferenceRegistry?.credentialReferences.map((entry) => entry.credentialReferenceId) ?? [],
  );
  const missingCredentialReferenceIds = requiredCredentialReferenceIds.filter((credentialReferenceId) => {
    return !definedCredentialReferenceIds.has(credentialReferenceId);
  });

  if (missingCredentialReferenceIds.length > 0) {
    return {
      status: 'blocked',
      reason: `Missing Credential Reference definitions: ${missingCredentialReferenceIds.join(', ')}.`,
      requiredCredentialReferenceIds,
      missingCredentialReferenceIds,
      unresolvedCredentialReferenceIds: [],
    };
  }

  if (!vaultInspection.exists) {
    return {
      status: 'blocked',
      reason: `Credential Vault is not configured for environment "${vaultInspection.environment}".`,
      requiredCredentialReferenceIds,
      missingCredentialReferenceIds: [],
      unresolvedCredentialReferenceIds: requiredCredentialReferenceIds,
    };
  }

  if (vaultInspection.status !== 'ok') {
    return {
      status: 'blocked',
      reason: vaultInspection.reason,
      requiredCredentialReferenceIds,
      missingCredentialReferenceIds: [],
      unresolvedCredentialReferenceIds: requiredCredentialReferenceIds,
    };
  }

  const unresolvedCredentialReferenceIds = requiredCredentialReferenceIds.filter((credentialReferenceId) => {
    return !vaultInspection.presentCredentialReferenceIds.includes(credentialReferenceId);
  });

  if (unresolvedCredentialReferenceIds.length > 0) {
    return {
      status: 'blocked',
      reason: `Credential Vault is missing: ${unresolvedCredentialReferenceIds.join(', ')}.`,
      requiredCredentialReferenceIds,
      missingCredentialReferenceIds: [],
      unresolvedCredentialReferenceIds,
    };
  }

  return {
    status: 'ready',
    reason: 'Required probabilistic Credential References are defined and present in the selected vault.',
    requiredCredentialReferenceIds,
    missingCredentialReferenceIds: [],
    unresolvedCredentialReferenceIds: [],
  };
}

async function inspectCredentialVault({
  projectRootPath,
  requestedEnvironment,
  environmentVariables,
}) {
  const environmentSelection = resolveCredentialVaultEnvironment({
    requestedEnvironment,
    environmentVariables,
  });

  try {
    const vault = await openCredentialVault({
      projectRootPath,
      environment: environmentSelection.environment,
    });
    const credentials = vault.credentials ?? {};
    const presentCredentialReferenceIds = Object.keys(credentials)
      .filter((credentialReferenceId) => isCredentialValuePresent(credentials[credentialReferenceId]))
      .toSorted((left, right) => left.localeCompare(right));

    return {
      status: 'ok',
      exists: vault.exists,
      environment: environmentSelection.environment,
      source: environmentSelection.source,
      vaultFilePath: vault.vaultFilePath,
      masterKeySource: vault.masterKeySource,
      credentialCount: vault.exists ? Object.keys(credentials).length : 0,
      presentCredentialReferenceIds,
      reason: vault.exists
        ? `Credential Vault is readable for environment "${environmentSelection.environment}".`
        : `Credential Vault file does not exist for environment "${environmentSelection.environment}".`,
    };
  } catch (error) {
    return {
      status: 'blocked',
      exists: true,
      environment: environmentSelection.environment,
      source: environmentSelection.source,
      vaultFilePath: path.join(projectRootPath, 'config', 'credentials', `${environmentSelection.environment}.json.enc`),
      masterKeySource: null,
      credentialCount: 0,
      presentCredentialReferenceIds: [],
      reason: normalizeCheckError(error),
    };
  }
}

async function inspectOsService(projectRootPath) {
  try {
    const [
      heartbeat,
      state,
    ] = await Promise.all([
      readServiceHeartbeat({ projectRootPath }),
      readServiceState({ projectRootPath }),
    ]);

    if (!heartbeat && !state) {
      return {
        status: 'not_started',
        reason: 'No OpenMAS OS service heartbeat or state snapshot exists yet.',
        heartbeat: null,
        state: null,
      };
    }

    const effectiveStatus = heartbeat?.status ?? state?.status ?? 'unknown';

    return {
      status: effectiveStatus,
      reason: `OpenMAS OS service status is ${effectiveStatus}.`,
      heartbeat: heartbeat === null
        ? null
        : {
          serviceId: heartbeat.serviceId,
          status: heartbeat.status,
          lastHeartbeatAt: heartbeat.lastHeartbeatAt,
          failedTickCount: heartbeat.failedTickCount,
          skippedTickCount: heartbeat.skippedTickCount,
        },
      state: state === null
        ? null
        : {
          serviceId: state.serviceId,
          status: state.status,
          stopReason: state.stopReason,
          updatedAt: state.updatedAt,
        },
    };
  } catch (error) {
    return {
      status: 'unavailable',
      reason: normalizeCheckError(error),
      heartbeat: null,
      state: null,
    };
  }
}

function buildNextSteps({
  status,
  probabilisticReadiness,
  vaultInspection,
}) {
  const nextSteps = [];

  if (status === 'blocked') {
    nextSteps.push('Fix the blocked Doctor checks and rerun: npx openmas doctor');
  }

  if (probabilisticReadiness.status !== 'ready') {
    nextSteps.push(`npx openmas credentials edit ${vaultInspection.environment}`);
  }

  if (nextSteps.length === 0) {
    nextSteps.push('npx openmas invoke --agent alfred --mode deterministic --command hello');
  }

  return nextSteps;
}

function buildCheckSummary({
  projectRootResolution,
  projectValidation,
  masValidation,
  cognitiveIdentityRegistry,
  operationalIdentityRegistry,
  resourcesRegistry,
  identityReports,
  credentialReferenceRegistry,
  vaultInspection,
  osService,
}) {
  const checks = [];

  checks.push(createCheck({
    id: 'package_json',
    label: 'package.json',
    status: 'ok',
    summary: `OpenMAS ${projectRootResolution.packageManifest.openmas.projectKind} package marker is present.`,
  }));
  checks.push(checkNodeVersion());
  checks.push(createCheck({
    id: 'project_structure',
    label: 'Project structure',
    status: projectValidation.missingRequiredComponents.length === 0 ? 'ok' : 'blocked',
    summary: projectValidation.missingRequiredComponents.length === 0
      ? 'Required project structure is present.'
      : `Missing required project components: ${projectValidation.missingRequiredComponents.join(', ')}.`,
  }));
  checks.push(createCheck({
    id: 'mas_structure',
    label: 'MAS structure',
    status: masValidation.missingRequiredComponents.length === 0 ? 'ok' : 'blocked',
    summary: masValidation.missingRequiredComponents.length === 0
      ? 'Required MAS structure is present.'
      : `Missing required MAS components: ${masValidation.missingRequiredComponents.join(', ')}.`,
  }));
  checks.push(createCheck({
    id: 'cognitive_identities',
    label: 'Cognitive Identities',
    status: 'ok',
    summary: `${cognitiveIdentityRegistry.cognitiveIdentities.length} Cognitive Identity registry entries found.`,
  }));
  checks.push(createCheck({
    id: 'operational_identities',
    label: 'Operational Identities',
    status: identityReports.every((identityReport) => identityReport.deterministicReady) ? 'ok' : 'blocked',
    summary: `${operationalIdentityRegistry.operationalIdentities.length} Operational Identity registry entries found; starter identities inspected: ${identityReports.map((entry) => entry.operationalIdentityId).join(', ')}.`,
  }));
  checks.push(createCheck({
    id: 'resources',
    label: 'Resources',
    status: resourcesRegistry === null ? 'warning' : 'ok',
    summary: resourcesRegistry === null
      ? 'No resources registry was found.'
      : `${resourcesRegistry.resources.length} resource registry entries found.`,
  }));
  checks.push(createCheck({
    id: 'credential_references',
    label: 'Credential References',
    status: credentialReferenceRegistry === null ? 'warning' : 'ok',
    summary: credentialReferenceRegistry === null
      ? 'No Credential Reference registry was found.'
      : `${credentialReferenceRegistry.credentialReferences.length} Credential Reference definitions found.`,
  }));
  checks.push(createCheck({
    id: 'credential_vault',
    label: 'Credential Vault',
    status: vaultInspection.exists && vaultInspection.status === 'ok' ? 'ok' : 'warning',
    summary: vaultInspection.reason,
    nextStep: vaultInspection.exists ? null : `npx openmas credentials edit ${vaultInspection.environment}`,
  }));
  checks.push(createCheck({
    id: 'os_service',
    label: 'OS service',
    status: ['running', 'idle', 'ticking', 'stopping'].includes(osService.status) ? 'ok' : 'warning',
    summary: osService.reason,
    nextStep: ['not_started', 'stopped'].includes(osService.status)
      ? 'npx openmas os watch --interval 1000'
      : null,
  }));

  return checks;
}

export async function runOpenMasDoctor({
  projectRootPath = process.cwd(),
  environment = null,
  operationalIdentityIds = DEFAULT_DOCTOR_OPERATIONAL_IDENTITIES,
  environmentVariables = process.env,
} = {}) {
  const normalizedOperationalIdentityIds = normalizeOperationalIdentityIds(operationalIdentityIds);
  const startedAt = new Date().toISOString();

  try {
    const projectRootResolution = await resolveProjectRoot(projectRootPath);
    const normalizedProjectRootPath = projectRootResolution.projectRootPath;
    const masRootResolution = await resolveMasRoot({
      projectRootPath: normalizedProjectRootPath,
    });
    const projectValidation = await validateProjectStructure(normalizedProjectRootPath, {
      projectKind: projectRootResolution.packageManifest.openmas.projectKind,
    });
    const masValidation = await validateMasStructure(masRootResolution.masRootPath);
    const [
      cognitiveIdentityRegistryResult,
      operationalIdentityRegistryResult,
      resourcesRegistryResult,
      credentialReferenceRegistryResult,
      vaultInspection,
      osService,
    ] = await Promise.all([
      readCognitiveIdentitiesRegistry({ masRootPath: masRootResolution.masRootPath }),
      readOperationalIdentitiesRegistry({ masRootPath: masRootResolution.masRootPath }),
      readResourcesRegistry({ masRootPath: masRootResolution.masRootPath }),
      readCredentialReferenceRegistry({ projectRootPath: normalizedProjectRootPath }),
      inspectCredentialVault({
        projectRootPath: normalizedProjectRootPath,
        requestedEnvironment: environment,
        environmentVariables,
      }),
      inspectOsService(normalizedProjectRootPath),
    ]);
    const identityReports = await Promise.all(normalizedOperationalIdentityIds.map((operationalIdentityId) => {
      return inspectOperationalIdentity({
        masRootPath: masRootResolution.masRootPath,
        operationalIdentityId,
      });
    }));
    const deterministicReadiness = buildDeterministicReadiness(identityReports);
    const probabilisticReadiness = buildProbabilisticReadiness({
      identityReports,
      credentialReferenceRegistry: credentialReferenceRegistryResult.registry,
      vaultInspection,
    });
    const status = resolveOverallStatus({
      deterministicReadiness,
      probabilisticReadiness,
    });
    const checks = buildCheckSummary({
      projectRootResolution,
      projectValidation,
      masValidation,
      cognitiveIdentityRegistry: cognitiveIdentityRegistryResult.registry,
      operationalIdentityRegistry: operationalIdentityRegistryResult.registry,
      resourcesRegistry: resourcesRegistryResult.registry,
      identityReports,
      credentialReferenceRegistry: credentialReferenceRegistryResult.registry,
      vaultInspection,
      osService,
    });

    return {
      kind: 'openmas_doctor_result',
      version: 1,
      status,
      exitCode: resolveExitCode(status),
      project: {
        name: projectRootResolution.packageManifest.name ?? path.basename(normalizedProjectRootPath),
        projectKind: projectRootResolution.packageManifest.openmas.projectKind,
        schemaVersion: projectRootResolution.packageManifest.openmas.schemaVersion,
        projectRootPath: normalizedProjectRootPath,
        masRootPath: masRootResolution.masRootPath,
      },
      runtime: {
        deterministicInvocation: deterministicReadiness,
        probabilisticInvocation: probabilisticReadiness,
        credentialVault: vaultInspection,
        osService,
      },
      identities: identityReports,
      checks,
      nextSteps: buildNextSteps({
        status,
        probabilisticReadiness,
        vaultInspection,
      }),
      warnings: checks.filter((check) => check.status === 'warning').map((check) => check.summary),
      errors: checks.filter((check) => check.status === 'blocked').map((check) => check.summary),
      startedAt,
      finishedAt: new Date().toISOString(),
    };
  } catch (error) {
    const reason = normalizeCheckError(error);
    const status = 'blocked';

    return {
      kind: 'openmas_doctor_result',
      version: 1,
      status,
      exitCode: 1,
      project: {
        name: null,
        projectKind: null,
        schemaVersion: null,
        projectRootPath: path.resolve(projectRootPath ?? process.cwd()),
        masRootPath: null,
      },
      runtime: {
        deterministicInvocation: {
          status: 'blocked',
          reason,
          blockedOperationalIdentityIds: normalizedOperationalIdentityIds,
        },
        probabilisticInvocation: {
          status: 'blocked',
          reason: 'Doctor could not inspect probabilistic readiness because required project structure is blocked.',
          requiredCredentialReferenceIds: [],
          missingCredentialReferenceIds: [],
          unresolvedCredentialReferenceIds: [],
        },
        credentialVault: null,
        osService: null,
      },
      identities: [],
      checks: [
        createCheck({
          id: 'doctor_bootstrap',
          label: 'Doctor bootstrap',
          status: 'blocked',
          summary: reason,
        }),
        checkNodeVersion(),
      ],
      nextSteps: [
        'Fix the blocked Doctor bootstrap error and rerun: npx openmas doctor',
      ],
      warnings: [],
      errors: [
        reason,
      ],
      startedAt,
      finishedAt: new Date().toISOString(),
    };
  }
}

function formatCheckStatus(status) {
  if (status === 'ok') {
    return 'ok';
  }

  return status;
}

function writeLine(stdout, line = '') {
  stdout.write(`${line}\n`);
}

export function printOpenMasDoctorResult(result, stdout = process.stdout) {
  writeLine(stdout, 'OpenMAS Doctor');
  writeLine(stdout, `Project: ${result.project.name ?? 'unknown'}`);
  writeLine(stdout, `Project Kind: ${result.project.projectKind ?? 'unknown'}`);
  writeLine(stdout, `Status: ${result.status}`);
  writeLine(stdout);
  writeLine(stdout, 'Checks:');

  for (const check of result.checks) {
    writeLine(stdout, `  ${check.label.padEnd(28, ' ')} ${formatCheckStatus(check.status)}`);
    writeLine(stdout, `    ${check.summary}`);
  }

  writeLine(stdout);
  writeLine(stdout, 'Runtime:');
  writeLine(stdout, `  Deterministic invocation: ${result.runtime.deterministicInvocation.status}`);
  writeLine(stdout, `    ${result.runtime.deterministicInvocation.reason}`);
  writeLine(stdout, `  Probabilistic invocation: ${result.runtime.probabilisticInvocation.status}`);
  writeLine(stdout, `    ${result.runtime.probabilisticInvocation.reason}`);

  if (result.runtime.credentialVault) {
    writeLine(stdout, `  Credential Vault: ${result.runtime.credentialVault.exists ? 'present' : 'missing'} (${result.runtime.credentialVault.environment})`);
  }

  if (result.runtime.osService) {
    writeLine(stdout, `  OS Service: ${result.runtime.osService.status}`);
  }

  if (result.identities.length > 0) {
    writeLine(stdout);
    writeLine(stdout, 'Agents:');

    for (const identity of result.identities) {
      writeLine(
        stdout,
        `  ${identity.displayName} (${identity.operationalIdentityId}): deterministic=${identity.deterministicReady ? 'ready' : 'blocked'} probabilistic=${identity.probabilisticCapable ? 'capable' : 'blocked'} primary=${identity.primaryCognitiveIdentityId}`,
      );
    }
  }

  writeLine(stdout);
  writeLine(stdout, 'Next:');

  for (const nextStep of result.nextSteps) {
    writeLine(stdout, `  ${nextStep}`);
  }
}

function readOptionValue({ argv, index, optionName }) {
  if (!argv[index + 1]) {
    throw new Error(`Missing value for ${optionName}`);
  }

  return {
    value: argv[index + 1],
    nextIndex: index + 1,
  };
}

export function parseOpenMasDoctorCliArgs(argv) {
  const options = {
    projectRootPath: process.cwd(),
    environment: null,
    json: false,
    help: false,
    operationalIdentityIds: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === '--help' || argument === '-h') {
      options.help = true;
      continue;
    }

    if (argument === '--json') {
      options.json = true;
      continue;
    }

    if (argument === '--project-root') {
      const parsedValue = readOptionValue({ argv, index, optionName: '--project-root' });
      options.projectRootPath = parsedValue.value;
      index = parsedValue.nextIndex;
      continue;
    }

    if (argument.startsWith('--project-root=')) {
      options.projectRootPath = argument.slice('--project-root='.length);
      continue;
    }

    if (argument === '--environment') {
      const parsedValue = readOptionValue({ argv, index, optionName: '--environment' });
      options.environment = parsedValue.value;
      index = parsedValue.nextIndex;
      continue;
    }

    if (argument.startsWith('--environment=')) {
      options.environment = argument.slice('--environment='.length);
      continue;
    }

    if (argument === '--agent') {
      const parsedValue = readOptionValue({ argv, index, optionName: '--agent' });
      options.operationalIdentityIds.push(parsedValue.value);
      index = parsedValue.nextIndex;
      continue;
    }

    if (argument.startsWith('--agent=')) {
      options.operationalIdentityIds.push(argument.slice('--agent='.length));
      continue;
    }

    throw new Error(`Unsupported argument: ${argument}`);
  }

  return options;
}

export function printOpenMasDoctorHelp(stdout = process.stdout) {
  writeLine(stdout, 'OpenMAS Doctor');
  writeLine(stdout, '');
  writeLine(stdout, 'Usage:');
  writeLine(stdout, '  openmas doctor [options]');
  writeLine(stdout, '');
  writeLine(stdout, 'Options:');
  writeLine(stdout, '  --project-root <path>     Project or habitat root. Defaults to current directory.');
  writeLine(stdout, '  --environment <name>      Credential Vault environment. Defaults to OPENMAS_ENV or development.');
  writeLine(stdout, '  --agent <id>              Operational Identity to inspect. Can be repeated.');
  writeLine(stdout, '  --json                    Print JSON diagnostics.');
}

export async function runOpenMasDoctorCommand({
  argv = process.argv.slice(2),
  cwd = process.cwd(),
  stdout = process.stdout,
  environmentVariables = process.env,
} = {}) {
  const options = parseOpenMasDoctorCliArgs(argv);

  if (options.help) {
    printOpenMasDoctorHelp(stdout);
    return {
      exitCode: 0,
      result: null,
    };
  }

  const result = await runOpenMasDoctor({
    projectRootPath: path.resolve(cwd, options.projectRootPath),
    environment: options.environment,
    operationalIdentityIds: options.operationalIdentityIds.length > 0
      ? options.operationalIdentityIds
      : DEFAULT_DOCTOR_OPERATIONAL_IDENTITIES,
    environmentVariables,
  });

  if (options.json) {
    writeLine(stdout, JSON.stringify(result, null, 2));
  } else {
    printOpenMasDoctorResult(result, stdout);
  }

  return {
    exitCode: result.exitCode,
    result,
  };
}
