---
"@cosmicdrift/kumiko-bundled-features": patch
---

`ctx.config()` reads a key with one preload instead of up to three sequential row lookups.

<!-- kumiko-changes
feature: config
type: improvement
title: Config reads load all cascade rows at once
detail: `getWithSource` (and with it `get` / `ctx.config()`) and `getCascade` now load the user, tenant and system rows of a key with the same `selectConfigRowsForKeys` preload `getCascadeBatch` already used, instead of one `fetchOne` per cascade rung. The cascade order, the source tags and the short-circuit stay the same: only the winning row is decrypted, and `computed` runs only when no row and no app override exists. The scope switch and the fallback ladder now exist once in the resolver.
-->
