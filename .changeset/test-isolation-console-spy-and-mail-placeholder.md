---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-document-designer": patch
---

Test isolation for the search payload warn spy and the mail editor placeholder rail

<!-- kumiko-changes
feature: framework
type: fix
title: Unit tests no longer leak a console.warn spy into later files
detail: The search payload precedence tests spy on console.warn per test and restore it, so later files in the same --no-isolate worker start with the real console.warn. The mail editor missing-language test waits for the placeholder rail instead of reading it before the validate query settled.
-->
