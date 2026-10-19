---
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-headless": patch
"@cosmicdrift/kumiko-dispatcher-live": patch
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-guards": minor
"@cosmicdrift/kumiko-cli": patch
"@cosmicdrift/kumiko-dev-server": patch
"@cosmicdrift/kumiko-server-runtime": patch
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-renderer-web": patch
"@cosmicdrift/kumiko-renderer-mail-html": patch
"@cosmicdrift/kumiko-document-designer": patch
"@cosmicdrift/kumiko-types": patch
---

kumiko-headless moves into kumiko-renderer as `@cosmicdrift/kumiko-renderer/headless` and kumiko-dispatcher-live as `@cosmicdrift/kumiko-renderer/live`. The old packages stay as deprecated re-export shims until the consumer pass of wave 4. The `package-merge` codemod rewrites imports and package.json dependencies for both moves.

<!-- kumiko-changes
feature: renderer
type: improvement
title: headless and the live dispatcher moved into renderer
detail: The headless UI logic is exported from @cosmicdrift/kumiko-renderer/headless (with /headless/apex, /headless/dispatcher and /headless/locale-routing), the HTTP dispatcher from @cosmicdrift/kumiko-renderer/live. @cosmicdrift/kumiko-headless and @cosmicdrift/kumiko-dispatcher-live now only re-export these subpaths and are removed after the consumer pass of wave 4.
migration: Run bun kumiko-upgrade --apply, or bun kumiko codemod package-merge . --write. It rewrites imports of @cosmicdrift/kumiko-headless (and its subpaths) to @cosmicdrift/kumiko-renderer/headless and imports of @cosmicdrift/kumiko-dispatcher-live to @cosmicdrift/kumiko-renderer/live, and replaces both dependencies in package.json with kumiko-renderer.
codemod: scripts/codemod/package-merge.ts
-->

<!-- kumiko-changes
feature: framework
type: improvement
title: package-merge codemod covers headless and dispatcher-live
detail: The mapping table of the package-merge codemod gained the headless and dispatcher-live moves into kumiko-renderer.
codemod: scripts/codemod/package-merge.ts
-->

<!-- kumiko-changes
feature: headless
type: improvement
title: kumiko-headless is a deprecated shim over kumiko-renderer/headless
detail: The package only re-exports @cosmicdrift/kumiko-renderer/headless and its subpaths and is removed after the consumer pass of wave 4.
migration: Import from @cosmicdrift/kumiko-renderer/headless, or run bun kumiko codemod package-merge . --write.
-->

<!-- kumiko-changes
feature: dispatcher-live
type: improvement
title: kumiko-dispatcher-live is a deprecated shim over kumiko-renderer/live
detail: The package only re-exports @cosmicdrift/kumiko-renderer/live and is removed after the consumer pass of wave 4.
migration: Import from @cosmicdrift/kumiko-renderer/live, or run bun kumiko codemod package-merge . --write.
-->

<!-- kumiko-changes
feature: guards
type: improvement
title: renderer-boundaries guard scans headless and live for imports only
detail: The headless and live subtrees of kumiko-renderer must not import react-dom, jsdom or renderer-web; the symbol and JSX rules of the shared layer no longer apply to them. The section-fields-raw scope follows the moved headless sources.
-->
