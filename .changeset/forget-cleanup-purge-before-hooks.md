---
"@cosmicdrift/kumiko-bundled-features": patch
---

`runForgetCleanup`'s search-document purge now runs before the `EXT_USER_DATA` delete hooks, not after, and no longer requires a configured KMS. Previously, a hook with `UserDataDeleteStrategy: "delete"` could hard-delete a row before the purge's discovery `SELECT` ran, permanently stranding that row's plaintext PII in the search index — the purge now sees every candidate row before any hook has a chance to remove it.
