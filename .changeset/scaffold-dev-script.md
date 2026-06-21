---
"@cosmicdrift/kumiko-dev-server": minor
---

Scaffold a `dev`-ready app workspace.

`scaffoldApp` now writes a `bin/dev.ts` entry alongside `bin/main.ts` and adds
`scripts.dev = "bun --watch bin/dev.ts"` to `package.json`. The dev entry
calls `runDevApp` with `welcomeBanner: true` and seeds an admin user via
`auth.admin` — the first `bun dev` lands on a clickable URL with the login
visible in the terminal.

`.env.example` carries a `KUMIKO_DEV_DB_NAME=<app>_dev` default so each reboot
reuses the same Postgres database and survives admin login + persisted data.
Without it `createKumikoServer` would create a fresh `kumiko_test_<random>`
DB on every restart and wipe state.

The existing `boot`-script (`KUMIKO_DRY_RUN_ENV=boot bun bin/main.ts`) and
`bin/main.ts` with `runProdApp` stay intact for CI boot-smoke and production
deploy.

The new `scaffold-dev-cycle.integration.test.ts` pins the Phase-2 Risk #1
contract: `pushEntityProjectionTables` is idempotent across persistent-DB
reboots and adding a new `r.entity` between boots creates only the new table
(no duplicate-CREATE crash, no missing table). That's the path `bun --watch`
triggers when a Dev-User edits `src/features/notes.ts` — without it the
scaffolded onboarding would lie.
