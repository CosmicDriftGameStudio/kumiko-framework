---
"@cosmicdrift/kumiko-renderer": patch
---

fw#2713: `projectionDetail` screens now render their `actions` (declared and the default "edit" action) inside the head Card, alongside title/status/metrics, instead of in the card footer below the active tab's content. They're actions on the record the head shows, not on whichever tab is open, so they used to visually drift as tab content length changed and could land off-screen below a long tab. Placement is unified between `layout.mode: "tabs"` and `"single"` — both now show actions in the head. No change for a screen without `actions`/a resolvable default edit action (no action strip renders), and action id/label/order/icon-collapse rules are unchanged.
