---
"@cosmicdrift/kumiko-dev-server": patch
"@cosmicdrift/kumiko-cli": patch
---

Scaffold and typecheck use `bun check` (requires Bun 1.4.4 or newer).

<!-- kumiko-changes
feature: dev-server
type: fix
title: Scaffolded apps typecheck with bun check
detail: The typecheck script of newly scaffolded apps and of the framework workspace now runs `bun check --no-script` instead of `tsc --noEmit`, which needs Bun 1.4.4 or newer. Existing apps keep their script until they change it.
-->
