---
"@cosmicdrift/kumiko-renderer": patch
---

Fix `projectionDetail` detail screens silently dropping fields declared through a section's `groups` instead of `fields`.

`synthesizeProjectionDetailEntity`/`synthesizeProjectionDetailScreen` only ever read `section.fields`, never `section.groups` — a detail screen whose section splits its fields into titled groups lost every one of those fields (the entity never learned their names, and any group field's own `readOnly: false` passed through unforced). Both helpers now read `fields` and `groups` together.

<!-- kumiko-changes
feature: renderer
type: fix
title: Fix projectionDetail detail screens dropping fields declared through groups
detail: synthesizeProjectionDetailEntity/synthesizeProjectionDetailScreen only read section.fields, so a section that put its fields in groups instead lost them entirely, and any group field's own readOnly:false passed through unforced. Both helpers now read fields and groups together, and force readOnly:true on both.
-->
