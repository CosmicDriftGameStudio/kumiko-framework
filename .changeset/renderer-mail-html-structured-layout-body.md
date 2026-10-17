---
"@cosmicdrift/kumiko-renderer-mail-html": patch
---

Structured mail layouts show the mail body

The structured layout frame wraps the body in mj-text instead of mj-raw. With mj-raw the body HTML sat directly in the column table, browsers moved it into the column wrapper with font-size 0, and every mail on a tenant layout had an invisible body.

<!-- kumiko-changes
feature: renderer-mail-html
type: fix
title: Structured mail layouts show the mail body
-->
