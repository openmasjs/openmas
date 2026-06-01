import { randomUUID } from 'node:crypto';
import { createSystemBootRequest, assertSystemBootResult } from '../contracts/boot/system-boot-contract.js';
import { resolveProjectRoot } from './resolve-project-root.js';
import { resolveMasRoot } from './resolve-mas-root.js';
import { validateProjectStructure } from './validate-project-structure.js';
import { validateMasStructure } from './validate-mas-structure.js';
import { openBootSession } from './open-boot-session.js';
import { buildBootContext } from './build-boot-context.js';
import { buildBootReport } from './build-boot-report.js';
import { buildBootResult } from './build-boot-result.js';
import { writeBootArtifacts } from './write-boot-artifacts.js';

function buildWarnings({ projectValidation, strict }) {
  if (strict || projectValidation.missingOptionalComponents.length === 0) {
    return [];
  }

  return projectValidation.missingOptionalComponents.map((component) => {
    return `Optional project component is missing: ${component}`;
  });
}

function classifyStatus({ projectValidation, masValidation, strict, warnings }) {
  if (projectValidation.missingRequiredComponents.length > 0) {
    return 'blocked';
  }

  if (masValidation.missingRequiredComponents.length > 0) {
    return 'blocked';
  }

  if (strict && warnings.length > 0) {
    return 'blocked';
  }

  if (warnings.length > 0) {
    return 'degraded';
  }

  return 'ready';
}

function buildErrors({ projectValidation, masValidation }) {
  const projectErrors = projectValidation.missingRequiredComponents.map((component) => {
    return `Required project component is missing: ${component}`;
  });

  const masErrors = masValidation.missingRequiredComponents.map((component) => {
    return `Required MAS component is missing: ${component}`;
  });

  return [...projectErrors, ...masErrors];
}

function buildNextStep(status) {
  if (status === 'ready') {
    return 'System boot completed. The MAS instance is ready for agent preflight and invocation.';
  }

  if (status === 'degraded') {
    return 'Review warnings, align optional structure, and rerun the boot command.';
  }

  if (status === 'blocked') {
    return 'Restore the missing required structure and rerun the boot command.';
  }

  return 'Inspect the boot error, fix the failure cause, and rerun the boot command.';
}

function buildInvocationReadiness({ status }) {
  if (status === 'ready') {
    return {
      allowed: true,
      reason: 'System Boot completed successfully and the instance is ready for invocation preflight.',
    };
  }

  if (status === 'degraded') {
    return {
      allowed: false,
      reason: 'System Boot completed with degraded status and invocation remains blocked until explicitly allowed.',
    };
  }

  if (status === 'blocked') {
    return {
      allowed: false,
      reason: 'System Boot is blocked because required structure is missing or invalid.',
    };
  }

  return {
    allowed: false,
    reason: 'System Boot failed before the instance became invocation-ready.',
  };
}

export async function runSystemBoot(options = {}) {
  const bootRequest = createSystemBootRequest(options);
  const bootId = randomUUID();
  const startedAt = new Date().toISOString();
  const strict = bootRequest.strict;
  const requestedBy = bootRequest.requestedBy;
  const masRootHint = bootRequest.masRootHint;
  let projectRootPath = null;
  let masRootPath = null;
  let projectValidation = null;
  let masValidation = null;
  let warnings = [];
  let errors = [];
  let status = 'failed';
  let nextStep = buildNextStep('failed');

  try {
    const projectRootResolution = await resolveProjectRoot(bootRequest.projectRootPath);
    projectRootPath = projectRootResolution.projectRootPath;

    const masRootResolution = await resolveMasRoot({
      projectRootPath,
      masRootHint,
    });
    masRootPath = masRootResolution.masRootPath;

    projectValidation = await validateProjectStructure(projectRootPath);
    masValidation = await validateMasStructure(masRootPath);
    warnings = buildWarnings({ projectValidation, strict });
    errors = buildErrors({ projectValidation, masValidation });
    status = classifyStatus({ projectValidation, masValidation, strict, warnings });
    nextStep = buildNextStep(status);
    const invocationReadiness = buildInvocationReadiness({ status });
    const finishedAt = new Date().toISOString();

    const bootSession = openBootSession({
      bootId,
      requestedBy,
      strict,
      projectRootPath,
      masRootPath,
      masRootHint: masRootResolution.masRootHint,
      status,
      warnings,
      errors,
      invocationReadiness,
      startedAt,
      finishedAt,
    });

    const bootContext = buildBootContext({
      bootId,
      status,
      projectRootPath,
      masRootPath,
      masRootHint: masRootResolution.masRootHint,
      projectValidation,
      masValidation,
      warnings,
      errors,
      invocationReadiness,
      startedAt,
      finishedAt,
    });

    const bootReport = buildBootReport({
      bootId,
      status,
      projectRootPath,
      masRootPath,
      warnings,
      errors,
      nextStep,
      invocationReadiness,
      projectValidation,
      masValidation,
      startedAt,
      finishedAt,
    });

    const persistence = await writeBootArtifacts({
      status,
      projectRootPath,
      masRootPath,
      bootId,
      bootSession,
      bootContext,
      bootReport,
    });

    return assertSystemBootResult(buildBootResult({
      bootId,
      status,
      requestedBy,
      strict,
      projectRootPath,
      masRootPath,
      masRootHint: masRootResolution.masRootHint,
      projectValidation,
      masValidation,
      warnings,
      errors,
      nextStep,
      invocationReadiness,
      startedAt,
      finishedAt,
      persistence,
    }));
  } catch (error) {
    errors = [...errors, error.message];
    const finishedAt = new Date().toISOString();
    const invocationReadiness = buildInvocationReadiness({ status: 'failed' });
    let persistence = null;

    try {
      const bootSession = openBootSession({
        bootId,
        requestedBy,
        strict,
        projectRootPath,
        masRootPath,
        masRootHint,
        status: 'failed',
        warnings,
        errors,
        invocationReadiness,
        startedAt,
        finishedAt,
      });

      const bootContext = buildBootContext({
        bootId,
        status: 'failed',
        projectRootPath,
        masRootPath,
        masRootHint,
        projectValidation,
        masValidation,
        warnings,
        errors,
        invocationReadiness,
        startedAt,
        finishedAt,
      });

      const bootReport = buildBootReport({
        bootId,
        status: 'failed',
        projectRootPath,
        masRootPath,
        warnings,
        errors,
        nextStep: buildNextStep('failed'),
        invocationReadiness,
        projectValidation,
        masValidation,
        startedAt,
        finishedAt,
      });

      persistence = await writeBootArtifacts({
        status: 'failed',
        projectRootPath,
        masRootPath,
        bootId,
        bootSession,
        bootContext,
        bootReport,
      });
    } catch {
      persistence = null;
    }

    return assertSystemBootResult(buildBootResult({
      bootId,
      status: 'failed',
      requestedBy,
      strict,
      projectRootPath,
      masRootPath,
      masRootHint,
      projectValidation,
      masValidation,
      warnings,
      errors,
      nextStep: buildNextStep('failed'),
      invocationReadiness,
      startedAt,
      finishedAt,
      persistence,
    }));
  }
}
