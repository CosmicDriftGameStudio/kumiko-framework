---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
---

Query handlers can now declare an optional `outputSchema` (a Zod schema of the handler's actual return value — the paged envelope for `definePagedQueryHandler`, or the flat record for a plain `defineQueryHandler`). When set, the boot-validator checks a screen's column/field references against it and throws on a typo instead of it surfacing as a silently-empty cell at runtime: `projectionList`/`relatedList`/dashboard-list `columns`, `projectionDetail` `header`/`metrics`, and dashboard stat-panel `valueField`/`subField`/`toneField`/`deltaField`/`deltaDirectionField`/`deltaToneField`. Fully additive — a handler without `outputSchema` (every existing one) skips these checks exactly as before.
