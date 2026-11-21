---
"@cosmicdrift/kumiko-renderer": patch
---

actionForm fact rows keep their test id and emphasize, a submitThrough handoff wraps one submit only, aiAssist gets the handoff prefill, and a document field without an editor keeps an HTML value.

<!-- kumiko-changes
feature: renderer
type: fix
title: actionForm facts, submitThrough and document fallback fixes
detail: `KeyValueList` rows accept an optional `testId`, so single-line facts keep `action-form-success-fact-<n>`. `Metric` (tile) and `StatCard` accept `emphasize`, so an emphasized preview fact is highlighted in tiles. A `submitThrough` handoff applies to the first successful submit only; a form that stays open writes to its own handler afterwards. With `load.passPrefill`, an aiAssist query receives the same prefill (drawer or handoff values) as the load query. A `document` field without a registered document editor edits plain text in the textarea and still stores and reports HTML.
-->
