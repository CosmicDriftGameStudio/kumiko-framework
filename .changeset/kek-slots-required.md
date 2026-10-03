---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-dev-server": minor
---

Key Manager slots are required: no more LEGACY_SLOTS default

`resolvePlatformKeks`, `resolveKmsWiringAsync` and `requireKmsWiringAsync` no longer fall back to the three platform slots; `slots` is a required option. `runSchemaCli` called with `features` now requires `kmsSlots` and exits 1 with a hint before any DB connect or migration apply when it is missing. `kmsSlots: []` stays valid for apps that wire no Key Manager slots. The scaffolded `bin/kumiko.ts` passes `kmsSlots` derived from the composed env schema.

<!-- kumiko-changes
feature: framework
type: breaking
title: Key Manager slots are required, LEGACY_SLOTS default removed
migration: |
  Pass `slots` (for example `kmsSlotsOf(<app>ComposedEnv.schema)`) to `resolvePlatformKeks`, `resolveKmsWiringAsync` and `requireKmsWiringAsync`. In `bin/kumiko.ts`, `runSchemaCli(..., { features })` needs `kmsSlots: kmsSlotsOf(<app>ComposedEnv.schema)` (or `[]` when the app wires no Key Manager slots. With `[]` every `*_CIPHERTEXT` env var is ignored, so an app that ships a ciphertext must pass its slots); without it the CLI exits 1 before applying migrations.
  Workspace state at release: show-pony `bin/kumiko.ts` and its docs copy `kumiko-platform/apps/docs/_samples/show-pony/bin/kumiko.ts` still call `runSchemaCli` with `features` only. publicstatus, solon, offlot-app, money-horse, phronexsis and kumiko-studio already pass `kmsSlots` / `slots`.
-->
