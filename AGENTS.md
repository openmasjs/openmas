# AGENTS.md

This file is the first orientation layer for AI coding collaborators working inside the OpenMAS repository.

Read it before proposing architecture, editing source code, or running live tests.

In this file, **AI collaborator** means an AI coding assistant such as Codex or ChatGPT helping with the repository. **OpenMAS Agent** means a composed runtime entity inside an OpenMAS habitat.

## 1. Project Identity

**OpenMAS** is an Open Source Multi-Agent System Framework.

OpenMAS is building an AI-native habitat where Operational Identities can solve useful problems through governed tools, memory, context, policies, credentials, conversations, Jobs, Processes, Threads, Timers, Signals, Events, System Calls, and Result Records.

OpenMAS should feel natural for human administrators while being designed as a native working environment for AIs.

## 2. North Star

The framework must not be the limiting factor for an OpenMAS Agent.

The quality of an OpenMAS Agent may vary with its brain provider, model, prompts, cognition, memory, tools, and policies. The habitat itself must remain hard, strong, safe, reliable, inspectable, and AI-friendly.

The central premise is:

```text
The intelligence of OpenMAS emerges from the governed coordination
of many small, bounded, cooperative units of work.
```

OpenMAS is infrastructure for current and future AIs. Build it as a habitat where an AI can understand where it is, know what it may do, request governed work, wait without freezing the system, delegate safely, recover after interruption, inspect durable evidence, and explain runtime truth clearly to humans.

## 3. Architecture Formula

Use this model when reasoning about the project:

```text
OpenMAS =
  Prompt Engineering
+ Memory and Context Engineering
+ Harness Engineering
+ AI Runtime Engineering
+ AI-Native Operating System Engineering
```

The five layers reinforce each other:

1. **Prompt Engineering** shapes cognition and instruction layers.
2. **Memory and Context Engineering** shapes bounded working sets and durable recall.
3. **Harness Engineering** shapes tools, workflows, permissions, approvals, evidence, and governance.
4. **AI Runtime Engineering** shapes invocation, provider execution, fallback, action resolution, verification, and persistence.
5. **AI-Native Operating System Engineering** shapes asynchronous coordination, scheduling, dispatch, recovery, lifecycle state, and durable runtime truth.

Do not solve a cross-layer problem inside one layer merely because that is the easiest place to patch it.

## 4. CPU And OS Reasoning Discipline

Before designing or changing coordination behavior, ask:

1. How have CPUs and operating systems already faced, addressed, or solved an analogous challenge?
2. Which CPU or OS metaphor helps OpenMAS solve the AI-native version clearly?

Use the analogy seriously, but do not copy it mechanically. OpenMAS is an AI-native computing environment.

Examples:

- Work enters the habitat as a **Job**.
- An admitted execution becomes a **Process**.
- The current bounded execution path is a **Thread**.
- Deferred time-based intent is represented by a durable **Timer**.
- User-mode clients request mutation through **System Calls**.
- The singleton local kernel owns authoritative runtime mutation.
- Long-running provider calls belong to bounded async workers. The kernel must keep ticking.
- Later completion is communicated through durable **Result Records**, not hopeful prose.

## 5. Canonical Identity Vocabulary

Use identity language carefully:

- **Cognitive Identity**: portable cognition, prompts, policy, capabilities, and reasoning identity.
- **Operational Identity**: runtime identity that can be invoked, authorized, scheduled, bound to resources, and audited.
- **OpenMAS Agent**: the composed working runtime entity: Operational Identity + resolved Cognitive Identity set + bindings + permissions + tools + memory + runtime context.

Normal habitat operation invokes an **Operational Identity**.

Cognitive Identities may be evaluated directly during development, but production behavior should not operate them as if they were independently addressable workers.

Correct:

```text
Invoke Agent Alfred.
Operational Identity: alfred
Primary Cognitive Identity: system-steward
```

Incorrect:

```text
Invoke system-steward as the production worker.
```

The user-facing CLI may accept `--agent alfred` as a friendly alias. Internal contracts remain Operational Identity first.

## 6. Credential Vocabulary

Keep credential language precise:

- **Credential**: authored or configured capability to access something.
- **Credential Reference**: authored metadata pointing to a Vault entry.
- **Secret**: sensitive decrypted value at runtime.
- **Secret Value**: decrypted sensitive value resolved from the Vault at runtime.

Runtime evidence may persist safe Credential References. It must never persist Secret Values.

Do not print, log, embed, copy, or fixture real Secret Values.

## 7. Kernel Doctrine

The local OpenMAS OS runtime follows a singleton-kernel doctrine:

- One project-local OS service owns kernel mutation authority at a time.
- Clients submit System Calls instead of mutating authoritative OS state directly.
- The singleton lock must be explicit, inspectable, renewable, and safely recoverable.
- Graceful shutdown must drain active ticks and bounded async workers.
- A successor kernel owner must recover durable work from disk without depending on predecessor memory.
- Mutable health snapshots may be published atomically through transient `.tmp` files.

Preserve the boundary between:

```text
user mode:
  clients, CLI commands, Operational Identity requests, governed affordances

kernel mode:
  authoritative state transitions, dispatch, release, recovery, durable lifecycle truth
```

## 8. Async Doctrine

OpenMAS communication is not real-time.

Even foreground requests cross probabilistic providers and may take time. Delegated and scheduled work are fundamentally asynchronous.

Do not block the kernel while waiting for provider completion.

Do not present submission as completion.

Keep these truths separate:

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

- A delegation System Call can be accepted while a child Operational Identity has not started yet.
- A Timer can be released while its scheduled child has not completed yet.
- A parent can wait for a child without freezing the runtime.
- A skipped tick can be healthy backpressure evidence. A failed tick is a different condition.

## 9. Source Of Truth Order

When determining what OpenMAS actually does, use this order:

1. Source code under `bin/` and `src/`
2. Deterministic tests under `tests/`
3. Fresh live runtime evidence

When implementation and expectations disagree, diagnose the drift before changing behavior.

## 10. Change Authorization Discipline

Do not modify source code merely because an improvement seems attractive.

Source changes should happen only under one of these conditions:

1. A clear, approved task authorizes the change.
2. Live tests or code inspection reveal a nasty edge or architectural weakness, and the maintainers agree to harden it.
3. A maintainer explicitly requests a change and the change makes architectural sense.

Before editing:

- inspect the existing wiring;
- preserve the project rhythm;
- reuse current helpers and contracts where practical;
- explain the intended edit;
- keep the change scoped;
- test the relevant boundary afterward.

Do not rewrite from scratch when the existing architecture already provides the right extension point.

## 11. Development Stack

OpenMAS currently uses:

- JavaScript ESM
- Node.js `>=20`
- npm
- `package-lock.json`
- Node's built-in `node:test` runner
- ESLint as a development-only dependency

Keep external runtime dependencies at zero or as close to zero as practical.

Do not introduce TypeScript, Prettier, Jest, Vitest, pnpm, Yarn, Redis, BullMQ, Docker, or other tooling unless the maintainers explicitly decide to do so.

## 12. Quality Gates

The normal deterministic confidence gate is offline:

```bash
npm run lint
npm test
```

Current verified deterministic baseline as of 2026-06-01:

```text
npm run lint -> passed
npm test     -> 1201 passed, 0 failed
```

Live tests live under `tests/live/`. They may require:

- a configured Credential Vault;
- provider network access;
- an OpenMAS OS service;
- explicit operator pairing;
- enough future scheduling margin for provider latency.

Current first-class live commands:

```bash
npm run test:live:providers
npm run test:live:alfred
npm run test:live:bruce
npm run test:live:delegation
npm run test:live:scheduled
npm run test:live:evidence-secrets
npm run test:live:alfred:durable
npm run test:live:alfred:fallback
```

Do not treat transient provider unavailability as a kernel defect. Persist and inspect the runtime truth first.

## 13. Live Pairing Discipline

When running paired OS-service tests:

1. Check stopped-state status before launch.
2. Ask the human operator to launch the service when an external terminal is useful.
3. Use a distinct `--service-id`.
4. Exercise foreground, delegation, scheduling, inspection, and Secret Value scanning deliberately.
5. Watch `Failed Ticks`, `Skipped Ticks`, workers, queues, blocked waits, lock freshness, and recent Result Records.
6. Treat `.tmp` files as transient atomic-publication artifacts.
7. Ask for `Ctrl+C` when shutdown evidence is needed.
8. Recheck stopped-state status, residue, Secret Value scans, lint, and deterministic tests after hardening.

Interpret telemetry correctly:

```text
Failed Ticks:
  tick orchestration errors requiring diagnosis

Skipped Ticks:
  bounded overlap prevention and backpressure telemetry
```

## 14. Repository Boundaries

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

Use explicit file staging when maintainers request Git work. Do not make broad repository-cleanup changes while solving an unrelated runtime task.

## 15. Development Style

Prefer small, reviewable slices.

When changing runtime code:

- preserve Operational Identity first semantics;
- keep Cognitive Identity resolution internal;
- preserve user-mode and kernel-mode boundaries;
- keep async execution bounded;
- retain durable evidence;
- fail closed when authority, lineage, policy, or runtime truth is unclear;
- keep Secret Values out of persisted evidence;
- preserve inspectable failure messages.

When changing tests:

- keep deterministic tests offline;
- place real-provider tests under `tests/live/`;
- avoid real credentials and private paths in fixtures;
- test negative paths and recovery paths;
- preserve clear diagnostics that distinguish Vault, credential, provider, policy, runtime, environment, and harness failures.

## 16. Final Reminder

OpenMAS is infrastructure for current and future AIs.

Build a habitat where an AI can:

- understand where it is;
- know what it may do;
- request governed work;
- wait without freezing the system;
- delegate safely;
- recover after interruption;
- inspect durable evidence;
- explain the truth clearly to humans.

That is the standard.
