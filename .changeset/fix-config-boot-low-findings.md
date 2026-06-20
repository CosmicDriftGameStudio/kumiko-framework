---
"@cosmicdrift/kumiko-framework": patch
---

Config-schema / boot hardening (review findings):

- **role-leak (#406/2):** `scopedKeysAt` now strips `MACHINE_WRITE_ROLE` ("system") from the roles it returns, so a config key with a mixed write-set (e.g. `["system", "SystemAdmin"]`) yields a `{ roles: ["SystemAdmin"] }` screen gate instead of leaking the machine role into the human access union.
- **silent-skip (#408/3):** an app workspace that references an audience nav-QN which is never generated (e.g. `config:nav:audience-user` with no user-scope config keys registered) now emits a dev-only authoring warning instead of rendering invisibly with no hint.
- **env-guard (#408/1):** the Settings-Hub authoring warnings are now also suppressed under `NODE_ENV=test` (not only production), so `bun:test` runs no longer spew `console.warn` noise into CI logs.
