---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

Fix GDPR erasure gap (#2461): thumbnails/resized variants (derivatives) written under a deterministic, untracked storage key survived user-forget and tenant-destroy even after the original was deleted, because the forget hook only ever deleted `storageKey` itself.

`FileStorageProvider` and `UserDataStorageProvider` gain a required `list(prefix)` method (implemented for the in-memory, local-filesystem, and S3 providers). The fileRef forget hook now lists each original's derivative prefix, filters candidates through a grammar-anchored check (same extension + `<name>-<16 hex>` suffix) so an unrelated same-prefix sibling is never touched, and deletes every match alongside the original.

**Breaking for custom `FileStorageProvider`/`UserDataStorageProvider` implementations**: add a `list(prefix): Promise<readonly string[]>` method (prefix-match over currently-stored keys, paginated internally). Also note the new required IAM permission for S3-compatible backends: forget/erasure now needs `s3:ListBucket` in addition to `s3:DeleteObject`, or forget runs will fail (loudly — the hook wraps the raw provider error with a hint) instead of silently leaving binaries behind.

Not covered by this fix: derivatives rendered before this ships are not retroactively cleaned up (no backfill/GC job — tracked as a follow-up), and the tenant-destroy path does not yet call this hook at all (no `EXT_TENANT_DATA` registration for `fileRef` — pre-existing gap, tracked separately).
