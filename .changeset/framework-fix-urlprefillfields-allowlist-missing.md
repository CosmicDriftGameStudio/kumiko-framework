---
"@cosmicdrift/kumiko-framework": patch
---

Fix urlPrefillFields allowlist missing relatedList toolbarActions

A screen reached only through a relatedList toolbar action never received its mapped id, so its hidden required field stayed empty and the declared redirect never ran.

<!-- kumiko-changes
feature: framework
type: fix
title: Fix urlPrefillFields allowlist missing relatedList toolbarActions
-->
