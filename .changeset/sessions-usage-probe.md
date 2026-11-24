---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-bundled-features": patch
---

Sessions serves `GET /sessions/usage` next to the last-activity probe.

<!-- kumiko-changes
feature: sessions
type: improvement
title: sessions serves GET /sessions/usage with database size, file bytes and mails sent this month
detail: A sibling app presenting the same probe secret gets `{ dbBytes, fileBytes, mailsSentThisMonth }` summed across every tenant; `fileBytes` and `mailsSentThisMonth` are null when files-storage-tracking or delivery is not mounted. The schema is exported as `usageProbeAnswerSchema`.
-->
