---
"@cosmicdrift/kumiko-bundled-features": patch
---

forget-subject is covered for users stored before the KMS and users without an event stream

<!-- kumiko-changes
feature: crypto-shredding
type: fix
title: forget-subject is covered for users stored before the KMS and users without an event stream
detail: Tests now cover forget-subject for users stored as plaintext before the KMS was configured and for users without an event stream. Both succeed since the KMS tombstone fix, close the login door and write the audit event.
-->
