---
"@cosmicdrift/kumiko-dev-server": patch
---

`kumiko-build` writes the `dist-server` lockfile without network access. The app `bun.lock` is rewritten to the `dist-server` root dependencies (its `overrides` stay and are mirrored into `dist-server/package.json`) before `bun install --lockfile-only`, so bun resolves every locked package from the lock instead of registry manifests; build pods without internet no longer hang there. `postgres` and `pino-pretty` are no longer unconditional runtime dependencies: they land in `dist-server/package.json` only when a bundled file imports them or the app declares them.

<!-- kumiko-changes
feature: dev-server
type: fix
title: kumiko-build writes the server lockfile without network
detail: The dist-server lockfile is derived from the app lock alone, so builds in environments without internet access no longer hang on registry lookups. Packages missing from the app lock still resolve through the registry.
migration: Apps that run with LOG_FORMAT=pretty in production must declare pino-pretty as a dependency; dist-server no longer installs it by default.
-->
