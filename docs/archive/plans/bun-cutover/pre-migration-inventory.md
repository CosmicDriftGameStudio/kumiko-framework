---
status: reference
verified: 2026-06-07
evidence: git: 462a33da 'phase-1.5: node-api-sweep + native-module-inventar' — reines Inventar-Snapshot, kein Plan, kein Aktionspunkt
---

# Pre-Migration Inventory (2026-05-24)

## Node-API Usage

| API | Treffer | Status |
|---|---|---|
| `node:vm` | 0 | ✅ kein Risiko |
| `node:cluster` | 0 | ✅ kein Risiko |
| `node:inspector` | 0 | ✅ kein Risiko |
| `node:async_hooks` (`AsyncLocalStorage`) | 5 Dateien | ✅ getestet unter Bun |

## Native Modules (prebuilt/NAPI)

| Modul | Typ | Dependency von | Status |
|---|---|---|---|
| `@node-rs/argon2` | Rust-NAPI | direkt (bundled-features) | ✅ getestet |
| `msgpackr-extract` | prebuilt | transitiv via msgpackr | ✅ getestet |
| `pino` + `thread-stream` | JS + native thread | direkt (framework) | ✅ getestet |
| `ioredis` | JS | direkt (framework) | ✅ getestet |
| `@parcel/watcher` | native | direkt (framework) | wird gebaut |

## dependenciesMeta / trustedDependencies

- Aktuell: **kein** `dependenciesMeta` in package.json
- `trustedDependencies` muss nach Bun-Migration in root package.json: `["@node-rs/argon2", "@parcel/watcher", "msgpackr-extract"]`

## Shebangs

- `#!/usr/bin/env node` in eigenen Files: **0** (keine eigenen Tools mit node shebang)
- Alle eigenen Einträge in bin/ nutzen yarn oder werden via package.json scripts gecalled

## CI / Docker

- CI: `setup-node` + `yarn` — muss auf `oven-sh/setup-bun` + `bun`
- Dockerfiles: keine gefunden im framework-repo (docker/ Folder prüfen)
- `.github/workflows/`: muss aktualisiert werden
