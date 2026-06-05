# __HABITAT_NAME__

This is an OpenMAS AI-native habitat.

## First Steps

```bash
npm install
npx openmas --help
npx openmas invoke --agent alfred --mode deterministic --command hello
npx openmas invoke alfred hello
npx openmas invoke --agent bruce --mode deterministic --command hello
npx openmas ask alfred "Can you inspect the habitat?"
npx openmas ask bruce "Please review this habitat and report one useful finding."
```

Using pnpm:

```bash
pnpm install
pnpm exec openmas --help
pnpm exec openmas invoke alfred hello
```

## OpenRouter Setup

Open the development Credential Vault:

```bash
npx openmas credentials edit development
```

Add:

```json
{
  "providers.openrouter.shared.default.api_key": "replace-with-your-openrouter-api-key"
}
```

The starter habitat uses `openrouter/free` so the first probabilistic smoke can run with a low-friction OpenRouter key. Provider availability, quota, and model behavior still belong to the provider.

Never commit Secret Values or master keys.

After the vault is configured:

```bash
npx openmas doctor
npx openmas ask alfred "Please inspect this habitat."
npx openmas ask bruce "Please review this habitat and report one useful finding."
```

## OS Service

In one terminal:

```bash
npx openmas os status
npx openmas os tick --max-dispatched-jobs 1
npx openmas os watch --interval 1000
```

Use `Ctrl+C` to stop `os watch` gracefully.

On Windows, when you need the cleanest shutdown evidence, prefer the local Node wrapper:

```bash
node ./bin/openmas.js os watch --interval 1000
```

## Delegation Try Me

With the Credential Vault configured and `os watch` running in another terminal:

```bash
npm run delegate:alfred-to-bruce
```

This asks Alfred to emit a governed `mas.os.delegate` request. Alfred should not claim Bruce completed the work until runtime evidence exists.

## Scheduled Try Me

With `os watch` still running:

```bash
npm run schedule:bruce
```

OpenMAS communication is asynchronous. The helper computes a future `runAt` timestamp and asks Alfred to emit `mas.os.schedule_delegation`. Use `npx openmas os status` to inspect service state after the scheduled time.

To change the delay:

```bash
npm run schedule:bruce -- --delay-seconds 120
```

With pnpm:

```bash
pnpm run schedule:bruce -- --delay-seconds 120
```

## Docker Try Me

Build the single-container Alpha image:

```bash
docker build -t __HABITAT_PACKAGE_NAME__ .
```

Run Doctor inside the container:

```bash
docker run --rm __HABITAT_PACKAGE_NAME__ npx openmas doctor
```

Run the local OS service inside the container:

```bash
docker run --rm --init __HABITAT_PACKAGE_NAME__
```

The generated `.dockerignore` keeps Credential Vault files, master keys, OS state, memory state, artifacts, logs, and local environment files out of the image by default.

## Alpha Notes

The terminal CLI is the Alpha bootstrap, administration, and diagnostic surface. Future user-facing interaction should move through governed channels such as WhatsApp, Telegram, Slack, and email as those adapters are implemented.

`AGENTS.md` is included so AI coding partners can understand this habitat before helping you change it.
