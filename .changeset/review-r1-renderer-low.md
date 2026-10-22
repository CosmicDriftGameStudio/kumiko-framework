---
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-locale-es": patch
"@cosmicdrift/kumiko-locale-fr": patch
"@cosmicdrift/kumiko-locale-it": patch
---

Renderer robustness fixes and clearer template-reset wording in es/fr/it.

<!-- kumiko-changes
feature: renderer
type: fix
title: Renderer low-severity robustness fixes
detail: The list search echo handling no longer mutates state during render and no longer re-sends an already sent value. A failing live refetch no longer drops a queued follow-up run. Downloaded blob URLs are revoked after a delay, failed PDF loads are retried on the next mount, the file meta cache is cleared when the app gate unmounts, and renderFlow rejects duplicate node ids and unknown icons. The es/fr/it titles of the reset-to-system action now say the tenant template is reset to the system template.
-->
