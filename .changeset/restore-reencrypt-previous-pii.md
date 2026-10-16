---
"@cosmicdrift/kumiko-framework": patch
---

Restore re-encrypts PII in the restored event's previous snapshot

<!-- kumiko-changes
feature: framework
type: fix
title: Restore no longer writes plaintext PII from pre-KMS rows into the event log
detail: Restore now decrypts the soft-deleted row and re-encrypts it like delete before storing previous, so rows written before the subject KMS was configured no longer leak plaintext personal fields into the restored event. Restoring such a row for an erased subject now fails like delete.
-->
