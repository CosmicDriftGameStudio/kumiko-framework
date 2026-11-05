---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-renderer": minor
---

Board gaps round 9: right-aligned money in projection lists, per-column empty placeholder, toolbar action icon in related lists, dimmed neutral to-do sentence.

<!-- kumiko-changes
feature: renderer
type: improvement
title: board gaps round 9, projection money alignment, emptyPlaceholder, toolbar icon, dimmed to-do sentence
detail: projectionList and relatedList columns with `valueType: "money"` or `"number"` now synthesize a real number/money field, so header and cells are right-aligned like in an entityList (before, every projection column was typed as text and stayed left). `ListColumnSpec.emptyPlaceholder: false` leaves an empty cell blank instead of drawing the em dash (boot rule `list/hint-column-empty-placeholder` rejects it together with `hint`, which owns its own empty look). `ToolbarAction.icon` (an `IconKey`) is now honored by every toolbar action builder, so a relatedList tab toolbar draws the declared icon like the main list; without it the id-derived default (create, delete, ...) still applies. A hint column whose `toneField` row value is `neutral` draws the sentence muted and not bold, like `emptyLabel`, in the table, on the phone card (no tone stripe) and in dashboard list cards; `plainSentence: true` opts out.
-->
