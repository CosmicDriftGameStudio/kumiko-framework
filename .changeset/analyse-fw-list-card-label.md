---
"@cosmicdrift/kumiko-types": patch
"@cosmicdrift/kumiko-renderer": patch
---

List columns can label their phone card line with `cardLabel: true`, e.g. "Current value: DE02…".

<!-- kumiko-changes
feature: renderer
type: improvement
title: cardLabel puts the column label in front of a phone card line
detail: A list column with cardLabel: true starts its phone card line with the column label ("Current value: …"); the value moves below the label as a whole before it breaks inside. The table keeps the label in the header only. Works for entity and projection lists.
-->
