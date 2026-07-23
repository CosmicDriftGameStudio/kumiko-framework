---
"@cosmicdrift/kumiko-framework": patch
---

`UserDataDeleteHook` return type is additive: `void | { status: "ok" } | { status: "incomplete", reason }`, so hooks can report that a delete request finished without fully anonymizing identifiable data (e.g. single-user tenants where severing `ownerUserId` is cosmetic).
