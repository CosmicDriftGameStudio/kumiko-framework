---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

`projectionDetail` screens gain an optional `singleton: boolean` flag (`ProjectionDetailScreenDefinition`) for a self-service screen bound to a query that determines its row from the caller's session/context instead of a row id in the path (e.g. `user:query:user:me`). Without the flag, `ProjectionDetailBody` always rejected a missing path id with an error banner — the only path a singleton screen has — so `user-profile`'s `profile` screen and `user-data-rights`' `privacy-center` screen, both converted to `projectionDetail` bound to `me`-style queries, rendered nothing but that banner. Both now set `singleton: true` and render.

Under `singleton`, the query is called without the `idParam` key (there is no id to send) and any path id — even a stray or spoofed one — is ignored rather than forwarded into the query or into extension sections' entity-id resolution: a singleton row is server-picked, so no client-supplied id can reach it. The boot-validator rejects declaring `idParam` or `detailFor` together with `singleton` (both are meaningless/unsound once the server owns row selection — `detailFor`'s auto-generated "Edit" action navigates via the path id, which a singleton screen never has) instead of letting one silently win.
