---
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-types": patch
"@cosmicdrift/kumiko-framework": patch
---

Row decoration in infinite lists asks only for the rows loaded since the last answer.

<!-- kumiko-changes
feature: renderer
type: fix
title: Row decoration sends only new ids and keeps earlier answers
detail: In an infinite list each decoration call carries only the ids that have no answer yet; answers are merged across calls and dropped when the list's filter or sort changes. A reload after a write still asks for every id. A decoration query can now cap `ids` at the page size without losing the decoration once more pages are loaded.
-->
