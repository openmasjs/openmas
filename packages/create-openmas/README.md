# create-openmas

Create a new OpenMAS AI-native habitat.

`create-openmas` is the starter-habitat generator for OpenMAS. It creates a local habitat with Alfred and Bruce, a Credential Vault configuration surface, deterministic and probabilistic try-me commands, local OpenMAS OS service commands, delegation helpers, scheduled delegation helpers, and AI-friendly `AGENTS.md` guidance.

## Requirements

- Node.js `>=22`
- npm or pnpm
- An OpenRouter API key only when running probabilistic Alpha smoke tests

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

## First Commands

Run deterministic checks first:

```bash
npx openmas doctor
npx openmas invoke alfred hello
npx openmas invoke bruce hello
```

Then configure the development Credential Vault when you are ready for provider-backed Alpha tests:

```bash
npx openmas credentials edit development
npx openmas credentials show development
```

Never commit Credential Vault master keys, encrypted credentials, decrypted Secret Values, generated runtime state, or memory artifacts.

## Generated Habitat Includes

- Alfred, the starter System Steward Operational Identity.
- Bruce, the starter Evaluation Audit Steward Operational Identity.
- Portable Cognitive Identities for both stewards.
- A Credential Reference registry for the OpenRouter Alpha provider path.
- The `@openmas/core` runtime dependency, which exposes the `openmas` CLI binary after `npm install`.
- `mas.system.inspect`, `mas.os.delegate`, and `mas.os.schedule_delegation` starter tools.
- Local OS service commands for status, ticks, and watch mode.
- Docker Level 1 and Level 2 starter files.
- An AI-friendly `AGENTS.md` field guide for future collaborators.

## Alpha Status

This package is part of the OpenMAS Alpha. It is intended to prove the regular-user happy path and provide a clean starter habitat. Production deployment automation, external queues, chat surfaces, and messaging-channel adapters are future work.

## Links

- Website: https://openmas.dev/
- GitHub: https://github.com/openmasjs/openmas/
- Issues: https://github.com/openmasjs/openmas/issues

## License

MIT
