---
"@cosmicdrift/kumiko-server-runtime": patch
---

The read-only demo gate now also covers WebSocket upgrades. Before, a visitor could log in with the published demo credentials, open a socket on a feature's `r.webSocketRoute` and write through the route's `write` dependency, because the gate only looked at the HTTP method and an upgrade is a GET. With `demoMode.readOnly` set, `webSocketUpgradeFetch` and the fetch handler answer an upgrade with 403 `demo_read_only`. A socket route that must stay available in the demo is listed in `allowedWritePaths`.

<!-- kumiko-changes
feature: server-runtime
type: fix
title: Read-only demo mode blocks WebSocket upgrades
detail: Upgrade requests count as mutating in the demo read-only gate and get 403 demo_read_only unless the route path is in allowedWritePaths. Socket routes in a read-only demo that need to stay open must be listed there.
-->
