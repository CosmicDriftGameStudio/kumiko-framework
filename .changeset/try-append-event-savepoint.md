---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": patch
---

`@cosmicdrift/kumiko-framework/engine` bekommt `ctx.tryAppendEvent` — ein
savepoint-scoped Gegenstück zu `ctx.unsafeAppendEvent`, das
`VersionConflictError` als `{ ok: false, conflict }` zurückgibt statt zu
werfen, ohne die restliche Handler-Transaktion zu poisonen (Bun.SQL/
postgres.js brechen den gesamten `begin()` bei einem ungefangenen Statement-
Fehler ab, SQLSTATE 25P02, selbst wenn der JS-Error gefangen wird —
`tryAppendEvent` läuft dafür in einem echten `SAVEPOINT`).

`@cosmicdrift/kumiko-bundled-features/inbound-mail-foundation`: der
`ingest-message`-Handler nutzt `ctx.tryAppendEvent` für den Message-Append —
zwei parallele Ingest-Aufrufe für dieselbe `providerMessageId` (Watch-Push
vs. Poll-Reconciliation-Überschneidung) liefern jetzt beide `{ duplicate:
true }` statt dass der Verlierer mit einem harten `VersionConflictError`
scheitert (#1038, Finding aus PR-Review #952).
