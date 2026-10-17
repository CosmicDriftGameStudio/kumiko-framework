---
"@cosmicdrift/kumiko-framework": patch
---

Projection rebuild decrypts legacy PII ciphertext in file and image fields

<!-- kumiko-changes
feature: framework
type: fix
title: Rebuilding an entity with a personal file or image field no longer fails on ciphertext from old backfill events
detail: The earlier PII backfill encrypted file and image uuid values in stored events. Replaying those created and updated events wrote the ciphertext into the uuid column and failed with invalid input syntax. applyEntityEvent now decrypts such values through the subject KMS, writes null for an erased subject, and throws a clear InternalError when no KMS is configured. Table rows were never affected because Postgres rejects the ciphertext on a uuid column.
-->
