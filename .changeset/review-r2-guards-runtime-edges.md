---
"@cosmicdrift/kumiko-framework": patch
---

Guards: the runtime-isolation guard now follows value re-exports (`export * from`, `export { x } from`) and reads the `kumiko.runtime` marker in the repo-root `package.json`. The upgrade-state guard prefers the repo-local `node_modules/.bin/kumiko-upgrade` over a PATH entry. The error-reasons guard no longer flags prose reasons passed to `withUnsafeRawGrant`. Remaining German guard messages are now English. Blank `entityName` overrides on extension sections fall back to the host entity. `EventDispatcher.drain()` now also waits for a pass still in its idle pre-check.

<!-- kumiko-changes
feature: framework
type: fix
title: Guard edge cases, extension entityName fallback and dispatcher drain waiting for in-flight passes
-->
