import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { access, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runSystemBoot } from '../../src/boot/run-system-boot.js';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CREATE_OPENMAS_CLI_PATH = path.join(
  REPOSITORY_ROOT,
  'packages',
  'create-openmas',
  'bin',
  'create-openmas.js',
);
const INVOKE_AGENT_CLI_PATH = path.join(REPOSITORY_ROOT, 'bin', 'invoke-agent.js');
const OPENMAS_CLI_PATH = path.join(REPOSITORY_ROOT, 'bin', 'openmas.js');
const OPENROUTER_CREDENTIAL_REFERENCE_ID = 'providers.openrouter.shared.default.api_key';
const OPENROUTER_TEST_CREDENTIAL_VALUE = 'openrouter-test-credential-value';

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function assertFileExists(filePath) {
  await access(filePath);
}

function runNode(args, options = {}) {
  return spawnSync(process.execPath, args, {
    cwd: REPOSITORY_ROOT,
    encoding: 'utf8',
    ...options,
  });
}

async function createStarterHabitat(habitatName = 'marketing-and-sales-department') {
  const parentPath = await mkdtemp(path.join(os.tmpdir(), 'openmas-create-habitat-'));
  const result = runNode([
    CREATE_OPENMAS_CLI_PATH,
    habitatName,
  ], {
    cwd: parentPath,
  });
  const habitatPath = path.join(parentPath, habitatName);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /OpenMAS habitat created/u);
  assert.match(result.stdout, new RegExp(`Habitat: ${habitatName}`, 'u'));

  return {
    parentPath,
    habitatPath,
    stdout: result.stdout,
  };
}

async function writeCredentialEditorScript({
  parentPath,
  scriptName,
  content,
}) {
  const scriptPath = path.join(parentPath, scriptName);

  await writeFile(
    scriptPath,
    [
      "import { writeFile } from 'node:fs/promises';",
      `await writeFile(process.argv[2], ${JSON.stringify(content)}, 'utf8');`,
      '',
    ].join('\n'),
    'utf8',
  );

  return scriptPath;
}

function buildEditorEnvironment(editorScriptPath) {
  return {
    ...process.env,
    VISUAL: '',
    EDITOR: `"${process.execPath}" "${editorScriptPath}"`,
    OPENMAS_ENV: '',
    OPENMAS_MASTER_KEY: '',
  };
}

function parseCredentialShowJson(stdout) {
  const jsonStart = stdout.indexOf('{');

  assert.notEqual(jsonStart, -1, stdout);
  return JSON.parse(stdout.slice(jsonStart));
}

test('create-openmas generates an alpha habitat with portable project metadata', async () => {
  const { habitatPath } = await createStarterHabitat();
  const packageManifest = await readJson(path.join(habitatPath, 'package.json'));
  const credentialReferences = await readJson(path.join(habitatPath, 'config', 'credential-references.json'));
  const cognitiveIdentityRegistry = await readJson(
    path.join(habitatPath, 'instance', 'registries', 'cognitive-identities.json'),
  );
  const operationalIdentityRegistry = await readJson(
    path.join(habitatPath, 'instance', 'registries', 'operational-identities.json'),
  );
  const alfredExecutionProfile = await readJson(
    path.join(habitatPath, 'instance', 'operational-identities', 'alfred', 'execution-profile.json'),
  );
  const bruceExecutionProfile = await readJson(
    path.join(habitatPath, 'instance', 'operational-identities', 'bruce', 'execution-profile.json'),
  );

  assert.equal(packageManifest.name, 'marketing-and-sales-department');
  assert.equal(packageManifest.private, true);
  assert.equal(packageManifest.type, 'module');
  assert.equal(packageManifest.openmas.projectKind, 'habitat');
  assert.equal(packageManifest.openmas.schemaVersion, 1);
  assert.equal(packageManifest.dependencies['@openmas/core'], '0.1.0-alpha.2');
  assert.ok(!Object.hasOwn(packageManifest.dependencies, 'openmas'));
  assert.equal(packageManifest.scripts['hello:alfred'], 'node ./bin/openmas.js invoke alfred hello');
  assert.equal(packageManifest.scripts['hello:bruce'], 'node ./bin/openmas.js invoke bruce hello');
  assert.equal(
    packageManifest.scripts['ask:alfred'],
    'node ./bin/openmas.js ask alfred "Please inspect this habitat."',
  );
  assert.equal(
    packageManifest.scripts['ask:bruce'],
    'node ./bin/openmas.js ask bruce "Please review this habitat and report one useful finding."',
  );
  assert.equal(
    packageManifest.scripts['delegate:alfred-to-bruce'],
    'node ./bin/try-delegation.js',
  );
  assert.equal(
    packageManifest.scripts['schedule:bruce'],
    'node ./bin/try-scheduled-delegation.js',
  );
  assert.equal(packageManifest.scripts['os:status'], 'node ./bin/openmas.js os status');
  assert.equal(packageManifest.scripts['os:tick'], 'node ./bin/openmas.js os tick --max-dispatched-jobs 1');
  assert.equal(packageManifest.scripts['os:watch'], 'node ./bin/openmas.js os watch --interval 500');
  assert.equal(packageManifest.scripts['docker:build'], 'docker build -t marketing-and-sales-department .');
  assert.equal(
    packageManifest.scripts['docker:doctor'],
    'docker run --rm marketing-and-sales-department npx openmas doctor',
  );

  assert.equal(credentialReferences.kind, 'credential_reference_registry');
  assert.ok(credentialReferences.credentialReferences.some((credentialReference) => {
    return credentialReference.credentialReferenceId === OPENROUTER_CREDENTIAL_REFERENCE_ID;
  }));

  assert.deepEqual(
    cognitiveIdentityRegistry.cognitiveIdentities.map((entry) => entry.cognitiveIdentityId),
    ['system-steward', 'evaluation-audit-steward'],
  );
  assert.deepEqual(
    operationalIdentityRegistry.operationalIdentities.map((entry) => entry.operationalIdentityId),
    ['alfred', 'bruce'],
  );

  for (const executionProfile of [alfredExecutionProfile, bruceExecutionProfile]) {
    assert.equal(executionProfile.primaryBrain.providerId, 'openrouter-api');
    assert.equal(executionProfile.primaryBrain.modelId, 'openrouter/free');
    assert.equal(executionProfile.fallbackBrain, null);
  }

  await assertFileExists(path.join(habitatPath, '.gitignore'));
  await assertFileExists(path.join(habitatPath, '.dockerignore'));
  await assertFileExists(path.join(habitatPath, 'Dockerfile'));
  await assertFileExists(path.join(habitatPath, 'AGENTS.md'));
  await assertFileExists(path.join(habitatPath, 'bin', 'openmas.js'));
  await assertFileExists(path.join(habitatPath, 'bin', 'openmas'));
  await assertFileExists(path.join(habitatPath, 'bin', 'openmas.cmd'));
  await assertFileExists(path.join(habitatPath, 'bin', 'try-delegation.js'));
  await assertFileExists(path.join(habitatPath, 'bin', 'try-scheduled-delegation.js'));
  await assertFileExists(path.join(habitatPath, 'instance', 'tools', 'mas.system.inspect', 'executor.js'));
  await assertFileExists(path.join(habitatPath, 'instance', 'tools', 'mas.os.delegate', 'executor.js'));
  await assertFileExists(path.join(habitatPath, 'instance', 'tools', 'mas.os.schedule_delegation', 'executor.js'));
});

test('generated alpha habitat includes Docker Level 1 and Level 2 safeguards', async () => {
  const { habitatPath } = await createStarterHabitat('docker-ready-habitat');
  const dockerfile = await readFile(path.join(habitatPath, 'Dockerfile'), 'utf8');
  const dockerignore = await readFile(path.join(habitatPath, '.dockerignore'), 'utf8');
  const readme = await readFile(path.join(habitatPath, 'README.md'), 'utf8');
  const agentsGuide = await readFile(path.join(habitatPath, 'AGENTS.md'), 'utf8');

  assert.match(dockerfile, /^FROM node:24-slim$/mu);
  assert.match(dockerfile, /^ENV NODE_ENV=production$/mu);
  assert.match(dockerfile, /^ENV OPENMAS_ENV=development$/mu);
  assert.match(dockerfile, /^WORKDIR \/app$/mu);
  assert.match(dockerfile, /^COPY package\.json package-lock\.json\* \.\/$/mu);
  assert.match(dockerfile, /npm ci --omit=dev/u);
  assert.match(dockerfile, /npm install --omit=dev/u);
  assert.match(dockerfile, /^COPY --chown=node:node \. \.$/mu);
  assert.match(dockerfile, /^USER node$/mu);
  assert.match(dockerfile, /^STOPSIGNAL SIGTERM$/mu);
  assert.match(dockerfile, /^CMD \["npx", "openmas", "os", "watch", "--interval", "1000"\]$/mu);

  for (const ignoredPath of [
    '.git',
    '.npmrc',
    'node_modules',
    'config/credentials/*.key',
    'config/credentials/*.json',
    'config/credentials/*.json.enc',
    'config/credentials/*.tmp',
    'instance/os',
    'instance/memory/state',
    'instance/memory/state-old',
    'instance/memory/artifacts',
    'instance/memory/artifacts-old',
    'tmp',
    '*.log',
    '.env',
    '.env.*',
  ]) {
    assert.match(dockerignore, new RegExp(`^${ignoredPath.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}$`, 'mu'));
  }

  assert.match(readme, /Docker Try Me/u);
  assert.match(readme, /docker build -t docker-ready-habitat \./u);
  assert.match(readme, /docker run --rm docker-ready-habitat npx openmas doctor/u);
  assert.match(readme, /docker run --rm --init docker-ready-habitat/u);
  assert.match(readme, /keeps Credential Vault files, master keys, OS state, memory state, artifacts/u);
  assert.match(agentsGuide, /docker build -t docker-ready-habitat \./u);
  assert.match(agentsGuide, /Do not copy local Credential Vault files/u);
});

test('generated alpha habitat includes hardened OS action try-me helpers', async () => {
  const { habitatPath } = await createStarterHabitat('hardened-try-me-habitat');
  const delegationHelper = await readFile(path.join(habitatPath, 'bin', 'try-delegation.js'), 'utf8');
  const scheduledHelper = await readFile(path.join(habitatPath, 'bin', 'try-scheduled-delegation.js'), 'utf8');
  const readme = await readFile(path.join(habitatPath, 'README.md'), 'utf8');
  const agentsGuide = await readFile(path.join(habitatPath, 'AGENTS.md'), 'utf8');

  assert.match(delegationHelper, /mas\.os\.delegate/u);
  assert.match(delegationHelper, /Return exactly one JSON object and no prose/u);
  assert.match(delegationHelper, /tool-request-alpha-delegation-try-me/u);
  assert.match(delegationHelper, /brain_tool_request/u);
  assert.match(delegationHelper, /Copy the current OpenMAS OS parentContext object/u);
  assert.match(delegationHelper, /input\.targetOperationalIdentityId to "bruce"/u);
  assert.match(delegationHelper, /Do not use mas\.os\.schedule_delegation/u);
  assert.match(scheduledHelper, /mas\.os\.schedule_delegation/u);
  assert.match(scheduledHelper, /OPENMAS_TRY_SCHEDULE_DELAY_SECONDS/u);
  assert.match(scheduledHelper, /--delay-seconds/u);
  assert.match(scheduledHelper, /toISOString/u);
  assert.match(readme, /npm run delegate:alfred-to-bruce/u);
  assert.match(readme, /npm run schedule:bruce/u);
  assert.match(readme, /pnpm install/u);
  assert.match(readme, /pnpm exec openmas invoke alfred hello/u);
  assert.match(readme, /npm run schedule:bruce -- --delay-seconds 120/u);
  assert.match(readme, /pnpm run schedule:bruce -- --delay-seconds 120/u);
  assert.doesNotMatch(readme, /OPENMAS_TRY_SCHEDULE_DELAY_SECONDS=120 npm/u);
  assert.match(readme, /node \.\/bin\/openmas\.js os watch --interval 1000/u);
  assert.match(readme, /terminal CLI is the Alpha bootstrap, administration, and diagnostic surface/u);
  assert.match(readme, /WhatsApp, Telegram, Slack, and email/u);
  assert.match(readme, /AGENTS\.md/u);
  assert.match(agentsGuide, /Delegation and scheduled delegation are valid only when runtime evidence/u);
  assert.match(agentsGuide, /Alpha bootstrap\/admin\/diagnostic surface/u);
});

test('generated alpha habitat ships strong evidence-grounded Alfred and Bruce stewards', async () => {
  const { habitatPath } = await createStarterHabitat('strong-stewards-habitat');
  const alfredOperationalIdentity = await readJson(
    path.join(habitatPath, 'instance', 'operational-identities', 'alfred', 'identity.json'),
  );
  const bruceOperationalIdentity = await readJson(
    path.join(habitatPath, 'instance', 'operational-identities', 'bruce', 'identity.json'),
  );
  const alfredIdentity = await readFile(
    path.join(habitatPath, 'instance', 'cognitive-identities', 'system-steward', 'identity.md'),
    'utf8',
  );
  const alfredCapabilities = await readFile(
    path.join(habitatPath, 'instance', 'cognitive-identities', 'system-steward', 'capabilities.md'),
    'utf8',
  );
  const alfredPolicies = await readFile(
    path.join(habitatPath, 'instance', 'cognitive-identities', 'system-steward', 'policies.md'),
    'utf8',
  );
  const bruceIdentity = await readFile(
    path.join(
      habitatPath,
      'instance',
      'cognitive-identities',
      'stewards',
      'evaluation-audit',
      'identity.md',
    ),
    'utf8',
  );
  const bruceCapabilities = await readFile(
    path.join(
      habitatPath,
      'instance',
      'cognitive-identities',
      'stewards',
      'evaluation-audit',
      'capabilities.md',
    ),
    'utf8',
  );
  const brucePolicies = await readFile(
    path.join(
      habitatPath,
      'instance',
      'cognitive-identities',
      'stewards',
      'evaluation-audit',
      'policies.md',
    ),
    'utf8',
  );

  assert.match(alfredIdentity, /Alfred is not a generic chatbot/u);
  assert.match(alfredIdentity, /operational front door/u);
  assert.match(alfredCapabilities, /Read-Only Habitat Inspection/u);
  assert.match(alfredCapabilities, /Immediate Delegation To Bruce/u);
  assert.match(alfredCapabilities, /Scheduled Delegation To Bruce/u);
  assert.match(alfredCapabilities, /cannot yet[\s\S]*Certify the whole habitat as production-ready/u);
  assert.match(alfredPolicies, /Evidence Discipline/u);
  assert.match(alfredPolicies, /OpenMAS Vocabulary Discipline/u);
  assert.match(alfredPolicies, /Credential Safety/u);
  assert.match(alfredPolicies, /mas\.os\.delegate/u);
  assert.match(alfredPolicies, /mas\.os\.schedule_delegation/u);

  assert.match(bruceIdentity, /Bruce is not a second generic assistant/u);
  assert.match(bruceIdentity, /skeptical review voice/u);
  assert.match(bruceCapabilities, /Overclaim And Evidence Gap Detection/u);
  assert.match(bruceCapabilities, /claiming scheduled work ran when only a Timer was created/u);
  assert.match(bruceCapabilities, /cannot yet[\s\S]*Certify production readiness/u);
  assert.match(brucePolicies, /Evidence Discipline/u);
  assert.match(brucePolicies, /Overclaim Prevention/u);
  assert.match(brucePolicies, /Operational Identity Accuracy/u);
  assert.match(brucePolicies, /Do not infer that no Operational Identities exist/u);

  assert.ok(alfredOperationalIdentity.persona.operationalScope.includes('guide_onboarding'));
  assert.ok(alfredOperationalIdentity.persona.operationalScope.includes('delegate_to_bruce'));
  assert.ok(alfredOperationalIdentity.persona.operationalScope.includes('schedule_bruce_review'));
  assert.ok(bruceOperationalIdentity.persona.operationalScope.includes('review_runtime_evidence'));
  assert.ok(bruceOperationalIdentity.persona.operationalScope.includes('detect_overclaim'));
  assert.ok(bruceOperationalIdentity.persona.operationalScope.includes('report_concise_findings'));
});

test('generated alpha habitat can create and show a redacted OpenRouter Credential Vault', async () => {
  const { parentPath, habitatPath } = await createStarterHabitat('credential-habitat');
  const editorScriptPath = await writeCredentialEditorScript({
    parentPath,
    scriptName: 'write-openrouter-credential.mjs',
    content: JSON.stringify({
      [OPENROUTER_CREDENTIAL_REFERENCE_ID]: OPENROUTER_TEST_CREDENTIAL_VALUE,
    }, null, 2),
  });
  const editResult = runNode([
    OPENMAS_CLI_PATH,
    'credentials',
    'edit',
    'development',
  ], {
    cwd: habitatPath,
    env: buildEditorEnvironment(editorScriptPath),
  });

  assert.equal(editResult.status, 0, editResult.stderr);
  assert.match(editResult.stdout, /OpenMAS Credential Vault/u);
  assert.match(editResult.stdout, /Vault saved:/u);
  assert.doesNotMatch(editResult.stdout, new RegExp(OPENROUTER_TEST_CREDENTIAL_VALUE, 'u'));
  assert.doesNotMatch(editResult.stderr, new RegExp(OPENROUTER_TEST_CREDENTIAL_VALUE, 'u'));

  await assertFileExists(path.join(habitatPath, 'config', 'credentials', 'development.key'));
  await assertFileExists(path.join(habitatPath, 'config', 'credentials', 'development.json.enc'));

  const showResult = runNode([
    OPENMAS_CLI_PATH,
    'credentials',
    'show',
    'development',
  ], {
    cwd: habitatPath,
    env: {
      ...process.env,
      OPENMAS_ENV: '',
      OPENMAS_MASTER_KEY: '',
    },
  });
  const redactedSummary = parseCredentialShowJson(showResult.stdout);

  assert.equal(showResult.status, 0, showResult.stderr);
  assert.equal(redactedSummary.kind, 'credential_vault_summary');
  assert.equal(redactedSummary.environment, 'development');
  assert.equal(redactedSummary.credentialCount, 1);
  assert.equal(
    redactedSummary.credentials[OPENROUTER_CREDENTIAL_REFERENCE_ID].redactedValue,
    '[redacted-secret]',
  );
  assert.doesNotMatch(showResult.stdout, new RegExp(OPENROUTER_TEST_CREDENTIAL_VALUE, 'u'));
  assert.doesNotMatch(showResult.stderr, new RegExp(OPENROUTER_TEST_CREDENTIAL_VALUE, 'u'));
});

test('generated alpha habitat rejects invalid edited credential JSON safely', async () => {
  const { parentPath, habitatPath } = await createStarterHabitat('invalid-credential-habitat');
  const editorScriptPath = await writeCredentialEditorScript({
    parentPath,
    scriptName: 'write-invalid-credential-json.mjs',
    content: '{ invalid json',
  });
  const result = runNode([
    OPENMAS_CLI_PATH,
    'credentials',
    'edit',
    'development',
  ], {
    cwd: habitatPath,
    env: buildEditorEnvironment(editorScriptPath),
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /not valid JSON/u);
  assert.match(result.stderr, /Your changes were NOT saved/u);
  assert.match(result.stderr, /temporary file has been preserved/u);
});

test('generated alpha habitat gives clear cross-platform editor guidance when no editor is configured', async () => {
  const { habitatPath } = await createStarterHabitat('missing-editor-habitat');
  const result = runNode([
    OPENMAS_CLI_PATH,
    'credentials',
    'edit',
    'development',
  ], {
    cwd: habitatPath,
    env: {
      ...process.env,
      VISUAL: '',
      EDITOR: '',
      OPENMAS_ENV: '',
      OPENMAS_MASTER_KEY: '',
    },
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /No editor found/u);
  assert.match(result.stderr, /Linux\/macOS examples/u);
  assert.match(result.stderr, /Windows Command Prompt examples/u);
  assert.match(result.stderr, /Windows PowerShell examples/u);
});

test('generated alpha habitat boots as ready without framework source folders', async () => {
  const { habitatPath } = await createStarterHabitat('ready-habitat');

  const bootResult = await runSystemBoot({
    projectRootPath: habitatPath,
  });

  assert.equal(bootResult.status, 'ready');
  assert.equal(bootResult.projectValidation.projectKind, 'habitat');
  assert.deepEqual(bootResult.projectValidation.missingRequiredComponents, []);
  assert.deepEqual(bootResult.projectValidation.missingOptionalComponents, []);
  assert.equal(bootResult.invocationReadiness.allowed, true);
});

test('generated alpha habitat runs Alfred and Bruce deterministic hello through the runtime', async () => {
  const { habitatPath } = await createStarterHabitat('deterministic-habitat');

  for (const operationalIdentityId of ['alfred', 'bruce']) {
    const result = runNode([
      INVOKE_AGENT_CLI_PATH,
      '--project-root',
      habitatPath,
      '--agent',
      operationalIdentityId,
      '--mode',
      'deterministic',
      '--command',
      'hello',
    ]);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /OpenMAS Agent Invocation/u);
    assert.match(result.stdout, /Status: completed/u);
    assert.match(result.stdout, new RegExp(`Operational Identity: ${operationalIdentityId}`, 'u'));
    assert.match(result.stdout, /Primary Cognitive Identity:/u);
    assert.match(result.stdout, /OpenMAS habitat/u);
    assert.doesNotMatch(result.stdout, /OpenExperts|openexperts/u);
    assert.doesNotMatch(result.stdout, /Provider & Credential Readiness/u);
    assert.doesNotMatch(result.stdout, /Secret resolution warning|Credential resolution warning/u);
    assert.doesNotMatch(result.stdout, new RegExp(OPENROUTER_CREDENTIAL_REFERENCE_ID, 'u'));
    assert.equal(result.stderr, '');
  }
});

test('openmas public CLI can invoke generated habitat Operational Identities', async () => {
  const { habitatPath } = await createStarterHabitat('public-cli-habitat');

  const explicitResult = runNode([
    OPENMAS_CLI_PATH,
    'invoke',
    '--project-root',
    habitatPath,
    '--agent',
    'alfred',
    '--mode',
    'deterministic',
    '--command',
    'hello',
  ]);
  const shortcutResult = runNode([
    OPENMAS_CLI_PATH,
    'invoke',
    'alfred',
    'hello',
    '--project-root',
    habitatPath,
  ]);

  for (const result of [explicitResult, shortcutResult]) {
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /OpenMAS Agent Invocation/u);
    assert.match(result.stdout, /Operational Identity: alfred/u);
    assert.match(result.stdout, /Primary Cognitive Identity: system-steward/u);
  }
});

test('openmas ask reports missing OpenRouter credentials without calling a provider', async () => {
  const { habitatPath } = await createStarterHabitat('probabilistic-missing-credential-habitat');
  const result = runNode([
    OPENMAS_CLI_PATH,
    'ask',
    'alfred',
    'Please inspect this habitat.',
    '--project-root',
    habitatPath,
  ], {
    env: {
      ...process.env,
      OPENMAS_ENV: '',
      OPENMAS_MASTER_KEY: '',
    },
  });
  const combinedOutput = `${result.stdout}\n${result.stderr}`;

  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /OpenMAS Agent Invocation/u);
  assert.match(result.stdout, /Operational Identity: alfred/u);
  assert.match(combinedOutput, /Credential Reference|credential|Credential Vault/u);
  assert.match(combinedOutput, new RegExp(OPENROUTER_CREDENTIAL_REFERENCE_ID, 'u'));
  assert.doesNotMatch(combinedOutput, /sk-or-|AIza|OPENMAS_MASTER_KEY/u);
});

test('generated alpha habitat exposes delegation and scheduled try-me affordances safely', async () => {
  const { habitatPath } = await createStarterHabitat('delegation-scheduled-habitat');
  const delegationPolicy = await readJson(
    path.join(habitatPath, 'instance', 'registries', 'delegation-policy.json'),
  );
  const delegateTool = await readJson(
    path.join(habitatPath, 'instance', 'tools', 'mas.os.delegate', 'tool.json'),
  );
  const scheduledTool = await readJson(
    path.join(habitatPath, 'instance', 'tools', 'mas.os.schedule_delegation', 'tool.json'),
  );

  assert.equal(delegationPolicy.defaultEffect, 'deny');
  assert.ok(delegationPolicy.rules.some((rule) => {
    return rule.effect === 'allow'
      && rule.fromOperationalIdentityId === 'alfred'
      && rule.toOperationalIdentityId === 'bruce'
      && rule.actionTypes.includes('delegate')
      && rule.actionTypes.includes('schedule_delegation')
      && rule.commands.includes('ask')
      && rule.modes.includes('probabilistic');
  }));
  assert.equal(delegateTool.lifecycleState, 'active');
  assert.equal(delegateTool.intentMetadata.primaryIntentId, 'mas.os.delegate');
  assert.match(delegateTool.intentMetadata.exampleRequests.join('\n'), /Ask Bruce/u);
  assert.match(delegateTool.intentMetadata.exampleRequests.join('\n'), /mas\.os\.delegate/u);
  assert.equal(scheduledTool.lifecycleState, 'active');
  assert.equal(scheduledTool.intentMetadata.primaryIntentId, 'mas.os.schedule_delegation');
  assert.match(scheduledTool.intentMetadata.exampleRequests.join('\n'), /one minute from now/u);
  assert.match(scheduledTool.intentMetadata.exampleRequests.join('\n'), /mas\.os\.schedule_delegation/u);

  for (const input of [
    [
      'Return exactly one JSON object and no prose.',
      'Emit kind "brain_tool_request", version 1, toolRequestId "tool-request-alpha-delegation-try-me", toolId "mas.os.delegate", purpose "OpenMAS delegation try-me", and expectedSideEffectLevel "write_internal".',
      'Copy the current OpenMAS OS parentContext object exactly as provided by your OpenMAS OS context layer into input.parentContext.',
      'Set input.targetOperationalIdentityId to "bruce".',
      'Set input.task exactly to "Bruce, in one short sentence, confirm that you received the OpenMAS delegation try-me request.".',
      'Set input.command to "ask".',
      'Set input.mode to "probabilistic".',
      'Do not use mas.os.schedule_delegation for this request.',
    ].join(' '),
    [
      'Return exactly one JSON object and no prose.',
      'Emit kind "brain_tool_request", version 1, toolRequestId "tool-request-alpha-scheduled-try-me", toolId "mas.os.schedule_delegation", purpose "OpenMAS scheduled delegation try-me", and expectedSideEffectLevel "write_internal".',
      'Copy the current OpenMAS OS parentContext object exactly as provided by your OpenMAS OS context layer into input.parentContext.',
      'Set input.targetOperationalIdentityId to "bruce".',
      'Set input.task exactly to "Bruce, in one short sentence, confirm that you received the OpenMAS scheduled delegation try-me request."',
      'Set input.runAt exactly to "2099-01-01T00:00:00.000Z" with no suffix and no transformation.',
      'Set input.missedRunPolicy to "delay".',
      'Set input.command to "ask".',
      'Set input.mode to "probabilistic".',
    ].join(' '),
  ]) {
    const result = runNode([
      OPENMAS_CLI_PATH,
      'ask',
      'alfred',
      input,
      '--project-root',
      habitatPath,
    ], {
      env: {
        ...process.env,
        OPENMAS_ENV: '',
        OPENMAS_MASTER_KEY: '',
      },
    });
    const combinedOutput = `${result.stdout}\n${result.stderr}`;

    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /OpenMAS Agent Invocation/u);
    assert.match(result.stdout, /Operational Identity: alfred/u);
    assert.match(combinedOutput, /Credential Reference|credential|Credential Vault/u);
    assert.match(combinedOutput, new RegExp(OPENROUTER_CREDENTIAL_REFERENCE_ID, 'u'));
    assert.doesNotMatch(combinedOutput, /sk-or-|AIza|OPENMAS_MASTER_KEY/u);
  }
});

test('openmas os status and bounded tick work from a generated habitat root', async () => {
  const { habitatPath } = await createStarterHabitat('local-os-service-habitat');
  const initialStatusResult = runNode([
    OPENMAS_CLI_PATH,
    'os',
    'status',
  ], {
    cwd: habitatPath,
  });

  assert.equal(initialStatusResult.status, 0, initialStatusResult.stderr);
  assert.match(initialStatusResult.stdout, /OpenMAS OS Service Status/u);
  assert.match(initialStatusResult.stdout, new RegExp(`Project Root: ${habitatPath.replaceAll('\\', '\\\\')}`, 'u'));
  assert.match(initialStatusResult.stdout, /Service ID: none/u);
  assert.match(initialStatusResult.stdout, /Kernel Lock:/u);
  assert.match(initialStatusResult.stdout, /Async Executions Active:/u);
  assert.match(initialStatusResult.stdout, /System Calls Processed:/u);
  assert.match(initialStatusResult.stdout, /Next Action:/u);

  const tickResult = runNode([
    OPENMAS_CLI_PATH,
    'os',
    'tick',
    '--max-dispatched-jobs',
    '1',
  ], {
    cwd: habitatPath,
  });

  assert.equal(tickResult.status, 0, tickResult.stderr);
  assert.match(tickResult.stdout, /OpenMAS OS Service Tick/u);
  assert.match(tickResult.stdout, /Status: idle|Status: completed/u);
  assert.match(tickResult.stdout, /System Calls:/u);
  assert.match(tickResult.stdout, /Released Jobs:/u);
  assert.match(tickResult.stdout, /Settled Async Dispatches:/u);

  const followupStatusResult = runNode([
    OPENMAS_CLI_PATH,
    'os',
    'status',
  ], {
    cwd: habitatPath,
  });

  assert.equal(followupStatusResult.status, 0, followupStatusResult.stderr);
  assert.match(followupStatusResult.stdout, /OpenMAS OS Service Status/u);
  assert.match(followupStatusResult.stdout, /Status: stopped/u);
  assert.match(followupStatusResult.stdout, /Last Tick: idle|Last Tick: completed/u);
  assert.match(followupStatusResult.stdout, /Tick Count: 1/u);
  assert.match(followupStatusResult.stdout, /Failed Ticks: 0/u);
  assert.match(followupStatusResult.stdout, /Skipped Ticks: 0/u);
});
