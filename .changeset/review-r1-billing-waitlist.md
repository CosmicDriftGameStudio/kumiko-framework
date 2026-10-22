---
"@cosmicdrift/kumiko-bundled-features": patch
---

Billing and waitlist review fixes: contract termination no longer records twice for concurrent runs, revocation resumes a cancel recorded mid-flight, subscription sync carries a provider event time, waitlist link-on-signup surfaces failed updates, the offlot legacy migration skips entries it imported before, and the purge audit event is written before keys are shredded.

<!-- kumiko-changes
feature: billing-foundation
type: fix
title: Concurrent termination runs, revocation resume and sync ordering
detail: record-contract-termination re-checks the requestId after the provider call so a concurrent run appends nothing. Revocation resumes a period-end cancel that was recorded between its two stream reads. sync-subscription stamps the snapshot time as providerEventAtIso so a late older webhook cannot reactivate a synced cancellation.
-->

<!-- kumiko-changes
feature: waitlist
type: fix
title: Link-on-signup failures, legacy re-run and purge audit order
detail: link-on-signup throws when the entry update fails and the entry is still invited, so the consumer redelivers. The offlot legacy migration skips rows that are already imports. purge writes its audit event before shredding keys.
-->
