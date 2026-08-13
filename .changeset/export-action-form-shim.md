---
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-renderer-web": minor
---

`synthesizeActionFormEntity` and `synthesizeActionFormScreen` are now public API, so apps can render an `actionForm` screen through `RenderEdit` in their own layout (e.g. embedded in a drawer) instead of duplicating the shim.
