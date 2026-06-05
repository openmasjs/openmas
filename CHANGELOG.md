# Changelog

All notable changes to OpenMAS will be documented in this file.

This changelog follows the spirit of [Keep a Changelog](https://keepachangelog.com/) and OpenMAS versioning follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Planned

- Continue hardening the regular-user onboarding path.
- Complete Alpha release staging and npm publishing checks.
- Expand cross-platform certification evidence for Windows, Linux, and macOS.

## [0.1.0-alpha.1] - 2026-06-04

### Added

- First public Alpha package shape for `openmas`.
- Public `openmas` CLI front door for habitat invocation, doctor checks, Credential Vault commands, and local OS service commands.
- `create-openmas` package with a starter Alpha habitat template.
- Starter habitat with two Operational Identities: Alfred and Bruce.
- Portable Cognitive Identity layout for the starter stewards.
- Credential Vault support for environment-scoped encrypted credentials.
- Credential Reference registry for authored credential metadata.
- Vault-backed provider readiness diagnostics through `openmas doctor`.
- OpenRouter-backed probabilistic invocation path for the starter habitat.
- Deterministic `hello` try-me path for Alfred and Bruce.
- Probabilistic `ask` try-me path for Alfred and Bruce.
- Local OpenMAS OS service with singleton kernel lock, heartbeat, status, ticks, graceful shutdown, and bounded async execution.
- System Call path for kernel-owned mutation.
- Immediate delegation try-me from Alfred to Bruce through `mas.os.delegate`.
- Scheduled delegation try-me from Alfred to Bruce through `mas.os.schedule_delegation`.
- Runtime evidence and Result Records for inspectable OS truth.
- Live smoke tests for providers, Alfred, Bruce, delegation, scheduled delegation, fallback, durable context, and Secret Value evidence scanning.
- ESLint quality gate for `bin`, `src`, `tests`, and `packages`.
- AI-friendly `AGENTS.md` guidance for repository and generated habitat collaborators.
- Docker Level 1 and Level 2 template files for generated habitats.

### Changed

- Clarified Operational Identity first invocation semantics.
- Added `--agent` as a user-friendly alias for `--operational-identity`.
- Hardened generated-habitat delegation and scheduled delegation prompts to require explicit `brain_tool_request` JSON envelopes.
- Improved missing Credential Vault guidance for new local habitats.
- Improved probabilistic invocation diagnostics when credentials are missing.
- Replaced key-shaped documentation examples with non-secret placeholders.

### Security

- Secret Values remain Vault-resolved runtime data and must not be persisted in source, tests, generated templates, or runtime evidence.
- Runtime evidence Secret Value scan passed before Alpha staging.
- Public/package surface key-shape scan passed before Alpha staging.
- Generated habitat `.gitignore` and `.dockerignore` exclude credentials, encrypted Vault files, runtime state, memory artifacts, temporary files, and `node_modules`.

### Known Limitations

- This is an Alpha release, not a production-ready release.
- Probabilistic behavior depends on provider availability, quota, latency, and model behavior.
- Docker files are included, but local Docker execution still requires final daemon-backed smoke evidence.
- Cross-platform certification is in progress and must continue across Windows, Linux, and macOS.
- Alfred and Bruce are useful Alpha stewards, but their natural-language answers may still require grounding review against runtime evidence.
- The terminal CLI is the Alpha administration and diagnostic surface; chat, web, desktop, and messaging surfaces are future work.
