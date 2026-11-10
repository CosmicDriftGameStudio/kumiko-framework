---
"@cosmicdrift/kumiko-framework": patch
---

The PII event backfill no longer re-keys self-owned personal fields under their own ciphertext, repairs values already keyed that way, and logs the failure reason per event.

<!-- kumiko-changes
feature: framework
type: fix
title: PII event backfill stops growing self-owned personal fields
detail: A personal field that is its own owner (for example invitedBy) was re-keyed under its own ciphertext on every boot. The backfill now keys it under the decrypted user id, repairs values already keyed wrongly, and logs the failure reason per event.
-->
