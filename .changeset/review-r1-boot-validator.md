---
"@cosmicdrift/kumiko-framework": patch
---

Review fixes for the boot validator: entityEdit detail query gate, footer first column, pageHelp entity message.

<!-- kumiko-changes
feature: framework
type: fix
title: Boot validator review fixes
detail: `query/dispatch-only-on-screen` now also rejects an `entityEdit` screen whose implicit `<entity>:detail` query is dispatchOnly, which the browser loads over `/api/query` and would answer with 404. `action-form-preview/footer-column-unknown` rejects a footer cell for the first list column, where the renderer shows the footer label and drops the value. A `relatedList` pageHelp status section without any entity now reports "pageHelp.entity is required when the relatedList section names no entity" instead of the projectionDetail message. New tests cover the export route's 404 for a dispatchOnly query and both pageHelp entity-required cases.
-->
