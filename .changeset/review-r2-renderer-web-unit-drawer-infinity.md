---
"@cosmicdrift/kumiko-renderer-web": minor
---

Review round 2 fixes for renderer-web.

- `InfinityList` now defaults `live` to `false` (it was `true`). Lists that relied on the implicit realtime refresh no longer update on SSE events until they pass `live={true}`.
- A number input with a `unit` exposes the unit to screen readers through `aria-describedby` instead of hiding it with `aria-hidden`.
- `Drawer` with an explicit `width` is capped at `85vw`, the same limit as the default width.

<!-- kumiko-changes
feature: renderer-web
type: breaking
title: InfinityList live defaults to false
migration: |
  Pass `live={true}` to every `<InfinityList>` that should refresh from SSE events. Without it the list only loads on mount and on pagination.
-->

<!-- kumiko-changes
feature: renderer-web
type: fix
title: Number input unit is announced by screen readers and Drawer width is capped to the viewport
-->
