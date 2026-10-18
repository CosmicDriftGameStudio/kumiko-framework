---
"@cosmicdrift/kumiko-headless": patch
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-renderer-web": patch
"@cosmicdrift/kumiko-document-designer": patch
"@cosmicdrift/kumiko-bundled-features": patch
---

Empty values use one placeholder everywhere

<!-- kumiko-changes
feature: renderer
type: fix
title: Empty values use one placeholder everywhere
detail: Empty table cells, reference columns, read-only fields and dashboard lists now share one em dash placeholder (exported as EMPTY_VALUE_PLACEHOLDER from the headless package) instead of mixing en and em dashes.
-->
