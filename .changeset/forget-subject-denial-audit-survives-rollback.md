---
"@cosmicdrift/kumiko-bundled-features": patch
---

`crypto-shredding:write:forget-subject` now appends its denial audit event (`crypto-shredding:event:forget-denied`) outside the handler's own transaction, so a rejected cross-tenant forget attempt no longer loses its evidence when the denial rolls the write back (fw#2592).

Consumer note: the `forget-denied` event's `aggregateId` is now a fresh stream id instead of the requesting actor's user id — it was never meant to be queried by that id, so this should not affect existing readers.
