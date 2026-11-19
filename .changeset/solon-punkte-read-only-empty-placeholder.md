---
"@cosmicdrift/kumiko-renderer": patch
---

An empty read-only field with a format renderer shows "—" instead of nothing.

<!-- kumiko-changes
feature: renderer
type: fix
title: Empty read-only fields with a format renderer show the placeholder
detail: A readOnly field with a FormatSpec renderer (date, timestamp, enumOption and the other built-in formats) rendered an empty string for a null, undefined or empty value, so its label stood alone on a detail page. It now renders EMPTY_VALUE_PLACEHOLDER like a read-only field without a renderer. priority keeps its own emptyLabel; list cells are unchanged. Nothing to do for apps.
-->
