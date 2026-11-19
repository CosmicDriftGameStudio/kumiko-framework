---
"@cosmicdrift/kumiko-framework": patch
---

The search consumer flushes the tenants of one batch side by side (up to 8 at a time), and the Meilisearch adapter configures a new tenant index with one settings task instead of four.

<!-- kumiko-changes
feature: framework
type: fix
title: Search index keeps up when many tenants write at once
detail: The search consumer used to write the tenants of a batch one after another and waited for every Meilisearch task in turn; a new tenant cost six tasks (four of them settings updates). A batch spanning 20 new tenants took about 8.7 s against a local Meilisearch, so search results lagged more than 15 s behind writes under load. The four settings updates are now one `updateSettings` task, and up to 8 tenants of a batch are flushed concurrently; the same batch now takes about 2.9 s. A tenant's ops still run in event order, the cursor still moves only after every task of the batch succeeded, and a failing tenant is held for retry exactly as before. No app changes needed.
-->
