---
"@cosmicdrift/kumiko-bundled-features": patch
---

Secret writes roll back with a failing batch

<!-- kumiko-changes
feature: secrets
type: fix
title: secrets:write:set and secrets:write:delete join the request transaction
detail: Both handlers ran on the boot database connection, so in an /api/batch a later failing command rolled back the config writes but kept the stored secret. They now run on the request transaction (escape hatch unsafeRaw, reason documented on the handler), so a batch of config and secret writes is stored as a whole or not at all.
-->
