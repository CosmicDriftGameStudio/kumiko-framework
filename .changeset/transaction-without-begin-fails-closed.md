---
"@cosmicdrift/kumiko-framework": patch
---

transaction() on a transaction handle throws a clear InternalError

<!-- kumiko-changes
feature: framework
type: fix
title: Calling transaction() on a tx or savepoint handle fails with an InternalError
detail: `RawClient.begin` is now typed optional, and `transaction()` checks it like `runInNewTransaction` does, so a nested call raises an InternalError ("runner has no begin()") instead of a TypeError. The migrate runner requires `begin` on its client and rejects handles without it before running any SQL.
-->
