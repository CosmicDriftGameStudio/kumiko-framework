---
"@cosmicdrift/kumiko-bundled-features": patch
---

Regression tests: Art. 17 forget shreds PII in user.updated previous payloads

<!-- kumiko-changes
feature: user-data-rights
type: fix
title: Regression tests prove that forget also shreds the previous email in user.updated events
detail: No runtime change. Integration tests with a configured subject KMS show that after an email change followed by forget, the old and new email in user.updated changes and previous decrypt only to the erased sentinel and the subject key is gone. Without a configured KMS, event payloads stay plaintext by design.
-->
