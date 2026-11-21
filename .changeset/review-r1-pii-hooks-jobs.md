---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-bundled-features": patch
---

Review fixes for PII backfill, the stored-email boot repair, the search consumer and the job scheduler sweep.

<!-- kumiko-changes
feature: framework
type: fix
title: Bounded email boot scan, search flush settles before rejecting, scheduler sweep stamps unseen ids
detail: `normalizeStoredUserEmails` reads users in id-ordered batches (default 500) instead of all at once. The search consumer batch handler lets every tenant flush finish before it rethrows an unexpected failure, so no `holdForRetry` lands on an ended turn. The job runner refresh tick stamps a scheduler without a seen entry instead of deleting it; only the start sweep removes unseen ones. The PII backfill failure log no longer repeats the event ids, and subject-resolver gets tests for ciphertext and sentinel owner values.
-->
