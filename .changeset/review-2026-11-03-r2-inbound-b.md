---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-bundled-features": patch
---

Review round 2, inbound mail b: concurrent connects of one address create a single account, quarantine lookups carry the tenant, the storeBody hook skips originals that normalization drops, and the search reindex configures the system tenant index for system-stream entities.

<!-- kumiko-changes
feature: inbound-mail-foundation
type: fix
title: review round 2 inbound mail fixes (connect race, quarantine lookups, storeBody, system search index)
detail: `connect-account` takes an advisory lock per tenant and normalized address before the duplicate check, so a double submit or the OAuth callback racing the IMAP form cannot create two accounts for one address. `quarantinedMessageIds`, `hasOpenQuarantine` and `quarantineMessage` filter on `tenantId` and use the unique index. The supervisor no longer hands the storeBody hook an original that is above the raw MIME limit. `reindexTenantsSearch` also configures the system tenant index when a searchable entity lives on the system stream, so those documents get the searchable and ranking fields instead of the wildcard fallback; with the system tenant added, `failedConfigures` can count one more tenant.
-->
