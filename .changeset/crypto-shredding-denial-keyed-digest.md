---
"@cosmicdrift/kumiko-bundled-features": patch
---

crypto-shredding: the forget-denied audit event now stores `subjectKeyDigest` as a keyed blind-index HMAC instead of a bare SHA-256 of the subject key, so a candidate id cannot be matched against it. Without a configured blind-index key the digest is omitted (`subjectKeyDigest` is now optional in the payload).

<!-- kumiko-changes
feature: crypto-shredding
type: improvement
title: forget-denied audit digest is keyed and omitted without a blind-index key
migration: |
  No action needed. Existing denial events keep their old digest; configure the blind-index key to get a digest on new ones.
-->
