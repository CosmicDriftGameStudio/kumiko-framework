---
"@cosmicdrift/kumiko-framework": patch
---

Fix `r.screen({ nav: {...} })` writing `icon`/`parent`/`order` as explicit `undefined` when a screen omits those optional nav fields, which made `buildAppSchema` warn "Output ist nicht JSON-safe" on every boot outside production even though `JSON.stringify` already dropped the key and no consumer was affected.
