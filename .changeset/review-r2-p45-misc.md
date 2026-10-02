---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-bundled-features": patch
---

`OWNER_INVITE_ROLE_OPTIONS` is now exported from the tenant barrel so apps can compose it into custom invite screens. The privacy-center and profile deletion explainer descriptions are registered as `i18nKey()` labels with server-side English translations. The export storage-cleanup backlog gauge now also covers failed jobs with an orphaned ZIP. Escape-hatch audit events from the forget-cleanup, user-export and tenant-lifecycle runners use the exported `UNATTRIBUTED_ACTOR` constant (value `"system"`, unchanged) when no actor is passed. Deletion requests no longer query the tenant compliance profile for users that are not active.

<!-- kumiko-changes
feature: user-data-rights
type: fix
title: Backlog gauge covers failed export orphans, explainer labels translated, unattributed escape-hatch actor constant
-->
