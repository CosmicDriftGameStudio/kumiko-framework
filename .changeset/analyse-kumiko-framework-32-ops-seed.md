---
"@cosmicdrift/kumiko-cli": patch
---

`kumiko ops seed:new` and `kumiko ops seed:status` are part of the app CLI.

<!-- kumiko-changes
feature: cli
type: improvement
title: kumiko ops seed:new and seed:status ship with the app CLI
detail: `kumiko ops seed:new <slug> [--seeds-dir <path>]` scaffolds seeds/<date>-<slug>.ts, and `kumiko ops seed:status [--seeds-dir <path>]` lists applied and pending seed migrations from kumiko_es_operations without creating the table. Before, these commands existed only in the framework repository's own CLI, under the same name `kumiko ops` that the app CLI uses for backfill-pii and waitlist-migrate. Pending seeds are applied on app boot as before; there is no `seed:apply`.
-->
