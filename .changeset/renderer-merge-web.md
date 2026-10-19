---
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-renderer-web": patch
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-guards": minor
"@cosmicdrift/kumiko-dev-server": patch
"@cosmicdrift/kumiko-server-runtime": patch
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-document-designer": patch
"@cosmicdrift/kumiko-testing": patch
"@cosmicdrift/kumiko-cli": patch
"@cosmicdrift/kumiko-types": patch
---

kumiko-renderer-web moves into kumiko-renderer as `@cosmicdrift/kumiko-renderer/web` (with `/web/styles.css` and `/web/theme-plugin`). The old package stays as a deprecated re-export shim until the consumer pass of wave 4. The `package-merge` codemod rewrites imports, package.json dependencies and, new, CSS `@import`/`@plugin`/`@config` specifiers.

<!-- kumiko-changes
feature: renderer
type: improvement
title: renderer-web moved into renderer
detail: The web bindings are exported from @cosmicdrift/kumiko-renderer/web, the stylesheet from @cosmicdrift/kumiko-renderer/web/styles.css and the Tailwind theme plugin from @cosmicdrift/kumiko-renderer/web/theme-plugin. @cosmicdrift/kumiko-renderer-web now only re-exports these and is removed after the consumer pass of wave 4.
migration: Run bun kumiko-upgrade --apply, or bun kumiko codemod package-merge . --write. It rewrites imports and CSS @import lines of @cosmicdrift/kumiko-renderer-web (including /styles.css and /theme-plugin) to @cosmicdrift/kumiko-renderer/web and replaces the dependency in package.json with kumiko-renderer.
codemod: scripts/codemod/package-merge.ts
-->

<!-- kumiko-changes
feature: framework
type: improvement
title: package-merge codemod covers renderer-web and CSS files
detail: The mapping table of the package-merge codemod gained the renderer-web move into kumiko-renderer/web, and the codemod now also rewrites .css files (@import, @plugin, @config). A @source path into the old package is reported for manual follow-up.
codemod: scripts/codemod/package-merge.ts
-->

<!-- kumiko-changes
feature: renderer-web
type: improvement
title: kumiko-renderer-web is a deprecated shim over kumiko-renderer/web
detail: The package only re-exports @cosmicdrift/kumiko-renderer/web and its theme-plugin, and its styles.css imports the new stylesheet. It is removed after the consumer pass of wave 4.
migration: Import from @cosmicdrift/kumiko-renderer/web, or run bun kumiko codemod package-merge . --write.
-->

<!-- kumiko-changes
feature: guards
type: improvement
title: renderer-boundaries guard leaves the web subtree unscanned
detail: renderer/src/web may use the DOM and every web dependency; the shared renderer root and headless/live must not import it. The tailwind-scan-surface guard follows the new stylesheet location through package exports and shim imports.
-->

<!-- kumiko-changes
feature: guards
type: improvement
title: comment-lang touched mode pairs renames
detail: The touched mode diffs a moved file against its old path, so moving a file no longer counts every German comment in it as new.
-->

<!-- kumiko-changes
feature: cli
type: fix
title: project rebuild keeps blind indexes and aborts without crypto, events prune names its aggregate types
detail: `kumiko project rebuild` now wires the subject KMS and blind-index key from the env like `schema apply` and `ops backfill-pii`, so rebuilding a PII projection no longer nulls its bidx columns. Without the crypto env an app with PII fields aborts the rebuild unless `--allow-plaintext-pii <reason>` is passed. `kumiko events prune` takes the required `--aggregate-types <a,b>` flag; before, it always failed because pruneEvents needs explicit aggregate types.
-->
