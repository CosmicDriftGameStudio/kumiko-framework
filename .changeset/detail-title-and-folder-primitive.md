---
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-renderer-web": minor
---

projectionDetail title fix and folder picker through the file Input primitive

<!-- kumiko-changes
feature: renderer
type: fix
title: projectionDetail no longer shows an empty type-title block above the record
detail: The projectionDetail shim dropped recordTitleField, so the duplicate-title fix never applied to real projectionDetail screens. The synthesized edit screen now carries it, and the page header shows the record title once.
-->

<!-- kumiko-changes
feature: renderer-web
type: improvement
title: Folder picker through the file Input primitive
detail: Input kind "file" takes directory, onFilesPicked (files with webkitRelativePath, nothing is uploaded), pickLabel for the button text and testId (hidden input gets testId-input, button testId-pick). New platform-neutral type PickedFile. directory is web-only and ignored by native implementations.
-->
