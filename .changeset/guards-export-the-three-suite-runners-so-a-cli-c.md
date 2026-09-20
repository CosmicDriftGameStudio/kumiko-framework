---
"@cosmicdrift/kumiko-guards": minor
---

Export the three suite runners so a CLI can compose them in-process

runGuardsCli, runUiGuardsCli and runRepoChecksCli (plus their flag lists and cliFlagsError) were only reachable from their own runner modules, so a caller had to spawn three subprocesses — each building its own ts-morph project. They are part of the package entry point now, which lets `kumiko check` run all three over one shared project in a single process.

<!-- kumiko-changes
feature: guards
type: improvement
title: Export the three suite runners so a CLI can compose them in-process
-->
