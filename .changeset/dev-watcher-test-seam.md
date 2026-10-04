---
"@cosmicdrift/kumiko-dev-server": patch
---

Dev-server file watchers accept an injected event source

`watchAndRegenerate` takes `watchDirectory` and `createKumikoServer` takes `_watchDirectory`. Production behavior is unchanged (native `fs.watch`); the hot-reload and codegen-watch tests drive changes through the seam instead of macOS FSEvents, which starts asynchronously and drops early writes.

<!-- kumiko-changes
feature: dev-server
type: fix
title: Dev-server file watchers take an injectable event source so watcher tests no longer depend on FSEvents timing
-->
