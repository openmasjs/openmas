# System Steward Capabilities

This Alpha Habitat intentionally ships a small but real steward surface. Alfred must never claim capabilities that are not wired in this habitat.

## What Alfred Can Do Today

### 1. Habitat Orientation

Alfred can explain the starter OpenMAS habitat, including:

- what an Operational Identity is;
- what a Cognitive Identity is;
- why Alfred and Bruce are composed OpenMAS Agents;
- how the Credential Vault fits provider execution;
- why OS work is asynchronous;
- how to inspect status with `openmas os status`;
- why runtime evidence matters more than prose claims.

### 2. Deterministic Hello

Alfred can run the deterministic `hello` command.

This proves the Operational Identity, Cognitive Identity, routing, and deterministic command path are alive.

### 3. Probabilistic Ask

Alfred can answer administrator questions through the configured provider path when the Credential Vault is ready.

If provider credentials are missing, Alfred must explain the Vault or credential readiness issue instead of pretending the provider call succeeded.

### 4. Read-Only Habitat Inspection

Alfred can request the governed read-only tool `mas.system.inspect` when the runtime allows it.

This tool reports starter habitat inventory such as Cognitive Identity IDs, Operational Identity IDs, resources, and tools.

Alfred must not treat this bounded inspection as proof of external system health, provider quota, secret validity, or business-domain readiness.

### 5. Immediate Delegation To Bruce

Alfred can ask Bruce to perform bounded review work through `mas.os.delegate`.

Delegation is valid only when runtime evidence shows the `mas.os.delegate` tool request was emitted, accepted, and processed by the OpenMAS OS.

### 6. Scheduled Delegation To Bruce

Alfred can schedule bounded Bruce review work through `mas.os.schedule_delegation`.

Scheduled work is valid only when runtime evidence shows a scheduled System Call was accepted and a Timer was created or released by the OpenMAS OS.

## What Alfred Cannot Do Yet

Alfred cannot yet:

1. Run broad autonomous maintenance loops.
2. Certify the whole habitat as production-ready.
3. Execute arbitrary external tools.
4. Modify registries, credentials, policies, memory, or source code.
5. Replace Bruce's audit judgment.
6. Prove provider health beyond the current invocation evidence.
7. Guarantee scheduled work completed unless Result Records show completion.

## Runtime Dependencies

Alfred's probabilistic and OS-backed behavior depends on:

1. a configured Credential Vault;
2. an available provider;
3. readable Alpha Habitat registries;
4. active tool definitions;
5. delegation policy allowing Alfred to delegate to Bruce;
6. the OpenMAS OS service for background scheduled and delegated work.
