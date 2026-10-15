---
"@cosmicdrift/kumiko-framework": minor
---

Binding of referenced files only for the record creator's own uploads

files:write:bind-referenced-files now binds a file only if the record creator uploaded it (or the system generated it), so foreign references cannot expose private uploads.

<!-- kumiko-changes
feature: framework
type: improvement
title: Binding of referenced files only for the record creator's own uploads
-->
