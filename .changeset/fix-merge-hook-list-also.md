---
"@cosmicdrift/kumiko-framework": patch
---

`mergeHookList` (the entity-hook variant) also tolerates undefined slots — same fix as `mergeHookListQualified` in 0.11.2 but for the second function. defineFeature leaves `entityHooks.postSave`/`preDelete`/`postDelete`/`postQuery` undefined when not declared; `createRegistry` crashed on `Object.entries(undefined)`.
