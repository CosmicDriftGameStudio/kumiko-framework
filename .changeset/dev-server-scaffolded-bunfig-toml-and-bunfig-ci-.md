---
"@cosmicdrift/kumiko-dev-server": patch
---

Scaffolded bunfig.toml and bunfig.ci.toml no longer contain the inert [test] concurrency key

bun has no [test] concurrency key and ignores it silently; the scaffold wrote concurrency = 8, which made kumiko-testing bunfig refuse the merge on a freshly scaffolded app. Existing apps can delete the line from their bunfig files; nothing changes at runtime.

<!-- kumiko-changes
feature: dev-server
type: fix
title: Scaffolded bunfig.toml and bunfig.ci.toml no longer contain the inert [test] concurrency key
-->
