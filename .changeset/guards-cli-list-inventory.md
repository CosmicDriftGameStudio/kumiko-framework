---
"@cosmicdrift/kumiko-guards": minor
---

New `kumiko-guards list` subcommand prints the registration inventory (which guards/checks are registered, under which names, in which suite) as JSON, without scanning or running anything. The public package has one bin with `guards|ui|checks` subcommands instead of a bin per guard, so a consumer's CI can no longer check "does this binary exist" per guard — `list` is what it checks against instead, e.g. `bunx kumiko-guards list | jq '.suites.guards.count'`.

<!-- kumiko-changes
feature: guards
type: improvement
title: kumiko-guards list prints the registration inventory as JSON
-->
