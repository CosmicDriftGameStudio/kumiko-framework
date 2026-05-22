---
"@cosmicdrift/kumiko-framework": patch
---

`mergeHookListQualified` tolerates undefined hook-slots.

`defineFeature` leaves `feature.hooks.preSave`/`postSave`/etc. undefined when no hooks of that type are declared. `createRegistry` called `Object.entries(undefined)` and crashed with `Object.entries requires that input parameter not be null or undefined`.

Now `mergeHookListQualified` short-circuits on undefined source. Surfaced in studio's production-bundle boot.
