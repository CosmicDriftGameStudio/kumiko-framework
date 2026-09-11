---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-headless": minor
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-renderer-web": minor
"@cosmicdrift/kumiko-types": minor
---

fw#2606: the default presentation heuristic for `kind: "select"` no longer looks at label length. Until now a select rendered as a segmented radio group only when it had at most four options **and** every label was at most 14 characters long. Labels reach the primitive already translated, so the second condition made the widget type depend on the active UI language: the same field rendered as `segmented-${id}` in German and as `combobox-${id}` in English, which broke language-independent e2e selectors and made a row of fields jump on locale switch. The option count is now the only criterion (still at most four); labels that no longer fit wrap inside the group, which already has `flex-wrap`.

Consumer note: selects with at most four options and long labels now expose `role="radiogroup"` where they previously rendered a combobox. `display: "dropdown"` on the field (or on the `Input` primitive) keeps the combobox where that is the wanted presentation.
