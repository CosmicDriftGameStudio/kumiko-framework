---
"@cosmicdrift/kumiko-framework": patch
---

Read paths decrypt file-reference fields again so legacy PII ciphertext does not leak

<!-- kumiko-changes
feature: crypto-shredding
type: fix
title: decryptForRead and eager-loaded refs decrypt file, image, files and images fields that hold legacy ciphertext
detail: Only the encrypt side skips file-reference fields. The decrypt side uses collectPiiSubjectFields again and passes plaintext through unchanged, so rows written by the old backfill, which encrypted the file uuid, are read as plaintext instead of failing with pii_ciphertext_leak.
-->
