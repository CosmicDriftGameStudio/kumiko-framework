---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-server-runtime": patch
"@cosmicdrift/kumiko-dev-server": patch
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-renderer-web": patch
"@cosmicdrift/kumiko-headless": patch
"@cosmicdrift/kumiko-dispatcher-live": patch
---

Published `.d.ts` resolve without extra setup; READMEs ship; renderer-web is a declared dependency

The emitted declarations that mention `Temporal` or `Bun` now carry a preserved `/// <reference types>` for `temporal-polyfill/global` and `bun-types`, so a consumer without `bun-types` in its tsconfig no longer gets unresolved `Temporal`/`Bun` errors from our declarations. `kumiko-server-runtime` and `kumiko-dev-server` declare `@cosmicdrift/kumiko-renderer-web` as a dependency (they resolve its `styles.css`; it was already installed through bundled-features) and `bun-types` as a dependency. `bundled-features`, `server-runtime`, `dev-server`, `dispatcher-live`, `headless`, `renderer`, `renderer-web` and `cli` ship the README.md their `files` list already named. `bun run check:dist` now typechecks the packed install, checks README shipping, runtime-resolved package declarations and the `styles.css` resolve.

<!-- kumiko-changes
feature: server-runtime
type: fix
title: server-runtime and dev-server declare their renderer-web dependency and their .d.ts resolve Bun and Temporal types without consumer setup
-->
