---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-types": patch
---

An actionForm `redirect` with `handOff: true` lets the target form prefill those fields; a `timestamp` cell takes `emptyLabel`; an actionForm takes `valueDisplay`.

<!-- kumiko-changes
feature: framework
type: improvement
title: A multi-step actionForm hands values to its next step with redirect handOff
detail: `redirect: { screen, searchParams, handOff: true }` lets the target actionForm prefill the same-named fields from the URL and makes the redirect win over a `returnTo` the form was opened with, so step one can pass a checked value (for example a code) to step two. Opt-in: redirects without `handOff` behave exactly as before.
-->

<!-- kumiko-changes
feature: renderer
type: improvement
title: A timestamp column can show text for an empty value
detail: `renderer: { format: "timestamp", emptyLabel: i18nKey }` renders the translated text (for example "never") when the cell is empty; without it the cell stays blank as before.
-->

<!-- kumiko-changes
feature: renderer
type: improvement
title: An actionForm can show its read-only fields as plain text
detail: `valueDisplay: "text"` on an actionForm renders read-only fields as their value instead of a disabled input, as projectionDetail already does. Read-only fields no longer count toward the "All fields are required" summary, so a form with one editable required field keeps its asterisk.
-->
