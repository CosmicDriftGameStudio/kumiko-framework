---
"@cosmicdrift/kumiko-renderer": patch
---

Pins two untested contracts of a `projectionDetail` `relatedList` section's `rowActions` (the capability itself landed in #2675). A `kind: "navigate"` row action must reach its target screen and carry the clicked row's own values as search params through the declarative `params` extractor, and a row action with a `visible` condition must render only on the rows that satisfy it. Both run through the shared `buildProjectionRowActions`/`runProjectionRowNavigate` helpers, which `projectionList` already covers — what was unpinned is that a relatedList row, backed by a synthesized pseudo-entity rather than a real one, reaches them intact. No behavior change.
