---
"@cosmicdrift/kumiko-renderer-mail-html": patch
---

Money, date and percent placeholders in subject, preview text, chip and footer note are formatted like in the body

<!-- kumiko-changes
feature: renderer-mail-html
type: fix
title: Typed placeholders in mail subject lines are formatted
detail: A money placeholder in the subject or preview text rendered as "[object Object]" and a date as its raw ISO string, because only the body compiler added the format helpers. Subject, preview text, header chip, tone and footer note now use the same money, date and percent formatting as the body. Attachment file names keep the raw values.
-->
