---
"@cosmicdrift/kumiko-bundled-features": minor
---

row-bound grants: one short-lived, single-use capability for anonymous writes on one row

`signed-token.ts` moves from `auth-email-password/` to `shared/` — the mechanism
was never email/password specific (user-data-rights already used it). The old
path re-exports it, so no importer breaks. New subpaths:
`./shared/signed-token` and `./shared/row-bound-grant`.

`shared/row-bound-grant.ts` is the new piece. It folds the row's *current*
anchor (a request id, a status, a version — anything that moves on when the row
is consumed) into the HMAC purpose on both mint and redeem, so a replayed token
stops working the moment the row moves on. Single-use semantics without a burn
key and without Redis. Minting and redeeming share one purpose-building
function, because an unanchored purpose silently degrades into a bearer token
valid for the whole TTL.

Every rejection returns a bare `{ ok: false }` with no reason, so a caller
cannot accidentally turn an anonymous endpoint into a row-existence oracle.

`user-data-rights`' deletion token now runs on the helper and its hand-rolled
`peekDeletionTokenUserId` is gone. The tokens stay byte-compatible — a test
pins the wire format against the pre-refactor formula.

Note for callers: the subject is not secret. `signToken` puts it in the token
body in the clear, so a grant on a row exposes that row's id to whoever holds
the link. Where the id itself must stay hidden, use an opaque handle
(`./shared/single-use-token-store`) instead.

<!-- kumiko-changes
feature: shared
type: improvement
title: row-bound grants: one short-lived, single-use capability for anonymous writes on one row
-->
