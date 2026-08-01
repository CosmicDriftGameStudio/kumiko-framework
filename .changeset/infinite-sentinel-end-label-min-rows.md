---
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-renderer-web": patch
---

`InfiniteSentinel` only shows its "— End of list —" marker once a list has at least one full page of rows (default 20). A short list (a single page) now ends with no marker — the list visibly ends itself, the marker was just noise there (#1699).
