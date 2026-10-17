---
"@cosmicdrift/kumiko-bundled-features": patch
---

Template test mail failures are logged

<!-- kumiko-changes
feature: template-resolver
type: fix
title: send-test logs failed test mails with error class and tenant
detail: A transport that throws or reports not sent is logged with the error class/code and tenant id (no address, no provider body) and still answers `template_test_mail_failed`.
-->
