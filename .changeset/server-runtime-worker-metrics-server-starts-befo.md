---
"@cosmicdrift/kumiko-server-runtime": patch
---

Worker metrics server starts before entrypoint.start() and is closed if boot fails

<!-- kumiko-changes
feature: server-runtime
type: fix
title: Worker metrics server starts before entrypoint.start() and is closed if boot fails
-->
