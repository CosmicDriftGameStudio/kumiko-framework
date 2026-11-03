---
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-renderer": patch
---

Review round 3 for bundled-features leftovers: batched membership and presence lookups, safer presence expiry, tier preload ordering, visible membership projection drift, search docs restored after a failed stream-tenant move, a convergence guard in tenant destruction, and a capped document link list.

<!-- kumiko-changes
feature: bundled-features
type: fix
title: Misc bundled-features review fixes
detail: auth-email-password checks for foreign members with one limited query; presence list resolves display names and parent visibility in batches (PresenceStore gains listMany) and drops expired fields only if unchanged since read (Lua compare-and-delete); the tier-engine preload no longer overwrites a newer cache entry; seedTenantMembership reports rowMissing when the membership projection row did not materialize and callers log it; the stream-tenant backfill reindexes the old search bucket when a candidate fails after its docs were removed (createSearchBucketCleanup takes a row source and exposes onMoveFailed); tenant destruction anonymize stops when a pass makes no progress; retention anonymize compares decrypted PII values and is covered by a test; template-resolver reads collection entries via decryptStoredPii; documents linkedDocumentIds throws too-many-linked-documents above 10000 links; the renderer Banner keeps unique keys for repeated identical parts.
-->
