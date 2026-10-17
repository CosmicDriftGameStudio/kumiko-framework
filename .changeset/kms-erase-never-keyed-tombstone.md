---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-bundled-features": patch
---

eraseKey tombstones never-keyed subjects

<!-- kumiko-changes
feature: crypto-shredding
type: fix
title: eraseKey leaves a tombstone for subjects that never had a key
detail: eraseKey now records an erased entry even when the subject has no key (pre-KMS plaintext). A later createKey or write for that subject fails with subject_erased instead of minting a fresh key and re-encrypting the plaintext. Erase flows must write with writePurpose erasure after eraseKey. kumiko_subject_keys now gets one tombstone row per forgotten record subject and per step dispatch. The tenant destruction stage tenant-row now fails loudly when marking the tenant destroyed does not succeed.
migration: Run backfill-pii before erasing Pre-KMS data, otherwise untouched plaintext stays readable after eraseKey.
-->
