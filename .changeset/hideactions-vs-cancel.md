---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-renderer-web": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

`projectionDetail`'s `hideActions: true` (0.209.0) hid RenderEdit's entire footer, including the screen's own declared `actions` — a screen that set `hideActions` to lose its Cancel button silently lost its header actions along with it (e.g. `RowActionNavigate` buttons opening related records).

`projectionDetail` has no write path, so there's nothing for a Cancel button to discard: RenderEdit's `onCancel` is no longer wired up for this screen type at all, regardless of `listScreenId`. Back-navigation continues to work via the breadcrumb, which already resolved `listScreenId` independently. Declared `actions` now always render.

**If you're on 0.209.0 and this affects you:**

- Every existing `projectionDetail` screen with `listScreenId` set now renders without a Cancel button by default — that button used to show unless you opted out.
- `hideActions` is removed from `ProjectionDetailScreenDefinition` entirely (it only ever shipped in 0.209.0, with the bundled sessions feature as its only consumer). Delete it from any screen definition that still sets it — it no longer exists on the type. `RenderEdit`'s own `hideActions` prop (for hosts driving their own action bar directly) is unrelated and unchanged.
