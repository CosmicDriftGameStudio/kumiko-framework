---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-samples": patch
---

Narrow list cards show the "to do" hint sentence above the title.

<!-- kumiko-changes
feature: renderer
type: improvement
title: List cards lead with the hint sentence
detail: `cardColumnRoles` returns a new role `lead`: the first text column with a `hint` that is neither title, status nor `hideOnNarrow`. It no longer counts as a meta column. Below 768 px the card shows the lead above the heading with the table's hint cell (sentence, detail line, "Why?"), only when the value is not empty; `rowToneField` still tints the card. The card order is now lead, title with status, up to three values, then the row action. Recipe: `samples/recipes/record-detail-layout`.
-->
