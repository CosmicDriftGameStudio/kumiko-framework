---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-types": patch
---

Fix `preSave` hooks being a silent no-op (#1672). `r.hook("preSave", ...)` was registered and boot-validated, but no dispatch path ever ran it — only `postSave`/`preDelete`/`postSaveBatch` were wired.

`preSave` now runs for entity CRUD `create`/`update` handlers (`r.crud(...)`, `defineEntityCreateHandler`/`defineEntityUpdateHandler`), transforming `changes` before persistence and before ownership checks (authorization evaluates the final, hook-shaped row). Register per verb — there is no `{ allOf }` shorthand for `preSave` since create/update are separate handlers:

```ts
r.hook("preSave", "contact:create", deriveDisplayName);
r.hook("preSave", "contact:update", deriveDisplayName);
```

Scope: only entity CRUD handlers that go through the event-store executor get this automatically. A fully custom `r.writeHandler` that doesn't call the executor must invoke `ctx.runPreSave(...)` itself.
