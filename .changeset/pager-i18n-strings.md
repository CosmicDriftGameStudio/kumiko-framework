---
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-renderer-web": patch
---

`Pager` (used by every `DataTable` with `pagination="pages"`) rendered its status line ("X – Y of Z") and its Previous/Next/Page aria-labels as hardcoded English literals instead of going through `t(...)`. Non-English apps now saw untranslated pagination text and screen readers announced it in English regardless of locale. All four now resolve through the renderer's translation layer (`kumiko.pager.status`, `kumiko.pager.previousPage`, `kumiko.pager.nextPage`, `kumiko.pager.page`), with the existing English text kept as the framework default so consumers without overrides are unaffected.
