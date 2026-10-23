---
"@cosmicdrift/kumiko-bundled-features": patch
---

Placeholder inserts keep working after a line editor remounts

<!-- kumiko-changes
feature: template-resolver
type: fix
title: Placeholder inserts keep working after a line editor remounts
detail: When a placeholder line editor (subject, preheader, header chip, footer note) remounted (labels arriving from the async validate query, or a new external value), TipTap could destroy the replaced editor after the new one was created. Its late null report then removed the live handle and placeholder inserts into that field did nothing. A null from a superseded editor is now ignored.
-->
