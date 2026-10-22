---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-types": patch
---

Bumps the pinned postgres.js fork to 3.4.9-kumiko.2. A connection that dies while a query is still buffered now reconnects right away instead of hanging until `connect_timeout`.

<!-- kumiko-changes
feature: framework
type: fix
title: Reconnect after an outage no longer waits out connect_timeout
detail: The postgres.js fork left the write buffer of a dead socket in place, so the first query after a database outage queued its startup message behind stale bytes and failed with CONNECT_TIMEOUT after 30 seconds. The fork now resets the buffer when the socket closes, and the next query opens a fresh connection immediately.
-->
