---
"@cosmicdrift/kumiko-framework": patch
---

`resolveUnsafeClient` (db/schema-inspection.ts) returned `client.unsafe` without
checking it resolved, so a db handle that exposes the raw postgres escape hatch on
none of `$client` / `session.client` / itself crashed `tableExists` / `columnNamesOf`
with an opaque `TypeError: unsafe is not a function`. It now throws a named, actionable
error naming the three lookup paths it checked.
