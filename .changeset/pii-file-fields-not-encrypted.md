---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-bundled-features": patch
---

File and image fields with a `personal` annotation are no longer encrypted under an active subject KMS. Before, creating such a row failed because the uuid column received a `kumiko-pii:` ciphertext. The annotation stays and still drives the hard delete of the binary on forget.

<!-- kumiko-changes
feature: framework
type: fix
title: Personal file/image fields are no longer encrypted
detail: collectPiiSubjectFields still lists file, image, files and images fields with a personal annotation (forget and retention use it), but the new collectPiiEncryptedFields leaves them out and every encrypt, decrypt, backfill and store-gate path now uses it. The column holds only the fileRef uuid; the binary is erased by the file-ref user-data hook.
-->
