---
"@cosmicdrift/kumiko-renderer-web": minor
---

Consolidate card chrome into a single `cardSurface()` cva (Form/Section/Card no longer diverge), export `Card` + `CardProps`, and add thin `Stack` / `PageSection` layout primitives. Apps can now import a card instead of hand-rolling `<div>` chrome. Note: standalone sections render `rounded-xl` (was `rounded-lg`) for consistency.
