---
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-types": patch
---

`load.passPrefill` also sends the values of a navigation handoff to the load query.

<!-- kumiko-changes
feature: renderer
type: fix
title: actionForm load.passPrefill passes handoff values
detail: An actionForm with `load` takes its values only from the load query. `passPrefill` sent the drawer's prefill values there but not the values of a navigation handoff (`useNavigateWithInitialValues`), so a form opened from an assistant step lost the step's values. The handoff values now travel in the load payload the same way; the query's schema must accept them.
-->
