---
"@cosmicdrift/kumiko-renderer-mail-html": patch
---

Mail renderer keeps wall-clock dates and system attachments

<!-- kumiko-changes
feature: renderer-mail-html
type: fix
title: Mail renderer keeps wall-clock dates and system attachments
detail: The date helper keeps the calendar date of offset datetimes, tenant overrides of system mails keep inherited attachments, markdown templates use the system layout and delivery envelope keys are not exposed as variables.
-->
