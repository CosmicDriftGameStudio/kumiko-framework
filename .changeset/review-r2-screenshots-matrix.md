---
"@cosmicdrift/kumiko-testing": patch
---

Screenshot runner fixes: a desktop project whose viewports are all covered by device projects is now skipped with a reason instead of running empty. Locales that already carry a region (`pt-BR`, `en-GB`) keep their tag instead of becoming `pt-BR-BR`. `captureScreenshot` with `presentIdentities` restores the original DOM text and field values after the capture, so later assertions and form submits in the same spec see real data.

<!-- kumiko-changes
feature: testing
type: fix
title: Screenshot runner skips empty desktop passes, keeps regional locale tags and restores presented identities
-->
