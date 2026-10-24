---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-dev-server": patch
"@cosmicdrift/kumiko-cli": patch
"@cosmicdrift/kumiko-feature-ast": patch
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-guards": patch
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-server-runtime": patch
"@cosmicdrift/kumiko-testing": patch
"@cosmicdrift/kumiko-types": patch
---

`schema apply` in the production image heals the framework tables in the runtime's row-level security mode, plus follow-ups from the 0.390 bump: rebuild timestamp drift, scoped live check in `kumiko check`, codemod and upgrade fixes, zod and mailparser security ranges.

<!-- kumiko-changes
feature: framework
type: fix
title: schema apply in the production image uses the runtime's row-level security mode
detail: The app image ships only kumiko/migrations, not kumiko/schema.ts. Without the schema file `schema apply` ran with row-level security "off", so kumiko_events, kumiko_snapshots and kumiko_archived_streams were not healed and the boot of an app in "on" mode (the default) failed with "framework tables without it". Without a schema file apply now uses the same default as runProdApp. RunSchemaCliOptions takes an optional rowLevelSecurity, which wins over the schema file; the scaffolded bin/kumiko.ts passes appConfig.rowLevelSecurity, like bin/main.ts does for runProdApp. Apps that do not set rowLevelSecurity need no change.
-->

<!-- kumiko-changes
feature: framework
type: fix
title: Projection rebuilds no longer report drift on timestamptz columns
detail: Event payloads keep the microseconds of an instant, the live write stores milliseconds. A rebuild bound the payload's ISO string unchanged and wrote a different value, which the shadow diff reported as column drift. ISO instant strings bound to a timestamptz column are now truncated to milliseconds like Temporal.Instant values.
-->

<!-- kumiko-changes
feature: framework
type: improvement
title: The live row-level security check of `kumiko check` covers only the app's own tables
detail: `schema validate` (the boot step of `kumiko check`) checks the live database when DATABASE_URL is set. On a dev database several apps share it failed on the other apps' tables. It now checks the tables kumiko/schema.ts declares plus the framework tables; tables no feature declares any more are still reported by the boot check, which runs against the app's own database. An unreachable database still fails the check.
-->

<!-- kumiko-changes
feature: framework
type: fix
title: kumiko-upgrade runs the codemods of its own feature-ast install
detail: The kumiko-upgrade bins of kumiko-cli and kumiko-dev-server now look for the codemod scripts from their own package first, so a feature-ast copy hoisted above the app (for example in a workspace parent) can no longer supply codemods of another version. runUpgradeCli takes an optional codemodResolveFrom for that; without it the search still starts at the repo root.
-->

<!-- kumiko-changes
feature: feature-ast
type: fix
title: Codemods skip gitignored files, ctx-namespaces finds structural helpers across files
detail: collectSourceFiles, used by the codemods, leaves out files the repository's .gitignore excludes, such as generated output and local worktrees. The ctx-namespaces codemod loads all files of a tsconfig project before rewriting, so a helper with a structural `{ query }` context type is migrated even when its handler caller sits in a file processed later.
-->

<!-- kumiko-changes
feature: inbound-provider-imap
type: fix
title: mailparser and zod moved to versions without known advisories
detail: mailparser moves to ^3.12.4, which pins nodemailer 10.2.1, so apps no longer get nodemailer 10.0.13 through it. The zod range of all packages moves to ^4.6.7 (GHSA-MRHX-C7XC-M3W5).
-->
