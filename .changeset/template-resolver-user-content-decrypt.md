---
"@cosmicdrift/kumiko-bundled-features": patch
---

User-owned collection entries read back as plaintext when a PII key service is configured.

<!-- kumiko-changes
feature: template-resolver
type: fix
title: user-owned collection entries no longer fail with pii_ciphertext_leak
detail: With a PII key service configured, the list and item queries of an `ownership: "user"` collection (signatures) returned the stored ciphertext, so the API rejected the response and the editor showed "Could not load block". Both queries now decrypt `content` for the owner before returning it.
-->
