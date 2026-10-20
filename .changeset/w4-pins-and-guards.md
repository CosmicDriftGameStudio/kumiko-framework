---
"@cosmicdrift/kumiko-dev-server": minor
"@cosmicdrift/kumiko-guards": minor
"@cosmicdrift/kumiko-cli": patch
---

`kumiko check` fails on non-exact Kumiko dependency pins and on a private app without `kumiko.deploy.infraRef`. The guards gain the subpath-exports and guards-doc-drift checks, and the direct-fetch guard honors `kumiko-lint-ignore direct-fetch` instead of `guard-allow`.

<!-- kumiko-changes
feature: dev-server
type: breaking
title: kumiko check managed rejects loose Kumiko pins and a missing infraRef
detail: In an app, all @cosmicdrift/kumiko-*, create-kumiko-app and @cosmicdriftgamestudio/kumiko-* dependencies must be exact versions (workspace specs are allowed) on one version per scope. A private app without kumiko.deploy.infraRef is an error instead of a warning. In @cosmicdrift/kumiko-dev-server, listManagedWarnings is now listManagedErrors and ManagedCheckResult.warnings is now errors.
migration: Pin the Kumiko dependencies without ^ or ~ and to one version per scope. Set kumiko.deploy.infraRef to an infra tag (reusables-vX.Y.Z) in package.json. Programmatic callers: rename listManagedWarnings to listManagedErrors and ManagedCheckResult.warnings to errors.
-->

<!-- kumiko-changes
feature: guards
type: improvement
title: direct-fetch guard uses kumiko-lint-ignore
detail: The guard-allow direct-fetch marker is no longer parsed. The guard now honors kumiko-lint-ignore direct-fetch with a specific reason, like the other guards.
migration: Replace guard-allow direct-fetch comments with kumiko-lint-ignore direct-fetch followed by the reason.
-->

<!-- kumiko-changes
feature: guards
type: improvement
title: Subpath-exports and guards-doc-drift checks
detail: The subpath-exports check fails when a published package ships src/<feature>/web.ts without the matching exports key. The guards-doc-drift check keeps docs/reference/guards.md in sync with the guard sources, and a registry test fails when a guard file is not registered.
-->
