---
"@cosmicdrift/kumiko-testing": patch
---

loginViaUi waits for the MFA auto-submit instead of pressing Enter.

<!-- kumiko-changes
feature: testing
type: fix
title: loginViaUi no longer races the MFA auto-submit
detail: The MFA code field submits itself on the sixth digit since 0.388. loginViaUi now fills the code while waiting for the verify response and no longer presses Enter on a field that may already be disabled.
-->
