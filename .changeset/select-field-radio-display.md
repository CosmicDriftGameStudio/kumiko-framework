---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-headless": minor
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-renderer-web": minor
---

fw#2711: a `select` field can now request a radio group instead of hoping for one.

The web renderer already rendered `kind: "select"` as a WAI-ARIA radio group, but only behind a heuristic — at most 4 options, every label at most 14 characters. An app that wanted the radio group had no way to ask for it; one 15-character label silently turned the whole group into a dropdown. The next consumer then reached for raw `<input type="radio">`, because that was the only way to decide the presentation.

`SelectFieldDef` and the `Input` primitive's `kind: "select"` both gain an optional `display: "radio" | "dropdown"`. `"radio"` always renders the radio group, whatever the label lengths and option count; `"dropdown"` always renders the combobox. Omitted keeps the existing heuristic, so no existing field changes its rendering.

`display` is a request, not a contract: custom primitives implementations may ignore it and keep their own presentation. An empty `options` list still renders the dropdown even with `display: "radio"` — an empty radio group has nothing to operate.
