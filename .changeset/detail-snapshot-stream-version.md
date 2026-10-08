---
"@cosmicdrift/kumiko-framework": patch
---

`detail()` reads the row and the stream version in one statement and validates entity-cache hits against the stream version

Before, a concurrent update between the row read and the version read handed out the old row with the new version, so `update({ version: detail.version })` passed the optimistic lock and overwrote the newer write. A cached row whose version differs from the stream version now counts as a cache miss.

<!-- kumiko-changes
feature: framework
type: fix
title: detail() no longer pairs an old row with a newer stream version, so update({ version: detail.version }) cannot overwrite a concurrent write
-->
