---
"@cosmicdrift/kumiko-bundled-features": patch
---

Integration tests now cover the erasure wiring of forget-subject and runForgetCleanup for a user stored before the KMS existed.

<!-- kumiko-changes
feature: crypto-shredding
type: improvement
title: Tests pin the erasure write purpose in forget-subject and the forget cleanup
detail: A pre-KMS user whose key was already erased still ends deleted, loses its tokens and gets the erased sentinel in the update event.
-->
