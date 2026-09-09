---
"@cosmicdrift/kumiko-renderer": patch
---

Fixes `WriteFormSection`'s submit button rendering as a full-width, icon-less block inline with the fields (looked like a banner, not a form footer). The button now goes through `Section`'s existing `actions` slot — the same mechanism `RenderEdit` uses via `Form`'s `actions` — giving it the established right-aligned, compact footer treatment plus a `check` icon, matching every other Kumiko form's submit button. No change to submit behavior, validation, or handler dispatch.
