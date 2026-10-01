---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
---

extensionSelector owner panels on the generated settings page

`r.extensionSelector(extension, key, { panels })` lets the selector owner add its own `custom` or `screen` panels to the generated `<ownerGroup>-tenant` settings dashboard, after the selection panel and before the plugin panels. Short `screen` refs resolve against the declaring feature. Dead screen or `visibleWhen` query refs, empty, duplicate or `selection` panel ids fail at boot or declaration.

<!-- kumiko-changes
feature: framework
type: improvement
title: A selector owner can add its own custom or screen panels to the generated settings page (extensionSelector panels)
migration: No code change needed.
-->
