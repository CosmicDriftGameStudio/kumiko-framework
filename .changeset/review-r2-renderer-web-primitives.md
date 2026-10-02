---
"@cosmicdrift/kumiko-renderer-web": patch
---

A nested `Form` that degrades to a `<div>` now submits on Enter inside its own inputs and ignores submit buttons that belong to a portal or a deeper nested form. The textarea `onSubmitShortcut` no longer fires when the caller's `onKeyDown` called `preventDefault()`. `Card` no longer lets `dataAttributes` override `data-slot`.

<!-- kumiko-changes
feature: renderer-web
type: fix
title: Textarea respects preventDefault, Card data-slot is not overridable, degraded FormRoot scopes Enter and submit to its own inputs
-->
