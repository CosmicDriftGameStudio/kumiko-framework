---
"@cosmicdrift/kumiko-renderer": patch
---

The action form success message names the chosen reference record even when it lies beyond the 200-row lookup cap. The lookup asks for exactly that id (`ids` for directory sources, an `id` filter for entity list handlers) instead of scanning the capped list.

<!-- kumiko-changes
feature: renderer
type: fix
title: Success message resolves reference labels by id
detail: resolveSuccessMessageParams requests the chosen record by id, so a tenant picked in a tier-admin form with more than 200 tenants is named in the success message instead of showing its raw id. Sources that ignore both inputs keep the previous capped-list behaviour.
-->
