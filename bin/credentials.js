#!/usr/bin/env node

import process from 'node:process';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { readFile, writeFile, unlink, mkdir, mkdtemp } from 'node:fs/promises';
import { generateMasterKey } from '../src/credentials/generate-master-key.js';
import { resolveMasterKey } from '../src/credentials/resolve-master-key.js';
import { resolveCredentialVaultEnvironment } from '../src/credentials/resolve-credential-vault-environment.js';
import { openCredentialVault } from '../src/credentials/open-credential-vault.js';
import { writeCredentialVault } from '../src/credentials/write-credential-vault.js';

// --- Argument Parsing ---

function parseCommandLineArguments(argv) {
  const args = argv.slice(2);
  const subcommand = args[0] ?? null;
  let environment = null;

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--environment' && i + 1 < args.length) {
      environment = args[i + 1];
      i += 1;
      continue;
    }

    if (arg.startsWith('--environment=')) {
      environment = arg.slice('--environment='.length);
      continue;
    }

    if (!arg.startsWith('-') && environment === null) {
      environment = arg;
    }
  }

  return { subcommand, environment };
}

// --- Editor Resolution ---

function resolveEditor() {
  const visual = process.env.VISUAL ?? null;

  if (typeof visual === 'string' && visual.trim().length > 0) {
    return visual.trim();
  }

  const editor = process.env.EDITOR ?? null;

  if (typeof editor === 'string' && editor.trim().length > 0) {
    return editor.trim();
  }

  return null;
}

function parseEditorCommand(editorString) {
  const parts = editorString.split(/\s+/);
  return { command: parts[0], args: parts.slice(1) };
}

// --- Secure Temporary File ---

async function createSecureTempFile(content) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'openmas-credentials-'));
  const tempFilePath = path.join(tempDir, 'credentials.json');
  await writeFile(tempFilePath, content, 'utf8');
  return tempFilePath;
}

async function secureDeleteTempFile(tempFilePath) {
  try {
    const content = await readFile(tempFilePath);
    const zeros = Buffer.alloc(content.length, 0);
    await writeFile(tempFilePath, zeros);
    await unlink(tempFilePath);
  } catch {
    // Best-effort cleanup — if the file is already gone, that's fine.
  }
}

// --- Console Output ---

function printHeader() {
  console.log('');
  console.log('OpenMAS Credential Vault');
  console.log('');
}

function printNoEditorError() {
  console.error('Error: No editor found.');
  console.error('');
  console.error('Set the EDITOR or VISUAL environment variable to your preferred editor.');
  console.error('');
  console.error('Examples:');
  console.error('  export EDITOR="nano"');
  console.error('  export EDITOR="vim"');
  console.error('  export EDITOR="code --wait"');
  console.error('');
}

function printFirstTimeKeyGeneration(keyFilePath, masterKeyHex) {
  console.log('No master key found. Generating a new one.');
  console.log('');
  console.log(`Master key saved to: ${keyFilePath}`);
  console.log('');
  console.log('IMPORTANT: Keep this key secure and OUT of version control.');
  console.log('Share it with your team through a secure channel.');
  console.log('For CI/CD, set the environment variable: OPENMAS_MASTER_KEY');
  console.log('');
  console.log(`Master key: ${masterKeyHex}`);
  console.log('');
}

function printInvalidJsonError(tempFilePath, parseError) {
  console.error('Error: The edited content is not valid JSON.');
  console.error('');
  console.error('Your changes were NOT saved. The vault file was not modified.');
  console.error(`The temporary file has been preserved at: ${tempFilePath}`);
  console.error('');
  console.error(`JSON parse error: ${parseError.message}`);
  console.error('');
  console.error('Fix the JSON and try again, or discard by deleting the temporary file.');
  console.error('');
}

function printSuccess(vaultFilePath) {
  console.log(`Vault saved: ${vaultFilePath}`);
  console.log('');
}

function printUsage() {
  console.log('Usage:');
  console.log('  node bin/credentials.js edit [environment]');
  console.log('  node bin/credentials.js edit [--environment <name>]');
  console.log('  node bin/credentials.js show [environment]');
  console.log('  node bin/credentials.js show [--environment <name>]');
  console.log('');
  console.log('Commands:');
  console.log('  edit    Open the credential vault in your editor');
  console.log('  show    Display a redacted credential vault summary');
  console.log('');
  console.log('Options:');
  console.log('  --environment <name>   Target a specific environment vault');
  console.log('                         (e.g., development, staging, production)');
  console.log('');
  console.log('Examples:');
  console.log('  npm run credentials:edit --environment development');
  console.log('  npm run credentials:edit');
  console.log('  node bin/credentials.js edit development');
  console.log('');
  console.log('Default:');
  console.log('  When no environment is provided and OPENMAS_ENV is not set, OpenMAS uses development.');
  console.log('');
}

// --- Key File Path Resolution ---

function resolveKeyFilePath(projectRootPath, normalizedEnvironment) {
  return path.join(projectRootPath, 'config', 'credentials', `${normalizedEnvironment}.key`);
}

function resolveCliCredentialEnvironment({ environment }) {
  return resolveCredentialVaultEnvironment({
    requestedEnvironment: environment,
    environmentVariables: process.env,
  }).vaultEnvironment;
}

function describeCredentialValue(value) {
  if (typeof value === 'string') {
    return {
      status: value.length > 0 ? 'configured' : 'empty',
      valueShape: 'string',
      redactedValue: '[redacted-secret]',
      length: value.length,
    };
  }

  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return {
      status: 'configured',
      valueShape: 'json_object',
      redactedValue: '[redacted-secret]',
      keys: Object.keys(value).toSorted(),
    };
  }

  return {
    status: value === null ? 'null' : 'unsupported_shape',
    valueShape: Array.isArray(value) ? 'array' : typeof value,
    redactedValue: '[redacted-secret]',
  };
}

function buildRedactedCredentialVaultSummary({
  credentials,
  environment,
  projectRootPath,
  vaultFilePath,
}) {
  const entries = Object.entries(credentials ?? {}).toSorted(([leftKey], [rightKey]) => {
    return leftKey.localeCompare(rightKey);
  });

  return {
    kind: 'credential_vault_summary',
    version: 1,
    environment,
    vaultFilePath: path.relative(projectRootPath, vaultFilePath),
    credentialCount: entries.length,
    credentials: Object.fromEntries(entries.map(([credentialReferenceId, value]) => {
      return [
        credentialReferenceId,
        describeCredentialValue(value),
      ];
    })),
  };
}

// --- Subcommand: edit ---

async function runEdit({ projectRootPath, environment }) {
  printHeader();

  // 1. Resolve credential vault environment
  let normalizedEnvironment;

  try {
    normalizedEnvironment = resolveCliCredentialEnvironment({ environment });
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }

  // 2. Resolve editor
  const editorString = resolveEditor();

  if (editorString === null) {
    printNoEditorError();
    process.exit(1);
  }

  // 3. Resolve or generate master key
  let masterKeyResult = await resolveMasterKey({ projectRootPath, environment: normalizedEnvironment });
  let masterKeyHex;

  if (masterKeyResult.source === 'invalid') {
    console.error(`Error: ${masterKeyResult.reason}`);
    process.exit(1);
  }

  if (masterKeyResult.source === 'not_found') {
    masterKeyHex = generateMasterKey();
    const keyFilePath = resolveKeyFilePath(projectRootPath, normalizedEnvironment);

    await mkdir(path.dirname(keyFilePath), { recursive: true });
    await writeFile(keyFilePath, masterKeyHex + '\n', 'utf8');

    printFirstTimeKeyGeneration(keyFilePath, masterKeyHex);
  } else {
    masterKeyHex = masterKeyResult.masterKeyHex;
  }

  // 4. Read existing vault or start with empty object
  let plaintextJson;

  const vaultResult = await openCredentialVault({ projectRootPath, environment: normalizedEnvironment });

  if (vaultResult.exists) {
    plaintextJson = JSON.stringify(vaultResult.credentials, null, 2) + '\n';
  } else {
    plaintextJson = JSON.stringify({}, null, 2) + '\n';
  }

  // 5. Write to temporary file
  const tempFilePath = await createSecureTempFile(plaintextJson);

  // 6. Open editor
  const { command, args } = parseEditorCommand(editorString);
  const editorResult = spawnSync(command, [...args, tempFilePath], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  if (editorResult.status !== 0) {
    console.error(`Error: Editor exited with status ${editorResult.status}.`);
    await secureDeleteTempFile(tempFilePath);
    process.exit(1);
  }

  // 7. Read modified content
  let editedContent;

  try {
    editedContent = await readFile(tempFilePath, 'utf8');
  } catch (error) {
    console.error(`Error: Could not read the temporary file at ${tempFilePath}.`);
    console.error(error.message);
    process.exit(1);
  }

  // 8. Validate JSON
  let parsedCredentials;

  try {
    parsedCredentials = JSON.parse(editedContent);
  } catch (parseError) {
    printInvalidJsonError(tempFilePath, parseError);
    process.exit(1);
  }

  if (parsedCredentials === null || typeof parsedCredentials !== 'object' || Array.isArray(parsedCredentials)) {
    printInvalidJsonError(tempFilePath, new Error('Content must be a JSON object, not an array or primitive.'));
    process.exit(1);
  }

  // 9. Encrypt and write vault
  const writeResult = await writeCredentialVault({
    projectRootPath,
    environment: normalizedEnvironment,
    credentials: parsedCredentials,
    masterKeyHex,
  });

  // 10. Securely delete temporary file
  await secureDeleteTempFile(tempFilePath);

  // 11. Success
  printSuccess(writeResult.vaultFilePath);
}

// --- Subcommand: show ---

async function runShow({ projectRootPath, environment }) {
  printHeader();

  // 1. Resolve credential vault environment
  let normalizedEnvironment;

  try {
    normalizedEnvironment = resolveCliCredentialEnvironment({ environment });
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }

  // 2. Resolve master key
  const masterKeyResult = await resolveMasterKey({ projectRootPath, environment: normalizedEnvironment });

  if (masterKeyResult.source === 'not_found') {
    console.error('Error: No master key found.');
    console.error('');
    console.error('To resolve this, do one of the following:');
    console.error(`  1. Create a key file at config/credentials/${normalizedEnvironment}.key`);
    console.error('  2. Set the environment variable: OPENMAS_MASTER_KEY');
    console.error('  3. Ask your team lead for the master key.');
    console.error('');
    process.exit(1);
  }

  if (masterKeyResult.source === 'invalid') {
    console.error(`Error: ${masterKeyResult.reason}`);
    process.exit(1);
  }

  // 3. Open vault
  let vaultResult;

  try {
    vaultResult = await openCredentialVault({ projectRootPath, environment: normalizedEnvironment });
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }

  if (!vaultResult.exists) {
    const vaultRelativePath = path.relative(projectRootPath, vaultResult.vaultFilePath);
    console.error(`Error: No credential vault found at ${vaultRelativePath}`);
    console.error('');
    console.error("Run 'npm run credentials:edit' to create one.");
    console.error('');
    process.exit(1);
  }

  // 4. Print a redacted summary. Use `edit` when values must be inspected or changed.
  console.log(JSON.stringify(
    buildRedactedCredentialVaultSummary({
      credentials: vaultResult.credentials,
      environment: normalizedEnvironment,
      projectRootPath,
      vaultFilePath: vaultResult.vaultFilePath,
    }),
    null,
    2,
  ));
}

// --- Main ---

async function main() {
  const { subcommand, environment } = parseCommandLineArguments(process.argv);
  const projectRootPath = process.cwd();

  switch (subcommand) {
    case 'edit':
      await runEdit({ projectRootPath, environment });
      break;

    case 'show':
      await runShow({ projectRootPath, environment });
      break;

    default:
      printHeader();
      if (subcommand !== null) {
        console.error(`Error: Unknown command "${subcommand}".`);
        console.error('');
      }
      printUsage();
      process.exit(subcommand === null ? 0 : 1);
  }
}

function isMainModule() {
  if (typeof process.argv[1] !== 'string') {
    return false;
  }

  return path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMainModule()) {
  main().catch((error) => {
    console.error('');
    console.error(`Unexpected error: ${error.message}`);
    console.error('');
    process.exit(1);
  });
}

export {
  buildRedactedCredentialVaultSummary,
  parseCommandLineArguments,
};
