---
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-renderer-web": minor
---

`Section` primitive: new optional `variant="destructive"` marks a section as a warning/danger area (border-only, e.g. account deletion, restrict processing) — closes the styling gap left after `privacy-center-screen.tsx` migrated off its hand-rolled `border-destructive/40` class onto the shared `Section` primitive.
