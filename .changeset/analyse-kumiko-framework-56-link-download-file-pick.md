---
"@cosmicdrift/kumiko-renderer": patch
---

`Input kind="file"` can pick one or several files without uploading them.

<!-- kumiko-changes
feature: renderer
type: improvement
title: Pick-only file input with multiple
detail: `Input kind="file"|"image"` now only picks whenever `onFilesPicked` is set: the picked files go to the callback and nothing is uploaded to `/api/files`, with or without `directory`. The new `multiple` prop lets that pick-only input take several files. Without `onFilesPicked` the input uploads one file as before.
-->
