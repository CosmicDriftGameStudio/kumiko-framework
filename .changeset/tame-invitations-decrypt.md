---
"@cosmicdrift/kumiko-bundled-features": patch
---

Fix: `tenant:query:invitations` now decrypts `invitedBy` (previously returned as ciphertext under active KMS, causing a 500 on the members screen).
