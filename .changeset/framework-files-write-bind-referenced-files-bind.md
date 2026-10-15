---
"@cosmicdrift/kumiko-framework": minor
---

files:write:bind-referenced-files binds a record's referenced files

System-only handler that binds the files a record references through its declared file fields (legacy uploads with entityId null, records created without a save lifecycle) so record readers can open them. Skips files bound elsewhere, of another tenant or missing. Callable from es-ops seeds via ctx.systemWriteAs; pages with limit and nextAfterId.

<!-- kumiko-changes
feature: framework
type: improvement
title: files:write:bind-referenced-files binds a record's referenced files
-->
