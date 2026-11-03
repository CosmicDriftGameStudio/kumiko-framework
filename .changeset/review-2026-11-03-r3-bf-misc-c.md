---
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-renderer": patch
---

Review round 3 for bundled-features leftovers: batched membership and presence lookups, safer presence expiry, tier preload ordering, visible membership projection drift, search docs restored after a failed stream-tenant move, a convergence guard in tenant destruction, and a capped document link list.

<!-- kumiko-changes
feature: auth-email-password
type: fix
title: Foreign-member check with one limited query
detail: auth-email-password checks for foreign members with one limited query.
-->

<!-- kumiko-changes
feature: presence
type: fix
title: Batched presence lookups, safe expiry
detail: presence list resolves display names and parent visibility in batches (PresenceStore gains listMany) and drops expired fields only if unchanged since read (Lua compare-and-delete).
-->

<!-- kumiko-changes
feature: tier-engine
type: fix
title: Tier preload keeps a newer cache entry
detail: The tier-engine preload no longer overwrites a newer cache entry.
-->

<!-- kumiko-changes
feature: tenant
type: fix
title: seedTenantMembership reports rowMissing
detail: seedTenantMembership reports rowMissing when the membership projection row did not materialize and callers log it.
-->

<!-- kumiko-changes
feature: shared
type: fix
title: Stream-tenant backfill reindexes the old search bucket
detail: The stream-tenant backfill reindexes the old search bucket when a candidate fails after its docs were removed (createSearchBucketCleanup takes a row source and exposes onMoveFailed). A failed candidate reindexes only its own document in the old bucket, not the whole bucket.
-->

<!-- kumiko-changes
feature: tenant-lifecycle
type: fix
title: Destruction anonymize converges
detail: Tenant destruction anonymize stops when a pass makes no progress.
-->

<!-- kumiko-changes
feature: data-retention
type: fix
title: Retention anonymize compares decrypted values
detail: Retention anonymize compares decrypted PII values and is covered by a test. The anonymize diff compares JSON values independent of key order, and the notes-history feature name comes from its constant.
-->

<!-- kumiko-changes
feature: template-resolver
type: fix
title: Collection entries via decryptStoredPii
detail: template-resolver reads collection entries via decryptStoredPii.
-->

<!-- kumiko-changes
feature: documents
type: fix
title: Capped linked document list
detail: documents linkedDocumentIds throws the reason too_many_linked_documents (DocumentsReasons) above 10000 links.
-->

<!-- kumiko-changes
feature: renderer
type: fix
title: Banner keeps unique keys
detail: The renderer Banner keeps unique keys for repeated identical parts. The files dropzone shows a fallback text (kumiko.field.dropzone.file-unavailable, all locales) for a file without meta instead of an endless placeholder.
-->
