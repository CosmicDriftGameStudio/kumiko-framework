---
"@cosmicdrift/kumiko-framework": patch
---

The schema-drift and row-level-security boot errors now name the command an app actually has, `bun kumiko-schema apply|generate|status`, instead of `kumiko schema …`, which only the standalone production bundle understands.

<!-- kumiko-changes
feature: framework
type: fix
title: Boot errors name the real schema command
detail: The drift report and the row-level-security boot check recommended `kumiko schema apply` and `kumiko schema generate`. Apps run the CLI as `bun kumiko-schema <subcommand>`, so the hints now say that.
-->
