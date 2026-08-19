---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-renderer-web": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

`projectionDetail`'s `hideActions: true` used to hide RenderEdit's entire footer, including the screen's own declared `actions` — a screen that set `hideActions` to lose its Cancel button silently lost its header actions along with it (e.g. `RowActionNavigate` buttons opening related records).

`projectionDetail` has no write path, so there's nothing for a Cancel button to discard: RenderEdit's `onCancel` is no longer wired up for this screen type at all, regardless of `listScreenId` or `hideActions`. Back-navigation continues to work via the breadcrumb, which already resolved `listScreenId` independently. Declared `actions` now always render.

This changes default behavior for any existing `projectionDetail` screen with `listScreenId` set and no `hideActions` opt-in: the Cancel button that used to show by default is gone. `hideActions` itself is unchanged as a field (kept for existing callers) but is now unused on `projectionDetail` — setting it has no effect.
