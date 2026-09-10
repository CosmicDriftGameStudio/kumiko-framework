---
"@cosmicdrift/kumiko-renderer-web": patch
---

Fix `DataTable`'s toolbar cutting off `toolbarEnd` buttons on narrow viewports (e.g. `coa-mapping-list`, `statement-upload-list` at 390px). Neither the toolbar container nor its `toolbarEnd` wrapper allowed wrapping, so extra buttons ran off the right edge instead of onto a new line. Both now carry `flex-wrap`; `ml-auto` still right-aligns `toolbarEnd` on its own flex line once wrapped, so the desktop layout is unchanged when there's enough width.
