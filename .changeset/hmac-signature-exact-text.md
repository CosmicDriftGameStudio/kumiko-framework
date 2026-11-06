---
"@cosmicdrift/kumiko-bundled-features": patch
---

Signed tokens accept only the exact signature text. Before, a signature with different unused trailing bits in its last character also verified, and the test tampering the last characters failed about once in 65536 runs.

<!-- kumiko-changes
feature: auth-mfa
type: fix
title: Signed tokens accept only the exact signature text
detail: `hmacSignatureMatches` compared the decoded bytes, so a signature whose last character differed only in its unused trailing bits also verified. It now compares the text. No consumer action needed.
-->
