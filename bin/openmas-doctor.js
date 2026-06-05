#!/usr/bin/env node

import {
  printOpenMasDoctorResult,
  runOpenMasDoctorCommand,
} from '../src/onboarding/openmas-doctor.js';

try {
  const commandResult = await runOpenMasDoctorCommand({
    argv: process.argv.slice(2),
  });

  process.exitCode = commandResult.exitCode;
} catch (error) {
  const fallbackResult = {
    kind: 'openmas_doctor_result',
    version: 1,
    status: 'blocked',
    exitCode: 1,
    project: {
      name: null,
      projectKind: null,
      schemaVersion: null,
      projectRootPath: process.cwd(),
      masRootPath: null,
    },
    runtime: {
      deterministicInvocation: {
        status: 'blocked',
        reason: error.message,
        blockedOperationalIdentityIds: [],
      },
      probabilisticInvocation: {
        status: 'blocked',
        reason: 'Doctor command failed before probabilistic readiness could be inspected.',
        requiredCredentialReferenceIds: [],
        missingCredentialReferenceIds: [],
        unresolvedCredentialReferenceIds: [],
      },
      credentialVault: null,
      osService: null,
    },
    identities: [],
    checks: [
      {
        id: 'doctor_command',
        label: 'Doctor command',
        status: 'blocked',
        summary: error.message,
        nextStep: null,
        details: {},
      },
    ],
    nextSteps: [
      'Fix the Doctor command error and rerun: npx openmas doctor',
    ],
    warnings: [],
    errors: [
      error.message,
    ],
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
  };

  printOpenMasDoctorResult(fallbackResult, process.stderr);
  process.exitCode = 1;
}

