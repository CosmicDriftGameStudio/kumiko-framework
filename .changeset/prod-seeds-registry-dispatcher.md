---
"@cosmicdrift/kumiko-server-runtime": minor
---

Prod seeds receive the boot registry and a system dispatcher

`ProdSeedFn` deps grow from `{ db }` to `{ db, registry, dispatcher }`. Seeds should write through `dispatcher.write(...)` so projections and hooks run. The dispatcher is built once when `seeds` or `seedsDir` is set and is shared with the seed migrations.

<!-- kumiko-changes
feature: server-runtime
type: improvement
title: Prod seeds get registry and dispatcher
-->
