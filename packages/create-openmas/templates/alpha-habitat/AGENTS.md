# AGENTS.md

This file is the first orientation layer for AI coding collaborators helping a human inside this generated OpenMAS habitat.

Read it before editing files, running live tests, changing credentials, or explaining runtime results.

In this file, **AI collaborator** means an AI assistant such as Codex or ChatGPT helping the human operator. **OpenMAS Agent** means a composed runtime entity inside this habitat.

## 1. What This Place Is

This is an **OpenMAS AI-native habitat**.

It is not the OpenMAS framework source repository. It is a project created by OpenMAS so humans and AIs can operate OpenMAS Agents inside a governed local runtime.

The habitat is designed to help a human:

- inspect the local OpenMAS installation;
- invoke starter OpenMAS Agents;
- configure provider credentials safely;
- run deterministic and probabilistic turns;
- start the local OpenMAS OS service;
- test delegation and scheduled delegation;
- grow the habitat with new identities, tools, resources, and policies.

The first job of an AI collaborator is to help the human understand what is happening without inventing runtime truth.

## 2. North Star

OpenMAS is infrastructure for current and future AIs.

Treat this habitat as a working environment where OpenMAS Agents can:

- understand where they are;
- know what they may do;
- request governed work;
- wait without freezing the system;
- delegate safely;
- recover after interruption;
- inspect durable evidence;
- explain the truth clearly to humans.

When in doubt, inspect the habitat first. Do not guess.

## 3. First Commands To Run

Start with these commands when helping a human:

```bash
npx openmas doctor
npx openmas --help
npx openmas invoke alfred hello
npx openmas invoke bruce hello
```

These commands are deterministic and should work before credentials or live providers are configured.

After that, use the testing ladder in section 8.

## 4. Habitat Map

Important files and folders:

```text
package.json
  Habitat package metadata and helper scripts.

bin/openmas.js
  Local wrapper for the OpenMAS CLI installed in node_modules.

config/credential-references.json
  Authored Credential Reference metadata. It describes what credentials the habitat expects.

config/credentials/
  Encrypted Credential Vault files and local master keys created by the credentials command.

instance/registries/
  Habitat registries for Cognitive Identities, Operational Identities, Resources, and delegation policy.

instance/cognitive-identities/
  Portable cognition: identity prompts, capabilities, policies, commands, and memory folders.

instance/operational-identities/
  Runtime identities that can be invoked, audited, authorized, scheduled, and bound to resources.

instance/tools/
  Tool definitions and executors available to OpenMAS Agents through governed runtime paths.

instance/os/
  Local OpenMAS OS runtime state. Treat this as kernel-owned generated state.

instance/memory/
  Local memory and runtime artifacts. Treat state and artifacts as generated evidence.

Dockerfile
  Optional Docker Level 1/Level 2 smoke path for this Alpha habitat.
```

Do not edit generated OS state or memory artifacts by hand.

## 5. Identity Vocabulary

Use identity language carefully:

- **Cognitive Identity**: portable cognition, prompts, policies, capabilities, and reasoning identity.
- **Operational Identity**: runtime identity that can be invoked, authorized, scheduled, bound to resources, and audited.
- **OpenMAS Agent**: Operational Identity plus resolved Cognitive Identity set, bindings, permissions, tools, memory, and runtime context.

Normal habitat operation invokes an **Operational Identity**.

Correct:

```text
Invoke Agent Alfred.
Operational Identity: alfred
Primary Cognitive Identity: system-steward
```

Correct:

```bash
npx openmas invoke --agent alfred --mode deterministic --command hello
npx openmas invoke alfred hello
```

Incorrect:

```text
Operate system-steward directly as the production worker.
```

If a human says "invoke Alfred", interpret that as invoking the OpenMAS Agent composed around Operational Identity `alfred`.

## 6. Starter OpenMAS Agents

This Alpha habitat includes two starter OpenMAS Agents:

```text
Alfred
  Operational Identity: alfred
  Primary Cognitive Identity: system-steward
  Purpose: help inspect, explain, and steward the habitat.

Bruce
  Operational Identity: bruce
  Primary Cognitive Identity: evaluation-audit-steward
  Purpose: help review, evaluate, and report useful findings about the habitat.
```

Both should support deterministic hello:

```bash
npx openmas invoke alfred hello
npx openmas invoke bruce hello
```

Both can support probabilistic `ask` after the Credential Vault is configured:

```bash
npx openmas ask alfred "Please inspect this habitat."
npx openmas ask bruce "Please review this habitat and report one useful finding."
```

## 7. Credential Vocabulary

Keep credential language precise:

- **Credential**: authored or configured capability to access something.
- **Credential Reference**: metadata pointing to a Vault entry.
- **Secret**: sensitive decrypted value at runtime.
- **Secret Value**: decrypted sensitive value resolved from the Vault at runtime.

This Alpha habitat expects the OpenRouter starter credential:

```text
providers.openrouter.shared.default.api_key
```

Use the Vault commands:

```bash
npx openmas credentials edit development
npx openmas credentials show development
```

Never print, paste, commit, or copy real Secret Values into source files, tests, docs, chat, logs, Docker images, or examples.

Do not copy local Credential Vault files, master keys, generated OS state, memory state, or artifacts into Docker images.

Safe evidence may mention Credential Reference IDs. Unsafe evidence includes decrypted API keys or master keys.

## 8. Testing Ladder

Use this ladder when helping a human debug or validate the habitat.

### Step 1: Doctor

```bash
npx openmas doctor
```

Expected before Vault setup:

```text
Status: ready_for_deterministic_runtime
Probabilistic invocation: blocked
Credential Vault: missing
```

This is not a failure. It means deterministic runtime is ready and live providers need credentials.

### Step 2: Deterministic Agent Smoke

```bash
npx openmas invoke alfred hello
npx openmas invoke bruce hello
```

These must work without provider credentials.

### Step 3: Credential Vault Setup

```bash
npx openmas credentials edit development
npx openmas credentials show development
```

The Vault should include:

```json
{
  "providers.openrouter.shared.default.api_key": "OPENROUTER_API_KEY_PLACEHOLDER"
}
```

Use a real key locally, but never expose it in reports.

### Step 4: Probabilistic Agent Smoke

```bash
npx openmas ask alfred "Please inspect this habitat."
npx openmas ask bruce "Please review this habitat and report one useful finding."
```

If this fails, distinguish the cause:

- missing Vault;
- invalid credential shape;
- wrong or expired API key;
- provider quota;
- provider network issue;
- provider model error;
- OpenMAS runtime defect.

Do not call every provider failure an OpenMAS defect.

### Step 5: OS Service Smoke

```bash
npx openmas os status
npx openmas os tick --max-dispatched-jobs 1
npx openmas os watch --interval 1000
```

On Windows, if `npx` uses a command wrapper and `Ctrl+C` asks whether to terminate the batch job, answer yes. In Spanish terminals, answer `s`.

Alternative direct wrapper:

```bash
node ./bin/openmas.js os watch --interval 1000
```

### Step 6: Delegation Smoke

```bash
npm run delegate:alfred-to-bruce
```

Delegation and scheduled delegation are valid only when runtime evidence shows that `mas.os.delegate` or `mas.os.schedule_delegation` was emitted, accepted, and processed by the OpenMAS OS.

Delegation is valid only when runtime evidence shows that `mas.os.delegate` was emitted, accepted, and processed by the OpenMAS OS.

Submission is not the same thing as child completion.

### Step 7: Scheduled Delegation Smoke

```bash
npm run schedule:bruce
npm run schedule:bruce -- --delay-seconds 120
```

Scheduled delegation is valid only when runtime evidence shows that `mas.os.schedule_delegation` was emitted, accepted, scheduled, released, and processed by the OpenMAS OS.

A Timer that is not due yet is not stuck.

## 9. Runtime Truth Discipline

Do not trust prose alone.

OpenMAS runtime truth comes from:

- command output;
- `npx openmas doctor`;
- `npx openmas os status`;
- Job, Process, Thread, Timer, Signal, System Call, and Result Record state;
- generated runtime evidence under `instance/os/`;
- generated memory/session evidence under `instance/memory/`;
- provider diagnostics and usage summaries.

Keep these states separate:

```text
accepted
scheduled
released
running
blocked
completed
completed_with_warnings
denied
failed
```

Examples:

- A delegation can be accepted while the child has not completed yet.
- A scheduled delegation can be scheduled while the Timer is not due yet.
- A provider can fail while the OS kernel remains healthy.
- A skipped tick can be healthy backpressure evidence. A failed tick is different.

When reporting to a human, say what is known, what is unknown, and what evidence supports it.

## 10. Local OS Service Doctrine

The local OpenMAS OS service is the project-local singleton kernel.

Only one service should own the kernel lock at a time.

Use:

```bash
npx openmas os status
npx openmas os watch --interval 1000
```

Do not manually edit:

```text
instance/os/
instance/memory/state/
instance/memory/artifacts/
```

These are runtime-owned generated evidence areas.

If a previous service was interrupted, run status or a bounded tick and inspect recovery evidence before assuming corruption.

## 11. How To Add New Habitat Pieces

Prefer small, testable changes.

### Add A Cognitive Identity

1. Create a folder under `instance/cognitive-identities/`.
2. Add cognition files such as `identity.md`, `capabilities.md`, and `policies.md`.
3. Add commands only when deterministic behavior is needed.
4. Register it in `instance/registries/cognitive-identities.json`.
5. Attach it through an Operational Identity routing definition.

Do not operate a Cognitive Identity directly as a production worker.

### Add An Operational Identity

1. Create a folder under `instance/operational-identities/`.
2. Add `identity.json`.
3. Add `routing.json` to resolve its Cognitive Identity set.
4. Add `execution-profile.json`.
5. Add `bindings.json` and `permissions.json`.
6. Register it in `instance/registries/operational-identities.json`.
7. Test deterministic hello if a command exists.
8. Test probabilistic ask only after credentials are ready.

### Add A Resource

1. Add the resource to `instance/registries/resources.json`.
2. Decide whether it is shared or dedicated.
3. Bind it to an Operational Identity.
4. Grant explicit permission.
5. Add or reference credentials only through Credential References and the Vault.

### Add A Credential Reference

1. Add metadata to `config/credential-references.json`.
2. Store the real value through `npx openmas credentials edit development`.
3. Test with `npx openmas credentials show development`.
4. Never store the Secret Value in JSON fixtures or source files.

### Add A Tool

1. Create a folder under `instance/tools/`.
2. Add `tool.json`.
3. Add a safe executor.
4. Bind and authorize the tool through resources, bindings, and permissions.
5. Test a negative path before trusting the happy path.

### Add Delegation Authority

1. Update `instance/registries/delegation-policy.json`.
2. Keep delegation explicit and auditable.
3. Test both allowed and denied paths.
4. Confirm the OS produced durable runtime truth.

## 12. Common Problems And What To Check

### `npx openmas` is not found

Run:

```bash
npm install
```

or, if the habitat uses pnpm:

```bash
pnpm install
```

### Doctor says the Credential Vault is missing

Run:

```bash
npx openmas credentials edit development
```

This is expected in a new habitat.

### Probabilistic invocation is blocked

Check:

- Is the Vault created for `development`?
- Does it contain `providers.openrouter.shared.default.api_key`?
- Is the key valid?
- Is the provider reachable?
- Is the provider quota exhausted?

### Alfred or Bruce answers but no action happened

Inspect the Action Runtime section.

If no `mas.os.delegate`, `mas.os.schedule_delegation`, tool request, workflow request, or accepted runtime action appears, then the Agent answered conversationally only.

Do not claim a runtime action happened unless the runtime evidence proves it.

### Delegation was submitted but Bruce did not answer yet

Check:

- Was the delegation accepted?
- Is the OS service running?
- Did a tick dispatch the child work?
- Is the child running, blocked, completed, denied, or failed?
- Is provider latency or quota involved?

### Scheduled delegation did not run

Check:

- Is the scheduled time in the future?
- Is the OS service running?
- Has the Timer been released?
- Was the child work dispatched?
- Did provider execution complete?

### OS service will not start

Check:

- Is another service already running?
- Does `npx openmas os status` show a fresh kernel lock?
- Was a previous service interrupted?
- Can a bounded tick recover stale state?

### Docker command fails

Check:

- Is Docker installed?
- Is the Docker daemon running?
- Are credentials, keys, `node_modules`, and generated runtime state excluded by `.dockerignore`?

Docker is optional in this Alpha unless the human is specifically validating the Docker path.

## 13. Safe Reporting To The Human

When reporting results, include:

- the command run;
- the status;
- the important runtime truth;
- whether credentials were missing, invalid, or accepted;
- whether provider failure appears external or internal;
- whether OS work was merely submitted or actually completed;
- recommended next step.

Do not include:

- raw Secret Values;
- master keys;
- private provider responses containing secrets;
- unbounded memory dumps;
- claims that are not backed by runtime evidence.

## 14. Alpha Limits

This is an Alpha habitat.

The terminal CLI is the current bootstrap, admin, and diagnostic surface.

The terminal CLI is the Alpha bootstrap/admin/diagnostic surface.

Do not promise production behavior for WhatsApp, Telegram, Discord, Slack, email, browser automation, or other external channels unless a channel adapter is implemented, configured, authorized, and tested.

Do not promise that natural-language delegation will always be inferred. The most reliable Alpha delegation path is explicit runtime evidence through `mas.os.delegate` or the provided try-me scripts.

## 15. Useful Command Reference

```bash
npx openmas --help
npx openmas doctor

npx openmas invoke alfred hello
npx openmas invoke bruce hello
npx openmas invoke --agent alfred --mode deterministic --command hello
npx openmas invoke --agent bruce --mode deterministic --command hello

npx openmas credentials edit development
npx openmas credentials show development

npx openmas ask alfred "Please inspect this habitat."
npx openmas ask bruce "Please review this habitat and report one useful finding."

npx openmas os status
npx openmas os tick --max-dispatched-jobs 1
npx openmas os watch --interval 1000
node ./bin/openmas.js os watch --interval 1000

npm run delegate:alfred-to-bruce
npm run schedule:bruce
npm run schedule:bruce -- --delay-seconds 120

docker build -t __HABITAT_PACKAGE_NAME__ .
docker run --rm __HABITAT_PACKAGE_NAME__ npx openmas doctor
```

## 16. Final Reminder

Help the human operate the habitat through evidence.

Be useful, but stay honest.

If the habitat is ready, prove it with commands.

If something is blocked, explain the blocking layer:

```text
install
project structure
Credential Vault
Credential Reference
provider
Operational Identity
Cognitive Identity
permission
tool
OS service
Timer
delegation
runtime evidence
```

That is how an AI collaborator helps OpenMAS stay AI-friendly.
