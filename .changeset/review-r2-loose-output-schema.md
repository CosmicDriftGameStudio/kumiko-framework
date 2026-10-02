---
"@cosmicdrift/kumiko-framework": patch
---

The query output-schema column check now skips `z.looseObject()` and `.catchall()` row schemas, since they accept keys beyond the declared shape. The schema-size guard for write-handler input schemas now names the feature and handler in its boot error.

<!-- kumiko-changes
feature: framework
type: fix
title: Boot column check skips loose/catchall output schemas; schema-walk error names the handler
-->
