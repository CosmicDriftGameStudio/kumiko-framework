---
"@cosmicdrift/kumiko-bundled-features": patch
---

secrets:write:delete removes rows under keys that are no longer declared

<!-- kumiko-changes
feature: secrets
type: fix
title: secrets delete no longer requires a declared key
detail: secrets:write:delete used to answer 404 unknownKey for a key that no feature declares, so a row stored before the declaration gate existed could never be removed. Delete now skips the declaration check; writeRoles of a declared key or namespace still apply, and set keeps the gate.
-->
