<p align="center">
  <img src="https://openmas.dev/assets/img/openmas-logo.png" alt="OpenMAS Logo" width="160" />
</p>

<h1 align="center">OpenMAS</h1>

<h3 align="center">Build AI Teams, Not AI Chatbots.</h3>

<p align="center">
  OpenMAS is an open-source framework for AI-native habitats:
  governed Operational Identities, Cognitive Identities, tools, memory,
  credentials, scheduling, delegation, and durable runtime evidence.
</p>

<p align="center">
  <a href="https://openmas.dev/">Website</a>
  ·
  <a href="https://github.com/openmasjs/openmas/">GitHub</a>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-green.svg" alt="MIT License" /></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%3E%3D22-blue.svg" alt="Node.js >= 22" /></a>
  <a href="https://github.com/openmasjs/openmas"><img src="https://img.shields.io/badge/status-alpha-orange.svg" alt="Status: Alpha" /></a>
</p>

---

## Alpha Status

OpenMAS is in Alpha foundation development.

The current Alpha focuses on the regular-user happy path:

- create a new OpenMAS habitat;
- run deterministic Alfred and Bruce invocations;
- configure the Credential Vault;
- run probabilistic provider-backed invocations through OpenRouter;
- inspect the local OpenMAS OS service;
- submit immediate delegation from Alfred to Bruce;
- submit scheduled delegation from Alfred to Bruce;
- preserve runtime evidence without exposing Secret Values.

This is not production orchestration yet. The terminal CLI is the Alpha bootstrap, administration, and diagnostic surface. Future user-facing interaction should move through governed channels such as WhatsApp, Telegram, Slack, and email as those adapters are implemented.

## Requirements

- Node.js `>=22`
- npm or pnpm
- An OpenRouter API key for probabilistic Alpha smoke tests
- Docker Desktop or Docker Engine only if you want to run the Docker try-me path

## Create A Habitat

Using npm:

```bash
npm create openmas@alpha marketing-and-sales-department
cd marketing-and-sales-department
npm install
```

Using pnpm:

```bash
pnpm create openmas@alpha marketing-and-sales-department
cd marketing-and-sales-department
pnpm install
```

The generated folder is your OpenMAS AI-native habitat. Its `package.json` installs the `@openmas/core` runtime package, which exposes the `openmas` CLI binary.

## First Deterministic Try Me

```bash
npx openmas doctor
npx openmas invoke alfred hello
npx openmas invoke bruce hello
```

Equivalent human-friendly form:

```bash
npx openmas invoke alfred hello
npx openmas invoke bruce hello
```

Deterministic invocation does not call an AI provider. It proves the habitat, Operational Identity, Cognitive Identity, routing, and deterministic command path are alive.

## OpenRouter Credential Setup

Open the development Credential Vault:

```bash
npx openmas credentials edit development
```

Add your OpenRouter key:

```json
{
  "providers.openrouter.shared.default.api_key": "replace-with-your-openrouter-api-key"
}
```

Never commit Secret Values or master keys.

The Alpha Habitat uses `openrouter/free` by default. This keeps the first probabilistic smoke low-friction, but provider availability, quotas, model behavior, and rate limits still belong to OpenRouter.

Verify readiness:

```bash
npx openmas credentials show development
npx openmas doctor
```

## First Probabilistic Try Me

```bash
npx openmas ask alfred "Please inspect this habitat."
npx openmas ask bruce "Please review this habitat and report one useful finding."
```

Probabilistic invocation calls the configured provider. OpenMAS should distinguish provider, Vault, credential, policy, runtime, and OS readiness failures clearly.

## Local OS Service Try Me

In one terminal:

```bash
npx openmas os watch --interval 1000
```

In another terminal:

```bash
npx openmas os status
```

On Windows, when you need the cleanest shutdown evidence, prefer the local Node wrapper:

```bash
node ./bin/openmas.js os watch --interval 1000
```

Use `Ctrl+C` to stop the service gracefully.

## Delegation Try Me

With the Credential Vault configured and `os watch` running:

```bash
npm run delegate:alfred-to-bruce
```

This asks Alfred to submit a governed `mas.os.delegate` request to the OpenMAS OS. Alfred should not claim Bruce completed work unless runtime evidence exists.

## Scheduled Try Me

With `os watch` running:

```bash
npm run schedule:bruce
```

To change the delay in a cross-platform way:

```bash
npm run schedule:bruce -- --delay-seconds 120
pnpm run schedule:bruce -- --delay-seconds 120
```

Scheduled work is asynchronous. Use `npx openmas os status` after the scheduled time to inspect release and child-result evidence.

## Docker Try Me

Level 1: build the Alpha Habitat image.

```bash
docker build -t openmas-habitat .
```

Level 2: run Doctor inside the container.

```bash
docker run --rm openmas-habitat npx openmas doctor
```

Run the local OS service inside the container:

```bash
docker run --rm --init openmas-habitat
```

Docker is intentionally single-container for Alpha. Docker Compose, external queues, Redis, and production deployment automation are not part of this Alpha path.

## AGENTS.md

Every generated habitat includes an `AGENTS.md` file.

That file is for AI coding partners. It explains the habitat boundary, safe commands, identity vocabulary, credential safety, OS state boundaries, and runtime evidence discipline.

If an AI assistant helps you modify a habitat, ask it to read `AGENTS.md` first.

## Cross-Platform Notes

OpenMAS is designed for Linux, macOS, Windows, and Docker-based local smoke paths.

Known Alpha limitations:

- Windows `npx` may show the native batch termination prompt after `Ctrl+C`; use `node ./bin/openmas.js os watch ...` when clean shutdown evidence matters.
- Docker tests require a running Docker daemon.
- Linux, macOS, and pnpm lanes must be recorded before a final Alpha publication gate.

## Contributing

OpenMAS welcomes contributions to the framework, runtime, tools, adapters, starter habitats, documentation, and tests.

Before changing runtime code, run:

```bash
npm run lint
npm test
```

Live tests under `tests/live/` may require a configured Credential Vault, provider access, and a paired OS service.

## License

OpenMAS is released under the [MIT License](LICENSE).

---

<p align="center">
  <strong>OpenMAS - Build AI Teams, Not AI Chatbots.</strong>
</p>

<p align="center">
  <em>Governed. Coordinated. Accountable.</em>
</p>
