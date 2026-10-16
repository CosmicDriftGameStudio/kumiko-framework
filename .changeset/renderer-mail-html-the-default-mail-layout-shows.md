---
"@cosmicdrift/kumiko-renderer-mail-html": patch
---

The default mail layout shows the mail body

The in-code default mail layout wraps the body in mj-text instead of mj-raw. With mj-raw the body HTML sat directly in the column table, browsers moved it into the column wrapper with font-size 0, and every mail without a mail-layout row had an invisible body. seedSystemMailLayout updates a seeded row on its next run.

<!-- kumiko-changes
feature: renderer-mail-html
type: fix
title: The default mail layout shows the mail body
-->
