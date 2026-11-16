---
"@cosmicdrift/kumiko-bundled-features": patch
---

Session and personal-access-token lists decrypt their rows with at most four key lookups at a time.

<!-- kumiko-changes
feature: sessions
type: improvement
title: Session and token lists no longer flood the KMS pool
detail: `user-session:list`, `user-session:mine` and the personal-access-tokens list decrypted every row at once, so an admin list of 200 sessions started up to 400 key lookups against a KMS pool of four connections and stalled every other PII read in the process. They now decrypt through `mapWithConcurrency` with the shared `KMS_POOL_CONCURRENCY` (4), like the member and display-name lookups. The results are unchanged.
-->
