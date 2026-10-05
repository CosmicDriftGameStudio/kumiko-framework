---
"@cosmicdrift/kumiko-bundled-features": minor
---

The simple mail renderer gets a badge, a stage track and chips, and notification renders carry a text part

`EmailTemplateData.badge` (`{ label, tone? }`) renders a small pill above the header. Two new section kinds are available: `{ stages: { label, state: "done" | "current" | "upcoming" }[] }` renders an email-safe horizontal track from a table with inline styles, and `{ chips: { label, tone? }[] }` renders inline pills. Tones are `neutral`, `info`, `success`, `warning` and `danger`; a missing or unknown tone renders as neutral. Malformed stage and chip entries are skipped, every label is escaped. `renderText` prints the badge as `[label]`, stages as `✓ A → ▶ B → ○ C` and chips joined with ` · `. The `renderer-simple` plugin now fills the optional `text` of the `notification` render response through `renderText`.

<!-- kumiko-changes
feature: renderer-simple
type: improvement
title: Badge, stages track and chips for the simple mail renderer
detail: Use badge, { stages } and { chips } in the template variables; the notification RenderResponse carries the matching plain text in text.
-->
