---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-bundled-features": patch
---

The public variant route answers 404 for files without a registered renderer, and `resolveRenderer` is exported from `./derivatives` again.

<!-- kumiko-changes
feature: file-derivatives
type: fix
title: The public variant answers 404 instead of 503 when no renderer is registered for the file type
detail: The route checks the stored mimeType against the registered renderers before the predicate runs. Without a match it answers 404, the same as for an unknown file, so the response does not reveal whether the file exists.
-->

<!-- kumiko-changes
feature: framework
type: improvement
title: resolveRenderer is exported from ./derivatives again
detail: Callers can check whether a renderer is registered for a mimeType before asking for a variant.
-->
