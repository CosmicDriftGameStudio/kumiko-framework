---
"@cosmicdrift/kumiko-framework": patch
---

`RequestHelper.queryOk` now asserts the response is a success (mirroring `writeOk`) instead of returning `body.data` unconditionally — a server error previously surfaced as `undefined` at whatever the caller did with it next, instead of naming the error code. Adds a `queryErr` counterpart (mirroring `writeErr`) so tests can assert on expected query failures without dropping to `query` and hand-parsing.
