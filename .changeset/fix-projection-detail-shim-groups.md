---
"@cosmicdrift/kumiko-renderer": patch
---

Fix `projectionDetail` detail screens silently dropping fields declared through a section's `groups` instead of `fields`.

`synthesizeProjectionDetailEntity`/`synthesizeProjectionDetailScreen` only ever read `section.fields`, never `section.groups` — a detail screen whose section splits its fields into titled groups lost every one of those fields (the entity never learned their names, and any group field's own `readOnly: false` passed through unforced). Both helpers now read `fields` and `groups` together.
