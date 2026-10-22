---
"@cosmicdrift/kumiko-framework": patch
---

`kumiko-upgrade --resolve` now also sets the resolved manual migrations to `[migrated]` or `[not-applicable]` in the app's CHANGELOG.md, not only in the marker.

<!-- kumiko-changes
feature: framework
type: fix
title: kumiko-upgrade --resolve updates CHANGELOG.md
detail: The Manual migrations lines of every CHANGELOG.md section change from [open] to the chosen resolution for the resolved ids; other entries and files without a CHANGELOG.md are left alone.
-->
