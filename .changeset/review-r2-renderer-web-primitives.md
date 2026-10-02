---
"@cosmicdrift/kumiko-renderer-web": patch
---

A nested `Form` that degrades to a `<div>` now submits on Enter inside its own inputs and ignores submit buttons that belong to a portal or a deeper nested form. The textarea `onSubmitShortcut` no longer fires when the caller's `onKeyDown` called `preventDefault()`. `Card` no longer lets `dataAttributes` override `data-slot`.
