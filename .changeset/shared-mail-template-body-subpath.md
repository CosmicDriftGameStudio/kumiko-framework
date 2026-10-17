---
"@cosmicdrift/kumiko-bundled-features": patch
---

Mail template body helpers are importable from `./shared/mail-template-body`

<!-- kumiko-changes
feature: shared
type: improvement
title: Mail template body helpers exported as `./shared/mail-template-body`
detail: Apps that register their own notification templates can build the body with the same helpers the framework uses: `mailParagraph`, `mailHeading`, `mailRepeatedRows`, `mailTextWithSlotsHtml`, plus the new `mailButton`, `mailParagraphWithLink` and `mailSubject`. The subpath only depends on kumiko-headless and is safe on the server. Apps that copied these helpers can import them instead.
-->
