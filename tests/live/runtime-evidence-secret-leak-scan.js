#!/usr/bin/env node

import path from 'node:path';
import process from 'node:process';
import { readFile, readdir } from 'node:fs/promises';
import {
  assertNoSecretLeak,
  createLiveSmokeDiagnosticError,
  readLiveCredentialVault,
  runLiveSmokeMain,
} from './live-smoke-helpers.js';

const RUNTIME_EVIDENCE_ROOTS = Object.freeze([
  'instance/os',
  'instance/memory/state',
  'instance/memory/artifacts',
]);

function isMissingFileError(error) {
  return error !== null
    && typeof error === 'object'
    && error.code === 'ENOENT';
}

function isTransientPublicationFileName(fileName) {
  return fileName.endsWith('.tmp');
}

function collectSecretScalars(value, credentialReferenceId, secrets = []) {
  if (typeof value === 'string' && value.length > 0) {
    secrets.push({
      credentialReferenceId,
      secretValue: value,
    });

    return secrets;
  }

  if (value !== null && typeof value === 'object') {
    for (const nestedValue of Object.values(value)) {
      collectSecretScalars(nestedValue, credentialReferenceId, secrets);
    }
  }

  return secrets;
}

async function listFilesRecursively(rootPath) {
  const entries = await readdir(rootPath, {
    withFileTypes: true,
  });
  const files = [];

  for (const entry of entries) {
    const childPath = path.join(rootPath, entry.name);

    if (entry.isDirectory()) {
      files.push(...await listFilesRecursively(childPath));
    } else if (entry.isFile() && !isTransientPublicationFileName(entry.name)) {
      files.push(childPath);
    }
  }

  return files;
}

async function readMasterKeySecrets(projectRootPath) {
  const credentialConfigPath = path.join(projectRootPath, 'config', 'credentials');
  const entries = await readdir(credentialConfigPath, {
    withFileTypes: true,
  });
  const secrets = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.key')) {
      continue;
    }

    const secretValue = (await readFile(path.join(credentialConfigPath, entry.name), 'utf8')).trim();

    if (secretValue.length > 0) {
      secrets.push({
        credentialReferenceId: `vault.master_key.${entry.name.slice(0, -'.key'.length)}`,
        secretValue,
      });
    }
  }

  return secrets;
}

async function scanRuntimeEvidence({
  projectRootPath = process.cwd(),
  credentials,
} = {}) {
  const credentialSecrets = Object.entries(credentials).flatMap(([credentialReferenceId, value]) => {
    return collectSecretScalars(value, credentialReferenceId);
  });
  const masterKeySecrets = await readMasterKeySecrets(projectRootPath);
  const secrets = [...credentialSecrets, ...masterKeySecrets];
  const evidenceFiles = (
    await Promise.all(RUNTIME_EVIDENCE_ROOTS.map(async (relativeRootPath) => {
      return listFilesRecursively(path.join(projectRootPath, relativeRootPath));
    }))
  ).flat();
  const findings = [];
  let scannedEvidenceFileCount = 0;

  for (const filePath of evidenceFiles) {
    let fileContent;

    try {
      fileContent = await readFile(filePath, 'utf8');
    } catch (error) {
      if (isMissingFileError(error)) {
        continue;
      }

      throw error;
    }

    scannedEvidenceFileCount += 1;

    assertNoSecretLeak(`Runtime evidence file ${path.relative(projectRootPath, filePath)}`, fileContent);

    for (const secret of secrets) {
      if (fileContent.includes(secret.secretValue)) {
        findings.push({
          credentialReferenceId: secret.credentialReferenceId,
          relativeFilePath: path.relative(projectRootPath, filePath),
        });
      }
    }
  }

  return {
    evidenceFileCount: scannedEvidenceFileCount,
    inspectedSecretScalarCount: secrets.length,
    findings,
  };
}

async function main() {
  const label = 'OpenMAS Runtime Evidence Secret Leak Scan';

  await runLiveSmokeMain(label, async () => {
    const credentials = await readLiveCredentialVault();
    const result = await scanRuntimeEvidence({
      credentials,
    });

    if (result.findings.length > 0) {
      throw createLiveSmokeDiagnosticError({
        phase: 'runtime_evidence_secret_scan',
        reasonCode: 'resolved_secret_value_persisted',
        message: 'Runtime evidence contains one or more resolved Secret Values.',
        probableCause: 'A runtime persistence boundary copied a Vault-backed Secret Value into generated evidence.',
        nextStep: 'Inspect and redact the listed evidence files, then harden the persistence boundary before continuing.',
        details: result.findings.map((finding) => {
          return `Credential Reference: ${finding.credentialReferenceId} | Evidence File: ${finding.relativeFilePath}`;
        }),
      });
    }

    console.log(label);
    console.log('');
    console.log('Status: passed');
    console.log(`Evidence Files Scanned: ${result.evidenceFileCount}`);
    console.log(`Secret Scalars Compared: ${result.inspectedSecretScalarCount}`);
    console.log('Resolved Secret Value Findings: 0');
    console.log('');

    process.exitCode = 0;
  });
}

await main();
