---
"@cosmicdrift/kumiko-renderer": patch
---

A PDF preview that is still mounted keeps its document alive. The bounded document cache now counts users per entry and only evicts and destroys entries nobody holds, so a list with five or more PDFs no longer blanks the first preview.

<!-- kumiko-changes
feature: renderer
type: fix
title: PDF previews keep their document while mounted
detail: createBoundedLoadCache now returns { load, retain }. PdfPreview retains its document while mounted, and the cache evicts only unused entries, so a fifth document no longer destroys one that is still rendered.
-->
