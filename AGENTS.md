# AGENTS.md

This file is for AI coding agents working inside the OpenMAS repository.

In this file, "agent" usually means an AI coding assistant such as Codex/ChatGPT helping with the repository. When referring to the OpenMAS runtime entity, use **OpenMAS Agent** explicitly.

## Project Identity

OpenMAS is an Open Source Multi-Agent System Framework.

The project is evolving toward an AI-native habitat: a JavaScript ESM framework, runtime, and operating-system-like coordination layer for Operational Identities, Cognitive Identities, tools, memory, policies, credentials, and agent interaction patterns.

The product name is **OpenMAS**. Old references to **OpenExperts** are historical and should not be reintroduced in `src/`, `bin/`, `tests/`, or public-facing current files.

## Current Public Baseline

This baseline is focused on test quality and first public repository hygiene.

Trusted staged surfaces for this commit:

- `AGENTS.md`
- `README.md`
- `package.json`
- `package-lock.json`
- `eslint.config.js`
- `tests/`

Current verified gates:

```text
npm run lint        -> passes for tests/
npm test            -> 1178 passing, 0 failing
```

ESLint is a development dependency only. It is not part of the OpenMAS runtime.

## Identity Vocabulary

Use OpenMAS identity language carefully:

- **Cognitive Identity**: portable cognition, prompts, policy, capabilities, and reasoning identity.
- **Operational Identity**: runtime identity that can be invoked, authorized, scheduled, bound to resources, and audited.
- **OpenMAS Agent**: the composed working entity: Operational Identity + Cognitive Identity + bindings + permissions + tools + runtime context.

Normal operation invokes an Operational Identity. Cognitive Identities may be evaluated, but they should not be operated directly inside the habitat.

Correct examples:

```text
Invoke Agent Alfred.
Operational Identity: alfred
Primary Cognitive Identity: system-steward
```

Avoid calling a Cognitive Identity an Agent unless referring to the composed OpenMAS Agent.

## Quality Gates

Before proposing or committing changes to current source or tests, run:

```bash
npm run lint
npm test
```

The default deterministic test suite is offline and must remain the normal confidence gate.

Live tests live under `tests/live/`. They may require a configured Credential Vault and external providers. Do not treat live tests as part of the default deterministic gate.

## Current Tooling

OpenMAS currently uses:

- JavaScript ESM
- Node.js `>=20`
- Node's built-in `node:test` runner
- npm as the current package manager
- `package-lock.json` as the npm lockfile
- ESLint for a modest test-quality gate

Do not introduce TypeScript, Prettier, Jest, Vitest, pnpm, Yarn, or other tooling unless the maintainers explicitly decide to do so.

## Runtime And Repository Boundaries

Do not commit private or generated runtime material.

Never stage:

- `node_modules/`
- credentials or master keys
- encrypted credentials unless explicitly approved
- generated runtime state
- memory logs
- runtime artifacts
- local temporary files
- private instance data

Treat these areas as generated or local unless told otherwise:

```text
instance/memory/state/
instance/memory/state-old/
instance/memory/artifacts/
instance/memory/artifacts-old/
instance/os/
```

The local workspace folder may still be named `openexperts` on a developer machine. That path name is not the product name.

## Development Discipline

Prefer small, reviewable slices.

When changing tests:

- keep deterministic tests under `tests/` organized by domain;
- keep provider/network tests under `tests/live/`;
- avoid real credentials, raw secrets, and private paths;
- preserve clear failure messages that explain whether a problem is vault, credential, provider, policy, runtime, or test setup.

When changing runtime code:

- preserve Operational Identity first invocation semantics;
- keep Cognitive Identity resolution internal unless explicitly designing evaluation tooling;
- preserve the OpenMAS OS singleton-kernel doctrine;
- avoid legacy compatibility work unless it protects a current OpenMAS safety boundary.

## Git Hygiene

This repository is intentionally ignore-first during early public baseline work.

Use explicit staging and review the staged list before committing:

```bash
git diff --cached --name-only
```

Do not stage broad generated folders by accident. If in doubt, stage exact files.

