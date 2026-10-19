---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-guards": minor
"@cosmicdrift/kumiko-http": patch
"@cosmicdrift/kumiko-repo-manifest": patch
"@cosmicdrift/kumiko-cli": patch
"@cosmicdrift/kumiko-dev-server": patch
"@cosmicdrift/kumiko-testing": patch
---

kumiko-http moves into kumiko-framework and kumiko-repo-manifest into kumiko-guards. The old packages stay as deprecated re-export shims until the consumer pass of wave 4. The new `package-merge` codemod rewrites imports and package.json dependencies.

<!-- kumiko-changes
feature: framework
type: improvement
title: http moved into framework
detail: egress(), the host policy helpers and their errors are implemented in @cosmicdrift/kumiko-framework/http. @cosmicdrift/kumiko-http now only re-exports that subpath and is removed after the consumer pass of wave 4.
migration: Run bun kumiko-upgrade --apply, or bun kumiko codemod package-merge . --write. It rewrites imports of @cosmicdrift/kumiko-http to @cosmicdrift/kumiko-framework/http and replaces the kumiko-http dependency in package.json with kumiko-framework.
codemod: scripts/codemod/package-merge.ts
-->

<!-- kumiko-changes
feature: guards
type: improvement
title: repo-manifest moved into guards
detail: The kumiko.json schema and loader are exported from @cosmicdrift/kumiko-guards/repo-manifest, the app port reader from @cosmicdrift/kumiko-guards/repo-manifest/app-ports. @cosmicdrift/kumiko-repo-manifest now only re-exports them and is removed after the consumer pass of wave 4. @cosmicdrift/kumiko-framework is an optional peer for the app-ports subpath.
migration: Run bun kumiko-upgrade --apply, or bun kumiko codemod package-merge . --write. It rewrites imports of @cosmicdrift/kumiko-repo-manifest (and its /app-ports subpath) to @cosmicdrift/kumiko-guards/repo-manifest and replaces the dependency in package.json with kumiko-guards.
codemod: scripts/codemod/package-merge.ts
-->

<!-- kumiko-changes
feature: http
type: improvement
title: kumiko-http is a deprecated shim over kumiko-framework/http
detail: The package only re-exports @cosmicdrift/kumiko-framework/http and is removed after the consumer pass of wave 4.
migration: Import from @cosmicdrift/kumiko-framework/http, or run bun kumiko codemod package-merge . --write.
-->

<!-- kumiko-changes
feature: repo-manifest
type: improvement
title: kumiko-repo-manifest is a deprecated shim over kumiko-guards/repo-manifest
detail: The package only re-exports @cosmicdrift/kumiko-guards/repo-manifest and its app-ports subpath and is removed after the consumer pass of wave 4.
migration: Import from @cosmicdrift/kumiko-guards/repo-manifest, or run bun kumiko codemod package-merge . --write.
-->

<!-- kumiko-changes
feature: cli
type: improvement
title: kumiko codemod lists package-merge
detail: kumiko codemod package-merge rewrites imports and package.json dependencies of merged packages.
-->
